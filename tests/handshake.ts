import * as anchor from "@coral-xyz/anchor";
import { BN, Program, web3 } from "@coral-xyz/anchor";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  PublicKey,
  SystemProgram,
  Keypair,
  Transaction,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { assert } from "chai";
import { Handshake } from "../target/types/handshake";

// PDA seed constants (must match on-chain constants)
const POOL_SEED = Buffer.from("pool");
const SENDER_SEED = Buffer.from("sender");
const RECIPIENT_SEED = Buffer.from("recipient");
const NONCE_SEED = Buffer.from("nonce");

// ─── Helpers ───────────────────────────────────────────────────────────────────

function findPoolPda(
  programId: PublicKey,
  poolId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [POOL_SEED, poolId.toBuffer()],
    programId
  );
}

function findTransferPda(
  programId: PublicKey,
  sender: PublicKey,
  recipient: PublicKey,
  nonce: BN
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      SENDER_SEED,
      sender.toBuffer(),
      RECIPIENT_SEED,
      recipient.toBuffer(),
      NONCE_SEED,
      nonce.toArrayLike(Buffer, "le", 8),
    ],
    programId
  );
}

function getAta(mint: PublicKey, owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, true);
}

async function getTokenBalance(
  connection: web3.Connection,
  ata: PublicKey
): Promise<BN> {
  const info = await connection.getTokenAccountBalance(ata);
  return new BN(info.value.amount);
}

/** Build and return the accounts object for createTransfer */
function createTransferAccounts(
  sender: PublicKey,
  poolPda: PublicKey,
  mint: PublicKey,
  transferPda: PublicKey
) {
  return {
    sender,
    pool: poolPda,
    mint,
    poolTokenAccount: getAta(mint, poolPda),
    senderTokenAccount: getAta(mint, sender),
    transfer: transferPda,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  };
}

/** Build and return the accounts object for cancelTransfer */
function cancelTransferAccounts(
  sender: PublicKey,
  poolPda: PublicKey,
  mint: PublicKey,
  transferPda: PublicKey
) {
  return {
    sender,
    pool: poolPda,
    mint,
    poolTokenAccount: getAta(mint, poolPda),
    senderTokenAccount: getAta(mint, sender),
    transfer: transferPda,
    tokenProgram: TOKEN_PROGRAM_ID,
  };
}

/** Build and return the accounts object for claimTransfer */
function claimTransferAccounts(
  recipient: PublicKey,
  sender: PublicKey,
  poolPda: PublicKey,
  mint: PublicKey,
  transferPda: PublicKey
) {
  return {
    recipient,
    pool: poolPda,
    mint,
    poolTokenAccount: getAta(mint, poolPda),
    recipientTokenAccount: getAta(mint, recipient),
    transfer: transferPda,
    sender,
    tokenProgram: TOKEN_PROGRAM_ID,
  };
}

/** Build and return the accounts object for rejectTransfer */
function rejectTransferAccounts(
  operator: PublicKey,
  sender: PublicKey,
  poolPda: PublicKey,
  mint: PublicKey,
  transferPda: PublicKey
) {
  return {
    operator,
    pool: poolPda,
    mint,
    poolTokenAccount: getAta(mint, poolPda),
    senderTokenAccount: getAta(mint, sender),
    transfer: transferPda,
    sender,
    tokenProgram: TOKEN_PROGRAM_ID,
  };
}

/** Build and return the accounts object for expireTransfer */
function expireTransferAccounts(
  caller: PublicKey,
  sender: PublicKey,
  poolPda: PublicKey,
  mint: PublicKey,
  transferPda: PublicKey
) {
  return {
    caller,
    pool: poolPda,
    mint,
    poolTokenAccount: getAta(mint, poolPda),
    senderTokenAccount: getAta(mint, sender),
    transfer: transferPda,
    sender,
    tokenProgram: TOKEN_PROGRAM_ID,
  };
}

/** Build and return the accounts object for destroyTransfer */
function destroyTransferAccounts(
  operator: PublicKey,
  poolPda: PublicKey,
  mint: PublicKey,
  transferPda: PublicKey
) {
  return {
    operator,
    pool: poolPda,
    mint,
    poolTokenAccount: getAta(mint, poolPda),
    operatorTokenAccount: getAta(mint, operator),
    transfer: transferPda,
    tokenProgram: TOKEN_PROGRAM_ID,
  };
}

// Nonce counter to avoid PDA collisions
let nonceCounter = 1;
function nextNonce(): BN {
  return new BN(Date.now() + nonceCounter++);
}

// ─── Test Suite ────────────────────────────────────────────────────────────────

describe("handshake", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.handshake as Program<Handshake>;
  const programId = program.programId;
  const { connection } = provider;
  const operator = provider.wallet.publicKey;
  const payerKeypair = (provider.wallet as any).payer as Keypair;

  // Test actors
  let sender: Keypair;
  let recipient: Keypair;
  let thirdParty: Keypair;

  // Token mint
  let mint: PublicKey;

  // Pool variables
  let zeroFeePoolId: PublicKey;
  let zeroFeePoolPda: PublicKey;
  let zeroFeePoolBump: number;

  let feePoolId: PublicKey;
  let feePoolPda: PublicKey;
  let feePoolBump: number;
  const FEE_BPS = 250; // 2.5%

  before(async () => {
    // Create test actors
    sender = Keypair.generate();
    recipient = Keypair.generate();
    thirdParty = Keypair.generate();

    // Fund actors with SOL
    const fundAmount = 0.05 * web3.LAMPORTS_PER_SOL;
    for (const kp of [sender, recipient, thirdParty]) {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: operator,
          toPubkey: kp.publicKey,
          lamports: fundAmount,
        })
      );
      await provider.sendAndConfirm(tx);
    }

    // Create test USDC mint (6 decimals)
    mint = await createMint(connection, payerKeypair, payerKeypair.publicKey, null, 6);

    // Create ATAs and mint tokens
    const actors = [
      { kp: payerKeypair, pub: operator, amount: 1_000_000 },
      { kp: sender, pub: sender.publicKey, amount: 100_000 },
      { kp: recipient, pub: recipient.publicKey, amount: 10_000 },
      { kp: thirdParty, pub: thirdParty.publicKey, amount: 5_000 },
    ];

    for (const actor of actors) {
      const ata = await createAssociatedTokenAccount(
        connection,
        payerKeypair,
        mint,
        actor.pub
      );
      await mintTo(
        connection,
        payerKeypair,
        mint,
        ata,
        payerKeypair,
        actor.amount * 1_000_000
      );
    }

    // Derive pool PDAs
    zeroFeePoolId = Keypair.generate().publicKey;
    [zeroFeePoolPda, zeroFeePoolBump] = findPoolPda(programId, zeroFeePoolId);

    feePoolId = Keypair.generate().publicKey;
    [feePoolPda, feePoolBump] = findPoolPda(programId, feePoolId);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Group A: Pool Setup
  // ═══════════════════════════════════════════════════════════════════════════

  describe("A. Pool Initialization", () => {
    it("A1. initializes a pool with 0% fee", async () => {
      await program.methods
        .initPool(zeroFeePoolId, 0)
        .accounts({
          operator,
          mint,
          pool: zeroFeePoolPda,
          poolTokenAccount: getAta(mint, zeroFeePoolPda),
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      const pool = await program.account.pool.fetch(zeroFeePoolPda);
      assert.equal(pool.version, 1);
      assert.equal(pool.bump, zeroFeePoolBump);
      assert.equal(pool.poolId.toString(), zeroFeePoolId.toString());
      assert.equal(pool.operator.toString(), operator.toString());
      assert.equal(pool.mint.toString(), mint.toString());
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
        .initPool(feePoolId, FEE_BPS)
        .accounts({
          operator,
          mint,
          pool: feePoolPda,
          poolTokenAccount: getAta(mint, feePoolPda),
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      const pool = await program.account.pool.fetch(feePoolPda);
      assert.equal(pool.transferFeeBps, FEE_BPS);
      assert.equal(pool.isPaused, false);
    });

    it("A3. fails to init pool with fee > 10000 bps", async () => {
      const badPoolId = Keypair.generate().publicKey;
      const [badPoolPda] = findPoolPda(programId, badPoolId);

      try {
        await program.methods
          .initPool(badPoolId, 10001)
          .accounts({
            operator,
            mint,
            pool: badPoolPda,
            poolTokenAccount: getAta(mint, badPoolPda),
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
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
    const TRANSFER_AMOUNT = new BN(1000 * 1_000_000); // 1000 tokens

    it("B1. creates a transfer and sender cancels (full refund, no fee)", async () => {
      const nonce = nextNonce();
      const [transferPda] = findTransferPda(programId, sender.publicKey, recipient.publicKey, nonce);

      const senderBalBefore = await getTokenBalance(connection, getAta(mint, sender.publicKey));
      const poolBalBefore = await getTokenBalance(connection, getAta(mint, zeroFeePoolPda));

      // Create
      await program.methods
        .createTransfer(
          recipient.publicKey,
          nonce,
          TRANSFER_AMOUNT,
          "test cancel",
          new BN(0),
          new BN(0)
        )
        .accounts(createTransferAccounts(sender.publicKey, zeroFeePoolPda, mint, transferPda))
        .signers([sender])
        .rpc();

      // Verify escrow account
      const escrow = await program.account.secureTransfer.fetch(transferPda);
      assert.equal(escrow.sender.toString(), sender.publicKey.toString());
      assert.equal(escrow.recipient.toString(), recipient.publicKey.toString());
      assert.equal(escrow.pool.toString(), zeroFeePoolPda.toString());
      assert.equal(escrow.amount.toString(), TRANSFER_AMOUNT.toString());
      assert.deepEqual(escrow.status, { active: {} });
      assert.equal(escrow.claimableAfter.toNumber(), 0);
      assert.equal(escrow.claimableUntil.toNumber(), 0);

      // Verify pool accounting after create
      let pool = await program.account.pool.fetch(zeroFeePoolPda);
      assert.equal(pool.totalDeposits.toString(), TRANSFER_AMOUNT.toString());
      assert.equal(pool.totalEscrowed.toString(), TRANSFER_AMOUNT.toString());
      assert.equal(pool.totalTransfersCreated.toNumber(), 1);

      // Cancel
      await program.methods
        .cancelTransfer()
        .accounts(cancelTransferAccounts(sender.publicKey, zeroFeePoolPda, mint, transferPda))
        .signers([sender])
        .rpc();

      // Transfer account should be closed
      const closed = await connection.getAccountInfo(transferPda);
      assert.isNull(closed);

      // Sender gets full refund
      const senderBalAfter = await getTokenBalance(connection, getAta(mint, sender.publicKey));
      assert.equal(senderBalAfter.toString(), senderBalBefore.toString());

      // Pool balance back to where it was
      const poolBalAfter = await getTokenBalance(connection, getAta(mint, zeroFeePoolPda));
      assert.equal(poolBalAfter.toString(), poolBalBefore.toString());

      // Pool accounting
      pool = await program.account.pool.fetch(zeroFeePoolPda);
      assert.equal(pool.totalTransfersResolved.toNumber(), 1);
      assert.equal(pool.totalEscrowed.toNumber(), 0);
    });

    it("B2. fails when non-sender tries to cancel", async () => {
      const nonce = nextNonce();
      const [transferPda] = findTransferPda(programId, sender.publicKey, recipient.publicKey, nonce);

      // Create transfer
      await program.methods
        .createTransfer(recipient.publicKey, nonce, TRANSFER_AMOUNT, "auth test", new BN(0), new BN(0))
        .accounts(createTransferAccounts(sender.publicKey, zeroFeePoolPda, mint, transferPda))
        .signers([sender])
        .rpc();

      // Recipient tries to cancel - should fail
      try {
        await program.methods
          .cancelTransfer()
          .accounts(cancelTransferAccounts(recipient.publicKey, zeroFeePoolPda, mint, transferPda))
          .signers([recipient])
          .rpc();
        assert.fail("Non-sender should not be able to cancel");
      } catch (err: any) {
        // Expected - could be constraint error or custom error
        assert.ok(err);
      }

      // Cleanup: sender cancels
      await program.methods
        .cancelTransfer()
        .accounts(cancelTransferAccounts(sender.publicKey, zeroFeePoolPda, mint, transferPda))
        .signers([sender])
        .rpc();
    });

    it("B3. expires a transfer past claimable_until (permissionless, full refund)", async () => {
      const nonce = nextNonce();
      const [transferPda] = findTransferPda(programId, sender.publicKey, recipient.publicKey, nonce);

      // Use a claimable_until of 1 second from now so it expires quickly
      const now = Math.floor(Date.now() / 1000);
      const claimableUntil = new BN(now + 2);

      const senderBalBefore = await getTokenBalance(connection, getAta(mint, sender.publicKey));

      // Create transfer with short deadline
      await program.methods
        .createTransfer(recipient.publicKey, nonce, TRANSFER_AMOUNT, "expire test", new BN(0), claimableUntil)
        .accounts(createTransferAccounts(sender.publicKey, zeroFeePoolPda, mint, transferPda))
        .signers([sender])
        .rpc();

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // ThirdParty expires it (permissionless)
      await program.methods
        .expireTransfer()
        .accounts(expireTransferAccounts(thirdParty.publicKey, sender.publicKey, zeroFeePoolPda, mint, transferPda))
        .signers([thirdParty])
        .rpc();

      // Transfer account closed
      const closed = await connection.getAccountInfo(transferPda);
      assert.isNull(closed);

      // Sender gets full refund (no fee on expire)
      const senderBalAfter = await getTokenBalance(connection, getAta(mint, sender.publicKey));
      assert.equal(senderBalAfter.toString(), senderBalBefore.toString());
    });

    it("B4. fails to expire a transfer before deadline", async () => {
      const nonce = nextNonce();
      const [transferPda] = findTransferPda(programId, sender.publicKey, recipient.publicKey, nonce);

      const now = Math.floor(Date.now() / 1000);
      const claimableUntil = new BN(now + 3600); // 1 hour from now

      await program.methods
        .createTransfer(recipient.publicKey, nonce, TRANSFER_AMOUNT, "not expired", new BN(0), claimableUntil)
        .accounts(createTransferAccounts(sender.publicKey, zeroFeePoolPda, mint, transferPda))
        .signers([sender])
        .rpc();

      try {
        await program.methods
          .expireTransfer()
          .accounts(expireTransferAccounts(thirdParty.publicKey, sender.publicKey, zeroFeePoolPda, mint, transferPda))
          .signers([thirdParty])
          .rpc();
        assert.fail("Should not expire before deadline");
      } catch (err: any) {
        assert.include(err.toString(), "CannotClaim");
      }

      // Cleanup
      await program.methods
        .cancelTransfer()
        .accounts(cancelTransferAccounts(sender.publicKey, zeroFeePoolPda, mint, transferPda))
        .signers([sender])
        .rpc();
    });

    it("B5. fails to expire a transfer with no deadline (claimable_until = 0)", async () => {
      const nonce = nextNonce();
      const [transferPda] = findTransferPda(programId, sender.publicKey, recipient.publicKey, nonce);

      await program.methods
        .createTransfer(recipient.publicKey, nonce, TRANSFER_AMOUNT, "no deadline", new BN(0), new BN(0))
        .accounts(createTransferAccounts(sender.publicKey, zeroFeePoolPda, mint, transferPda))
        .signers([sender])
        .rpc();

      try {
        await program.methods
          .expireTransfer()
          .accounts(expireTransferAccounts(thirdParty.publicKey, sender.publicKey, zeroFeePoolPda, mint, transferPda))
          .signers([thirdParty])
          .rpc();
        assert.fail("Should not expire transfer with no deadline");
      } catch (err: any) {
        assert.include(err.toString(), "InvalidTimeWindow");
      }

      // Cleanup
      await program.methods
        .cancelTransfer()
        .accounts(cancelTransferAccounts(sender.publicKey, zeroFeePoolPda, mint, transferPda))
        .signers([sender])
        .rpc();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Group C: Transfer Lifecycle (2.5% fee pool)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("C. Transfer Lifecycle (2.5% fee pool)", () => {
    const TRANSFER_AMOUNT = new BN(10_000 * 1_000_000); // 10,000 tokens
    const EXPECTED_FEE = new BN(250 * 1_000_000); // 2.5% of 10,000 = 250 tokens
    const EXPECTED_NET = TRANSFER_AMOUNT.sub(EXPECTED_FEE); // 9,750 tokens

    it("C1. recipient claims transfer (gets 97.5%, pool keeps 2.5%)", async () => {
      const nonce = nextNonce();
      const [transferPda] = findTransferPda(programId, sender.publicKey, recipient.publicKey, nonce);

      const senderBalBefore = await getTokenBalance(connection, getAta(mint, sender.publicKey));
      const recipientBalBefore = await getTokenBalance(connection, getAta(mint, recipient.publicKey));

      // Create
      await program.methods
        .createTransfer(recipient.publicKey, nonce, TRANSFER_AMOUNT, "claim test", new BN(0), new BN(0))
        .accounts(createTransferAccounts(sender.publicKey, feePoolPda, mint, transferPda))
        .signers([sender])
        .rpc();

      // Verify pool accounting after deposit
      let pool = await program.account.pool.fetch(feePoolPda);
      assert.equal(pool.totalDeposits.toString(), TRANSFER_AMOUNT.toString());
      assert.equal(pool.totalEscrowed.toString(), TRANSFER_AMOUNT.toString());

      // Claim
      await program.methods
        .claimTransfer()
        .accounts(claimTransferAccounts(recipient.publicKey, sender.publicKey, feePoolPda, mint, transferPda))
        .signers([recipient])
        .rpc();

      // Transfer account closed
      const closed = await connection.getAccountInfo(transferPda);
      assert.isNull(closed);

      // Recipient gets net amount
      const recipientBalAfter = await getTokenBalance(connection, getAta(mint, recipient.publicKey));
      assert.equal(
        recipientBalAfter.sub(recipientBalBefore).toString(),
        EXPECTED_NET.toString(),
        "Recipient should receive amount minus fee"
      );

      // Pool accounting
      pool = await program.account.pool.fetch(feePoolPda);
      assert.equal(pool.totalTransfersCreated.toNumber(), 1);
      assert.equal(pool.totalTransfersResolved.toNumber(), 1);
      assert.equal(pool.collectedFees.toString(), EXPECTED_FEE.toString());
      assert.equal(pool.totalEscrowed.toNumber(), 0);

      // Sender's balance decreased by full amount
      const senderBalAfter = await getTokenBalance(connection, getAta(mint, sender.publicKey));
      assert.equal(
        senderBalBefore.sub(senderBalAfter).toString(),
        TRANSFER_AMOUNT.toString()
      );
    });

    it("C2. fails when non-recipient tries to claim", async () => {
      const nonce = nextNonce();
      const [transferPda] = findTransferPda(programId, sender.publicKey, recipient.publicKey, nonce);

      await program.methods
        .createTransfer(recipient.publicKey, nonce, TRANSFER_AMOUNT, "auth claim", new BN(0), new BN(0))
        .accounts(createTransferAccounts(sender.publicKey, feePoolPda, mint, transferPda))
        .signers([sender])
        .rpc();

      // ThirdParty tries to claim
      try {
        await program.methods
          .claimTransfer()
          .accounts(claimTransferAccounts(thirdParty.publicKey, sender.publicKey, feePoolPda, mint, transferPda))
          .signers([thirdParty])
          .rpc();
        assert.fail("Non-recipient should not be able to claim");
      } catch (err: any) {
        assert.ok(err);
      }

      // Cleanup
      await program.methods
        .cancelTransfer()
        .accounts(cancelTransferAccounts(sender.publicKey, feePoolPda, mint, transferPda))
        .signers([sender])
        .rpc();
    });

    it("C3. fails to claim before claimable_after window", async () => {
      const nonce = nextNonce();
      const [transferPda] = findTransferPda(programId, sender.publicKey, recipient.publicKey, nonce);

      const now = Math.floor(Date.now() / 1000);
      const claimableAfter = new BN(now + 3600); // 1 hour from now
      const claimableUntil = new BN(now + 7200); // 2 hours from now

      await program.methods
        .createTransfer(recipient.publicKey, nonce, TRANSFER_AMOUNT, "early claim", claimableAfter, claimableUntil)
        .accounts(createTransferAccounts(sender.publicKey, feePoolPda, mint, transferPda))
        .signers([sender])
        .rpc();

      try {
        await program.methods
          .claimTransfer()
          .accounts(claimTransferAccounts(recipient.publicKey, sender.publicKey, feePoolPda, mint, transferPda))
          .signers([recipient])
          .rpc();
        assert.fail("Should not claim before claimable_after");
      } catch (err: any) {
        assert.include(err.toString(), "CannotClaim");
      }

      // Cleanup
      await program.methods
        .cancelTransfer()
        .accounts(cancelTransferAccounts(sender.publicKey, feePoolPda, mint, transferPda))
        .signers([sender])
        .rpc();
    });

    it("C4. operator rejects transfer (sender gets 97.5% back, fee kept)", async () => {
      const nonce = nextNonce();
      const [transferPda] = findTransferPda(programId, sender.publicKey, recipient.publicKey, nonce);

      const senderBalBefore = await getTokenBalance(connection, getAta(mint, sender.publicKey));
      const poolFeesBefore = (await program.account.pool.fetch(feePoolPda)).collectedFees;

      // Create
      await program.methods
        .createTransfer(recipient.publicKey, nonce, TRANSFER_AMOUNT, "reject test", new BN(0), new BN(0))
        .accounts(createTransferAccounts(sender.publicKey, feePoolPda, mint, transferPda))
        .signers([sender])
        .rpc();

      // Operator rejects
      await program.methods
        .rejectTransfer(1, "Suspicious activity")
        .accounts(rejectTransferAccounts(operator, sender.publicKey, feePoolPda, mint, transferPda))
        .rpc();

      // Transfer account closed
      const closed = await connection.getAccountInfo(transferPda);
      assert.isNull(closed);

      // Sender gets net refund (amount - fee)
      const senderBalAfter = await getTokenBalance(connection, getAta(mint, sender.publicKey));
      assert.equal(
        senderBalBefore.sub(senderBalAfter).toString(),
        EXPECTED_FEE.toString(),
        "Sender should only lose the fee amount"
      );

      // Pool collected fees increased
      const pool = await program.account.pool.fetch(feePoolPda);
      assert.equal(
        pool.collectedFees.sub(poolFeesBefore).toString(),
        EXPECTED_FEE.toString()
      );
    });

    it("C5. fails when non-operator tries to reject", async () => {
      const nonce = nextNonce();
      const [transferPda] = findTransferPda(programId, sender.publicKey, recipient.publicKey, nonce);

      await program.methods
        .createTransfer(recipient.publicKey, nonce, TRANSFER_AMOUNT, "auth reject", new BN(0), new BN(0))
        .accounts(createTransferAccounts(sender.publicKey, feePoolPda, mint, transferPda))
        .signers([sender])
        .rpc();

      // Sender tries to reject (only operator can)
      try {
        await program.methods
          .rejectTransfer(1, "I am not the operator")
          .accounts(rejectTransferAccounts(sender.publicKey, sender.publicKey, feePoolPda, mint, transferPda))
          .signers([sender])
          .rpc();
        assert.fail("Non-operator should not be able to reject");
      } catch (err: any) {
        assert.ok(err);
      }

      // Cleanup
      await program.methods
        .cancelTransfer()
        .accounts(cancelTransferAccounts(sender.publicKey, feePoolPda, mint, transferPda))
        .signers([sender])
        .rpc();
    });

    it("C6. fails to reject with reason_message > 200 chars", async () => {
      const nonce = nextNonce();
      const [transferPda] = findTransferPda(programId, sender.publicKey, recipient.publicKey, nonce);

      await program.methods
        .createTransfer(recipient.publicKey, nonce, TRANSFER_AMOUNT, "long msg test", new BN(0), new BN(0))
        .accounts(createTransferAccounts(sender.publicKey, feePoolPda, mint, transferPda))
        .signers([sender])
        .rpc();

      const longMessage = "x".repeat(201);
      try {
        await program.methods
          .rejectTransfer(1, longMessage)
          .accounts(rejectTransferAccounts(operator, sender.publicKey, feePoolPda, mint, transferPda))
          .rpc();
        assert.fail("Should fail with long reason message");
      } catch (err: any) {
        assert.include(err.toString(), "InvalidMemoLength");
      }

      // Cleanup
      await program.methods
        .cancelTransfer()
        .accounts(cancelTransferAccounts(sender.publicKey, feePoolPda, mint, transferPda))
        .signers([sender])
        .rpc();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Group D: Input Validation
  // ═══════════════════════════════════════════════════════════════════════════

  describe("D. Input Validation", () => {
    it("D1. fails to create transfer with amount = 0", async () => {
      const nonce = nextNonce();
      const [transferPda] = findTransferPda(programId, sender.publicKey, recipient.publicKey, nonce);

      try {
        await program.methods
          .createTransfer(recipient.publicKey, nonce, new BN(0), "zero amount", new BN(0), new BN(0))
          .accounts(createTransferAccounts(sender.publicKey, zeroFeePoolPda, mint, transferPda))
          .signers([sender])
          .rpc();
        assert.fail("Should fail with zero amount");
      } catch (err: any) {
        assert.include(err.toString(), "DepositTooSmall");
      }
    });

    it("D2. fails to create transfer with memo > 64 bytes", async () => {
      const nonce = nextNonce();
      const [transferPda] = findTransferPda(programId, sender.publicKey, recipient.publicKey, nonce);

      const longMemo = "x".repeat(65);
      try {
        await program.methods
          .createTransfer(
            recipient.publicKey,
            nonce,
            new BN(1_000_000),
            longMemo,
            new BN(0),
            new BN(0)
          )
          .accounts(createTransferAccounts(sender.publicKey, zeroFeePoolPda, mint, transferPda))
          .signers([sender])
          .rpc();
        assert.fail("Should fail with long memo");
      } catch (err: any) {
        assert.include(err.toString(), "InvalidMemoLength");
      }
    });

    it("D3. fails to create transfer when pool is paused", async () => {
      // Pause the zero-fee pool
      await program.methods
        .pausePool(true)
        .accounts({ operator, pool: zeroFeePoolPda })
        .rpc();

      const nonce = nextNonce();
      const [transferPda] = findTransferPda(programId, sender.publicKey, recipient.publicKey, nonce);

      try {
        await program.methods
          .createTransfer(recipient.publicKey, nonce, new BN(1_000_000), "paused", new BN(0), new BN(0))
          .accounts(createTransferAccounts(sender.publicKey, zeroFeePoolPda, mint, transferPda))
          .signers([sender])
          .rpc();
        assert.fail("Should fail when pool is paused");
      } catch (err: any) {
        assert.include(err.toString(), "PoolPaused");
      }

      // Unpause for subsequent tests
      await program.methods
        .pausePool(false)
        .accounts({ operator, pool: zeroFeePoolPda })
        .rpc();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Group E: Fee Withdrawal
  // ═══════════════════════════════════════════════════════════════════════════

  describe("E. Fee Withdrawal", () => {
    it("E1. operator withdraws collected fees", async () => {
      const pool = await program.account.pool.fetch(feePoolPda);
      const feeAmount = pool.collectedFees;
      assert.isTrue(feeAmount.gt(new BN(0)), "Should have collected fees from Group C");

      const operatorBalBefore = await getTokenBalance(connection, getAta(mint, operator));

      await program.methods
        .withdrawFees()
        .accounts({
          operator,
          pool: feePoolPda,
          mint,
          poolTokenAccount: getAta(mint, feePoolPda),
          operatorTokenAccount: getAta(mint, operator),
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      // Operator received fees
      const operatorBalAfter = await getTokenBalance(connection, getAta(mint, operator));
      assert.equal(
        operatorBalAfter.sub(operatorBalBefore).toString(),
        feeAmount.toString()
      );

      // Collected fees reset to 0
      const poolAfter = await program.account.pool.fetch(feePoolPda);
      assert.equal(poolAfter.collectedFees.toNumber(), 0);
    });

    it("E2. fails when non-operator tries to withdraw fees", async () => {
      // First create a transfer and claim to generate fees again
      const nonce = nextNonce();
      const [transferPda] = findTransferPda(programId, sender.publicKey, recipient.publicKey, nonce);
      const amount = new BN(1000 * 1_000_000);

      await program.methods
        .createTransfer(recipient.publicKey, nonce, amount, "fee gen", new BN(0), new BN(0))
        .accounts(createTransferAccounts(sender.publicKey, feePoolPda, mint, transferPda))
        .signers([sender])
        .rpc();

      await program.methods
        .claimTransfer()
        .accounts(claimTransferAccounts(recipient.publicKey, sender.publicKey, feePoolPda, mint, transferPda))
        .signers([recipient])
        .rpc();

      // Now sender tries to withdraw fees
      try {
        await program.methods
          .withdrawFees()
          .accounts({
            operator: sender.publicKey,
            pool: feePoolPda,
            mint,
            poolTokenAccount: getAta(mint, feePoolPda),
            operatorTokenAccount: getAta(mint, sender.publicKey),
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([sender])
          .rpc();
        assert.fail("Non-operator should not be able to withdraw fees");
      } catch (err: any) {
        assert.ok(err);
      }

      // Cleanup: operator withdraws
      await program.methods
        .withdrawFees()
        .accounts({
          operator,
          pool: feePoolPda,
          mint,
          poolTokenAccount: getAta(mint, feePoolPda),
          operatorTokenAccount: getAta(mint, operator),
          tokenProgram: TOKEN_PROGRAM_ID,
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
      const [transferPda] = findTransferPda(programId, sender.publicKey, recipient.publicKey, nonce);

      // Create transfer on zero-fee pool
      await program.methods
        .createTransfer(recipient.publicKey, nonce, TRANSFER_AMOUNT, "destroy test", new BN(0), new BN(0))
        .accounts(createTransferAccounts(sender.publicKey, zeroFeePoolPda, mint, transferPda))
        .signers([sender])
        .rpc();

      // Pause pool
      await program.methods
        .pausePool(true)
        .accounts({ operator, pool: zeroFeePoolPda })
        .rpc();

      const operatorBalBefore = await getTokenBalance(connection, getAta(mint, operator));

      // Destroy
      await program.methods
        .destroyTransfer()
        .accounts(destroyTransferAccounts(operator, zeroFeePoolPda, mint, transferPda))
        .rpc();

      // Transfer closed
      const closed = await connection.getAccountInfo(transferPda);
      assert.isNull(closed);

      // Operator received funds
      const operatorBalAfter = await getTokenBalance(connection, getAta(mint, operator));
      assert.equal(
        operatorBalAfter.sub(operatorBalBefore).toString(),
        TRANSFER_AMOUNT.toString()
      );

      // Unpause
      await program.methods
        .pausePool(false)
        .accounts({ operator, pool: zeroFeePoolPda })
        .rpc();
    });

    it("F2. fails to destroy when pool is NOT paused", async () => {
      const nonce = nextNonce();
      const [transferPda] = findTransferPda(programId, sender.publicKey, recipient.publicKey, nonce);

      await program.methods
        .createTransfer(recipient.publicKey, nonce, TRANSFER_AMOUNT, "not paused", new BN(0), new BN(0))
        .accounts(createTransferAccounts(sender.publicKey, zeroFeePoolPda, mint, transferPda))
        .signers([sender])
        .rpc();

      try {
        await program.methods
          .destroyTransfer()
          .accounts(destroyTransferAccounts(operator, zeroFeePoolPda, mint, transferPda))
          .rpc();
        assert.fail("Should fail when pool is not paused");
      } catch (err: any) {
        assert.include(err.toString(), "PoolPaused");
      }

      // Cleanup
      await program.methods
        .cancelTransfer()
        .accounts(cancelTransferAccounts(sender.publicKey, zeroFeePoolPda, mint, transferPda))
        .signers([sender])
        .rpc();
    });

    it("F3. fails when non-operator tries to destroy", async () => {
      const nonce = nextNonce();
      const [transferPda] = findTransferPda(programId, sender.publicKey, recipient.publicKey, nonce);

      await program.methods
        .createTransfer(recipient.publicKey, nonce, TRANSFER_AMOUNT, "auth destroy", new BN(0), new BN(0))
        .accounts(createTransferAccounts(sender.publicKey, zeroFeePoolPda, mint, transferPda))
        .signers([sender])
        .rpc();

      // Pause pool
      await program.methods
        .pausePool(true)
        .accounts({ operator, pool: zeroFeePoolPda })
        .rpc();

      try {
        await program.methods
          .destroyTransfer()
          .accounts(destroyTransferAccounts(sender.publicKey, zeroFeePoolPda, mint, transferPda))
          .signers([sender])
          .rpc();
        assert.fail("Non-operator should not be able to destroy");
      } catch (err: any) {
        assert.ok(err);
      }

      // Unpause and cleanup
      await program.methods
        .pausePool(false)
        .accounts({ operator, pool: zeroFeePoolPda })
        .rpc();

      await program.methods
        .cancelTransfer()
        .accounts(cancelTransferAccounts(sender.publicKey, zeroFeePoolPda, mint, transferPda))
        .signers([sender])
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
        .accounts({ operator, pool: zeroFeePoolPda })
        .rpc();

      let pool = await program.account.pool.fetch(zeroFeePoolPda);
      assert.equal(pool.isPaused, true);

      await program.methods
        .pausePool(false)
        .accounts({ operator, pool: zeroFeePoolPda })
        .rpc();

      pool = await program.account.pool.fetch(zeroFeePoolPda);
      assert.equal(pool.isPaused, false);
    });

    it("G2. fails when non-operator tries to pause", async () => {
      try {
        await program.methods
          .pausePool(true)
          .accounts({ operator: sender.publicKey, pool: zeroFeePoolPda })
          .signers([sender])
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
      const [transferPda] = findTransferPda(programId, sender.publicKey, recipient.publicKey, nonce);

      await program.methods
        .createTransfer(recipient.publicKey, nonce, new BN(100 * 1_000_000), "reset block", new BN(0), new BN(0))
        .accounts(createTransferAccounts(sender.publicKey, zeroFeePoolPda, mint, transferPda))
        .signers([sender])
        .rpc();

      try {
        await program.methods
          .resetPool()
          .accounts({ operator, pool: zeroFeePoolPda })
          .rpc();
        assert.fail("Should fail with outstanding transfers");
      } catch (err: any) {
        assert.include(err.toString(), "OutstandingTransfers");
      }

      // Cleanup
      await program.methods
        .cancelTransfer()
        .accounts(cancelTransferAccounts(sender.publicKey, zeroFeePoolPda, mint, transferPda))
        .signers([sender])
        .rpc();
    });

    it("H2. operator resets pool counters when no outstanding transfers", async () => {
      // Verify pool has non-zero counters from earlier tests
      let pool = await program.account.pool.fetch(zeroFeePoolPda);
      assert.isTrue(
        pool.totalTransfersCreated.gt(new BN(0)),
        "Should have transfers from earlier tests"
      );

      await program.methods
        .resetPool()
        .accounts({ operator, pool: zeroFeePoolPda })
        .rpc();

      pool = await program.account.pool.fetch(zeroFeePoolPda);
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
      const [transferPda] = findTransferPda(programId, sender.publicKey, recipient.publicKey, nonce);

      await program.methods
        .createTransfer(recipient.publicKey, nonce, new BN(100 * 1_000_000), "close block", new BN(0), new BN(0))
        .accounts(createTransferAccounts(sender.publicKey, zeroFeePoolPda, mint, transferPda))
        .signers([sender])
        .rpc();

      try {
        await program.methods
          .closePool(new BN(0))
          .accounts({
            operator,
            pool: zeroFeePoolPda,
            mint,
            poolTokenAccount: getAta(mint, zeroFeePoolPda),
            operatorTokenAccount: getAta(mint, operator),
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        assert.fail("Should fail with outstanding transfers");
      } catch (err: any) {
        assert.include(err.toString(), "OutstandingTransfers");
      }

      // Cleanup
      await program.methods
        .cancelTransfer()
        .accounts(cancelTransferAccounts(sender.publicKey, zeroFeePoolPda, mint, transferPda))
        .signers([sender])
        .rpc();
    });

    it("I2. operator closes pool and withdraws remaining tokens", async () => {
      // Check pool token balance
      const poolTokenBal = await getTokenBalance(connection, getAta(mint, zeroFeePoolPda));
      const operatorBalBefore = await getTokenBalance(connection, getAta(mint, operator));

      await program.methods
        .closePool(poolTokenBal)
        .accounts({
          operator,
          pool: zeroFeePoolPda,
          mint,
          poolTokenAccount: getAta(mint, zeroFeePoolPda),
          operatorTokenAccount: getAta(mint, operator),
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      // Pool account should be closed
      const closed = await connection.getAccountInfo(zeroFeePoolPda);
      assert.isNull(closed);

      // Operator received tokens
      if (poolTokenBal.gt(new BN(0))) {
        const operatorBalAfter = await getTokenBalance(connection, getAta(mint, operator));
        assert.equal(
          operatorBalAfter.sub(operatorBalBefore).toString(),
          poolTokenBal.toString()
        );
      }
    });
  });
});
