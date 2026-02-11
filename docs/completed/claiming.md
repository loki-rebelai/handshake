# Claim Links — Implementation Plan

## Overview

Add claim link generation to the SDK `pay` command and improve the frontend transfer detail page with state-aware instructions, cluster query param support, and better 404 handling.

---

## Task 1: SDK — Add `getClaimUrl` helper to config

**File:** `packages/sdk/src/config.ts`

Add a function that constructs the claim URL from a transferPda and the current cluster config.

```typescript
const APP_BASE_URL = 'https://app.silkyway.so';

export function getClaimUrl(config: SilkConfig, transferPda: string): string {
  const base = `${APP_BASE_URL}/transfers/${transferPda}`;
  const cluster = getCluster(config);
  return cluster === 'devnet' ? `${base}?cluster=devnet` : base;
}
```

**Verification:** Import works from pay.ts, no type errors.

---

## Task 2: SDK — Add `claimUrl` to pay command output

**File:** `packages/sdk/src/commands/pay.ts`

Import `getClaimUrl` and `loadConfig` (already imported). After the transaction is submitted, construct and include the claim URL in the output.

**Current code (line 39):**
```typescript
outputSuccess({ action: 'pay', transferPda, txid, amount: amountNum, recipient });
```

**New code:**
```typescript
const claimUrl = getClaimUrl(config, transferPda);
outputSuccess({ action: 'pay', transferPda, txid, amount: amountNum, recipient, claimUrl });
```

Add the import of `getClaimUrl` to the existing import from `'../config.js'` on line 3.

**Verification:** Run `silk pay --help` to check no import errors. In JSON mode, output includes `claimUrl` field. In human mode, `claimUrl` prints as a line.

---

## Task 3: Frontend — Accept `?cluster=devnet` query param

**File:** `apps/app/src/contexts/ClusterContext.tsx`

Update `ClusterProvider` to read a `cluster` query param from the URL on mount and apply it. This lets claim links with `?cluster=devnet` automatically switch the app to the right cluster.

**Current `ClusterProvider` (lines 41-55):**
```typescript
export function ClusterProvider({ children }: { children: ReactNode }) {
  const [cluster, setClusterState] = useState<SolanaCluster>(readStoredCluster);

  const setCluster = useCallback((c: SolanaCluster) => {
    localStorage.setItem(STORAGE_KEY, c);
    setClusterState(c);
  }, []);
  // ...
```

**New code — add a `useEffect` after the `setCluster` callback that reads the URL param:**
```typescript
export function ClusterProvider({ children }: { children: ReactNode }) {
  const [cluster, setClusterState] = useState<SolanaCluster>(readStoredCluster);

  const setCluster = useCallback((c: SolanaCluster) => {
    localStorage.setItem(STORAGE_KEY, c);
    setClusterState(c);
  }, []);

  // Apply ?cluster=devnet from URL (e.g., claim links)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const urlCluster = params.get('cluster');
    if (urlCluster === 'devnet' || urlCluster === 'mainnet-beta') {
      setCluster(urlCluster);
    }
  }, [setCluster]);
  // ...
```

Add `useEffect` to the existing import from `'react'` on line 3.

**Verification:** Navigate to `/transfers/somepda?cluster=devnet` — cluster toggle in header should switch to devnet. Without the param, it stays on whatever was previously stored.

---

## Task 4: Frontend — State-aware instructions on transfer detail page

**File:** `apps/app/src/app/transfers/[pda]/page.tsx`

Add an instruction banner between the details card and actions section. The banner content depends on the viewer's state.

**States and messages:**

| State | Condition | Message |
|---|---|---|
| No wallet | `!isConnected` | "Connect your wallet to claim or manage this transfer." |
| Recipient + Active | `isRecipient && isActive` | "This payment is for you. Claim it below." |
| Sender + Active | `isSender && isActive` | "You sent this payment. You can cancel it if it hasn't been claimed." |
| Third party | `isConnected && !isSender && !isRecipient` | "You're viewing a transfer between other parties." |
| Non-active (any) | `!isActive` | No instruction banner (the StatusBadge already communicates this). |

**Implementation — add a new `InstructionBanner` component** at the bottom of the file:
```typescript
function InstructionBanner({ isConnected, isSender, isRecipient, isActive }: {
  isConnected: boolean;
  isSender: boolean;
  isRecipient: boolean;
  isActive: boolean;
}) {
  if (!isActive) return null;

  let message: string;
  if (!isConnected) {
    message = 'Connect your wallet to claim or manage this transfer.';
  } else if (isRecipient) {
    message = 'This payment is for you. Claim it below.';
  } else if (isSender) {
    message = 'You sent this payment. You can cancel it if it hasn\'t been claimed.';
  } else {
    message = 'You\'re viewing a transfer between other parties.';
  }

  return (
    <div className="mb-6 border border-nebula-purple/20 bg-nebula-purple/[0.04] px-6 py-4">
      <p className="text-[0.8rem] text-star-white/60">{message}</p>
    </div>
  );
}
```

**Place it** in the main return, after the details card and before the transactions card (between lines 155 and 157):
```tsx
      {/* Instructions */}
      <InstructionBanner
        isConnected={isConnected}
        isSender={isSender}
        isRecipient={isRecipient}
        isActive={isActive}
      />
```

Also make the share link visible to recipients (not just senders) when the transfer is active, so they can re-share. **Current condition (line 170):**
```tsx
{isSender && isActive && (
```
Keep this as-is — share link is sender-only per original design.

**Verification:** Visit `/transfers/{pda}` in four states: disconnected, as sender, as recipient, as third party. Verify correct banner appears.

---

## Task 5: Frontend — Improve 404 / "Not Found" messaging

**File:** `apps/app/src/app/transfers/[pda]/page.tsx`

Update the existing `!transfer` block (lines 93-105) with better messaging.

**Current code:**
```tsx
<h2 className="font-display text-2xl font-black uppercase tracking-wide text-star-white">Not Found</h2>
<p className="mt-2 text-[0.85rem] text-star-white/50">This transfer does not exist or has been removed.</p>
```

**New code:**
```tsx
<h2 className="font-display text-2xl font-black uppercase tracking-wide text-star-white">Payment Not Found</h2>
<p className="mt-2 text-[0.85rem] text-star-white/50">This payment may have already been claimed or cancelled.</p>
```

**Verification:** Navigate to `/transfers/invalidpda` — should show the updated message.

---

## Task 6: Backend — On-chain verification for ACTIVE transfers

**File:** `apps/backend/src/api/controller/transfer.controller.ts`

When the DB returns a transfer with status `ACTIVE`, verify the on-chain PDA still exists. If the PDA is gone, the transfer was resolved outside our system — return 404.

`SolanaModule` is `@Global()`, so `SolanaService` is injectable without module changes.

**Updated `getTransfer` method:**
```typescript
import { SolanaService } from '../../solana/solana.service';

// Add to constructor:
constructor(
  private readonly transferService: TransferService,
  private readonly solanaService: SolanaService,
) {}

// Updated method:
@Get(':pda')
async getTransfer(@Param('pda') pda: string) {
  try {
    new PublicKey(pda);
  } catch {
    throw new BadRequestException({ ok: false, error: 'INVALID_PUBKEY', message: 'pda is not a valid public key' });
  }

  const transfer = await this.transferService.findByPda(pda);
  if (!transfer) {
    throw new NotFoundException({ ok: false, error: 'NOT_FOUND', message: 'Transfer not found' });
  }

  // For ACTIVE transfers, verify the on-chain PDA still exists
  if (transfer.status === TransferStatus.ACTIVE) {
    const handshake = this.solanaService.getHandshakeClient();
    const onChain = await handshake.fetchTransfer(new PublicKey(pda));
    if (!onChain) {
      throw new NotFoundException({ ok: false, error: 'NOT_FOUND', message: 'Transfer not found' });
    }
  }

  return { ok: true, data: { transfer } };
}
```

Add imports: `SolanaService` from `'../../solana/solana.service'` and `TransferStatus` from `'../../db/models/Transfer'`.

**Verification:** Query `GET /api/transfers/{pda}` for an ACTIVE transfer — should succeed if PDA exists on-chain. For a stale ACTIVE record (PDA closed), should return 404.

---

## Execution Order

1. **Task 1** (SDK config helper) — no dependencies
2. **Task 2** (SDK pay output) — depends on Task 1
3. **Task 3** (Frontend cluster param) — no dependencies, can run in parallel with 1-2
4. **Task 4** (Frontend instructions) — no dependencies, can run in parallel
5. **Task 5** (Frontend 404 message) — no dependencies, can run in parallel
6. **Task 6** (Backend verification) — no dependencies, can run in parallel

**Parallel batches:**
- Batch 1: Tasks 1, 3, 4, 5, 6 (all independent)
- Batch 2: Task 2 (depends on Task 1)
