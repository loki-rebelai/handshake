# Decline Transfer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add receiver-initiated `decline_transfer` instruction and update `reject_transfer` to give sender full refund (no fee on rejection).

**Architecture:** Two on-chain changes: (1) simplify `reject_transfer` to remove fee logic and change args to `reason: Option<u8>`, (2) add new `decline_transfer` instruction with identical refund behavior but recipient as signer. Both close the transfer account and refund sender in full.

**Tech Stack:** Rust/Anchor 0.32.1, TypeScript/ts-mocha for tests.

---

### Task 1: Add `Declined` status and `mark_as_declined()` to state

**Files:**
- Modify: `programs/handshake/src/state/secure_transfer.rs:43-50` (TransferStatus enum)
- Modify: `programs/handshake/src/state/secure_transfer.rs:224-228` (after mark_as_expired)

**Step 1: Add Declined variant to TransferStatus enum**

In `programs/handshake/src/state/secure_transfer.rs`, add `Declined` after `Expired`:

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Debug)]
pub enum TransferStatus {
    Active,
    Claimed,
    Cancelled,
    Rejected,
    Expired,
    Declined,
}
```

**Step 2: Add mark_as_declined() method**

After `mark_as_expired()` in the `impl SecureTransfer` block, add:

```rust
    /// Mark as declined
    pub fn mark_as_declined(&mut self) -> Result<()> {
        self.validate_active()?;
        self.status = TransferStatus::Declined;
        Ok(())
    }
```

**Step 3: Verify it compiles**

Run: `cd /home/si/projects/handshake && anchor build 2>&1 | tail -5`
Expected: Build succeeds (no errors)

**Step 4: Commit**

```bash
git add programs/handshake/src/state/secure_transfer.rs
git commit -m "feat: add Declined status variant and mark_as_declined()"
```

---

### Task 2: Add new error variants

**Files:**
- Modify: `programs/handshake/src/errors.rs:86-88` (before closing brace)

**Step 1: Add error variants**

In `programs/handshake/src/errors.rs`, add before the closing `}`:

```rust
    #[msg("Transfer already declined")]
    TransferAlreadyDeclined,

    #[msg("Only recipient can decline transfer")]
    OnlyRecipientCanDecline,
```

**Step 2: Verify it compiles**

Run: `cd /home/si/projects/handshake && anchor build 2>&1 | tail -5`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add programs/handshake/src/errors.rs
git commit -m "feat: add TransferAlreadyDeclined and OnlyRecipientCanDecline errors"
```

---

### Task 3: Update `reject_transfer` — remove fee, change args

**Files:**
- Modify: `programs/handshake/src/instructions/reject_transfer.rs` (full file)

**Step 1: Rewrite reject_transfer.rs**

Replace the entire file content with:

```rust
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{transfer_checked, TransferChecked, Mint, TokenAccount, TokenInterface};
use crate::{state::*, errors::*, constants::*};

/// Reject a transfer as the operator (full refund to sender, no fee)
pub fn reject_transfer<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, RejectTransfer<'info>>,
    reason: Option<u8>,
) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let transfer = &mut ctx.accounts.transfer;

    // Validate operator
    require!(
        ctx.accounts.operator.key() == pool.operator,
        HandshakeError::Unauthorized
    );

    // Validate transfer is active
    transfer.validate_active()?;

    // Transfer full amount back to sender (no fee on rejection)
    let pool_seeds = &[POOL_SEED, pool.pool_id.as_ref(), &[pool.bump]];
    let pool_signer_seeds = &[&pool_seeds[..]];

    let transfer_accounts = TransferChecked {
        from: ctx.accounts.pool_token_account.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.sender_token_account.to_account_info(),
        authority: pool.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        transfer_accounts,
        pool_signer_seeds,
    );
    transfer_checked(cpi_ctx, transfer.amount, ctx.accounts.mint.decimals)?;

    // Update pool accounting
    pool.add_withdrawal(transfer.amount)?;
    pool.increment_transfers_resolved()?;

    // Mark transfer as rejected
    transfer.mark_as_rejected()?;

    emit!(TransferRejected {
        transfer: transfer.key(),
        pool: pool.key(),
        sender: transfer.sender,
        recipient: transfer.recipient,
        amount: transfer.amount,
        reason,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct RejectTransfer<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,

    /// The pool this transfer belongs to
    #[account(
        mut,
        seeds = [
            POOL_SEED,
            pool.pool_id.as_ref()
        ],
        bump = pool.bump
    )]
    pub pool: Box<Account<'info, Pool>>,

    /// The mint for validation
    #[account(
        constraint = mint.key() == pool.mint
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    /// Pool's token account
    #[account(
        mut,
        associated_token::mint = pool.mint,
        associated_token::authority = pool,
        associated_token::token_program = token_program
    )]
    pub pool_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Sender's token account to receive refund
    #[account(
        mut,
        associated_token::mint = pool.mint,
        associated_token::authority = transfer.sender,
        associated_token::token_program = token_program
    )]
    pub sender_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Transfer account to reject (closed to sender)
    #[account(
        mut,
        close = sender,
        constraint = transfer.pool == pool.key()
    )]
    pub transfer: Box<Account<'info, SecureTransfer>>,

    /// CHECK: Sender receives rent refund on close. Validated via transfer.sender constraint.
    #[account(mut)]
    pub sender: AccountInfo<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[event]
pub struct TransferRejected {
    pub transfer: Pubkey,
    pub pool: Pubkey,
    pub sender: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub reason: Option<u8>,
}
```

**Step 2: Update lib.rs entry point**

In `programs/handshake/src/lib.rs`, change the `reject_transfer` function signature from:

```rust
    pub fn reject_transfer<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, RejectTransfer<'info>>,
        reason_code: u8,
        reason_message: String,
    ) -> Result<()> {
        instructions::reject_transfer(ctx, reason_code, reason_message)
    }
```

To:

```rust
    pub fn reject_transfer<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, RejectTransfer<'info>>,
        reason: Option<u8>,
    ) -> Result<()> {
        instructions::reject_transfer(ctx, reason)
    }
```

**Step 3: Verify it compiles**

Run: `cd /home/si/projects/handshake && anchor build 2>&1 | tail -5`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add programs/handshake/src/instructions/reject_transfer.rs programs/handshake/src/lib.rs
git commit -m "feat: update reject_transfer to full refund, reason: Option<u8>"
```

---

### Task 4: Add `decline_transfer` instruction

**Files:**
- Create: `programs/handshake/src/instructions/decline_transfer.rs`
- Modify: `programs/handshake/src/instructions/mod.rs:1-24`
- Modify: `programs/handshake/src/lib.rs` (add entry point)

**Step 1: Create decline_transfer.rs**

Create `programs/handshake/src/instructions/decline_transfer.rs` with:

```rust
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{transfer_checked, TransferChecked, Mint, TokenAccount, TokenInterface};
use crate::{state::*, errors::*, constants::*};

/// Decline a transfer as the recipient (full refund to sender, no fee)
pub fn decline_transfer<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, DeclineTransfer<'info>>,
    reason: Option<u8>,
) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let transfer = &mut ctx.accounts.transfer;

    // Validate recipient
    require!(
        ctx.accounts.recipient.key() == transfer.recipient,
        HandshakeError::Unauthorized
    );

    // Validate transfer is active
    transfer.validate_active()?;

    // Transfer full amount back to sender (no fee on decline)
    let pool_seeds = &[POOL_SEED, pool.pool_id.as_ref(), &[pool.bump]];
    let pool_signer_seeds = &[&pool_seeds[..]];

    let transfer_accounts = TransferChecked {
        from: ctx.accounts.pool_token_account.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.sender_token_account.to_account_info(),
        authority: pool.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        transfer_accounts,
        pool_signer_seeds,
    );
    transfer_checked(cpi_ctx, transfer.amount, ctx.accounts.mint.decimals)?;

    // Update pool accounting
    pool.add_withdrawal(transfer.amount)?;
    pool.increment_transfers_resolved()?;

    // Mark transfer as declined
    transfer.mark_as_declined()?;

    emit!(TransferDeclined {
        transfer: transfer.key(),
        pool: pool.key(),
        sender: transfer.sender,
        recipient: transfer.recipient,
        amount: transfer.amount,
        reason,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct DeclineTransfer<'info> {
    #[account(mut)]
    pub recipient: Signer<'info>,

    /// The pool this transfer belongs to
    #[account(
        mut,
        seeds = [
            POOL_SEED,
            pool.pool_id.as_ref()
        ],
        bump = pool.bump
    )]
    pub pool: Box<Account<'info, Pool>>,

    /// The mint for validation
    #[account(
        constraint = mint.key() == pool.mint
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    /// Pool's token account
    #[account(
        mut,
        associated_token::mint = pool.mint,
        associated_token::authority = pool,
        associated_token::token_program = token_program
    )]
    pub pool_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Sender's token account to receive refund
    #[account(
        mut,
        associated_token::mint = pool.mint,
        associated_token::authority = transfer.sender,
        associated_token::token_program = token_program
    )]
    pub sender_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Transfer account to decline (closed to sender)
    #[account(
        mut,
        close = sender,
        constraint = transfer.pool == pool.key()
    )]
    pub transfer: Box<Account<'info, SecureTransfer>>,

    /// CHECK: Sender receives rent refund on close. Validated via transfer.sender constraint.
    #[account(mut)]
    pub sender: AccountInfo<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[event]
pub struct TransferDeclined {
    pub transfer: Pubkey,
    pub pool: Pubkey,
    pub sender: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub reason: Option<u8>,
}
```

**Step 2: Add module to instructions/mod.rs**

In `programs/handshake/src/instructions/mod.rs`, add after the `reject_transfer` lines:

```
mod decline_transfer;
```

And add in the `pub use` section:

```
pub use decline_transfer::*;
```

The full file should be:

```rust
mod init_pool;
mod create_transfer;
mod claim_transfer;
mod cancel_transfer;
mod reject_transfer;
mod decline_transfer;
mod expire_transfer;
mod withdraw_fees;
mod destroy_transfer;
mod pause_pool;
mod reset_pool;
mod close_pool;

pub use init_pool::*;
pub use create_transfer::*;
pub use claim_transfer::*;
pub use cancel_transfer::*;
pub use reject_transfer::*;
pub use decline_transfer::*;
pub use expire_transfer::*;
pub use withdraw_fees::*;
pub use destroy_transfer::*;
pub use pause_pool::*;
pub use reset_pool::*;
pub use close_pool::*;
```

**Step 3: Add entry point in lib.rs**

In `programs/handshake/src/lib.rs`, add after the `reject_transfer` entry point:

```rust
    pub fn decline_transfer<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, DeclineTransfer<'info>>,
        reason: Option<u8>,
    ) -> Result<()> {
        instructions::decline_transfer(ctx, reason)
    }
```

**Step 4: Verify it compiles**

Run: `cd /home/si/projects/handshake && anchor build 2>&1 | tail -5`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add programs/handshake/src/instructions/decline_transfer.rs programs/handshake/src/instructions/mod.rs programs/handshake/src/lib.rs
git commit -m "feat: add decline_transfer instruction for receiver rejection"
```

---

### Task 5: Update existing reject_transfer tests

**Files:**
- Modify: `tests/handshake.ts`

**Step 1: Update test C4 — operator rejects transfer (now full refund)**

Find test `C4. operator rejects transfer (sender gets 97.5% back, fee kept)` and replace with:

```typescript
    it("C4. operator rejects transfer (sender gets full refund, no fee)", async () => {
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

      // Operator rejects with reason code
      await program.methods
        .rejectTransfer(1)
        .accounts(rejectTransferAccounts(operator, sender.publicKey, feePoolPda, mint, transferPda))
        .rpc();

      // Transfer account closed
      const closed = await connection.getAccountInfo(transferPda);
      assert.isNull(closed);

      // Sender gets full refund (no fee deducted)
      const senderBalAfter = await getTokenBalance(connection, getAta(mint, sender.publicKey));
      assert.equal(
        senderBalAfter.toString(),
        senderBalBefore.toString(),
        "Sender should get full refund"
      );

      // Pool collected fees should NOT increase
      const pool = await program.account.pool.fetch(feePoolPda);
      assert.equal(
        pool.collectedFees.toString(),
        poolFeesBefore.toString(),
        "No fees collected on rejection"
      );
    });
```

**Step 2: Update test C5 — reject auth test call signature**

In test `C5. fails when non-operator tries to reject`, change:

```typescript
        .rejectTransfer(1, "I am not the operator")
```

To:

```typescript
        .rejectTransfer(1)
```

**Step 3: Remove test C6 (reason_message length validation no longer applies)**

Delete the entire test `C6. fails to reject with reason_message > 200 chars` since we no longer have a reason_message parameter.

**Step 4: Verify tests compile and pass**

Run: `cd /home/si/projects/handshake && anchor test 2>&1 | tail -30`
Expected: All tests pass

**Step 5: Commit**

```bash
git add tests/handshake.ts
git commit -m "test: update reject_transfer tests for full refund behavior"
```

---

### Task 6: Add decline_transfer tests

**Files:**
- Modify: `tests/handshake.ts`

**Step 1: Add declineTransferAccounts helper**

After the `rejectTransferAccounts` helper function (around line 146), add:

```typescript
/** Build and return the accounts object for declineTransfer */
function declineTransferAccounts(
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
    senderTokenAccount: getAta(mint, sender),
    transfer: transferPda,
    sender,
    tokenProgram: TOKEN_PROGRAM_ID,
  };
}
```

**Step 2: Add decline_transfer test group**

After Group C (Transfer Lifecycle 2.5% fee pool), add a new test group. Insert after the closing `});` of Group C and before `// Group D`:

```typescript
  // ═══════════════════════════════════════════════════════════════════════════
  // Group C2: Decline Transfer (receiver rejects)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("C2. Decline Transfer (receiver rejects)", () => {
    const TRANSFER_AMOUNT = new BN(10_000 * 1_000_000); // 10,000 tokens

    it("C2a. recipient declines transfer (sender gets full refund)", async () => {
      const nonce = nextNonce();
      const [transferPda] = findTransferPda(programId, sender.publicKey, recipient.publicKey, nonce);

      const senderBalBefore = await getTokenBalance(connection, getAta(mint, sender.publicKey));
      const poolFeesBefore = (await program.account.pool.fetch(feePoolPda)).collectedFees;

      // Create
      await program.methods
        .createTransfer(recipient.publicKey, nonce, TRANSFER_AMOUNT, "decline test", new BN(0), new BN(0))
        .accounts(createTransferAccounts(sender.publicKey, feePoolPda, mint, transferPda))
        .signers([sender])
        .rpc();

      // Recipient declines with reason code
      await program.methods
        .declineTransfer(1)
        .accounts(declineTransferAccounts(recipient.publicKey, sender.publicKey, feePoolPda, mint, transferPda))
        .signers([recipient])
        .rpc();

      // Transfer account closed
      const closed = await connection.getAccountInfo(transferPda);
      assert.isNull(closed);

      // Sender gets full refund
      const senderBalAfter = await getTokenBalance(connection, getAta(mint, sender.publicKey));
      assert.equal(
        senderBalAfter.toString(),
        senderBalBefore.toString(),
        "Sender should get full refund on decline"
      );

      // Pool collected fees should NOT increase
      const pool = await program.account.pool.fetch(feePoolPda);
      assert.equal(
        pool.collectedFees.toString(),
        poolFeesBefore.toString(),
        "No fees collected on decline"
      );
    });

    it("C2b. recipient declines with no reason (reason = null)", async () => {
      const nonce = nextNonce();
      const [transferPda] = findTransferPda(programId, sender.publicKey, recipient.publicKey, nonce);

      const senderBalBefore = await getTokenBalance(connection, getAta(mint, sender.publicKey));

      // Create
      await program.methods
        .createTransfer(recipient.publicKey, nonce, TRANSFER_AMOUNT, "no reason", new BN(0), new BN(0))
        .accounts(createTransferAccounts(sender.publicKey, feePoolPda, mint, transferPda))
        .signers([sender])
        .rpc();

      // Recipient declines with no reason
      await program.methods
        .declineTransfer(null)
        .accounts(declineTransferAccounts(recipient.publicKey, sender.publicKey, feePoolPda, mint, transferPda))
        .signers([recipient])
        .rpc();

      // Transfer account closed
      const closed = await connection.getAccountInfo(transferPda);
      assert.isNull(closed);

      // Sender gets full refund
      const senderBalAfter = await getTokenBalance(connection, getAta(mint, sender.publicKey));
      assert.equal(
        senderBalAfter.toString(),
        senderBalBefore.toString(),
        "Sender should get full refund"
      );
    });

    it("C2c. fails when non-recipient tries to decline", async () => {
      const nonce = nextNonce();
      const [transferPda] = findTransferPda(programId, sender.publicKey, recipient.publicKey, nonce);

      await program.methods
        .createTransfer(recipient.publicKey, nonce, TRANSFER_AMOUNT, "auth decline", new BN(0), new BN(0))
        .accounts(createTransferAccounts(sender.publicKey, feePoolPda, mint, transferPda))
        .signers([sender])
        .rpc();

      // ThirdParty tries to decline
      try {
        await program.methods
          .declineTransfer(null)
          .accounts(declineTransferAccounts(thirdParty.publicKey, sender.publicKey, feePoolPda, mint, transferPda))
          .signers([thirdParty])
          .rpc();
        assert.fail("Non-recipient should not be able to decline");
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

    it("C2d. fails to decline an already cancelled transfer", async () => {
      const nonce = nextNonce();
      const [transferPda] = findTransferPda(programId, sender.publicKey, recipient.publicKey, nonce);

      // Create and immediately cancel
      await program.methods
        .createTransfer(recipient.publicKey, nonce, TRANSFER_AMOUNT, "cancel first", new BN(0), new BN(0))
        .accounts(createTransferAccounts(sender.publicKey, feePoolPda, mint, transferPda))
        .signers([sender])
        .rpc();

      await program.methods
        .cancelTransfer()
        .accounts(cancelTransferAccounts(sender.publicKey, feePoolPda, mint, transferPda))
        .signers([sender])
        .rpc();

      // Recipient tries to decline a closed account - should fail
      try {
        await program.methods
          .declineTransfer(null)
          .accounts(declineTransferAccounts(recipient.publicKey, sender.publicKey, feePoolPda, mint, transferPda))
          .signers([recipient])
          .rpc();
        assert.fail("Should not be able to decline a cancelled transfer");
      } catch (err: any) {
        assert.ok(err);
      }
    });
  });
```

**Step 3: Verify tests compile and pass**

Run: `cd /home/si/projects/handshake && anchor test 2>&1 | tail -30`
Expected: All tests pass (existing + new decline tests)

**Step 4: Commit**

```bash
git add tests/handshake.ts
git commit -m "test: add decline_transfer test suite"
```

---

### Task 7: Final verification

**Step 1: Full build**

Run: `cd /home/si/projects/handshake && anchor build 2>&1 | tail -5`
Expected: Build succeeds

**Step 2: Run full test suite**

Run: `cd /home/si/projects/handshake && anchor test 2>&1 | tail -40`
Expected: All tests pass, no regressions

**Step 3: Commit any remaining changes**

If all passes, no action needed. If there are IDL changes from anchor build, commit those:

```bash
git add target/types/ target/idl/
git commit -m "chore: update generated IDL and types"
```
