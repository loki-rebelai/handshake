# Plan: `POST /api/orders/evaluate` Endpoint

## Context

The SDK (`@silkysquad/silk`) now supports standing orders (limit orders). On each heartbeat, the agent POSTs the intent to `POST /api/orders/evaluate`. The server checks whether current market conditions can satisfy it (via Jupiter), and either returns an unsigned transaction or a "conditions not met" response. The server is stateless — it never stores orders.

## Files to modify

### 1. `apps/backend/src/services/chains/solana/amount.ts`
Add `fromBaseUnits()` — the inverse of the existing `toBaseUnits()`. Needed to convert Jupiter's raw `outAmount` back to human-readable form for the response quote.

```typescript
export function fromBaseUnits(raw: bigint | string, decimals: number): string {
  const rawStr = raw.toString();
  if (decimals === 0) return rawStr;
  const padded = rawStr.padStart(decimals + 1, '0');
  const whole = padded.slice(0, padded.length - decimals);
  const frac = padded.slice(padded.length - decimals).replace(/0+$/, '');
  return frac.length > 0 ? `${whole}.${frac}` : whole;
}
```

### 2. `apps/backend/src/services/chains/solana/solana-chain.module.ts`
Export `JupiterClient` and `SolanaTransactionAssembler` so the new `OrderService` (in ApiModule) can inject them.

```typescript
exports: [SolanaBuilder, SolanaAnalyzer, JupiterClient, SolanaTransactionAssembler],
```

### 3. `apps/backend/src/api/api.module.ts`
Register the new `OrderController` and `OrderService`.

## Files to create

### 4. `apps/backend/src/api/service/order.service.ts`

Core logic. Injects `JupiterClient`, `SolanaTransactionAssembler`, `SolanaService`.

**Flow (optimized — most evaluations result in "not met"):**
1. Validate intent is a swap on Solana
2. Resolve tokens using `createTokenRegistry()` from `@silkysquad/silk` (same pattern as `JupiterBuilder.resolveTokenRef`)
3. Convert `amountIn` to base units, resolve token decimals
4. **Call `jupiterClient.getQuote()`** — single API call
5. Convert `outAmount` from base units to human-readable using `fromBaseUnits()`
6. **Check constraint** using `evaluateConstraint()` from `@silkysquad/silk`
7. If NOT met → return `{ executable: false, reason: "PRICE_OUT_OF_RANGE", detail: "..." }` immediately
8. If MET → call `jupiterClient.getSwapInstructions()` + `assembler.assemble()` → return `{ executable: true, transaction, quote }`

**Slippage conversion:** Request sends percentage (0.1 = 0.1%). Convert to bps: `Math.round(pct * 100)` → 10 bps.

**Price calculation:** `price = amountIn / amountOut` (price of output token in input token terms). E.g., 500 USDC / 5.889 SOL = 84.90 USDC/SOL.

**Error → reason code mapping:**

| Error | Reason code |
|---|---|
| `evaluateConstraint()` returns false | `PRICE_OUT_OF_RANGE` |
| Jupiter HTTP error (no route) | `INSUFFICIENT_LIQUIDITY` |
| Token symbol not found in registry | `UNSUPPORTED_PAIR` |
| TX simulation fails (insufficient balance) | `BALANCE_INSUFFICIENT` (caught from `assembler.assemble()` simulation error) |

### 5. `apps/backend/src/api/controller/order.controller.ts`

Thin controller. Validates request body, delegates to `OrderService.evaluate()`, wraps result in `{ ok: true, data }`. Follows exact same pattern as `IntentController`.

**Request:**
```json
{
  "intent": { "chain": "solana", "action": "swap", "from": "...", "tokenIn": {...}, "tokenOut": {...}, "amountIn": "500", "amountOut": { "gte": "5.882" } },
  "slippage": 0.1,
  "wallet": "BrKz..."
}
```

**Fillable response:**
```json
{ "ok": true, "data": { "executable": true, "transaction": "base64...", "quote": { "price": "84.90", "amountIn": "500", "amountOut": "5.889" } } }
```

**Not fillable response:**
```json
{ "ok": true, "data": { "executable": false, "reason": "PRICE_OUT_OF_RANGE", "detail": "SOL/USDC at 120.50, need ≤ 85.00" } }
```

## Key design decisions

- **Two-phase execution**: Quote first (1 API call), then build tx only if price is met (1 more API call). Optimizes for the common case where price isn't met.
- **Token resolution duplicated from JupiterBuilder**: Same logic (~30 lines), returns `null` instead of throwing for `UNSUPPORTED_PAIR`. Not worth extracting a shared utility for this small amount of code.
- **`evaluateConstraint` from SDK**: Handles all constraint types (`gte`, `lte`, `gt`, `lt`, exact match) with decimal precision. Already battle-tested in the SDK.
- **Response shape matches SDK's `ServerEvaluateResponse`**: `{ executable, transaction?, quote?, reason?, detail? }` inside the `data` wrapper.

## Verification

1. Build: `cd apps/backend && npx nest build` — should compile without errors
2. Manual test (requires mainnet RPC + Jupiter API): POST to `/api/orders/evaluate` with a swap intent
3. Check that an out-of-range price returns `{ executable: false, reason: "PRICE_OUT_OF_RANGE" }`
4. Check that a fillable price returns `{ executable: true, transaction: "base64..." }`
