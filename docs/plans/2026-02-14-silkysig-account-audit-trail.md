# Silkysig Account Audit Trail

## Context

Silkysig account operations (create, close, deposit, transfer, operator add/remove, pause/unpause) currently have **zero database persistence**. The backend builds unsigned transactions and submits them via `/api/tx/submit`, but `indexFromTx()` only indexes Handshake transfers — Silkysig events are silently skipped. Both the frontend and SDK already route all Silkysig transactions through the same submit endpoint, so the plumbing exists. We need to add indexing logic and DB entities to capture a full audit trail.

## Data Model

Three new entities. `SilkAccount` and `SilkAccountOperator` mirror current on-chain state. `SilkAccountEvent` is an append-only audit log.

### `SilkAccount` entity — `src/db/models/SilkAccount.ts`

One row per PDA. Represents current state. Never deleted, only status-updated.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | `v4()` |
| `pda` | string, unique | Account PDA address |
| `owner` | string | Owner pubkey |
| `mint` | string | Token mint address |
| `status` | enum: `ACTIVE`, `CLOSED` | Cycles on create/close |
| `createdAt` | Date | First creation time |
| `updatedAt` | Date | `onUpdate` |

### `SilkAccountOperator` entity — `src/db/models/SilkAccountOperator.ts`

Mirrors current on-chain operator slots. Rows are **created on add, deleted on remove**. The event log preserves the full history.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | `v4()` |
| `account` | ManyToOne → SilkAccount | FK |
| `operator` | string | Operator pubkey |
| `perTxLimit` | string | Per-transaction spending limit (raw amount) |
| `createdAt` | Date | When operator was added |

When an account is closed, all its operator rows are deleted (they no longer exist on-chain). If the account is re-created and operators re-added, new rows are created.

### `SilkAccountEvent` entity — `src/db/models/SilkAccountEvent.ts`

Append-only audit log. One row per operation. Never modified or deleted.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | `v4()` |
| `account` | ManyToOne → SilkAccount | FK |
| `eventType` | enum | See below |
| `txid` | string | Solana tx signature |
| `actor` | string | Fee payer pubkey (signer) |
| `data` | JSON, nullable | Event-specific payload |
| `createdAt` | Date | |

**Event types:** `ACCOUNT_CREATED`, `ACCOUNT_CLOSED`, `DEPOSIT`, `TRANSFER`, `OPERATOR_ADDED`, `OPERATOR_REMOVED`, `PAUSED`, `UNPAUSED`

**`data` payloads:**
- `OPERATOR_ADDED`: `{ operator: string, perTxLimit: string }`
- `OPERATOR_REMOVED`: `{ operator: string }`
- `TRANSFER`: `{ recipient: string, amount: string }`
- `DEPOSIT`: `{ sender: string, amount: string }`
- Others: `null`

## Implementation Steps

### Step 1: Create entity files

**`src/db/models/SilkAccount.ts`** — MikroORM entity following the same pattern as `Transfer.ts` (UUID PK, `@Property`, `@Enum`, timestamps with `onUpdate`).

**`src/db/models/SilkAccountOperator.ts`** — MikroORM entity with `@ManyToOne(() => SilkAccount)` relationship. Unique constraint on `(account, operator)` to prevent duplicate operator entries.

**`src/db/models/SilkAccountEvent.ts`** — MikroORM entity with `@ManyToOne(() => SilkAccount)`, `@Enum` for event type, `@Property({ type: 'json', nullable: true })` for data column.

### Step 2: Create migration

Run `npx mikro-orm migration:create` to generate a new migration that creates the `silk_account`, `silk_account_operator`, and `silk_account_event` tables with proper columns, enum types, foreign keys, and unique constraint on `(account, operator)`.

### Step 3: Register entities in `api.module.ts`

Add `SilkAccount`, `SilkAccountOperator`, and `SilkAccountEvent` to `MikroOrmModule.forFeature([...])` in `src/api/api.module.ts`.

### Step 4: Add indexing logic to `AccountService`

**`src/api/service/account.service.ts`** — inject `EntityManager`, `SilkAccount` repo, `SilkAccountOperator` repo, and `SilkAccountEvent` repo. Add:

- `indexSilkysigTx(txid: string, txInfo: any)` method:
  1. Parse Anchor instruction logs to determine event type using the same `log.match(/Instruction: (\w+)/)` pattern from `TxService.parseTerminalStatus()`. Map instruction names: `CreateAccount` → `ACCOUNT_CREATED`, `CloseAccount` → `ACCOUNT_CLOSED`, `Deposit` → `DEPOSIT`, `TransferFromAccount` → `TRANSFER`, `AddOperator` → `OPERATOR_ADDED`, `RemoveOperator` → `OPERATOR_REMOVED`, `TogglePause` → `PAUSED`/`UNPAUSED` (determine which by fetching account state post-tx).
  2. Find the SilkAccount PDA among the transaction's account keys by attempting `silkysigClient.fetchAccount()` on each key (same pattern as Handshake indexing).
  3. For `ACCOUNT_CLOSED`: the account won't exist on-chain anymore, so look up the PDA in the DB instead.
  4. Upsert `SilkAccount` row: create if new, flip status to `ACTIVE` on create, `CLOSED` on close.
  5. Sync operators:
     - `OPERATOR_ADDED`: create `SilkAccountOperator` row with operator pubkey and perTxLimit from the fetched on-chain account state.
     - `OPERATOR_REMOVED`: delete the `SilkAccountOperator` row matching the operator pubkey.
     - `ACCOUNT_CREATED` (with operator in same tx): create operator row if the on-chain account shows an operator after creation.
     - `ACCOUNT_CLOSED`: delete all `SilkAccountOperator` rows for this account.
  6. Extract event-specific data: amounts from `txInfo.meta.preTokenBalances`/`postTokenBalances` diffs, operator pubkeys from account keys or on-chain state.
  7. Insert `SilkAccountEvent` row with txid, actor (fee payer = `accountKeys[0]`), event type, and data.

- `findAccountsByOwner(owner: string)` — query `SilkAccount` rows by owner, populate operators.
- `findEventsByAccount(pda: string, eventType?: string)` — query `SilkAccountEvent` rows by account PDA, ordered by `createdAt` desc, with optional event type filter.

### Step 5: Call indexing from `TxService.indexFromTx()`

In `src/api/service/tx.service.ts`, after the existing Handshake indexing loop, add:

```typescript
await this.accountService.indexSilkysigTx(txid, txInfo);
```

Inject `AccountService` into `TxService` constructor.

### Step 6: Add API endpoints to `AccountController`

In `src/api/controller/account.controller.ts`, add:

- `GET /api/account/list?owner=<pubkey>` — calls `accountService.findAccountsByOwner()`, returns account rows from DB with their current operators.
- `GET /api/account/:pda/events?eventType=<optional>` — calls `accountService.findEventsByAccount()`, returns event log.

## Files to modify

| File | Change |
|---|---|
| `src/db/models/SilkAccount.ts` | **NEW** — entity |
| `src/db/models/SilkAccountOperator.ts` | **NEW** — entity |
| `src/db/models/SilkAccountEvent.ts` | **NEW** — entity |
| `migrations/Migration<timestamp>.ts` | **NEW** — migration |
| `src/api/api.module.ts` | Register new entities in `forFeature` |
| `src/api/service/account.service.ts` | Add DB injection, indexing method, query methods |
| `src/api/service/tx.service.ts` | Inject AccountService, call `indexSilkysigTx()` from `indexFromTx()` |
| `src/api/controller/account.controller.ts` | Add `list` and `events` endpoints |

## Verification

1. Run the migration against local PostgreSQL
2. Build the backend: `yarn build` in `apps/backend`
3. Start the backend and verify startup succeeds
4. Test the flow end-to-end:
   - Create a Silkysig account via `POST /api/account/create` → sign → `POST /api/tx/submit`
   - Verify `SilkAccount` row appears in DB with status `ACTIVE`
   - Verify `SilkAccountOperator` row exists if operator was included in creation
   - Verify `SilkAccountEvent` row with type `ACCOUNT_CREATED` and correct txid
   - Add operator → verify new `SilkAccountOperator` row + `OPERATOR_ADDED` event
   - Remove operator → verify `SilkAccountOperator` row deleted + `OPERATOR_REMOVED` event
   - Close account → verify status `CLOSED`, all operator rows deleted, `ACCOUNT_CLOSED` event
   - Query `GET /api/account/list?owner=<pubkey>` — should return account with operators
   - Query `GET /api/account/<pda>/events` — should return full event history
