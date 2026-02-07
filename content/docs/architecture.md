# Architecture

> System design, PDA structure, and token flow for the Silkyway escrow protocol.

<!-- last-updated: 2026-02-07 -->
<!-- relates-to: docs/instructions.md, reference/accounts.md -->

## Overview

Silkyway is a programmable escrow protocol on Solana. Senders lock tokens into a pool-managed escrow. Recipients claim after a configurable time lock. Senders can cancel before the claim window opens.

## Program Accounts

### Pool
- Manages a group of transfers for a specific token
- Configurable fee (basis points)
- Tracks total transfers created and resolved

### Transfer
- Created when a sender locks tokens
- Holds: sender, recipient, amount, time lock, status
- Status: Active → Claimed | Cancelled | Expired

## PDA Structure

```
Pool PDA:       [b"pool", pool_id]
Transfer PDA:   [b"transfer", pool, sender, nonce]
Sender PDA:     [b"sender", pool, sender_pubkey]
Recipient PDA:  [b"recipient", pool, recipient_pubkey]
```

## Token Flow

```
Sender Wallet → [create_transfer] → Pool Vault (escrow)
Pool Vault    → [claim_transfer]  → Recipient Wallet
Pool Vault    → [cancel_transfer] → Sender Wallet (refund)
```

## Fee Model

Fees are deducted from the transfer amount at creation time. The fee percentage is configured per pool in basis points (1 bps = 0.01%).
