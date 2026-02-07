# Account Schemas

> On-chain account data structures for the Silkyway Protocol.

<!-- last-updated: 2026-02-07 -->
<!-- relates-to: docs/architecture.md -->

## Pool

```
Pool {
  pool_id: Pubkey,
  operator: Pubkey,
  token_mint: Pubkey,
  vault: Pubkey,
  fee_bps: u16,
  total_transfers_created: u64,
  total_transfers_resolved: u64,
  is_paused: bool,
}
```

## Transfer

```
Transfer {
  pool: Pubkey,
  sender: Pubkey,
  recipient: Pubkey,
  amount: u64,
  fee: u64,
  memo: String,
  status: TransferStatus,
  claimable_after: i64,
  created_at: i64,
  claimed_at: Option<i64>,
  cancelled_at: Option<i64>,
}
```

## TransferStatus

```
enum TransferStatus {
  Active,
  Claimed,
  Cancelled,
  Expired,
}
```
