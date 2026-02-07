---
name: silkyway-sdk-install
description: Install and configure the Silkyway SDK for agent payments
---

# SDK Installation

> Install the Silkyway SDK to interact with the escrow protocol.

<!-- last-updated: 2026-02-07 -->
<!-- relates-to: skills/payments.md, skills/faucet.md -->

## Install

```bash
npm install @rebelfi/silkyway-sdk
```

## Initialize

```typescript
import { SilkywayClient } from '@rebelfi/silkyway-sdk';

const silkyway = new SilkywayClient({
  network: 'devnet',  // or 'mainnet'
});

// Create a wallet
const wallet = silkyway.createWallet();
console.log(wallet.publicKey); // Your Solana address

// Fund it (testnet only)
await silkyway.requestFunds(wallet.publicKey);
```

## Next Steps

- [Send a payment](payments.md)
- [Check your transfers](queries.md)
