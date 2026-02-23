# Lightning Network Canary Rollout Analysis

**Date:** 2025-11-07  
**Document:** Analysis of attached canary rollout plan  
**Status:** Critical gaps identified - action required before deployment

---

## Executive Summary

The attached canary rollout plan is **80% aligned** with our current implementation but contains **4 critical errors** and **6 gaps** that must be addressed before Phase 0 testnet deployment.

**Blocking Issues:**
1. ❌ Payments service missing `/health` endpoint
2. ❌ Environment variable naming mismatch
3. ❌ Health response format incompatible with plan expectations

**Non-Blocking (Recommended):**
4. ⚠️ No Prometheus metrics implementation
5. ⚠️ No live countdown timer in UI
6. ⚠️ Altostratus webhook integration unverified

---

## Critical Errors Found

### Error 1: Environment Variable Naming Mismatch ❌

**Document Says:**
```env
# In rail-ln Secrets
ALT_PAYMENTS_BASE=https://<payments>.replit.app
```

**Our Implementation Uses:**
```env
# In rail-ln/.env.example
PAYMENTS_SERVICE_URL=https://<payments>.replit.app
```

**Impact:** Configuration instructions will fail  
**Fix Required:** Update documentation OR rename variable (recommend updating docs for consistency)  
**Severity:** CRITICAL - blocks deployment

---

### Error 2: Missing Health Endpoint on Payments Service ❌

**Document Expects:**
```bash
GET <payments>/health → { ok: true }
```

**Current Implementation:**
- ❌ Payments service has NO `/health` endpoint
- ✅ rail-ln has `/health` endpoint (correct)

**Impact:** Pre-flight health checks will fail  
**Fix Required:** Add `/health` endpoint to payments service  
**Severity:** CRITICAL - blocks health monitoring

---

### Error 3: Health Response Format Mismatch ❌

**Document Expects:**
```json
{
  "ok": true,
  "rail": "ln"
}
```

**rail-ln Returns:**
```json
{
  "status": "healthy",
  "rail": "ln",
  "timestamp": "2025-11-07T...",
  "lndConnected": true,
  "mppEnabled": true
}
```

**Impact:** Health check scripts/monitoring may fail to parse response  
**Fix Required:** Either:
- Update documentation to match implementation (RECOMMENDED)
- OR change implementation to match doc (not recommended - less informative)

**Severity:** MEDIUM - affects monitoring integration

---

### Error 4: Prometheus Metrics Not Implemented ⚠️

**Document References:**
```
invoices_created_total{asset="LN"}
invoices_paid_total{asset="LN"}
webhook_retries_total
avg_time_to_paid_seconds{asset="LN"}
```

**Current Implementation:**
- ❌ No Prometheus `/metrics` endpoint
- ❌ No metrics instrumentation
- ✅ Structured JSON logging exists (alternative)

**Impact:** Advanced monitoring requires manual log parsing  
**Fix Required:** Either:
- Add basic Prometheus metrics (4-8 hours work)
- OR rely on log aggregation (acceptable for Phase 0)

**Severity:** LOW - can use logs for Phase 0, add metrics later

---

## Implementation Gaps

### Gap 1: UI Countdown Timer

**Document Expects:**
> UI shows QR + BOLT11 + countdown (20:00 → 0:00)

**Current Implementation:**
- ✅ Shows expiration date/time
- ✅ Shows "expires in X minutes" (relative)
- ❌ No live ticking countdown timer

**Recommendation:** 
- Phase 0: Ship with current implementation (acceptable)
- Phase 1: Add live countdown timer enhancement

---

### Gap 2: Altostratus Webhook Integration Unverified

**Document Assumes:**
```env
ALT_WEBHOOK_URL=https://<altostratus>.replit.app/api/payments/webhook
```

**Status:** 
- ✅ Payments service sends HMAC-signed webhooks
- ❓ Altostratus main app endpoint unverified (outside our scope)

**Recommendation:** Verify with Altostratus team before deployment

---

### Gap 3: IP Allowlist for Simulation Endpoint

**Document Recommends:**
> If you keep [SIMULATION_ENABLED] for QA, require ADMIN_SIM_TOKEN and IP allowlist.

**Current Implementation:**
- ✅ ADMIN_SIM_TOKEN enforced
- ❌ No IP allowlist

**Recommendation:** Add IP allowlist in production deployment config (firewall/proxy level)

---

## Verification Checklist

### ✅ Correctly Implemented

- [x] Feature flag `ENABLE_LN` in payments service
- [x] `LN_SERVICE_URL` configuration
- [x] `RAIL_AUTH_TOKEN` authentication
- [x] BOLT11 invoice generation
- [x] Settlement detection and callback
- [x] HMAC webhook signing
- [x] Expiry handling (20min default)
- [x] Idempotency (duplicate callback protection)
- [x] Webhook retry logic
- [x] Privacy-safe logging (no PII)
- [x] Edge case handling (expired, over/under payment)
- [x] Rollback capability (feature flag)

### ❌ Missing/Incorrect

- [ ] Payments service `/health` endpoint
- [ ] Environment variable naming consistency
- [ ] Health response format alignment
- [ ] Prometheus metrics (optional for Phase 0)
- [ ] Live countdown timer UI (optional for Phase 0)
- [ ] IP allowlist for simulation endpoint

---

## Recommendations by Priority

### Priority 1: Must Fix Before Deployment

1. **Add `/health` endpoint to payments service**
   - Response format: `{ status: "healthy", timestamp: "...", version: "..." }`
   - Status codes: 200 (healthy), 503 (degraded)
   - Check: storage available, webhooks operational

2. **Update documentation for environment variables**
   - Change `ALT_PAYMENTS_BASE` → `PAYMENTS_SERVICE_URL` in all docs
   - Verify all variable names match `.env.example` files

3. **Standardize health response format**
   - Document actual response schemas
   - Update monitoring scripts to match

### Priority 2: Should Fix Before Production

4. **Add basic Prometheus metrics**
   - Endpoint: `GET /metrics`
   - Counters: invoices_created, invoices_paid, webhook_sent
   - Gauges: invoices_pending
   - Histograms: settlement_duration_seconds

5. **Add IP allowlist for simulation endpoint**
   - Implement at proxy/firewall level
   - Document allowed IP ranges

### Priority 3: Nice to Have

6. **Enhance UI with live countdown**
   - Replace static "expires in..." with ticking timer
   - Visual urgency indicators (color change <5min)

7. **Add dashboard health status**
   - Show rail status (LN, BTC, XMR) in UI
   - Real-time health check polling

---

## Corrected Canary Rollout Plan

See `docs/CANARY_ROLLOUT_PLAN_CORRECTED.md` for updated version with:
- Corrected environment variable names
- Actual health endpoint schemas
- Alternative metrics collection (logs vs Prometheus)
- Phased deployment approach
- Updated acceptance criteria

---

## Phase 0 Deployment Decision

**CAN WE DEPLOY TO TESTNET NOW?**

**NO** - Must complete Priority 1 fixes first:
1. Add payments `/health` endpoint (1 hour)
2. Update documentation (30 min)
3. Test health checks end-to-end (30 min)

**Estimated Time to Production-Ready:** 2-3 hours

---

## Testing Strategy

### Pre-Deployment Smoke Tests

```bash
# 1. Health checks
curl https://payments.replit.app/health
# Expected: { "status": "healthy", ... }

curl https://rail-ln.replit.app/health
# Expected: { "status": "healthy", "rail": "ln", "lndConnected": true, ... }

# 2. Configuration verification
# Verify PAYMENTS_SERVICE_URL matches in rail-ln
# Verify RAIL_AUTH_TOKEN matches in both services
# Verify ENABLE_LN=true in payments

# 3. Invoice creation (simulation)
curl -X POST https://payments.replit.app/api/simulate/payment/<invoice-id> \
  -H "Authorization: Bearer $ADMIN_SIM_TOKEN"
# Expected: Invoice marked paid, webhook sent
```

### Phase 0 Testnet Tests (9 scenarios)

Per `docs/LN_IMPLEMENTATION_CHECKLIST.md`:
1. Happy path (create → pay → settle)
2. Expired invoice rejection
3. Duplicate payment idempotency
4. Webhook retry on failure
5. Overpayment detection
6. Underpayment rejection
7. LND disconnection graceful degradation
8. Concurrent invoice creation
9. Settlement latency <5s

---

## Next Steps

1. **Immediate (Today):**
   - [ ] Add `/health` endpoint to payments service
   - [ ] Update all documentation with correct env var names
   - [ ] Test health checks locally

2. **Before Testnet (This Week):**
   - [ ] Execute full smoke test suite
   - [ ] Verify Altostratus webhook integration
   - [ ] Document actual vs expected behavior

3. **Phase 0 Deployment (Next Week):**
   - [ ] Deploy to testnet with 3 testers
   - [ ] Monitor for 48-72 hours
   - [ ] Collect feedback and metrics

4. **Phase 1 Production (2-3 Weeks):**
   - [ ] Add Prometheus metrics
   - [ ] Add live countdown timer
   - [ ] Add IP allowlist
   - [ ] Deploy to production with canary users

---

## Conclusion

The attached canary rollout plan is **well-structured** and covers all major scenarios. However, critical environment variable mismatches and missing health endpoints must be fixed before deployment.

**Action Required:** Complete Priority 1 fixes, then proceed with Phase 0 testnet deployment using corrected plan.

**Estimated Timeline:**
- Fixes: 2-3 hours
- Testing: 4 hours
- Testnet deployment: 48-72 hours
- Total to Phase 0: 1 week

---

**Prepared by:** Agent Analysis  
**Reviewed by:** [Pending]  
**Approved for Deployment:** [Pending Priority 1 Fixes]
