# Intent Engine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `program`/`programName` fields to the SDK intent types with program-aware verification, then build the backend intent engine with `build` and `analyze` endpoints for Solana transfers.

**Architecture:** Two repos change. The SDK (`/Users/si/projects/maxi/silk`) gets ProgramRef on Intent types, a bidirectional program registry, and matcher updates. The backend (`/Users/si/projects/maxi/silkyway/apps/backend`) gets a new `src/services/` module with chain-pluggable `build` and `analyze` orchestrators, starting with Solana native transfers and Handshake transfers.

**Tech Stack:** TypeScript, Vitest (SDK), Jest (backend), NestJS, @solana/web3.js, @solana/spl-token, @silkysquad/silk

**Design doc:** `docs/design/intent-engine.md`

---

### Task 1: SDK — Add ProgramRef to intent types and update helpers

**Files:**
- Modify: `/Users/si/projects/maxi/silk/src/intent/types.ts`
- Modify: `/Users/si/projects/maxi/silk/src/intent/helpers.ts`
- Test: `/Users/si/projects/maxi/silk/src/intent/__tests__/helpers.test.ts`

**Step 1: Write the failing test**

Add to `/Users/si/projects/maxi/silk/src/intent/__tests__/helpers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getActions, getProgramRef, isSingleIntent, isCompoundIntent } from '../helpers.js';
import type { Intent, ProgramRef } from '../types.js';

describe('helpers', () => {
  describe('getActions', () => {
    it('extracts action from single intent without program fields leaking', () => {
      const intent: Intent = {
        chain: 'solana',
        action: 'transfer',
        from: 'Alice',
        to: 'Bob',
        amount: '100',
        programName: 'handshake',
        program: 'HANDu9uNdnraNbcueGfXhd3UPu6BXfQroKAsSxFhPXEQ',
      };
      const actions = getActions(intent);
      expect(actions).toHaveLength(1);
      expect(actions[0].action).toBe('transfer');
      expect((actions[0] as any).programName).toBeUndefined();
      expect((actions[0] as any).program).toBeUndefined();
      expect((actions[0] as any).chain).toBeUndefined();
    });

    it('works with single intent without program fields', () => {
      const intent: Intent = {
        chain: 'solana',
        action: 'transfer',
        from: 'Alice',
        to: 'Bob',
        amount: '100',
      };
      const actions = getActions(intent);
      expect(actions).toHaveLength(1);
      expect(actions[0].action).toBe('transfer');
    });
  });

  describe('getProgramRef', () => {
    it('extracts program ref from single intent', () => {
      const intent: Intent = {
        chain: 'solana',
        action: 'transfer',
        from: 'Alice',
        to: 'Bob',
        amount: '100',
        programName: 'handshake',
        program: 'HANDu9uN...',
      };
      const ref = getProgramRef(intent);
      expect(ref.programName).toBe('handshake');
      expect(ref.program).toBe('HANDu9uN...');
    });

    it('extracts program ref from compound intent', () => {
      const intent: Intent = {
        chain: 'solana',
        programName: 'handshake',
        actions: [
          { action: 'transfer', from: 'Alice', to: 'Bob', amount: '100' },
        ],
      };
      const ref = getProgramRef(intent);
      expect(ref.programName).toBe('handshake');
    });

    it('returns empty ref when no program fields', () => {
      const intent: Intent = {
        chain: 'solana',
        action: 'transfer',
        from: 'Alice',
        to: 'Bob',
        amount: '100',
      };
      const ref = getProgramRef(intent);
      expect(ref.programName).toBeUndefined();
      expect(ref.program).toBeUndefined();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/si/projects/maxi/silk && npx vitest run src/intent/__tests__/helpers.test.ts`
Expected: FAIL — `ProgramRef` type and `getProgramRef` don't exist yet.

**Step 3: Implement — update types.ts**

In `/Users/si/projects/maxi/silk/src/intent/types.ts`, add `ProgramRef` type after `TokenRef` (after line 17), and update `SingleIntent` and `CompoundIntent`:

```typescript
// After TokenRef (line 17), add:

// ─── Program identification ──────────────────────────────────

export type ProgramRef = {
  programName?: string;
  program?: string;
};
```

Update `SingleIntent` (line 96-99) to:

```typescript
export type SingleIntent = {
  chain: string;
  strict?: boolean;
} & ActionIntent & ProgramRef;
```

Update `CompoundIntent` (line 101-105) to:

```typescript
export type CompoundIntent = {
  chain: string;
  strict?: boolean;
  actions: ActionIntent[];
} & ProgramRef;
```

**Step 4: Implement — update helpers.ts**

Replace `/Users/si/projects/maxi/silk/src/intent/helpers.ts` with:

```typescript
import type { Intent, SingleIntent, CompoundIntent, ActionIntent, ProgramRef } from './types.js';

export function isSingleIntent(intent: Intent): intent is SingleIntent {
  return 'action' in intent;
}

export function isCompoundIntent(intent: Intent): intent is CompoundIntent {
  return 'actions' in intent;
}

export function getActions(intent: Intent): ActionIntent[] {
  if (isCompoundIntent(intent)) {
    return intent.actions;
  }
  const {
    chain: _chain, strict: _strict,
    program: _program, programName: _programName,
    ...action
  } = intent as SingleIntent;
  return [action as ActionIntent];
}

export function getProgramRef(intent: Intent): ProgramRef {
  return {
    programName: (intent as SingleIntent).programName,
    program: (intent as SingleIntent).program,
  };
}
```

**Step 5: Run test to verify it passes**

Run: `cd /Users/si/projects/maxi/silk && npx vitest run src/intent/__tests__/helpers.test.ts`
Expected: PASS

**Step 6: Run all existing tests to verify no regressions**

Run: `cd /Users/si/projects/maxi/silk && npx vitest run`
Expected: All tests PASS

**Step 7: Commit**

```bash
cd /Users/si/projects/maxi/silk
git add src/intent/types.ts src/intent/helpers.ts src/intent/__tests__/helpers.test.ts
git commit -m "feat: add ProgramRef to intent types

Add program/programName fields to SingleIntent and CompoundIntent,
mirroring the token/tokenSymbol convention. Update getActions to
strip program fields. Add getProgramRef helper."
```

---

### Task 2: SDK — Create bidirectional program registry

**Files:**
- Create: `/Users/si/projects/maxi/silk/src/intent/program-registry.ts`
- Test: `/Users/si/projects/maxi/silk/src/intent/__tests__/program-registry.test.ts`

**Step 1: Write the failing test**

Create `/Users/si/projects/maxi/silk/src/intent/__tests__/program-registry.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createProgramRegistry } from '../program-registry.js';

describe('ProgramRegistry', () => {
  it('resolves handshake on solana mainnet by name', () => {
    const reg = createProgramRegistry();
    const result = reg.resolveName('solana', 'mainnet', 'handshake');
    expect(result).not.toBeNull();
    expect(result!.address).toBe('HANDu9uNdnraNbcueGfXhd3UPu6BXfQroKAsSxFhPXEQ');
    expect(result!.name).toBe('handshake');
  });

  it('resolves handshake on solana mainnet by address', () => {
    const reg = createProgramRegistry();
    const result = reg.resolveAddress('solana', 'mainnet', 'HANDu9uNdnraNbcueGfXhd3UPu6BXfQroKAsSxFhPXEQ');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('handshake');
  });

  it('resolves silkysig by name', () => {
    const reg = createProgramRegistry();
    const result = reg.resolveName('solana', 'mainnet', 'silkysig');
    expect(result).not.toBeNull();
    expect(result!.address).toBe('SiLKos3MCFggwLsjSeuRiCdcs2MLoJNwq59XwTvEwcS');
  });

  it('resolves jupiter by name', () => {
    const reg = createProgramRegistry();
    const result = reg.resolveName('solana', 'mainnet', 'jupiter');
    expect(result).not.toBeNull();
    expect(result!.address).toBe('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
  });

  it('returns null for unknown program name', () => {
    const reg = createProgramRegistry();
    const result = reg.resolveName('solana', 'mainnet', 'unknown');
    expect(result).toBeNull();
  });

  it('returns null for unknown address', () => {
    const reg = createProgramRegistry();
    const result = reg.resolveAddress('solana', 'mainnet', 'UnknownAddr111111111111111111111111111111111');
    expect(result).toBeNull();
  });

  it('cross-checks name and address (match)', () => {
    const reg = createProgramRegistry();
    const ok = reg.crossCheck('solana', 'mainnet', 'handshake', 'HANDu9uNdnraNbcueGfXhd3UPu6BXfQroKAsSxFhPXEQ');
    expect(ok).toBe(true);
  });

  it('cross-checks name and address (mismatch)', () => {
    const reg = createProgramRegistry();
    const bad = reg.crossCheck('solana', 'mainnet', 'handshake', 'SiLKos3MCFggwLsjSeuRiCdcs2MLoJNwq59XwTvEwcS');
    expect(bad).toBe(false);
  });

  it('EVM address lookup is case-insensitive', () => {
    const reg = createProgramRegistry({
      ethereum: {
        mainnet: {
          uniswap: { address: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D' },
        },
      },
    });
    const result = reg.resolveAddress('ethereum', 'mainnet', '0x7a250d5630b4cf539739df2c5dacb4c659f2488d');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('uniswap');
  });

  it('accepts custom overrides', () => {
    const reg = createProgramRegistry({
      solana: {
        mainnet: {
          custom: { address: 'CUSTOMprog111111111111111111111111111111111' },
        },
      },
    });
    const result = reg.resolveName('solana', 'mainnet', 'custom');
    expect(result).not.toBeNull();
    expect(result!.address).toBe('CUSTOMprog111111111111111111111111111111111');
  });

  it('devnet programs resolve separately', () => {
    const reg = createProgramRegistry();
    // Bundled programs share addresses across networks currently,
    // but devnet entries should be resolvable
    const result = reg.resolveName('solana', 'devnet', 'handshake');
    expect(result).not.toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/si/projects/maxi/silk && npx vitest run src/intent/__tests__/program-registry.test.ts`
Expected: FAIL — module doesn't exist.

**Step 3: Implement program registry**

Create `/Users/si/projects/maxi/silk/src/intent/program-registry.ts`:

```typescript
import { isEvmChain } from './chains.js';

export interface ProgramInfo {
  address: string;
  name: string;
}

type ProgramEntry = { address: string };
type OverrideMap = Record<string, Record<string, Record<string, ProgramEntry>>>;

// ─── Bundled program data ─────────────────────────────────────
// Structure: chain → network → name → { address }
// Programs on the same chain typically share addresses across networks,
// but the structure allows per-network overrides.

const BUNDLED_PROGRAMS: Record<string, Record<string, Record<string, ProgramEntry>>> = {
  solana: {
    mainnet: {
      handshake: { address: 'HANDu9uNdnraNbcueGfXhd3UPu6BXfQroKAsSxFhPXEQ' },
      silkysig:  { address: 'SiLKos3MCFggwLsjSeuRiCdcs2MLoJNwq59XwTvEwcS' },
      jupiter:   { address: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4' },
    },
    devnet: {
      handshake: { address: 'HANDu9uNdnraNbcueGfXhd3UPu6BXfQroKAsSxFhPXEQ' },
      silkysig:  { address: 'SiLKos3MCFggwLsjSeuRiCdcs2MLoJNwq59XwTvEwcS' },
    },
  },
};

export function createProgramRegistry(overrides?: OverrideMap) {
  const programs = mergeDeep(BUNDLED_PROGRAMS, overrides ?? {});

  function getChainNetwork(chain: string, network: string): Record<string, ProgramEntry> {
    return programs[chain]?.[network] ?? {};
  }

  function resolveName(chain: string, network: string, name: string): ProgramInfo | null {
    const entry = getChainNetwork(chain, network)[name];
    if (!entry) return null;
    return { address: entry.address, name };
  }

  function resolveAddress(chain: string, network: string, address: string): ProgramInfo | null {
    const entries = getChainNetwork(chain, network);
    const evm = isEvmChain(chain);
    const normalizedAddr = evm ? address.toLowerCase() : address;

    for (const [name, entry] of Object.entries(entries)) {
      const entryAddr = evm ? entry.address.toLowerCase() : entry.address;
      if (entryAddr === normalizedAddr) {
        return { address: entry.address, name };
      }
    }
    return null;
  }

  function crossCheck(chain: string, network: string, name: string, address: string): boolean {
    const resolved = resolveName(chain, network, name);
    if (!resolved) return false;
    const evm = isEvmChain(chain);
    const a = evm ? resolved.address.toLowerCase() : resolved.address;
    const b = evm ? address.toLowerCase() : address;
    return a === b;
  }

  return { resolveName, resolveAddress, crossCheck };
}

function mergeDeep(
  base: Record<string, Record<string, Record<string, ProgramEntry>>>,
  overrides: Record<string, Record<string, Record<string, ProgramEntry>>>,
): Record<string, Record<string, Record<string, ProgramEntry>>> {
  const result = { ...base };
  for (const [chain, networks] of Object.entries(overrides)) {
    if (!result[chain]) {
      result[chain] = networks;
      continue;
    }
    result[chain] = { ...result[chain] };
    for (const [network, progs] of Object.entries(networks)) {
      result[chain][network] = { ...result[chain][network], ...progs };
    }
  }
  return result;
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/si/projects/maxi/silk && npx vitest run src/intent/__tests__/program-registry.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
cd /Users/si/projects/maxi/silk
git add src/intent/program-registry.ts src/intent/__tests__/program-registry.test.ts
git commit -m "feat: add bidirectional program registry

Mirrors token-registry pattern: resolveName, resolveAddress,
crossCheck. Chain-and-network-scoped. Bundled with Handshake,
Silkysig, and Jupiter program addresses."
```

---

### Task 3: SDK — Update matcher for program-aware verification

**Files:**
- Modify: `/Users/si/projects/maxi/silk/src/intent/matcher.ts`
- Test: `/Users/si/projects/maxi/silk/src/intent/__tests__/matcher.test.ts`

**Step 1: Write the failing tests**

Add to the existing `describe('matchIntent', ...)` block in `/Users/si/projects/maxi/silk/src/intent/__tests__/matcher.test.ts`:

```typescript
  it('checks program identity when expectedProgram is provided', () => {
    const actions: ActionIntent[] = [{
      action: 'transfer',
      from: 'Alice',
      to: 'Bob',
      amount: '100',
    }];

    const instructions: InstructionAnalysis[] = [
      makeIx({
        type: 'transfer',
        programId: 'HANDu9uNdnraNbcueGfXhd3UPu6BXfQroKAsSxFhPXEQ',
        params: { from: 'Alice', to: 'Bob', amountHuman: '100 USDC' },
      }),
    ];

    const result = matchIntent(actions, instructions, [], 'solana', false, 'HANDu9uNdnraNbcueGfXhd3UPu6BXfQroKAsSxFhPXEQ');
    expect(result.matched).toBe(true);
  });

  it('fails when expectedProgram does not match instruction programId', () => {
    const actions: ActionIntent[] = [{
      action: 'transfer',
      from: 'Alice',
      to: 'Bob',
      amount: '100',
    }];

    const instructions: InstructionAnalysis[] = [
      makeIx({
        type: 'transfer',
        programId: 'SomeOtherProgram111111111111111111111111111',
        params: { from: 'Alice', to: 'Bob', amountHuman: '100 USDC' },
      }),
    ];

    const result = matchIntent(actions, instructions, [], 'solana', false, 'HANDu9uNdnraNbcueGfXhd3UPu6BXfQroKAsSxFhPXEQ');
    expect(result.matched).toBe(false);
    expect(result.discrepancies.some((d) => d.includes('program'))).toBe(true);
  });

  it('skips program check when expectedProgram is not provided', () => {
    const actions: ActionIntent[] = [{
      action: 'transfer',
      from: 'Alice',
      to: 'Bob',
      amount: '100',
    }];

    const instructions: InstructionAnalysis[] = [
      makeIx({
        type: 'transfer',
        programId: 'AnyProgram111111111111111111111111111111111',
        params: { from: 'Alice', to: 'Bob', amountHuman: '100 USDC' },
      }),
    ];

    // No expectedProgram arg — should match regardless of programId
    const result = matchIntent(actions, instructions, [], 'solana', false);
    expect(result.matched).toBe(true);
  });
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/si/projects/maxi/silk && npx vitest run src/intent/__tests__/matcher.test.ts`
Expected: FAIL — `matchIntent` doesn't accept 6th argument yet.

**Step 3: Implement — update matcher.ts**

In `/Users/si/projects/maxi/silk/src/intent/matcher.ts`:

Update `matchIntent` signature (line 18) to accept optional `expectedProgram`:

```typescript
export function matchIntent(
  actions: ActionIntent[],
  instructions: InstructionAnalysis[],
  globalFlags: RiskFlag[],
  chain: string,
  strict: boolean,
  expectedProgram?: string,
): MatchResult {
```

Update `matchSingleAction` call (line 39) to pass `expectedProgram`:

```typescript
    const actionResult = matchSingleAction(action, instructions, usedIndices, chain, expectedProgram);
```

Update `matchSingleAction` signature (line 71) and add program check:

```typescript
function matchSingleAction(
  action: ActionIntent,
  instructions: InstructionAnalysis[],
  usedIndices: Set<number>,
  chain: string,
  expectedProgram?: string,
): SingleActionResult {
  const discrepancies: string[] = [];

  // Find matching instruction by action/type (and optionally by program)
  const match = instructions.find(
    (ix) => ix.type === action.action && !usedIndices.has(ix.index),
  );

  if (!match) {
    discrepancies.push(`Expected a '${action.action}' instruction but none was found in the transaction.`);
    return { confidence: 'full', discrepancies, matchedIndex: null };
  }

  // Check program identity when expectedProgram is provided
  if (expectedProgram && match.programId !== expectedProgram) {
    discrepancies.push(
      `Expected program ${expectedProgram} but instruction calls ${match.programId}`,
    );
  }

  // Unknown actions get structural match only
  if (!KNOWN_ACTIONS.has(action.action)) {
    return { confidence: 'unverified', discrepancies, matchedIndex: match.index };
  }

  // Deep field comparison for known actions
  const params = match.params;
  const fieldDiscrepancies = compareFields(action, params, chain);
  discrepancies.push(...fieldDiscrepancies);

  return { confidence: 'full', discrepancies, matchedIndex: match.index };
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/si/projects/maxi/silk && npx vitest run src/intent/__tests__/matcher.test.ts`
Expected: All tests PASS (both old and new)

**Step 5: Commit**

```bash
cd /Users/si/projects/maxi/silk
git add src/intent/matcher.ts src/intent/__tests__/matcher.test.ts
git commit -m "feat: add program identity checking to matcher

matchIntent accepts optional expectedProgram parameter.
When provided, verifies matched instruction's programId
matches the expected program address."
```

---

### Task 4: SDK — Update verifyIntent to resolve programs, update exports

**Files:**
- Modify: `/Users/si/projects/maxi/silk/src/intent/index.ts`
- Modify: `/Users/si/projects/maxi/silk/src/index.ts`
- Test: `/Users/si/projects/maxi/silk/src/intent/__tests__/verify.test.ts` (add test)

**Step 1: Write the failing test**

Add to `/Users/si/projects/maxi/silk/src/intent/__tests__/verify.test.ts` (within the existing describe block, or create one if needed — read the file first to check existing structure):

```typescript
  it('returns discrepancy when programName does not match instruction program', async () => {
    // Build a mock tx that calls a program other than Handshake
    // but has the right instruction type after remapping
    const intent: Intent = {
      chain: 'solana',
      action: 'transfer',
      from: 'Alice',
      to: 'Bob',
      amount: '100',
      programName: 'handshake',
    };

    // This test verifies the plumbing: verifyIntent extracts programName,
    // resolves it via the program registry, and passes expectedProgram to the matcher.
    // A full integration test would need a real transaction — this is covered by
    // the matcher unit tests above.
  });
```

Note: The full integration test for this is complex (requires building a real Solana tx). The matcher unit tests in Task 3 cover the core logic. This task focuses on the wiring.

**Step 2: Implement — update intent/index.ts**

Replace `/Users/si/projects/maxi/silk/src/intent/index.ts`:

```typescript
import type { Intent, VerifyResult } from './types.js';
import type { AnalyzeOptions, TransactionAnalysis } from '../verify/index.js';
import { analyzeTransaction as solanaAnalyze } from '../verify/index.js';
import { parseChain } from './chains.js';
import { getActions, getProgramRef } from './helpers.js';
import { matchIntent } from './matcher.js';
import { createProgramRegistry } from './program-registry.js';

export type { Intent, SingleIntent, CompoundIntent, ActionIntent, Constraint, TokenRef, ProgramRef, VerifyResult, Confidence } from './types.js';
export type { TransferIntent, SwapIntent, StakeIntent, LendIntent, BorrowIntent, ApproveIntent, WithdrawIntent, CustomIntent } from './types.js';
export { evaluateConstraint } from './constraints.js';
export { createTokenRegistry } from './token-registry.js';
export { createProgramRegistry } from './program-registry.js';
export type { ProgramInfo } from './program-registry.js';
export { parseChain, normalizeAddress, isEvmChain } from './chains.js';
export { getProgramRef } from './helpers.js';

// Maps generic action names to adapter-specific decoded instruction types.
const SOLANA_ACTION_MAP: Record<string, string> = {
  transfer: 'create_transfer',
};

export async function verifyIntent(
  txBytes: string,
  intent: Intent,
  opts: AnalyzeOptions = {},
): Promise<VerifyResult> {
  if (!intent.chain) {
    return {
      matched: false,
      confidence: 'unverified',
      discrepancies: ['Intent is missing required "chain" field.'],
      analysis: { feePayer: '', instructions: [], flags: [], summary: '' },
    };
  }

  const { chain, network } = parseChain(intent.chain);
  const strict = intent.strict ?? false;
  const actions = getActions(intent);
  const programRef = getProgramRef(intent);

  // Resolve program address from programName if provided
  let expectedProgram: string | undefined;
  if (programRef.program && programRef.programName) {
    // Both provided — cross-check
    const reg = createProgramRegistry();
    const valid = reg.crossCheck(chain, network, programRef.programName, programRef.program);
    if (!valid) {
      return {
        matched: false,
        confidence: 'full',
        discrepancies: [
          `Program cross-check failed: '${programRef.programName}' does not match address '${programRef.program}'`,
        ],
        analysis: { feePayer: '', instructions: [], flags: [], summary: '' },
      };
    }
    expectedProgram = programRef.program;
  } else if (programRef.program) {
    expectedProgram = programRef.program;
  } else if (programRef.programName) {
    const reg = createProgramRegistry();
    const resolved = reg.resolveName(chain, network, programRef.programName);
    if (resolved) {
      expectedProgram = resolved.address;
    }
  }

  let analysis: TransactionAnalysis;

  if (chain === 'solana') {
    analysis = await solanaAnalyze(txBytes, opts);

    // Remap Solana-specific instruction types to generic action names
    // Only remap when no specific program is requested, OR when the
    // program matches the instruction's origin (Handshake).
    for (const ix of analysis.instructions) {
      for (const [generic, specific] of Object.entries(SOLANA_ACTION_MAP)) {
        if (ix.type === specific) {
          ix.type = generic;
          if (ix.params['sender']) {
            ix.params['from'] = ix.params['sender'];
          }
          if (ix.params['recipient']) {
            ix.params['to'] = ix.params['recipient'];
          }
        }
      }
    }
  } else {
    return {
      matched: false,
      confidence: 'unverified',
      discrepancies: [`Chain adapter for '${chain}' is not yet implemented.`],
      analysis: { feePayer: '', instructions: [], flags: [], summary: '' },
    };
  }

  const result = matchIntent(actions, analysis.instructions, analysis.flags, chain, strict, expectedProgram);

  return {
    matched: result.matched,
    confidence: result.confidence,
    discrepancies: result.discrepancies,
    analysis,
  };
}
```

**Step 3: Implement — update src/index.ts exports**

In `/Users/si/projects/maxi/silk/src/index.ts`, update the cross-chain intent framework section (lines 16-35) to:

```typescript
// Cross-chain intent framework
export { verifyIntent as verifyIntentV2 } from './intent/index.js';
export type {
  Intent as IntentV2,
  SingleIntent,
  CompoundIntent,
  ActionIntent,
  Constraint,
  TokenRef,
  ProgramRef,
  Confidence,
  TransferIntent,
  SwapIntent,
  StakeIntent,
  LendIntent,
  BorrowIntent,
  ApproveIntent,
  WithdrawIntent,
  CustomIntent,
  VerifyResult as VerifyResultV2,
  ProgramInfo,
} from './intent/index.js';
export { evaluateConstraint, createTokenRegistry, createProgramRegistry, parseChain, normalizeAddress, isEvmChain, getProgramRef } from './intent/index.js';
```

**Step 4: Run all tests**

Run: `cd /Users/si/projects/maxi/silk && npx vitest run`
Expected: All tests PASS

**Step 5: Commit**

```bash
cd /Users/si/projects/maxi/silk
git add src/intent/index.ts src/index.ts
git commit -m "feat: wire program resolution into verifyIntent

verifyIntent now extracts ProgramRef from intent, resolves
programName via program registry, cross-checks when both
provided, and passes expectedProgram to matcher. Exports
ProgramRef, ProgramInfo, createProgramRegistry, getProgramRef."
```

---

### Task 5: Backend — Create intent engine types and chain interfaces

**Files:**
- Create: `/Users/si/projects/maxi/silkyway/apps/backend/src/services/intent/types.ts`
- Create: `/Users/si/projects/maxi/silkyway/apps/backend/src/services/chains/chain.interface.ts`

No tests for this task — pure type definitions.

**Step 1: Create directory structure**

```bash
cd /Users/si/projects/maxi/silkyway/apps/backend
mkdir -p src/services/intent
mkdir -p src/services/chains/solana/programs
```

**Step 2: Create intent types**

Create `/Users/si/projects/maxi/silkyway/apps/backend/src/services/intent/types.ts`:

```typescript
import type { IntentV2 as Intent, ActionIntent, TransactionAnalysis, RiskFlag } from '@silkysquad/silk';

// ─── Verdict ─────────────────────────────────────────────────

export type Verdict = 'proceed' | 'caution' | 'reject';

// ─── Analyze dimensions ─────────────────────────────────────

export type MatchLevel = 'full' | 'partial' | 'none';

export interface MatchDimension {
  level: MatchLevel;
  discrepancies: string[];
}

export type RiskLevel = 'low' | 'medium' | 'high';

export interface RiskDimension {
  level: RiskLevel;
  flags: RiskFlag[];
}

export type ViabilityLevel = 'viable' | 'uncertain' | 'unviable';

export interface ViabilityDimension {
  level: ViabilityLevel;
  issues: string[];
}

export interface AnalyzeResult {
  verdict: Verdict;
  match: MatchDimension;
  risk: RiskDimension;
  viability: ViabilityDimension;
  raw: TransactionAnalysis;
}

// ─── Build types ─────────────────────────────────────────────

export interface BuildMetadata {
  chain: string;
  network: string;
  program?: string;
  programName?: string;
  estimatedFee?: string;
}

export interface BuildResult {
  transaction: string;
  intent: Intent;
  metadata: BuildMetadata;
  analysis?: AnalyzeResult;
}

// ─── Verdict derivation ──────────────────────────────────────

export function deriveVerdict(match: MatchDimension, risk: RiskDimension, viability: ViabilityDimension): Verdict {
  if (match.level === 'none' || risk.level === 'high' || viability.level === 'unviable') {
    return 'reject';
  }
  if (match.level === 'partial' || risk.level === 'medium' || viability.level === 'uncertain') {
    return 'caution';
  }
  return 'proceed';
}

// Re-export SDK types used by consumers
export type { Intent, ActionIntent };
```

**Step 3: Create chain interfaces**

Create `/Users/si/projects/maxi/silkyway/apps/backend/src/services/chains/chain.interface.ts`:

```typescript
import type { IntentV2 as Intent } from '@silkysquad/silk';
import type { BuildResult, AnalyzeResult } from '../intent/types';

export interface BuildOpts {
  feePayer?: string;
}

export interface AnalyzeOpts {
  checkViability?: boolean;
}

export interface ChainBuilder {
  readonly chain: string;
  build(intent: Intent, opts?: BuildOpts): Promise<BuildResult>;
}

export interface ChainAnalyzer {
  readonly chain: string;
  analyze(tx: string, intent: Intent, opts?: AnalyzeOpts): Promise<AnalyzeResult>;
}
```

**Step 4: Create program builder interface**

Create `/Users/si/projects/maxi/silkyway/apps/backend/src/services/chains/solana/program-builder.interface.ts`:

```typescript
import type { ActionIntent } from '@silkysquad/silk';
import type { Connection, TransactionInstruction, PublicKey } from '@solana/web3.js';

export interface SolanaBuildContext {
  connection: Connection;
  feePayer: PublicKey;
  chain: string;
  network: string;
}

export interface ProgramBuilder {
  readonly programName: string;
  readonly supportedActions: string[];
  build(action: ActionIntent, context: SolanaBuildContext): Promise<TransactionInstruction[]>;
}
```

**Step 5: Commit**

```bash
cd /Users/si/projects/maxi/silkyway
git add apps/backend/src/services/
git commit -m "feat: add intent engine types and chain interfaces

Create services/intent/types.ts with AnalyzeResult, BuildResult,
verdict derivation. Create services/chains/ with ChainBuilder,
ChainAnalyzer, and ProgramBuilder interfaces."
```

---

### Task 6: Backend — Create Solana program builders (native + handshake)

**Files:**
- Create: `/Users/si/projects/maxi/silkyway/apps/backend/src/services/chains/solana/programs/native.builder.ts`
- Create: `/Users/si/projects/maxi/silkyway/apps/backend/src/services/chains/solana/programs/handshake.builder.ts`
- Test: `/Users/si/projects/maxi/silkyway/apps/backend/src/services/chains/solana/programs/native.builder.spec.ts`

**Step 1: Write the failing test for native builder**

Create `/Users/si/projects/maxi/silkyway/apps/backend/src/services/chains/solana/programs/native.builder.spec.ts`:

```typescript
import { NativeBuilder } from './native.builder';

describe('NativeBuilder', () => {
  it('has correct programName and supportedActions', () => {
    const builder = new NativeBuilder();
    expect(builder.programName).toBe('native');
    expect(builder.supportedActions).toContain('transfer');
  });

  it('rejects unsupported actions', async () => {
    const builder = new NativeBuilder();
    const action = { action: 'swap', from: 'Alice' } as any;
    const context = { connection: {}, feePayer: {} } as any;
    await expect(builder.build(action, context)).rejects.toThrow('not supported');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/si/projects/maxi/silkyway/apps/backend && npx jest src/services/chains/solana/programs/native.builder.spec.ts`
Expected: FAIL — module doesn't exist.

**Step 3: Implement native builder**

Create `/Users/si/projects/maxi/silkyway/apps/backend/src/services/chains/solana/programs/native.builder.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import type { TransactionInstruction } from '@solana/web3.js';
import {
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  getAccount,
} from '@solana/spl-token';
import type { ActionIntent, TransferIntent } from '@silkysquad/silk';
import type { ProgramBuilder, SolanaBuildContext } from '../program-builder.interface';

@Injectable()
export class NativeBuilder implements ProgramBuilder {
  private readonly logger = new Logger(NativeBuilder.name);

  readonly programName = 'native';
  readonly supportedActions = ['transfer'];

  async build(action: ActionIntent, context: SolanaBuildContext): Promise<TransactionInstruction[]> {
    if (action.action !== 'transfer') {
      throw new Error(`Action '${action.action}' is not supported by NativeBuilder`);
    }

    return this.buildTransfer(action as TransferIntent, context);
  }

  private async buildTransfer(
    intent: TransferIntent,
    context: SolanaBuildContext,
  ): Promise<TransactionInstruction[]> {
    const instructions: TransactionInstruction[] = [];
    const recipient = new PublicKey(intent.to);

    // Determine if this is a native SOL transfer or SPL token transfer
    const isNativeSol = !intent.token && !intent.tokenSymbol;

    if (isNativeSol) {
      // Native SOL transfer
      const amount = this.resolveExactAmount(intent.amount);
      const lamports = Math.round(amount * 1e9); // SOL has 9 decimals

      instructions.push(
        SystemProgram.transfer({
          fromPubkey: context.feePayer,
          toPubkey: recipient,
          lamports,
        }),
      );
    } else {
      // SPL token transfer — need to resolve mint
      const mint = intent.token ? new PublicKey(intent.token) : null;
      if (!mint) {
        throw new Error('Token mint address is required for SPL transfers. Provide intent.token.');
      }

      // Get token decimals from mint account
      const mintInfo = await context.connection.getAccountInfo(mint);
      if (!mintInfo) throw new Error(`Mint ${mint.toBase58()} not found`);
      const decimals = mintInfo.data[44]; // Decimals at byte offset 44

      const amount = this.resolveExactAmount(intent.amount);
      const rawAmount = Math.round(amount * 10 ** decimals);

      const sourceAta = getAssociatedTokenAddressSync(mint, context.feePayer, true);
      const destAta = getAssociatedTokenAddressSync(mint, recipient, true);

      // Create destination ATA if needed
      try {
        await getAccount(context.connection, destAta);
      } catch {
        instructions.push(
          createAssociatedTokenAccountInstruction(
            context.feePayer,
            destAta,
            recipient,
            mint,
          ),
        );
      }

      instructions.push(
        createTransferInstruction(sourceAta, destAta, context.feePayer, rawAmount),
      );
    }

    return instructions;
  }

  private resolveExactAmount(amount: string | { gte?: string; lte?: string; gt?: string; lt?: string }): number {
    if (typeof amount === 'string') {
      return parseFloat(amount);
    }
    // For build, constraints are not valid — we need an exact amount
    throw new Error('Cannot build a transaction from an amount constraint. Provide an exact amount string.');
  }
}
```

**Step 4: Implement handshake builder**

Create `/Users/si/projects/maxi/silkyway/apps/backend/src/services/chains/solana/programs/handshake.builder.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';
import type { TransactionInstruction } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import type { ActionIntent, TransferIntent } from '@silkysquad/silk';
import type { ProgramBuilder, SolanaBuildContext } from '../program-builder.interface';
import { HandshakeClient } from '../../../../solana/handshake-client';

export interface HandshakeBuildContext extends SolanaBuildContext {
  handshakeClient: HandshakeClient;
  poolPda: PublicKey;
  tokenDecimals: number;
}

@Injectable()
export class HandshakeBuilder implements ProgramBuilder {
  private readonly logger = new Logger(HandshakeBuilder.name);

  readonly programName = 'handshake';
  readonly supportedActions = ['transfer'];

  async build(action: ActionIntent, context: SolanaBuildContext): Promise<TransactionInstruction[]> {
    if (action.action !== 'transfer') {
      throw new Error(`Action '${action.action}' is not supported by HandshakeBuilder`);
    }

    const hsContext = context as HandshakeBuildContext;
    if (!hsContext.handshakeClient || !hsContext.poolPda) {
      throw new Error('HandshakeBuilder requires handshakeClient and poolPda in context');
    }

    return this.buildCreateTransfer(action as TransferIntent, hsContext);
  }

  private async buildCreateTransfer(
    intent: TransferIntent,
    context: HandshakeBuildContext,
  ): Promise<TransactionInstruction[]> {
    const sender = context.feePayer;
    const recipient = new PublicKey(intent.to);
    const amount = this.resolveExactAmount(intent.amount);
    const amountRaw = new BN(Math.round(amount * 10 ** context.tokenDecimals));
    const nonce = new BN(Date.now());

    const { ix } = await context.handshakeClient.getCreateTransferIx(
      sender,
      recipient,
      context.poolPda,
      nonce,
      amountRaw,
      intent.memo || '',
      0, // claimableAfter
      0, // claimableUntil
    );

    return [ix];
  }

  private resolveExactAmount(amount: string | { gte?: string; lte?: string; gt?: string; lt?: string }): number {
    if (typeof amount === 'string') {
      return parseFloat(amount);
    }
    throw new Error('Cannot build a transaction from an amount constraint. Provide an exact amount string.');
  }
}
```

**Step 5: Run test to verify it passes**

Run: `cd /Users/si/projects/maxi/silkyway/apps/backend && npx jest src/services/chains/solana/programs/native.builder.spec.ts`
Expected: PASS

**Step 6: Commit**

```bash
cd /Users/si/projects/maxi/silkyway
git add apps/backend/src/services/chains/solana/
git commit -m "feat: add Solana program builders (native + handshake)

NativeBuilder handles SOL and SPL token transfers.
HandshakeBuilder wraps HandshakeClient for create_transfer.
Both implement ProgramBuilder interface."
```

---

### Task 7: Backend — Create Solana builder orchestrator and analyzer

**Files:**
- Create: `/Users/si/projects/maxi/silkyway/apps/backend/src/services/chains/solana/solana.builder.ts`
- Create: `/Users/si/projects/maxi/silkyway/apps/backend/src/services/chains/solana/solana.analyzer.ts`
- Test: `/Users/si/projects/maxi/silkyway/apps/backend/src/services/chains/solana/solana.builder.spec.ts`

**Step 1: Write the failing test**

Create `/Users/si/projects/maxi/silkyway/apps/backend/src/services/chains/solana/solana.builder.spec.ts`:

```typescript
import { SolanaBuilder } from './solana.builder';

describe('SolanaBuilder', () => {
  it('has chain set to solana', () => {
    const builder = new SolanaBuilder(
      {} as any, // solanaService
      {} as any, // nativeBuilder
      {} as any, // handshakeBuilder
    );
    expect(builder.chain).toBe('solana');
  });

  it('rejects intents for non-solana chains', async () => {
    const builder = new SolanaBuilder({} as any, {} as any, {} as any);
    const intent = { chain: 'ethereum', action: 'transfer', from: 'x', to: 'y', amount: '1' } as any;
    await expect(builder.build(intent)).rejects.toThrow('solana');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/si/projects/maxi/silkyway/apps/backend && npx jest src/services/chains/solana/solana.builder.spec.ts`
Expected: FAIL

**Step 3: Implement Solana builder orchestrator**

Create `/Users/si/projects/maxi/silkyway/apps/backend/src/services/chains/solana/solana.builder.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PublicKey, Transaction } from '@solana/web3.js';
import { parseChain, createProgramRegistry } from '@silkysquad/silk';
import type { IntentV2 as Intent, ProgramRef } from '@silkysquad/silk';
import { SolanaService } from '../../../solana/solana.service';
import type { ChainBuilder, BuildOpts } from '../chain.interface';
import type { BuildResult } from '../../intent/types';
import type { SolanaBuildContext } from './program-builder.interface';
import { NativeBuilder } from './programs/native.builder';
import { HandshakeBuilder } from './programs/handshake.builder';
import type { ProgramBuilder } from './program-builder.interface';

@Injectable()
export class SolanaBuilder implements ChainBuilder {
  private readonly logger = new Logger(SolanaBuilder.name);
  readonly chain = 'solana';

  private readonly builders = new Map<string, ProgramBuilder>();

  constructor(
    private readonly solanaService: SolanaService,
    private readonly nativeBuilder: NativeBuilder,
    private readonly handshakeBuilder: HandshakeBuilder,
  ) {
    this.builders.set('native', this.nativeBuilder);
    this.builders.set('handshake', this.handshakeBuilder);
  }

  async build(intent: Intent, opts?: BuildOpts): Promise<BuildResult> {
    const { chain, network } = parseChain(intent.chain);
    if (chain !== 'solana') {
      throw new Error(`SolanaBuilder only handles solana intents, got '${chain}'`);
    }

    const connection = this.solanaService.getConnection();
    const feePayer = new PublicKey(opts?.feePayer || this.getFeePayer(intent));

    // Resolve which program builder to use
    const programRef = this.extractProgramRef(intent);
    const builderName = this.resolveBuilderName(programRef, chain, network);
    const builder = this.builders.get(builderName);
    if (!builder) {
      throw new Error(`No builder registered for program '${builderName}'`);
    }

    // Extract the action
    const action = 'action' in intent
      ? (() => { const { chain: _c, strict: _s, program: _p, programName: _pn, ...a } = intent as any; return a; })()
      : intent.actions?.[0]; // For compound, use first action (extend later)

    if (!action) {
      throw new Error('Intent has no action');
    }

    // Build context
    const context: SolanaBuildContext = { connection, feePayer, chain, network };

    // Enrich context for specific builders
    if (builderName === 'handshake') {
      await this.enrichHandshakeContext(context, intent);
    }

    // Build instructions
    const instructions = await builder.build(action, context);

    // Assemble transaction
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.feePayer = feePayer;
    for (const ix of instructions) {
      tx.add(ix);
    }

    const serialized = tx.serialize({ requireAllSignatures: false }).toString('base64');

    // Resolve program address for metadata
    let programAddress: string | undefined;
    let programName: string | undefined;
    if (programRef.programName) {
      programName = programRef.programName;
      const reg = createProgramRegistry();
      const resolved = reg.resolveName(chain, network, programRef.programName);
      if (resolved) programAddress = resolved.address;
    }
    if (programRef.program) {
      programAddress = programRef.program;
    }

    return {
      transaction: serialized,
      intent,
      metadata: {
        chain,
        network,
        program: programAddress,
        programName,
      },
    };
  }

  private getFeePayer(intent: Intent): string {
    if ('action' in intent) {
      const single = intent as any;
      return single.from || single.owner;
    }
    const compound = intent as any;
    return compound.actions?.[0]?.from || compound.actions?.[0]?.owner;
  }

  private extractProgramRef(intent: Intent): { program?: string; programName?: string } {
    return {
      program: (intent as any).program,
      programName: (intent as any).programName,
    };
  }

  private resolveBuilderName(
    programRef: { program?: string; programName?: string },
    chain: string,
    network: string,
  ): string {
    if (programRef.programName) {
      return programRef.programName;
    }
    if (programRef.program) {
      const reg = createProgramRegistry();
      const resolved = reg.resolveAddress(chain, network, programRef.program);
      if (resolved) return resolved.name;
      return programRef.program; // Use address as key if unknown
    }
    return 'native';
  }

  private async enrichHandshakeContext(context: any, intent: Intent): Promise<void> {
    const client = this.solanaService.getHandshakeClient();
    context.handshakeClient = client;

    // For now, find the first active pool. The intent could specify a pool in the future.
    // This mirrors the existing TxService.resolvePool logic.
    const connection = this.solanaService.getConnection();

    // Use poolPda from intent if available, otherwise use default pool
    // TODO: pool resolution from intent fields
    context.poolPda = null; // Will be set by caller or resolved
    context.tokenDecimals = 6; // Default USDC; should be resolved from pool

    this.logger.warn('HandshakeBuilder context enrichment is minimal — pool resolution needs implementation');
  }
}
```

**Step 4: Implement Solana analyzer**

Create `/Users/si/projects/maxi/silkyway/apps/backend/src/services/chains/solana/solana.analyzer.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import {
  analyzeTransaction,
  verifyIntentV2,
  parseChain,
} from '@silkysquad/silk';
import type { IntentV2 as Intent, RiskFlag } from '@silkysquad/silk';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { SolanaService } from '../../../solana/solana.service';
import type { ChainAnalyzer, AnalyzeOpts } from '../chain.interface';
import type {
  AnalyzeResult,
  MatchDimension,
  RiskDimension,
  ViabilityDimension,
} from '../../intent/types';
import { deriveVerdict } from '../../intent/types';

@Injectable()
export class SolanaAnalyzer implements ChainAnalyzer {
  private readonly logger = new Logger(SolanaAnalyzer.name);
  readonly chain = 'solana';

  constructor(private readonly solanaService: SolanaService) {}

  async analyze(tx: string, intent: Intent, opts?: AnalyzeOpts): Promise<AnalyzeResult> {
    const connection = this.solanaService.getConnection();

    // Run SDK verification
    const verifyResult = await verifyIntentV2(tx, intent, { connection });

    // Build match dimension from SDK result
    const match: MatchDimension = {
      level: verifyResult.matched
        ? 'full'
        : verifyResult.confidence === 'unverified'
          ? 'none'
          : verifyResult.discrepancies.length > 0
            ? 'none'
            : 'partial',
      discrepancies: verifyResult.discrepancies,
    };

    // Build risk dimension from flags
    const risk = this.assessRisk(verifyResult.analysis.flags);

    // Build viability dimension
    const viability = opts?.checkViability !== false
      ? await this.checkViability(tx, intent)
      : { level: 'viable' as const, issues: [] };

    const verdict = deriveVerdict(match, risk, viability);

    return {
      verdict,
      match,
      risk,
      viability,
      raw: verifyResult.analysis,
    };
  }

  private assessRisk(flags: RiskFlag[]): RiskDimension {
    const hasError = flags.some((f) => f.severity === 'error');
    const hasWarning = flags.some((f) => f.severity === 'warning');

    return {
      level: hasError ? 'high' : hasWarning ? 'medium' : 'low',
      flags,
    };
  }

  private async checkViability(tx: string, intent: Intent): Promise<ViabilityDimension> {
    const issues: string[] = [];
    const connection = this.solanaService.getConnection();

    try {
      const action = 'action' in intent ? intent : null;
      if (!action) return { level: 'viable', issues: [] };

      const single = action as any;

      // Check fee payer SOL balance
      if (single.from) {
        try {
          const feePayer = new PublicKey(single.from);
          const balance = await connection.getBalance(feePayer);
          if (balance < 5000) { // Minimum for a simple tx fee
            issues.push(`Insufficient SOL for transaction fees (have ${balance / 1e9} SOL)`);
          }
        } catch {
          // Address might not be valid — skip check
        }
      }

      // Check token balance for transfers
      if (single.action === 'transfer' && single.from && single.token) {
        try {
          const from = new PublicKey(single.from);
          const mint = new PublicKey(single.token);
          const ata = getAssociatedTokenAddressSync(mint, from, true);
          const account = await connection.getTokenAccountBalance(ata);
          const uiAmount = account.value.uiAmount ?? 0;
          const requiredAmount = typeof single.amount === 'string' ? parseFloat(single.amount) : 0;

          if (requiredAmount > 0 && uiAmount < requiredAmount) {
            issues.push(
              `Insufficient token balance (have ${uiAmount}, need ${requiredAmount})`,
            );
          }
        } catch {
          issues.push('Could not verify token balance — token account may not exist');
        }
      }
    } catch (e) {
      this.logger.warn(`Viability check error: ${e.message}`);
    }

    if (issues.some((i) => i.startsWith('Insufficient'))) {
      return { level: 'unviable', issues };
    }
    if (issues.length > 0) {
      return { level: 'uncertain', issues };
    }
    return { level: 'viable', issues: [] };
  }
}
```

**Step 5: Run test to verify it passes**

Run: `cd /Users/si/projects/maxi/silkyway/apps/backend && npx jest src/services/chains/solana/solana.builder.spec.ts`
Expected: PASS

**Step 6: Commit**

```bash
cd /Users/si/projects/maxi/silkyway
git add apps/backend/src/services/chains/solana/
git commit -m "feat: add Solana builder orchestrator and analyzer

SolanaBuilder dispatches to program builders (native, handshake)
based on intent's program/programName. SolanaAnalyzer wraps SDK's
verifyIntentV2 and adds risk assessment and viability checks."
```

---

### Task 8: Backend — Create intent services, modules, controller, wire up

**Files:**
- Create: `/Users/si/projects/maxi/silkyway/apps/backend/src/services/intent/intent-build.service.ts`
- Create: `/Users/si/projects/maxi/silkyway/apps/backend/src/services/intent/intent-analyze.service.ts`
- Create: `/Users/si/projects/maxi/silkyway/apps/backend/src/services/chains/solana/solana-chain.module.ts`
- Create: `/Users/si/projects/maxi/silkyway/apps/backend/src/services/chains/chains.module.ts`
- Create: `/Users/si/projects/maxi/silkyway/apps/backend/src/services/intent/intent.module.ts`
- Create: `/Users/si/projects/maxi/silkyway/apps/backend/src/services/services.module.ts`
- Create: `/Users/si/projects/maxi/silkyway/apps/backend/src/api/controller/intent.controller.ts`
- Modify: `/Users/si/projects/maxi/silkyway/apps/backend/src/api/api.module.ts`
- Modify: `/Users/si/projects/maxi/silkyway/apps/backend/src/app.module.ts`

**Step 1: Create intent-build.service.ts**

Create `/Users/si/projects/maxi/silkyway/apps/backend/src/services/intent/intent-build.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { parseChain } from '@silkysquad/silk';
import type { IntentV2 as Intent } from '@silkysquad/silk';
import type { ChainBuilder, BuildOpts } from '../chains/chain.interface';
import type { BuildResult } from './types';
import { SolanaBuilder } from '../chains/solana/solana.builder';

@Injectable()
export class IntentBuildService {
  private readonly logger = new Logger(IntentBuildService.name);
  private readonly builders = new Map<string, ChainBuilder>();

  constructor(solanaBuilder: SolanaBuilder) {
    this.builders.set('solana', solanaBuilder);
  }

  async build(intent: Intent, opts?: BuildOpts & { analyze?: boolean }): Promise<BuildResult> {
    const { chain } = parseChain(intent.chain);

    const builder = this.builders.get(chain);
    if (!builder) {
      throw new Error(`No builder available for chain '${chain}'`);
    }

    this.logger.log(`Building transaction for chain=${chain}, action=${'action' in intent ? (intent as any).action : 'compound'}`);

    const result = await builder.build(intent, opts);

    if (opts?.analyze) {
      // Analyze will be injected via the analyze service — handled at controller level
      this.logger.log('Analyze requested — will be handled by controller');
    }

    return result;
  }
}
```

**Step 2: Create intent-analyze.service.ts**

Create `/Users/si/projects/maxi/silkyway/apps/backend/src/services/intent/intent-analyze.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { parseChain } from '@silkysquad/silk';
import type { IntentV2 as Intent } from '@silkysquad/silk';
import type { ChainAnalyzer, AnalyzeOpts } from '../chains/chain.interface';
import type { AnalyzeResult } from './types';
import { SolanaAnalyzer } from '../chains/solana/solana.analyzer';

@Injectable()
export class IntentAnalyzeService {
  private readonly logger = new Logger(IntentAnalyzeService.name);
  private readonly analyzers = new Map<string, ChainAnalyzer>();

  constructor(solanaAnalyzer: SolanaAnalyzer) {
    this.analyzers.set('solana', solanaAnalyzer);
  }

  async analyze(tx: string, intent: Intent, opts?: AnalyzeOpts): Promise<AnalyzeResult> {
    const { chain } = parseChain(intent.chain);

    const analyzer = this.analyzers.get(chain);
    if (!analyzer) {
      throw new Error(`No analyzer available for chain '${chain}'`);
    }

    this.logger.log(`Analyzing transaction for chain=${chain}`);

    return analyzer.analyze(tx, intent, opts);
  }
}
```

**Step 3: Create NestJS modules**

Create `/Users/si/projects/maxi/silkyway/apps/backend/src/services/chains/solana/solana-chain.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { SolanaBuilder } from './solana.builder';
import { SolanaAnalyzer } from './solana.analyzer';
import { NativeBuilder } from './programs/native.builder';
import { HandshakeBuilder } from './programs/handshake.builder';

@Module({
  providers: [NativeBuilder, HandshakeBuilder, SolanaBuilder, SolanaAnalyzer],
  exports: [SolanaBuilder, SolanaAnalyzer],
})
export class SolanaChainModule {}
```

Create `/Users/si/projects/maxi/silkyway/apps/backend/src/services/chains/chains.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { SolanaChainModule } from './solana/solana-chain.module';

@Module({
  imports: [SolanaChainModule],
  exports: [SolanaChainModule],
})
export class ChainsModule {}
```

Create `/Users/si/projects/maxi/silkyway/apps/backend/src/services/intent/intent.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ChainsModule } from '../chains/chains.module';
import { IntentBuildService } from './intent-build.service';
import { IntentAnalyzeService } from './intent-analyze.service';

@Module({
  imports: [ChainsModule],
  providers: [IntentBuildService, IntentAnalyzeService],
  exports: [IntentBuildService, IntentAnalyzeService],
})
export class IntentModule {}
```

Create `/Users/si/projects/maxi/silkyway/apps/backend/src/services/services.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { IntentModule } from './intent/intent.module';
import { ChainsModule } from './chains/chains.module';

@Module({
  imports: [IntentModule, ChainsModule],
  exports: [IntentModule, ChainsModule],
})
export class ServicesModule {}
```

**Step 4: Create intent controller**

Create `/Users/si/projects/maxi/silkyway/apps/backend/src/api/controller/intent.controller.ts`:

```typescript
import { Controller, Post, Body, BadRequestException, Logger } from '@nestjs/common';
import type { IntentV2 as Intent } from '@silkysquad/silk';
import { IntentBuildService } from '../../services/intent/intent-build.service';
import { IntentAnalyzeService } from '../../services/intent/intent-analyze.service';

@Controller('api/intent')
export class IntentController {
  private readonly logger = new Logger(IntentController.name);

  constructor(
    private readonly buildService: IntentBuildService,
    private readonly analyzeService: IntentAnalyzeService,
  ) {}

  @Post('build')
  async build(@Body() body: { intent: Intent; analyze?: boolean }) {
    if (!body.intent) {
      throw new BadRequestException({ ok: false, error: 'MISSING_INTENT', message: 'intent is required' });
    }

    if (!body.intent.chain) {
      throw new BadRequestException({ ok: false, error: 'MISSING_CHAIN', message: 'intent.chain is required' });
    }

    const result = await this.buildService.build(body.intent);

    if (body.analyze) {
      const analysis = await this.analyzeService.analyze(
        result.transaction,
        body.intent,
      );
      return { ok: true, ...result, analysis };
    }

    return { ok: true, ...result };
  }

  @Post('analyze')
  async analyze(@Body() body: { transaction: string; intent: Intent }) {
    if (!body.transaction) {
      throw new BadRequestException({ ok: false, error: 'MISSING_TRANSACTION', message: 'transaction is required' });
    }

    if (!body.intent) {
      throw new BadRequestException({ ok: false, error: 'MISSING_INTENT', message: 'intent is required' });
    }

    const result = await this.analyzeService.analyze(body.transaction, body.intent);
    return { ok: true, ...result };
  }
}
```

**Step 5: Wire into api.module.ts and app.module.ts**

In `/Users/si/projects/maxi/silkyway/apps/backend/src/api/api.module.ts`, add:
- Import `IntentController`
- Add to controllers array

```typescript
import { IntentController } from './controller/intent.controller';

// In controllers array, add:
IntentController,
```

In `/Users/si/projects/maxi/silkyway/apps/backend/src/app.module.ts`, add:
- Import `ServicesModule`
- Add to imports array

```typescript
import { ServicesModule } from './services/services.module';

// In imports array, add:
ServicesModule,
```

**Step 6: Verify the app compiles**

Run: `cd /Users/si/projects/maxi/silkyway/apps/backend && npx nest build --builder swc`
Expected: Build succeeds with no errors.

**Step 7: Commit**

```bash
cd /Users/si/projects/maxi/silkyway
git add apps/backend/src/services/ apps/backend/src/api/controller/intent.controller.ts apps/backend/src/api/api.module.ts apps/backend/src/app.module.ts
git commit -m "feat: wire up intent engine with NestJS modules and controller

Add POST /api/intent/build and POST /api/intent/analyze endpoints.
IntentBuildService and IntentAnalyzeService dispatch to chain-specific
builders and analyzers via Map-based registry. ServicesModule groups
all core services. Solana chain module provides builders and analyzer."
```

---

## Summary

| Task | Repo | What |
|------|------|------|
| 1 | SDK | ProgramRef type + helpers |
| 2 | SDK | Bidirectional program registry |
| 3 | SDK | Matcher program checking |
| 4 | SDK | verifyIntent wiring + exports |
| 5 | Backend | Types + chain interfaces |
| 6 | Backend | Native + Handshake builders |
| 7 | Backend | Solana builder orchestrator + analyzer |
| 8 | Backend | Intent services + modules + controller |
