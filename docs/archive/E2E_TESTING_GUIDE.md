# End-to-End Testing Guide

This guide provides detailed procedures for testing each payment rail in testnet/regtest environments. Each test should be executed **exactly once per rail** to verify the complete payment flow.

## Prerequisites

Before testing any rail, ensure:
1. Payment rail service is running and healthy
2. RAIL_AUTH_TOKEN is configured and matching on both services
3. ALTOSTRATUS_WEBHOOK_URL is configured (test with RequestBin or similar)
4. ALT_WEBHOOK_SECRET is configured for webhook verification

## Lightning Network (LN) End-to-End Test

### Setup Requirements
- LN node running in testnet/regtest mode
- Lightning wallet for making test payments
- Channel with sufficient outbound liquidity

### Test Procedure

#### 1. Create Lightning Invoice
```bash
curl -X POST http://localhost:5000/api/invoices \
  -H "Content-Type: application/json" \
  -d '{
    "amount": "0.00001000",
    "currency": "Lightning",
    "description": "E2E Test - Lightning Payment",
    "paymentAddress": "test@test.com",
    "expiresAt": "'$(date -u -d '+1 hour' +%Y-%m-%dT%H:%M:%SZ)'"
  }'
```

Response should include:
- `id`: Invoice UUID
- `status`: "pending"
- `bolt11Invoice`: BOLT11 payment request string

#### 2. Generate BOLT11 via Rail Service
The rail-ln service should have generated the BOLT11 invoice. Verify:
```bash
# Check rail-ln health
curl http://localhost:5001/health

# The invoice should contain the BOLT11 string
```

#### 3. Pay Invoice with Wallet
- Scan QR code or copy BOLT11 invoice string
- Pay from Lightning wallet
- Verify payment settles in wallet

#### 4. Verify Settlement Callback
Monitor rail-ln logs for settlement detection:
```
{ invoiceId: "...", rail: "ln", event: "settled", status: "confirmed" }
```

#### 5. Verify Invoice Status Update
```bash
curl http://localhost:5000/api/invoices/{invoice_id}
```

Expected response:
- `status`: "paid"
- `paidAt`: timestamp
- `paymentSource`: "rail-ln" (if implemented)

#### 6. Verify Webhook to Altostratus
Check RequestBin/webhook receiver for:
- POST request received
- `X-Altostratus-Signature` header present
- Payload contains: `invoiceId`, `amount`, `currency`, `status`, `paidAt`, `transactionId`
- HMAC signature validates with ALT_WEBHOOK_SECRET

### Edge Cases

#### Test: Invoice Expiry
1. Create invoice with `expiresAt` 2 minutes in future
2. Wait for expiration
3. Attempt payment
4. **Expected**: Payment should fail (BOLT11 expired)
5. Verify invoice status becomes "expired"

#### Test: MPP (Multi-Path Payments)
**Decision Required**: Document whether MPP is accepted or rejected.

**Recommendation**: Accept MPP, as it's standard Lightning behavior.

**Test Procedure**:
1. Create invoice
2. Pay using MPP-capable wallet
3. Verify settlement triggers callback correctly
4. **Expected**: Payment settles normally regardless of paths used

#### Test: Channel Liquidity Error
1. Create invoice for amount exceeding channel capacity
2. Attempt payment
3. **Expected**: Wallet shows "insufficient route" or similar
4. **Expected**: Invoice remains in "pending" state
5. **UX Recommendation**: Show "Payment failed - please try smaller amount" message

---

## Bitcoin On-Chain End-to-End Test

### Setup Requirements
- Bitcoin Core node in testnet/regtest mode
- Testnet faucet access or regtest mining capability
- xpub configured in rail-btc service (BIP84 recommended)

### Configuration
```bash
# In rail-btc/.env
BTC_CONFIRMATIONS_REQUIRED=2
XPUB=tpub... # testnet xpub
```

### Test Procedure

#### 1. Create Bitcoin Invoice
```bash
curl -X POST http://localhost:5000/api/invoices \
  -H "Content-Type: application/json" \
  -d '{
    "amount": "0.00050000",
    "currency": "BTC",
    "description": "E2E Test - Bitcoin On-Chain",
    "paymentAddress": "test@test.com",
    "expiresAt": "'$(date -u -d '+24 hours' +%Y-%m-%dT%H:%M:%SZ)'"
  }'
```

#### 2. Verify Address Derivation
- Rail-btc should derive new address from xpub
- **Critical**: Each invoice must have unique address (no reuse)
- Verify `derivedAddress` field is populated

#### 3. Send Bitcoin Payment
```bash
# From Bitcoin wallet or Core
bitcoin-cli -testnet sendtoaddress {derived_address} 0.0005
```

#### 4. Monitor Mempool Detection
Rail-btc should detect unconfirmed transaction:
```
Transaction detected in mempool for invoice {id}
Waiting for 2 confirmations...
```

#### 5. Mine Blocks (Regtest) or Wait (Testnet)
```bash
# Regtest only
bitcoin-cli -regtest generatetoaddress 2 {your_address}
```

#### 6. Verify Confirmation Callback
After CONFIRMATIONS_REQUIRED reached:
```json
{ "invoiceId": "...", "rail": "btc", "event": "confirmed", "status": "confirmed" }
```

#### 7. Verify Transaction Details
```bash
curl http://localhost:5000/api/invoices/{invoice_id}/transactions
```

Expected:
- `transactionId`: Bitcoin txid
- `confirmations`: ≥ CONFIRMATIONS_REQUIRED
- `blockHeight`: Block number

### Edge Cases

#### Test: Underpayment
**Decision Required**: Accept with accumulation or reject?

**Recommendation**: Reject and show manual review UI.

**Test Procedure**:
1. Create invoice for 0.001 BTC
2. Send 0.0005 BTC (50% underpayment)
3. **Expected**: Invoice remains "pending"
4. **Expected**: Admin sees "Underpayment detected: 0.0005/0.001 BTC received"
5. **Action**: Admin manually processes refund or accepts partial

#### Test: Overpayment
1. Create invoice for 0.001 BTC
2. Send 0.0015 BTC (50% overpayment)
3. **Expected**: Invoice marked "paid"
4. **Expected**: System logs overpayment amount
5. **Policy**: Document whether overpayment is kept as credit or refunded

#### Test: Late Payment to Expired Invoice
1. Create invoice with 1-hour expiration
2. Wait for expiration
3. Send payment anyway
4. **Expected**: Payment callback returns 400 "Invoice has expired"
5. **Expected**: Status shows "late-paid" (requires new status in schema)
6. **Action**: Admin manually reviews and processes

#### Test: Blockchain Reorg
**Rare but critical**

1. Payment receives 2 confirmations → invoice marked "paid"
2. Blockchain reorgs, confirmations drop to 0
3. **Expected**: Rail-btc detects reorg
4. **Expected**: Invoice status reverted to "pending"
5. **Expected**: Wait for confirmations to reach threshold again
6. **Implementation Note**: Monitor `confirmations` field, revert if drops below threshold

---

## Monero (XMR) End-to-End Test

### Setup Requirements
- Monero Wallet RPC running in stagenet/testnet mode
- Wallet with view key access
- Monero node synced

### Configuration
```bash
# In rail-xmr/.env
XMR_CONFIRMATIONS_REQUIRED=10
WALLET_RPC_URL=http://localhost:28088/json_rpc
WALLET_RPC_USER=rpc
WALLET_RPC_PASSWORD=secret
```

### Test Procedure

#### 1. Create Monero Invoice
```bash
curl -X POST http://localhost:5000/api/invoices \
  -H "Content-Type: application/json" \
  -d '{
    "amount": "0.50000000",
    "currency": "XMR",
    "description": "E2E Test - Monero Payment",
    "paymentAddress": "test@test.com",
    "expiresAt": "'$(date -u -d '+24 hours' +%Y-%m-%dT%H:%M:%SZ)'"
  }'
```

#### 2. Verify Subaddress Creation
- Rail-xmr creates unique subaddress via Wallet RPC
- **Critical**: Each invoice gets unique subaddress
- Verify `subaddress` field populated with `4...` address

#### 3. Send Monero Payment
```bash
# From Monero wallet
./monero-wallet-cli --stagenet
> transfer {subaddress} 0.5
```

#### 4. Monitor Transaction Pool
Rail-xmr detects incoming transaction:
```
XMR transfer detected for invoice {id}
Amount: 0.5 XMR
Confirmations: 0/10
```

#### 5. Wait for Confirmations
Monero blocks are ~2 minutes each, so 10 confirmations = ~20 minutes.

Monitor progress:
```
Confirmations: 5/10...
Confirmations: 10/10 ✓
```

#### 6. Verify Confirmation Callback
```json
{
  "invoiceId": "...",
  "rail": "xmr",
  "event": "confirmed",
  "status": "confirmed"
}
```

#### 7. Restart Rail Service Test
**Critical for Monero**:

1. Stop rail-xmr service
2. Restart rail-xmr service
3. Verify it re-scans wallet and detects previous payment
4. **Expected**: Invoice remains in "paid" status
5. **Expected**: No duplicate payment callbacks

### Edge Cases

#### Test: Multiple Transfers to Same Subaddress
1. Create invoice for 1.0 XMR
2. Send 0.5 XMR from Wallet A
3. Send 0.5 XMR from Wallet B (same subaddress)
4. **Expected**: Rail-xmr accumulates: 0.5 + 0.5 = 1.0 XMR
5. **Expected**: Invoice marked "paid" when total reaches 1.0 XMR

#### Test: View Key Scanning After Restart
1. Create invoice and receive payment while service running
2. Create second invoice
3. Stop service
4. Send payment to second invoice
5. Restart service
6. **Expected**: Service scans from last known block height
7. **Expected**: Second invoice detected and marked paid

---

## Success Criteria

For each rail, all tests must pass:

✓ Invoice creation succeeds  
✓ Unique payment target generated (BOLT11/address/subaddress)  
✓ Payment detected by rail service  
✓ Callback authenticated and processed  
✓ Invoice status updated to "paid"  
✓ Transaction details recorded  
✓ Webhook sent to Altostratus with valid HMAC  
✓ All edge cases handled gracefully  
✓ No PII logged (only invoiceId, rail, event, status)  

## Debugging Tips

### Payment Not Detected
1. Check rail service health endpoint
2. Verify RAIL_AUTH_TOKEN matches on both services
3. Check rail service logs for errors
4. Confirm blockchain node is synced
5. Verify wallet/node connectivity

### Callback Rejected
1. Check RAIL_AUTH_TOKEN in Authorization header
2. Verify invoice exists and is not already paid
3. Check invoice not expired
4. Review structured logs for error details

### Webhook Not Received
1. Verify ALTOSTRATUS_WEBHOOK_URL is accessible
2. Check webhook logs in database
3. Confirm ALT_WEBHOOK_SECRET configured
4. Look for retry attempts in logs

## Performance Benchmarks

Document actual timings:

| Rail | Detection Time | Confirmation Time | Total Time |
|------|---------------|-------------------|------------|
| LN   | <1 second     | <1 second         | ~1 second  |
| BTC  | ~10 seconds   | ~20 minutes (2 conf) | ~20 min |
| XMR  | ~2 minutes    | ~20 minutes (10 conf) | ~22 min |

## Next Steps

After completing all tests:
1. Document any edge case policies decided during testing
2. Update rail service documentation with actual behavior
3. Create runbook for production deployment
4. Set up monitoring alerts based on observed metrics
5. Train support team on common issues and resolutions
