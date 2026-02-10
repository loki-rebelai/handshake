---
name: silkyway
description: Agent payments on Solana. Policy-controlled accounts with spending limits, plus cancellable escrow transfers. USDC on-chain — non-custodial.
metadata:
   author: rebelfi
   homepage: https://silkyway.ai
   api_base: https://silkyway.ai/api
---

# Silkyway

Agent payments on Solana. Two payment modes:

1. **Accounts (recommended)** — Your human creates an on-chain account, adds you as an operator with a per-transaction spending limit, and funds it with USDC. You send payments directly from the account. The on-chain program enforces your spending limit — if you try to exceed it, the transaction is rejected on-chain. No escrow, no claiming.

2. **Escrow transfers** — Send USDC into on-chain escrow. The recipient claims it, or you cancel for a full refund. Good for one-off payments between parties who don't fully trust each other.

## How Accounts Work

A Silkyway account is an on-chain wallet controlled by a **human owner** who delegates spending authority to **operator agents**. Each operator has an independent per-transaction spending limit enforced by the Solana program.

```
Human (owner) creates account → funds it with USDC → adds agent as operator
Agent (operator) sends payments → on-chain program enforces spending limit
```

**Key concepts:**
- **Owner** — The human who created the account. Has full control: can transfer any amount, pause the account, add/remove operators. The owner's wallet address is a regular Solana wallet (e.g., Phantom).
- **Operator** — An agent authorized to send tokens from the account, subject to a per-transaction limit. Your CLI wallet (`silk wallet create`) is your operator key.
- **Per-transaction limit** — Maximum USDC the operator can send in a single transaction. Set by the owner. Enforced on-chain — the program rejects transactions that exceed it. A limit of 0 means unlimited.
- **Account PDA** — The on-chain address of the account (a Program Derived Address). Derived from the owner's public key. One account per owner.
- **Pause** — The owner can pause the account, which blocks all operator transfers. The owner can still withdraw. Operators cannot unpause.

### Set up your account

Your human needs to create the account first. You cannot create it yourself.

1. Create your wallet (if you haven't already):
   ```bash
   silk wallet create
   ```

2. Share the setup URL with your human — they'll connect their wallet, set your spending limit, and fund the account:
   ```
   https://silk.silkyway.ai/account/setup?agent=YOUR_WALLET_ADDRESS
   ```
   Replace `YOUR_WALLET_ADDRESS` with the address from `silk wallet list`.

3. After your human creates the account, sync it:
   ```bash
   silk account sync
   ```
   This discovers your account and saves the configuration locally.

4. Check your account status:
   ```bash
   silk account status
   ```
   Shows your balance, spending limit, and whether the account is paused.

5. Send payments:
   ```bash
   silk account send <recipient> <amount>
   ```
   If the amount exceeds your per-transaction limit, the transaction will be **rejected on-chain** with an `ExceedsPerTxLimit` error.

### How escrow transfers work

Escrow transfers are the original Silkyway payment mode — good for one-off payments between parties.

```
Sender Wallet → [create_transfer] → Escrow
Escrow         → [claim_transfer]  → Recipient Wallet
Escrow         → [cancel_transfer] → Sender Wallet (refund)
```

## Set up your wallet first

You need a funded wallet before you can use either payment mode. This takes three commands.

### 1. Install the CLI

```bash
npm install -g https://silkyway.ai/sdk/silkyway-sdk-0.1.0.tgz
```

### 2. Create a wallet

```bash
silk wallet create
```

This generates a Solana keypair and saves it at `~/.config/silk/config.json`. Your private key never leaves your machine.

Run `silk wallet list` to see your wallet address — you'll need it to receive payments from other agents.

### 3. Fund your wallet

On devnet, use our faucet — it gives you everything you need (0.1 SOL for transaction fees + 100 USDC for payments):

```bash
silk wallet fund
```

On other networks, you need to send SOL and USDC to your wallet address manually. SOL is required for Solana transaction fees. USDC is the token used for payments.

Check your balances anytime:

```bash
silk balance
```

You're now ready to send payments. Skip to [Send your first payment](#send-your-first-payment) or read the full CLI reference below.

## Send your first payment

```bash
silk pay 7xKXz9BpR3mFVDg2Thh3AG6sFRPqNrDJ4bHUkR8Y7vNx 10 --memo "First payment"
```

This locks 10 USDC into on-chain escrow. The recipient claims it with `silk claim <transfer-pda>`. You can cancel anytime before they claim with `silk cancel <transfer-pda>`.

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
| `silk account sync [--wallet <label>] [--account <pda>]` | Discover and sync your account (must be set up by human first) |
| `silk account status [--wallet <label>]` | Show account balance, spending limit, and pause state |
| `silk account send <recipient> <amount> [--memo <text>] [--wallet <label>]` | Send from account (policy-enforced on-chain) |
| `silk chat <message>` | Ask Silkyway support agent a question |
| `silk config set-api-url <url>` | Set the API base URL (persisted in config) |
| `silk config get-api-url` | Show the current API base URL |
| `silk config reset-api-url` | Reset API URL to default (`https://silkyway.ai`) |

Use `--wallet <label>` on any command to select a non-default wallet.

You can also set the API URL via the `SILK_API_URL` environment variable, which takes precedence over the default but not a configured value.

## End-to-End Examples

### Account: set up and send (recommended)

```bash
# 1. Create and fund your wallet
silk wallet create
silk wallet fund

# 2. Share setup URL with your human (replace with your address)
silk wallet list
# → main: 7xKXz9BpR3mFVDg2Thh3AG6sFRPqNrDJ4bHUkR8Y7vNx
# Tell your human: https://silk.silkyway.ai/account/setup?agent=7xKXz9BpR3mFVDg2Thh3AG6sFRPqNrDJ4bHUkR8Y7vNx

# 3. After human creates the account, sync it
silk account sync
# → Synced account 9aE5kBqR... (owner: BrKz4GQN..., balance: $10.00 USDC, limit: $5.00/tx)

# 4. Check status anytime
silk account status
# → balance: $10.00, per-tx limit: $5.00, paused: false

# 5. Send a payment within your limit
silk account send Dg2Thh3AG6sFRPqNrDJ4bHUkR8Y7vNx7xKXz9BpR3mFV 3
# → Sent $3.00 USDC (txid: 5UfDuXsr...)

# 6. Try to exceed your limit — rejected on-chain
silk account send Dg2Thh3AG6sFRPqNrDJ4bHUkR8Y7vNx7xKXz9BpR3mFV 10
# → REJECTED: amount $10.00 exceeds per-transaction limit of $5.00
```

### Escrow: pay, then recipient claims

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

## How accounts differ from escrow

| | Accounts | Escrow |
|---|---|---|
| **Who creates it** | Human owner | Agent (sender) |
| **Spending limits** | Yes — per-transaction limit enforced on-chain | No |
| **Recipient claims?** | No — direct transfer, recipient gets tokens immediately | Yes — recipient must `silk claim` |
| **Cancellable?** | No — transfer is instant | Yes — sender can cancel before claim |
| **Best for** | Ongoing agent payments with human oversight | One-off payments between untrusted parties |

If your human has set up an account for you, prefer `silk account send` over `silk pay`. It's simpler (no claim step) and your human controls the spending limits.

## How transactions work

Silkyway is non-custodial — your private keys never leave your machine.

Every payment follows a build→sign→submit flow:

1. **Build** — Call a `POST /api/tx/*` endpoint with payment details. The backend builds an unsigned Solana transaction and returns it as base64.
2. **Sign** — The SDK signs the transaction locally using your private key (stored at `~/.config/silk/config.json`).
3. **Submit** — Send the signed transaction to `POST /api/tx/submit`. The backend forwards it to Solana and confirms it on-chain.

The backend handles Solana complexity (PDA derivation, instruction building, blockhash management) so agents don't have to. But it never sees your private key — it only builds the unsigned transaction structure. All authorization is enforced on-chain by the Solana program.

When using the CLI (`silk pay`, `silk claim`, etc.), this flow happens automatically. When using the API directly, you handle each step yourself.

## API Endpoints

Base URL: `https://silkyway.ai/api`

All requests use `Content-Type: application/json`.

### Account Endpoints

#### GET /api/account/by-operator/:pubkey

Find accounts where your wallet is an operator. Used by `silk account sync`.

**Example:** `GET /api/account/by-operator/7xKXz9BpR3mFVDg2Thh3AG6sFRPqNrDJ4bHUkR8Y7vNx`

**Response:**
```json
{
  "ok": true,
  "data": {
    "accounts": [
      {
        "pda": "9aE5kBqRvF3mNcXz8BpR3mFVDg2Thh3AG6sFRPqNrDJ4",
        "owner": "BrKz4GQN1sxZWoGLbNTojp4G3JCFLRkSYk3mSRWhKsXp",
        "mint": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
        "mintDecimals": 6,
        "isPaused": false,
        "balance": 10000000,
        "operatorSlot": {
          "index": 0,
          "perTxLimit": 5000000,
          "dailyLimit": 0
        }
      }
    ]
  }
}
```

Returns an empty array if no accounts found — this means your human hasn't set up your account yet.

#### GET /api/account/:pda

Get full account details. Used by `silk account status`.

**Example:** `GET /api/account/9aE5kBqRvF3mNcXz8BpR3mFVDg2Thh3AG6sFRPqNrDJ4`

**Response:**
```json
{
  "ok": true,
  "data": {
    "pda": "9aE5kBqRvF3mNcXz8BpR3mFVDg2Thh3AG6sFRPqNrDJ4",
    "owner": "BrKz4GQN1sxZWoGLbNTojp4G3JCFLRkSYk3mSRWhKsXp",
    "mint": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    "mintDecimals": 6,
    "isPaused": false,
    "balance": 10000000,
    "operators": [
      {
        "pubkey": "7xKXz9BpR3mFVDg2Thh3AG6sFRPqNrDJ4bHUkR8Y7vNx",
        "perTxLimit": 5000000,
        "dailyLimit": 0
      }
    ]
  }
}
```

Note: `balance` and `perTxLimit` are in raw token units. USDC has 6 decimals, so `5000000` = $5.00.

#### POST /api/account/transfer

Build an unsigned transfer transaction from a Silkyway account. Used by `silk account send`.

**Request:**
```json
{
  "signer": "7xKXz9BpR3mFVDg2Thh3AG6sFRPqNrDJ4bHUkR8Y7vNx",
  "accountPda": "9aE5kBqRvF3mNcXz8BpR3mFVDg2Thh3AG6sFRPqNrDJ4",
  "recipient": "Dg2Thh3AG6sFRPqNrDJ4bHUkR8Y7vNx7xKXz9BpR3mFV",
  "amount": 3000000
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `signer` | string | yes | Your wallet address (operator) |
| `accountPda` | string | yes | The account's on-chain PDA |
| `recipient` | string | yes | Recipient's Solana public key |
| `amount` | number | yes | Amount in raw token units (e.g. `3000000` = 3.00 USDC) |

**Response:**
```json
{
  "ok": true,
  "data": {
    "transaction": "AQAAAAAAAAAAAAAA...base64...AAAAAAA="
  }
}
```

Sign and submit the returned transaction via `POST /api/tx/submit`.

**Common errors:**
- `ExceedsPerTxLimit` — Amount exceeds your per-transaction spending limit
- `AccountPaused` — Account is paused by the owner; operator transfers blocked
- `Unauthorized` — Signer is not the owner or an operator on this account

#### POST /api/account/create

Build an unsigned create-account transaction. Used by the setup page (human-facing, not typically called by agents).

**Request:**
```json
{
  "owner": "BrKz4GQN1sxZWoGLbNTojp4G3JCFLRkSYk3mSRWhKsXp",
  "mint": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  "operator": "7xKXz9BpR3mFVDg2Thh3AG6sFRPqNrDJ4bHUkR8Y7vNx",
  "perTxLimit": 5000000
}
```

#### POST /api/account/deposit

Build an unsigned deposit transaction. Used by the setup page to fund the account.

**Request:**
```json
{
  "depositor": "BrKz4GQN1sxZWoGLbNTojp4G3JCFLRkSYk3mSRWhKsXp",
  "accountPda": "9aE5kBqRvF3mNcXz8BpR3mFVDg2Thh3AG6sFRPqNrDJ4",
  "amount": 10000000
}
```

### Escrow Endpoints

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
    "amount": 0.1,
    "txid": "5UfDuXsrhFnxGZmyJxNR8z7Ee5JDFrgWHKPdTEJvoTpB3Qw8mKz4GQN1sxZWoGL"
  }
}
```

### POST /chat

Send a message to the Silkyway support agent. Returns an AI-generated response.

**Request:**
```json
{
  "agentId": "uuid-v4",
  "message": "How do I send a payment?"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agentId` | string | yes | UUID v4 identifying the agent (auto-generated by the SDK) |
| `message` | string | yes | The question to ask |

**Response (200):**
```json
{
  "ok": true,
  "data": {
    "message": "Use silk pay...",
    "agentId": "uuid-v4"
  }
}
```

**Errors:**
- `INVALID_AGENT_ID` (400) — agentId is not a valid UUID
- `INVALID_MESSAGE` (400) — message is empty or missing
- `OPENCLAW_UNAVAILABLE` (503) — support agent backend is temporarily unavailable
- `INTERNAL_ERROR` (500) — unexpected server error

**Note:** Each SDK installation has an auto-generated UUID (`agentId`) stored in `~/.config/silk/config.json`. It is sent automatically with chat requests for session continuity. It is not used for authentication — just session tracking.

## Transfer Statuses

| Status | Description |
|--------|-------------|
| `ACTIVE` | Tokens locked in escrow, awaiting claim or cancellation |
| `CLAIMED` | Recipient claimed the tokens |
| `CANCELLED` | Sender cancelled and reclaimed the tokens |
| `EXPIRED` | Transfer expired past its `claimableUntil` window |

## Error Codes

### Account Program Errors (Silkysig)

| Code | Name | Description |
|------|------|-------------|
| 6000 | `Unauthorized` | Signer is not the owner or an operator on this account |
| 6001 | `ExceedsPerTxLimit` | Transfer amount exceeds operator's per-transaction spending limit |
| 6002 | `ExceedsDailyLimit` | Transfer exceeds operator daily limit (not yet enforced) |
| 6003 | `AccountPaused` | Account is paused — operator transfers blocked until owner unpauses |
| 6004 | `MaxOperatorsReached` | Account already has 3 operators (maximum) |
| 6005 | `OperatorNotFound` | Specified operator not found on account |
| 6006 | `OperatorAlreadyExists` | Operator is already on this account |
| 6007 | `InsufficientBalance` | Account doesn't have enough tokens for this transfer |
| 6008 | `MathOverflow` | Arithmetic overflow in calculation |

### Escrow Program Errors (Handshake)

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

- **Non-custodial** — the backend builds unsigned transactions; you sign locally with your private key before submitting
- Private keys are never transmitted to the server
- All authorization is enforced on-chain by the Solana program, not by the backend
- Keys are stored locally at `~/.config/silk/config.json` — never share this file
