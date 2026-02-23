# Lightning Network Implementation Checklist

**Project:** Altostratus Payments - Lightning Network Integration  
**Document:** Implementation & Validation Checklist  
**Version:** 2.0  
**Date:** 2025-11-06

---

## Purpose

This checklist ensures all critical components of the Lightning Network integration are implemented, tested, and validated before production deployment. Use this document to track progress and ensure nothing is missed.

---

## Phase 0: Pre-Implementation

### Documentation Review
- [ ] Read `docs/LN_INTEGRATION_PLAN_V2.md` completely
- [ ] Read `docs/E2E_TESTING_GUIDE.md` (Lightning section)
- [ ] Read `docs/OBSERVABILITY.md`
- [ ] Read `docs/OPS_KEY_MANAGEMENT.md` (Lightning section)
- [ ] Read `docs/CANARY_DEPLOYMENT_GUIDE.md`

### Infrastructure Setup
- [ ] LND node deployed on separate infrastructure (not Replit)
- [ ] LND fully synced to testnet/mainnet
- [ ] Lightning channels established with sufficient liquidity
- [ ] Generate read-only invoice macaroon
- [ ] Convert macaroon to hex format
- [ ] Store macaroon securely (not in version control)

### Security Tokens
- [ ] Generate RAIL_AUTH_TOKEN: `openssl rand -hex 32`
- [ ] Generate ALT_WEBHOOK_SECRET: `openssl rand -hex 32`
- [ ] Store tokens in secure secrets manager
- [ ] Document token rotation schedule (90 days)

---

## Phase 1: rail-ln Service Implementation

### Code Implementation
- [ ] Create `rail-ln` project directory
- [ ] Initialize npm project: `npm init -y`
- [ ] Install dependencies (see LN_INTEGRATION_PLAN_V2.md Step 2.1)
- [ ] Copy TypeScript implementation from Step 2.2
- [ ] Configure `tsconfig.json` from Step 2.2
- [ ] Set up `package.json` scripts

### Required Features Implemented
- [ ] **Zod Schema Validation** on all endpoints
- [ ] **Rate Limiting** (10 req/min for invoice creation)
- [ ] **Health Check** endpoint (`GET /health`)
- [ ] **Invoice Creation** endpoint (`POST /ln/create`)
- [ ] **LND Connection Check** with retry logic
- [ ] **Structured JSON Logging** (no PII)
- [ ] **Invoice Settlement Monitoring** (polling or subscription)
- [ ] **Callback to Payments Service** with correct schema
- [ ] **Error Handling** with structured logs
- [ ] **Graceful Degradation** if LND disconnects

### API Contract Validation
- [ ] Callback payload matches `paymentConfirmationSchema`:
  - [ ] `invoiceId`: UUID string
  - [ ] `transactionId`: Payment hash (r_hash)
  - [ ] `confirmations`: 0 (Lightning is instant)
  - [ ] `blockHeight`: null (not applicable)
- [ ] BOLT11 returned synchronously from `/ln/create`
- [ ] Settlement callback uses Bearer token authentication
- [ ] All responses follow documented schema

### Configuration
- [ ] `.env` file created with all required variables
- [ ] `LN_REST_URL` points to correct LND endpoint
- [ ] `LN_MACAROON_HEX` contains invoice macaroon
- [ ] `PAYMENTS_SERVICE_URL` points to payments service
- [ ] `RAIL_AUTH_TOKEN` set and matches payments service
- [ ] `LN_INVOICE_EXPIRY_SEC` configured (default: 1200)
- [ ] `LN_ENABLE_MPP=true` (accept multi-path payments)

---

## Phase 2: payments Service Integration

### Verification (No Changes Required)
- [ ] Endpoint exists: `POST /api/rails/ln/settled`
- [ ] Uses `authenticateRailCallback` middleware
- [ ] Validates with `paymentConfirmationSchema`
- [ ] Implements idempotency checks:
  - [ ] Returns 200 if already paid
  - [ ] Returns 400 if expired
- [ ] Stores `paymentSource: "rail-ln"`
- [ ] Queues HMAC-signed webhook to Altostratus

### Configuration
- [ ] `ENABLE_LN=true` in payments `.env`
- [ ] `LN_SERVICE_URL` points to rail-ln service
- [ ] `RAIL_AUTH_TOKEN` matches rail-ln service
- [ ] `ALTOSTRATUS_WEBHOOK_URL` configured
- [ ] `ALT_WEBHOOK_SECRET` configured

---

## Phase 3: Local Testing

### Service Startup
- [ ] Start LND node: `lnd --bitcoin.testnet`
- [ ] Start rail-ln service: `npm run dev`
- [ ] Verify startup banner shows:
  - [ ] LND Status: ✓ Connected
  - [ ] MPP: ✓ Enabled
- [ ] Start payments service: `npm run dev`
- [ ] Verify payments startup banner shows:
  - [ ] Lightning: ✓ ENABLED

### Health Check Test
- [ ] `curl http://localhost:5001/health` returns 200
- [ ] Response shows `lndConnected: true`
- [ ] Stop LND, verify health returns 503
- [ ] Restart LND, verify health returns 200

### Basic Invoice Creation
- [ ] Create invoice via payments service
- [ ] Verify BOLT11 invoice generated
- [ ] Verify invoice stored with `bolt11Invoice` field
- [ ] Check rail-ln logs for `invoice_created` event
- [ ] Verify no errors in logs

---

## Phase 4: Testnet End-to-End Testing

**Prerequisites:**
- [ ] Testnet LND node synced and channels funded
- [ ] Testnet Lightning wallet available (Zeus, Phoenix, lncli)
- [ ] Webhook receiver configured (RequestBin or local)

### Test 1: Basic Payment Flow ✅ CRITICAL
- [ ] Create Lightning invoice via API
- [ ] Verify BOLT11 generated and valid
- [ ] Pay invoice with Lightning wallet
- [ ] Payment settles within 5 seconds
- [ ] Invoice status updates to "paid"
- [ ] `paymentSource` is "rail-ln"
- [ ] Webhook sent to Altostratus with HMAC signature
- [ ] Check all logs for structured format

**Result:** ☐ PASS ☐ FAIL  
**Notes:** _______________________________________________

### Test 2: Invoice Expiration ✅ CRITICAL
- [ ] Create invoice with 2-minute expiry
- [ ] Wait for expiration
- [ ] Attempt payment (should fail in wallet)
- [ ] Invoice status is "expired"
- [ ] No callback sent to payments service

**Result:** ☐ PASS ☐ FAIL  
**Notes:** _______________________________________________

### Test 3: MPP Acceptance ✅ CRITICAL
- [ ] Create larger invoice (100k+ sats)
- [ ] Pay with MPP-capable wallet
- [ ] Payment settles normally
- [ ] Single callback sent after all HTLCs settle
- [ ] Invoice marked as "paid"

**Result:** ☐ PASS ☐ FAIL  
**Notes:** _______________________________________________

### Test 4: Channel Liquidity Error ⚠️ RECOMMENDED
- [ ] Create invoice exceeding channel capacity
- [ ] Attempt payment
- [ ] Wallet shows "no route" error
- [ ] Invoice remains "pending"
- [ ] User sees clear error message

**Result:** ☐ PASS ☐ FAIL  
**Notes:** _______________________________________________

### Test 5: Idempotency - Duplicate Callbacks ✅ CRITICAL
- [ ] Pay invoice normally
- [ ] Manually send duplicate callback
- [ ] Response: "Invoice already paid"
- [ ] No duplicate webhook sent
- [ ] Log shows: `status: "already_paid"`

**Result:** ☐ PASS ☐ FAIL  
**Notes:** _______________________________________________

### Test 6: Expired Invoice Rejection ✅ CRITICAL
- [ ] Create and expire invoice (don't pay)
- [ ] Manually send settlement callback
- [ ] Response: 400 "Cannot pay expired invoice"
- [ ] Invoice status remains "expired"
- [ ] No webhook sent
- [ ] Log shows: `status: "rejected_expired"`

**Result:** ☐ PASS ☐ FAIL  
**Notes:** _______________________________________________

### Test 7: Webhook HMAC Verification ✅ CRITICAL
- [ ] Pay invoice
- [ ] Capture webhook POST to Altostratus
- [ ] Verify `X-Altostratus-Signature` header present
- [ ] Compute HMAC with ALT_WEBHOOK_SECRET
- [ ] Signature matches computed value
- [ ] Payload contains all required fields

**Result:** ☐ PASS ☐ FAIL  
**Notes:** _______________________________________________

### Test 8: Health Check Accuracy ⚠️ RECOMMENDED
- [ ] Health returns 200 when LND connected
- [ ] Health returns 503 when LND disconnected
- [ ] `lndConnected` field accurate

**Result:** ☐ PASS ☐ FAIL  
**Notes:** _______________________________________________

### Test 9: Rate Limiting ⚠️ RECOMMENDED
- [ ] Send 10 invoice requests within 60 seconds (succeed)
- [ ] 11th request returns 429
- [ ] Log shows: `rate_limit_exceeded`

**Result:** ☐ PASS ☐ FAIL  
**Notes:** _______________________________________________

---

## Phase 5: Monitoring & Observability

### Metrics Implementation
- [ ] `rail_ln_invoices_created_total` tracked
- [ ] `rail_ln_settlements_total` tracked
- [ ] `rail_ln_callbacks_sent_total{status}` tracked
- [ ] `rail_ln_settlement_latency_seconds` tracked (p50, p95, p99)
- [ ] `rail_ln_lnd_connected` gauge tracked
- [ ] `rail_ln_errors_total{type}` tracked

### Dashboards
- [ ] Grafana/DataDog dashboard created
- [ ] Invoice creation rate chart
- [ ] Settlement latency histogram
- [ ] Callback success rate chart
- [ ] LND connection status indicator
- [ ] Error rate by type

### Alerts Configured
- [ ] CRITICAL: LND disconnected >5 minutes
- [ ] CRITICAL: No settlements >30 minutes (with pending invoices)
- [ ] WARNING: Callback failure rate >10%
- [ ] WARNING: Settlement latency P95 >10 seconds
- [ ] Test all alerts fire correctly

### Log Aggregation
- [ ] Logs shipped to centralized system (Loki, Elasticsearch)
- [ ] Can query by `invoiceId`
- [ ] Can query by `event` type
- [ ] Can filter by `level` (info/warn/error)
- [ ] No PII in logs (verified)

---

## Phase 6: Security Audit

### Authentication
- [ ] RAIL_AUTH_TOKEN required on all callbacks
- [ ] Token is 64+ characters (32-byte hex minimum)
- [ ] Token stored in environment variables (not code)
- [ ] Invalid token returns 401
- [ ] Missing token returns 401

### Input Validation
- [ ] All endpoints use Zod schemas
- [ ] `invoiceId` must be UUID format
- [ ] `amountMsat` has max limit (21M BTC)
- [ ] `memo` has max length (639 chars)
- [ ] Invalid inputs return 400 with details

### Rate Limiting
- [ ] Enabled on `/ln/create` endpoint
- [ ] 10 requests per 60-second window
- [ ] 429 response when exceeded
- [ ] Logs rate limit events

### Macaroon Security
- [ ] Using read-only invoice macaroon (not admin)
- [ ] Macaroon stored as hex in env var
- [ ] Macaroon never exposed in logs/responses
- [ ] LND node isolated (not on Replit)

### Logging Privacy
- [ ] No PII logged (addresses, amounts, IPs)
- [ ] Only invoiceId, rail, event logged
- [ ] Payment hashes truncated in logs (first 16 chars)
- [ ] All logs use structured JSON format

---

## Phase 7: Operational Readiness

### Documentation
- [ ] Ops team trained on rail-ln architecture
- [ ] Incident response runbook created
- [ ] Escalation procedures documented
- [ ] On-call rotation established

### Backup Procedures
- [ ] Daily SCB (Static Channel Backup) automated
- [ ] SCB stored in 3 separate locations
- [ ] Weekly backup restoration test performed
- [ ] Invoice settlement logs backed up

### Monitoring Setup
- [ ] 24/7 monitoring enabled
- [ ] PagerDuty/OpsGenie integrated
- [ ] Alert routing configured
- [ ] SLA targets defined:
  - [ ] Settlement latency <5 seconds
  - [ ] Uptime >99.9%
  - [ ] Callback success rate >99%

### Disaster Recovery
- [ ] LND recovery procedure documented
- [ ] Channel force-close procedure documented
- [ ] rail-ln service rollback procedure tested
- [ ] Payments service rollback procedure tested

---

## Phase 8: Canary Deployment (Production)

### Pre-Deployment
- [ ] All testnet tests passed (Phase 4)
- [ ] Monitoring dashboards live
- [ ] Alerts tested and firing correctly
- [ ] Team trained and ready
- [ ] Rollback procedure documented and tested

### Phase 1: Lightning Only (48h)
- [ ] Enable `ENABLE_LN=true` for canary users (5-10)
- [ ] Monitor settlement latency (<5s target)
- [ ] Monitor webhook delivery (100% target)
- [ ] Monitor error rates (0% target)
- [ ] Check logs for any warnings/errors
- [ ] User feedback: No issues reported
- [ ] **Decision Gate:** All metrics green for 48h

**Phase 1 Result:** ☐ PASS ☐ FAIL ☐ ROLLBACK  
**Notes:** _______________________________________________

### Phase 2: Expand (72h)
- [ ] Enable for 20-50 users
- [ ] Lightning + Bitcoin rails operational
- [ ] Monitor both rails simultaneously
- [ ] Edge cases tested in production:
  - [ ] Underpayment scenario
  - [ ] Overpayment scenario  
  - [ ] Late payment after 1 confirmation
- [ ] Webhook success rate >99%
- [ ] **Decision Gate:** All metrics green for 72h

**Phase 2 Result:** ☐ PASS ☐ FAIL ☐ ROLLBACK  
**Notes:** _______________________________________________

### Phase 3: Full Rollout (1 week)
- [ ] Enable for all users
- [ ] All 3 rails operational (LN, BTC, XMR)
- [ ] System stable under full load
- [ ] Settlement latency within SLA
- [ ] Webhook delivery >99.5%
- [ ] No security incidents
- [ ] Privacy controls functioning
- [ ] Data retention job running daily
- [ ] **Decision Gate:** Stable for 1 week

**Phase 3 Result:** ☐ PASS ☐ FAIL ☐ ROLLBACK  
**Notes:** _______________________________________________

---

## Phase 9: Post-Deployment

### Week 1 Review
- [ ] Settlement metrics reviewed
- [ ] Error rates analyzed
- [ ] User feedback collected
- [ ] Any issues documented and resolved
- [ ] Lessons learned documented

### Month 1 Audit
- [ ] Monthly channel state audit completed
- [ ] Backup restoration tested
- [ ] Token rotation scheduled (if needed)
- [ ] Performance trends analyzed
- [ ] Capacity planning updated

### Ongoing Operations
- [ ] Daily: Monitor dashboards
- [ ] Weekly: Review logs for anomalies
- [ ] Monthly: Security audit
- [ ] Quarterly: Token rotation
- [ ] Annually: Disaster recovery drill

---

## Validation Sign-Off

### Development Team
- [ ] Code review completed
- [ ] All tests passing
- [ ] Documentation complete
- [ ] Developer: _________________ Date: _________

### QA Team
- [ ] All testnet tests passed
- [ ] Edge cases validated
- [ ] Performance benchmarks met
- [ ] QA Engineer: _________________ Date: _________

### Security Team
- [ ] Security audit completed
- [ ] No critical vulnerabilities
- [ ] Secrets properly managed
- [ ] Security Lead: _________________ Date: _________

### Operations Team
- [ ] Monitoring configured
- [ ] Alerts tested
- [ ] Runbooks complete
- [ ] Ops Lead: _________________ Date: _________

### Product Team
- [ ] Canary deployment successful
- [ ] User feedback positive
- [ ] Ready for full rollout
- [ ] Product Manager: _________________ Date: _________

---

## Critical Success Criteria

All items must be ✅ before production deployment:

- [ ] **All Phase 4 critical tests passed** (Tests 1, 2, 3, 5, 6, 7)
- [ ] **Monitoring and alerts operational**
- [ ] **Security audit completed with no critical issues**
- [ ] **Documentation complete and team trained**
- [ ] **Backup and recovery procedures tested**
- [ ] **Phase 1 canary deployment successful (48h stable)**

---

## Notes & Issues

Use this section to track any issues, blockers, or important notes during implementation:

| Date | Issue | Resolution | Owner |
|------|-------|------------|-------|
|      |       |            |       |
|      |       |            |       |
|      |       |            |       |

---

## Appendix: Quick Reference

### Key Documentation
- Main Plan: `docs/LN_INTEGRATION_PLAN_V2.md`
- Testing: `docs/E2E_TESTING_GUIDE.md`
- Monitoring: `docs/OBSERVABILITY.md`
- Security: `docs/OPS_KEY_MANAGEMENT.md`
- Deployment: `docs/CANARY_DEPLOYMENT_GUIDE.md`
- Review: `docs/LN_INTEGRATION_REVIEW.md`

### Critical Endpoints
- rail-ln health: `GET http://localhost:5001/health`
- Create invoice: `POST http://localhost:5001/ln/create`
- Settlement callback: `POST http://localhost:5000/api/rails/ln/settled`

### Key Schemas
```typescript
// Callback payload (paymentConfirmationSchema)
{
  invoiceId: string (UUID),
  transactionId: string (payment_hash),
  confirmations: 0,
  blockHeight: null
}
```

### Environment Variables
- `RAIL_AUTH_TOKEN`: Shared auth token (both services)
- `LN_MACAROON_HEX`: Invoice macaroon (rail-ln only)
- `ENABLE_LN`: Feature flag (payments only)

---

*End of Checklist*
