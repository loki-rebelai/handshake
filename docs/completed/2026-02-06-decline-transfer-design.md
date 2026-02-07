# Decline Transfer Design

Date: 2026-02-06

## Summary

Add a `decline_transfer` instruction that lets the receiver reject a payment. Update `reject_transfer` to remove fee collection on rejection — sender gets a full refund in both cases.

## Changes to `reject_transfer` (operator)

- Remove fee calculation and deduction. Sender receives full `transfer.amount` back.
- Remove `pool.add_collected_fees(fee)` call.
- Replace `reason_code: u8, reason_message: String` with `reason: Option<u8>`.
- Update `TransferRejected` event: drop `fee`, `net_amount`, `reason_message` fields; change `reason_code` to `reason: Option<u8>`.
- Pool accounting: `add_withdrawal(amount)` and `increment_transfers_resolved()` remain. No fee collection.

## New `decline_transfer` instruction (receiver)

### Authorization

Signer must be the `recipient` recorded on the `SecureTransfer` account.

```rust
require!(
    ctx.accounts.recipient.key() == transfer.recipient,
    HandshakeError::Unauthorized
);
```

### Arguments

- `reason: Option<u8>` — optional reason code (None = no reason given, Some(1-255) = reason code)

### Behavior

1. Validate transfer is `Active`.
2. Transfer full amount back to sender (no fee).
3. Pool accounting: `add_withdrawal(amount)`, `increment_transfers_resolved()`.
4. Mark transfer as `Declined`.
5. Close transfer account, rent refunded to sender.
6. Emit `TransferDeclined` event.

### Account context (`DeclineTransfer`)

| Account | Type | Notes |
|---|---|---|
| `recipient` | `Signer` | Must match `transfer.recipient` |
| `pool` | `Account<Pool>` (mut) | For accounting updates |
| `mint` | `InterfaceAccount<Mint>` | For `transfer_checked` CPI |
| `pool_token_account` | `InterfaceAccount<TokenAccount>` (mut) | Source of refund |
| `sender_token_account` | `InterfaceAccount<TokenAccount>` (mut) | Destination for refund |
| `transfer` | `Account<SecureTransfer>` (mut, close = sender) | Transfer being declined |
| `sender` | `AccountInfo` (mut) | Receives rent refund |
| `token_program` | `Interface<TokenInterface>` | Token program for CPI |

### Event

```rust
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

## State changes

### `TransferStatus` enum

Add `Declined` variant:

```rust
pub enum TransferStatus {
    Active,
    Claimed,
    Cancelled,
    Rejected,
    Expired,
    Declined,  // new
}
```

### `SecureTransfer` methods

Add `mark_as_declined()` — transitions `Active` to `Declined`.

## Error codes

New variants:

- `TransferAlreadyDeclined` — "Transfer already declined"
- `OnlyRecipientCanDecline` — "Only recipient can decline transfer"

## Updated `TransferRejected` event

```rust
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

## Files changed

1. `programs/handshake/src/instructions/reject_transfer.rs` — remove fee logic, update args and event
2. `programs/handshake/src/instructions/decline_transfer.rs` — new file
3. `programs/handshake/src/instructions/mod.rs` — export new instruction
4. `programs/handshake/src/state/secure_transfer.rs` — add `Declined` variant, `mark_as_declined()`
5. `programs/handshake/src/errors.rs` — add new error variants
6. `programs/handshake/src/lib.rs` — add `decline_transfer` entry point
7. `tests/handshake.ts` — add decline tests, update reject tests for no-fee behavior

## Test plan

### `decline_transfer` tests

- Recipient can decline an active transfer; sender gets full refund
- Decline with `reason: Some(1)` emits correct event
- Decline with `reason: None` works
- Non-recipient signer cannot decline (Unauthorized)
- Cannot decline a non-active transfer (already claimed/cancelled/rejected/expired/declined)

### `reject_transfer` test updates

- Verify sender gets full refund (no fee deducted)
- Verify pool `collected_fees` does not increase on rejection
