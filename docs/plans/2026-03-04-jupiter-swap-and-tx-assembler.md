# Jupiter Swap & Transaction Assembler Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Jupiter-based swap capability to the intent engine, and upgrade transaction assembly to versioned transactions with compute budget instructions and simulation.

**Architecture:** Widen the `ProgramBuilder` return type to `ProgramBuildResult` (instructions + address lookup tables + metadata). Extract a `SolanaTransactionAssembler` service that converts raw instructions into simulation-optimized versioned transactions. Add a `JupiterClient` API wrapper and `JupiterBuilder` program builder. Update the analyzer for swap-specific match/risk/viability checks.

**Tech Stack:** NestJS, @solana/web3.js (VersionedTransaction, ComputeBudgetProgram), @nestjs/axios (Jupiter API), @silkysquad/silk (SwapIntent, TokenRef types)

**Design doc:** `docs/design/intent-engine.md`

**SDK types reference:** The `@silkysquad/silk` SDK at `/Users/si/projects/maxi/silk/src/intent/types.ts` already defines `SwapIntent` with `tokenIn: TokenRef`, `tokenOut: TokenRef`, `amountIn`, `amountOut`, `slippage`. The backend must work with these existing types. SDK type additions (`signer`/`feePayer` on Intent) are tracked separately and not part of this plan — the backend will extract signer from the intent's `from` field or `BuildOpts` until the SDK is updated.

**Midas reference code:**
- Jupiter API patterns: `/Users/si/projects/maxi/midas/apps/backend/src/services/jupiter/jupiter.service.ts`
- Versioned TX assembly: `/Users/si/projects/maxi/midas/packages/common/src/solana/solanaclient.ts` (prepareVersionedTx, simulateTx)

---

## Task 1: Widen ProgramBuilder return type to ProgramBuildResult

**Files:**
- Modify: `apps/backend/src/services/chains/solana/program-builder.interface.ts`

**Step 1: Update the interface file**

Replace the entire contents of `program-builder.interface.ts` with:

```typescript
import type { ActionIntent } from '@silkysquad/silk';
import type { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';

export interface SolanaBuildContext {
  connection: Connection;
  feePayer: PublicKey;
  signer: PublicKey;
  chain: string;
  network: string;
}

export interface ProgramBuildResult {
  instructions: TransactionInstruction[];
  addressLookupTableAddresses?: string[];
  metadata?: Record<string, unknown>;
}

export interface ProgramBuilder {
  readonly programName: string;
  readonly supportedActions: string[];
  build(action: ActionIntent, context: SolanaBuildContext): Promise<ProgramBuildResult>;
}
```

Changes from before:
- Added `signer` to `SolanaBuildContext` (separate from `feePayer`)
- New `ProgramBuildResult` type replaces raw `TransactionInstruction[]` return
- `ProgramBuilder.build()` now returns `Promise<ProgramBuildResult>`

**Step 2: Update NativeBuilder to return ProgramBuildResult**

Modify: `apps/backend/src/services/chains/solana/programs/native.builder.ts`

The `build()` method currently returns `TransactionInstruction[]`. Wrap the return value:

Find where instructions are returned (the `return` statements at end of `build()`) and change them to return `{ instructions: [...] }` instead of bare arrays.

For example, the SOL transfer return:
```typescript
// Before:
return [SystemProgram.transfer({ ... })];

// After:
return { instructions: [SystemProgram.transfer({ ... })] };
```

And the SPL token transfer return:
```typescript
// Before:
return instructions;

// After:
return { instructions };
```

**Step 3: Update HandshakeBuilder to return ProgramBuildResult**

Modify: `apps/backend/src/services/chains/solana/programs/handshake.builder.ts`

Same pattern — wrap the return:
```typescript
// Before:
return [instruction];

// After:
return { instructions: [instruction] };
```

**Step 4: Update SolanaBuilder to consume ProgramBuildResult**

Modify: `apps/backend/src/services/chains/solana/solana.builder.ts`

In the `build()` method, change:
```typescript
// Before:
const instructions = await builder.build(action, context);
// ...
for (const ix of instructions) {
  tx.add(ix);
}

// After:
const result = await builder.build(action, context);
// ...
for (const ix of result.instructions) {
  tx.add(ix);
}
```

**Step 5: Fix tests**

Modify: `apps/backend/src/services/chains/solana/programs/native.builder.spec.ts`

Update the assertion from checking `instructions` array to checking `result.instructions`:
```typescript
// Before:
const instructions = await builder.build(...);
expect(instructions).toHaveLength(1);
expect(instructions[0].programId...).toBe(...);

// After:
const result = await builder.build(...);
expect(result.instructions).toHaveLength(1);
expect(result.instructions[0].programId...).toBe(...);
```

Modify: `apps/backend/src/services/chains/solana/solana.builder.spec.ts`

Update mock builders to return `ProgramBuildResult`:
```typescript
// Before:
const nativeBuild = jest.fn().mockResolvedValue([
  new TransactionInstruction({ ... }),
]);

// After:
const nativeBuild = jest.fn().mockResolvedValue({
  instructions: [new TransactionInstruction({ ... })],
});
```

**Step 6: Run tests**

Run: `cd apps/backend && npx jest --testPathPattern='native.builder|solana.builder' --no-coverage`
Expected: All tests pass

**Step 7: Commit**

```
git add apps/backend/src/services/chains/solana/program-builder.interface.ts \
  apps/backend/src/services/chains/solana/programs/native.builder.ts \
  apps/backend/src/services/chains/solana/programs/handshake.builder.ts \
  apps/backend/src/services/chains/solana/solana.builder.ts \
  apps/backend/src/services/chains/solana/programs/native.builder.spec.ts \
  apps/backend/src/services/chains/solana/solana.builder.spec.ts
git commit -m "refactor: widen ProgramBuilder return type to ProgramBuildResult"
```

---

## Task 2: Create SolanaTransactionAssembler

**Files:**
- Create: `apps/backend/src/services/chains/solana/solana-tx-assembler.ts`
- Create: `apps/backend/src/services/chains/solana/solana-tx-assembler.spec.ts`

**Step 1: Write the test file**

```typescript
import { Keypair, TransactionInstruction, SystemProgram, PublicKey } from '@solana/web3.js';
import { SolanaTransactionAssembler } from './solana-tx-assembler';

describe('SolanaTransactionAssembler', () => {
  const makeAssembler = (connectionOverrides: Record<string, jest.Mock> = {}) => {
    const connection = {
      getLatestBlockhashAndContext: jest.fn().mockResolvedValue({
        context: { slot: 100 },
        value: {
          blockhash: '11111111111111111111111111111111',
          lastValidBlockHeight: 200,
        },
      }),
      getAddressLookupTable: jest.fn().mockResolvedValue({
        value: null,
      }),
      simulateTransaction: jest.fn().mockResolvedValue({
        value: {
          err: null,
          unitsConsumed: 50000,
          logs: [],
        },
      }),
      ...connectionOverrides,
    } as any;

    return { assembler: new SolanaTransactionAssembler(), connection };
  };

  it('assembles a versioned transaction from instructions', async () => {
    const { assembler, connection } = makeAssembler();
    const feePayer = Keypair.generate().publicKey;
    const ix = SystemProgram.transfer({
      fromPubkey: feePayer,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1000,
    });

    const result = await assembler.assemble({
      instructions: [ix],
      feePayer,
      signer: feePayer,
      connection,
    });

    expect(result.transaction).toBeDefined();
    expect(typeof result.transaction).toBe('string');
    // base64 encoded
    expect(() => Buffer.from(result.transaction, 'base64')).not.toThrow();
    expect(result.computeUnits).toBeGreaterThan(0);
  });

  it('includes compute budget instructions after simulation', async () => {
    const { assembler, connection } = makeAssembler({
      simulateTransaction: jest.fn().mockResolvedValue({
        value: { err: null, unitsConsumed: 75000, logs: [] },
      }),
    });
    const feePayer = Keypair.generate().publicKey;
    const ix = SystemProgram.transfer({
      fromPubkey: feePayer,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1000,
    });

    const result = await assembler.assemble({
      instructions: [ix],
      feePayer,
      signer: feePayer,
      connection,
    });

    // CU should be simulated (75000) + buffer
    expect(result.computeUnits).toBeGreaterThanOrEqual(75000);
  });

  it('throws on simulation failure', async () => {
    const { assembler, connection } = makeAssembler({
      simulateTransaction: jest.fn().mockResolvedValue({
        value: {
          err: { InstructionError: [0, 'InvalidAccountData'] },
          unitsConsumed: 0,
          logs: ['Program failed'],
        },
      }),
    });
    const feePayer = Keypair.generate().publicKey;
    const ix = SystemProgram.transfer({
      fromPubkey: feePayer,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1000,
    });

    await expect(
      assembler.assemble({
        instructions: [ix],
        feePayer,
        signer: feePayer,
        connection,
      }),
    ).rejects.toThrow('simulation');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx jest --testPathPattern='solana-tx-assembler' --no-coverage`
Expected: FAIL — module not found

**Step 3: Write the assembler**

Create `apps/backend/src/services/chains/solana/solana-tx-assembler.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from '@solana/web3.js';

export interface AssembleParams {
  instructions: TransactionInstruction[];
  feePayer: PublicKey;
  signer: PublicKey;
  connection: Connection;
  addressLookupTableAddresses?: string[];
  /** Skip simulation and use this CU value directly */
  computeUnits?: number;
  /** Priority fee in microLamports. If omitted, fetched from network. */
  priorityFee?: number;
}

export interface AssembleResult {
  transaction: string; // base64 serialized VersionedTransaction
  computeUnits: number;
  priorityFee: number;
}

const DEFAULT_CU_BUFFER = 60_000;
const DEFAULT_CU_FALLBACK = 200_000;
const DEFAULT_PRIORITY_FEE = 1000; // microLamports

@Injectable()
export class SolanaTransactionAssembler {
  private readonly logger = new Logger(SolanaTransactionAssembler.name);

  async assemble(params: AssembleParams): Promise<AssembleResult> {
    const {
      instructions,
      feePayer,
      signer,
      connection,
      addressLookupTableAddresses,
      priorityFee: explicitPriorityFee,
    } = params;

    const lookupTableAccounts = await this.resolveAddressLookupTables(
      connection,
      addressLookupTableAddresses,
    );

    const priorityFee = explicitPriorityFee ?? await this.getPriorityFee(connection);

    // First pass: build tx without CU limit for simulation
    const firstPassIxs = this.buildInstructionList(instructions, priorityFee);
    const firstPassTx = await this.buildVersionedTx(
      connection,
      feePayer,
      firstPassIxs,
      lookupTableAccounts,
    );

    // Simulate to get actual CU consumed
    let computeUnits: number;
    if (params.computeUnits) {
      computeUnits = params.computeUnits;
    } else {
      const simResult = await this.simulate(connection, firstPassTx);
      computeUnits = (simResult.unitsConsumed ?? DEFAULT_CU_FALLBACK) + DEFAULT_CU_BUFFER;
    }

    // Second pass: rebuild with CU limit
    const finalIxs = this.buildInstructionList(instructions, priorityFee, computeUnits);
    const finalTx = await this.buildVersionedTx(
      connection,
      feePayer,
      finalIxs,
      lookupTableAccounts,
    );

    const serialized = Buffer.from(finalTx.serialize()).toString('base64');

    return {
      transaction: serialized,
      computeUnits,
      priorityFee,
    };
  }

  private buildInstructionList(
    instructions: TransactionInstruction[],
    priorityFee: number,
    computeUnits?: number,
  ): TransactionInstruction[] {
    const result: TransactionInstruction[] = [];

    if (priorityFee > 0) {
      result.push(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee }),
      );
    }

    if (computeUnits) {
      result.push(
        ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
      );
    }

    // Filter out any existing compute budget instructions from the input
    for (const ix of instructions) {
      if (ix.programId.equals(ComputeBudgetProgram.programId)) {
        continue;
      }
      result.push(ix);
    }

    return result;
  }

  private async buildVersionedTx(
    connection: Connection,
    feePayer: PublicKey,
    instructions: TransactionInstruction[],
    lookupTableAccounts: AddressLookupTableAccount[],
  ): Promise<VersionedTransaction> {
    const blockhashAndCtx = await connection.getLatestBlockhashAndContext('confirmed');
    const messageV0 = new TransactionMessage({
      payerKey: feePayer,
      recentBlockhash: blockhashAndCtx.value.blockhash,
      instructions,
    }).compileToV0Message(lookupTableAccounts);

    return new VersionedTransaction(messageV0);
  }

  private async simulate(
    connection: Connection,
    tx: VersionedTransaction,
  ) {
    const simResponse = await connection.simulateTransaction(tx, {
      commitment: 'confirmed',
      replaceRecentBlockhash: true,
      sigVerify: false,
    });

    if (simResponse.value.err) {
      const logs = simResponse.value.logs?.join('\n') ?? '';
      throw new Error(`Transaction simulation failed: ${logs}`);
    }

    return simResponse.value;
  }

  private async getPriorityFee(connection: Connection): Promise<number> {
    try {
      const fees = await connection.getRecentPrioritizationFees();
      if (fees.length > 0) {
        const avg = fees.reduce((sum, f) => sum + f.prioritizationFee, 0) / fees.length;
        const bumped = Math.ceil(avg * 1.2);
        if (bumped > DEFAULT_PRIORITY_FEE) {
          return bumped;
        }
      }
    } catch {
      // Fall through to default
    }
    return DEFAULT_PRIORITY_FEE;
  }

  private async resolveAddressLookupTables(
    connection: Connection,
    addresses?: string[],
  ): Promise<AddressLookupTableAccount[]> {
    if (!addresses || addresses.length === 0) {
      return [];
    }

    const accounts: AddressLookupTableAccount[] = [];
    for (const addr of addresses) {
      const result = await connection.getAddressLookupTable(new PublicKey(addr));
      if (result.value) {
        accounts.push(result.value);
      }
    }
    return accounts;
  }
}
```

**Step 4: Run tests**

Run: `cd apps/backend && npx jest --testPathPattern='solana-tx-assembler' --no-coverage`
Expected: All pass

**Step 5: Commit**

```
git add apps/backend/src/services/chains/solana/solana-tx-assembler.ts \
  apps/backend/src/services/chains/solana/solana-tx-assembler.spec.ts
git commit -m "feat: add SolanaTransactionAssembler for versioned tx with CU simulation"
```

---

## Task 3: Update SolanaBuilder to use the assembler

**Files:**
- Modify: `apps/backend/src/services/chains/solana/solana.builder.ts`
- Modify: `apps/backend/src/services/chains/solana/solana.builder.spec.ts`
- Modify: `apps/backend/src/services/chains/solana/solana-chain.module.ts`

**Step 1: Update the module to provide the assembler**

In `solana-chain.module.ts`, add `SolanaTransactionAssembler` to providers:

```typescript
import { SolanaTransactionAssembler } from './solana-tx-assembler';
// ... existing imports

@Module({
  imports: [SolanaModule],
  providers: [NativeBuilder, HandshakeBuilder, SolanaBuilder, SolanaAnalyzer, SolanaTransactionAssembler],
  exports: [SolanaBuilder, SolanaAnalyzer],
})
export class SolanaChainModule {}
```

**Step 2: Rewrite SolanaBuilder.build() to use the assembler**

The key changes in `solana.builder.ts`:

1. Inject `SolanaTransactionAssembler` in constructor
2. Remove the legacy Transaction assembly code
3. Use `assembler.assemble()` with the `ProgramBuildResult`

Replace the transaction assembly section (from `const { blockhash }` through `serialize`) with:

```typescript
const assembleResult = await this.assembler.assemble({
  instructions: result.instructions,
  feePayer,
  signer: feePayer, // signer = feePayer for now; updated when SDK adds signer field
  connection: context.connection,
  addressLookupTableAddresses: result.addressLookupTableAddresses,
});
```

And use `assembleResult.transaction` instead of the manual serialization.

Also add `estimatedFee` to metadata from `assembleResult.priorityFee`.

Full updated `build()` method:

```typescript
async build(intent: Intent, opts?: BuildOpts): Promise<BuildResult> {
  const { chain, network } = parseChain(intent.chain);
  if (chain !== 'solana') {
    throw new Error(`SolanaBuilder only handles solana intents, got '${chain}'`);
  }

  if (!('action' in intent)) {
    throw new Error('Compound intents are not supported by build v1; provide a single intent action.');
  }

  const action = this.extractAction(intent);
  const feePayer = new PublicKey(opts?.feePayer || this.getFeePayer(action));

  const programRef = this.extractProgramRef(intent as IntentWithProgram);
  const builderName = this.resolveBuilderName(programRef, chain, network);
  const builder = this.builders.get(builderName);
  if (!builder) {
    throw new Error(`No Solana builder registered for program '${builderName}'`);
  }

  const context: SolanaBuildContext = {
    connection: this.solanaService.getConnection(),
    feePayer,
    signer: feePayer,
    chain,
    network,
  };

  const result = await builder.build(action, context);

  const assembleResult = await this.assembler.assemble({
    instructions: result.instructions,
    feePayer,
    signer: feePayer,
    connection: context.connection,
    addressLookupTableAddresses: result.addressLookupTableAddresses,
  });

  const metadataProgram = this.resolveMetadataProgram(programRef, builderName, action, chain, network);

  return {
    transaction: assembleResult.transaction,
    intent,
    metadata: {
      chain,
      network,
      programName: programRef.programName || builderName,
      program: metadataProgram,
      estimatedFee: `${assembleResult.priorityFee} microLamports`,
    },
  };
}
```

Update imports: add `SolanaTransactionAssembler` and `SolanaBuildContext` import for the new `signer` field. Remove `Transaction` import from `@solana/web3.js` since it's no longer used in this file.

Update constructor:
```typescript
constructor(
  private readonly solanaService: SolanaService,
  private readonly nativeBuilder: NativeBuilder,
  private readonly handshakeBuilder: HandshakeBuilder,
  private readonly assembler: SolanaTransactionAssembler,
) {
  this.builders.set('native', nativeBuilder);
  this.builders.set('handshake', handshakeBuilder);
}
```

**Step 3: Update tests**

In `solana.builder.spec.ts`, update:
- Add assembler mock to constructor calls
- Mock assembler.assemble() to return a result

```typescript
const mockAssembler = {
  assemble: jest.fn().mockResolvedValue({
    transaction: 'base64encodedtx',
    computeUnits: 100000,
    priorityFee: 1000,
  }),
};

// In constructor:
const builder = new SolanaBuilder(
  { getConnection: jest.fn().mockReturnValue({}) } as any,
  { programName: 'native', supportedActions: ['transfer'], build: nativeBuild } as any,
  { programName: 'handshake', supportedActions: ['transfer'], build: jest.fn() } as any,
  mockAssembler as any,
);
```

Remove the `getLatestBlockhash` mock since the assembler handles that now.

Update the assertion for `result.transaction` — it will be `'base64encodedtx'` from the mock.

**Step 4: Run tests**

Run: `cd apps/backend && npx jest --testPathPattern='solana.builder' --no-coverage`
Expected: All pass

**Step 5: Commit**

```
git add apps/backend/src/services/chains/solana/solana.builder.ts \
  apps/backend/src/services/chains/solana/solana.builder.spec.ts \
  apps/backend/src/services/chains/solana/solana-chain.module.ts
git commit -m "refactor: SolanaBuilder uses SolanaTransactionAssembler for versioned tx"
```

---

## Task 4: Create Jupiter types and JupiterClient

**Files:**
- Create: `apps/backend/src/services/chains/solana/jupiter-client.ts`
- Create: `apps/backend/src/services/chains/solana/jupiter-client.spec.ts`

**Step 1: Write the test file**

```typescript
import { JupiterClient } from './jupiter-client';

describe('JupiterClient', () => {
  const mockHttpService = {
    get: jest.fn(),
    post: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn().mockReturnValue('test-api-key'),
  };

  const makeClient = () =>
    new JupiterClient(mockHttpService as any, mockConfigService as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getQuote', () => {
    it('calls Jupiter quote API with correct params', async () => {
      const quoteResponse = {
        inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        outputMint: 'So11111111111111111111111111111111111111112',
        inAmount: '1000000',
        outAmount: '50000000',
        otherAmountThreshold: '49500000',
        swapMode: 'ExactIn',
        slippageBps: 10,
        priceImpactPct: '0.01',
        routePlan: [],
        contextSlot: 100,
        timeTaken: 0.5,
      };

      const { of } = await import('rxjs');
      mockHttpService.get.mockReturnValue(of({ data: quoteResponse }));

      const client = makeClient();
      const result = await client.getQuote({
        inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        outputMint: 'So11111111111111111111111111111111111111112',
        amount: '1000000',
        slippageBps: 10,
      });

      expect(result.inputMint).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      expect(result.outAmount).toBe('50000000');
      expect(mockHttpService.get).toHaveBeenCalledWith(
        expect.stringContaining('/quote'),
        expect.objectContaining({
          params: expect.objectContaining({
            inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            outputMint: 'So11111111111111111111111111111111111111112',
            amount: '1000000',
            slippageBps: 10,
          }),
        }),
      );
    });
  });

  describe('getSwapInstructions', () => {
    it('calls Jupiter swap-instructions API and converts response', async () => {
      const swapResponse = {
        computeBudgetInstructions: [],
        setupInstructions: [],
        swapInstruction: {
          programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
          accounts: [
            { pubkey: 'abc123', isSigner: false, isWritable: true },
          ],
          data: Buffer.from('test').toString('base64'),
        },
        addressLookupTableAddresses: ['LUT111'],
        cleanupInstruction: null,
        otherInstructions: [],
      };

      const { of } = await import('rxjs');
      mockHttpService.post.mockReturnValue(of({ data: swapResponse }));

      const client = makeClient();
      const result = await client.getSwapInstructions({
        quote: { outAmount: '50000000' } as any,
        signer: 'signerPubkey123',
      });

      expect(result.instructions.length).toBeGreaterThanOrEqual(1);
      expect(result.addressLookupTableAddresses).toEqual(['LUT111']);
      expect(result.outAmount).toBe('50000000');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx jest --testPathPattern='jupiter-client' --no-coverage`
Expected: FAIL — module not found

**Step 3: Write the JupiterClient**

Create `apps/backend/src/services/chains/solana/jupiter-client.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { firstValueFrom } from 'rxjs';

// ─── Jupiter API types ──────────────────────────────────────

export interface JupiterSwapInfo {
  ammKey: string;
  label: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  feeAmount: string;
  feeMint: string;
}

export interface JupiterRoutePlanItem {
  swapInfo: JupiterSwapInfo;
  percent: number;
  bps: number;
}

export interface JupiterQuoteResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: 'ExactIn' | 'ExactOut';
  slippageBps: number;
  priceImpactPct: string;
  routePlan: JupiterRoutePlanItem[];
  contextSlot: number;
  timeTaken: number;
}

interface JupiterInstructionAccount {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
}

interface JupiterInstruction {
  programId: string;
  accounts: JupiterInstructionAccount[];
  data: string; // base64
}

interface JupiterSwapInstructionsResponse {
  otherInstructions: JupiterInstruction[];
  computeBudgetInstructions: JupiterInstruction[];
  setupInstructions: JupiterInstruction[];
  swapInstruction: JupiterInstruction;
  addressLookupTableAddresses: string[];
  cleanupInstruction: JupiterInstruction | null;
}

export interface JupiterSwapInstructionsResult {
  instructions: TransactionInstruction[];
  addressLookupTableAddresses: string[];
  outAmount: string;
}

// ─── Client ─────────────────────────────────────────────────

const JUPITER_API_URL = 'https://api.jup.ag/swap/v1';

@Injectable()
export class JupiterClient {
  private readonly logger = new Logger(JupiterClient.name);
  private readonly apiKey: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.apiKey = this.configService.get<string>('JUPITER_API_KEY', '');
  }

  async getQuote(params: {
    inputMint: string;
    outputMint: string;
    amount: string;
    slippageBps: number;
  }): Promise<JupiterQuoteResponse> {
    const response = await firstValueFrom(
      this.httpService.get<JupiterQuoteResponse>(`${JUPITER_API_URL}/quote`, {
        params: {
          inputMint: params.inputMint,
          outputMint: params.outputMint,
          amount: params.amount,
          slippageBps: params.slippageBps,
        },
        headers: this.headers(),
      }),
    );
    return response.data;
  }

  async getSwapInstructions(params: {
    quote: JupiterQuoteResponse;
    signer: string;
  }): Promise<JupiterSwapInstructionsResult> {
    const response = await firstValueFrom(
      this.httpService.post<JupiterSwapInstructionsResponse>(
        `${JUPITER_API_URL}/swap-instructions`,
        {
          quoteResponse: params.quote,
          userPublicKey: params.signer,
          wrapUnwrapSOL: true,
          prioritizationFeeLamports: 'auto',
        },
        { headers: this.headers() },
      ),
    );

    const instructions: TransactionInstruction[] = [];

    // Setup instructions
    for (const ix of response.data.setupInstructions) {
      const converted = this.convertInstruction(ix);
      if (converted) instructions.push(converted);
    }

    // Swap instruction
    const swapIx = this.convertInstruction(response.data.swapInstruction);
    if (swapIx) instructions.push(swapIx);

    // Cleanup instruction
    if (response.data.cleanupInstruction) {
      const cleanupIx = this.convertInstruction(response.data.cleanupInstruction);
      if (cleanupIx) instructions.push(cleanupIx);
    }

    // Note: computeBudgetInstructions are intentionally omitted —
    // SolanaTransactionAssembler handles CU via simulation

    return {
      instructions,
      addressLookupTableAddresses: response.data.addressLookupTableAddresses,
      outAmount: params.quote.outAmount,
    };
  }

  private convertInstruction(ix: JupiterInstruction): TransactionInstruction | null {
    try {
      return new TransactionInstruction({
        programId: new PublicKey(ix.programId),
        keys: ix.accounts.map((a) => ({
          pubkey: new PublicKey(a.pubkey),
          isSigner: a.isSigner,
          isWritable: a.isWritable,
        })),
        data: Buffer.from(ix.data, 'base64'),
      });
    } catch (err) {
      this.logger.error('Failed to convert Jupiter instruction', err);
      return null;
    }
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) h['x-api-key'] = this.apiKey;
    return h;
  }
}
```

**Step 4: Run tests**

Run: `cd apps/backend && npx jest --testPathPattern='jupiter-client' --no-coverage`
Expected: All pass

**Step 5: Commit**

```
git add apps/backend/src/services/chains/solana/jupiter-client.ts \
  apps/backend/src/services/chains/solana/jupiter-client.spec.ts
git commit -m "feat: add JupiterClient for Jupiter API quote and swap instructions"
```

---

## Task 5: Create JupiterBuilder

**Files:**
- Create: `apps/backend/src/services/chains/solana/programs/jupiter.builder.ts`
- Create: `apps/backend/src/services/chains/solana/programs/jupiter.builder.spec.ts`

**Step 1: Write the test file**

```typescript
import { Keypair } from '@solana/web3.js';
import { JupiterBuilder } from './jupiter.builder';

describe('JupiterBuilder', () => {
  it('has expected program metadata', () => {
    const builder = new JupiterBuilder({} as any);
    expect(builder.programName).toBe('jupiter');
    expect(builder.supportedActions).toEqual(['swap']);
  });

  it('rejects unsupported actions', async () => {
    const builder = new JupiterBuilder({} as any);
    await expect(
      builder.build(
        { action: 'transfer', from: 'x', to: 'y', amount: '1' } as any,
        { connection: {} as any, feePayer: Keypair.generate().publicKey, signer: Keypair.generate().publicKey, chain: 'solana', network: 'mainnet' },
      ),
    ).rejects.toThrow("not supported");
  });

  it('calls JupiterClient and returns ProgramBuildResult', async () => {
    const mockInstructions = [{ programId: 'JUP6...' }];
    const mockClient = {
      getQuote: jest.fn().mockResolvedValue({
        inputMint: 'USDC_MINT',
        outputMint: 'SOL_MINT',
        inAmount: '1000000',
        outAmount: '50000000',
        priceImpactPct: '0.01',
        routePlan: [],
      }),
      getSwapInstructions: jest.fn().mockResolvedValue({
        instructions: mockInstructions,
        addressLookupTableAddresses: ['LUT1'],
        outAmount: '50000000',
      }),
    };

    const builder = new JupiterBuilder(mockClient as any);
    const signer = Keypair.generate().publicKey;

    const result = await builder.build(
      {
        action: 'swap',
        from: signer.toBase58(),
        tokenIn: { token: 'USDC_MINT' },
        tokenOut: { token: 'SOL_MINT' },
        amountIn: '1',
      } as any,
      {
        connection: {} as any,
        feePayer: signer,
        signer,
        chain: 'solana',
        network: 'mainnet',
      },
    );

    expect(result.instructions).toBe(mockInstructions);
    expect(result.addressLookupTableAddresses).toEqual(['LUT1']);
    expect(result.metadata?.outAmount).toBe('50000000');
    expect(result.metadata?.priceImpactPct).toBe('0.01');
    expect(mockClient.getQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        inputMint: 'USDC_MINT',
        outputMint: 'SOL_MINT',
        slippageBps: 10,
      }),
    );
  });

  it('uses default slippage of 10 bps when not specified', async () => {
    const mockClient = {
      getQuote: jest.fn().mockResolvedValue({
        outAmount: '1',
        priceImpactPct: '0',
        routePlan: [],
      }),
      getSwapInstructions: jest.fn().mockResolvedValue({
        instructions: [],
        addressLookupTableAddresses: [],
        outAmount: '1',
      }),
    };

    const builder = new JupiterBuilder(mockClient as any);
    const signer = Keypair.generate().publicKey;

    await builder.build(
      {
        action: 'swap',
        from: signer.toBase58(),
        tokenIn: { token: 'A' },
        tokenOut: { token: 'B' },
        amountIn: '1',
      } as any,
      { connection: {} as any, feePayer: signer, signer, chain: 'solana', network: 'mainnet' },
    );

    expect(mockClient.getQuote).toHaveBeenCalledWith(
      expect.objectContaining({ slippageBps: 10 }),
    );
  });

  it('resolves token symbols via registry', async () => {
    const mockClient = {
      getQuote: jest.fn().mockResolvedValue({
        outAmount: '1',
        priceImpactPct: '0',
        routePlan: [],
      }),
      getSwapInstructions: jest.fn().mockResolvedValue({
        instructions: [],
        addressLookupTableAddresses: [],
        outAmount: '1',
      }),
    };

    const builder = new JupiterBuilder(mockClient as any);
    const signer = Keypair.generate().publicKey;

    await builder.build(
      {
        action: 'swap',
        from: signer.toBase58(),
        tokenIn: { tokenSymbol: 'USDC' },
        tokenOut: { tokenSymbol: 'SOL' },
        amountIn: '1',
      } as any,
      { connection: {} as any, feePayer: signer, signer, chain: 'solana', network: 'mainnet' },
    );

    // Should have resolved USDC and SOL to their mint addresses
    const quoteCall = mockClient.getQuote.mock.calls[0][0];
    expect(quoteCall.inputMint).toBeDefined();
    expect(quoteCall.outputMint).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx jest --testPathPattern='jupiter.builder' --no-coverage`
Expected: FAIL — module not found

**Step 3: Write the JupiterBuilder**

Create `apps/backend/src/services/chains/solana/programs/jupiter.builder.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { createTokenRegistry, type ActionIntent, type SwapIntent, type TokenRef } from '@silkysquad/silk';
import type { ProgramBuilder, ProgramBuildResult, SolanaBuildContext } from '../program-builder.interface';
import { JupiterClient } from '../jupiter-client';
import { requireExactAmount, toBaseUnits } from '../amount';

const DEFAULT_SLIPPAGE_BPS = 10;
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const SOL_DECIMALS = 9;

@Injectable()
export class JupiterBuilder implements ProgramBuilder {
  readonly programName = 'jupiter';
  readonly supportedActions = ['swap'];

  constructor(private readonly jupiterClient: JupiterClient) {}

  async build(action: ActionIntent, context: SolanaBuildContext): Promise<ProgramBuildResult> {
    if (action.action !== 'swap') {
      throw new Error(`JupiterBuilder: action '${action.action}' not supported. Supported: swap`);
    }

    const swap = action as SwapIntent;
    const inputMint = this.resolveTokenRef(swap.tokenIn, context.chain, context.network);
    const outputMint = this.resolveTokenRef(swap.tokenOut, context.chain, context.network);
    const slippageBps = swap.slippage != null ? Math.round(swap.slippage * 10000) : DEFAULT_SLIPPAGE_BPS;

    const exactAmount = requireExactAmount(swap.amountIn ?? swap.amountOut);

    // Convert human-readable amount to base units
    // For now, we need to know the input token decimals. Query from registry or use known defaults.
    const amountBaseUnits = await this.resolveAmountBaseUnits(
      exactAmount,
      inputMint,
      context,
    );

    const quote = await this.jupiterClient.getQuote({
      inputMint,
      outputMint,
      amount: amountBaseUnits,
      slippageBps,
    });

    const swapResult = await this.jupiterClient.getSwapInstructions({
      quote,
      signer: context.signer.toBase58(),
    });

    return {
      instructions: swapResult.instructions,
      addressLookupTableAddresses: swapResult.addressLookupTableAddresses,
      metadata: {
        outAmount: swapResult.outAmount,
        priceImpactPct: quote.priceImpactPct,
        inputMint: quote.inputMint,
        outputMint: quote.outputMint,
        inAmount: quote.inAmount,
        routePlan: quote.routePlan,
        slippageBps,
      },
    };
  }

  private resolveTokenRef(ref: TokenRef, chain: string, network: string): string {
    if (ref.token) {
      return ref.token;
    }

    if (!ref.tokenSymbol) {
      throw new Error('SwapIntent token reference must provide either token (address) or tokenSymbol');
    }

    if (ref.tokenSymbol.toUpperCase() === 'SOL') {
      return SOL_MINT;
    }

    const registry = createTokenRegistry();
    const resolved = registry.resolveSymbol(chain, network, ref.tokenSymbol.toUpperCase());
    if (!resolved) {
      throw new Error(`Could not resolve token symbol '${ref.tokenSymbol}' on ${chain}:${network}`);
    }
    return resolved.address;
  }

  private async resolveAmountBaseUnits(
    humanAmount: string,
    mint: string,
    context: SolanaBuildContext,
  ): Promise<string> {
    if (mint === SOL_MINT) {
      return toBaseUnits(humanAmount, SOL_DECIMALS).toString();
    }

    // Fetch decimals from chain for SPL tokens
    const { getMint } = await import('@solana/spl-token');
    const { PublicKey } = await import('@solana/web3.js');
    const mintInfo = await getMint(context.connection, new PublicKey(mint));
    return toBaseUnits(humanAmount, mintInfo.decimals).toString();
  }
}
```

**Step 4: Run tests**

Run: `cd apps/backend && npx jest --testPathPattern='jupiter.builder' --no-coverage`
Expected: All pass

**Step 5: Commit**

```
git add apps/backend/src/services/chains/solana/programs/jupiter.builder.ts \
  apps/backend/src/services/chains/solana/programs/jupiter.builder.spec.ts
git commit -m "feat: add JupiterBuilder for swap intents via Jupiter API"
```

---

## Task 6: Register Jupiter in SolanaBuilder and module

**Files:**
- Modify: `apps/backend/src/services/chains/solana/solana.builder.ts`
- Modify: `apps/backend/src/services/chains/solana/solana-chain.module.ts`
- Modify: `apps/backend/src/services/chains/solana/solana.builder.spec.ts`

**Step 1: Add HttpModule to the module**

The `JupiterClient` depends on `HttpService` from `@nestjs/axios`. Install the package if not already present:

Run: `cd apps/backend && npm ls @nestjs/axios 2>/dev/null || npm install @nestjs/axios`

Update `solana-chain.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SolanaModule } from '../../../solana/solana.module';
import { NativeBuilder } from './programs/native.builder';
import { HandshakeBuilder } from './programs/handshake.builder';
import { JupiterBuilder } from './programs/jupiter.builder';
import { JupiterClient } from './jupiter-client';
import { SolanaBuilder } from './solana.builder';
import { SolanaAnalyzer } from './solana.analyzer';
import { SolanaTransactionAssembler } from './solana-tx-assembler';

@Module({
  imports: [SolanaModule, HttpModule],
  providers: [
    NativeBuilder,
    HandshakeBuilder,
    JupiterBuilder,
    JupiterClient,
    SolanaBuilder,
    SolanaAnalyzer,
    SolanaTransactionAssembler,
  ],
  exports: [SolanaBuilder, SolanaAnalyzer],
})
export class SolanaChainModule {}
```

**Step 2: Register JupiterBuilder in SolanaBuilder**

In `solana.builder.ts`, add JupiterBuilder to constructor and register it:

```typescript
import { JupiterBuilder } from './programs/jupiter.builder';

// In constructor:
constructor(
  private readonly solanaService: SolanaService,
  private readonly nativeBuilder: NativeBuilder,
  private readonly handshakeBuilder: HandshakeBuilder,
  private readonly jupiterBuilder: JupiterBuilder,
  private readonly assembler: SolanaTransactionAssembler,
) {
  this.builders.set('native', nativeBuilder);
  this.builders.set('handshake', handshakeBuilder);
  this.builders.set('jupiter', jupiterBuilder);
}
```

**Step 3: Update resolveBuilderName for swap default**

In `resolveBuilderName()`, when no program is specified and the action is `swap`, default to `'jupiter'`:

Add at the end of the method, before `return 'native'`:
```typescript
// Default to jupiter for swap actions
if ('action' in intent && intent.action === 'swap') {
  return 'jupiter';
}
```

Wait — `resolveBuilderName` doesn't have the intent. It takes a `ProgramRef`. We need a different approach. The simplest is to pass the action name and check it in the fallback:

Update `resolveBuilderName` signature to accept an optional action:
```typescript
private resolveBuilderName(programRef: ProgramRef, chain: string, network: string, action?: string): string {
```

And at the end, before `return 'native'`:
```typescript
if (action === 'swap') {
  return 'jupiter';
}

return 'native';
```

Update the call site in `build()`:
```typescript
const builderName = this.resolveBuilderName(programRef, chain, network, action.action);
```

**Step 4: Update tests**

In `solana.builder.spec.ts`, add jupiter mock to constructor:

```typescript
const builder = new SolanaBuilder(
  { getConnection: jest.fn().mockReturnValue({}) } as any,
  { programName: 'native', supportedActions: ['transfer'], build: nativeBuild } as any,
  { programName: 'handshake', supportedActions: ['transfer'], build: jest.fn() } as any,
  { programName: 'jupiter', supportedActions: ['swap'], build: jest.fn() } as any,
  mockAssembler as any,
);
```

**Step 5: Run tests**

Run: `cd apps/backend && npx jest --testPathPattern='solana.builder' --no-coverage`
Expected: All pass

**Step 6: Commit**

```
git add apps/backend/src/services/chains/solana/solana.builder.ts \
  apps/backend/src/services/chains/solana/solana.builder.spec.ts \
  apps/backend/src/services/chains/solana/solana-chain.module.ts
git commit -m "feat: register JupiterBuilder in SolanaBuilder with swap default routing"
```

---

## Task 7: Add swap-specific analysis to SolanaAnalyzer

**Files:**
- Modify: `apps/backend/src/services/chains/solana/solana.analyzer.ts`
- Modify: `apps/backend/src/services/chains/solana/solana-chain.module.ts`

**Step 1: Update the module to make JupiterClient available to SolanaAnalyzer**

`JupiterClient` is already in the module providers from Task 6. `SolanaAnalyzer` just needs it injected.

**Step 2: Add JupiterClient injection and swap analysis methods**

In `solana.analyzer.ts`:

Add import:
```typescript
import { JupiterClient } from './jupiter-client';
import type { SwapIntent, TokenRef } from '@silkysquad/silk';
```

Update constructor:
```typescript
constructor(
  private readonly solanaService: SolanaService,
  private readonly jupiterClient: JupiterClient,
) {}
```

Add swap-specific methods:

```typescript
private async checkSwapMatch(
  intent: IntentWithProgram,
  raw: TransactionAnalysis,
  chain: string,
  network: string,
): Promise<{ matched: boolean; discrepancies: string[] }> {
  if (!('action' in intent) || intent.action !== 'swap') {
    return { matched: false, discrepancies: [] };
  }

  const discrepancies: string[] = [];
  const swap = intent as unknown as SwapIntent;

  // Check Jupiter program ID is present
  const jupiterProgramId = resolveProgramName(chain, network, 'jupiter')?.address;
  if (jupiterProgramId) {
    const hasJupiterIx = raw.instructions.some((ix) => ix.programId === jupiterProgramId);
    if (!hasJupiterIx) {
      return { matched: false, discrepancies: ['Transaction does not contain Jupiter program instructions'] };
    }
  }

  // Check input/output tokens are referenced in the transaction accounts
  const inputMint = this.resolveTokenRefAddress(swap.tokenIn, chain, network);
  const outputMint = this.resolveTokenRefAddress(swap.tokenOut, chain, network);

  if (inputMint) {
    const mentionsInput = raw.instructions.some((ix) =>
      ix.accounts?.some((a) => a === inputMint) || ix.params?.['mint'] === inputMint,
    );
    if (!mentionsInput) {
      discrepancies.push(`Input token ${inputMint} not found in transaction`);
    }
  }

  if (outputMint) {
    const mentionsOutput = raw.instructions.some((ix) =>
      ix.accounts?.some((a) => a === outputMint) || ix.params?.['mint'] === outputMint,
    );
    if (!mentionsOutput) {
      discrepancies.push(`Output token ${outputMint} not found in transaction`);
    }
  }

  return { matched: discrepancies.length === 0, discrepancies };
}

private async assessSwapRisk(
  intent: IntentWithProgram,
  chain: string,
  network: string,
  existingFlags: RiskFlag[],
): Promise<RiskDimension> {
  const baseRisk = this.assessRisk(existingFlags);

  if (!('action' in intent) || intent.action !== 'swap') {
    return baseRisk;
  }

  const swap = intent as unknown as SwapIntent;
  const flags = [...existingFlags];

  // Fetch a fresh quote to check price impact
  try {
    const inputMint = this.resolveTokenRefAddress(swap.tokenIn, chain, network);
    const outputMint = this.resolveTokenRefAddress(swap.tokenOut, chain, network);

    if (inputMint && outputMint && swap.amountIn) {
      const exactAmount = (() => {
        try { return requireExactAmount(swap.amountIn!); } catch { return null; }
      })();

      if (exactAmount) {
        const quote = await this.jupiterClient.getQuote({
          inputMint,
          outputMint,
          amount: exactAmount, // Note: this should be in base units in production
          slippageBps: swap.slippage != null ? Math.round(swap.slippage * 10000) : 10,
        });

        const priceImpact = parseFloat(quote.priceImpactPct);
        if (priceImpact > 5) {
          flags.push({ code: 'HIGH_PRICE_IMPACT', severity: 'error', message: `Price impact ${priceImpact}% exceeds 5% threshold` });
        } else if (priceImpact > 1) {
          flags.push({ code: 'MODERATE_PRICE_IMPACT', severity: 'warning', message: `Price impact ${priceImpact}% exceeds 1% threshold` });
        }
      }
    }
  } catch {
    // If we can't fetch a quote, don't block — just use base risk
  }

  return this.assessRisk(flags);
}

private async checkSwapViability(
  intent: IntentWithProgram,
  chain: string,
  network: string,
): Promise<ViabilityDimension> {
  if (!('action' in intent) || intent.action !== 'swap') {
    return { level: 'viable', issues: [] };
  }

  const issues: string[] = [];
  const connection = this.solanaService.getConnection();
  const swap = intent as unknown as SwapIntent;
  const fromKey = new PublicKey(swap.from);

  // Check SOL balance for fees
  try {
    const balance = await connection.getBalance(fromKey, 'confirmed');
    if (balance < 10000) { // minimal SOL for fees
      issues.push(`Insufficient SOL for transaction fees: have ${(balance / 1e9).toFixed(9)} SOL`);
    }
  } catch {
    issues.push('Could not verify SOL balance via RPC');
  }

  // Check input token balance
  const inputMint = this.resolveTokenRefAddress(swap.tokenIn, chain, network);
  if (inputMint && swap.amountIn) {
    const exactAmount = (() => {
      try { return requireExactAmount(swap.amountIn!); } catch { return null; }
    })();

    if (exactAmount && inputMint !== 'So11111111111111111111111111111111111111112') {
      try {
        const { getMint, getAssociatedTokenAddressSync } = await import('@solana/spl-token');
        const mintKey = new PublicKey(inputMint);
        const mintInfo = await getMint(connection, mintKey);
        const requiredRaw = toBaseUnits(exactAmount, mintInfo.decimals);
        const sourceAta = getAssociatedTokenAddressSync(mintKey, fromKey, true);
        const tokenBalance = await connection.getTokenAccountBalance(sourceAta, 'confirmed');
        const availableRaw = BigInt(tokenBalance.value.amount);
        if (availableRaw < requiredRaw) {
          issues.push(`Insufficient input token balance: need ${requiredRaw.toString()}, have ${availableRaw.toString()}`);
        }
      } catch {
        issues.push('Could not verify input token balance');
      }
    }
  }

  return this.viabilityFromIssues(issues);
}

private resolveTokenRefAddress(ref: TokenRef, chain: string, network: string): string | null {
  if (ref.token) return ref.token;
  if (!ref.tokenSymbol) return null;
  if (ref.tokenSymbol.toUpperCase() === 'SOL') return 'So11111111111111111111111111111111111111112';
  const registry = createTokenRegistry();
  const resolved = registry.resolveSymbol(chain, network, ref.tokenSymbol.toUpperCase());
  return resolved?.address ?? null;
}
```

**Step 3: Wire swap analysis into the main analyze() method**

In the `analyze()` method, add swap checking after the existing native transfer fallback:

```typescript
// After the nativeFallback block, add:
const swapCheck = await this.checkSwapMatch(intent as IntentWithProgram, raw, chain, network);
if (swapCheck.discrepancies.length > 0) {
  discrepancies.push(...swapCheck.discrepancies);
}

const matched = (verifyResult.matched || nativeFallback.matched || swapCheck.matched) && discrepancies.length === 0;
```

Update match level inference to consider swap match:
```typescript
const match: MatchDimension = {
  level: matched ? 'full' : this.inferMatchLevel(intent as IntentWithProgram, raw, verifyResult.matched || nativeFallback.matched || swapCheck.matched),
  discrepancies,
};
```

Replace the risk and viability lines for swaps:
```typescript
const isSwap = 'action' in intent && intent.action === 'swap';

const risk = isSwap
  ? await this.assessSwapRisk(intent as IntentWithProgram, chain, network, raw.flags)
  : this.assessRisk(raw.flags);

const viability = opts?.checkViability === false
  ? { level: 'viable' as const, issues: [] }
  : isSwap
    ? await this.checkSwapViability(intent as IntentWithProgram, chain, network)
    : await this.checkViability(intent as IntentWithProgram, chain, network);
```

**Step 4: Update matchesAction for swap**

In `matchesAction()`, add swap recognition:
```typescript
if (action === 'swap' && ixType === 'swap') {
  return true;
}
```

**Step 5: Run all tests**

Run: `cd apps/backend && npx jest --no-coverage`
Expected: All pass

**Step 6: Commit**

```
git add apps/backend/src/services/chains/solana/solana.analyzer.ts
git commit -m "feat: add swap-specific match, risk, and viability analysis"
```

---

## Task 8: Update program registry with Jupiter addresses

**Files:**
- Modify: `apps/backend/src/services/chains/solana/program-registry.ts`

**Step 1: Verify Jupiter is already in the registry**

The registry already has jupiter in mainnet:
```typescript
jupiter: { address: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4' },
```

Add it to devnet as well (Jupiter works on devnet too):
```typescript
devnet: {
  handshake: { address: 'HANDu9uNdnraNbcueGfXhd3UPu6BXfQroKAsSxFhPXEQ' },
  silkysig: { address: 'SiLKos3MCFggwLsjSeuRiCdcs2MLoJNwq59XwTvEwcS' },
  jupiter: { address: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4' },
},
```

**Step 2: Commit**

```
git add apps/backend/src/services/chains/solana/program-registry.ts
git commit -m "feat: add Jupiter program to devnet registry"
```

---

## Task 9: End-to-end integration test

**Files:**
- Create: `apps/backend/src/services/chains/solana/programs/jupiter.builder.integration.spec.ts`

This is an optional end-to-end smoke test that can run against the real Jupiter API (mark as skipped by default for CI):

**Step 1: Write the integration test**

```typescript
import { Keypair } from '@solana/web3.js';
import { JupiterBuilder } from './jupiter.builder';
import { JupiterClient } from '../jupiter-client';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

// Skip in CI — requires real Jupiter API access
const describeIf = process.env.INTEGRATION_TESTS ? describe : describe.skip;

describeIf('JupiterBuilder (integration)', () => {
  let builder: JupiterBuilder;

  beforeAll(() => {
    const httpService = new HttpService();
    const configService = { get: (key: string, fallback?: string) => fallback ?? '' } as any;
    const client = new JupiterClient(httpService, configService);
    builder = new JupiterBuilder(client);
  });

  it('builds a USDC -> SOL swap intent', async () => {
    const signer = Keypair.generate().publicKey;

    const result = await builder.build(
      {
        action: 'swap',
        from: signer.toBase58(),
        tokenIn: { token: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
        tokenOut: { token: 'So11111111111111111111111111111111111111112' },
        amountIn: '1', // 1 USDC
      } as any,
      {
        connection: {} as any, // not used for quote/instructions
        feePayer: signer,
        signer,
        chain: 'solana',
        network: 'mainnet',
      },
    );

    expect(result.instructions.length).toBeGreaterThan(0);
    expect(result.addressLookupTableAddresses?.length).toBeGreaterThan(0);
    expect(result.metadata?.outAmount).toBeDefined();
    expect(result.metadata?.priceImpactPct).toBeDefined();
  }, 30000);
});
```

**Step 2: Run the integration test (optional, skip in CI)**

Run: `INTEGRATION_TESTS=1 cd apps/backend && npx jest --testPathPattern='jupiter.builder.integration' --no-coverage`

**Step 3: Commit**

```
git add apps/backend/src/services/chains/solana/programs/jupiter.builder.integration.spec.ts
git commit -m "test: add Jupiter builder integration test (skipped in CI)"
```

---

## Task 10: Final verification

**Step 1: Run all tests**

Run: `cd apps/backend && npx jest --no-coverage`
Expected: All pass

**Step 2: Verify TypeScript compilation**

Run: `cd apps/backend && npx tsc --noEmit`
Expected: No errors

**Step 3: Verify the app starts**

Run: `cd apps/backend && npx nest build`
Expected: Build succeeds

---

## Summary of all files changed/created

**Created:**
- `apps/backend/src/services/chains/solana/solana-tx-assembler.ts`
- `apps/backend/src/services/chains/solana/solana-tx-assembler.spec.ts`
- `apps/backend/src/services/chains/solana/jupiter-client.ts`
- `apps/backend/src/services/chains/solana/jupiter-client.spec.ts`
- `apps/backend/src/services/chains/solana/programs/jupiter.builder.ts`
- `apps/backend/src/services/chains/solana/programs/jupiter.builder.spec.ts`
- `apps/backend/src/services/chains/solana/programs/jupiter.builder.integration.spec.ts`

**Modified:**
- `apps/backend/src/services/chains/solana/program-builder.interface.ts` — widened return type
- `apps/backend/src/services/chains/solana/programs/native.builder.ts` — return ProgramBuildResult
- `apps/backend/src/services/chains/solana/programs/native.builder.spec.ts` — updated assertions
- `apps/backend/src/services/chains/solana/programs/handshake.builder.ts` — return ProgramBuildResult
- `apps/backend/src/services/chains/solana/solana.builder.ts` — uses assembler, registers jupiter
- `apps/backend/src/services/chains/solana/solana.builder.spec.ts` — updated mocks
- `apps/backend/src/services/chains/solana/solana.analyzer.ts` — swap analysis
- `apps/backend/src/services/chains/solana/solana-chain.module.ts` — new providers
- `apps/backend/src/services/chains/solana/program-registry.ts` — jupiter devnet entry
- `docs/design/intent-engine.md` — updated swap action to match SDK types
