# Silkysig Smart Contract — Implementation Plan

## Overview

New Anchor program "Silkysig" — policy-controlled agent accounts on Solana. One account per owner, with up to 3 operators each bound by per-transaction spending limits enforced on-chain. Direct SPL token transfers (no escrow). Lives alongside Handshake in the same Anchor workspace.

**Program name:** `silkysig`
**Workspace:** `anchor/programs/silkysig/`
**Account PDA:** `seeds = [b"account", owner.key()]`

---

## Task 1: Scaffold the Silkysig program

**What:** Create the Anchor program directory structure mirroring Handshake's module layout.

**Files to create:**

### `anchor/programs/silkysig/Cargo.toml`
```toml
[package]
name = "silkysig"
version = "0.1.0"
description = "Policy-controlled agent accounts on Solana"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]

[features]
idl-build = ["anchor-lang/idl-build", "anchor-spl/idl-build"]

[dependencies]
anchor-lang = { version = "0.32.1", features = ["init-if-needed"] }
anchor-spl = "0.32.1"
```

### `anchor/programs/silkysig/src/lib.rs`
```rust
use anchor_lang::prelude::*;

mod constants;
mod errors;
mod instructions;
mod state;

use instructions::*;
use state::*;

declare_id!("TEMP_PLACEHOLDER_WILL_BE_REPLACED_AFTER_KEYGEN");

#[program]
pub mod silkysig {
    use super::*;

    pub fn create_account(
        ctx: Context<CreateAccount>,
        operator: Option<Pubkey>,
        per_tx_limit: Option<u64>,
    ) -> Result<()> {
        instructions::create_account(ctx, operator, per_tx_limit)
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit(ctx, amount)
    }

    pub fn transfer_from_account<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, TransferFromAccount<'info>>,
        amount: u64,
    ) -> Result<()> {
        instructions::transfer_from_account(ctx, amount)
    }
}
```

### `anchor/programs/silkysig/src/constants.rs`
```rust
pub const ACCOUNT_SEED: &[u8] = b"account";
```

### `anchor/programs/silkysig/src/errors.rs`
```rust
use anchor_lang::prelude::*;

#[error_code]
pub enum SilkysigError {
    #[msg("Unauthorized: signer is not owner or operator")]
    Unauthorized,

    #[msg("Transfer exceeds operator per-transaction limit")]
    ExceedsPerTxLimit,

    #[msg("Transfer exceeds operator daily limit")]
    ExceedsDailyLimit,

    #[msg("Account is paused")]
    AccountPaused,

    #[msg("Maximum operators reached")]
    MaxOperatorsReached,

    #[msg("Operator not found")]
    OperatorNotFound,

    #[msg("Operator slot already occupied")]
    OperatorAlreadyExists,

    #[msg("Insufficient token balance")]
    InsufficientBalance,

    #[msg("Mathematical overflow")]
    MathOverflow,
}
```

### `anchor/programs/silkysig/src/state/mod.rs`
```rust
mod account;

pub use account::*;
```

### `anchor/programs/silkysig/src/instructions/mod.rs`
```rust
mod create_account;
mod deposit;
mod transfer_from_account;

pub use create_account::*;
pub use deposit::*;
pub use transfer_from_account::*;
```

**Files to modify:**

### `anchor/Anchor.toml` — add Silkysig program entry

Add under `[programs.localnet]`:
```toml
silkysig = "TEMP_PLACEHOLDER_WILL_BE_REPLACED_AFTER_KEYGEN"
```

**Verification:**
```bash
cd anchor && anchor keys generate silkysig
```
Then replace both `TEMP_PLACEHOLDER_WILL_BE_REPLACED_AFTER_KEYGEN` values (in `lib.rs` and `Anchor.toml`) with the generated program ID. Then run:
```bash
cd anchor && anchor build -p silkysig
```
Expected: compiles with no errors (instructions are stubs/empty at this point — fill in state first, then instructions).

---

## Task 2: Implement account state

**What:** Define `SilkAccount` and `OperatorSlot` structs.

**File to create:** `anchor/programs/silkysig/src/state/account.rs`

```rust
use anchor_lang::prelude::*;

pub const MAX_OPERATORS: usize = 3;

#[account]
pub struct SilkAccount {
    /// Version for future upgrades
    pub version: u8,

    /// PDA bump
    pub bump: u8,

    /// Account owner (human) — full control, bypasses all policies
    pub owner: Pubkey,

    /// Token mint this account holds
    pub mint: Pubkey,

    /// Circuit breaker — paused accounts block all operator transfers
    pub is_paused: bool,

    /// Number of active operators (0-3)
    pub operator_count: u8,

    /// Operator slots — each with independent policy
    pub operators: [OperatorSlot; MAX_OPERATORS],
}

impl SilkAccount {
    pub const SPACE: usize = 8  // discriminator
        + 1                     // version
        + 1                     // bump
        + 32                    // owner
        + 32                    // mint
        + 1                     // is_paused
        + 1                     // operator_count
        + (MAX_OPERATORS * OperatorSlot::SPACE); // operators

    /// Find the operator slot index for a given pubkey.
    /// Returns None if the pubkey is not an active operator.
    pub fn find_operator(&self, pubkey: &Pubkey) -> Option<usize> {
        for i in 0..self.operator_count as usize {
            if self.operators[i].pubkey == *pubkey {
                return Some(i);
            }
        }
        None
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct OperatorSlot {
    /// Operator public key (Pubkey::default() = empty slot)
    pub pubkey: Pubkey,

    /// Max amount per transaction in token smallest units (0 = no limit)
    pub per_tx_limit: u64,

    /// Max amount per day in token smallest units (0 = no limit, not enforced yet)
    pub daily_limit: u64,

    /// Tracks daily spend (for future enforcement)
    pub daily_spent: u64,

    /// Timestamp of last daily reset (for future enforcement)
    pub last_reset: i64,
}

impl OperatorSlot {
    pub const SPACE: usize = 32  // pubkey
        + 8                      // per_tx_limit
        + 8                      // daily_limit
        + 8                      // daily_spent
        + 8;                     // last_reset
}
```

**Verification:**
```bash
cd anchor && anchor build -p silkysig
```
Expected: compiles. The `SPACE` constant should equal `8 + 1 + 1 + 32 + 32 + 1 + 1 + (3 * 64) = 268`.

---

## Task 3: Implement `create_account` instruction

**What:** Owner creates an account PDA with a specified mint. Optionally adds the first operator with a per-tx limit. Initializes the account PDA's associated token account for the specified mint.

**File to create:** `anchor/programs/silkysig/src/instructions/create_account.rs`

```rust
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};
use crate::{state::*, errors::*, constants::*};

pub fn create_account(
    ctx: Context<CreateAccount>,
    operator: Option<Pubkey>,
    per_tx_limit: Option<u64>,
) -> Result<()> {
    let account = &mut ctx.accounts.silkyway_account;

    account.version = 1;
    account.bump = ctx.bumps.silkyway_account;
    account.owner = ctx.accounts.owner.key();
    account.mint = ctx.accounts.mint.key();
    account.is_paused = false;
    account.operator_count = 0;
    account.operators = [OperatorSlot::default(); MAX_OPERATORS];

    // Optionally add first operator
    if let Some(op_pubkey) = operator {
        account.operators[0] = OperatorSlot {
            pubkey: op_pubkey,
            per_tx_limit: per_tx_limit.unwrap_or(0),
            daily_limit: 0,
            daily_spent: 0,
            last_reset: 0,
        };
        account.operator_count = 1;
    }

    emit!(AccountCreated {
        account: account.key(),
        owner: account.owner,
        mint: account.mint,
        operator,
        per_tx_limit,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct CreateAccount<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    /// The token mint this account will hold
    pub mint: InterfaceAccount<'info, Mint>,

    /// Account PDA — one per owner
    #[account(
        init,
        payer = owner,
        space = SilkAccount::SPACE,
        seeds = [ACCOUNT_SEED, owner.key().as_ref()],
        bump
    )]
    pub silkyway_account: Box<Account<'info, SilkAccount>>,

    /// Account's token account — initialized eagerly so direct SPL transfers work immediately
    #[account(
        init,
        payer = owner,
        associated_token::mint = mint,
        associated_token::authority = silkyway_account,
        associated_token::token_program = token_program
    )]
    pub account_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct AccountCreated {
    pub account: Pubkey,
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub operator: Option<Pubkey>,
    pub per_tx_limit: Option<u64>,
}
```

**Key details:**
- PDA seeds: `[b"account", owner.key()]` — deterministic, one per owner
- ATA is initialized eagerly via `associated_token::authority = silkyway_account` — Anchor handles the off-curve PDA ATA derivation with `allowOwnerOffCurve` automatically
- `operator` and `per_tx_limit` are both optional — account can be created empty
- Owner pays rent for both PDA and ATA

**Verification:**
```bash
cd anchor && anchor build -p silkysig
```
Expected: compiles with no errors.

---

## Task 4: Implement `deposit` instruction

**What:** Transfer SPL tokens from the depositor's ATA to the account PDA's ATA. Entry point for wallets that can't send to off-curve ATAs directly.

**File to create:** `anchor/programs/silkysig/src/instructions/deposit.rs`

```rust
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, TransferChecked, Mint, TokenAccount, TokenInterface,
};
use crate::{state::*, constants::*};

pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    let transfer_accounts = TransferChecked {
        from: ctx.accounts.depositor_token_account.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.account_token_account.to_account_info(),
        authority: ctx.accounts.depositor.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        transfer_accounts,
    );
    transfer_checked(cpi_ctx, amount, ctx.accounts.mint.decimals)?;

    emit!(Deposited {
        account: ctx.accounts.silkyway_account.key(),
        depositor: ctx.accounts.depositor.key(),
        mint: ctx.accounts.mint.key(),
        amount,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,

    /// The Silkyway account receiving the deposit
    #[account(
        seeds = [ACCOUNT_SEED, silkyway_account.owner.as_ref()],
        bump = silkyway_account.bump,
    )]
    pub silkyway_account: Box<Account<'info, SilkAccount>>,

    /// Mint must match the account's mint
    #[account(
        constraint = mint.key() == silkyway_account.mint
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    /// Account PDA's token account (destination)
    #[account(
        mut,
        associated_token::mint = silkyway_account.mint,
        associated_token::authority = silkyway_account,
        associated_token::token_program = token_program
    )]
    pub account_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Depositor's token account (source)
    #[account(
        mut,
        associated_token::mint = silkyway_account.mint,
        associated_token::authority = depositor,
        associated_token::token_program = token_program
    )]
    pub depositor_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[event]
pub struct Deposited {
    pub account: Pubkey,
    pub depositor: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
}
```

**Key details:**
- Anyone can deposit (no signer check against owner/operator)
- Uses `transfer_checked` for Token-2022 compatibility (matches Handshake pattern)
- Mint is validated against the account's stored mint
- The account PDA itself is not mutated — only the ATA balance changes

**Verification:**
```bash
cd anchor && anchor build -p silkysig
```
Expected: compiles with no errors.

---

## Task 5: Implement `transfer_from_account` instruction

**What:** The critical instruction. Operator or owner sends tokens from the account PDA's ATA to a recipient. If signer is an operator, enforces `per_tx_limit`. If signer is the owner, no policy checks. Emits event. Signer pays recipient ATA initialization if needed.

**File to create:** `anchor/programs/silkysig/src/instructions/transfer_from_account.rs`

```rust
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{
        transfer_checked, TransferChecked, Mint, TokenAccount, TokenInterface,
    },
};
use crate::{state::*, errors::*, constants::*};

pub fn transfer_from_account<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, TransferFromAccount<'info>>,
    amount: u64,
) -> Result<()> {
    let account = &ctx.accounts.silkyway_account;
    let signer_key = ctx.accounts.signer.key();

    if signer_key == account.owner {
        // Owner: no policy checks
    } else if let Some(idx) = account.find_operator(&signer_key) {
        // Operator: enforce policies
        require!(!account.is_paused, SilkysigError::AccountPaused);

        let operator = &account.operators[idx];
        if operator.per_tx_limit > 0 {
            require!(amount <= operator.per_tx_limit, SilkysigError::ExceedsPerTxLimit);
        }
    } else {
        return Err(SilkysigError::Unauthorized.into());
    }

    // Transfer tokens from account PDA's ATA to recipient's ATA
    let owner_key = account.owner;
    let account_seeds = &[
        ACCOUNT_SEED,
        owner_key.as_ref(),
        &[account.bump],
    ];
    let signer_seeds = &[&account_seeds[..]];

    let transfer_accounts = TransferChecked {
        from: ctx.accounts.account_token_account.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.recipient_token_account.to_account_info(),
        authority: ctx.accounts.silkyway_account.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        transfer_accounts,
        signer_seeds,
    );
    transfer_checked(cpi_ctx, amount, ctx.accounts.mint.decimals)?;

    emit!(TransferExecuted {
        account: ctx.accounts.silkyway_account.key(),
        signer: signer_key,
        recipient: ctx.accounts.recipient.key(),
        mint: ctx.accounts.mint.key(),
        amount,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct TransferFromAccount<'info> {
    /// Owner or operator — pays for recipient ATA init if needed
    #[account(mut)]
    pub signer: Signer<'info>,

    /// The Silkyway account to transfer from
    #[account(
        seeds = [ACCOUNT_SEED, silkyway_account.owner.as_ref()],
        bump = silkyway_account.bump,
    )]
    pub silkyway_account: Box<Account<'info, SilkAccount>>,

    /// Mint must match the account's mint
    #[account(
        constraint = mint.key() == silkyway_account.mint
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    /// Account PDA's token account (source)
    #[account(
        mut,
        associated_token::mint = silkyway_account.mint,
        associated_token::authority = silkyway_account,
        associated_token::token_program = token_program
    )]
    pub account_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: Recipient address — only used as ATA derivation authority
    pub recipient: AccountInfo<'info>,

    /// Recipient's token account — initialized if needed, signer pays rent
    #[account(
        init_if_needed,
        payer = signer,
        associated_token::mint = silkyway_account.mint,
        associated_token::authority = recipient,
        associated_token::token_program = token_program
    )]
    pub recipient_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct TransferExecuted {
    pub account: Pubkey,
    pub signer: Pubkey,
    pub recipient: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
}
```

**Key details:**
- Signer is checked against `owner` first (bypass), then against operator slots (enforce), then rejected
- `is_paused` only blocks operators, not the owner — owner can always withdraw
- `per_tx_limit == 0` means no limit for that operator
- PDA signer seeds: `[b"account", owner.key(), &[bump]]` — standard pattern from Handshake's `claim_transfer`
- `init_if_needed` on `recipient_token_account` — signer pays ATA rent. Requires the `init-if-needed` feature on `anchor-lang` (already in Cargo.toml)
- `recipient` is an unchecked `AccountInfo` — it's only used as the ATA authority derivation key

**Verification:**
```bash
cd anchor && anchor build -p silkysig
```
Expected: compiles with no errors. Full program builds successfully.

---

## Task 6: Generate program keypair and update IDs

**What:** Generate the Silkysig program keypair and replace placeholder IDs.

**Steps:**
```bash
cd anchor
anchor keys generate silkysig
# Note the output pubkey, e.g. "Temp1arXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
```

**Files to update:**
1. `anchor/programs/silkysig/src/lib.rs` — replace `TEMP_PLACEHOLDER_WILL_BE_REPLACED_AFTER_KEYGEN` in `declare_id!()` with the generated pubkey
2. `anchor/Anchor.toml` — replace `TEMP_PLACEHOLDER_WILL_BE_REPLACED_AFTER_KEYGEN` under `[programs.localnet]` with the generated pubkey

**Verification:**
```bash
cd anchor && anchor build -p silkysig
```
Expected: builds successfully with the real program ID. Check `anchor keys list` shows both `handshake` and `silkysig`.

---

## Task 7: Write integration tests

**What:** TypeScript integration tests for all 3 instructions + error cases. Follows the same pattern as `anchor/tests/handshake.ts` — uses `@coral-xyz/anchor`, `@solana/spl-token`, `@solana/web3.js`, `chai`, `ts-mocha`.

**File to create:** `anchor/tests/silkysig.ts`

The test file should import the generated `Silkysig` type from `../target/types/silkysig` and cover the following test cases:

### Test structure:

```
describe("silkysig")
  before()
    - Create test actors: owner (Keypair), operator (Keypair), outsider (Keypair)
    - Fund all actors with SOL
    - Create a test USDC mint (6 decimals)
    - Create ATAs and mint tokens to owner

  Helper: findAccountPda(programId, owner) → [PDA, bump]
    - seeds: [Buffer.from("account"), owner.toBuffer()]

  Helper: getAta(mint, owner) → PublicKey
    - getAssociatedTokenAddressSync(mint, owner, true)  // allowOwnerOffCurve=true for PDA

  Group A: Account Creation
    A1. creates account with operator and per_tx_limit
      - Call create_account(operator.publicKey, 5_000_000) // $5 limit at 6 decimals
      - Fetch account PDA → assert version=1, owner, mint, is_paused=false, operator_count=1
      - Assert operators[0].pubkey == operator, operators[0].per_tx_limit == 5_000_000
      - Assert ATA exists and has 0 balance

    A2. creates account without operator (both args null)
      - Use a second owner keypair
      - Call create_account(null, null)
      - Fetch → assert operator_count=0, all operator slots have default pubkey

    A3. fails to create duplicate account for same owner
      - Call create_account again with original owner → expect error (Anchor init constraint)

  Group B: Deposit
    B1. owner deposits tokens via deposit instruction
      - Owner calls deposit(10_000_000) // $10
      - Assert ATA balance == 10_000_000

    B2. third party can deposit
      - Mint tokens to outsider, outsider calls deposit(1_000_000)
      - Assert ATA balance increased

  Group C: Transfer (the critical tests)
    C1. operator transfers within per_tx_limit — succeeds
      - Operator calls transfer_from_account(3_000_000) to some recipient // $3 < $5 limit
      - Assert account ATA balance decreased by 3_000_000
      - Assert recipient ATA balance increased by 3_000_000

    C2. operator transfer exceeding per_tx_limit — REJECTED
      - Operator calls transfer_from_account(10_000_000) // $10 > $5 limit
      - Expect error containing "ExceedsPerTxLimit"
      - Assert balances unchanged

    C3. operator transfer exactly at per_tx_limit — succeeds
      - Operator calls transfer_from_account(5_000_000) // exactly $5
      - Assert success

    C4. owner transfers any amount (bypasses policy)
      - Owner calls transfer_from_account(8_000_000) // $8 > $5 operator limit
      - Assert success — owner is not subject to operator policies

    C5. unauthorized signer (outsider) — REJECTED
      - Outsider calls transfer_from_account(1_000_000)
      - Expect error containing "Unauthorized"

    C6. operator transfer when account is paused — REJECTED
      - (This requires a way to pause. Since we don't have a pause instruction yet,
        we can test this by directly manipulating the account in a separate test
        OR skip this test for now and add it when pause_account instruction exists.)
      - SKIP for hackathon — note as TODO

    C7. operator with per_tx_limit=0 (unlimited) can transfer any amount
      - Create a second account with operator per_tx_limit=0
      - Operator transfers a large amount → succeeds

    C8. transfer initializes recipient ATA if needed
      - Generate a fresh recipient with no ATA
      - Operator calls transfer_from_account to this recipient
      - Assert recipient ATA was created and has the correct balance
```

**Verification:**
```bash
cd anchor && anchor test
```
Expected: all Handshake tests still pass + all Silkysig tests pass.

Alternative (Silkysig tests only):
```bash
cd anchor && yarn run ts-mocha -p ./tsconfig.json -t 1000000 "tests/silkysig.ts"
```

---

## Task 8: Full build and test verification

**What:** Final end-to-end verification that both programs build and all tests pass.

**Steps:**
```bash
cd anchor
anchor build          # Both programs
anchor test           # All tests (handshake + silkysig)
anchor keys list      # Shows both program IDs
```

**Expected output:**
- `anchor build`: both `handshake` and `silkysig` compile without errors
- `anchor test`: all existing Handshake tests pass, all new Silkysig tests pass
- `anchor keys list`: shows both program IDs

---

## Summary

| Task | Files | What |
|------|-------|------|
| 1 | 7 new files + 1 edit | Scaffold program structure |
| 2 | 1 new file | Account + OperatorSlot state |
| 3 | 1 new file | `create_account` instruction |
| 4 | 1 new file | `deposit` instruction |
| 5 | 1 new file | `transfer_from_account` instruction |
| 6 | 2 edits | Generate keypair, update IDs |
| 7 | 1 new file | Integration tests |
| 8 | 0 files | Full verification |

**Total: 11 new files, 3 edits, 3 instructions, ~8 test cases.**
