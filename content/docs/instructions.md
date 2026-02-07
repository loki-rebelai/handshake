# Instructions

> All Silkyway program instructions with parameters.

<!-- last-updated: 2026-02-07 -->
<!-- relates-to: docs/architecture.md, docs/api-reference.md -->

## create_transfer

Lock tokens into escrow for a recipient.

| Parameter | Type | Description |
|-----------|------|-------------|
| `amount` | u64 | Token amount in base units |
| `memo` | String | Optional memo |
| `claimable_after` | i64 | Unix timestamp when recipient can claim |

**Accounts:** sender, recipient, pool, pool vault, sender token account, system program, token program

## claim_transfer

Recipient claims tokens after the time lock expires.

| Parameter | Type | Description |
|-----------|------|-------------|
| (none) | | |

**Accounts:** recipient, transfer, pool, pool vault, recipient token account, token program

## cancel_transfer

Sender cancels and reclaims tokens (only before recipient claims).

| Parameter | Type | Description |
|-----------|------|-------------|
| (none) | | |

**Accounts:** sender, transfer, pool, pool vault, sender token account, token program
