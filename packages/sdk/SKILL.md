---
name: silkyway
description: Send and receive USDC payments on Solana via the Silkyway protocol. Use when you need to make payments, transfer funds, or manage escrow transactions between agents.
metadata:
  author: rebelfi
  version: "0.1.0"
compatibility: Requires Node.js 18+, npm, and internet access to Solana devnet.
---

# Silkyway Payments

Send and receive USDC payments on Solana using the Silkyway protocol.

## Installation

```bash
npm install -g https://silkyway.ai/sdk/silkyway-sdk-0.1.0.tgz
```

## First-Time Setup

If you don't have a wallet configured yet:

```bash
# 1. Create your wallet
silk wallet create

# 2. Fund it with devnet SOL and USDC
silk wallet fund
```

Your wallet is saved at `~/.config/silk/config.json`. You only need to do this once.

## Sending a Payment

```bash
silk pay <recipient-address> <amount>
```

Example:
```bash
silk pay 7xKXz9BpR3mFVDg2Thh3AG6sFRPqNrDJ4bHUkR8Y7vNx 25 --memo "Payment for code review"
```

This sends USDC into escrow. The recipient must claim it. You'll get back a **Transfer PDA** — save this if you need to cancel later.

## Checking Your Balance

```bash
silk balance
```

## Viewing Transfers

```bash
# List active (unclaimed) transfers
silk payments list

# Get details on a specific transfer
silk payments get <transfer-pda>
```

## Claiming a Payment

If someone sent you a payment, claim it:

```bash
silk payments list
silk claim <transfer-pda>
```

## Cancelling a Payment

Cancel a payment you sent (if it hasn't been claimed yet):

```bash
silk cancel <transfer-pda>
```

## Multi-Wallet Support

Create additional wallets for testing:

```bash
silk wallet create second-wallet
silk wallet fund --wallet second-wallet
silk wallet list
```

Use `--wallet <label>` on any command to specify which wallet to use:

```bash
silk pay <address> 10 --wallet second-wallet
silk claim <transfer-pda> --wallet second-wallet
silk balance --wallet second-wallet
```

## Account Setup (Policy-Enforced Payments)

Silkysig accounts let your human set spending policies that control how much you can send per transaction. This is the recommended way to handle agent payments.

1. Create your wallet (if you haven't already):
   ```bash
   silk wallet create
   ```

2. Share the setup URL with your human:
   ```
   https://silk.silkyway.ai/account/setup?agent=YOUR_ADDRESS
   ```

3. After your human creates the account, sync it:
   ```bash
   silk account sync
   ```

4. Check your account status:
   ```bash
   silk account status
   ```

5. Send payments (policy-enforced on-chain):
   ```bash
   silk account send <recipient> <amount>
   ```

The `silk account send` command is policy-enforced: the on-chain program checks your operator per-transaction limit and rejects transfers that exceed it.

## Command Reference

| Command | Description |
|---------|-------------|
| `wallet create [label]` | Create a new wallet (first one is named "main") |
| `wallet list` | List all wallets with addresses |
| `wallet fund [--sol] [--usdc] [--wallet <label>]` | Fund wallet from devnet faucet |
| `balance [--wallet <label>]` | Show SOL and USDC balances |
| `pay <recipient> <amount> [--memo <text>] [--wallet <label>]` | Send USDC payment |
| `claim <transfer-pda> [--wallet <label>]` | Claim a received payment |
| `cancel <transfer-pda> [--wallet <label>]` | Cancel a sent payment |
| `payments list [--wallet <label>]` | List transfers |
| `payments get <transfer-pda>` | Get transfer details |
| `account sync [--wallet <label>] [--account <pda>]` | Discover your account (must be set up by human first) |
| `account status [--wallet <label>]` | Show balance and spending policy |
| `account send <recipient> <amount> [--memo <text>] [--wallet <label>]` | Send tokens (policy-enforced on-chain) |

## Security

Your private keys are stored locally at `~/.config/silk/config.json`. Never share this file or transmit your private keys to any service other than signing transactions locally.
