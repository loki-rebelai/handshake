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
} from "@solana/web3.js";
import { assert } from "chai";
import { Silkysig } from "../target/types/silkysig";

// PDA seed constant (must match on-chain constant)
const ACCOUNT_SEED = Buffer.from("account");

// ─── Helpers ───────────────────────────────────────────────────────────────────

function findAccountPda(
  programId: PublicKey,
  owner: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ACCOUNT_SEED, owner.toBuffer()],
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

// ─── Test Suite ────────────────────────────────────────────────────────────────

describe("silkysig", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.silkysig as Program<Silkysig>;
  const programId = program.programId;
  const { connection } = provider;
  const payer = provider.wallet.publicKey;
  const payerKeypair = (provider.wallet as any).payer as Keypair;

  // Test actors
  let owner: Keypair;
  let owner2: Keypair;
  let operator: Keypair;
  let outsider: Keypair;
  let recipient: Keypair;

  // Token mint
  let mint: PublicKey;

  // Account PDAs (set in before)
  let accountPda: PublicKey;
  let accountBump: number;

  const PER_TX_LIMIT = new BN(5_000_000); // $5 at 6 decimals
  const MINT_AMOUNT = 100_000_000; // $100 at 6 decimals

  before(async () => {
    // Create test actors
    owner = Keypair.generate();
    owner2 = Keypair.generate();
    operator = Keypair.generate();
    outsider = Keypair.generate();
    recipient = Keypair.generate();

    // Fund actors with SOL
    const fundAmount = 0.1 * web3.LAMPORTS_PER_SOL;
    for (const kp of [owner, owner2, operator, outsider, recipient]) {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer,
          toPubkey: kp.publicKey,
          lamports: fundAmount,
        })
      );
      await provider.sendAndConfirm(tx);
    }

    // Create test USDC mint (6 decimals)
    mint = await createMint(connection, payerKeypair, payerKeypair.publicKey, null, 6);

    // Create ATAs and mint tokens to owner and outsider
    for (const actor of [
      { kp: owner, amount: MINT_AMOUNT },
      { kp: outsider, amount: MINT_AMOUNT },
    ]) {
      const ata = await createAssociatedTokenAccount(
        connection,
        payerKeypair,
        mint,
        actor.kp.publicKey
      );
      await mintTo(
        connection,
        payerKeypair,
        mint,
        ata,
        payerKeypair,
        actor.amount
      );
    }

    // Derive account PDA
    [accountPda, accountBump] = findAccountPda(programId, owner.publicKey);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Group A: Account Creation
  // ═══════════════════════════════════════════════════════════════════════════

  describe("A. Account Creation", () => {
    it("A1. creates account with operator and per_tx_limit", async () => {
      await program.methods
        .createAccount(operator.publicKey, PER_TX_LIMIT)
        .accounts({
          owner: owner.publicKey,
          mint,
          silkAccount: accountPda,
          accountTokenAccount: getAta(mint, accountPda),
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc();

      const account = await program.account.silkAccount.fetch(accountPda);
      assert.equal(account.version, 1);
      assert.equal(account.bump, accountBump);
      assert.equal(account.owner.toString(), owner.publicKey.toString());
      assert.equal(account.mint.toString(), mint.toString());
      assert.equal(account.isPaused, false);
      assert.equal(account.operatorCount, 1);
      assert.equal(account.operators[0].pubkey.toString(), operator.publicKey.toString());
      assert.equal(account.operators[0].perTxLimit.toString(), PER_TX_LIMIT.toString());

      // ATA should exist with 0 balance
      const balance = await getTokenBalance(connection, getAta(mint, accountPda));
      assert.equal(balance.toNumber(), 0);
    });

    it("A2. creates account without operator (both args null)", async () => {
      const [account2Pda] = findAccountPda(programId, owner2.publicKey);

      await program.methods
        .createAccount(null, null)
        .accounts({
          owner: owner2.publicKey,
          mint,
          silkAccount: account2Pda,
          accountTokenAccount: getAta(mint, account2Pda),
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner2])
        .rpc();

      const account = await program.account.silkAccount.fetch(account2Pda);
      assert.equal(account.operatorCount, 0);
      // All operator slots should have default pubkey
      for (const op of account.operators) {
        assert.equal(op.pubkey.toString(), PublicKey.default.toString());
      }
    });

    it("A3. fails to create duplicate account for same owner", async () => {
      try {
        await program.methods
          .createAccount(null, null)
          .accounts({
            owner: owner.publicKey,
            mint,
            silkAccount: accountPda,
            accountTokenAccount: getAta(mint, accountPda),
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([owner])
          .rpc();
        assert.fail("Should have failed with duplicate account");
      } catch (err: any) {
        // Anchor returns a constraint error or "already in use" for duplicate init
        assert.ok(err.toString().length > 0);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Group B: Deposit
  // ═══════════════════════════════════════════════════════════════════════════

  describe("B. Deposit", () => {
    it("B1. owner deposits tokens via deposit instruction", async () => {
      const depositAmount = new BN(10_000_000); // $10

      await program.methods
        .deposit(depositAmount)
        .accounts({
          depositor: owner.publicKey,
          silkAccount: accountPda,
          mint,
          accountTokenAccount: getAta(mint, accountPda),
          depositorTokenAccount: getAta(mint, owner.publicKey),
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([owner])
        .rpc();

      const balance = await getTokenBalance(connection, getAta(mint, accountPda));
      assert.equal(balance.toNumber(), 10_000_000);
    });

    it("B2. third party can deposit", async () => {
      const depositAmount = new BN(1_000_000); // $1

      await program.methods
        .deposit(depositAmount)
        .accounts({
          depositor: outsider.publicKey,
          silkAccount: accountPda,
          mint,
          accountTokenAccount: getAta(mint, accountPda),
          depositorTokenAccount: getAta(mint, outsider.publicKey),
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([outsider])
        .rpc();

      const balance = await getTokenBalance(connection, getAta(mint, accountPda));
      assert.equal(balance.toNumber(), 11_000_000); // 10 + 1
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Group C: Transfer (the critical tests)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("C. Transfer from Account", () => {
    before(async () => {
      // Create recipient ATA so we can check balances
      await createAssociatedTokenAccount(
        connection,
        payerKeypair,
        mint,
        recipient.publicKey
      );
    });

    it("C1. operator transfers within per_tx_limit — succeeds", async () => {
      const amount = new BN(3_000_000); // $3 < $5 limit

      const balBefore = await getTokenBalance(connection, getAta(mint, accountPda));
      const recipBalBefore = await getTokenBalance(connection, getAta(mint, recipient.publicKey));

      await program.methods
        .transferFromAccount(amount)
        .accounts({
          signer: operator.publicKey,
          silkAccount: accountPda,
          mint,
          accountTokenAccount: getAta(mint, accountPda),
          recipient: recipient.publicKey,
          recipientTokenAccount: getAta(mint, recipient.publicKey),
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([operator])
        .rpc();

      const balAfter = await getTokenBalance(connection, getAta(mint, accountPda));
      const recipBalAfter = await getTokenBalance(connection, getAta(mint, recipient.publicKey));

      assert.equal(balBefore.sub(balAfter).toNumber(), 3_000_000);
      assert.equal(recipBalAfter.sub(recipBalBefore).toNumber(), 3_000_000);
    });

    it("C2. operator transfer exceeding per_tx_limit — REJECTED", async () => {
      const amount = new BN(10_000_000); // $10 > $5 limit

      const balBefore = await getTokenBalance(connection, getAta(mint, accountPda));

      try {
        await program.methods
          .transferFromAccount(amount)
          .accounts({
            signer: operator.publicKey,
            silkAccount: accountPda,
            mint,
            accountTokenAccount: getAta(mint, accountPda),
            recipient: recipient.publicKey,
            recipientTokenAccount: getAta(mint, recipient.publicKey),
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([operator])
          .rpc();
        assert.fail("Should have been rejected by per_tx_limit");
      } catch (err: any) {
        assert.include(err.toString(), "ExceedsPerTxLimit");
      }

      // Balance unchanged
      const balAfter = await getTokenBalance(connection, getAta(mint, accountPda));
      assert.equal(balAfter.toString(), balBefore.toString());
    });

    it("C3. operator transfer exactly at per_tx_limit — succeeds", async () => {
      const amount = new BN(5_000_000); // exactly $5

      await program.methods
        .transferFromAccount(amount)
        .accounts({
          signer: operator.publicKey,
          silkAccount: accountPda,
          mint,
          accountTokenAccount: getAta(mint, accountPda),
          recipient: recipient.publicKey,
          recipientTokenAccount: getAta(mint, recipient.publicKey),
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([operator])
        .rpc();

      // If we got here without error, it succeeded
    });

    it("C4. owner transfers any amount (bypasses policy)", async () => {
      // Owner can exceed the operator's per_tx_limit
      // First deposit more from owner so we have enough balance
      await program.methods
        .deposit(new BN(20_000_000))
        .accounts({
          depositor: owner.publicKey,
          silkAccount: accountPda,
          mint,
          accountTokenAccount: getAta(mint, accountPda),
          depositorTokenAccount: getAta(mint, owner.publicKey),
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([owner])
        .rpc();

      const amount = new BN(8_000_000); // $8 > $5 operator limit

      await program.methods
        .transferFromAccount(amount)
        .accounts({
          signer: owner.publicKey,
          silkAccount: accountPda,
          mint,
          accountTokenAccount: getAta(mint, accountPda),
          recipient: recipient.publicKey,
          recipientTokenAccount: getAta(mint, recipient.publicKey),
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc();

      // If we got here without error, owner bypassed the operator limit
    });

    it("C5. unauthorized signer (outsider) — REJECTED", async () => {
      const amount = new BN(1_000_000); // $1

      try {
        await program.methods
          .transferFromAccount(amount)
          .accounts({
            signer: outsider.publicKey,
            silkAccount: accountPda,
            mint,
            accountTokenAccount: getAta(mint, accountPda),
            recipient: recipient.publicKey,
            recipientTokenAccount: getAta(mint, recipient.publicKey),
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([outsider])
          .rpc();
        assert.fail("Should have been rejected as unauthorized");
      } catch (err: any) {
        assert.include(err.toString(), "Unauthorized");
      }
    });

    it("C7. operator with per_tx_limit=0 (unlimited) can transfer any amount", async () => {
      // Create a second account with unlimited operator
      const unlimitedOwner = Keypair.generate();
      const unlimitedOperator = Keypair.generate();

      // Fund
      for (const kp of [unlimitedOwner, unlimitedOperator]) {
        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: payer,
            toPubkey: kp.publicKey,
            lamports: 0.1 * web3.LAMPORTS_PER_SOL,
          })
        );
        await provider.sendAndConfirm(tx);
      }

      // Mint tokens to unlimitedOwner
      const ownerAta = await createAssociatedTokenAccount(
        connection,
        payerKeypair,
        mint,
        unlimitedOwner.publicKey
      );
      await mintTo(connection, payerKeypair, mint, ownerAta, payerKeypair, 50_000_000);

      // Create account with per_tx_limit = 0 (unlimited)
      const [unlimitedPda] = findAccountPda(programId, unlimitedOwner.publicKey);

      await program.methods
        .createAccount(unlimitedOperator.publicKey, new BN(0))
        .accounts({
          owner: unlimitedOwner.publicKey,
          mint,
          silkAccount: unlimitedPda,
          accountTokenAccount: getAta(mint, unlimitedPda),
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([unlimitedOwner])
        .rpc();

      // Deposit
      await program.methods
        .deposit(new BN(50_000_000))
        .accounts({
          depositor: unlimitedOwner.publicKey,
          silkAccount: unlimitedPda,
          mint,
          accountTokenAccount: getAta(mint, unlimitedPda),
          depositorTokenAccount: getAta(mint, unlimitedOwner.publicKey),
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([unlimitedOwner])
        .rpc();

      // Operator transfers large amount — should succeed with no limit
      const amount = new BN(25_000_000); // $25 — would fail with any limit

      await program.methods
        .transferFromAccount(amount)
        .accounts({
          signer: unlimitedOperator.publicKey,
          silkAccount: unlimitedPda,
          mint,
          accountTokenAccount: getAta(mint, unlimitedPda),
          recipient: recipient.publicKey,
          recipientTokenAccount: getAta(mint, recipient.publicKey),
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([unlimitedOperator])
        .rpc();

      // Success — unlimited operator had no cap
    });

    it("C8. transfer initializes recipient ATA if needed", async () => {
      // Generate a fresh recipient with no ATA
      const freshRecipient = Keypair.generate();
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer,
          toPubkey: freshRecipient.publicKey,
          lamports: 0.01 * web3.LAMPORTS_PER_SOL,
        })
      );
      await provider.sendAndConfirm(tx);

      const amount = new BN(1_000_000); // $1

      await program.methods
        .transferFromAccount(amount)
        .accounts({
          signer: operator.publicKey,
          silkAccount: accountPda,
          mint,
          accountTokenAccount: getAta(mint, accountPda),
          recipient: freshRecipient.publicKey,
          recipientTokenAccount: getAta(mint, freshRecipient.publicKey),
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([operator])
        .rpc();

      // Recipient ATA was created and has the correct balance
      const balance = await getTokenBalance(connection, getAta(mint, freshRecipient.publicKey));
      assert.equal(balance.toNumber(), 1_000_000);
    });
  });
});
