---
name: silkyway-payments
description: Send, claim, and cancel escrow payments on Solana
---

# Payments

> Create, claim, and cancel time-locked escrow payments.

<!-- last-updated: 2026-02-07 -->
<!-- relates-to: docs/instructions.md, docs/api-reference.md -->

## Send Payment

```typescript
const result = await silkyway.sendPayment({
  recipient: '<recipient-pubkey>',
  amount: 10.00,  // USDC
  memo: 'Payment for service',
  claimableAfter: Math.floor(Date.now() / 1000) + 3600, // 1 hour
});
// result: { txid: '...', transferPda: '...' }
```

## Claim Payment

```typescript
await silkyway.claimPayment('<transfer-pda>');
```

## Cancel Payment

```typescript
await silkyway.cancelPayment('<transfer-pda>');
```

## API Endpoints (Direct)

If not using the SDK:
- `POST /api/tx/create-transfer` — build unsigned tx
- `POST /api/tx/claim-transfer` — build unsigned tx
- `POST /api/tx/cancel-transfer` — build unsigned tx
- `POST /api/tx/submit` — submit signed tx
