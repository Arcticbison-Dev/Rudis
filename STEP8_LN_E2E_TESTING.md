# Step 8: End-to-End Drills (LNbits Rail)

## Overview
This document provides comprehensive end-to-end testing procedures for the Lightning Network payment rail integration. These tests verify the complete payment lifecycle from invoice creation through payment confirmation, including failure scenarios.

---

## Prerequisites

### 1. LNbits Setup
You need a working LNbits instance (either self-hosted or cloud-based):

**Option A: Self-Hosted LNbits**
```bash
# Clone and run LNbits (requires LND/CLN backend)
git clone https://github.com/lnbits/lnbits.git
cd lnbits
pip install -r requirements.txt
uvicorn lnbits.__main__:app --port 5001
```

**Option B: Cloud LNbits**
- Use https://legend.lnbits.com (free tier available)
- Or any other hosted LNbits instance

### 2. Required Environment Variables

Set these in Replit Secrets or `.env`:

```bash
# Enable Lightning Network
ENABLE_LN=true

# LNbits Configuration (from your LNbits dashboard)
LNBITS_API_URL=https://your-lnbits-instance.com    # Your LNbits API endpoint
LNBITS_WALLET_KEY=your_invoice_read_key_here        # Invoice/read key from wallet
LNBITS_WALLET_ID=your_wallet_id_here                # Optional: wallet ID

# Webhook Configuration (for this Replit app)
LNBITS_WEBHOOK_URL=https://your-replit-app.replit.app/rails/ln/webhook/YOUR_SECRET
LNBITS_WEBHOOK_SECRET=$(openssl rand -hex 32)       # Generate 64-char random string

# Admin API Token
ADMIN_API_TOKEN=$(openssl rand -hex 32)             # For admin endpoints

# Rail Authentication
RAIL_AUTH_TOKEN=$(openssl rand -hex 32)             # For internal callbacks
```

### 3. Lightning Wallet
You need a Lightning wallet to pay test invoices:
- **Phoenix Wallet** (iOS/Android) - Recommended for testing
- **Wallet of Satoshi** (iOS/Android) - Beginner-friendly
- **Zeus** (iOS/Android) - Self-custodial
- **LNbits Wallet** (Web) - If using same LNbits instance

---

## Test 1: Create LN Payment (Happy Path)

### 1.1 Create Invoice via API

**Request:**
```bash
curl -X POST https://your-replit-app.replit.app/payments \
  -H "Content-Type: application/json" \
  -d '{
    "rail": "ln",
    "amount_sats": 100,
    "currency": "BTC",
    "description": "Test LN Invoice #1",
    "expires_in_seconds": 3600
  }'
```

**Expected Response:**
```json
{
  "id": "pay_abc123...",
  "rail": "ln",
  "asset": "BTC",
  "amount_atomic": "100",
  "status": "pending",
  "invoice_bolt11": "lnbc1000n1p...",
  "created_at": "2025-11-20T12:00:00.000Z",
  "expires_at": "2025-11-20T13:00:00.000Z"
}
```

### 1.2 Verify Database State

**Check Invoice in Storage:**

```bash
# Using admin API
curl -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  "https://your-replit-app.replit.app/admin/invoices/pay_abc123"
```

**Expected Fields:**
```json
{
  "id": "pay_abc123",
  "rail": "ln",
  "status": "pending",
  "amount_atomic": "100",
  "invoice_bolt11": "lnbc1000n1p...",
  "ln_checking_id": "abc123def456...",     // Internal LNbits ID
  "ln_payment_hash": "64-char-hex-hash",   // Payment preimage hash
  "created_at": "2025-11-20T12:00:00.000Z",
  "expires_at": "2025-11-20T13:00:00.000Z",
  "paid_at": null
}
```

**Verify:**
- ✅ Invoice row inserted with `status='pending'`
- ✅ `rail='ln'` (stored as `currency='Lightning'` in DB)
- ✅ `bolt11Invoice` contains valid BOLT11 string
- ✅ `lnCheckingId` populated (LNbits invoice ID)
- ✅ `lnPaymentHash` populated (64-char hex)
- ✅ `expiresAt` is ~1 hour in future
- ✅ `paidAt` is null

### 1.3 Verify Public API Response

**Public API should NOT expose internal fields:**

```bash
# Public endpoint (no auth required)
curl https://your-replit-app.replit.app/api/invoices/pay_abc123
```

**Expected Response (FILTERED):**
```json
{
  "id": "pay_abc123",
  "currency": "Lightning",
  "asset": "BTC",
  "amount": "100",
  "status": "pending",
  "bolt11Invoice": "lnbc1000n1p...",
  "createdAt": "2025-11-20T12:00:00.000Z",
  "expiresAt": "2025-11-20T13:00:00.000Z"
}
```

**Verify:**
- ✅ `bolt11Invoice` included (users need this)
- ❌ `lnCheckingId` NOT present (internal metadata)
- ❌ `lnPaymentHash` NOT present (internal metadata)

---

## Test 2: Pay Invoice & Detect Payment

### 2.1 Pay the Invoice

**Using Lightning Wallet:**

1. **Copy BOLT11 invoice** from API response:
   ```
   lnbc1000n1p...
   ```

2. **Open Lightning wallet** (Phoenix, Wallet of Satoshi, etc.)

3. **Paste invoice** and send payment

4. **Wait 1-3 seconds** for confirmation

### 2.2 Verify Webhook Fired (Primary Detection)

**Check application logs:**

```bash
# Look for webhook received event
grep "webhook.received" /tmp/logs/Start_application_*.log
```

**Expected Log:**
```json
{
  "ts": "2025-11-20T12:01:00.000Z",
  "level": "info",
  "event": "webhook.received",
  "rail": "LN",
  "checking_id": "abc123def456",
  "pending": 0,
  "amount_msat": 100000
}
```

**Then payment confirmed:**
```json
{
  "ts": "2025-11-20T12:01:00.100Z",
  "level": "info",
  "event": "payment.confirmed",
  "id": "pay_abc123",
  "rail": "LN",
  "amount_atomic": "100",
  "via": "webhook"
}
```

**Verify:**
- ✅ Webhook endpoint received POST request
- ✅ `checking_id` matched invoice
- ✅ `pending=0` indicates paid
- ✅ Payment confirmed via webhook

### 2.3 Verify Polling Fallback (If Webhook Missed)

**If webhook fails, polling should detect payment:**

```bash
# Look for polling detection
grep "poll.payment_detected" /tmp/logs/Start_application_*.log
```

**Expected Log:**
```json
{
  "ts": "2025-11-20T12:01:10.000Z",
  "level": "info",
  "event": "poll.payment_detected",
  "rail": "LN",
  "checking_id": "abc123def456",
  "amount_msat": 100000
}
```

**Verify:**
- ✅ Polling runs every 10 seconds (default)
- ✅ Detects paid invoices even if webhook missed
- ✅ Idempotent (safe to detect same payment twice)

### 2.4 Verify Payment Transaction Row

**Check payment_transactions table:**

```bash
curl -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  "https://your-replit-app.replit.app/admin/invoices/pay_abc123"
```

**Expected `transactions` Array:**
```json
{
  "id": "pay_abc123",
  "status": "confirmed",
  "transactions": [
    {
      "id": "tx_xyz789",
      "invoice_id": "pay_abc123",
      "type": "lightning_payment",
      "amount_atomic": "100",
      "tx_hash": "64-char-payment-hash",
      "detected_at": "2025-11-20T12:01:00.000Z",
      "confirmations": null,
      "explorer_url": null
    }
  ]
}
```

**Verify:**
- ✅ `payment_transactions` row created
- ✅ Linked to correct invoice (`invoice_id`)
- ✅ `type='lightning_payment'`
- ✅ `amount_atomic` matches invoice amount
- ✅ `tx_hash` contains payment hash
- ✅ `detected_at` timestamp present

### 2.5 Verify Invoice Status Updated

**Check invoice status in DB:**

```bash
curl https://your-replit-app.replit.app/payments/pay_abc123
```

**Expected Response:**
```json
{
  "id": "pay_abc123",
  "rail": "ln",
  "status": "confirmed",
  "amount_atomic": "100",
  "amount_paid_atomic": "100",
  "paid_at": "2025-11-20T12:01:00.000Z",
  "invoice_bolt11": "lnbc1000n1p..."
}
```

**Verify:**
- ✅ `status='confirmed'` (was `pending`)
- ✅ `paid_at` timestamp populated
- ✅ `amount_paid_atomic` equals `amount_atomic`
- ✅ `GET /payments/:id` shows `status='confirmed'`

---

## Test 3: Failure Scenario (Config Errors)

### 3.1 Break LNbits Configuration

**Temporarily break config to test error handling:**

```bash
# Option A: Invalid API URL
export LNBITS_API_URL=https://invalid-url-that-does-not-exist.com

# Option B: Invalid wallet key
export LNBITS_WALLET_KEY=invalid_key_12345

# Restart application
# (Replit auto-restarts when secrets change)
```

### 3.2 Verify LN Worker Logs Errors

**Check polling worker logs:**

```bash
grep "poll_failed" /tmp/logs/Start_application_*.log
```

**Expected Log:**
```json
{
  "ts": "2025-11-20T12:05:00.000Z",
  "level": "error",
  "event": "poll_failed",
  "rail": "LN",
  "error": "LNbits network error: getaddrinfo ENOTFOUND invalid-url-that-does-not-exist.com"
}
```

**OR (for auth errors):**
```json
{
  "ts": "2025-11-20T12:05:00.000Z",
  "level": "error",
  "event": "poll_failed",
  "rail": "LN",
  "error": "LNbits API error: 401 Unauthorized"
}
```

**Verify:**
- ✅ Worker logs `poll_failed` events
- ✅ Error details included (but no secrets exposed)
- ✅ Worker continues running (doesn't crash)
- ✅ Retries every poll interval

### 3.3 Verify Health Endpoint Shows Degraded

**Check system health:**

```bash
curl https://your-replit-app.replit.app/health
```

**Expected Response:**
```json
{
  "status": "degraded",
  "timestamp": "2025-11-20T12:05:00.000Z",
  "rails": {
    "LN": {
      "status": "error",
      "last_successful_poll": "2025-11-20T12:04:50.000Z",
      "last_error": "LNbits network error: getaddrinfo ENOTFOUND...",
      "consecutive_failures": 3
    }
  }
}
```

**Verify:**
- ✅ Overall status is `degraded` (not `healthy`)
- ✅ LN rail shows `status='error'`
- ✅ Last error message included
- ✅ Consecutive failure count tracked

### 3.4 Verify Alerts Triggered

**Check alert logs:**

```bash
grep "alert.triggered" /tmp/logs/Start_application_*.log
```

**Expected Alert:**
```json
{
  "ts": "2025-11-20T12:05:00.000Z",
  "level": "alert",
  "event": "alert.triggered",
  "condition": "ln_poll_failed",
  "rail": "LN",
  "details": "LN polling failed 3 consecutive times",
  "threshold": 3,
  "current_value": 3
}
```

**Verify:**
- ✅ Alert triggered after N consecutive failures (default: 3)
- ✅ Alert condition identified
- ✅ Threshold and current value logged

### 3.5 Verify System Doesn't Crash

**Check application still running:**

```bash
curl https://your-replit-app.replit.app/health
# Should return 200 OK (even if degraded)
```

**Check other rails unaffected (if enabled):**

```bash
# BTC rail should still work (if enabled)
curl -X POST https://your-replit-app.replit.app/payments \
  -H "Content-Type: application/json" \
  -d '{"rail": "btc", "amount_sats": 10000, "currency": "BTC"}'

# Should succeed even though LN is broken
```

**Verify:**
- ✅ Application still running
- ✅ Health endpoint responds (status 200)
- ✅ LN rail marked as degraded/error
- ✅ Other rails (BTC/XMR) still operational
- ✅ No uncaught exceptions or crashes

### 3.6 Restore Configuration

**Fix the broken config:**

```bash
# Restore correct values
export LNBITS_API_URL=https://your-correct-lnbits-instance.com
export LNBITS_WALLET_KEY=your_correct_invoice_read_key

# Wait for next poll cycle (~10 seconds)
```

**Verify recovery:**

```bash
curl https://your-replit-app.replit.app/health
```

**Expected Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-11-20T12:06:00.000Z",
  "rails": {
    "LN": {
      "status": "healthy",
      "last_successful_poll": "2025-11-20T12:06:00.000Z",
      "last_error": null,
      "consecutive_failures": 0
    }
  }
}
```

**Look for recovery alert:**
```json
{
  "ts": "2025-11-20T12:06:00.000Z",
  "level": "info",
  "event": "alert.recovered",
  "condition": "ln_poll_failed",
  "rail": "LN",
  "details": "LN polling recovered after 5 failures"
}
```

**Verify:**
- ✅ Status returns to `healthy`
- ✅ `consecutive_failures` resets to 0
- ✅ Recovery alert logged
- ✅ System fully operational again

---

## Test 4: Expired Invoice Scenario

### 4.1 Create Short-Lived Invoice

**Create invoice with 30-second expiry:**

```bash
curl -X POST https://your-replit-app.replit.app/payments \
  -H "Content-Type: application/json" \
  -d '{
    "rail": "ln",
    "amount_sats": 50,
    "currency": "BTC",
    "description": "Expiry Test",
    "expires_in_seconds": 30
  }'
```

### 4.2 Wait for Expiration

**Wait 35 seconds** (past expiry time)

### 4.3 Verify Invoice Marked Expired

**Check invoice status:**

```bash
curl https://your-replit-app.replit.app/payments/pay_xyz789
```

**Expected Response:**
```json
{
  "id": "pay_xyz789",
  "rail": "ln",
  "status": "expired",
  "amount_atomic": "50",
  "created_at": "2025-11-20T12:10:00.000Z",
  "expires_at": "2025-11-20T12:10:30.000Z"
}
```

**Verify:**
- ✅ `status='expired'` (automatically updated)
- ✅ Invoice no longer payable
- ✅ Expiry check runs periodically

### 4.4 Attempt to Pay Expired Invoice

**Try paying with Lightning wallet:**

**Expected:**
- ⚠️ LNbits rejects payment (invoice expired)
- ⚠️ Wallet shows error: "Invoice expired" or similar

**Verify:**
- ✅ Expired invoices cannot be paid
- ✅ System correctly handles late payments
- ✅ No payment transaction created

---

## Test 5: Webhook Security

### 5.1 Test Webhook Authentication

**Attempt webhook call with wrong token:**

```bash
curl -X POST https://your-replit-app.replit.app/rails/ln/webhook/WRONG_TOKEN \
  -H "Content-Type: application/json" \
  -d '{
    "checking_id": "test123",
    "payment_hash": "'$(printf '%064d' 0)'",
    "pending": 0,
    "amount": 1000
  }'
```

**Expected Response:**
```json
{
  "error": "Unauthorized"
}
```

**Expected Status Code:** `401 Unauthorized`

**Verify:**
- ✅ Webhook rejected (invalid token)
- ✅ Returns 401 Unauthorized
- ✅ No payment processed

### 5.2 Test Webhook Input Validation

**Send malformed payload:**

```bash
# Test 1: Array instead of object
curl -X POST https://your-replit-app.replit.app/rails/ln/webhook/YOUR_SECRET \
  -H "Content-Type: application/json" \
  -d '[]'

# Expected: 400 "Invalid webhook payload"

# Test 2: Invalid checking_id format
curl -X POST https://your-replit-app.replit.app/rails/ln/webhook/YOUR_SECRET \
  -H "Content-Type: application/json" \
  -d '{
    "checking_id": "../../../etc/passwd",
    "payment_hash": "abc",
    "pending": 0
  }'

# Expected: 400 "Invalid webhook payload"

# Test 3: Invalid payment_hash format
curl -X POST https://your-replit-app.replit.app/rails/ln/webhook/YOUR_SECRET \
  -H "Content-Type: application/json" \
  -d '{
    "checking_id": "test123",
    "payment_hash": "not-a-valid-hash",
    "pending": 0
  }'

# Expected: 400 "Invalid webhook payload"
```

**Verify:**
- ✅ Malformed payloads rejected (400 Bad Request)
- ✅ Invalid formats rejected (prevents injection)
- ✅ Type validation works (strings, numbers)

---

## Automated Test Script

### test-ln-e2e.sh

```bash
#!/bin/bash
set -e

# Configuration
API_URL="${API_URL:-https://your-replit-app.replit.app}"
ADMIN_TOKEN="${ADMIN_API_TOKEN}"

echo "========================================="
echo "Lightning Network E2E Test Suite"
echo "========================================="
echo ""

# Test 1: Create Invoice
echo "[Test 1] Creating LN invoice..."
RESPONSE=$(curl -s -X POST "$API_URL/payments" \
  -H "Content-Type: application/json" \
  -d '{
    "rail": "ln",
    "amount_sats": 100,
    "currency": "BTC",
    "description": "E2E Test Invoice"
  }')

PAYMENT_ID=$(echo "$RESPONSE" | jq -r '.id')
BOLT11=$(echo "$RESPONSE" | jq -r '.invoice_bolt11')

echo "✓ Invoice created: $PAYMENT_ID"
echo "✓ BOLT11: ${BOLT11:0:50}..."
echo ""

# Test 2: Verify DB State
echo "[Test 2] Verifying database state..."
DB_RESPONSE=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$API_URL/admin/invoices/$PAYMENT_ID")

STATUS=$(echo "$DB_RESPONSE" | jq -r '.status')
CHECKING_ID=$(echo "$DB_RESPONSE" | jq -r '.ln_checking_id')

if [ "$STATUS" = "pending" ] && [ -n "$CHECKING_ID" ]; then
  echo "✓ Status: $STATUS"
  echo "✓ Checking ID: $CHECKING_ID"
else
  echo "✗ Invalid DB state!"
  exit 1
fi
echo ""

# Test 3: Public API Filtering
echo "[Test 3] Verifying public API filtering..."
PUBLIC_RESPONSE=$(curl -s "$API_URL/api/invoices/$PAYMENT_ID")

HAS_BOLT11=$(echo "$PUBLIC_RESPONSE" | jq -r '.bolt11Invoice')
HAS_CHECKING_ID=$(echo "$PUBLIC_RESPONSE" | jq -r '.lnCheckingId')

if [ -n "$HAS_BOLT11" ] && [ "$HAS_CHECKING_ID" = "null" ]; then
  echo "✓ BOLT11 exposed (correct)"
  echo "✓ Checking ID hidden (correct)"
else
  echo "✗ Public API leaking internal fields!"
  exit 1
fi
echo ""

# Test 4: Pay Invoice (Manual Step)
echo "[Test 4] PAY THIS INVOICE:"
echo ""
echo "  $BOLT11"
echo ""
echo "Use your Lightning wallet to pay this invoice."
echo "Press ENTER after payment completes..."
read

# Test 5: Verify Payment Confirmed
echo "[Test 5] Verifying payment confirmation..."
sleep 2  # Wait for webhook/polling

CONFIRM_RESPONSE=$(curl -s "$API_URL/payments/$PAYMENT_ID")
CONFIRM_STATUS=$(echo "$CONFIRM_RESPONSE" | jq -r '.status')
PAID_AT=$(echo "$CONFIRM_RESPONSE" | jq -r '.paid_at')

if [ "$CONFIRM_STATUS" = "confirmed" ] && [ "$PAID_AT" != "null" ]; then
  echo "✓ Status: confirmed"
  echo "✓ Paid at: $PAID_AT"
else
  echo "✗ Payment not confirmed! Status: $CONFIRM_STATUS"
  exit 1
fi
echo ""

# Test 6: Verify Transaction Row
echo "[Test 6] Verifying payment transaction..."
TX_RESPONSE=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$API_URL/admin/invoices/$PAYMENT_ID")

TX_COUNT=$(echo "$TX_RESPONSE" | jq -r '.transactions | length')

if [ "$TX_COUNT" -gt 0 ]; then
  echo "✓ Transaction row created"
  TX_ID=$(echo "$TX_RESPONSE" | jq -r '.transactions[0].id')
  echo "✓ Transaction ID: $TX_ID"
else
  echo "✗ No payment transaction found!"
  exit 1
fi
echo ""

# Test 7: Health Check
echo "[Test 7] Checking system health..."
HEALTH_RESPONSE=$(curl -s "$API_URL/health")
HEALTH_STATUS=$(echo "$HEALTH_RESPONSE" | jq -r '.status')
LN_STATUS=$(echo "$HEALTH_RESPONSE" | jq -r '.rails.LN.status')

echo "✓ Overall: $HEALTH_STATUS"
echo "✓ LN Rail: $LN_STATUS"
echo ""

echo "========================================="
echo "All Tests Passed! ✓"
echo "========================================="
```

**Usage:**
```bash
chmod +x test-ln-e2e.sh
export API_URL=https://your-replit-app.replit.app
export ADMIN_API_TOKEN=your_admin_token_here
./test-ln-e2e.sh
```

---

## Success Criteria Checklist

### Happy Path ✓
- [ ] POST /payments creates LN invoice
- [ ] DB row inserted with status='pending', rail='ln'
- [ ] Response contains valid BOLT11 invoice
- [ ] lnCheckingId and lnPaymentHash populated
- [ ] Public API hides internal fields
- [ ] Admin API shows internal fields

### Payment Detection ✓
- [ ] Webhook fires when invoice paid
- [ ] OR polling detects payment (fallback)
- [ ] payment_transactions row created
- [ ] Invoice status → 'confirmed'
- [ ] paid_at timestamp set
- [ ] GET /payments/:id shows status='confirmed'

### Failure Scenario ✓
- [ ] Breaking LNBITS_API_URL logs poll_failed
- [ ] Breaking LNBITS_WALLET_KEY logs poll_failed
- [ ] /health shows LN as degraded/error
- [ ] Alert triggered after N failures
- [ ] System continues running (no crash)
- [ ] Other rails unaffected
- [ ] Recovery works when config fixed

### Security ✓
- [ ] Webhook requires valid token
- [ ] Invalid token returns 401
- [ ] Malformed payloads rejected (400)
- [ ] Invalid formats rejected (prevents injection)
- [ ] Public API filters sensitive fields
- [ ] Admin API requires authentication

---

## Next Steps

1. **Set up LNbits** if not already configured
2. **Configure environment variables** with real credentials
3. **Run automated test script** to verify all scenarios
4. **Monitor logs** during testing for errors
5. **Document any issues** found during testing
6. **Fix bugs** and re-test until all pass

---

## Troubleshooting

### Webhook Not Firing

**Symptoms:**
- Payment confirmed in LNbits
- But application doesn't detect it immediately
- Polling eventually detects (10+ seconds delay)

**Solutions:**
1. Check `LNBITS_WEBHOOK_URL` is correct
2. Verify webhook registered in LNbits dashboard
3. Check application logs for webhook errors
4. Test webhook manually with curl

### Polling Not Working

**Symptoms:**
- Payments never detected
- poll_failed errors in logs

**Solutions:**
1. Check `LNBITS_API_URL` is correct and reachable
2. Verify `LNBITS_WALLET_KEY` has Invoice/read permissions
3. Check firewall/network connectivity
4. Test LNbits API manually with curl

### Invoice Creation Fails

**Symptoms:**
- POST /payments returns 500 error
- "Failed to create invoice" message

**Solutions:**
1. Check LNbits has sufficient outbound liquidity
2. Verify wallet has channels open
3. Check amount within min/max limits
4. Review LNbits logs for errors

---

## Conclusion

This comprehensive test suite validates:
1. ✅ Invoice creation and DB persistence
2. ✅ Dual-path payment detection (webhook + polling)
3. ✅ Proper status transitions (pending → confirmed)
4. ✅ Transaction history tracking
5. ✅ Error handling and resilience
6. ✅ Security and input validation
7. ✅ Public API privacy (filtered responses)
8. ✅ Admin API access control

Once all tests pass, the Lightning Network integration is **production-ready**.
