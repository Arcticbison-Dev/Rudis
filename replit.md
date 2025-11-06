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

## Documentation Suite
- `docs/E2E_TESTING_GUIDE.md`: End-to-end testing procedures for all rails
- `docs/OBSERVABILITY.md`: Monitoring, logging, metrics, and alerting
- `docs/OPS_KEY_MANAGEMENT.md`: Key storage, backups, rotation, disaster recovery
- `docs/CRYPTO_PAYMENT_POLICY.md`: Payment handling policies and compliance
- `docs/STATUS_SEMANTICS.md`: Invoice status definitions and transitions
- `docs/CANARY_DEPLOYMENT_GUIDE.md`: Phased production rollout guide (testnet → LN → BTC → XMR)