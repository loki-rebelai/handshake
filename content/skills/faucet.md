---
name: silkyway-faucet
description: Get testnet SOL and USDC for development
---

# Faucet

> Fund your wallet with testnet SOL and USDC.

<!-- last-updated: 2026-02-07 -->
<!-- relates-to: skills/sdk-install.md -->

## Using the SDK

```typescript
await silkyway.requestFunds('<wallet-pubkey>');
// Airdrops 1 SOL + 100 USDC to the wallet
```

## API Endpoint (Direct)

```bash
POST /api/faucet
Content-Type: application/json

{
  "wallet": "<wallet-pubkey>"
}
```

Response:
```json
{
  "ok": true,
  "data": {
    "sol": { "amount": 1.0, "txid": "..." },
    "usdc": { "amount": 100.0, "txid": "..." }
  }
}
```

## Rate Limits

- 1 request per wallet per 10 minutes
- Devnet only
