# Lightning Network Canary Rollout Plan (Corrected)

**Version:** 2.0 (Corrected)  
**Date:** 2025-11-07  
**Target:** Phase 0 Testnet Deployment  
**Estimated Duration:** 48-72 hours

---

## Pre-Deployment Requirements

**Before starting, ensure:**
- [ ] All Priority 1 fixes from `CANARY_ROLLOUT_ANALYSIS.md` completed
- [ ] Payments service has `/health` endpoint
- [ ] LND node running on testnet with channels
- [ ] 3 testers identified with Lightning wallets

---

## 1. Pre-Flight Checklist (5 minutes)

### Payments Service Configuration

Access: Replit Secrets for `altostratus-payments`

```env
# Feature Flag
ENABLE_LN=true

# Rail Service Integration
LN_SERVICE_URL=https://<rail-ln-repl>.replit.app
RAIL_AUTH_TOKEN=<64-char-hex-token>

# Webhook to Altostratus Main App
ALTOSTRATUS_WEBHOOK_URL=https://<altostratus>.replit.app/api/payments/webhook
ALT_WEBHOOK_SECRET=<64-char-hex-token>

# Security
SIMULATION_ENABLED=false
ADMIN_SIM_TOKEN=<64-char-hex-token>
```

**Generate tokens:**
```bash
openssl rand -hex 32
```

### rail-ln Service Configuration

Access: Replit Secrets for `rail-ln`

```env
# LND Connection (Testnet)
LN_REST_URL=https://<testnet-lnd>.example.com:8080/v1
LN_MACAROON_HEX=<invoice-macaroon-hex>

# Payments Service Integration (MUST MATCH)
PAYMENTS_SERVICE_URL=https://<payments-repl>.replit.app
RAIL_AUTH_TOKEN=<same-64-char-token-as-payments>

# Invoice Settings
LN_INVOICE_EXPIRY_SEC=1200
LN_ENABLE_MPP=true

# Server
PORT=5001
NODE_ENV=production
```

### Verification Commands

```bash
# Verify tokens match
echo "Payments RAIL_AUTH_TOKEN: $RAIL_AUTH_TOKEN"
echo "rail-ln RAIL_AUTH_TOKEN: $RAIL_AUTH_TOKEN"
# ^ These MUST be identical

# Verify URLs
echo "Payments LN_SERVICE_URL: $LN_SERVICE_URL"
echo "rail-ln PAYMENTS_SERVICE_URL: $PAYMENTS_SERVICE_URL"
# ^ These should point to each other
```

---

## 2. Health Checks (3 minutes)

### Payments Service Health

```bash
curl https://<payments>.replit.app/health
```

**Expected Response (200 OK):**
```json
{
  "status": "healthy",
  "timestamp": "2025-11-07T18:30:00.000Z",
  "version": "1.0.0",
  "storage": "operational",
  "webhooks": "operational"
}
```

**Degraded Response (503):**
```json
{
  "status": "degraded",
  "timestamp": "2025-11-07T18:30:00.000Z",
  "issues": ["webhook_queue_full"]
}
```

### rail-ln Service Health

```bash
curl https://<rail-ln>.replit.app/health
```

**Expected Response (200 OK):**
```json
{
  "status": "healthy",
  "rail": "ln",
  "timestamp": "2025-11-07T18:30:00.000Z",
  "lndConnected": true,
  "mppEnabled": true
}
```

**Misconfigured Response (503):**
```json
{
  "status": "misconfigured",
  "rail": "ln",
  "error": "Missing required environment variables",
  "missingVars": ["LN_MACAROON_HEX"],
  "lndConnected": false
}
```

**LND Disconnected (503):**
```json
{
  "status": "degraded",
  "rail": "ln",
  "lndConnected": false,
  "mppEnabled": true
}
```

### Altostratus Main App

**If applicable, verify:**
- Lightning payment option visible in UI (when `ENABLE_LN=true`)
- Billing page loads without errors
- Webhook endpoint accessible

---

## 3. Tester Setup (10 minutes)

### Tester Requirements

**Wallets (choose one):**
- **Zeus** (mobile/desktop) - connected to testnet/signet
- **Phoenix** (testnet mode)
- **Blue Wallet** (testnet enabled)
- **Breez** (testnet mode)

**Test Plan:**
- Small amount: 10,000 sats (testnet/signet)
- Expiry: 20 minutes (default)
- Expected flow duration: <5 minutes

### Tester Instructions

Send to each tester:

```
Lightning Network Canary Test - Instructions

1. Install a Lightning testnet wallet (Zeus, Phoenix, or Blue Wallet)
2. Ensure you have >10,000 testnet sats
3. Navigate to: <altostratus-url>/billing
4. Select: Crypto → Lightning (LN)
5. Create invoice for test plan
6. Pay within 20 minutes
7. Report any issues immediately

Expected behavior:
- Invoice appears with QR code instantly (<3s)
- Payment settles within 30s
- Status updates automatically
- No refresh required
```

---

## 4. Canary Test Flow (Step-by-Step)

### Step 1: Invoice Creation

**User Action:** Altostratus → Billing → Crypto → Lightning → Create Invoice

**System Flow:**
1. Altostratus calls Payments API: `POST /api/invoices`
2. Payments calls rail-ln: `POST /ln/create`
3. rail-ln creates LND invoice via REST API
4. rail-ln returns BOLT11 to Payments
5. Payments stores invoice and returns to Altostratus

**Expected Timing:** <3 seconds total

**UI Shows:**
- QR code with BOLT11 invoice
- Payment address (hidden, only QR shown)
- Amount and description
- Expiration time: "Expires November 7, 2025 at 6:50 PM"
- Relative time: "expires in 20 minutes"
- Status badge: "Pending"

**Verify in Logs:**
```bash
# rail-ln logs
grep "invoice_create_requested" /var/log/rail-ln.log
# Expected: {"invoiceId":"550e8400-...","rail":"ln","event":"invoice_create_requested"}

grep "invoice_created" /var/log/rail-ln.log
# Expected: {"invoiceId":"550e8400-...","rail":"ln","event":"invoice_created","bolt11":"lntb..."}
```

### Step 2: Payment

**User Action:** Scan QR code with Lightning wallet → Confirm payment

**System Flow:**
1. Wallet decodes BOLT11 invoice
2. Wallet sends payment via Lightning Network
3. Payment routes to testnet LND node
4. LND settles invoice

**Expected Timing:** 1-5 seconds (depends on routing)

### Step 3: Settlement Detection

**System Flow:**
1. rail-ln polls LND every 2 seconds: `GET /v1/invoice/{r_hash}`
2. Detects `state: SETTLED`
3. rail-ln calls Payments: `POST /api/rails/ln/settled`
   ```json
   {
     "invoiceId": "550e8400-...",
     "transactionId": "<payment_hash>",
     "confirmations": 0,
     "blockHeight": null
   }
   ```
4. Payments verifies `Authorization: Bearer <RAIL_AUTH_TOKEN>`
5. Payments marks invoice paid
6. Payments sends webhook to Altostratus (HMAC-signed)

**Expected Timing:** <30 seconds from payment to status update

**Verify in Logs:**
```bash
# rail-ln logs
grep "invoice_settled" /var/log/rail-ln.log
# Expected: {"invoiceId":"550e8400-...","rail":"ln","event":"invoice_settled"}

grep "callback_success" /var/log/rail-ln.log
# Expected: {"invoiceId":"550e8400-...","rail":"ln","event":"callback_success","status":200}

# payments logs
grep "settled" /var/log/payments.log | grep "ln"
# Expected: {"invoiceId":"550e8400-...","rail":"ln","event":"settled","status":"confirmed"}
```

### Step 4: Altostratus Update

**System Flow:**
1. Altostratus receives webhook
2. Verifies HMAC signature (`X-Altostratus-Signature`)
3. Updates subscription to Active
4. Updates payment history

**UI Shows:**
- Status badge: "Paid"
- Paid timestamp
- Subscription: Active
- Payment history updated

---

## 5. Acceptance Criteria (Per Tester)

**Each test MUST pass all criteria:**

- [ ] **Invoice Generation:** BOLT11 generated in ≤3 seconds
- [ ] **UI Display:** QR code visible, countdown shown, no PII exposed
- [ ] **Payment Settlement:** Status updates to "Paid" within ≤30 seconds of wallet confirmation
- [ ] **Subscription Activation:** Subscription immediately toggles to "Active"
- [ ] **Payment History:** Row appears with date, plan, amount, status
- [ ] **Privacy:** No PII in UI (addresses hidden, only QR shown)
- [ ] **Logs Privacy:** No IPs, wallet info, or user agents in logs

**Grading:**
- ✅ All pass: PROCEED to next tester
- ❌ Any fail: STOP, investigate, fix, retry

---

## 6. Edge Case Testing (15 minutes)

### Test 6.1: Expired Invoice

**Steps:**
1. Create invoice
2. Wait >20 minutes (or set `LN_INVOICE_EXPIRY_SEC=60` for faster test)
3. Attempt payment

**Expected Behavior:**
- Wallet rejects payment (invoice expired)
- UI shows "Expired" status
- UI offers "Create New Invoice" button
- rail-ln rejects late payment callback (if somehow occurs)

**Verify:**
```bash
grep "expired" /var/log/payments.log
# Should show rejection if late payment attempted
```

### Test 6.2: Duplicate Callback

**Steps:**
1. Create and pay invoice normally
2. Manually call settlement endpoint again:
   ```bash
   curl -X POST https://payments.replit.app/api/rails/ln/settled \
     -H "Authorization: Bearer $RAIL_AUTH_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "invoiceId": "<paid-invoice-id>",
       "transactionId": "<tx-hash>",
       "confirmations": 0
     }'
   ```

**Expected Behavior:**
- Response: `{ "message": "Invoice already paid" }`
- No duplicate webhook sent
- No double-credit to subscription

**Verify:**
```bash
grep "already_paid" /var/log/payments.log
# Should show idempotency check triggered
```

### Test 6.3: Webhook Retry

**Steps:**
1. Temporarily stop Altostratus main app
2. Create and pay invoice
3. Verify webhook retry behavior
4. Restart Altostratus
5. Confirm webhook eventually delivers

**Expected Behavior:**
- Payments retries webhook with exponential backoff
- Retries: 1s, 3s, 9s delays
- Max 3 attempts (configurable)
- Success on Altostratus restart

**Verify:**
```bash
grep "webhook_retry" /var/log/payments.log
# Should show retry attempts with increasing delays
```

### Test 6.4: Over/Under Payment

**Note:** Lightning invoices enforce exact payment at protocol level

**Expected Behavior:**
- Wallet prevents over/under payment automatically
- No special handling needed
- Document for awareness

---

## 7. Monitoring & Observability (Ongoing)

### Structured Logs to Monitor

**rail-ln Events:**
```bash
# Invoice creation
grep "invoice_create_requested" /var/log/rail-ln.log | wc -l
# Count should increase with each test

# Settlements
grep "invoice_settled" /var/log/rail-ln.log | wc -l
# Should match number of successful payments

# Callback successes/failures
grep "callback_success" /var/log/rail-ln.log | wc -l
grep "callback_failed" /var/log/rail-ln.log | wc -l
# callback_failed should be 0 in normal operation
```

**Payments Events:**
```bash
# Settlements confirmed
grep '"event":"settled"' /var/log/payments.log | grep '"rail":"ln"' | wc -l

# Webhook successes/failures
grep "webhook_sent" /var/log/payments.log | wc -l
grep "webhook_retry" /var/log/payments.log | wc -l
# Retries should be minimal
```

### Metrics to Track (Manual)

Since Prometheus not yet implemented, track manually:

**Metric** | **Target** | **How to Measure**
---|---|---
Invoice creation latency | <3s | Timestamp diff: create_requested → invoice_created
Settlement latency | <30s | Timestamp diff: payment → status=paid
Webhook delivery success rate | >99% | webhook_sent / (webhook_sent + webhook_failed)
PII exposure incidents | 0 | Manual log audit
Duplicate payment incidents | 0 | grep "already_paid" count

### Privacy Audit

**Randomly sample 10 log entries:**
```bash
tail -100 /var/log/rail-ln.log | shuf | head -10
tail -100 /var/log/payments.log | shuf | head -10
```

**Verify logs contain ONLY:**
- ✅ `invoiceId` (UUID)
- ✅ `rail` ("ln")
- ✅ `event` (action name)
- ✅ `timestamp`
- ❌ NO IP addresses
- ❌ NO payment addresses
- ❌ NO wallet identifiers
- ❌ NO user agents
- ❌ NO amounts (optional: amounts OK if needed for debugging)

---

## 8. Troubleshooting Guide

### Issue: BOLT11 Not Generated

**Symptoms:**
- Invoice created but `bolt11Invoice` field is null
- UI shows "Pending" indefinitely
- No QR code displayed

**Diagnosis:**
```bash
# 1. Check rail-ln health
curl https://rail-ln.replit.app/health
# If lndConnected: false → LND issue

# 2. Check rail-ln logs
grep "lnd_invoice_failed" /var/log/rail-ln.log
# Look for LND API errors

# 3. Check LND directly
curl -X GET https://<lnd>:8080/v1/getinfo \
  -H "Grpc-Metadata-macaroon: $LN_MACAROON_HEX"
# Verify LND is reachable
```

**Solutions:**
- Verify `LN_REST_URL` points to correct LND endpoint
- Check macaroon validity: `lncli bakemacaroon invoices:read invoices:write`
- Verify network connectivity (firewall, TLS cert)
- Check LND logs: `tail -f ~/.lnd/logs/bitcoin/testnet/lnd.log`

---

### Issue: Payment Settled But Status Not Changing

**Symptoms:**
- Wallet shows payment successful
- Invoice status remains "Pending"
- No webhook sent to Altostratus

**Diagnosis:**
```bash
# 1. Check settlement detection
grep "invoice_settled" /var/log/rail-ln.log | grep "<invoice-id>"
# If missing → rail-ln not detecting

# 2. Check callback
grep "callback" /var/log/rail-ln.log | grep "<invoice-id>"
# If callback_failed → auth or network issue

# 3. Check payments received callback
grep "settled" /var/log/payments.log | grep "<invoice-id>"
# If missing → callback not reaching payments
```

**Solutions:**
- **If settlement not detected:**
  - Check LND invoice status: `lncli lookupinvoice <r_hash>`
  - Verify rail-ln monitoring is running
  - Check rail-ln polling interval (should be 2s)

- **If callback failed:**
  - Verify `RAIL_AUTH_TOKEN` matches in both services
  - Check `PAYMENTS_SERVICE_URL` is correct
  - Test connectivity: `curl https://payments.replit.app/health`

- **If payments didn't receive:**
  - Check payments logs for auth rejection
  - Verify endpoint: `POST /api/rails/ln/settled` exists
  - Test manually with curl

---

### Issue: Webhook Not Delivered to Altostratus

**Symptoms:**
- Invoice marked "Paid" in Payments
- Subscription not updated in Altostratus
- Payment history not showing

**Diagnosis:**
```bash
# Check webhook attempts
grep "webhook" /var/log/payments.log | grep "<invoice-id>"
# Look for webhook_sent, webhook_retry, webhook_failed

# Check HMAC signing
grep "signature" /var/log/payments.log | grep "<invoice-id>"
```

**Solutions:**
- Verify `ALTOSTRATUS_WEBHOOK_URL` is correct
- Verify `ALT_WEBHOOK_SECRET` matches in both services
- Check Altostratus logs for HMAC verification errors
- Test webhook endpoint manually
- Check retry queue: ensure not stuck

---

### Issue: Invoice Expires Too Quickly

**Symptoms:**
- Users report not enough time to pay
- Many expired invoices

**Solutions:**
```env
# Increase expiry time (in rail-ln)
LN_INVOICE_EXPIRY_SEC=1800  # 30 minutes
```

**Restart rail-ln service after change**

---

## 9. Rollback Plan (1 minute)

**If critical issues occur:**

### Step 1: Disable Feature Flag

```env
# In payments service
ENABLE_LN=false
```

### Step 2: Restart Payments Service

```bash
# Via Replit UI or:
pm2 restart altostratus-payments
```

### Step 3: Communicate

**Message to users:**
> "Lightning payments temporarily unavailable for maintenance. Bitcoin and Monero payments remain operational. We'll notify you when Lightning is back online."

### Step 4: Keep rail-ln Running

- Don't stop rail-ln service
- Allows private testing and debugging
- Can re-enable quickly after fix

### Step 5: Investigate & Fix

1. Review all logs (timestamps around incident)
2. Identify root cause
3. Fix in staging/testnet
4. Re-test completely
5. Re-enable with fresh canary window

---

## 10. Green-Light Criteria

**Before expanding beyond canary testers:**

### Quantitative Metrics

- [ ] **3+ successful end-to-end payments** over 48-72 hours
- [ ] **Settlement latency P95 <5 seconds** (median <2s)
- [ ] **Webhook delivery success rate >99%** (retries <1%)
- [ ] **Zero duplicate payment incidents**
- [ ] **Zero PII exposure incidents** (verified via log audit)
- [ ] **Zero unexplained status mismatches**

### Qualitative Feedback

- [ ] **Testers report smooth UX** (no confusion, no errors)
- [ ] **QR codes scan reliably** across wallet apps
- [ ] **Status updates feel instant** (<30s acceptable)
- [ ] **No support tickets** related to Lightning payments

### Technical Validation

- [ ] **All 9 E2E test cases passed** (per `LN_IMPLEMENTATION_CHECKLIST.md`)
- [ ] **All edge cases tested and documented**
- [ ] **Rollback procedure tested** (feature flag toggle)
- [ ] **Monitoring dashboards functional** (logs accessible)
- [ ] **Team trained** on troubleshooting procedures

---

## Post-Canary Next Steps

### If Green-Light Achieved

1. **Expand to Phase 1** (10-20 users, 1 week)
2. **Add Prometheus metrics** (optional but recommended)
3. **Add live countdown timer** (UX enhancement)
4. **Document lessons learned**
5. **Plan Phase 2** (50-100 users)

### If Issues Found

1. **Document all issues** with timestamps, logs, screenshots
2. **Prioritize by severity** (blocking vs. nice-to-have)
3. **Fix in staging** and re-test
4. **Restart canary** with same testers
5. **Don't rush to production**

---

## Timeline

**Phase 0 (Canary):** 48-72 hours
- Day 1: Deploy, test with Tester 1 (2-4 hours)
- Day 2: Test with Testers 2-3 (4 hours)
- Day 3: Monitor, analyze, edge cases (2 hours)

**Phase 1 (Expanded):** 1 week
- 10-20 users
- Production-like monitoring

**Phase 2 (Full Rollout):** 2-3 weeks
- All users
- Declare production-ready

**Total to Production:** 3-4 weeks from today

---

## Appendix: Quick Reference

### Environment Variables Checklist

**Payments Service:**
```
✓ ENABLE_LN=true
✓ LN_SERVICE_URL=https://rail-ln.replit.app
✓ RAIL_AUTH_TOKEN=<64-char-hex>
✓ ALTOSTRATUS_WEBHOOK_URL=https://altostratus.replit.app/api/payments/webhook
✓ ALT_WEBHOOK_SECRET=<64-char-hex>
✓ SIMULATION_ENABLED=false
```

**rail-ln Service:**
```
✓ LN_REST_URL=https://testnet-lnd:8080/v1
✓ LN_MACAROON_HEX=<macaroon-hex>
✓ PAYMENTS_SERVICE_URL=https://payments.replit.app
✓ RAIL_AUTH_TOKEN=<same-as-payments>
✓ LN_INVOICE_EXPIRY_SEC=1200
✓ PORT=5001
```

### Health Check URLs

```bash
# Payments
curl https://payments.replit.app/health

# rail-ln
curl https://rail-ln.replit.app/health

# LND (if accessible)
curl -H "Grpc-Metadata-macaroon: $LN_MACAROON_HEX" \
  https://testnet-lnd:8080/v1/getinfo
```

### Log Locations

```bash
# If using PM2
pm2 logs rail-ln
pm2 logs altostratus-payments

# If using systemd
journalctl -u rail-ln -f
journalctl -u altostratus-payments -f

# If using Replit
# View in Replit Console tab
```

### Test Tracking Template

For each canary test, record the following information in your internal tracker:

```
Test: LN canary — Signet
User: <tester-identifier>
Invoice: <invoiceId>
Created: <timestamp> (exp <timestamp>)
Wallet: <wallet/app>
Result: Paid | Expired | Retried
Time-to-paid: <seconds>
Notes: <anything odd?>
```

**Example:**
```
Test: LN canary — Signet
User: Tester-1 (Alice)
Invoice: 550e8400-e29b-41d4-a716-446655440000
Created: 2025-11-07 14:30:00 UTC (exp 2025-11-07 14:50:00 UTC)
Wallet: Zeus (Signet)
Result: Paid
Time-to-paid: 8 seconds
Notes: Smooth flow, QR scanned instantly, status updated immediately
```

**Green-Light Requirements:**
- Minimum 3 tests with `Result: Paid`
- All `Time-to-paid` values <30 seconds (target: <5s)
- No unexplained failures or status mismatches
- Notes should indicate smooth UX

**Why This Matters:**
- Documents compliance with acceptance criteria
- Captures wallet compatibility data
- Identifies edge cases and anomalies
- Provides evidence for Phase 1 approval

---

**Document Version:** 2.0 (Corrected)  
**Last Updated:** 2025-11-07  
**Status:** Ready for Review  
**Approval Required From:** DevOps Lead, Product Owner, Security Lead
