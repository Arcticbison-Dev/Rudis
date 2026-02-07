# Altostratus Payments

## Overview
Altostratus Payments is a privacy-focused, self-hosted crypto payment invoice system. It generates invoices with QR codes for Bitcoin, Lightning Network, and Monero, tracks their status, and notifies the main Altostratus application upon payment confirmation. The system prioritizes privacy, avoiding third-party tracking or KYC, providing a robust, configurable, and secure solution with a clean user interface.

## User Preferences
- Privacy-first: No third-party services, no KYC
- Self-hosted architecture with pluggable blockchain listeners
- Clean, developer-friendly interface inspired by Linear and Stripe
- Fast, responsive interactions with real-time updates
- Support for Bitcoin, Lightning Network, and Monero
- Configurable timeouts and retention policies via environment variables
- Security: Prevent re-use of expired invoice IDs

## System Architecture
Altostratus Payments utilizes a React frontend and an Express.js backend, communicating with isolated payment rail services for blockchain interactions.

**UI/UX Decisions:**
- **Frontend Framework:** React SPA with Wouter for routing.
- **Design System:** Tailwind CSS + Shadcn UI, following `design_guidelines.md` (Inter font, Blue primary color, consistent spacing).
- **Interactions:** Fast, responsive, with subtle animations and real-time updates.
- **Features:** Dashboard, invoice creation, invoice detail with QR codes, template management, and API documentation.
- **Theming:** Light/dark mode support.
- **Privacy UX:** Privacy notice on invoice creation page, hiding full payment addresses and displaying QR codes.

**Technical Implementations:**
- **In-memory storage (MemStorage):** Designed for pluggable blockchain listeners.
- **Webhook System:** Features HMAC signing, persistent queue, and configurable retry logic for payment confirmations and outgoing notifications.
- **Invoice Expiration:** Automatic checking and UI warnings, with rejection of late payments.
- **Template Management:** Separate, persistent storage for `templates.json`.
- **Payment Transaction History:** Detailed display for paid invoices, including blockchain transaction details and explorer links.
- **Security Enhancements:** Configurable timeouts, robust handling of expired invoices, and minimal logging for privacy.
- **Data Retention & Privacy:** Auto-anonymization of paid invoices (>90 days) via salted hashing, configurable retention policies, and a manual anonymization endpoint.
- **Lightning Network Integration:** Dual-path payment detection via webhooks and polling fallback, shared confirmation logic, production-ready persistence, database indexing for efficient lookups, paginated queries, and idempotency. Instant settlement design with configurable amount limits. Full integration with health, alert, and admin systems. Security hardening with secret protection, input validation, and response filtering. Comprehensive end-to-end testing documentation (Steps 1-8 complete).
- **Multi-Rail Monitoring:** Enhanced structured logging with log levels, tracking of payment lifecycle events and infrastructure events. Sensitive data protection through comprehensive filtering and stack trace sanitization. Per-rail health state tracking with automatic updates (including LN), exposed via `/health` and `/metrics` endpoints. Configurable alert conditions with deduplication and recovery tracking, supporting optional external webhook notifications.
- **Admin/Ops View:** Admin endpoints (`/admin/invoices`, `/admin/invoices/:id`) for viewing invoices with filtering (rail=ln supported), pagination, and detailed transaction information. Includes BOLT11 invoices, payment timestamps, amounts, and debug information for payment tracking and worker status. Protected by ADMIN_API_TOKEN.

**System Design Choices:**
- **Payment Rail Services:** Isolated services (`rail-ln`, `rail-btc`, `rail-xmr`) handle blockchain interactions, communicating with the main payments service via authenticated callbacks.
- **Data Schema:** Defined in `shared/schema.ts` for Invoice, WebhookLog, PaymentTransaction, and Template models, with privacy considerations.
- **API Endpoints:** Comprehensive REST API for invoices, templates, webhook callbacks, and development-only payment simulation. Admin endpoints are protected by `ADMIN_API_TOKEN`.
- **Configuration:** Extensive use of environment variables for timeouts, retry attempts, feature flags (ENABLE_LN, ENABLE_BTC, ENABLE_XMR), service URLs, and security tokens.
- **Observability:** Centralized event logging, alert detection with configurable thresholds, optional webhook notifications for critical alerts, and a `GET /metrics` endpoint.
- **Security:** Strict access control, separation of multiple API tokens (`ADMIN_API_TOKEN`, `RAIL_AUTH_TOKEN`, etc.), data minimization, and automated log sanitization.

## External Dependencies
- **QRCode.react:** For generating QR codes.
- **mempool.space:** Blockchain explorer for Bitcoin transactions.
- **xmrchain.net:** Blockchain explorer for Monero transactions.
- **Payment Rail Services:**
    - `rail-ln/`: Lightning Network listener (LND REST API integration via LNbits).
    - `rail-btc/`: Bitcoin on-chain listener (auto-started as child process).
    - `rail-xmr/`: Monero listener (auto-started as child process, supports XMR_DEV_MODE for simulation).

## Lightning Network Testing & Deployment

**Step 8 Documentation (Complete):**
- Comprehensive end-to-end testing procedures: `STEP8_LN_E2E_TESTING.md`
- Automated test suite: `test-ln-e2e.sh`
- Quick start guide: `LN_TESTING_QUICKSTART.md`
- Test execution report: `STEP8_TEST_EXECUTION_REPORT.md`
- Security validation: `STEP7_LN_SECURITY_PRIVACY.md`

**Testing Status:**
- ✅ **Error Handling Validated**: System properly handles missing LNbits configuration
- ✅ **Security Validated**: Webhook authentication, input validation, response filtering
- ✅ **System Resilience Validated**: No crashes, graceful degradation, clear error messages
- ⏸️ **Happy Path Testing**: Requires live LNbits instance (complete procedures documented)

**To Complete End-to-End Testing:**
1. Set up LNbits instance (self-hosted or cloud: https://legend.lnbits.com)
2. Configure environment variables (see `LN_TESTING_QUICKSTART.md`)
3. Run automated test suite: `./test-ln-e2e.sh`
4. Follow manual test procedures in `STEP8_LN_E2E_TESTING.md`

**Production Deployment Readiness:**
- Architecture: ✅ Complete and production-ready
- Documentation: ✅ Comprehensive testing guides and procedures
- Automation: ✅ Test suite ready for validation
- Security: ✅ All measures implemented and validated
- Error Handling: ✅ Validated and working correctly
- Final Validation: ⏸️ Requires LNbits configuration (procedures provided)

## Portable Deployment

**Docker Deployment Package (Complete):**
- `docker-compose.yml`: Full containerized deployment with health checks and service dependencies
- `Dockerfile`: Multi-stage build for main payments service (non-root user)
- `rail-btc/Dockerfile`: Bitcoin rail service container
- `rail-xmr/Dockerfile`: Monero rail service container

**Deployment Profiles:**
```bash
# Lightning only (simplest)
docker-compose up -d

# With Bitcoin rail
docker-compose --profile btc up -d

# With all rails
docker-compose --profile btc --profile xmr up -d
```

**Documentation for Third-Party Integrators:**
- `docs/STANDALONE_INTEGRATION_GUIDE.md`: Complete integration guide for standalone deployment
- `docs/API_REFERENCE.md`: Full API documentation with SDK examples (JS/Python)
- `docs/OPERATIONS_GUIDE.md`: Production operations, backup, secrets rotation, billing automation

**Licensing/Service Fee Model:**
- Percentage-based, fixed, or hybrid fee patterns documented
- Multi-tenant configuration examples
- Rate limiting by subscription tier
- Monthly billing report generation

**White-Label Deployment:**
- Remove Altostratus branding from frontend
- Configure custom domain
- Customize webhook signature prefix
- Template customization for emails/notifications