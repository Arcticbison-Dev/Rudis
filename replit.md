# Altostratus Payments

## Overview
Altostratus Payments is a privacy-focused, self-hosted crypto payment invoice system. It generates invoices with QR codes for Bitcoin, Lightning Network, and Monero, tracks their status, and notifies the main Altostratus application upon payment confirmation. The system is designed for a privacy-first approach, avoiding third-party tracking or KYC requirements, providing a robust, configurable, and secure solution with a clean user interface.

## User Preferences
- Privacy-first: No third-party services, no KYC
- Self-hosted architecture with pluggable blockchain listeners
- Clean, developer-friendly interface inspired by Linear and Stripe
- Fast, responsive interactions with real-time updates
- Support for Bitcoin, Lightning Network, and Monero
- Configurable timeouts and retention policies via environment variables
- Security: Prevent re-use of expired invoice IDs

## Recent Changes

**Lightning Network Integration Tasks 1-5 (2025-11-19) - COMPLETE:**
- ✅ **Task 1**: Data model verification - All 4 required LN fields present in schema and database
- ✅ **Task 2**: Safe-stubbed LN adapter with controlled error handling and database-only fallback
- ✅ **Task 3**: API behavior - POST /payments returns `ln_not_implemented` (503), GET supports DB-only reads
- ✅ **Task 4**: Configuration surface for future LN backends (LND, CLN, LNbits, Eclair)
- ✅ **Task 5**: Logging & monitoring hooks - Structured events with rail='ln', payment.create_failed event

**Multi-Rail Monitoring System - Step 1 (2025-11-19) - COMPLETE:**
- ✅ **Enhanced Structured Logging**: Added log levels (info, warn, error, alert) with auto-detection
- ✅ **Payment Lifecycle Events**: All events tracked (created, pending, confirmed, expired, failed, error)
- ✅ **Infrastructure Events**: poll.started, poll.completed, poll.failed, webhook events, rail health
- ✅ **Sensitive Data Protection**: Comprehensive filtering (17 patterns) - no keys, seeds, passwords, tokens
- ✅ **Error Logging**: Stack trace sanitization, deduplication, alert cooldowns
- ✅ **Alert Conditions**: 5 configured alerts for payment failures, errors, polls, webhooks, rail health

**Multi-Rail Monitoring System - Step 2 (2025-11-19) - COMPLETE:**
- ✅ **Per-Rail Health State Tracking**: lastSuccessfulPollAt, lastPollErrorAt, consecutivePollFailures, lastPaymentConfirmedAt
- ✅ **Health Status Calculation**: ok (0-2 failures), degraded (3-4 failures), error (5+ failures or stale data)
- ✅ **Automatic Health Updates**: Via logPollCompleted(), logPollFailed(), logPaymentStatus()
- ✅ **Global Health Snapshot**: Overall status derived from all rails (most severe wins)
- ✅ **Enhanced Endpoints**: GET /health and GET /metrics now include per-rail health state
- ✅ **Stale Data Detection**: Error status if no successful polls for >10 minutes

**Multi-Rail Monitoring System - Step 3 (2025-11-19) - COMPLETE:**
- ✅ **/health Endpoint**: GET /health with exact specification format (status, rails, timestamps)
- ✅ **Fast Implementation**: In-memory state + lightweight DB query only (<20ms response)
- ✅ **No RPC Calls**: No network I/O to blockchain nodes or external services
- ✅ **Read-Only**: No state mutations, safe for repeated health checks
- ✅ **Security**: Public endpoint with no sensitive data (no secrets, stack traces, detailed errors)
- ✅ **HTTP Status Codes**: 200 for ok/degraded, 503 for error state
- ✅ **Rail States**: Handles disabled, not_implemented, ok, degraded, error statuses

**Multi-Rail Monitoring System - Step 4 (2025-11-19) - COMPLETE:**
- ✅ **Alert Conditions**: Per-rail (poll failures ≥3, rail down ≥5, stale polling >10min, stuck payments) + Global (config errors, database errors)
- ✅ **Alert Emission**: Single centralized location (updateRailHealthStatus) emits rail.degraded, rail.down, rail.recovered events with level="alert"
- ✅ **Alert Payload**: Includes rail, event, reason, counters (consecutivePollFailures), timestamps (lastPollErrorAt, lastSuccessfulPollAt)
- ✅ **Webhook Notifier**: Optional external webhook (ALERT_WEBHOOK_URL) for integration with monitoring services
- ✅ **De-duplication**: 15-minute cooldown per alert+rail combination prevents spam
- ✅ **Recovery Tracking**: Automatic rail.recovered events when transitioning from degraded/error → ok
- ✅ **State Change Detection**: Only emits alerts on status transitions, not on every poll failure
- ✅ **Global Alert Helpers**: logConfigError(), logDatabaseError(), logPaymentStuck() for system-wide issues

**Admin / Ops View - Invoices - Step 5 (2025-11-19) - COMPLETE:**
- ✅ **Admin Endpoint Basics**: GET /admin/invoices with filtering via query params (rail, status, created_after, created_before)
- ✅ **Invoice List View**: Shows id, rail, asset, amount_atomic, status, created_at, updated_at, address (BTC/XMR), invoice_bolt11 (LN)
- ✅ **Security**: Admin endpoints protected by ADMIN_API_TOKEN (separate from RAIL_AUTH_TOKEN)
- ✅ **Authentication Middleware**: authenticateAdminApi() validates Bearer token for all admin endpoints
- ✅ **Pagination**: Supports limit (max 1000) and offset query params
- ✅ **Filtering**: By rail (btc/xmr/ln), status (pending/confirmed/expired/failed), date range
- ✅ **Response Format**: JSON with invoices array, total count, limit, offset
- ✅ **API Convention**: Uses "ln" in API (lowercase), "Lightning" in database (proper conversion)

**Admin / Ops View - Invoice Detail & Transactions - Step 6 (2025-11-19) - COMPLETE:**
- ✅ **Invoice Detail Endpoint**: GET /admin/invoices/:id returns complete invoice data
- ✅ **All Invoice Fields**: id, rail, asset, amount_atomic, status, timestamps, rail-specific fields
- ✅ **BTC/XMR Fields**: address, tx_hash (if stored on invoice)
- ✅ **LN Fields**: invoice_bolt11, expires_at, paid_at, amount_paid_atomic
- ✅ **Linked Transactions**: All payment_transactions records for invoice
- ✅ **Transaction Details**: tx_hash, rail, amount_atomic, confirmations, block_height, timestamps
- ✅ **BTC Payment State**: state machine tracking (unseen/pending/confirmed/settled)
- ✅ **Debug Information**: has_been_seen_on_chain, is_being_polled, time_since_last_check, needs_attention
- ✅ **Debug Usefulness**: Can answer "Has payment been seen?", "How many confirmations?", "Is worker polling?"

## System Architecture
Altostratus Payments uses a React frontend and an Express.js backend, communicating with isolated payment rail services for blockchain interactions.

**UI/UX Decisions:**
- **Frontend Framework:** React SPA with Wouter for routing.
- **Design System:** Tailwind CSS + Shadcn UI, following `design_guidelines.md` (Inter font, Blue primary color, consistent spacing).
- **Interactions:** Fast, responsive, with subtle animations and real-time updates.
- **Features:** Dashboard, invoice creation, invoice detail with QR codes, template management, and API documentation.
- **Theming:** Light/dark mode support.
- **Privacy UX:** Privacy notice on invoice creation page, hiding full payment addresses and displaying QR codes.

**Technical Implementations:**
- **In-memory storage (MemStorage)** for MVP, designed for pluggable blockchain listeners.
- **Webhook System:** Features HMAC signing, persistent queue, and configurable retry logic for payment confirmations and outgoing notifications.
- **Invoice Expiration:** Automatic checking and UI warnings, with rejection of late payments.
- **Template Management:** Separate, persistent storage for `templates.json`.
- **Payment Transaction History:** Detailed display for paid invoices, including blockchain transaction details and explorer links.
- **Security Enhancements:** Configurable timeouts, robust handling of expired invoices, and minimal logging for privacy.
- **Data Retention & Privacy:** Auto-anonymization of paid invoices (>90 days) via salted hashing, configurable retention policies, and a manual anonymization endpoint.

**System Design Choices:**
- **Payment Rail Services:** Isolated services (`rail-ln`, `rail-btc`, `rail-xmr`) handle blockchain interactions, communicating with the main payments service via authenticated callbacks.
- **Data Schema:** Defined in `shared/schema.ts` for Invoice, WebhookLog, PaymentTransaction, and Template models, with privacy considerations.
- **API Endpoints:** Comprehensive REST API for invoices, templates, webhook callbacks, and development-only payment simulation.
- **Configuration:** Extensive use of environment variables for timeouts, retry attempts, feature flags (ENABLE_LN, ENABLE_BTC, ENABLE_XMR), service URLs, and security tokens.
- **Observability:** Centralized event logging, alert detection with configurable thresholds, optional webhook notifications for critical alerts, and a `GET /metrics` endpoint.

## External Dependencies
- **QRCode.react:** For generating QR codes.
- **mempool.space:** Blockchain explorer for Bitcoin transactions.
- **xmrchain.net:** Blockchain explorer for Monero transactions.
- **Payment Rail Services:**
    - `rail-ln/`: Lightning Network listener (LND REST API integration).
    - `rail-btc/`: Bitcoin on-chain listener.
    - `rail-xmr/`: Monero listener.