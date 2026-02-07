/**
 * Handshake tests rewritten using @solana/kit (the successor to @solana/web3.js).
 *
 * Anchor's TS client still depends on legacy web3.js types, so we use kit for
 * everything *outside* Anchor calls (keypair gen, PDA derivation, token ops,
 * balance queries, SOL transfers) and convert to PublicKey at the Anchor boundary.
 *
 * Key kit differences from web3.js:
 *   - Functional, not OOP — no classes, just functions and branded types
 *   - Async by default — keypair gen, PDA derivation, signing are all async
 *   - BigInt everywhere — lamports, token amounts, account sizes are bigint
 *   - pipe() composition — transactions built by piping through transformers
 *   - Two-step RPC — rpc.getSlot().send() (build request, then execute)
 *   - Addresses are branded strings, not PublicKey objects
 */
import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair as LegacyKeypair } from "@solana/web3.js";
import { assert } from "chai";
import { Handshake } from "../target/types/handshake";

// ─── Kit imports ──────────────────────────────────────────────────────────────
import {
  type Address,
  type KeyPairSigner,
  address,
  generateKeyPairSigner,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  getProgramDerivedAddress,
  getAddressEncoder,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  sendAndConfirmTransactionFactory,
  lamports,
} from "@solana/kit";

import {
  getCreateAccountInstruction,
  getTransferSolInstruction,
} from "@solana-program/system";

import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getInitializeMintInstruction,
  getMintToInstruction,
  TOKEN_PROGRAM_ADDRESS,
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  getMintSize,
} from "@solana-program/token";

// ─── Constants ────────────────────────────────────────────────────────────────

const POOL_SEED = new TextEncoder().encode("pool");
const SENDER_SEED = new TextEncoder().encode("sender");
const RECIPIENT_SEED = new TextEncoder().encode("recipient");
const NONCE_SEED = new TextEncoder().encode("nonce");

const SYSTEM_PROGRAM_ADDRESS: Address = address(
  "11111111111111111111111111111111"
);
const RENT_SYSVAR_ADDRESS: Address = address(
  "SysvarRent111111111111111111111111111111111"
);

// ─── Kit ↔ Anchor conversion helpers ──────────────────────────────────────────

/** Convert a kit Address (branded string) to an Anchor PublicKey */
function toPubkey(addr: Address): PublicKey {
  return new PublicKey(addr);
}

/** Convert an Anchor PublicKey to a kit Address */
function toAddress(pubkey: PublicKey): Address {
  return address(pubkey.toBase58());
}

/** Convert a BN to a little-endian Uint8Array (8 bytes) for PDA seeds */
function bnToLeBytes(n: BN): Uint8Array {
  return new Uint8Array(n.toArray("le", 8));
}

/**
 * Generate a kit KeyPairSigner AND a legacy Keypair from the same random seed.
 * We need both because Anchor's .signers([]) requires legacy Keypair objects,
 * but kit uses async CryptoKey-based KeyPairSigners.
 */
async function generateDualKeypair(): Promise<{
  signer: KeyPairSigner;
  legacy: LegacyKeypair;
}> {
  // Generate a random 32-byte seed
  const seed = new Uint8Array(32);
  crypto.getRandomValues(seed);

  // Create legacy keypair from seed
  const legacy = LegacyKeypair.fromSeed(seed);

  // Create kit KeyPairSigner from the same seed via CryptoKey import
  const { createKeyPairSignerFromBytes } = await import("@solana/kit");
  // createKeyPairSignerFromBytes expects 64 bytes (seed + pubkey) or the full secret key
  const fullKey = new Uint8Array(64);
  fullKey.set(seed, 0);
  fullKey.set(legacy.publicKey.toBytes(), 32);
  const signer = await createKeyPairSignerFromBytes(fullKey);

  return { signer, legacy };
}

// ─── Kit PDA helpers ──────────────────────────────────────────────────────────

async function findPoolPda(
  programAddress: Address,
  poolId: Address
): Promise<readonly [Address, number]> {
  const encoder = getAddressEncoder();
  return getProgramDerivedAddress({
    programAddress,
    seeds: [POOL_SEED, encoder.encode(poolId)],
  });
}

async function findTransferPda(
  programAddress: Address,
  sender: Address,
  recipient: Address,
  nonce: BN
): Promise<readonly [Address, number]> {
  const encoder = getAddressEncoder();
  return getProgramDerivedAddress({
    programAddress,
    seeds: [
      SENDER_SEED,
      encoder.encode(sender),
      RECIPIENT_SEED,
      encoder.encode(recipient),
      NONCE_SEED,
      bnToLeBytes(nonce),
    ],
  });
}

async function findAta(
  mint: Address,
  owner: Address
): Promise<Address> {
  const [ata] = await findAssociatedTokenPda({
    mint,
    owner,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  return ata;
}

// ─── Kit RPC + transaction helpers ────────────────────────────────────────────

const rpc = createSolanaRpc("http://127.0.0.1:8899");
const rpcSubscriptions = createSolanaRpcSubscriptions("ws://127.0.0.1:8900");
const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

/**
 * Get token balance using kit's RPC.
 * We pass the provider's connection for balance checks to ensure consistent
 * commitment level with Anchor transactions.
 * NOTE: This is a function that gets set in the describe block after provider is available.
 */
let getTokenBalance: (ata: Address) => Promise<bigint>;

/** Send a kit transaction with the given signers and instructions */
async function sendKitTx(
  feePayer: KeyPairSigner,
  instructions: any[],
  signers?: KeyPairSigner[]
): Promise<void> {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const txMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayer(feePayer.address, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions(instructions, tx),
  );
  const signed = await signTransactionMessageWithSigners(txMessage);
  await sendAndConfirm(signed as any, { commitment: "confirmed" });
}

/**
 * Create a mint using kit instructions (replaces @solana/spl-token's createMint).
 * Returns the mint's Address and KeyPairSigner.
 */
async function createMintKit(
  payer: KeyPairSigner,
  decimals: number
): Promise<{ mintAddress: Address; mintSigner: KeyPairSigner }> {
  const mintSigner = await generateKeyPairSigner();
  const mintSpace = BigInt(getMintSize());
  const mintRent = await rpc
    .getMinimumBalanceForRentExemption(mintSpace)
    .send();

  await sendKitTx(payer, [
    getCreateAccountInstruction({
      payer,
      newAccount: mintSigner,
      lamports: lamports(mintRent),
      space: mintSpace,
      programAddress: TOKEN_PROGRAM_ADDRESS,
    }),
    getInitializeMintInstruction({
      mint: mintSigner.address,
      decimals,
      mintAuthority: payer.address,
    }),
  ]);

  return { mintAddress: mintSigner.address, mintSigner };
}

/**
 * Create an ATA and mint tokens into it using kit instructions.
 * (Replaces createAssociatedTokenAccount + mintTo from @solana/spl-token)
 */
async function createAtaAndMint(
  payer: KeyPairSigner,
  mint: Address,
  owner: Address,
  amount: bigint
): Promise<Address> {
  const ata = await findAta(mint, owner);

  await sendKitTx(payer, [
    getCreateAssociatedTokenIdempotentInstruction({
      mint,
      payer,
      owner,
      ata,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    }),
    getMintToInstruction({
      mint,
      token: ata,
      mintAuthority: payer,
      amount,
    }),
  ]);

  return ata;
}

/** Transfer SOL using kit (replaces SystemProgram.transfer from web3.js) */
async function transferSol(
  from: KeyPairSigner,
  to: Address,
  sol: number
): Promise<void> {
  const amt = lamports(BigInt(Math.floor(sol * 1_000_000_000)));
  await sendKitTx(from, [
    getTransferSolInstruction({ source: from, destination: to, amount: amt }),
  ]);
}

// ─── Anchor account builder helpers (same shape, but derived with kit) ────────

function createTransferAccounts(
  sender: Address,
  poolPda: Address,
  mint: Address,
  transferPda: Address,
  senderAta: Address,
  poolAta: Address
) {
  return {
    sender: toPubkey(sender),
    pool: toPubkey(poolPda),
    mint: toPubkey(mint),
    poolTokenAccount: toPubkey(poolAta),
    senderTokenAccount: toPubkey(senderAta),
    transfer: toPubkey(transferPda),
    tokenProgram: toPubkey(TOKEN_PROGRAM_ADDRESS),
    systemProgram: toPubkey(SYSTEM_PROGRAM_ADDRESS),
    associatedTokenProgram: toPubkey(ASSOCIATED_TOKEN_PROGRAM_ADDRESS),
  };
}

function cancelTransferAccounts(
  sender: Address,
  poolPda: Address,
  mint: Address,
  transferPda: Address,
  senderAta: Address,
  poolAta: Address
) {
  return {
    sender: toPubkey(sender),
    pool: toPubkey(poolPda),
    mint: toPubkey(mint),
    poolTokenAccount: toPubkey(poolAta),
    senderTokenAccount: toPubkey(senderAta),
    transfer: toPubkey(transferPda),
    tokenProgram: toPubkey(TOKEN_PROGRAM_ADDRESS),
  };
}

function claimTransferAccounts(
  recipient: Address,
  sender: Address,
  poolPda: Address,
  mint: Address,
  transferPda: Address,
  recipientAta: Address,
  poolAta: Address
) {
  return {
    recipient: toPubkey(recipient),
    pool: toPubkey(poolPda),
    mint: toPubkey(mint),
    poolTokenAccount: toPubkey(poolAta),
    recipientTokenAccount: toPubkey(recipientAta),
    transfer: toPubkey(transferPda),
    sender: toPubkey(sender),
    tokenProgram: toPubkey(TOKEN_PROGRAM_ADDRESS),
  };
}

function rejectTransferAccounts(
  operator: Address,
  sender: Address,
  poolPda: Address,
  mint: Address,
  transferPda: Address,
  senderAta: Address,
  poolAta: Address
) {
  return {
    operator: toPubkey(operator),
    pool: toPubkey(poolPda),
    mint: toPubkey(mint),
    poolTokenAccount: toPubkey(poolAta),
    senderTokenAccount: toPubkey(senderAta),
    transfer: toPubkey(transferPda),
    sender: toPubkey(sender),
    tokenProgram: toPubkey(TOKEN_PROGRAM_ADDRESS),
  };
}

function declineTransferAccounts(
  recipient: Address,
  sender: Address,
  poolPda: Address,
  mint: Address,
  transferPda: Address,
  senderAta: Address,
  poolAta: Address
) {
  return {
    recipient: toPubkey(recipient),
    pool: toPubkey(poolPda),
    mint: toPubkey(mint),
    poolTokenAccount: toPubkey(poolAta),
    senderTokenAccount: toPubkey(senderAta),
    transfer: toPubkey(transferPda),
    sender: toPubkey(sender),
    tokenProgram: toPubkey(TOKEN_PROGRAM_ADDRESS),
  };
}

function expireTransferAccounts(
  caller: Address,
  sender: Address,
  poolPda: Address,
  mint: Address,
  transferPda: Address,
  senderAta: Address,
  poolAta: Address
) {
  return {
    caller: toPubkey(caller),
    pool: toPubkey(poolPda),
    mint: toPubkey(mint),
    poolTokenAccount: toPubkey(poolAta),
    senderTokenAccount: toPubkey(senderAta),
    transfer: toPubkey(transferPda),
    sender: toPubkey(sender),
    tokenProgram: toPubkey(TOKEN_PROGRAM_ADDRESS),
  };
}

function destroyTransferAccounts(
  operator: Address,
  poolPda: Address,
  mint: Address,
  transferPda: Address,
  operatorAta: Address,
  poolAta: Address
) {
  return {
    operator: toPubkey(operator),
    pool: toPubkey(poolPda),
    mint: toPubkey(mint),
    poolTokenAccount: toPubkey(poolAta),
    operatorTokenAccount: toPubkey(operatorAta),
    transfer: toPubkey(transferPda),
    tokenProgram: toPubkey(TOKEN_PROGRAM_ADDRESS),
  };
}

// ─── Nonce counter ────────────────────────────────────────────────────────────

let nonceCounter = 1;
function nextNonce(): BN {
  return new BN(Date.now() + nonceCounter++);
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe("handshake (kit)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.handshake as Program<Handshake>;
  const programId: Address = toAddress(program.programId);
  const operator: Address = toAddress(provider.wallet.publicKey);
  const { connection } = provider;
  const payerLegacyKeypair = (provider.wallet as any).payer as LegacyKeypair;

  // Use provider's connection for balance queries (same commitment as Anchor txs)
  getTokenBalance = async (ata: Address): Promise<bigint> => {
    const info = await connection.getTokenAccountBalance(toPubkey(ata));
    return BigInt(info.value.amount);
  };

  // We need a kit KeyPairSigner for the payer to use in kit transactions.
  // We'll derive it from the legacy keypair's secret key in before().
  let payer: KeyPairSigner;

  // Test actors — generated with kit's async generateKeyPairSigner()
  let sender: KeyPairSigner;
  let recipient: KeyPairSigner;
  let thirdParty: KeyPairSigner;

  // Legacy keypairs for Anchor .signers([]) calls
  let senderLegacy: LegacyKeypair;
  let recipientLegacy: LegacyKeypair;
  let thirdPartyLegacy: LegacyKeypair;

  // Token mint (kit Address)
  let mint: Address;

  // Pool variables (kit Addresses)
  let zeroFeePoolId: Address;
  let zeroFeePoolPda: Address;
  let zeroFeePoolBump: number;

  let feePoolId: Address;
  let feePoolPda: Address;
  let feePoolBump: number;
  const FEE_BPS = 250; // 2.5%

  // Pre-computed ATAs
  let senderAta: Address;
  let recipientAta: Address;
  let operatorAta: Address;
  let thirdPartyAta: Address;
  let zeroFeePoolAta: Address;
  let feePoolAta: Address;

  before(async () => {
    // ── Generate dual keypairs (kit KeyPairSigner + legacy Keypair from same seed) ──
    ({ signer: sender, legacy: senderLegacy } = await generateDualKeypair());
    ({ signer: recipient, legacy: recipientLegacy } = await generateDualKeypair());
    ({ signer: thirdParty, legacy: thirdPartyLegacy } = await generateDualKeypair());

    // Create a kit KeyPairSigner from the Anchor provider's payer secret key.
    // createKeyPairSignerFromBytes expects the full 64-byte secret key (seed + pubkey).
    const { createKeyPairSignerFromBytes } = await import("@solana/kit");
    payer = await createKeyPairSignerFromBytes(
      new Uint8Array(payerLegacyKeypair.secretKey)
    );

    // ── Fund actors with SOL using kit ──
    for (const actor of [sender, recipient, thirdParty]) {
      await transferSol(payer, actor.address, 0.05);
    }

    // ── Create test USDC mint (6 decimals) using kit ──
    const { mintAddress } = await createMintKit(payer, 6);
    mint = mintAddress;

    // ── Create ATAs and mint tokens using kit ──
    const actors = [
      { addr: operator, amount: 1_000_000n * 1_000_000n },
      { addr: sender.address, amount: 100_000n * 1_000_000n },
      { addr: recipient.address, amount: 10_000n * 1_000_000n },
      { addr: thirdParty.address, amount: 5_000n * 1_000_000n },
    ];

    for (const actor of actors) {
      await createAtaAndMint(payer, mint, actor.addr, actor.amount);
    }

    // ── Derive pool PDAs using kit's async getProgramDerivedAddress ──
    const poolId1Signer = await generateKeyPairSigner();
    zeroFeePoolId = poolId1Signer.address;
    [zeroFeePoolPda, zeroFeePoolBump] = await findPoolPda(programId, zeroFeePoolId);

    const poolId2Signer = await generateKeyPairSigner();
    feePoolId = poolId2Signer.address;
    [feePoolPda, feePoolBump] = await findPoolPda(programId, feePoolId);

    // ── Pre-compute ATAs ──
    senderAta = await findAta(mint, sender.address);
    recipientAta = await findAta(mint, recipient.address);
    operatorAta = await findAta(mint, operator);
    thirdPartyAta = await findAta(mint, thirdParty.address);
    zeroFeePoolAta = await findAta(mint, zeroFeePoolPda);
    feePoolAta = await findAta(mint, feePoolPda);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Group A: Pool Setup
  // ═══════════════════════════════════════════════════════════════════════════

  describe("A. Pool Initialization", () => {
    it("A1. initializes a pool with 0% fee", async () => {
      await program.methods
        .initPool(toPubkey(zeroFeePoolId), 0)
        .accounts({
          operator: toPubkey(operator),
          mint: toPubkey(mint),
          pool: toPubkey(zeroFeePoolPda),
          poolTokenAccount: toPubkey(zeroFeePoolAta),
          tokenProgram: toPubkey(TOKEN_PROGRAM_ADDRESS),
          associatedTokenProgram: toPubkey(ASSOCIATED_TOKEN_PROGRAM_ADDRESS),
          systemProgram: toPubkey(SYSTEM_PROGRAM_ADDRESS),
          rent: toPubkey(RENT_SYSVAR_ADDRESS),
        })
        .rpc();

      const pool = await program.account.pool.fetch(toPubkey(zeroFeePoolPda));
      assert.equal(pool.version, 1);
      assert.equal(pool.bump, zeroFeePoolBump);
      assert.equal(pool.poolId.toString(), toPubkey(zeroFeePoolId).toString());
      assert.equal(pool.operator.toString(), toPubkey(operator).toString());
      assert.equal(pool.mint.toString(), toPubkey(mint).toString());
      assert.equal(pool.transferFeeBps, 0);
      assert.equal(pool.totalDeposits.toNumber(), 0);
      assert.equal(pool.totalWithdrawals.toNumber(), 0);
      assert.equal(pool.totalEscrowed.toNumber(), 0);
      assert.equal(pool.totalTransfersCreated.toNumber(), 0);
      assert.equal(pool.totalTransfersResolved.toNumber(), 0);
      assert.equal(pool.collectedFees.toNumber(), 0);
      assert.equal(pool.isPaused, false);
    });

    it("A2. initializes a pool with 2.5% fee (250 bps)", async () => {
      await program.methods
        .initPool(toPubkey(feePoolId), FEE_BPS)
        .accounts({
          operator: toPubkey(operator),
          mint: toPubkey(mint),
          pool: toPubkey(feePoolPda),
          poolTokenAccount: toPubkey(feePoolAta),
          tokenProgram: toPubkey(TOKEN_PROGRAM_ADDRESS),
          associatedTokenProgram: toPubkey(ASSOCIATED_TOKEN_PROGRAM_ADDRESS),
          systemProgram: toPubkey(SYSTEM_PROGRAM_ADDRESS),
          rent: toPubkey(RENT_SYSVAR_ADDRESS),
        })
        .rpc();

      const pool = await program.account.pool.fetch(toPubkey(feePoolPda));
      assert.equal(pool.transferFeeBps, FEE_BPS);
      assert.equal(pool.isPaused, false);
    });

    it("A3. fails to init pool with fee > 10000 bps", async () => {
      const badPoolSigner = await generateKeyPairSigner();
      const badPoolId = badPoolSigner.address;
      const [badPoolPda] = await findPoolPda(programId, badPoolId);
      const badPoolAta = await findAta(mint, badPoolPda);

      try {
        await program.methods
          .initPool(toPubkey(badPoolId), 10001)
          .accounts({
            operator: toPubkey(operator),
            mint: toPubkey(mint),
            pool: toPubkey(badPoolPda),
            poolTokenAccount: toPubkey(badPoolAta),
            tokenProgram: toPubkey(TOKEN_PROGRAM_ADDRESS),
            associatedTokenProgram: toPubkey(ASSOCIATED_TOKEN_PROGRAM_ADDRESS),
            systemProgram: toPubkey(SYSTEM_PROGRAM_ADDRESS),
            rent: toPubkey(RENT_SYSVAR_ADDRESS),
          })
          .rpc();
        assert.fail("Should have failed with invalid fee");
      } catch (err: any) {
        assert.include(err.toString(), "InvalidTransferFee");
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Group B: Transfer Lifecycle (0% fee pool)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("B. Transfer Lifecycle (0% fee pool)", () => {
    const TRANSFER_AMOUNT = new BN(1000 * 1_000_000);

    it("B1. creates a transfer and sender cancels (full refund, no fee)", async () => {
      const nonce = nextNonce();
      const [transferPda] = await findTransferPda(programId, sender.address, recipient.address, nonce);

      const senderBalBefore = await getTokenBalance(senderAta);
      const poolBalBefore = await getTokenBalance(zeroFeePoolAta);

      // Create
      await program.methods
        .createTransfer(
          toPubkey(recipient.address),
          nonce,
          TRANSFER_AMOUNT,
          "test cancel",
          new BN(0),
          new BN(0)
        )
        .accounts(createTransferAccounts(sender.address, zeroFeePoolPda, mint, transferPda, senderAta, zeroFeePoolAta))
        .signers([senderLegacy])
        .rpc();

      // Verify escrow account
      const escrow = await program.account.secureTransfer.fetch(toPubkey(transferPda));
      assert.equal(escrow.sender.toString(), toPubkey(sender.address).toString());
      assert.equal(escrow.recipient.toString(), toPubkey(recipient.address).toString());
      assert.equal(escrow.pool.toString(), toPubkey(zeroFeePoolPda).toString());
      assert.equal(escrow.amount.toString(), TRANSFER_AMOUNT.toString());
      assert.deepEqual(escrow.status, { active: {} });
      assert.equal(escrow.claimableAfter.toNumber(), 0);
      assert.equal(escrow.claimableUntil.toNumber(), 0);

      // Verify pool accounting after create
      let pool = await program.account.pool.fetch(toPubkey(zeroFeePoolPda));
      assert.equal(pool.totalDeposits.toString(), TRANSFER_AMOUNT.toString());
      assert.equal(pool.totalEscrowed.toString(), TRANSFER_AMOUNT.toString());
      assert.equal(pool.totalTransfersCreated.toNumber(), 1);

      // Cancel
      await program.methods
        .cancelTransfer()
        .accounts(cancelTransferAccounts(sender.address, zeroFeePoolPda, mint, transferPda, senderAta, zeroFeePoolAta))
        .signers([senderLegacy])
        .rpc();

      // Transfer account should be closed
      const closed = await provider.connection.getAccountInfo(toPubkey(transferPda));
      assert.isNull(closed);

      // Sender gets full refund
      const senderBalAfter = await getTokenBalance(senderAta);
      assert.equal(senderBalAfter.toString(), senderBalBefore.toString());

      // Pool balance back to where it was
      const poolBalAfter = await getTokenBalance(zeroFeePoolAta);
      assert.equal(poolBalAfter.toString(), poolBalBefore.toString());

      // Pool accounting
      pool = await program.account.pool.fetch(toPubkey(zeroFeePoolPda));
      assert.equal(pool.totalTransfersResolved.toNumber(), 1);
      assert.equal(pool.totalEscrowed.toNumber(), 0);
    });

    it("B2. fails when non-sender tries to cancel", async () => {
      const nonce = nextNonce();
      const [transferPda] = await findTransferPda(programId, sender.address, recipient.address, nonce);

      await program.methods
        .createTransfer(toPubkey(recipient.address), nonce, TRANSFER_AMOUNT, "auth test", new BN(0), new BN(0))
        .accounts(createTransferAccounts(sender.address, zeroFeePoolPda, mint, transferPda, senderAta, zeroFeePoolAta))
        .signers([senderLegacy])
        .rpc();

      try {
        await program.methods
          .cancelTransfer()
          .accounts(cancelTransferAccounts(recipient.address, zeroFeePoolPda, mint, transferPda, recipientAta, zeroFeePoolAta))
          .signers([recipientLegacy])
          .rpc();
        assert.fail("Non-sender should not be able to cancel");
      } catch (err: any) {
        assert.ok(err);
      }

      // Cleanup
      await program.methods
        .cancelTransfer()
        .accounts(cancelTransferAccounts(sender.address, zeroFeePoolPda, mint, transferPda, senderAta, zeroFeePoolAta))
        .signers([senderLegacy])
        .rpc();
    });

    it("B3. expires a transfer past claimable_until (permissionless, full refund)", async () => {
      const nonce = nextNonce();
      const [transferPda] = await findTransferPda(programId, sender.address, recipient.address, nonce);

      const now = Math.floor(Date.now() / 1000);
      const claimableUntil = new BN(now + 3);

      const senderBalBefore = await getTokenBalance(senderAta);

      await program.methods
        .createTransfer(toPubkey(recipient.address), nonce, TRANSFER_AMOUNT, "expire test", new BN(0), claimableUntil)
        .accounts(createTransferAccounts(sender.address, zeroFeePoolPda, mint, transferPda, senderAta, zeroFeePoolAta))
        .signers([senderLegacy])
        .rpc();

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 6000));

      // ThirdParty expires it (permissionless)
      await program.methods
        .expireTransfer()
        .accounts(expireTransferAccounts(thirdParty.address, sender.address, zeroFeePoolPda, mint, transferPda, senderAta, zeroFeePoolAta))
        .signers([thirdPartyLegacy])
        .rpc();

      const closed = await provider.connection.getAccountInfo(toPubkey(transferPda));
      assert.isNull(closed);

      const senderBalAfter = await getTokenBalance(senderAta);
      assert.equal(senderBalAfter.toString(), senderBalBefore.toString());
    });

    it("B4. fails to expire a transfer before deadline", async () => {
      const nonce = nextNonce();
      const [transferPda] = await findTransferPda(programId, sender.address, recipient.address, nonce);

      const now = Math.floor(Date.now() / 1000);
      const claimableUntil = new BN(now + 3600);

      await program.methods
        .createTransfer(toPubkey(recipient.address), nonce, TRANSFER_AMOUNT, "not expired", new BN(0), claimableUntil)
        .accounts(createTransferAccounts(sender.address, zeroFeePoolPda, mint, transferPda, senderAta, zeroFeePoolAta))
        .signers([senderLegacy])
        .rpc();

      try {
        await program.methods
          .expireTransfer()
          .accounts(expireTransferAccounts(thirdParty.address, sender.address, zeroFeePoolPda, mint, transferPda, senderAta, zeroFeePoolAta))
          .signers([thirdPartyLegacy])
          .rpc();
        assert.fail("Should not expire before deadline");
      } catch (err: any) {
        assert.include(err.toString(), "CannotClaim");
      }

      // Cleanup
      await program.methods
        .cancelTransfer()
        .accounts(cancelTransferAccounts(sender.address, zeroFeePoolPda, mint, transferPda, senderAta, zeroFeePoolAta))
        .signers([senderLegacy])
        .rpc();
    });

    it("B5. fails to expire a transfer with no deadline (claimable_until = 0)", async () => {
      const nonce = nextNonce();
      const [transferPda] = await findTransferPda(programId, sender.address, recipient.address, nonce);

      await program.methods
        .createTransfer(toPubkey(recipient.address), nonce, TRANSFER_AMOUNT, "no deadline", new BN(0), new BN(0))
        .accounts(createTransferAccounts(sender.address, zeroFeePoolPda, mint, transferPda, senderAta, zeroFeePoolAta))
        .signers([senderLegacy])
        .rpc();

      try {
        await program.methods
          .expireTransfer()
          .accounts(expireTransferAccounts(thirdParty.address, sender.address, zeroFeePoolPda, mint, transferPda, senderAta, zeroFeePoolAta))
          .signers([thirdPartyLegacy])
          .rpc();
        assert.fail("Should not expire transfer with no deadline");
      } catch (err: any) {
        assert.include(err.toString(), "InvalidTimeWindow");
      }

      // Cleanup
      await program.methods
        .cancelTransfer()
        .accounts(cancelTransferAccounts(sender.address, zeroFeePoolPda, mint, transferPda, senderAta, zeroFeePoolAta))
        .signers([senderLegacy])
        .rpc();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Group C: Transfer Lifecycle (2.5% fee pool)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("C. Transfer Lifecycle (2.5% fee pool)", () => {
    const TRANSFER_AMOUNT = new BN(10_000 * 1_000_000);
    const EXPECTED_FEE = new BN(250 * 1_000_000);
    const EXPECTED_NET = TRANSFER_AMOUNT.sub(EXPECTED_FEE);

    it("C1. recipient claims transfer (gets 97.5%, pool keeps 2.5%)", async () => {
      const nonce = nextNonce();
      const [transferPda] = await findTransferPda(programId, sender.address, recipient.address, nonce);

      const senderBalBefore = await getTokenBalance(senderAta);
      const recipientBalBefore = await getTokenBalance(recipientAta);

      // Create
      await program.methods
        .createTransfer(toPubkey(recipient.address), nonce, TRANSFER_AMOUNT, "claim test", new BN(0), new BN(0))
        .accounts(createTransferAccounts(sender.address, feePoolPda, mint, transferPda, senderAta, feePoolAta))
        .signers([senderLegacy])
        .rpc();

      let pool = await program.account.pool.fetch(toPubkey(feePoolPda));
      assert.equal(pool.totalDeposits.toString(), TRANSFER_AMOUNT.toString());
      assert.equal(pool.totalEscrowed.toString(), TRANSFER_AMOUNT.toString());

      // Claim
      await program.methods
        .claimTransfer()
        .accounts(claimTransferAccounts(recipient.address, sender.address, feePoolPda, mint, transferPda, recipientAta, feePoolAta))
        .signers([recipientLegacy])
        .rpc();

      const closed = await provider.connection.getAccountInfo(toPubkey(transferPda));
      assert.isNull(closed);

      const recipientBalAfter = await getTokenBalance(recipientAta);
      assert.equal(
        (recipientBalAfter - recipientBalBefore).toString(),
        EXPECTED_NET.toString(),
        "Recipient should receive amount minus fee"
      );

      pool = await program.account.pool.fetch(toPubkey(feePoolPda));
      assert.equal(pool.totalTransfersCreated.toNumber(), 1);
      assert.equal(pool.totalTransfersResolved.toNumber(), 1);
      assert.equal(pool.collectedFees.toString(), EXPECTED_FEE.toString());
      assert.equal(pool.totalEscrowed.toNumber(), 0);

      const senderBalAfter = await getTokenBalance(senderAta);
      assert.equal(
        (senderBalBefore - senderBalAfter).toString(),
        TRANSFER_AMOUNT.toString()
      );
    });

    it("C2. fails when non-recipient tries to claim", async () => {
      const nonce = nextNonce();
      const [transferPda] = await findTransferPda(programId, sender.address, recipient.address, nonce);

      await program.methods
        .createTransfer(toPubkey(recipient.address), nonce, TRANSFER_AMOUNT, "auth claim", new BN(0), new BN(0))
        .accounts(createTransferAccounts(sender.address, feePoolPda, mint, transferPda, senderAta, feePoolAta))
        .signers([senderLegacy])
        .rpc();

      try {
        await program.methods
          .claimTransfer()
          .accounts(claimTransferAccounts(thirdParty.address, sender.address, feePoolPda, mint, transferPda, thirdPartyAta, feePoolAta))
          .signers([thirdPartyLegacy])
          .rpc();
        assert.fail("Non-recipient should not be able to claim");
      } catch (err: any) {
        assert.ok(err);
      }

      // Cleanup
      await program.methods
        .cancelTransfer()
        .accounts(cancelTransferAccounts(sender.address, feePoolPda, mint, transferPda, senderAta, feePoolAta))
        .signers([senderLegacy])
        .rpc();
    });

    it("C3. fails to claim before claimable_after window", async () => {
      const nonce = nextNonce();
      const [transferPda] = await findTransferPda(programId, sender.address, recipient.address, nonce);

      const now = Math.floor(Date.now() / 1000);
      const claimableAfter = new BN(now + 3600);
      const claimableUntil = new BN(now + 7200);

      await program.methods
        .createTransfer(toPubkey(recipient.address), nonce, TRANSFER_AMOUNT, "early claim", claimableAfter, claimableUntil)
        .accounts(createTransferAccounts(sender.address, feePoolPda, mint, transferPda, senderAta, feePoolAta))
        .signers([senderLegacy])
        .rpc();

      try {
        await program.methods
          .claimTransfer()
          .accounts(claimTransferAccounts(recipient.address, sender.address, feePoolPda, mint, transferPda, recipientAta, feePoolAta))
          .signers([recipientLegacy])
          .rpc();
        assert.fail("Should not claim before claimable_after");
      } catch (err: any) {
        assert.include(err.toString(), "CannotClaim");
      }

      // Cleanup
      await program.methods
        .cancelTransfer()
        .accounts(cancelTransferAccounts(sender.address, feePoolPda, mint, transferPda, senderAta, feePoolAta))
        .signers([senderLegacy])
        .rpc();
    });

    it("C4. operator rejects transfer (sender gets full refund, no fee)", async () => {
      const nonce = nextNonce();
      const [transferPda] = await findTransferPda(programId, sender.address, recipient.address, nonce);

      const senderBalBefore = await getTokenBalance(senderAta);
      const poolFeesBefore = (await program.account.pool.fetch(toPubkey(feePoolPda))).collectedFees;

      await program.methods
        .createTransfer(toPubkey(recipient.address), nonce, TRANSFER_AMOUNT, "reject test", new BN(0), new BN(0))
        .accounts(createTransferAccounts(sender.address, feePoolPda, mint, transferPda, senderAta, feePoolAta))
        .signers([senderLegacy])
        .rpc();

      await program.methods
        .rejectTransfer(1)
        .accounts(rejectTransferAccounts(operator, sender.address, feePoolPda, mint, transferPda, senderAta, feePoolAta))
        .rpc();

      const closed = await provider.connection.getAccountInfo(toPubkey(transferPda));
      assert.isNull(closed);

      const senderBalAfter = await getTokenBalance(senderAta);
      assert.equal(senderBalAfter.toString(), senderBalBefore.toString(), "Sender should get full refund");

      const pool = await program.account.pool.fetch(toPubkey(feePoolPda));
      assert.equal(pool.collectedFees.toString(), poolFeesBefore.toString(), "No fees collected on rejection");
    });

    it("C5. fails when non-operator tries to reject", async () => {
      const nonce = nextNonce();
      const [transferPda] = await findTransferPda(programId, sender.address, recipient.address, nonce);

      await program.methods
        .createTransfer(toPubkey(recipient.address), nonce, TRANSFER_AMOUNT, "auth reject", new BN(0), new BN(0))
        .accounts(createTransferAccounts(sender.address, feePoolPda, mint, transferPda, senderAta, feePoolAta))
        .signers([senderLegacy])
        .rpc();

      try {
        await program.methods
          .rejectTransfer(1)
          .accounts(rejectTransferAccounts(sender.address, sender.address, feePoolPda, mint, transferPda, senderAta, feePoolAta))
          .signers([senderLegacy])
          .rpc();
        assert.fail("Non-operator should not be able to reject");
      } catch (err: any) {
        assert.ok(err);
      }

      // Cleanup
      await program.methods
        .cancelTransfer()
        .accounts(cancelTransferAccounts(sender.address, feePoolPda, mint, transferPda, senderAta, feePoolAta))
        .signers([senderLegacy])
        .rpc();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Group C2: Decline Transfer (receiver rejects)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("C2. Decline Transfer (receiver rejects)", () => {
    const TRANSFER_AMOUNT = new BN(10_000 * 1_000_000);

    it("C2a. recipient declines transfer (sender gets full refund)", async () => {
      const nonce = nextNonce();
      const [transferPda] = await findTransferPda(programId, sender.address, recipient.address, nonce);

      const senderBalBefore = await getTokenBalance(senderAta);
      const poolFeesBefore = (await program.account.pool.fetch(toPubkey(feePoolPda))).collectedFees;

      await program.methods
        .createTransfer(toPubkey(recipient.address), nonce, TRANSFER_AMOUNT, "decline test", new BN(0), new BN(0))
        .accounts(createTransferAccounts(sender.address, feePoolPda, mint, transferPda, senderAta, feePoolAta))
        .signers([senderLegacy])
        .rpc();

      await program.methods
        .declineTransfer(1)
        .accounts(declineTransferAccounts(recipient.address, sender.address, feePoolPda, mint, transferPda, senderAta, feePoolAta))
        .signers([recipientLegacy])
        .rpc();

      const closed = await provider.connection.getAccountInfo(toPubkey(transferPda));
      assert.isNull(closed);

      const senderBalAfter = await getTokenBalance(senderAta);
      assert.equal(senderBalAfter.toString(), senderBalBefore.toString(), "Sender should get full refund on decline");

      const pool = await program.account.pool.fetch(toPubkey(feePoolPda));
      assert.equal(pool.collectedFees.toString(), poolFeesBefore.toString(), "No fees collected on decline");
    });

    it("C2b. recipient declines with no reason (reason = null)", async () => {
      const nonce = nextNonce();
      const [transferPda] = await findTransferPda(programId, sender.address, recipient.address, nonce);

      const senderBalBefore = await getTokenBalance(senderAta);

      await program.methods
        .createTransfer(toPubkey(recipient.address), nonce, TRANSFER_AMOUNT, "no reason", new BN(0), new BN(0))
        .accounts(createTransferAccounts(sender.address, feePoolPda, mint, transferPda, senderAta, feePoolAta))
        .signers([senderLegacy])
        .rpc();

      await program.methods
        .declineTransfer(null)
        .accounts(declineTransferAccounts(recipient.address, sender.address, feePoolPda, mint, transferPda, senderAta, feePoolAta))
        .signers([recipientLegacy])
        .rpc();

      const closed = await provider.connection.getAccountInfo(toPubkey(transferPda));
      assert.isNull(closed);

      const senderBalAfter = await getTokenBalance(senderAta);
      assert.equal(senderBalAfter.toString(), senderBalBefore.toString(), "Sender should get full refund");
    });

    it("C2c. fails when non-recipient tries to decline", async () => {
      const nonce = nextNonce();
      const [transferPda] = await findTransferPda(programId, sender.address, recipient.address, nonce);

      await program.methods
        .createTransfer(toPubkey(recipient.address), nonce, TRANSFER_AMOUNT, "auth decline", new BN(0), new BN(0))
        .accounts(createTransferAccounts(sender.address, feePoolPda, mint, transferPda, senderAta, feePoolAta))
        .signers([senderLegacy])
        .rpc();

      try {
        await program.methods
          .declineTransfer(null)
          .accounts(declineTransferAccounts(thirdParty.address, sender.address, feePoolPda, mint, transferPda, senderAta, feePoolAta))
          .signers([thirdPartyLegacy])
          .rpc();
        assert.fail("Non-recipient should not be able to decline");
      } catch (err: any) {
        assert.ok(err);
      }

      // Cleanup
      await program.methods
        .cancelTransfer()
        .accounts(cancelTransferAccounts(sender.address, feePoolPda, mint, transferPda, senderAta, feePoolAta))
        .signers([senderLegacy])
        .rpc();
    });

    it("C2d. fails to decline an already cancelled transfer", async () => {
      const nonce = nextNonce();
      const [transferPda] = await findTransferPda(programId, sender.address, recipient.address, nonce);

      await program.methods
        .createTransfer(toPubkey(recipient.address), nonce, TRANSFER_AMOUNT, "cancel first", new BN(0), new BN(0))
        .accounts(createTransferAccounts(sender.address, feePoolPda, mint, transferPda, senderAta, feePoolAta))
        .signers([senderLegacy])
        .rpc();

      await program.methods
        .cancelTransfer()
        .accounts(cancelTransferAccounts(sender.address, feePoolPda, mint, transferPda, senderAta, feePoolAta))
        .signers([senderLegacy])
        .rpc();

      try {
        await program.methods
          .declineTransfer(null)
          .accounts(declineTransferAccounts(recipient.address, sender.address, feePoolPda, mint, transferPda, senderAta, feePoolAta))
          .signers([recipientLegacy])
          .rpc();
        assert.fail("Should not be able to decline a cancelled transfer");
      } catch (err: any) {
        assert.ok(err);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Group D: Input Validation
  // ═══════════════════════════════════════════════════════════════════════════

  describe("D. Input Validation", () => {
    it("D1. fails to create transfer with amount = 0", async () => {
      const nonce = nextNonce();
      const [transferPda] = await findTransferPda(programId, sender.address, recipient.address, nonce);

      try {
        await program.methods
          .createTransfer(toPubkey(recipient.address), nonce, new BN(0), "zero amount", new BN(0), new BN(0))
          .accounts(createTransferAccounts(sender.address, zeroFeePoolPda, mint, transferPda, senderAta, zeroFeePoolAta))
          .signers([senderLegacy])
          .rpc();
        assert.fail("Should fail with zero amount");
      } catch (err: any) {
        assert.include(err.toString(), "DepositTooSmall");
      }
    });

    it("D2. fails to create transfer with memo > 64 bytes", async () => {
      const nonce = nextNonce();
      const [transferPda] = await findTransferPda(programId, sender.address, recipient.address, nonce);

      const longMemo = "x".repeat(65);
      try {
        await program.methods
          .createTransfer(toPubkey(recipient.address), nonce, new BN(1_000_000), longMemo, new BN(0), new BN(0))
          .accounts(createTransferAccounts(sender.address, zeroFeePoolPda, mint, transferPda, senderAta, zeroFeePoolAta))
          .signers([senderLegacy])
          .rpc();
        assert.fail("Should fail with long memo");
      } catch (err: any) {
        assert.include(err.toString(), "InvalidMemoLength");
      }
    });

    it("D3. fails to create transfer when pool is paused", async () => {
      await program.methods
        .pausePool(true)
        .accounts({ operator: toPubkey(operator), pool: toPubkey(zeroFeePoolPda) })
        .rpc();

      const nonce = nextNonce();
      const [transferPda] = await findTransferPda(programId, sender.address, recipient.address, nonce);

      try {
        await program.methods
          .createTransfer(toPubkey(recipient.address), nonce, new BN(1_000_000), "paused", new BN(0), new BN(0))
          .accounts(createTransferAccounts(sender.address, zeroFeePoolPda, mint, transferPda, senderAta, zeroFeePoolAta))
          .signers([senderLegacy])
          .rpc();
        assert.fail("Should fail when pool is paused");
      } catch (err: any) {
        assert.include(err.toString(), "PoolPaused");
      }

      // Unpause
      await program.methods
        .pausePool(false)
        .accounts({ operator: toPubkey(operator), pool: toPubkey(zeroFeePoolPda) })
        .rpc();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Group E: Fee Withdrawal
  // ═══════════════════════════════════════════════════════════════════════════

  describe("E. Fee Withdrawal", () => {
    it("E1. operator withdraws collected fees", async () => {
      const pool = await program.account.pool.fetch(toPubkey(feePoolPda));
      const feeAmount = pool.collectedFees;
      assert.isTrue(feeAmount.gt(new BN(0)), "Should have collected fees from Group C");

      const operatorBalBefore = await getTokenBalance(operatorAta);

      await program.methods
        .withdrawFees()
        .accounts({
          operator: toPubkey(operator),
          pool: toPubkey(feePoolPda),
          mint: toPubkey(mint),
          poolTokenAccount: toPubkey(feePoolAta),
          operatorTokenAccount: toPubkey(operatorAta),
          tokenProgram: toPubkey(TOKEN_PROGRAM_ADDRESS),
        })
        .rpc();

      const operatorBalAfter = await getTokenBalance(operatorAta);
      assert.equal(
        (operatorBalAfter - operatorBalBefore).toString(),
        feeAmount.toString()
      );

      const poolAfter = await program.account.pool.fetch(toPubkey(feePoolPda));
      assert.equal(poolAfter.collectedFees.toNumber(), 0);
    });

    it("E2. fails when non-operator tries to withdraw fees", async () => {
      const nonce = nextNonce();
      const [transferPda] = await findTransferPda(programId, sender.address, recipient.address, nonce);
      const amount = new BN(1000 * 1_000_000);

      await program.methods
        .createTransfer(toPubkey(recipient.address), nonce, amount, "fee gen", new BN(0), new BN(0))
        .accounts(createTransferAccounts(sender.address, feePoolPda, mint, transferPda, senderAta, feePoolAta))
        .signers([senderLegacy])
        .rpc();

      await program.methods
        .claimTransfer()
        .accounts(claimTransferAccounts(recipient.address, sender.address, feePoolPda, mint, transferPda, recipientAta, feePoolAta))
        .signers([recipientLegacy])
        .rpc();

      try {
        await program.methods
          .withdrawFees()
          .accounts({
            operator: toPubkey(sender.address),
            pool: toPubkey(feePoolPda),
            mint: toPubkey(mint),
            poolTokenAccount: toPubkey(feePoolAta),
            operatorTokenAccount: toPubkey(senderAta),
            tokenProgram: toPubkey(TOKEN_PROGRAM_ADDRESS),
          })
          .signers([senderLegacy])
          .rpc();
        assert.fail("Non-operator should not be able to withdraw fees");
      } catch (err: any) {
        assert.ok(err);
      }

      // Cleanup
      await program.methods
        .withdrawFees()
        .accounts({
          operator: toPubkey(operator),
          pool: toPubkey(feePoolPda),
          mint: toPubkey(mint),
          poolTokenAccount: toPubkey(feePoolAta),
          operatorTokenAccount: toPubkey(operatorAta),
          tokenProgram: toPubkey(TOKEN_PROGRAM_ADDRESS),
        })
        .rpc();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Group F: Emergency (Destroy Transfer)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("F. Destroy Transfer (Emergency)", () => {
    const TRANSFER_AMOUNT = new BN(500 * 1_000_000);

    it("F1. operator destroys transfer when pool is paused (funds to operator)", async () => {
      const nonce = nextNonce();
      const [transferPda] = await findTransferPda(programId, sender.address, recipient.address, nonce);

      await program.methods
        .createTransfer(toPubkey(recipient.address), nonce, TRANSFER_AMOUNT, "destroy test", new BN(0), new BN(0))
        .accounts(createTransferAccounts(sender.address, zeroFeePoolPda, mint, transferPda, senderAta, zeroFeePoolAta))
        .signers([senderLegacy])
        .rpc();

      await program.methods
        .pausePool(true)
        .accounts({ operator: toPubkey(operator), pool: toPubkey(zeroFeePoolPda) })
        .rpc();

      const operatorBalBefore = await getTokenBalance(operatorAta);

      await program.methods
        .destroyTransfer()
        .accounts(destroyTransferAccounts(operator, zeroFeePoolPda, mint, transferPda, operatorAta, zeroFeePoolAta))
        .rpc();

      const closed = await provider.connection.getAccountInfo(toPubkey(transferPda));
      assert.isNull(closed);

      const operatorBalAfter = await getTokenBalance(operatorAta);
      assert.equal(
        (operatorBalAfter - operatorBalBefore).toString(),
        TRANSFER_AMOUNT.toString()
      );

      await program.methods
        .pausePool(false)
        .accounts({ operator: toPubkey(operator), pool: toPubkey(zeroFeePoolPda) })
        .rpc();
    });

    it("F2. fails to destroy when pool is NOT paused", async () => {
      const nonce = nextNonce();
      const [transferPda] = await findTransferPda(programId, sender.address, recipient.address, nonce);

      await program.methods
        .createTransfer(toPubkey(recipient.address), nonce, TRANSFER_AMOUNT, "not paused", new BN(0), new BN(0))
        .accounts(createTransferAccounts(sender.address, zeroFeePoolPda, mint, transferPda, senderAta, zeroFeePoolAta))
        .signers([senderLegacy])
        .rpc();

      try {
        await program.methods
          .destroyTransfer()
          .accounts(destroyTransferAccounts(operator, zeroFeePoolPda, mint, transferPda, operatorAta, zeroFeePoolAta))
          .rpc();
        assert.fail("Should fail when pool is not paused");
      } catch (err: any) {
        assert.include(err.toString(), "PoolPaused");
      }

      // Cleanup
      await program.methods
        .cancelTransfer()
        .accounts(cancelTransferAccounts(sender.address, zeroFeePoolPda, mint, transferPda, senderAta, zeroFeePoolAta))
        .signers([senderLegacy])
        .rpc();
    });

    it("F3. fails when non-operator tries to destroy", async () => {
      const nonce = nextNonce();
      const [transferPda] = await findTransferPda(programId, sender.address, recipient.address, nonce);

      await program.methods
        .createTransfer(toPubkey(recipient.address), nonce, TRANSFER_AMOUNT, "auth destroy", new BN(0), new BN(0))
        .accounts(createTransferAccounts(sender.address, zeroFeePoolPda, mint, transferPda, senderAta, zeroFeePoolAta))
        .signers([senderLegacy])
        .rpc();

      await program.methods
        .pausePool(true)
        .accounts({ operator: toPubkey(operator), pool: toPubkey(zeroFeePoolPda) })
        .rpc();

      try {
        await program.methods
          .destroyTransfer()
          .accounts(destroyTransferAccounts(sender.address, zeroFeePoolPda, mint, transferPda, senderAta, zeroFeePoolAta))
          .signers([senderLegacy])
          .rpc();
        assert.fail("Non-operator should not be able to destroy");
      } catch (err: any) {
        assert.ok(err);
      }

      // Unpause and cleanup
      await program.methods
        .pausePool(false)
        .accounts({ operator: toPubkey(operator), pool: toPubkey(zeroFeePoolPda) })
        .rpc();

      await program.methods
        .cancelTransfer()
        .accounts(cancelTransferAccounts(sender.address, zeroFeePoolPda, mint, transferPda, senderAta, zeroFeePoolAta))
        .signers([senderLegacy])
        .rpc();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Group G: Pause Pool
  // ═══════════════════════════════════════════════════════════════════════════

  describe("G. Pause Pool", () => {
    it("G1. operator pauses and unpauses pool", async () => {
      await program.methods
        .pausePool(true)
        .accounts({ operator: toPubkey(operator), pool: toPubkey(zeroFeePoolPda) })
        .rpc();

      let pool = await program.account.pool.fetch(toPubkey(zeroFeePoolPda));
      assert.equal(pool.isPaused, true);

      await program.methods
        .pausePool(false)
        .accounts({ operator: toPubkey(operator), pool: toPubkey(zeroFeePoolPda) })
        .rpc();

      pool = await program.account.pool.fetch(toPubkey(zeroFeePoolPda));
      assert.equal(pool.isPaused, false);
    });

    it("G2. fails when non-operator tries to pause", async () => {
      try {
        await program.methods
          .pausePool(true)
          .accounts({ operator: toPubkey(sender.address), pool: toPubkey(zeroFeePoolPda) })
          .signers([senderLegacy])
          .rpc();
        assert.fail("Non-operator should not be able to pause");
      } catch (err: any) {
        assert.ok(err);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Group H: Reset Pool
  // ═══════════════════════════════════════════════════════════════════════════

  describe("H. Reset Pool", () => {
    it("H1. fails to reset pool with outstanding transfers", async () => {
      const nonce = nextNonce();
      const [transferPda] = await findTransferPda(programId, sender.address, recipient.address, nonce);

      await program.methods
        .createTransfer(toPubkey(recipient.address), nonce, new BN(100 * 1_000_000), "reset block", new BN(0), new BN(0))
        .accounts(createTransferAccounts(sender.address, zeroFeePoolPda, mint, transferPda, senderAta, zeroFeePoolAta))
        .signers([senderLegacy])
        .rpc();

      try {
        await program.methods
          .resetPool()
          .accounts({ operator: toPubkey(operator), pool: toPubkey(zeroFeePoolPda) })
          .rpc();
        assert.fail("Should fail with outstanding transfers");
      } catch (err: any) {
        assert.include(err.toString(), "OutstandingTransfers");
      }

      // Cleanup
      await program.methods
        .cancelTransfer()
        .accounts(cancelTransferAccounts(sender.address, zeroFeePoolPda, mint, transferPda, senderAta, zeroFeePoolAta))
        .signers([senderLegacy])
        .rpc();
    });

    it("H2. operator resets pool counters when no outstanding transfers", async () => {
      let pool = await program.account.pool.fetch(toPubkey(zeroFeePoolPda));
      assert.isTrue(
        pool.totalTransfersCreated.gt(new BN(0)),
        "Should have transfers from earlier tests"
      );

      await program.methods
        .resetPool()
        .accounts({ operator: toPubkey(operator), pool: toPubkey(zeroFeePoolPda) })
        .rpc();

      pool = await program.account.pool.fetch(toPubkey(zeroFeePoolPda));
      assert.equal(pool.totalDeposits.toNumber(), 0);
      assert.equal(pool.totalWithdrawals.toNumber(), 0);
      assert.equal(pool.totalEscrowed.toNumber(), 0);
      assert.equal(pool.totalTransfersCreated.toNumber(), 0);
      assert.equal(pool.totalTransfersResolved.toNumber(), 0);
      assert.equal(pool.collectedFees.toNumber(), 0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Group I: Close Pool
  // ═══════════════════════════════════════════════════════════════════════════

  describe("I. Close Pool", () => {
    it("I1. fails to close pool with outstanding transfers", async () => {
      const nonce = nextNonce();
      const [transferPda] = await findTransferPda(programId, sender.address, recipient.address, nonce);

      await program.methods
        .createTransfer(toPubkey(recipient.address), nonce, new BN(100 * 1_000_000), "close block", new BN(0), new BN(0))
        .accounts(createTransferAccounts(sender.address, zeroFeePoolPda, mint, transferPda, senderAta, zeroFeePoolAta))
        .signers([senderLegacy])
        .rpc();

      try {
        await program.methods
          .closePool(new BN(0))
          .accounts({
            operator: toPubkey(operator),
            pool: toPubkey(zeroFeePoolPda),
            mint: toPubkey(mint),
            poolTokenAccount: toPubkey(zeroFeePoolAta),
            operatorTokenAccount: toPubkey(operatorAta),
            tokenProgram: toPubkey(TOKEN_PROGRAM_ADDRESS),
          })
          .rpc();
        assert.fail("Should fail with outstanding transfers");
      } catch (err: any) {
        assert.include(err.toString(), "OutstandingTransfers");
      }

      // Cleanup
      await program.methods
        .cancelTransfer()
        .accounts(cancelTransferAccounts(sender.address, zeroFeePoolPda, mint, transferPda, senderAta, zeroFeePoolAta))
        .signers([senderLegacy])
        .rpc();
    });

    it("I2. operator closes pool and withdraws remaining tokens", async () => {
      const poolTokenBal = await getTokenBalance(zeroFeePoolAta);
      const operatorBalBefore = await getTokenBalance(operatorAta);

      await program.methods
        .closePool(new BN(poolTokenBal.toString()))
        .accounts({
          operator: toPubkey(operator),
          pool: toPubkey(zeroFeePoolPda),
          mint: toPubkey(mint),
          poolTokenAccount: toPubkey(zeroFeePoolAta),
          operatorTokenAccount: toPubkey(operatorAta),
          tokenProgram: toPubkey(TOKEN_PROGRAM_ADDRESS),
        })
        .rpc();

      const closed = await provider.connection.getAccountInfo(toPubkey(zeroFeePoolPda));
      assert.isNull(closed);

      if (poolTokenBal > 0n) {
        const operatorBalAfter = await getTokenBalance(operatorAta);
        assert.equal(
          (operatorBalAfter - operatorBalBefore).toString(),
          poolTokenBal.toString()
        );
      }
    });
  });
});
