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