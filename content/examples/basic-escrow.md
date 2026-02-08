# Examples

> Real CLI commands for common Silkyway patterns. All examples use the `silk` CLI on devnet.

<!-- last-updated: 2026-02-08 -->
<!-- relates-to: skill.md -->

## Simple payment

The 80% case — send USDC, recipient claims it.

```bash
# Sender: pay 25 USDC
silk pay 7xKXz9BpR3mFVDg2Thh3AG6sFRPqNrDJ4bHUkR8Y7vNx 25 --memo "Payment for services"
# → Transfer PDA: 9aE5kBqR...

# Recipient: claim it
silk claim 9aE5kBqRvF3mNcXz8BpR3mFVDg2Thh3AG6sFRPqNrDJ4
# → USDC deposited to wallet
```

## Cancel a payment

Sent to the wrong address? Changed your mind? Cancel anytime before the recipient claims.

```bash
# Sender: pay 10 USDC
silk pay 7xKXz9BpR3mFVDg2Thh3AG6sFRPqNrDJ4bHUkR8Y7vNx 10 --memo "Tentative"
# → Transfer PDA: 4bHUkR8Y...

# Sender: cancel — full refund
silk cancel 4bHUkR8YvF3mNcXz8BpR3mFVDg2Thh3AG6sFRPqNrDJ4

# Verify
silk payments get 4bHUkR8YvF3mNcXz8BpR3mFVDg2Thh3AG6sFRPqNrDJ4
# → status: CANCELLED
```

## Time-locked payment

Create an approval window — the recipient can't claim until a timestamp you set. Useful for "pay after 24h if no dispute" patterns.

```bash
# Pay 50 USDC, claimable after 24 hours from now
silk pay 7xKXz9BpR3mFVDg2Thh3AG6sFRPqNrDJ4bHUkR8Y7vNx 50 \
  --memo "Milestone payment" \
  --claimable-after $(date -v+24H +%s)

# Recipient tries to claim immediately → fails with ClaimTooEarly
# Recipient claims after 24h → succeeds
# Sender can cancel anytime before the claim happens
```

## Multi-wallet testing

Set up both sides on one machine to test the full round-trip.

```bash
# Create and fund two wallets
silk wallet create sender
silk wallet create receiver
silk wallet fund --wallet sender
silk wallet fund --wallet receiver

# Send from sender to receiver
silk pay $(silk wallet list --json | jq -r '.[] | select(.label=="receiver") | .address') 5 \
  --memo "Round-trip test" --wallet sender

# List incoming payments as receiver
silk payments list --wallet receiver

# Claim as receiver
silk claim <transfer-pda> --wallet receiver
```

## API-direct example

Skip the CLI — build, sign, and submit using curl and the HTTP API.

```bash
# 1. Build an unsigned create_transfer transaction
curl -s -X POST https://silkyway.ai/api/tx/create-transfer \
  -H "Content-Type: application/json" \
  -d '{
    "sender": "BrKz4GQN1sxZWoGLbNTojp4G3JCFLRkSYk3mSRWhKsXp",
    "recipient": "7xKXz9BpR3mFVDg2Thh3AG6sFRPqNrDJ4bHUkR8Y7vNx",
    "amount": 10.00,
    "token": "usdc",
    "memo": "API direct payment"
  }'
# → { "ok": true, "data": { "transaction": "<base64>", "transferPda": "..." } }

# 2. Sign the base64 transaction locally (with your private key)
#    The SDK handles this automatically; for raw API usage you'd
#    deserialize, sign with your keypair, and re-serialize.

# 3. Submit the signed transaction
curl -s -X POST https://silkyway.ai/api/tx/submit \
  -H "Content-Type: application/json" \
  -d '{ "signedTx": "<base64-signed-transaction>" }'
# → { "ok": true, "data": { "txid": "5UfDuX..." } }

# 4. Check transfer status
curl -s https://silkyway.ai/api/transfers/9aE5kBqRvF3mNcXz8BpR3mFVDg2Thh3AG6sFRPqNrDJ4
# → { "ok": true, "data": { "transfer": { "status": "ACTIVE", ... } } }
```

See the [full API reference](../skill.md) for all endpoints, error codes, and response formats.
