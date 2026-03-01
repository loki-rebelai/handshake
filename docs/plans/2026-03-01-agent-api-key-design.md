# Agent API Key Design

## Overview

Add authentication to the SilkyWay backend API. Agents register using their Solana keypair and receive a long-lived API key. All endpoints require the key.

## Auth Flow

```
GET  /api/auth/challenge?pubkey=<base58>
  → { nonce: "silk_<uuid>" }

POST /api/auth/register
  body: { pubkey: string, signature: string }
  → { apiKey: "sw_<random>" }

POST /api/auth/revoke
  header: Authorization: Bearer <apiKey>
  → { ok: true }
```

1. Agent GETs a challenge nonce for their pubkey (valid 60s, stored in-memory)
2. Agent signs the nonce string with their Solana keypair (`nacl.sign.detached`)
3. Server verifies the signature against the pubkey
4. Server upserts an `ApiKey` row — if one already exists for that pubkey, it rotates the key
5. Raw key returned once; only SHA-256 hash stored in DB

Subsequent requests: `Authorization: Bearer sw_<key>`

## Data Model

### `ApiKey` entity

| Column     | Type      | Notes                        |
|------------|-----------|------------------------------|
| id         | uuid      | PK                           |
| pubkey     | string    | unique, Solana pubkey base58 |
| keyHash    | string    | unique, SHA-256 of raw key   |
| createdAt  | timestamp |                              |
| revokedAt  | timestamp | nullable — null = active     |

Raw key format: `sw_<32 random bytes as hex>` (66 chars total). Never stored.

### Nonce store (in-memory)

```typescript
Map<pubkey, { nonce: string; expiresAt: number }>
```

60-second TTL. Cleaned up lazily on lookup. No Redis needed.

## Guard

Global `ApiKeyGuard` applied via `APP_GUARD` in `AppModule`.

```
1. Check if route is @Public() or /api/auth/*  → skip
2. Extract key from Authorization: Bearer header
3. SHA-256 hash the key
4. Query DB: WHERE key_hash = ? AND revoked_at IS NULL
5. Not found → 401 Unauthorized
6. Attach to request: req.agent = { pubkey }
```

## File Structure

```
src/api/auth/
  auth.controller.ts   — challenge, register, revoke
  auth.service.ts      — nonce store, key generation, sig verification
  auth.guard.ts        — global NestJS guard
  public.decorator.ts  — @Public() decorator for whitelisted routes
src/db/models/
  ApiKey.ts            — MikroORM entity
migrations/
  <timestamp>_create_api_key.ts
```

## Key Decisions

- **One key per pubkey** — registering again rotates the existing key
- **Long-lived, manual revoke** — no TTL on keys
- **Hash-only storage** — raw key never persisted; if lost, agent re-registers
- **Nonce prevents replay** — each registration attempt uses a server-issued one-time nonce
