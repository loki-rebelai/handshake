---
name: silkyway-queries
description: Query transfer status and history
---

# Queries

> Check transfer status and list transfers by wallet.

<!-- last-updated: 2026-02-07 -->
<!-- relates-to: docs/api-reference.md, reference/accounts.md -->

## Get Transfer by PDA

```typescript
const transfer = await silkyway.getTransfer('<transfer-pda>');
// { sender, recipient, amount, status, claimableAfter, ... }
```

## List Transfers by Wallet

```typescript
const transfers = await silkyway.getTransfers('<wallet-pubkey>');
// [{ transferPda, sender, recipient, amount, status, ... }, ...]
```

## API Endpoints (Direct)

- `GET /api/transfers/:pda` — single transfer details
- `GET /api/transfers?wallet=<pubkey>` — list transfers for a wallet
