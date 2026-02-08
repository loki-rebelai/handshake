---
name: silkyway
description: Programmable escrow payments on Solana. Send, claim, and cancel time-locked USDC payments between agents.
metadata:
  author: rebelfi
  homepage: https://silkyway.ai
  api_base: https://silkyway.ai/api
---

# Silkyway

Programmable escrow payments on Solana using USDC. Senders lock tokens into escrow. Recipients claim after an optional time lock. Senders can cancel before the claim.

Tokens are held in on-chain escrow vaults managed by the protocol — you don't need to interact with vaults or pools directly; the API handles routing for you.

```
Sender Wallet → [create_transfer] → Escrow
Escrow         → [claim_transfer]  → Recipient Wallet
Escrow         → [cancel_transfer] → Sender Wallet (refund)
```

## Quick Start

### 1. Install the CLI

```bash
npm install -g https://silkyway.ai/sdk/silkyway-sdk-0.1.0.tgz
```

### 2. Create a wallet

```bash
silk wallet create
```

Your wallet is saved at `~/.config/silk/config.json`.

### 3. Fund it (devnet)

```bash
silk wallet fund
```

### 4. Send your first payment

```bash
silk pay 7xKXz9BpR3mFVDg2Thh3AG6sFRPqNrDJ4bHUkR8Y7vNx 10 --memo "First payment"
```

## CLI Reference

| Command | Description |
|---------|-------------|
| `silk wallet create [label]` | Create a new wallet (first one is named "main") |
| `silk wallet list` | List all wallets with addresses |
| `silk wallet fund [--sol] [--usdc] [--wallet <label>]` | Fund wallet from devnet faucet |
| `silk balance [--wallet <label>]` | Show SOL and USDC balances |
| `silk pay <recipient> <amount> [--memo <text>] [--wallet <label>]` | Send USDC payment into escrow |
| `silk claim <transfer-pda> [--wallet <label>]` | Claim a received payment |
| `silk cancel <transfer-pda> [--wallet <label>]` | Cancel a sent payment |
| `silk payments list [--wallet <label>]` | List transfers |
| `silk payments get <transfer-pda>` | Get transfer details |
| `silk config set-api-url <url>` | Set the API base URL (persisted in config) |
| `silk config get-api-url` | Show the current API base URL |
| `silk config reset-api-url` | Reset API URL to default (`https://silkyway.ai`) |

Use `--wallet <label>` on any command to select a non-default wallet.

You can also set the API URL via the `SILK_API_URL` environment variable, which takes precedence over the default but not a configured value.

## End-to-End Examples

### Pay, then recipient claims

```bash
# Sender: create and fund a wallet
silk wallet create
silk wallet fund

# Sender: pay 25 USDC to a recipient
silk pay 7xKXz9BpR3mFVDg2Thh3AG6sFRPqNrDJ4bHUkR8Y7vNx 25 --memo "Payment for code review"
# → Transfer PDA: 9aE5kBqR...  (save this)

# Recipient: list incoming payments
silk payments list
# → Shows transfer with status ACTIVE

# Recipient: claim the payment
silk claim 9aE5kBqRvF3mNcXz8BpR3mFVDg2Thh3AG6sFRPqNrDJ4
# → Payment claimed, USDC deposited to wallet
```

### Pay, then sender cancels

```bash
# Sender: pay 10 USDC
silk pay 7xKXz9BpR3mFVDg2Thh3AG6sFRPqNrDJ4bHUkR8Y7vNx 10 --memo "Tentative payment"
# → Transfer PDA: 4bHUkR8Y...

# Sender: changed their mind — cancel before recipient claims
silk cancel 4bHUkR8Y7vNx3mFVDg2Thh3AG6sFRPqNrDJ4bHUkR8Y7v
# → Payment cancelled, USDC refunded to sender

# Verify it was cancelled
silk payments get 4bHUkR8Y7vNx3mFVDg2Thh3AG6sFRPqNrDJ4bHUkR8Y7v
# → status: CANCELLED
```

### Multi-wallet testing

```bash
# Create two wallets to simulate both sides
silk wallet create sender
silk wallet create receiver
silk wallet fund --wallet sender
silk wallet fund --wallet receiver

# Send from sender → receiver
silk pay $(silk wallet list | grep receiver) 5 --memo "Test" --wallet sender

# Claim as receiver
silk payments list --wallet receiver
silk claim <transfer-pda> --wallet receiver
```

## API Endpoints

Base URL: `https://silkyway.ai/api`

All requests use `Content-Type: application/json`. The general flow for any transaction is:

1. Call a `POST /api/tx/*` endpoint to build an unsigned transaction
2. Sign the transaction locally with your private key
3. Submit the signed transaction via `POST /api/tx/submit`

### POST /api/tx/create-transfer

Build an unsigned create_transfer transaction. Locks USDC into escrow.

**Request:**
```json
{
  "sender": "BrKz4GQN1sxZWoGLbNTojp4G3JCFLRkSYk3mSRWhKsXp",
  "recipient": "7xKXz9BpR3mFVDg2Thh3AG6sFRPqNrDJ4bHUkR8Y7vNx",
  "amount": 10.00,
  "token": "usdc",
  "memo": "Payment for code review"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sender` | string | yes | Sender's Solana public key |
| `recipient` | string | yes | Recipient's Solana public key |
| `amount` | number | yes | Amount in token units (e.g. `10.00` = 10 USDC) |
| `token` | string | yes | Token symbol (e.g. `"usdc"`) |
| `memo` | string | no | Human-readable memo |
| `claimableAfter` | number | no | Unix timestamp — recipient cannot claim before this time |

You can also pass `mint` (token mint pubkey) or `poolPda` directly instead of `token`, but `token` is the simplest option.

**Response:**
```json
{
  "ok": true,
  "data": {
    "transaction": "AQAAAAAAAAAAAAAA...base64...AAAAAAA=",
    "transferPda": "9aE5kBqRvF3mNcXz8BpR3mFVDg2Thh3AG6sFRPqNrDJ4",
    "nonce": "1738900000000",
    "message": "Sign and submit via POST /api/tx/submit"
  }
}
```

The `transferPda` is the on-chain address for this escrow. Save it — you need it to claim or cancel.

### POST /api/tx/claim-transfer

Build an unsigned claim_transfer transaction. Moves USDC from escrow to the recipient's wallet.

Only the designated recipient can claim. If `claimableAfter` was set, the claim will fail before that time.

**Request:**
```json
{
  "transferPda": "9aE5kBqRvF3mNcXz8BpR3mFVDg2Thh3AG6sFRPqNrDJ4",
  "claimer": "7xKXz9BpR3mFVDg2Thh3AG6sFRPqNrDJ4bHUkR8Y7vNx"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `transferPda` | string | yes | The transfer's on-chain PDA |
| `claimer` | string | yes | Recipient's Solana public key |

**Response:**
```json
{
  "ok": true,
  "data": {
    "transaction": "AQAAAAAAAAAAAAAA...base64...AAAAAAA=",
    "message": "Sign and submit via POST /api/tx/submit"
  }
}
```

**Common errors:**
- `ClaimTooEarly` (6003) — `claimableAfter` hasn't passed yet
- `TransferAlreadyClaimed` (6000) — already claimed
- `TransferAlreadyCancelled` (6001) — sender cancelled first
- `Unauthorized` (6004) — claimer is not the designated recipient

### POST /api/tx/cancel-transfer

Build an unsigned cancel_transfer transaction. Refunds USDC from escrow back to the sender.

Only the original sender can cancel, and only while the transfer is still `ACTIVE` (not yet claimed).

**Request:**
```json
{
  "transferPda": "9aE5kBqRvF3mNcXz8BpR3mFVDg2Thh3AG6sFRPqNrDJ4",
  "canceller": "BrKz4GQN1sxZWoGLbNTojp4G3JCFLRkSYk3mSRWhKsXp"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `transferPda` | string | yes | The transfer's on-chain PDA |
| `canceller` | string | yes | Sender's Solana public key |

**Response:**
```json
{
  "ok": true,
  "data": {
    "transaction": "AQAAAAAAAAAAAAAA...base64...AAAAAAA=",
    "message": "Sign and submit via POST /api/tx/submit"
  }
}
```

**Common errors:**
- `TransferAlreadyClaimed` (6000) — recipient already claimed
- `TransferAlreadyCancelled` (6001) — already cancelled
- `Unauthorized` (6004) — canceller is not the original sender

### POST /api/tx/submit

Submit a signed transaction to Solana.

**Request:**
```json
{
  "signedTx": "AQAAAAAAAAAAAAAA...base64-signed...AAAAAAA="
}
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "txid": "5UfDuXsrhFnxGZmyJxNR8z7Ee5JDFrgWHKPdTEJvoTpB3Qw8mKz4GQN1sxZWoGL"
  }
}
```

### GET /api/transfers/:pda

Get details for a single transfer.

**Example:** `GET /api/transfers/9aE5kBqRvF3mNcXz8BpR3mFVDg2Thh3AG6sFRPqNrDJ4`

**Response (active transfer):**
```json
{
  "ok": true,
  "data": {
    "transfer": {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "transferPda": "9aE5kBqRvF3mNcXz8BpR3mFVDg2Thh3AG6sFRPqNrDJ4",
      "sender": "BrKz4GQN1sxZWoGLbNTojp4G3JCFLRkSYk3mSRWhKsXp",
      "recipient": "7xKXz9BpR3mFVDg2Thh3AG6sFRPqNrDJ4bHUkR8Y7vNx",
      "amount": "10000000",
      "amountRaw": "10000000",
      "status": "ACTIVE",
      "memo": "Payment for code review",
      "createTxid": "5UfDuXsrhFnxGZmyJxNR8z7Ee5JDFrgWHKPdTEJvoTpB",
      "claimTxid": null,
      "cancelTxid": null,
      "claimableAfter": null,
      "claimableUntil": null,
      "createdAt": "2025-02-07T12:00:00.000Z",
      "updatedAt": "2025-02-07T12:00:00.000Z",
      "token": { "mint": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", "symbol": "USDC", "decimals": 6 },
      "pool": { "poolPda": "3Fk8vMYJbCbEB2jzRCdRG9rFJhN2TCmPia9BjEKpTk5R", "feeBps": 50 }
    }
  }
}
```

**Response (claimed transfer):**
```json
{
  "ok": true,
  "data": {
    "transfer": {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "transferPda": "9aE5kBqRvF3mNcXz8BpR3mFVDg2Thh3AG6sFRPqNrDJ4",
      "sender": "BrKz4GQN1sxZWoGLbNTojp4G3JCFLRkSYk3mSRWhKsXp",
      "recipient": "7xKXz9BpR3mFVDg2Thh3AG6sFRPqNrDJ4bHUkR8Y7vNx",
      "amount": "10000000",
      "amountRaw": "10000000",
      "status": "CLAIMED",
      "memo": "Payment for code review",
      "createTxid": "5UfDuXsrhFnxGZmyJxNR8z7Ee5JDFrgWHKPdTEJvoTpB",
      "claimTxid": "3mFVDg2Thh3AG6sFRPqNrDJ4bHUkR8Y7vNx9BpR3mFVDg",
      "cancelTxid": null,
      "claimableAfter": null,
      "claimableUntil": null,
      "createdAt": "2025-02-07T12:00:00.000Z",
      "updatedAt": "2025-02-07T12:05:00.000Z",
      "token": { "mint": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", "symbol": "USDC", "decimals": 6 },
      "pool": { "poolPda": "3Fk8vMYJbCbEB2jzRCdRG9rFJhN2TCmPia9BjEKpTk5R", "feeBps": 50 }
    }
  }
}
```

**Response (cancelled transfer):**
```json
{
  "ok": true,
  "data": {
    "transfer": {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "transferPda": "9aE5kBqRvF3mNcXz8BpR3mFVDg2Thh3AG6sFRPqNrDJ4",
      "sender": "BrKz4GQN1sxZWoGLbNTojp4G3JCFLRkSYk3mSRWhKsXp",
      "recipient": "7xKXz9BpR3mFVDg2Thh3AG6sFRPqNrDJ4bHUkR8Y7vNx",
      "amount": "10000000",
      "amountRaw": "10000000",
      "status": "CANCELLED",
      "memo": "Payment for code review",
      "createTxid": "5UfDuXsrhFnxGZmyJxNR8z7Ee5JDFrgWHKPdTEJvoTpB",
      "claimTxid": null,
      "cancelTxid": "8Y7vNx3mFVDg2Thh3AG6sFRPqNrDJ4bHUkR9BpR3mFVDg",
      "claimableAfter": null,
      "claimableUntil": null,
      "createdAt": "2025-02-07T12:00:00.000Z",
      "updatedAt": "2025-02-07T12:03:00.000Z",
      "token": { "mint": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", "symbol": "USDC", "decimals": 6 },
      "pool": { "poolPda": "3Fk8vMYJbCbEB2jzRCdRG9rFJhN2TCmPia9BjEKpTk5R", "feeBps": 50 }
    }
  }
}
```

Note: `amount` is in raw token units. USDC has 6 decimals, so `"10000000"` = 10.00 USDC.

### GET /api/transfers?wallet=\<pubkey\>

List all transfers where the wallet is sender or recipient.

**Example:** `GET /api/transfers?wallet=BrKz4GQN1sxZWoGLbNTojp4G3JCFLRkSYk3mSRWhKsXp`

**Response:**
```json
{
  "ok": true,
  "data": {
    "transfers": [
      {
        "transferPda": "9aE5kBqRvF3mNcXz8BpR3mFVDg2Thh3AG6sFRPqNrDJ4",
        "sender": "BrKz4GQN1sxZWoGLbNTojp4G3JCFLRkSYk3mSRWhKsXp",
        "recipient": "7xKXz9BpR3mFVDg2Thh3AG6sFRPqNrDJ4bHUkR8Y7vNx",
        "amount": "10000000",
        "status": "ACTIVE",
        "memo": "Payment for code review",
        "createdAt": "2025-02-07T12:00:00.000Z",
        "token": { "mint": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", "symbol": "USDC", "decimals": 6 },
        "pool": { "poolPda": "3Fk8vMYJbCbEB2jzRCdRG9rFJhN2TCmPia9BjEKpTk5R", "feeBps": 50 }
      },
      {
        "transferPda": "4bHUkR8Y7vNx3mFVDg2Thh3AG6sFRPqNrDJ4bHUkR8Y7v",
        "sender": "BrKz4GQN1sxZWoGLbNTojp4G3JCFLRkSYk3mSRWhKsXp",
        "recipient": "Dg2Thh3AG6sFRPqNrDJ4bHUkR8Y7vNx7xKXz9BpR3mFV",
        "amount": "5000000",
        "status": "CLAIMED",
        "memo": "Bug bounty payout",
        "createdAt": "2025-02-06T09:30:00.000Z",
        "token": { "mint": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", "symbol": "USDC", "decimals": 6 },
        "pool": { "poolPda": "3Fk8vMYJbCbEB2jzRCdRG9rFJhN2TCmPia9BjEKpTk5R", "feeBps": 50 }
      }
    ]
  }
}
```

### POST /api/tx/faucet

Airdrop devnet SOL or USDC. Devnet only.

**Request (SOL):**
```json
{
  "wallet": "BrKz4GQN1sxZWoGLbNTojp4G3JCFLRkSYk3mSRWhKsXp",
  "token": "sol"
}
```

**Request (USDC):**
```json
{
  "wallet": "BrKz4GQN1sxZWoGLbNTojp4G3JCFLRkSYk3mSRWhKsXp",
  "token": "usdc"
}
```

`token` is optional. Omit or use `"sol"` for SOL airdrop, `"usdc"` for USDC mint.

**Response:**
```json
{
  "ok": true,
  "data": {
    "amount": 1.0,
    "txid": "5UfDuXsrhFnxGZmyJxNR8z7Ee5JDFrgWHKPdTEJvoTpB3Qw8mKz4GQN1sxZWoGL"
  }
}
```

## Transfer Statuses

| Status | Description |
|--------|-------------|
| `ACTIVE` | Tokens locked in escrow, awaiting claim or cancellation |
| `CLAIMED` | Recipient claimed the tokens |
| `CANCELLED` | Sender cancelled and reclaimed the tokens |
| `EXPIRED` | Transfer expired past its `claimableUntil` window |

## Error Codes

### Program Errors

| Code | Name | Description |
|------|------|-------------|
| 6000 | `TransferAlreadyClaimed` | Transfer has already been claimed |
| 6001 | `TransferAlreadyCancelled` | Transfer has already been cancelled |
| 6002 | `TransferExpired` | Transfer has expired |
| 6003 | `ClaimTooEarly` | Cannot claim before `claimableAfter` timestamp |
| 6004 | `Unauthorized` | Signer is not authorized for this action |
| 6005 | `PoolPaused` | The token's escrow pool is temporarily paused — try again later |
| 6006 | `InsufficientFunds` | Sender has insufficient token balance |

### API Errors

| Error | HTTP | Description |
|-------|------|-------------|
| `INVALID_PUBKEY` | 400 | Invalid Solana public key format |
| `INVALID_AMOUNT` | 400 | Amount must be positive |
| `MISSING_FIELD` | 400 | Required field not provided |
| `TRANSFER_NOT_FOUND` | 404 | No transfer found for the given PDA |
| `POOL_NOT_FOUND` | 404 | No escrow pool found for this token |
| `TOKEN_NOT_FOUND` | 400 | Token symbol or mint not recognized |
| `TX_FAILED` | 400 | Transaction simulation or submission failed |
| `RATE_LIMITED` | 429 | Too many faucet requests |
| `FAUCET_FAILED` | 400 | Faucet airdrop failed |

## Response Format

**Success:**
```json
{
  "ok": true,
  "data": { ... }
}
```

**Error:**
```json
{
  "ok": false,
  "error": "ERROR_CODE",
  "message": "Human-readable description"
}
```

## Rate Limits

- Faucet: 1 request per wallet per 10 minutes
- Faucet is devnet only

## Security

- All transactions are built server-side as unsigned transactions
- You sign locally with your private key before submitting
- Private keys are never transmitted to the server
- Keys are stored locally at `~/.config/silk/config.json` — never share this file
