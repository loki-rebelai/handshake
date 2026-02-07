# Basic Escrow Flow

> Complete example: create, claim, and cancel an escrow payment.

<!-- last-updated: 2026-02-07 -->
<!-- relates-to: skills/payments.md, docs/instructions.md -->

## Setup

```typescript
import { SilkywayClient } from '@rebelfi/silkyway-sdk';

const silkyway = new SilkywayClient({ network: 'devnet' });
const sender = silkyway.createWallet();
const recipient = silkyway.createWallet();

// Fund sender
await silkyway.requestFunds(sender.publicKey);
```

## Create Transfer

```typescript
const { txid, transferPda } = await silkyway.sendPayment({
  recipient: recipient.publicKey,
  amount: 10.00,
  memo: 'Test payment',
  claimableAfter: Math.floor(Date.now() / 1000) + 60, // 1 minute
});

console.log('Transfer created:', transferPda);
```

## Check Status

```typescript
const transfer = await silkyway.getTransfer(transferPda);
console.log('Status:', transfer.status); // "ACTIVE"
```

## Claim (as recipient, after time lock)

```typescript
await silkyway.claimPayment(transferPda);
```

## Cancel (as sender, before claim)

```typescript
await silkyway.cancelPayment(transferPda);
```
