# Silkyway

Secure USDC transfers for autonomous agents on Solana.

## The problem with one-way transfers

When agents send USDC today, there's no safety net. Send to the wrong address — gone. Recipient loses wallet access — gone. Pay before delivery — hope they deliver. One-way transfers force one side to take all the risk.

## How Silkyway fixes it

Silkyway holds USDC in on-chain escrow until both sides are satisfied. Every transfer is reversible until the recipient claims it.

- **Cancel before claim** — sent to the wrong address? Cancel and get a full refund. No fat-finger anxiety.
- **Time-locks** — set approval windows (`--claimable-after`) so payments aren't claimed instantly. Review before release.
- **Recipient decline** — recipients can refuse unwanted transfers. No stuck funds.
- **On-chain custody** — the Solana program holds the tokens, not either party. Neither side can rug the other.

Five resolution paths: **claim**, **cancel**, **decline** (recipient refuses), **reject** (operator blocks), **expire** (deadline passed). Every path except claim refunds the sender in full.

```
Sender → [create_transfer] → Escrow (USDC locked on-chain)
Escrow → [claim_transfer]  → Recipient (USDC released, fee deducted)
Escrow → [cancel_transfer] → Sender (USDC refunded in full)
```

## Getting started

```bash
# Install
npm install -g https://silkyway.ai/sdk/silkyway-sdk-0.1.0.tgz

# Create wallet + fund with devnet SOL and USDC
silk wallet create
silk wallet fund

# Send 25 USDC into escrow
silk pay <recipient-address> 25 --memo "Payment for services"

# Recipient claims
silk claim <transfer-pda>
```

Zero config required. The built-in faucet provides devnet SOL (0.1) and USDC (100) — no external faucets, no RPC setup.

Read the [skill file](skill.md) for the complete API reference, CLI commands, error codes, and end-to-end examples.

## Why this matters

Agents can now pay each other with trust guarantees.

Without escrow, agent payments are either prepaid (sender takes all risk) or postpaid (recipient takes all risk). Silkyway makes the on-chain program the neutral custodian — the sender can't spend locked tokens elsewhere, and the recipient knows the funds exist before doing work.

### What this enables

- **Agent-to-agent service markets** — pay into escrow, worker claims on delivery
- **Conditional payments** — time-locked escrow enables approval windows ("pay after 24h if no dispute")
- **Autonomous bounties** — post a transfer, any qualifying agent claims it
- **Multi-step workflows** — chain escrow payments: A→B→C, each step independently cancellable
- **Pay-per-use APIs** — pay per call into escrow, provider claims after serving the request
- **Refundable deposits** — lock tokens for access, cancel to reclaim when done

## How it works

Silkyway is non-custodial. Your private keys never leave your machine.

The system uses a build→sign→submit model:

1. **Your agent requests a transaction** — the SDK calls the backend API with the payment details (recipient, amount, memo)
2. **The backend builds an unsigned transaction** — it handles Solana complexity (PDA derivation, instruction building, blockhash) and returns a raw unsigned transaction
3. **The SDK signs locally** — your private key signs the transaction on your machine
4. **The SDK submits the signed transaction** — the backend forwards it to Solana and confirms it on-chain

```
Agent/SDK                     Backend API                    Solana
   │                              │                            │
   ├── "pay Alice 25 USDC" ─────►│                            │
   │                              ├── build unsigned tx ──────►│
   │◄── unsigned tx (base64) ─────┤                            │
   │                              │                            │
   │   sign with local key        │                            │
   │                              │                            │
   ├── signed tx ────────────────►│                            │
   │                              ├── submit to Solana ───────►│
   │                              │◄── confirmed ──────────────┤
   │◄── { txid, transferPda } ────┤                            │
```

The backend never sees your private key. It only builds the transaction structure — authorization is enforced on-chain by the Solana program.

## Architecture

**On-chain program** (Anchor/Solana) — pool-based escrow with operator model. Operators set fees, manage pools, can pause/reject. Pools support any SPL token (USDC on devnet). Uses `token_interface` for Token-2022 compatibility.

**Backend API** (NestJS) — builds unsigned transactions, accepts signed submissions, indexes on-chain state to PostgreSQL. Never handles private keys.

**SDK + CLI** (`@silkyway/sdk`) — TypeScript client with Commander.js CLI. Handles local signing, multi-wallet support, JSON output for agents, `--human` flag for humans.

## Technical details

- **Program ID:** [`HZ8paEkYZ2hKBwHoVk23doSLEad9K5duASRTGaYogmfg`](https://solscan.io/account/HZ8paEkYZ2hKBwHoVk23doSLEad9K5duASRTGaYogmfg?cluster=devnet)
- **Network:** Solana devnet
- **Token:** USDC (SPL token, 6 decimals)
- **Fee model:** Configurable basis points per pool (0-100%), charged only on successful claims
- **PDA scheme:** Pool `["pool", pool_id]`, Transfer `["sender", sender, "recipient", recipient, "nonce", nonce]`
- **Security:** All transfers use `transfer_checked`, mint validated on every instruction, PDA-based authorization

## Links

- [Skill file](skill.md) — complete API reference, CLI, error codes, examples
- [Basic Escrow Flow](examples/basic-escrow.md) — create, claim, cancel patterns
- [Live Transfer Activity](https://silkyway.ai/activity) — real-time on-chain activity
- [Changelog](CHANGELOG.md) — version history
- [Navigation](nav.md) — full site map
