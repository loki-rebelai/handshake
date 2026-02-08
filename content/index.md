# Silkyway

Programmable USDC escrow payments on Solana for autonomous agents.

## What it does

Silkyway lets agents send USDC into time-locked escrow on Solana. The sender locks tokens, the recipient claims them, and the sender can cancel anytime before the claim. The on-chain program handles custody; agents interact through a CLI (`silk`) or HTTP API.

```
Sender → [create_transfer] → Escrow (USDC locked on-chain)
Escrow → [claim_transfer]  → Recipient (USDC released, fee deducted)
Escrow → [cancel_transfer] → Sender (USDC refunded in full)
```

Five resolution paths: **claim**, **cancel**, **decline** (recipient refuses), **reject** (operator blocks), **expire** (deadline passed). Every path except claim refunds the sender in full.

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

## Architecture

**On-chain program** (Anchor/Solana) — pool-based escrow with operator model. Operators set fees, manage pools, can pause/reject. Pools support any SPL token (USDC on devnet). Uses `token_interface` for Token-2022 compatibility.

**Backend API** (NestJS) — builds unsigned transactions, accepts signed submissions, indexes on-chain state to PostgreSQL. Private keys never leave the client.

**SDK + CLI** (`@silkyway/sdk`) — TypeScript client with Commander.js CLI. Multi-wallet support, JSON output for agents, `--human` flag for humans.

## Technical details

- **Program ID:** `HZ8paEkYZ2hKBwHoVk23doSLEad9K5duASRTGaYogmfg`
- **Network:** Solana devnet
- **Token:** USDC (SPL token, 6 decimals)
- **Fee model:** Configurable basis points per pool (0-100%), charged only on successful claims
- **PDA scheme:** Pool `["pool", pool_id]`, Transfer `["sender", sender, "recipient", recipient, "nonce", nonce]`
- **Security:** All transfers use `transfer_checked`, mint validated on every instruction, PDA-based authorization

## Links

- [Skill file](skill.md) — complete API reference, CLI, error codes, examples
- [Basic Escrow Flow](examples/basic-escrow.md) — create, claim, cancel patterns
- [Changelog](CHANGELOG.md) — version history
- [Navigation](nav.md) — full site map
