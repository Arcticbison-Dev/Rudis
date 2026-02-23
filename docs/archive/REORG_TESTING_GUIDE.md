# Blockchain Reorganization (Reorg) Testing Guide

This document provides procedures for testing block reorganization handling in the Altostratus Payments system.

## Overview

A blockchain reorganization occurs when the network discards one or more blocks and replaces them with a different chain. This can cause:
- Confirmations to decrease or reset
- Previously confirmed transactions to become unconfirmed
- Double-spend attacks (in malicious scenarios)

Our system must handle reorgs gracefully to prevent:
- Crediting payments that get reversed
- Missing payments that re-confirm
- Inconsistent state between invoice status and actual blockchain

---

## Bitcoin Reorg Testing

### Option 1: Bitcoin Regtest (Recommended)

Regtest is a private test network where you control block mining.

#### Setup

```bash
# Start Bitcoin Core in regtest mode
bitcoind -regtest -daemon -rpcuser=test -rpcpassword=test

# Create wallet
bitcoin-cli -regtest createwallet "test"

# Mine initial blocks (need 100+ for spendable coinbase)
bitcoin-cli -regtest generatetoaddress 101 $(bitcoin-cli -regtest getnewaddress)
```

#### Configure Rail

```bash
# .env for rail-btc
BTC_NETWORK=regtest
MEMPOOL_API_BASE=http://localhost:3006/api  # If running mempool locally
# Or use direct RPC for regtest
BTC_RPC_URL=http://test:test@localhost:18443
```

#### Simulate Reorg

```bash
# Step 1: Create invoice and get address
ADDRESS=$(curl -s -X POST http://localhost:5000/payments \
  -H "Content-Type: application/json" \
  -d '{"rail":"btc","amount_sats":10000,"description":"Reorg test"}' \
  | jq -r '.payment_address')

# Step 2: Send payment
TXID=$(bitcoin-cli -regtest sendtoaddress $ADDRESS 0.0001)

# Step 3: Mine 3 blocks (should trigger confirmation)
bitcoin-cli -regtest generatetoaddress 3 $(bitcoin-cli -regtest getnewaddress)

# Verify invoice shows confirmed
curl http://localhost:5000/payments/{invoice_id}

# Step 4: Invalidate blocks to simulate reorg
BLOCKHASH=$(bitcoin-cli -regtest getbestblockhash)
bitcoin-cli -regtest invalidateblock $BLOCKHASH

# Step 5: Verify confirmations dropped
# Invoice should revert to pending or show reduced confirmations

# Step 6: Reconsider the block (or mine new chain)
bitcoin-cli -regtest reconsiderblock $BLOCKHASH
# OR mine a competing chain without the payment
```

#### Expected Behavior

| Scenario | Expected Result |
|----------|-----------------|
| Confirmations drop below threshold | Invoice reverts to `pending` |
| Transaction disappears from chain | Invoice stays `pending`, alert generated |
| Transaction re-confirms | Invoice re-confirms, duplicate webhook suppressed |

---

### Option 2: Bitcoin Signet

Signet is a public test network with controlled block production.

#### Setup

```bash
# Start Bitcoin Core in signet mode
bitcoind -signet -daemon

# Get coins from signet faucet
# https://signetfaucet.com/
```

#### Configure Rail

```bash
BTC_NETWORK=signet
MEMPOOL_API_BASE=https://mempool.space/signet/api
```

#### Note on Reorg Testing

Signet rarely has reorgs since block production is controlled. You cannot easily simulate reorgs on signet. Use regtest for reorg testing.

---

### Option 3: Bitcoin Testnet

Testnet occasionally has natural reorgs but they're unpredictable.

#### Configure Rail

```bash
BTC_NETWORK=testnet
MEMPOOL_API_BASE=https://mempool.space/testnet/api
```

#### Monitor for Natural Reorgs

```bash
# Watch for reorgs via mempool.space API
curl https://mempool.space/testnet/api/blocks | jq '.[].height'

# If heights go backward or duplicate, a reorg occurred
```

---

## Monero Reorg Testing

Monero uses a different consensus mechanism and reorgs are extremely rare (CryptoNote protocol).

### Setup Stagenet

```bash
# Start monerod in stagenet mode
monerod --stagenet --detach

# Start wallet RPC
monero-wallet-rpc --stagenet \
  --wallet-file /path/to/wallet \
  --rpc-bind-port 18082 \
  --rpc-login user:pass \
  --confirm-external-bind
```

### Configure Rail

```bash
XMR_RPC_HOST=127.0.0.1
XMR_RPC_PORT=18082
XMR_RPC_USERNAME=user
XMR_RPC_PASSWORD=pass
XMR_CONFIRMATIONS_REQUIRED=10
```

### Simulating Confirmation Changes

Monero doesn't have easy reorg simulation. Instead, test:

1. **Confirmation counting**: Create payment, verify confirmations increment
2. **Threshold behavior**: Set `XMR_CONFIRMATIONS_REQUIRED=2` for faster testing
3. **Manual state reset**: Use admin API to reset invoice state

```bash
# Reset invoice for re-testing (admin only)
curl -X POST http://localhost:5000/admin/invoices/{id}/reset \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

---

## Lightning Network Reorg Considerations

Lightning Network payments are **atomic** - they either complete or fail. There is no confirmation period and no reorg risk for settled payments.

However, the underlying Bitcoin channel opens/closes can experience reorgs. This is handled by the LN node (LNbits/LND), not our system.

### What We Test

1. **Invoice expiry**: BOLT11 invoices expire and cannot be paid
2. **Duplicate payment protection**: Idempotent payment handling
3. **Webhook reliability**: Late webhooks are processed correctly

---

## Automated Reorg Test Script (Regtest)

Create `test-reorg.sh`:

```bash
#!/bin/bash
# Requires: Bitcoin Core in regtest mode, rail-btc configured for regtest

set -e

API_URL="${API_URL:-http://localhost:5000}"
BITCOIN_CLI="bitcoin-cli -regtest"

echo "=== Reorg Test Suite ==="

# 1. Create invoice
echo "Creating invoice..."
RESPONSE=$(curl -s -X POST "$API_URL/payments" \
  -H "Content-Type: application/json" \
  -d '{"rail":"btc","amount_sats":10000,"description":"Reorg test"}')

INVOICE_ID=$(echo "$RESPONSE" | jq -r '.id')
ADDRESS=$(echo "$RESPONSE" | jq -r '.payment_address')

echo "Invoice: $INVOICE_ID"
echo "Address: $ADDRESS"

# 2. Send payment
echo "Sending payment..."
TXID=$($BITCOIN_CLI sendtoaddress "$ADDRESS" 0.0001)
echo "TXID: $TXID"

# 3. Mine blocks to confirm
echo "Mining 3 blocks..."
$BITCOIN_CLI generatetoaddress 3 $($BITCOIN_CLI getnewaddress) > /dev/null

# 4. Wait for detection
sleep 5

# 5. Check status
echo "Checking status..."
STATUS=$(curl -s "$API_URL/payments/$INVOICE_ID" | jq -r '.status')
echo "Status: $STATUS"

if [ "$STATUS" != "confirmed" ] && [ "$STATUS" != "paid" ]; then
  echo "ERROR: Expected confirmed/paid, got $STATUS"
  exit 1
fi

# 6. Simulate reorg
echo "Simulating reorg (invalidating last block)..."
BLOCKHASH=$($BITCOIN_CLI getbestblockhash)
$BITCOIN_CLI invalidateblock "$BLOCKHASH"

# 7. Wait for detection
sleep 10

# 8. Check if status reverted
NEW_STATUS=$(curl -s "$API_URL/payments/$INVOICE_ID" | jq -r '.status')
echo "Status after reorg: $NEW_STATUS"

# 9. Reconsider block
echo "Reconsider block..."
$BITCOIN_CLI reconsiderblock "$BLOCKHASH"

sleep 5

FINAL_STATUS=$(curl -s "$API_URL/payments/$INVOICE_ID" | jq -r '.status')
echo "Final status: $FINAL_STATUS"

echo "=== Reorg Test Complete ==="
```

---

## Reorg Handling Implementation

### Current Behavior

The system continuously monitors confirmations for active payments:

```typescript
// rail-btc/src/index.ts (simplified)
async function checkAddress(address: string) {
  const response = await axios.get(`${MEMPOOL_API_BASE}/address/${address}/txs`);
  // Returns current confirmations from blockchain
  return { confirmations: tx.status.block_height ? tipHeight - tx.status.block_height + 1 : 0 };
}
```

### Reorg Detection

When confirmations decrease:

1. **State Update**: Payment state changes from `confirmed` -> `pending`
2. **Alert Generated**: Monitoring system logs the reorg event
3. **Webhook Held**: No duplicate webhook sent until re-confirmed
4. **Admin Notified**: Alert webhook fires if configured

### Edge Cases

| Scenario | Handling |
|----------|----------|
| Confirmations drop from 6 to 2 | Revert to `pending`, wait for 6 again |
| Transaction disappears entirely | Keep monitoring address for new tx |
| Different txid appears | Process as new payment (rare) |
| Block reorg during polling interval | Caught on next poll cycle |

---

## Verification Checklist

- [ ] Invoice reverts to pending when confirmations drop
- [ ] No duplicate webhook on re-confirmation
- [ ] Admin alert fires on reorg detection
- [ ] Metrics track reorg events
- [ ] State persists across service restarts
- [ ] Edge case: tx disappears then re-appears

---

## Related Documentation

- [CRYPTO_PAYMENT_POLICY.md](./CRYPTO_PAYMENT_POLICY.md) - Reorg handling policy
- [OPERATIONS_GUIDE.md](./OPERATIONS_GUIDE.md) - Monitoring and alerting
- [test-btc-e2e.sh](../test-btc-e2e.sh) - Bitcoin E2E test suite
