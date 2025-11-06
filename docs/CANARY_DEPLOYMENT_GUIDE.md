# Canary Deployment Guide

This guide provides a step-by-step process for safely deploying Altostratus Payments to production using a phased, canary rollout approach. This minimizes risk by enabling payment rails one at a time and monitoring each before proceeding.

## Deployment Philosophy

**Canary Rollout Principles:**
- Enable one payment rail at a time
- Monitor extensively between phases
- Validate with real testnet transactions first
- Have rollback procedures ready
- Collect metrics before expanding

**Timeline:** Each phase should run for 24-48 hours minimum before proceeding to the next.

---

## Pre-Deployment Checklist

Before starting any production deployment:

### 1. Security Configuration
```bash
# Generate strong tokens (NEVER use example values in production)
RAIL_AUTH_TOKEN=$(openssl rand -hex 32)
ADMIN_SIM_TOKEN=$(openssl rand -hex 32)
ALT_WEBHOOK_SECRET=$(openssl rand -hex 32)

# Store these securely in your production environment
```

### 2. Environment Configuration
```bash
# .env (production)
SIMULATION_ENABLED=false
ENABLE_LN=false
ENABLE_BTC=false
ENABLE_XMR=false
AUTO_ANONYMIZE_ENABLED=true
RETENTION_PAID_DAYS=90
RETENTION_MAX_DAYS=365
ALTOSTRATUS_WEBHOOK_URL=https://your-production-app.com/api/payment-webhook
```

### 3. Documentation Review
- ✓ Review `docs/E2E_TESTING_GUIDE.md` for testing procedures
- ✓ Review `docs/OBSERVABILITY.md` for monitoring setup
- ✓ Review `docs/OPS_KEY_MANAGEMENT.md` for key management
- ✓ Review `docs/CRYPTO_PAYMENT_POLICY.md` for policy understanding
- ✓ Review `docs/STATUS_SEMANTICS.md` for status flows

### 4. Monitoring Setup
Before deploying, ensure you have:
- [ ] Structured logging pipeline configured
- [ ] Metrics dashboard for invoice/payment tracking
- [ ] Alerts configured per `docs/OBSERVABILITY.md`
- [ ] Webhook delivery monitoring
- [ ] Database retention job monitoring

### 5. Rollback Plan
Prepare rollback procedures:
```bash
# Quick disable (if issues occur)
export ENABLE_LN=false
export ENABLE_BTC=false
export ENABLE_XMR=false
# Restart service
```

---

## Phase 0: Testnet Validation

**Goal:** Validate all components work correctly with real blockchain interactions on testnet/regtest.

**Duration:** 1-2 weeks (depending on complexity)

### Setup
1. Deploy payment rail services in testnet mode:
   - `rail-ln`: Testnet Lightning node
   - `rail-btc`: Bitcoin Core testnet/regtest
   - `rail-xmr`: Monero stagenet

2. Configure testnet environment:
```bash
# .env (testnet)
SIMULATION_ENABLED=false  # Test with REAL testnet rails
ENABLE_LN=true
ENABLE_BTC=true
ENABLE_XMR=true

# Point to testnet rail services
LN_SERVICE_URL=http://rail-ln-testnet:5001
BTC_SERVICE_URL=http://rail-btc-testnet:5002
XMR_SERVICE_URL=http://rail-xmr-testnet:5003

RAIL_AUTH_TOKEN=<testnet-token>
```

### Testing Checklist
Follow `docs/E2E_TESTING_GUIDE.md` exactly:

**Lightning Network:**
- [ ] Create invoice with tiny amount (1000 sats)
- [ ] Generate BOLT11 invoice
- [ ] Pay from testnet wallet
- [ ] Verify settlement callback
- [ ] Verify webhook to Altostratus app
- [ ] Test invoice expiration
- [ ] Test MPP (if wallet supports)

**Bitcoin On-Chain:**
- [ ] Create invoice with testnet BTC (0.001 BTC)
- [ ] Verify address generation from xpub
- [ ] Send testnet payment
- [ ] Monitor confirmations (2+ blocks)
- [ ] Verify webhook after confirmation
- [ ] Test underpayment scenario
- [ ] Test overpayment scenario
- [ ] Test blockchain reorg handling

**Monero:**
- [ ] Create invoice with testnet XMR (0.1 XMR)
- [ ] Verify subaddress generation
- [ ] Send stagenet payment
- [ ] Monitor confirmations (10+ blocks)
- [ ] Verify webhook after confirmation
- [ ] Test late payment scenario
- [ ] Test view-only wallet integration

### Success Criteria (Phase 0)
- ✓ All 3 rails successfully process testnet payments
- ✓ All webhooks deliver successfully to Altostratus app
- ✓ No errors in logs (check structured logging)
- ✓ Edge cases handled correctly (underpayment, overpayment, reorg, expiry)
- ✓ Monitoring dashboards show accurate metrics

**Decision Point:** Do not proceed to Phase 1 until ALL testnet tests pass.

---

## Phase 1: Production - Lightning Network Only

**Goal:** Enable Lightning Network for 5-10 canary users.

**Duration:** 48 hours minimum

**Rationale:** Lightning has fastest settlement (<5s) and lowest transaction fees, making it ideal for initial production testing.

### Configuration
```bash
# .env (production - Phase 1)
SIMULATION_ENABLED=false
ENABLE_LN=true       # ← Lightning ONLY
ENABLE_BTC=false
ENABLE_XMR=false

LN_SERVICE_URL=https://rail-ln.your-domain.com:5001
RAIL_AUTH_TOKEN=<production-token>
ALTOSTRATUS_WEBHOOK_URL=https://production-app.com/api/payment-webhook
```

### Deployment Steps
1. **Deploy rail-ln service:**
   - Production Lightning node with sufficient channel liquidity
   - Configure BOLT11 invoice generation
   - Set RAIL_AUTH_TOKEN matching payments service
   - Enable health checks

2. **Deploy payments service:**
   - Set ENABLE_LN=true (only)
   - Verify RAIL_AUTH_TOKEN matches
   - Restart service
   - Check startup logs for "Lightning: ✓ ENABLED"

3. **Select canary users:**
   - Choose 5-10 trusted users/internal team
   - Provide them with invoice creation access
   - Brief them on expected behavior

4. **Create test invoices:**
   - Each canary user creates 1-2 small invoices (e.g., $5-10 USD equivalent)
   - Have users pay from their own Lightning wallets
   - Monitor payment flow end-to-end

### Monitoring (Phase 1)
Watch these metrics closely for 48 hours:

**Critical Metrics:**
- Invoice creation rate (should be low, ~5-20 invoices)
- Payment settlement latency (target: <5 seconds)
- Webhook delivery success rate (target: 100%)
- Rail callback authentication success
- Zero failed payments

**Log Analysis:**
```bash
# Check for errors
grep ERROR logs/payments-service.log | tail -20

# Monitor structured logs
grep '"rail":"ln"' logs/payments-service.log | jq .

# Check webhook deliveries
grep '"event":"webhook"' logs/payments-service.log | jq .
```

**Alert Thresholds (Phase 1):**
- CRITICAL: Lightning rail down for >5 minutes
- CRITICAL: No successful payments in 12 hours (with active invoices)
- WARNING: Settlement latency >10 seconds
- WARNING: Webhook retry rate >10%

### Success Criteria (Phase 1)
- ✓ All canary invoices successfully created
- ✓ All payments settle within 5 seconds
- ✓ 100% webhook delivery success
- ✓ Zero authentication failures
- ✓ No error logs related to Lightning rail
- ✓ Altostratus app successfully processes all webhooks

**Decision Point:** Proceed to Phase 2 only if ALL criteria met for 48+ hours.

---

## Phase 2: Production - Add Bitcoin On-Chain

**Goal:** Enable Bitcoin on-chain for broader user base (20-50 users).

**Duration:** 72 hours minimum

**Rationale:** Bitcoin has slower settlement (2+ confirmations ≈ 20-60 minutes) but is widely used. Expanding user base moderately.

### Configuration
```bash
# .env (production - Phase 2)
SIMULATION_ENABLED=false
ENABLE_LN=true
ENABLE_BTC=true      # ← Bitcoin added
ENABLE_XMR=false

BTC_SERVICE_URL=https://rail-btc.your-domain.com:5002
```

### Deployment Steps
1. **Deploy rail-btc service:**
   - Production Bitcoin Core node (fully synced)
   - Configure xpub for address derivation (BIP84 recommended)
   - Set BTC_CONFIRMATIONS_REQUIRED=2
   - Set RAIL_AUTH_TOKEN
   - Enable health checks

2. **Update payments service:**
   - Set ENABLE_BTC=true
   - Verify BTC_SERVICE_URL correct
   - Rolling restart (zero downtime)
   - Check logs for "Bitcoin: ✓ ENABLED"

3. **Expand user base:**
   - Add 20-50 users (still controlled group)
   - Provide access to both Lightning and Bitcoin options
   - Monitor split of payment rail usage

### Monitoring (Phase 2)
**Critical Metrics:**
- Bitcoin confirmation latency (target: <30 minutes for 2 confirmations)
- Address derivation working correctly (no reuse)
- Both Lightning AND Bitcoin rails functioning
- Webhook delivery success rate (target: >99%)

**Log Analysis:**
```bash
# Monitor both rails
grep '"rail":"ln"\|"rail":"btc"' logs/payments-service.log | jq .

# Check Bitcoin confirmations
grep '"event":"confirmation"' logs/payments-service.log | grep btc | jq .

# Monitor address generation
grep '"event":"address_generated"' logs/rail-btc.log | jq .
```

**Alert Thresholds (Phase 2):**
- CRITICAL: Either rail down for >5 minutes
- CRITICAL: Bitcoin confirmation >60 minutes (possible mempool congestion)
- WARNING: Address derivation index gap >20 (potential issue)
- WARNING: Webhook retry rate >5%

### Edge Case Testing (Phase 2)
Have canary users test:
- [ ] Underpayment (pay less than invoice amount)
- [ ] Overpayment (pay more than invoice amount)
- [ ] Late payment (after 1 confirmation but before 2nd)
- [ ] Expired invoice (attempt payment after expiration)

### Success Criteria (Phase 2)
- ✓ Both rails operating smoothly
- ✓ Bitcoin confirmations within expected timeframes
- ✓ No address reuse
- ✓ >99% webhook delivery success
- ✓ Edge cases handled per policy (see `docs/CRYPTO_PAYMENT_POLICY.md`)
- ✓ User feedback positive

**Decision Point:** Proceed to Phase 3 only if ALL criteria met for 72+ hours.

---

## Phase 3: Production - Add Monero (Full Rollout)

**Goal:** Enable Monero and open to all users.

**Duration:** 1 week minimum before declaring stable

**Rationale:** Monero has longest settlement time (10+ confirmations ≈ 20+ minutes) and privacy features requiring careful handling.

### Configuration
```bash
# .env (production - Phase 3)
SIMULATION_ENABLED=false
ENABLE_LN=true
ENABLE_BTC=true
ENABLE_XMR=true      # ← Monero added - FULL SYSTEM LIVE
```

### Deployment Steps
1. **Deploy rail-xmr service:**
   - Production Monero daemon (fully synced)
   - Configure wallet with view-only keys
   - Set XMR_CONFIRMATIONS_REQUIRED=10
   - Set RAIL_AUTH_TOKEN
   - Enable health checks

2. **Update payments service:**
   - Set ENABLE_XMR=true
   - Verify XMR_SERVICE_URL correct
   - Rolling restart
   - Check logs for "Monero: ✓ ENABLED"

3. **Full user rollout:**
   - Announce all 3 payment rails available
   - Update user documentation
   - Monitor load and performance

### Monitoring (Phase 3)
**Critical Metrics:**
- All 3 rails operational simultaneously
- Monero confirmation latency (target: <25 minutes for 10 confirmations)
- Subaddress generation working correctly
- System load and performance under full traffic
- Webhook delivery success rate (target: >99.5%)
- Data retention job running successfully (daily)

**Log Analysis:**
```bash
# Monitor all rails
grep '"rail":"ln"\|"rail":"btc"\|"rail":"xmr"' logs/payments-service.log | jq .

# Check Monero confirmations (should be 10+)
grep '"event":"confirmation"' logs/payments-service.log | grep xmr | jq .

# Monitor retention job
grep '"event":"retention_cleanup"' logs/payments-service.log | jq .
```

**Alert Thresholds (Phase 3):**
- CRITICAL: Any rail down for >5 minutes
- CRITICAL: Monero confirmation >40 minutes
- CRITICAL: Data retention job failed
- WARNING: Webhook retry rate >3%
- WARNING: Invoice creation rate anomaly (spike or drop >50%)

### Privacy & Compliance Verification
- [ ] Verify no PII in logs (check structured logging)
- [ ] Verify payment addresses only in QR codes (not displayed as text)
- [ ] Verify anonymization job running daily
- [ ] Test manual anonymization endpoint (POST /api/privacy/anonymize/:id)
- [ ] Verify HMAC webhook signing working

### Success Criteria (Phase 3)
- ✓ All 3 rails operating smoothly for 1 week
- ✓ Monero confirmations within expected timeframes
- ✓ >99.5% webhook delivery success
- ✓ No security incidents
- ✓ Privacy controls functioning (anonymization, no PII leakage)
- ✓ System performance stable under full load
- ✓ Positive user feedback across all payment methods

---

## Post-Deployment: Steady State Operations

Once all phases complete successfully:

### 1. Ongoing Monitoring
- Daily review of metrics dashboard
- Weekly log analysis for anomalies
- Monthly security audit
- Quarterly key rotation (RAIL_AUTH_TOKEN, ADMIN_SIM_TOKEN, ALT_WEBHOOK_SECRET)

### 2. Incident Response
Maintain 24/7 on-call rotation for:
- Payment rail failures
- Webhook delivery issues
- Security incidents
- Performance degradation

### 3. Maintenance Windows
Schedule regular maintenance (communicate to users 48h in advance):
- Rail service upgrades
- Blockchain node software updates
- Key rotation procedures
- Database retention policy adjustments

### 4. Capacity Planning
Monitor and plan for:
- Invoice volume growth
- Webhook queue size
- Database storage (anonymized invoices)
- Blockchain node disk space

---

## Rollback Procedures

If issues occur at any phase:

### Immediate Rollback (Emergency)
```bash
# Stop affected rail immediately
export ENABLE_LN=false  # or ENABLE_BTC=false or ENABLE_XMR=false
systemctl restart altostratus-payments

# Check logs
tail -f logs/payments-service.log

# Verify rail disabled in startup banner
```

### Graceful Rollback (Planned)
1. Announce to users (if external facing)
2. Disable new invoice creation for affected rail (feature flag)
3. Allow existing pending invoices to complete (monitor expiration)
4. Disable rail callback endpoint
5. Investigate root cause
6. Fix and retest in testnet before re-enabling

### Communication Template
```
Subject: [Altostratus Payments] Temporary Service Adjustment

We are temporarily disabling [Lightning/Bitcoin/Monero] payments while we 
investigate an issue. Existing pending invoices will still be processed. 
We expect to restore service within [timeframe].

Other payment methods remain fully operational.
```

---

## Success Metrics Summary

| Phase | Duration | Users | Rails | Key Metric | Target |
|-------|----------|-------|-------|------------|--------|
| 0: Testnet | 1-2 weeks | Internal | All (testnet) | E2E tests pass | 100% |
| 1: LN Canary | 48h | 5-10 | Lightning | Settlement latency | <5s |
| 2: Add BTC | 72h | 20-50 | LN + BTC | Confirmation time | <30min |
| 3: Full | 1 week | All | All 3 | Webhook success | >99.5% |

---

## Lessons Learned Log

After each phase, document:
- What went well
- What could be improved
- Issues encountered and resolutions
- User feedback
- Performance observations

This guide ensures a safe, monitored, and reversible deployment process that prioritizes reliability and user trust.
