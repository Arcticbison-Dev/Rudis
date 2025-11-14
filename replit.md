# Altostratus Payments

## Overview
Altostratus Payments is a privacy-focused, self-hosted crypto payment invoice system. It generates invoices with QR codes for Bitcoin, Lightning Network, and Monero, tracks their status, and notifies the main Altostratus application upon payment confirmation. The system is designed for a privacy-first approach, avoiding third-party tracking or KYC requirements. Its purpose is to provide a robust, configurable, and secure solution for crypto payments with a clean user interface.

## User Preferences
- Privacy-first: No third-party services, no KYC
- Self-hosted architecture with pluggable blockchain listeners
- Clean, developer-friendly interface inspired by Linear and Stripe
- Fast, responsive interactions with real-time updates
- Support for Bitcoin, Lightning Network, and Monero
- Configurable timeouts and retention policies via environment variables
- Security: Prevent re-use of expired invoice IDs

## System Architecture

Altostratus Payments consists of a React frontend and an Express.js backend, communicating with isolated payment rail services for blockchain interactions.

**UI/UX Decisions:**
- **Frontend Framework:** React SPA with Wouter for routing.
- **Design System:** Tailwind CSS + Shadcn UI, following `design_guidelines.md` (Inter font, Blue primary color, consistent spacing).
- **Interactions:** Fast, responsive, with subtle animations and real-time updates.
- **Features:** Dashboard, invoice creation, invoice detail with QR codes, template management, and API documentation.
- **Theming:** Light/dark mode support.
- **Privacy UX:** Privacy notice on invoice creation page informing users of data retention policy (90-day anonymization, 365-day deletion) with link to payment policy.

**Technical Implementations:**
- **In-memory storage (MemStorage)** for MVP, designed for pluggable blockchain listeners.
- **Webhook System:** For incoming payment confirmations and outgoing notifications, featuring HMAC signing, persistent queue, and configurable retry logic.
- **Invoice Expiration:** Automatic checking and UI warnings.
- **Template Management:** Separate, persistent storage for templates (`templates.json`) for reusable invoice configurations.
- **Payment Transaction History:** Detailed display for paid invoices, including blockchain transaction details and explorer links.
- **Privacy-focused UI:** Hides full payment addresses, displays only QR codes, and offers client-side blockchain explorer links.
- **Security Enhancements:** Configurable timeouts, robust handling of expired invoices (rejection on payment, cleanup job), and minimal logging for privacy.

**System Design Choices:**
- **Payment Rail Services:** Three isolated services (`rail-ln`, `rail-btc`, `rail-xmr`) handle blockchain interactions for Lightning, Bitcoin, and Monero respectively. These communicate with the main payments service via authenticated callbacks (Bearer token).
- **Data Schema:** Defined in `shared/schema.ts` for Invoice, WebhookLog, PaymentTransaction, and Template models, with privacy considerations (e.g., templates exclude user identifiers).
- **API Endpoints:** Comprehensive REST API for invoices, templates, webhook callbacks, and development-only payment simulation.
- **Configuration:** Extensive use of environment variables for timeouts, retry attempts, feature flags (ENABLE_LN, ENABLE_BTC, ENABLE_XMR), service URLs, and security tokens.

## Production Readiness (Completed 2025-11-06)

All 10 production readiness phases completed:

1. **Feature Flags & Simulation**: ENABLE_LN, ENABLE_BTC, ENABLE_XMR flags with startup validation; SIMULATION_ENABLED (default: disabled); simulation source tracking
2. **Rail Callback Security**: Bearer token auth, idempotency checks, minimal structured logging, rejection of expired/paid invoices
3. **Webhook Hardening**: HMAC signing with ALT_WEBHOOK_SECRET, exponential backoff retry (3 attempts), persistent queue, configurable retry delays
4. **E2E Testing Guide**: Comprehensive docs/E2E_TESTING_GUIDE.md covering all 3 rails, edge cases (underpayment, overpayment, reorgs, late payments)
5. **UX Polish**: Privacy-first UI (no PII, QR-only), status badges, client-side explorer links, transaction history
6. **Observability**: docs/OBSERVABILITY.md with structured logging, metrics, alerts, SLA targets (LN <5s, BTC <30min, XMR <25min)
7. **Ops & Key Management**: docs/OPS_KEY_MANAGEMENT.md covering key storage (hardware wallets, view-only access), backup strategies, rotation procedures, disaster recovery
8. **Abuse Prevention**: Rate limiting (10/min invoices, 3/min simulation), feature flag validation, RAIL_AUTH_TOKEN enforcement
9. **Data Retention & Privacy**: Auto-anonymization (90-day paid invoices, salted hash), configurable retention (RETENTION_PAID_DAYS, RETENTION_MAX_DAYS), manual anonymization endpoint (POST /api/privacy/anonymize/:id)
10. **Policy Documentation**: docs/CRYPTO_PAYMENT_POLICY.md (payment handling, refunds, reorgs, security), docs/STATUS_SEMANTICS.md (status definitions, flow diagrams, edge cases)

**Security Enhancements:**
- Salted hashing for invoice anonymization (crypto.randomBytes salt + SHA256)
- Structured privacy-minimal logging (invoiceId, rail, event only)
- HMAC webhook signing for Altostratus integration
- Manual privacy endpoint for GDPR compliance
- Automatic cleanup jobs (webhooks: hourly, retention: daily)

**Configuration:**
- All feature flags default to secure state (all disabled)
- Configurable timeouts and retention via environment variables
- Separate tokens for rail auth (RAIL_AUTH_TOKEN) and admin (ADMIN_SIM_TOKEN)
- Webhook secret rotation support (ALT_WEBHOOK_SECRET)

## External Dependencies
- **QRCode.react:** For generating QR codes.
- **mempool.space:** Blockchain explorer for Bitcoin transactions.
- **xmrchain.net:** Blockchain explorer for Monero transactions.
- **Payment Rail Services:**
    - `rail-ln/`: Lightning Network listener.
    - `rail-btc/`: Bitcoin on-chain listener.
    - `rail-xmr/`: Monero listener.

## Lightning Network Implementation (Completed 2025-11-06)

**rail-ln Service (Production-Ready):**
- **Location:** `rail-ln/` directory with complete TypeScript implementation
- **Features:**
  - LND REST API integration with invoice creation and settlement monitoring
  - Zod schema validation (invoiceId UUID, amountMsat 1-10M range, memo 100 char limit)
  - Rate limiting (10 req/min per-IP tracking)
  - Structured JSON logging (privacy-safe, no PII)
  - Health check with LND connection status
  - Graceful degradation when misconfigured (503 responses, no process.exit)
  - 2-second settlement polling with callback to payments service
  - Multi-path payment (MPP) support configurable
  - TypeScript with strict type safety

**Configuration:**
- `rail-ln/.env.example` - Complete environment variable template
- `rail-ln/package.json` - v2.0.0 with all dependencies (express, zod, axios)
- `rail-ln/tsconfig.json` - TypeScript configuration (CommonJS, ES2022)
- `rail-ln/README.md` - Comprehensive service documentation

**Integration:**
- Payments service `/api/rails/ln/settled` endpoint verified
- `authenticateRailCallback` middleware with RAIL_AUTH_TOKEN validation
- `paymentConfirmationSchema` matches rail-ln callback format
- Idempotency checks for already_paid and expired invoices
- Feature flag `ENABLE_LN` in payments service

**Deployment:**
- `DEPLOYMENT.md` - 8-step deployment guide covering LND setup, service deployment, E2E testing, monitoring, security, backup/recovery, canary rollout, and troubleshooting
- Separate microservice architecture (runs on port 5001, independent from payments service)
- Health checks and monitoring configured
- **Status:** Production-ready for Phase 0 testnet deployment

**Canary Rollout Preparation (2025-11-07):**
- Analyzed external canary rollout plan document
- Identified and fixed 4 critical errors:
  1. Environment variable naming (ALT_PAYMENTS_BASE → PAYMENTS_SERVICE_URL documented)
  2. Added missing `/health` endpoint to payments service
  3. Health response format documented (matches implementation)
  4. Prometheus metrics noted as Phase 1 enhancement (logs sufficient for Phase 0)
- Created `docs/CANARY_ROLLOUT_ANALYSIS.md` - Gap analysis and recommendations
- Created `docs/CANARY_ROLLOUT_PLAN_CORRECTED.md` - Production-ready canary plan with corrected configuration
- Payments service health endpoint: `GET /health` (200/503 with storage/webhook status)
- All Priority 1 blockers resolved

**Security Hardening (2025-11-07):**
- Fixed critical webhook signing vulnerability (architect-identified):
  - Added startup validation requiring ALT_WEBHOOK_SECRET when ALTOSTRATUS_WEBHOOK_URL configured
  - Updated generateWebhookSignature() to fail-safe (throws error if secret missing)
  - Removed conditional signature header - webhooks now always signed
  - Server refuses to start if webhooks configured without signing secret
- Verified inbound rail callback authentication (Bearer tokens with RAIL_AUTH_TOKEN)
- Architect confirmed: No critical security gaps, Phase 0 ready
- Test tracking template added to canary rollout documentation

**Rail-BTC Security Fix (2025-11-14):**
- Fixed critical vulnerability: `/create` endpoint was publicly accessible
  - Added `authenticatePaymentsService` middleware requiring RAIL_AUTH_TOKEN
  - Applied to `POST /create` endpoint to prevent unauthorized address generation
  - Payments service now sends `Authorization: Bearer ${RAIL_AUTH_TOKEN}` header
- Security audit completed: All three requirements verified
  1. ✅ Payments service has rate limiting (10/min per IP on invoice creation)
  2. ✅ Rail-BTC requires authentication from payments service only
  3. ✅ No public endpoint generates unlimited BTC addresses without auth
- Documentation: `docs/RAIL_SECURITY_AUDIT_2025-11-14.md`

**Data Retention & Privacy (2025-11-14):**
- Implemented complete privacy compliance:
  1. ✅ Auto-expiration: Periodic job (every 30s) marks invoices as expired when expiresAt passes
  2. ✅ Late payments: Rejected with 400 error, logged as "expired", not processed
  3. ✅ Auto-anonymization: Paid invoices >90 days hashed (salted SHA256), job runs every 24h
  4. ✅ No PII: Zero user identifiers in schema, only PUBLIC blockchain hashes stored long-term
- Policy: RETENTION_PAID_DAYS=90, RETENTION_MAX_DAYS=365, AUTO_ANONYMIZE_ENABLED=true
- Manual override: `POST /api/privacy/anonymize/:id` for GDPR requests
- Documentation: `docs/DATA_RETENTION_POLICY_2025-11-14.md`

**Final Security Review (2025-11-14):**
- ✅ **ARCHITECT APPROVED FOR PRODUCTION**
- All 7 security criteria verified and passed:
  1. ✅ All secrets are env-vars (never logged/hardcoded)
  2. ✅ RAIL_AUTH_TOKEN enforced on all endpoints (bidirectional)
  3. ✅ No IPs, addresses, or txids logged (privacy-minimal structured logging only)
  4. ✅ Unique address per invoice guaranteed (BIP84 HD derivation, DB unique constraint)
  5. ✅ Confirmations logic + idempotent state updates (state machine, duplicate handling)
  6. ✅ Webhooks HMAC-verified end-to-end (cryptographic signing, replay protection)
  7. ✅ Expiration + 90-day retention rules (auto-expiration, auto-anonymization)
- Documentation: `docs/FINAL_SECURITY_REVIEW_2025-11-14.md`
- Status: **READY FOR PRODUCTION DEPLOYMENT**

## Documentation Suite
- `docs/E2E_TESTING_GUIDE.md`: End-to-end testing procedures for all rails
- `docs/OBSERVABILITY.md`: Monitoring, logging, metrics, and alerting
- `docs/OPS_KEY_MANAGEMENT.md`: Key storage, backups, rotation, disaster recovery
- `docs/CRYPTO_PAYMENT_POLICY.md`: Payment handling policies and compliance
- `docs/STATUS_SEMANTICS.md`: Invoice status definitions and transitions
- `docs/CANARY_DEPLOYMENT_GUIDE.md`: Phased production rollout guide (testnet → LN → BTC → XMR)
- `docs/LN_INTEGRATION_PLAN_V2.md`: Lightning Network (LND) implementation guide with TypeScript reference
- `docs/LN_INTEGRATION_REVIEW.md`: Review of original LN integration plan with gap analysis
- `docs/LN_IMPLEMENTATION_CHECKLIST.md`: Complete implementation and validation checklist for LN integration
- `docs/CANARY_ROLLOUT_ANALYSIS.md`: Gap analysis of external canary plan with fixes (2025-11-07)
- `docs/CANARY_ROLLOUT_PLAN_CORRECTED.md`: Production-ready canary rollout plan with corrected config (2025-11-07)
- `DEPLOYMENT.md`: Lightning Network deployment guide (LND setup, rail-ln service, E2E testing)