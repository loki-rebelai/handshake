# Intent Engine — Build and Analyze Transactions from Intents

**Date:** 2026-03-04
**Status:** Design

---

## Overview

The intent engine adds two capabilities to the SilkyWay backend: building unsigned transactions from intents, and analyzing transactions against intents with multi-dimensional feedback. It sits in a new `src/services/` module alongside the existing `src/api/` layer, with a pluggable chain architecture that starts with Solana and can accommodate any blockchain.

The SDK (`@silkysquad/silk`) also gains the `program`/`programName` fields on the Intent type, mirroring the existing `token`/`tokenSymbol` convention, and the verification matcher is updated to check program identity when provided.

---

## Two Operations

### Build

Takes an intent, returns an unsigned transaction that satisfies it.

```
POST /api/intent/build
```

Request:
```typescript
{
  intent: Intent;
  analyze?: boolean;  // default false — include analysis in response
}
```

Response:
```typescript
{
  transaction: string;       // base64 unsigned transaction
  intent: Intent;            // resolved intent (program addresses filled in, etc.)
  metadata: BuildMetadata;
  analysis?: AnalyzeResult;  // present when analyze=true
}
```

### Analyze

Takes a transaction and an intent, returns a multi-dimensional analysis of whether the transaction matches the intent, what risks it carries, and whether it will succeed.

```
POST /api/intent/analyze
```

Request:
```typescript
{
  transaction: string;  // base64 unsigned transaction
  intent: Intent;       // what the caller expected
}
```

Response:
```typescript
AnalyzeResult
```

The analyze endpoint serves two use cases: verifying transactions you built yourself (the `analyze: true` shortcut on build), and verifying transactions from third parties.

---

## Analyze Response Shape

```typescript
type Verdict = 'proceed' | 'caution' | 'reject';

interface AnalyzeResult {
  verdict: Verdict;
  match: MatchDimension;
  risk: RiskDimension;
  viability: ViabilityDimension;
  raw: TransactionAnalysis;  // full decoded tx from SDK's analyzeTransaction
}

interface MatchDimension {
  level: 'full' | 'partial' | 'none';
  discrepancies: string[];
}

interface RiskDimension {
  level: 'low' | 'medium' | 'high';
  flags: RiskFlag[];
}

interface ViabilityDimension {
  level: 'viable' | 'uncertain' | 'unviable';
  issues: string[];
}
```

### Verdict derivation

Deterministic from dimensions:

- **`reject`** — match is `none`, OR risk is `high`, OR viability is `unviable`
- **`caution`** — match is `partial`, OR risk is `medium`, OR viability is `uncertain`
- **`proceed`** — everything clean

### Extensibility

Adding a new dimension (e.g., `compliance`, `cost`) means adding a new field to `AnalyzeResult`, a new interface, and a new rule in the verdict derivation. No existing code changes.

---

## Build Response Shape

```typescript
interface BuildResult {
  transaction: string;
  intent: Intent;
  metadata: BuildMetadata;
  analysis?: AnalyzeResult;
}

interface BuildMetadata {
  chain: string;
  network: string;
  program?: string;
  programName?: string;
  estimatedFee?: string;
}
```

---

## Intent Type — Signer and Fee Payer

Every intent requires a `signer` — the wallet that will sign the transaction. An optional `feePayer` specifies who pays transaction fees (defaults to `signer` if not provided).

This distinction matters because:
- On Solana, the fee payer is a separate concept that must also sign, but may differ from the action's initiator (e.g., a relayer paying fees).
- An operator signing a Silkysig `transfer_from_account` is not the account owner.
- On EVM, a smart contract wallet's owner and signer can differ.

```typescript
type SingleIntent = {
  chain: string;
  signer: string;          // wallet that signs the transaction
  feePayer?: string;        // who pays fees (defaults to signer)
  strict?: boolean;
} & ActionIntent & ProgramRef;

type CompoundIntent = {
  chain: string;
  signer: string;
  feePayer?: string;
  strict?: boolean;
  actions: ActionIntent[];
} & ProgramRef;
```

---

## Swap Action

Swap is a new action type alongside transfer. The SDK already defines `SwapIntent` with `TokenRef` objects for input and output sides:

```typescript
// Already exists in @silkysquad/silk src/intent/types.ts
type SwapIntent = {
  action: 'swap';
  from: string;                          // swapper address
  tokenIn: TokenRef;                     // { token?: string, tokenSymbol?: string }
  tokenOut: TokenRef;                    // { token?: string, tokenSymbol?: string }
  amountIn?: Constraint<string>;         // input amount (human-readable)
  amountOut?: Constraint<string>;        // expected output amount
  slippage?: number;                     // slippage tolerance as decimal (default: 0.001 = 10 bps)
};
```

Each `TokenRef` supports `token` (mint address), `tokenSymbol`, or both with cross-check. `slippage` defaults to 0.001 (10 bps). For build, `amountIn` must be an exact value (not a constraint range).

### Action semantics with programs

- `action: 'swap'` with `programName: 'jupiter'` — Jupiter swap (default for swaps on Solana)
- `action: 'transfer'` with no program — chain-native SPL/SOL transfer
- `action: 'transfer'` with `programName: 'handshake'` — Handshake `create_transfer`

The `action` describes what, the `program` describes which protocol.

---

## Program Identification

Mirrors the `token`/`tokenSymbol` convention:

- **`program`** — direct program address (e.g., `'HANDu9uNdnraNbcueGfXhd3UPu6BXfQroKAsSxFhPXEQ'`)
- **`programName`** — human-readable name resolved via registry (e.g., `'handshake'`)

Either, both, or neither can be provided:

```typescript
// By name (resolved via registry)
{ programName: 'handshake' }

// By address
{ program: 'HANDu9uN...' }

// Both (cross-checked)
{ programName: 'handshake', program: 'HANDu9uN...' }

// Neither — chain-native operation
{}
```

The registry is chain-and-network-scoped and bidirectional: resolve name to address for building, resolve address to name for analysis. Cross-checking works the same way as tokens — if both are provided and don't match, it's an error.

---

## Backend Module Structure

```
src/services/
├── services.module.ts
├── intent/
│   ├── intent.module.ts
│   ├── intent-build.service.ts      — orchestrator: resolves chain, dispatches
│   ├── intent-analyze.service.ts    — orchestrator: resolves chain, dispatches
│   ├── intent-registry.service.ts   — bidirectional program/token registry
│   └── types.ts                     — AnalyzeResult, BuildResult, dimension types
│
└── chains/
    ├── chain.interface.ts           — ChainBuilder + ChainAnalyzer interfaces
    └── solana/
        ├── solana.module.ts
        ├── solana.builder.ts        — dispatches to program builders, uses assembler
        ├── solana.analyzer.ts       — wraps SDK analyzeTransaction + risk/viability
        ├── solana-tx-assembler.ts   — versioned tx assembly, simulation, CU, priority fees
        ├── jupiter-client.ts        — Jupiter API wrapper (quote, swap-instructions)
        ├── program-builder.interface.ts
        ├── program-registry.ts
        └── programs/
            ├── native.builder.ts    — SPL transfers, system program
            ├── handshake.builder.ts — Handshake create_transfer, claim, cancel
            └── jupiter.builder.ts   — Jupiter swap via JupiterClient
```

### Chain interfaces

```typescript
interface ChainBuilder {
  chain: string;
  build(intent: Intent, opts: BuildOpts): Promise<BuildResult>;
}

interface ChainAnalyzer {
  chain: string;
  analyze(tx: string, intent: Intent, opts: AnalyzeOpts): Promise<AnalyzeResult>;
}
```

The orchestrator services hold a `Map<string, ChainBuilder>` and `Map<string, ChainAnalyzer>`. Dispatch is by `intent.chain`. Adding a new chain means a new subdirectory under `chains/` and registering in the module.

### Program builder interface

```typescript
interface ProgramBuildResult {
  instructions: TransactionInstruction[];
  addressLookupTableAddresses?: string[];
  metadata?: Record<string, unknown>;  // builder-specific (quote data, price impact, etc.)
}

interface ProgramBuilder {
  programName: string;
  supportedActions: string[];
  build(intent: ActionIntent, context: SolanaBuildContext): Promise<ProgramBuildResult>;
}
```

Each program builder returns instructions and optional address lookup table addresses. The chain-level `solana.builder.ts` hands the result to `SolanaTransactionAssembler` for versioned tx creation, simulation, and CU injection.

### Solana Transaction Assembler

`SolanaTransactionAssembler` is a dedicated service that converts raw instructions into a ready-to-sign versioned transaction:

1. Resolves address lookup table accounts from RPC (if provided)
2. Builds a V0 `VersionedTransaction` with the fee payer and latest blockhash
3. Simulates the transaction using the signer to determine actual compute units consumed
4. Rebuilds the transaction with:
   - `SetComputeUnitLimit` = simulated CU + buffer
   - `SetComputeUnitPrice` = priority fee (from network recent fees or config)
5. Deduplicates any existing compute budget instructions (prevents double-setting)
6. Returns serialized base64 transaction + metadata (estimated fee, CU used)

This is the single place that handles versioned tx creation, ensuring consistent behavior across all program builders.

### Solana build flow

1. `intent-build.service.ts` receives intent, parses chain, dispatches to `solana.builder.ts`
2. `solana.builder.ts` checks for `program`/`programName` — if present, resolves via registry and dispatches to matching program builder. If absent, dispatches to `native.builder.ts`
3. Program builder (e.g., `jupiter.builder.ts`) builds instructions, returns `ProgramBuildResult` with instructions + lookup table addresses
4. `solana.builder.ts` passes the result to `SolanaTransactionAssembler` which handles versioned tx creation, simulation, CU injection, and serialization
5. If `analyze: true`, runs the analyze pipeline on the built transaction before returning

### Jupiter build flow (within jupiter.builder.ts)

1. Resolves input/output tokens via registry
2. Calls `JupiterClient.getQuote()` with input mint, output mint, amount, slippageBps (default 10)
3. Calls `JupiterClient.getSwapInstructions()` with quote and signer
4. Returns `ProgramBuildResult` with setup + swap + cleanup instructions, address lookup table addresses, and quote metadata (price impact, output amount, route info)

### Jupiter Client

Thin wrapper over Jupiter's public API:

```typescript
class JupiterClient {
  // GET /swap/v1/quote
  getQuote(params: {
    inputMint: string;
    outputMint: string;
    amount: string;
    slippageBps: number;
  }): Promise<JupiterQuoteResponse>;

  // POST /swap/v1/swap-instructions
  getSwapInstructions(params: {
    quote: JupiterQuoteResponse;
    signer: string;
  }): Promise<JupiterSwapInstructionsResult>;
}
```

The client strips Jupiter's compute budget instructions from the response — the `SolanaTransactionAssembler` handles CU independently via simulation.

Shared between the builder (for creating swaps) and the analyzer (for fetching reference quotes to compare against).

### Solana analyze flow

1. `intent-analyze.service.ts` receives transaction + intent, dispatches to `solana.analyzer.ts`
2. `solana.analyzer.ts` calls the SDK's `analyzeTransaction` to get full decoded transaction
3. Runs match checking: uses the SDK's matcher (which now checks program identity too)
4. Runs risk assessment: extends the SDK's flag engine with backend-specific risk rules
5. Runs viability checks: RPC-based balance checks, token account existence, blockhash freshness
6. Derives verdict from dimensions, returns `AnalyzeResult`

### Swap-specific analysis

**Match dimension for swaps:**
- Transaction interacts with Jupiter program ID
- Input token and amount match the intent
- Output token matches the intent
- Minimum output amount respects slippage tolerance

If all match → `full`. If Jupiter program matches but token/amount has discrepancies → `partial`. If not a Jupiter swap at all → `none`.

**Risk dimension for swaps:**
- Fetches a fresh Jupiter quote for the same swap parameters
- Price impact from quote: above 1% → `medium`, above 5% → `high`
- Compares transaction amounts against current market quote to catch stale transactions
- Existing SDK flags still apply (unknown program, unexpected SOL drain, etc.)

**Viability dimension for swaps:**
- Sender has sufficient input token balance
- Fee payer has enough SOL for transaction fees
- Blockhash freshness check

---

## Viability Checks (first iteration)

Solana-specific, RPC-based:

| Check | Result on failure |
|---|---|
| Fee payer has enough SOL for estimated fees | `unviable`: "Insufficient SOL for transaction fees" |
| Sender has sufficient token balance for transfer amount | `unviable`: "Insufficient USDC balance (have 50, need 100)" |
| Destination token account exists or can be created | `uncertain`: "Destination token account does not exist (will be created)" |
| Blockhash is recent | `uncertain`: "Blockhash may be expired" |

---

## Risk Assessment (first iteration)

Reuses the SDK's existing flag engine:

| Flag | Severity | Risk level mapping |
|---|---|---|
| `UNKNOWN_PROGRAM` | error | high |
| `UNEXPECTED_SOL_DRAIN` | error | high |
| `UNEXPECTED_TOKEN_TRANSFER` | warning | medium |
| `LARGE_COMPUTE_BUDGET` | info | low |

Swap-specific additions:

| Condition | Risk level |
|---|---|
| Price impact > 5% | high |
| Price impact > 1% | medium |
| Output amount significantly below current market quote | medium |

The backend can add its own rules on top (e.g., protocol reputation, contract age, known exploit history) in future iterations.

---

## Scope — first iteration

**In scope:**
- Solana chain builder and analyzer
- Transfer action: `native.builder.ts` (SPL/SOL), `handshake.builder.ts` (create_transfer)
- Swap action: `jupiter.builder.ts` (Jupiter swaps) + swap-specific analysis
- `SolanaTransactionAssembler`: versioned transactions, simulation-based CU, priority fees
- `JupiterClient`: Jupiter API wrapper shared by builder and analyzer
- Basic viability checks (balance, token account, blockhash)
- Basic risk assessment (SDK flag engine + swap price impact)
- SDK type changes: `signer`/`feePayer` on Intent, `SwapAction` type, `ProgramRef`, bidirectional program registry, matcher program check
- Two API endpoints: `POST /api/intent/build`, `POST /api/intent/analyze`

**Out of scope (future iterations):**
- EVM chain builders
- Stake, lend, borrow builders
- Simulation-based viability (beyond CU estimation)
- Protocol-level risk scoring
- Silkysig builder (deferred to second iteration after transfer + swap work end-to-end)

---

## Relationship to existing code

| Component | Relationship |
|---|---|
| `src/api/service/tx.service.ts` | Existing Handshake-specific builder. Stays as-is. `handshake.builder.ts` in the new engine will eventually subsume its logic. |
| `@silkysquad/silk` `src/intent/` | Intent types and verification. Gets `signer`/`feePayer`, `SwapAction`, `ProgramRef` additions and matcher update. |
| `@silkysquad/silk` `src/verify/` | Solana decoder pipeline. Used by `solana.analyzer.ts` via `analyzeTransaction`. |
| Midas `src/services/jupiter/` | Pattern reference for Jupiter API integration. Adapted into `jupiter-client.ts`. Not a dependency. |
| Midas `packages/common` SolanaClient | Pattern reference for `prepareVersionedTx` — versioned tx assembly, CU simulation, priority fees. Adapted into `SolanaTransactionAssembler`. Not a dependency. |
