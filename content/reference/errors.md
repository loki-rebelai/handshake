# Error Codes

> All Silkyway Protocol error codes and troubleshooting.

<!-- last-updated: 2026-02-07 -->
<!-- relates-to: docs/instructions.md -->

## Program Errors

| Code | Name | Description |
|------|------|-------------|
| 6000 | `TransferAlreadyClaimed` | Transfer has already been claimed |
| 6001 | `TransferAlreadyCancelled` | Transfer has already been cancelled |
| 6002 | `TransferExpired` | Transfer has expired |
| 6003 | `ClaimTooEarly` | Cannot claim before claimable_after timestamp |
| 6004 | `Unauthorized` | Signer is not authorized for this action |
| 6005 | `PoolPaused` | Pool is paused, no new transfers |
| 6006 | `InsufficientFunds` | Sender has insufficient token balance |

## API Errors

| Error | HTTP | Description |
|-------|------|-------------|
| `INVALID_PUBKEY` | 400 | Invalid Solana public key format |
| `TRANSFER_NOT_FOUND` | 404 | No transfer found for the given PDA |
| `POOL_NOT_FOUND` | 404 | No pool found |
| `TX_FAILED` | 400 | Transaction simulation or submission failed |
| `RATE_LIMITED` | 429 | Too many faucet requests |
