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
- **Features:** Dashboard, invoice creation, invoice detail with QR codes, template management, admin fee policy management, and API documentation.
- **Theming:** Light/dark mode support.
- **Privacy UX:** Privacy notice on invoice creation page, hiding full payment addresses and displaying QR codes.

**Technical Implementations:**
- **Database Storage (DatabaseStorage):** Production-ready PostgreSQL persistence via Drizzle ORM. All invoices, payment transactions, webhook logs, templates, and BTC address derivations survive restarts. MemStorage class retained for reference but unused.
- **Database Migrations:** Drizzle Kit migrations in `migrations/` directory. Generate with `npx drizzle-kit generate`, apply with `npx drizzle-kit push`.
- **Webhook System:** Features HMAC signing, persistent queue, and configurable retry logic for payment confirmations and outgoing notifications.
- **Invoice Expiration:** Automatic checking and UI warnings, with rejection of late payments.
- **Template Management:** Database-backed template storage with full CRUD operations.
- **Payment Transaction History:** Detailed display for paid invoices, including blockchain transaction details and explorer links.
- **Security Enhancements:** Configurable timeouts, robust handling of expired invoices, minimal logging for privacy. Optional `INVOICE_API_KEY` for Bearer-token auth on invoice creation (when set, POST /api/invoices requires `Authorization: Bearer <key>`; GET endpoints remain public).
- **Data Retention & Privacy:** Auto-anonymization of paid invoices (>90 days) via salted hashing, configurable retention policies, and a manual anonymization endpoint.
- **Lightning Network Integration:** Dual-path payment detection via webhooks and polling fallback, shared confirmation logic, production-ready persistence, database indexing for efficient lookups, paginated queries, and idempotency. Instant settlement design with configurable amount limits. Full integration with health, alert, and admin systems. Security hardening with secret protection, input validation, and response filtering. Comprehensive end-to-end testing documentation (Steps 1-8 complete).
- **Multi-Rail Monitoring:** Enhanced structured logging with log levels, tracking of payment lifecycle events and infrastructure events. Sensitive data protection through comprehensive filtering and stack trace sanitization. Per-rail health state tracking with automatic updates (including LN), exposed via `/health` and `/metrics` endpoints. Configurable alert conditions with deduplication and recovery tracking, supporting optional external webhook notifications.
- **Admin/Ops View:** Admin endpoints (`/admin/invoices`, `/admin/invoices/:id`) for viewing invoices with filtering (rail=ln supported), pagination, and detailed transaction information. Includes BOLT11 invoices, payment timestamps, amounts, and debug information for payment tracking and worker status. Protected by ADMIN_API_TOKEN.
- **Service Fee / Licensing Model:** Database-backed fee policies with configurable percentage fees, fixed fees, min/max caps, and per-currency settings. Fees are automatically computed and stored on each invoice at creation time. Admin endpoints for fee policy CRUD (`/admin/fee-policies`) and aggregate fee reporting (`/admin/fee-report`). Supports multi-tenant configurations via optional merchantId. All fee endpoints protected by ADMIN_API_TOKEN. Fee computation extracted to `server/fee-utils.ts` for testability.
- **Automatic Fee Collection:** Operator revenue model with two collection paths: (1) Lightning Network instant forwarding — after payment confirmation, fees are auto-forwarded to the operator's Lightning Address via LNbits outbound payments; (2) BTC/XMR accumulated settlement — fees accumulate until a threshold is reached, then a settlement record is created with the operator's address and a grace period for payment. Overdue settlements block new invoice creation (402 Payment Required). Admin UI shows collection status, settlement history, and mark-as-paid controls. Config: `OPERATOR_LN_ADDRESS`, `LNBITS_ADMIN_KEY`, `OPERATOR_BTC_ADDRESS`, `OPERATOR_XMR_ADDRESS`, `FEE_SETTLEMENT_THRESHOLD_SATS`, `FEE_SETTLEMENT_GRACE_DAYS`.
- **Automated Test Suite:** Vitest-based test suite in `tests/` directory covering fee computation (unit), invoice lifecycle (integration), admin endpoints (auth + CRUD), templates, and health/metrics. Run with `npx vitest run`. Config in `vitest.config.ts`.

**System Design Choices:**
- **Payment Rail Services:** Isolated services (`rail-ln`, `rail-btc`, `rail-xmr`) handle blockchain interactions, communicating with the main payments service via authenticated callbacks.
- **Data Schema:** Defined in `shared/schema.ts` for Invoice, WebhookLog, PaymentTransaction, Template, BtcAddressDerivation, BtcPaymentState, FeePolicy, and FeeSettlement models, with privacy considerations.
- **API Endpoints:** Comprehensive REST API for invoices, templates, webhook callbacks, and development-only payment simulation. Admin endpoints are protected by `ADMIN_API_TOKEN`. Invoice creation optionally protected by `INVOICE_API_KEY`.
- **Configuration:** Extensive use of environment variables for timeouts, retry attempts, feature flags (ENABLE_LN, ENABLE_BTC, ENABLE_XMR), service URLs, and security tokens. Full template in `.env.example`.
- **Observability:** Centralized event logging, alert detection with configurable thresholds, optional webhook notifications for critical alerts, and a `GET /metrics` endpoint.
- **Security:** Strict access control, separation of multiple API tokens (`ADMIN_API_TOKEN`, `RAIL_AUTH_TOKEN`, `INVOICE_API_KEY`), data minimization, and automated log sanitization.

## Project Structure
```
server/
  index.ts          - Express server entry point
  routes.ts         - All API route handlers
  storage.ts        - IStorage interface + DatabaseStorage implementation
  fee-utils.ts      - Fee computation functions (extracted for testability)
  fee-forwarding.ts - Automatic fee collection (LN forwarding, BTC/XMR settlement)
  monitoring.ts     - Health, metrics, alerting
  payment-orchestrator.ts - Multi-rail payment orchestration
  lnbitsClient.ts   - LNbits API client
  ln-*.ts           - Lightning Network specific modules
  db.ts             - Database connection
shared/
  schema.ts         - Drizzle ORM schema (7 tables)
  payment-orchestrator.ts - Shared payment types
  webhook-schema.ts - Webhook payload schemas
client/src/         - React SPA frontend
rail-btc/           - Bitcoin on-chain rail service
rail-ln/            - Lightning Network rail service
rail-xmr/           - Monero rail service
tests/              - Vitest automated test suite
migrations/         - Drizzle Kit database migrations
docs/               - API reference, operations guide, integration guide
docs/archive/       - Historical development documentation
```

## External Dependencies
- **QRCode.react:** For generating QR codes.
- **mempool.space:** Blockchain explorer for Bitcoin transactions.
- **xmrchain.net:** Blockchain explorer for Monero transactions.
- **Payment Rail Services:**
    - `rail-ln/`: Lightning Network listener (LND REST API integration via LNbits).
    - `rail-btc/`: Bitcoin on-chain listener (auto-started as child process).
    - `rail-xmr/`: Monero listener (auto-started as child process, supports XMR_DEV_MODE for simulation).

## Testing
- **Test framework:** Vitest with test files in `tests/` directory
- **Run tests:** `npx vitest run` (requires running server on port 5000)
- **Test categories:**
  - `fee-computation.test.ts` - Unit tests for fee calculation (18 tests)
  - `invoice-lifecycle.test.ts` - Invoice CRUD, fee attachment, API key auth (14 tests)
  - `admin-fee-policy.test.ts` - Admin auth and fee policy CRUD (13 tests)
  - `templates-health.test.ts` - Template CRUD, health, metrics (9 tests)
  - `fee-collection.test.ts` - Fee status, settlement auth, mark-paid, forwarding (8 tests)
- **Note:** Invoice creation tests include waits due to rate limiting (10 req/min)

## Portable Deployment

**Docker Deployment Package:**
- `docker-compose.yml`: Full containerized deployment with health checks and service dependencies
- `Dockerfile`: Multi-stage build for main payments service (non-root user)
- `rail-btc/Dockerfile`: Bitcoin rail service container
- `rail-xmr/Dockerfile`: Monero rail service container
- `setup.sh`: Automated setup script (generates secrets, installs deps, pushes schema)

**Documentation:**
- `README.md`: Quick start and architecture overview
- `docs/API_REFERENCE.md`: Full API documentation with SDK examples (JS/Python)
- `docs/OPERATIONS_GUIDE.md`: Production operations, backup, secrets rotation
- `docs/STANDALONE_INTEGRATION_GUIDE.md`: Third-party deployment guide
- `docs/OBSERVABILITY.md`: Monitoring, alerting, health checks
- `docs/archive/`: Historical development docs (security audits, step summaries, etc.)
