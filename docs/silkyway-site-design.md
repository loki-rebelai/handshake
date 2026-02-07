# Silkyway Agent-Native Site — Implementation Design

> NestJS backend serving an agent-native website for the Handshake escrow protocol.
> Agents discover capabilities via `llms.txt` and `skill.md`, query live data via REST API,
> and interact through a Node SDK.

---

## Architecture Overview

```
┌──────────────────────────────────────────────┐
│  Agent Request                               │
│  ├── GET /llms.txt         → markdown        │
│  ├── GET /skill.md         → markdown        │
│  ├── GET /docs/*           → markdown        │
│  ├── GET /.well-known/agent.json → JSON      │
│  ├── GET /api/transfers    → live data       │
│  ├── POST /api/tx/*        → tx building     │
│  ├── POST /api/faucet      → testnet funding │
│  └── (future) MCP          → JSON-RPC 2.0   │
├──────────────────────────────────────────────┤
│  NestJS                                      │
│  ├── ContentModule → serves markdown         │
│  ├── ApiModule     → controllers + services  │
│  ├── DbModule      → all entities + repos    │
│  └── SolanaModule  → RPC, program, faucet    │
├──────────────────────────────────────────────┤
│  MikroORM + PostgreSQL                       │
│  ├── Transfer entity                         │
│  ├── Pool entity                             │
│  └── Token entity                            │
├──────────────────────────────────────────────┤
│  Solana (devnet)                             │
│  └── Handshake Program (Anchor)              │
└──────────────────────────────────────────────┘
```

---

## Project Structure

```
/                               # Root = NestJS project
├── content/                    # Markdown files = the website
│   ├── llms.txt
│   ├── skill.md
│   ├── nav.md
│   ├── CHANGELOG.md
│   ├── skills/
│   │   ├── sdk-install.md
│   │   ├── payments.md
│   │   ├── queries.md
│   │   └── faucet.md
│   ├── docs/
│   │   ├── index.md
│   │   ├── architecture.md
│   │   ├── instructions.md
│   │   └── api-reference.md
│   ├── examples/
│   │   ├── index.md
│   │   └── basic-escrow.md
│   └── reference/
│       ├── index.md
│       ├── errors.md
│       └── accounts.md
│
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   │
│   ├── content/               # Markdown serving
│   │   ├── content.module.ts
│   │   └── content.controller.ts
│   │
│   ├── api/                   # All API controllers + services
│   │   ├── api.module.ts
│   │   ├── controller/
│   │   │   ├── transfer.controller.ts   # GET /api/transfers, /api/transfers/:pda
│   │   │   └── tx.controller.ts         # POST /api/tx/*, /api/faucet
│   │   └── service/
│   │       ├── transfer.service.ts      # Transfer queries + persistence
│   │       └── tx.service.ts            # Tx building + submission
│   │
│   ├── solana/                # Solana infrastructure + faucet
│   │   ├── solana.module.ts
│   │   ├── solana.service.ts  # RPC connection, faucet
│   │   └── handshake-client.ts # Anchor program wrapper
│   │
│   └── db/                    # All entities + ORM config
│       ├── models/
│       │   ├── Transfer.ts
│       │   ├── Pool.ts
│       │   └── Token.ts
│       ├── repositories/
│       │   ├── transfer.repository.ts
│       │   └── pool.repository.ts
│       └── mikro-orm.config.ts
│
├── .well-known/
│   └── agent.json             # A2A discovery (served as static)
│
├── handshake/                 # Solana program (existing)
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── nest-cli.json
└── .env
```

---

## Module Design

Four modules total: **ContentModule**, **ApiModule**, **SolanaModule**, **DbModule** (via MikroORM).

### ContentModule

Serves markdown files from `content/` via a controller (not static serving), so we control headers.

**Controller routes:**
- `GET /llms.txt` → `content/llms.txt`
- `GET /skill.md` → `content/skill.md`
- `GET /nav.md` → `content/nav.md`
- `GET /docs/:path` → `content/docs/:path`
- `GET /skills/:path` → `content/skills/:path`
- `GET /examples/:path` → `content/examples/:path`
- `GET /reference/:path` → `content/reference/:path`

**Response headers:**
- `Content-Type: text/markdown; charset=utf-8`
- `Last-Modified` from file mtime
- `Cache-Control: public, max-age=300` (5 min)

**Static files** (served via `ServeStaticModule`):
- `/.well-known/agent.json`

Simple `fs.readFile` + path sanitization to prevent directory traversal.

### SolanaModule

Shared module providing RPC connection, the Handshake program client, and faucet functionality. Follows the Factory pattern from Hermes.

**SolanaService provides:**
- `Connection` instance (configured from `RPC_URL` env var)
- `HandshakeClient` — Anchor program wrapper (adapted from `HermesClient`)
- `requestAirdrop(pubkey)` — SOL airdrop via `connection.requestAirdrop`
- `mintTestUsdc(pubkey)` — Mint test USDC via mint authority keypair
- Rate limit for faucet: 1 request per wallet per 10 minutes (in-memory map)

**HandshakeClient wraps:**
- `fetchTransfer(pda)` → decoded transfer account
- `fetchPool(pda)` → decoded pool account
- `getCreateTransferIx(params)` → instruction
- `getClaimTransferIx(params)` → instruction
- `getCancelTransferIx(params)` → instruction
- PDA derivation helpers

**Adapted from Hermes:**
- `HermesClient` → `HandshakeClient` (same pattern, different program/IDL)
- `FactoryService` → simplified `SolanaService` (no Drift, no S3, no rate limiter beyond faucet)

### ApiModule

All API controllers and services. Imports SolanaModule and MikroORM entities.

**Controllers:**

`TransferController`:
- `GET /api/transfers?wallet=<pubkey>` → list transfers for a wallet
- `GET /api/transfers/:pda` → single transfer details

`TxController`:
- `POST /api/tx/create-transfer` → build unsigned create_transfer tx
- `POST /api/tx/claim-transfer` → build unsigned claim_transfer tx
- `POST /api/tx/cancel-transfer` → build unsigned cancel_transfer tx
- `POST /api/tx/submit` → submit signed tx to Solana, index result
- `POST /api/faucet` → airdrop SOL + USDC (delegates to SolanaService)

**Services:**

`TransferService`:
- `findByWallet(pubkey)` — query transfers where sender or recipient matches
- `findByPda(pda)` — single transfer lookup
- `createFromTx(txData)` — persist after successful tx submission
- `updateStatus(pda, status, txid)` — update on claim/cancel

`TxService`:
- Uses `HandshakeClient` to build instructions
- Serializes unsigned transaction as base64
- On submit: deserialize signed tx → send to Solana RPC → on success, index transfer in DB
- Synchronous submission — no PendingTx/TxSync entities

**Request DTOs:**

```typescript
// POST /api/tx/create-transfer
{
  sender: string;        // pubkey
  recipient: string;     // pubkey
  amount: number;        // human-readable (e.g. 10.00 USDC)
  mint: string;          // token mint
  memo?: string;
  claimableAfter?: number; // unix timestamp
}

// POST /api/tx/claim-transfer
{
  transferPda: string;
  claimer: string;       // pubkey (must be recipient)
}

// POST /api/tx/cancel-transfer
{
  transferPda: string;
  canceller: string;     // pubkey (must be sender)
}

// POST /api/tx/submit
{
  signedTx: string;      // base64-encoded signed transaction
}

// POST /api/faucet
{
  wallet: string;        // pubkey
}
```

**Response for tx building:**
```json
{
  "ok": true,
  "data": {
    "transaction": "<base64 unsigned tx>",
    "message": "Sign and submit via POST /api/tx/submit"
  }
}
```

**Response for faucet:**
```json
{
  "ok": true,
  "data": {
    "sol": { "amount": 1.0, "txid": "..." },
    "usdc": { "amount": 100.0, "txid": "..." }
  }
}
```

### DbModule (MikroORM)

All entities and repositories live in `src/db/`. Registered via MikroORM's module integration.

**Transfer entity** (adapted from Hermes, simplified — no yield):

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid | PK |
| `transferPda` | string | Unique, on-chain PDA |
| `sender` | string | Sender pubkey |
| `recipient` | string | Recipient pubkey |
| `amount` | string | Decimal string (like Hermes `amountDecimal`) |
| `amountRaw` | string | Raw BN as text (like Hermes `amount`) |
| `token` | ManyToOne(Token) | Token reference |
| `pool` | ManyToOne(Pool) | Pool reference |
| `status` | enum | ACTIVE, CLAIMED, CANCELLED, EXPIRED |
| `memo` | string | Optional memo |
| `createTxid` | string | Creation tx signature |
| `claimTxid` | string | Claim tx signature (nullable) |
| `cancelTxid` | string | Cancel tx signature (nullable) |
| `claimableAfter` | Date | Time-lock expiry |
| `createdAt` | Date | |
| `updatedAt` | Date | |

**Pool entity** (simplified from Hermes — no yield):

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid | PK |
| `poolId` | string | On-chain pool ID |
| `poolPda` | string | Unique, on-chain PDA |
| `operatorKey` | string | Pool operator pubkey |
| `token` | ManyToOne(Token) | Pool token |
| `feeBps` | number | Fee in basis points |
| `totalTransfersCreated` | string | BN as text |
| `totalTransfersResolved` | string | BN as text |
| `isPaused` | boolean | |
| `createdAt` | Date | |
| `updatedAt` | Date | |

**Token entity:**

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid | PK |
| `mint` | string | Unique, token mint address |
| `name` | string | |
| `symbol` | string | |
| `decimals` | number | |

**Repositories** (following Hermes `ExtendedEntityRepository` pattern):
- `TransferRepository` — `findByWallet()`, `findByPda()`
- `PoolRepository` — `findByPoolPda()`, `getAllActivePools()`

---

## API Response Convention

All `/api/*` endpoints return:

```typescript
// Success
{ ok: true, data: { ... } }

// Error
{ ok: false, error: "ERROR_CODE", message: "Human-readable description" }
```

HTTP status codes: 200 for success, 400 for bad request, 404 for not found, 500 for server error.

---

## Database Configuration

Adapted from Hermes `mikro-orm.config.ts`:

```typescript
{
  driver: PostgreSqlDriver,
  host: process.env.DATABASE_HOST,
  port: process.env.DATABASE_PORT,
  dbName: process.env.DATABASE_NAME,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  entities: ['./dist/src/**/entities/*.js'],
  entitiesTs: ['./src/**/entities/*.ts'],
  migrations: { path: './migrations' },
  pool: { min: 2, max: 10 },
}
```

---

## Environment Variables

```env
# Server
PORT=3000
NODE_ENV=development

# Database
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=silkyway
DATABASE_USER=postgres
DATABASE_PASSWORD=postgres

# Solana
RPC_URL=https://api.devnet.solana.com
HANDSHAKE_PROGRAM_ID=HZ8paEkYZ2hKBwHoVk23doSLEad9K5duASRTGaYogmfg
SYSTEM_SIGNER_PRIVATE_KEY=<JSON array keypair>

# Token mints (devnet)
USDC_MINT=<devnet USDC mint>
```

---

## Implementation Phases

### Phase 1: Scaffold + Content Serving
1. `nest new` project setup with MikroORM + PostgreSQL
2. Create `ContentModule` with controller-based markdown serving
3. Write all markdown content files (`llms.txt`, `skill.md`, sub-skills, docs)
4. Serve `agent.json` as static file
5. **Verify:** `curl localhost:3000/llms.txt` returns markdown with correct headers

### Phase 2: Solana + DB Infrastructure
1. Create `SolanaModule` with `SolanaService` + `HandshakeClient`
2. Adapt `HermesClient` → `HandshakeClient` for Handshake program IDL
3. Create DB entities (Transfer, Pool, Token) + repositories + migrations
4. **Verify:** App boots, connects to devnet, can fetch a pool account

### Phase 3: API Module — MVP Flow
1. Create `ApiModule` with `TxController` + `TxService`
2. Build unsigned create-transfer, claim-transfer, cancel-transfer endpoints
3. Add `POST /api/tx/submit` — accept signed tx, submit to Solana, index transfer
4. Add `TransferController` + `TransferService` — query endpoints
5. Add `POST /api/faucet` — delegates to `SolanaService` faucet methods
6. **Verify:** Full flow: faucet → build create-transfer tx → sign → submit → query transfer

### Future: MCP, API keys, SDK package
- `McpModule` reusing existing services
- API key authentication middleware
- Publish `@rebelfi/silkyway-sdk` npm package

---

## Key Differences from Hermes

| Aspect | Hermes | Silkyway Site |
|--------|--------|-----------|
| Yield | Yes (Drift integration) | No |
| Tx tracking | PendingTx + TxSync + cron job | Synchronous submit + index |
| Users | User entity with email | No user accounts |
| Email | Email notifications | None |
| Payment links | Yes | No |
| Content serving | None (human frontend) | Markdown-first, agent-native |
| Auth | None currently | None (future API keys) |
| Protocol | Solana Actions | Plain REST |
| Background jobs | TxSync, Mailer crons | None |
