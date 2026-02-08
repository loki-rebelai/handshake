# Architecture

Silkyway is a protocol for programmable payments on Solana. It consists of three components: an on-chain escrow program (**Handshake**), a backend API (**Site**), and a client SDK+CLI (**SDK**).

## Handshake — On-Chain Program

**Program ID:** `HZ8paEkYZ2hKBwHoVk23doSLEad9K5duASRTGaYogmfg`

Handshake is a Solana program (Anchor v0.32.1) that implements token escrow with operator-managed pools.

### Pools & the Operator Model

A **pool** is a configurable escrow venue for a specific SPL token (e.g. USDC). Every pool has an **operator** — a trusted party that sets the fee and has administrative control.

The operator model enables third-party platforms to run their own escrow infrastructure on top of Handshake. For example, an agentic gig economy marketplace might create a USDC pool with a 10 bps fee on every completed escrow. The operator earns revenue from successful claims while the on-chain program enforces the rules.

**Pool fields:**

| Field | Description |
|---|---|
| `pool_id` | Unique identifier (Pubkey) |
| `operator` | Pool owner — sets fees, can pause/reject/withdraw |
| `mint` | SPL token mint (USDC, USDT, etc.) |
| `transfer_fee_bps` | Fee in basis points (0–10000). 100 = 1% |
| `total_deposits` | Cumulative tokens deposited |
| `total_withdrawals` | Cumulative tokens withdrawn |
| `total_escrowed` | Tokens currently locked |
| `collected_fees` | Accumulated operator fees, withdrawable |
| `is_paused` | Emergency pause flag |

**Operator capabilities:**

- Set fee rate at pool creation
- Withdraw accumulated fees
- Pause/unpause the pool (blocks new transfers)
- Reject individual transfers (refunds sender)
- Emergency destroy transfers when paused (funds go to operator)
- Reset pool counters (requires no outstanding transfers)
- Close pool permanently

Fees are only charged on successful claims. Cancellations, rejections, declines, and expirations all refund the sender in full with no fee.

**Future extensions:** The pool model is designed to support yield on escrowed funds, additional fee structures, and other operator-configurable behavior.

### Escrow Lifecycle

A **SecureTransfer** represents a single escrow between a sender and recipient within a pool.

```
                   ┌─────────┐
                   │  Created │  (sender deposits tokens into pool vault)
                   └────┬────┘
                        │
          ┌─────────────┼─────────────────┬──────────────┐
          ▼             ▼                 ▼              ▼
     ┌─────────┐  ┌──────────┐    ┌───────────┐   ┌──────────┐
     │ Claimed  │  │ Cancelled│    │  Declined  │   │ Rejected │
     │(recipient│  │ (sender) │    │(recipient) │   │(operator)│
     │ gets net)│  │ full     │    │ full       │   │ full     │
     └─────────┘  │ refund   │    │ refund     │   │ refund   │
                  └──────────┘    └───────────┘   └──────────┘
                        │
                        ▼
                  ┌──────────┐
                  │ Expired  │  (anyone can trigger after deadline)
                  │ full     │
                  │ refund   │
                  └──────────┘
```

**Transfer fields:**

| Field | Description |
|---|---|
| `sender` | Who created and funded the transfer |
| `recipient` | Who can claim it |
| `pool` | Parent pool |
| `amount` | Escrowed token amount |
| `nonce` | Client-provided uniqueness value |
| `claimable_after` | Earliest claim time (0 = immediate) |
| `claimable_until` | Claim deadline (0 = no deadline) |
| `status` | Active, Claimed, Cancelled, Rejected, Expired, Declined |
| `memo` | 64-byte memo field |
| `compliance_hash` | Optional 32-byte hash for travel rule compliance |
| `release_conditions` | Reserved for future use (multi-sig, oracle, milestones) |

**Fee calculation on claim:** `fee = amount × transfer_fee_bps / 10000`. The recipient receives `amount - fee`. The fee accrues to the pool's `collected_fees`.

### PDA Derivation

| Account | Seeds |
|---|---|
| Pool | `["pool", pool_id]` |
| SecureTransfer | `["sender", sender, "recipient", recipient, "nonce", nonce_bytes]` |

The transfer PDA scheme means a given sender/recipient/nonce combo is unique. Senders increment the nonce for multiple transfers to the same recipient.

### Instructions

| Instruction | Who | What |
|---|---|---|
| `init_pool` | Operator | Create pool with mint and fee config |
| `pause_pool` | Operator | Toggle pause state |
| `reset_pool` | Operator | Reset counters (no outstanding transfers) |
| `close_pool` | Operator | Close pool permanently, withdraw balance |
| `withdraw_fees` | Operator | Withdraw accumulated fees |
| `create_transfer` | Anyone | Deposit tokens into escrow |
| `claim_transfer` | Recipient | Claim funds (fee deducted) |
| `cancel_transfer` | Sender | Cancel and reclaim funds |
| `decline_transfer` | Recipient | Refuse payment, refund sender |
| `reject_transfer` | Operator | Block transfer, refund sender |
| `expire_transfer` | Anyone | Permissionless cleanup after deadline |
| `destroy_transfer` | Operator | Emergency recovery (pool must be paused) |

### Token Handling

- Uses `anchor_spl::token_interface` (Token-2022 compatible)
- All transfers use `transfer_checked` (validates decimals and mint)
- Pool vault is an ATA owned by the pool PDA
- Mint is validated on every instruction to prevent cross-mint attacks

---

## Site — NestJS Backend

The site is an agent-native NestJS server that bridges agents/clients to the on-chain program. It builds unsigned transactions, accepts signed transactions for submission, and indexes on-chain state into a queryable database.

### Dual Interface

The site serves two audiences:

**Agents** — Markdown-first content delivery. Agents discover the site via `/.well-known/agent.json`, read `/llms.txt` for context, and consume `/skill.md` for the complete API reference. All documentation is served as `text/markdown`.

**Humans** — `GET /human` serves a landing page. Browsers visiting `/` are redirected to `/human` automatically.

### Transaction Flow

The core pattern is build → sign → submit:

```
Agent/CLI                    Site (NestJS)                  Solana
    │                            │                            │
    ├── POST /api/tx/create ────►│                            │
    │   (recipient, amount)      │◄── derive PDAs, build ix ──┤
    │◄── unsigned tx (base64) ───┤                            │
    │                            │                            │
    │   sign locally             │                            │
    │                            │                            │
    ├── POST /api/tx/submit ────►│                            │
    │   (signed tx base64)       ├── sendRawTransaction ─────►│
    │                            │◄── confirm ────────────────┤
    │                            │   index transfer to DB     │
    │◄── { txid, transferPda } ──┤                            │
```

Private keys never leave the client. The backend handles Solana complexity (PDA derivation, Anchor instruction building, blockhash management) while the client only needs to sign.

### Modules

| Module | Scope | Responsibility |
|---|---|---|
| `ContentModule` | Content delivery | Serves markdown files from `content/` |
| `SolanaModule` | Global | Solana connection, Anchor program, HandshakeClient, faucets |
| `ApiModule` | API endpoints | Transaction building, submission, queries |

### API Endpoints

**Transactions (`/api/tx/`)**

| Endpoint | Method | Description |
|---|---|---|
| `/api/tx/create-transfer` | POST | Build unsigned create_transfer tx |
| `/api/tx/claim-transfer` | POST | Build unsigned claim_transfer tx |
| `/api/tx/cancel-transfer` | POST | Build unsigned cancel_transfer tx |
| `/api/tx/submit` | POST | Submit signed tx to Solana |
| `/api/tx/faucet` | POST | Devnet SOL/USDC airdrop (rate-limited) |

**Queries**

| Endpoint | Method | Description |
|---|---|---|
| `/api/transfers?wallet=<pubkey>` | GET | List transfers for a wallet |
| `/api/transfers/:pda` | GET | Get transfer by PDA |
| `/api/wallet/:address/balance` | GET | SOL + token balances |
| `/api/tokens` | GET | List supported tokens |

All responses use `{ ok: true/false, data/error }` format.

### Database

PostgreSQL via MikroORM. The database indexes on-chain state for fast queries.

| Entity | Key Fields |
|---|---|
| **Token** | mint, name, symbol, decimals |
| **Pool** | poolPda, operatorKey, token, feeBps, isPaused |
| **Transfer** | transferPda, sender, recipient, amount, status, pool, token, memo, timestamps |

After a transaction confirms, the backend parses it and upserts the relevant Transfer record. On startup, it syncs Pool and Token state from on-chain accounts.

### Content Structure

```
content/
├── index.md              # Agent landing page
├── llms.txt              # LLM discovery entry point
├── skill.md              # Complete API reference (~500 lines)
├── nav.md                # Site map
├── CHANGELOG.md          # Version history
└── examples/
    └── basic-escrow.md   # Example workflows
```

---

## SDK — TypeScript Client + CLI

The SDK (`@silkyway/sdk`) provides a programmatic API and a CLI (`silk`) for interacting with Handshake through the site backend.

### Architecture

```
┌─────────────────────────────────────────────┐
│  CLI (Commander.js)                         │
│  silk wallet | balance | pay | claim | ...  │
├─────────────────────────────────────────────┤
│  Validation Layer                           │
│  Pre-flight checks (balance, status, auth)  │
├─────────────────────────────────────────────┤
│  HTTP Client (Axios)                        │
│  Talks to Site backend API                  │
├─────────────────────────────────────────────┤
│  Config Manager                             │
│  ~/.config/silk/config.json                 │
│  Wallets, API URL, preferences              │
└─────────────────────────────────────────────┘
```

### CLI Commands

| Command | Description |
|---|---|
| `silk wallet create [label]` | Generate new Solana keypair |
| `silk wallet list` | Show wallets |
| `silk wallet fund` | Request devnet SOL/USDC |
| `silk balance` | Check SOL and token balances |
| `silk pay <recipient> <amount>` | Send USDC to escrow |
| `silk claim <transferPda>` | Claim received payment |
| `silk cancel <transferPda>` | Cancel sent payment |
| `silk payments list` | List transfers |
| `silk payments get <pda>` | Get transfer details |

### Output Modes

- **JSON** (default): `{ ok: true, data: {...} }` — for agent consumption
- **Human** (`--human` flag): Pretty-printed key-value pairs

### Security Model

- Keypairs generated and stored locally (`~/.config/silk/config.json`)
- Private keys never transmitted to the backend
- Transactions signed locally before submission
- On-chain program enforces all authorization rules

### Error Handling

The SDK maps Anchor program error codes (6000–6029) to human-readable messages (e.g. `TRANSFER_NOT_ACTIVE`, `ONLY_RECIPIENT_CAN_CLAIM`). Errors are surfaced as typed `SdkError` instances with code and message.
