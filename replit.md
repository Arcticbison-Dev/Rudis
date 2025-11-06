# Altostratus Payments

## Overview
A self-hosted crypto payment invoice system that creates invoices, displays them with QR codes, and notifies the main Altostratus app when payments are confirmed. Privacy-focused with no third-party tracking or KYC requirements.

## Purpose
- Create crypto payment invoices for Bitcoin, Lightning Network, and Monero
- Display invoices with QR codes for easy wallet scanning
- Track invoice status (pending, paid, expired)
- Receive webhook notifications from blockchain listeners
- Send webhook notifications to the main Altostratus app when invoices are paid

## Current State
MVP implementation with enhanced features:
- Complete schema for invoices, webhook logs, payment transactions, and templates
- Full frontend with dashboard, invoice creation, invoice detail, templates, and API documentation pages
- Template management system for reusable invoice configurations
- Invoice expiration system with automatic checking and UI warnings
- Webhook retry history display showing all delivery attempts
- Payment transaction history for paid invoices with blockchain details
- In-memory storage (ready for pluggable blockchain listeners)
- Simulated payment confirmation system for testing
- Beautiful, responsive UI following design guidelines with dark mode support

## Recent Changes
- 2025-11-06: Template schema privacy update
  - **No User Identifiers**: Templates now only store { templateId, planName, asset, amountUsd, interval, description }
  - **Removed Fields**: Eliminated paymentAddress (user identifier) and expiresInHours from templates
  - **New Field**: Added interval field for billing cycle (one-time, monthly, yearly)
  - **Field Renames**: name → planName, currency → asset, amount → amountUsd for clarity
- 2025-11-06: Webhook reliability and security enhancements
  - **HMAC Signing**: All webhooks signed with X-Altostratus-Signature header using ALT_WEBHOOK_SECRET (HMAC-SHA256)
  - **Persistent Queue**: Webhooks survive server restarts, continue from where they left off, process every 5 seconds
  - **Minimal Logging**: Only stores attempt counter, timestamps, status, error message - no payload/responseBody for privacy
  - **Auto-Cleanup**: Failed webhooks deleted after 10 attempts or 24 hours (configurable), runs automatically every hour
- 2025-11-06: Security and operational improvements
  - **Configurable Timeouts**: All timeouts via environment variables (webhook, retry, expiration warning, cleanup retention) with NaN guards
  - **Expired Invoice Protection**: Payment webhook rejects expired invoices with 400 error - prevents invoice ID re-use
  - **Cleanup Job**: POST /api/invoices/cleanup endpoint purges expired invoices older than 30-90 days (configurable) with cascade delete
- 2025-11-06: Completed four major feature enhancements
  - **Invoice Expiration**: Automatic expiration checking via POST /api/invoices/check-expired, UI warnings for expired/expiring invoices
  - **Webhook Retry Display**: Full webhook attempt history on invoice detail page with status codes, error messages, response bodies
  - **Template Creation**: Complete template CRUD with dedicated /templates page, create-invoice-from-template workflow, text-based schema for consistency
  - **Payment History**: Transaction display for paid invoices showing transaction IDs, confirmations, block height, timestamps with copy functionality
- 2025-11-04: Initial MVP implementation
  - Defined invoice data schema with TypeScript interfaces
  - Built all React components with exceptional visual quality
  - Implemented theme system with light/dark mode support
  - Created dashboard with stats cards and invoice listing
  - Built invoice creation form with currency selection
  - Implemented invoice detail page with QR code generation
  - Added API documentation page with endpoint examples
  - Configured design tokens in tailwind.config.ts

## Project Architecture

### Frontend (`client/`)
- **React SPA** with Wouter for routing
- **Tailwind CSS + Shadcn UI** for design system
- **React Query** for data fetching and caching
- **QRCode.react** for payment QR code generation
- **Theme system** with light/dark mode support

#### Key Components
- `InvoiceCard`: Display invoice summary on dashboard
- `StatusBadge`: Visual status indicators with colors and animations
- `CopyButton`: One-click copy for addresses and codes
- `StatsCard`: Dashboard statistics display
- `ThemeToggle`: Light/dark mode switcher

#### Pages
- `/` - Dashboard with invoice list and statistics
- `/create` - Create new invoice form (supports template pre-fill via query params)
- `/invoice/:id` - Invoice detail with QR code, payment info, webhook logs, and transaction history
- `/templates` - Template management with create/edit/delete/use actions
- `/api-docs` - API documentation and examples

### Backend (`server/`)
- **Express.js** server
- **In-memory storage** (MemStorage) for MVP
- **REST API** for invoice CRUD operations
- **Webhook system** for incoming payment confirmations and outgoing notifications

#### API Endpoints
**Invoices:**
- `POST /api/invoices` - Create new invoice
- `GET /api/invoices` - List all invoices (auto-checks expiration)
- `GET /api/invoices/:id` - Get invoice by ID (auto-checks expiration)
- `POST /api/invoices/check-expired` - Manual expiration check for schedulers
- `GET /api/invoices/:id/webhook-logs` - Get webhook delivery history
- `GET /api/invoices/:id/transactions` - Get payment transactions

**Templates:**
- `POST /api/templates` - Create template
- `GET /api/templates` - List all templates
- `GET /api/templates/:id` - Get template by ID
- `PATCH /api/templates/:id` - Update template
- `DELETE /api/templates/:id` - Delete template

**Webhooks:**
- `POST /api/webhooks/payment-confirmed` - Receive payment confirmation from blockchain listener

### Data Schema (`shared/schema.ts`)
**Invoice Model:**
- `id`: UUID
- `amount`: Decimal (18,8 precision)
- `currency`: BTC | Lightning | XMR
- `description`: Text
- `paymentAddress`: Crypto address
- `status`: pending | paid | expired
- `createdAt`: Timestamp
- `paidAt`: Timestamp (nullable)
- `expiresAt`: Timestamp (nullable)

**WebhookLog Model:**
- `id`: UUID
- `invoiceId`: Reference to invoice
- `url`: Webhook destination URL
- `status`: pending | success | failed
- `statusCode`: HTTP status code (nullable)
- `errorMessage`: Error details (nullable)
- `attempt`: Attempt number
- `retryAfter`: Next retry timestamp (nullable)
- `createdAt`: Timestamp
- `lastAttemptAt`: Last delivery attempt timestamp (nullable)

**PaymentTransaction Model:**
- `id`: UUID
- `invoiceId`: Reference to invoice
- `transactionId`: Blockchain transaction hash
- `confirmations`: Number of confirmations
- `blockHeight`: Block number (nullable)
- `confirmedAt`: Confirmation timestamp

**Template Model (No User Identifiers):**
- `id`: UUID (templateId)
- `planName`: Plan name (e.g., "Pro Monthly")
- `asset`: BTC | Lightning | XMR
- `amountUsd`: Preset amount in USD (nullable)
- `interval`: one-time | monthly | yearly (nullable)
- `description`: Plan description (nullable)
- `createdAt`: Timestamp
- Note: Templates intentionally exclude user identifiers like wallet addresses or user IDs

## User Preferences
- Privacy-first: No third-party services, no KYC
- Self-hosted architecture with pluggable blockchain listeners
- Clean, developer-friendly interface inspired by Linear and Stripe
- Fast, responsive interactions with real-time updates
- Support for Bitcoin, Lightning Network, and Monero
- Configurable timeouts and retention policies via environment variables
- Security: Prevent re-use of expired invoice IDs

## Design Guidelines
Following `design_guidelines.md`:
- Typography: Inter for UI, JetBrains Mono for data
- Color scheme: Blue primary (217, 91%, 35%) with neutral grays
- Spacing: Consistent 6-8 units between elements
- Components: Shadcn UI with custom styling
- Animations: Subtle, purposeful (QR fade-in, status pulse)
- Responsive: Mobile-first with breakpoints at md/lg/xl

## Development Status
**Phase 1 Complete:** Schema & Frontend ✓
**Phase 2 Complete:** Backend Implementation ✓
**Phase 3 Complete:** Enhanced Features ✓

All features implemented and architect-reviewed:
- Invoice expiration with automatic checking
- Webhook retry history display
- Template management system
- Payment transaction history
- Complete CRUD operations for all entities
- Simulated payment confirmation endpoint
- Error handling and loading states
- Dark mode support throughout

## Configuration
All timeouts and thresholds are configurable via environment variables (see `.env.example`):
- `WEBHOOK_TIMEOUT_MS`: Webhook request timeout (default: 10000ms)
- `WEBHOOK_RETRY_ATTEMPTS`: Retry attempts for failed webhooks (default: 3)
- `WEBHOOK_RETRY_DELAY_1/2/3`: Exponential backoff delays (default: 1000, 3000, 9000ms)
- `VITE_EXPIRING_SOON_HOURS`: Hours before expiration to show warning (default: 1)
- `CLEANUP_EXPIRED_DAYS`: Days to retain expired invoices (30-90 range, default: 90)
- `ALTOSTRATUS_WEBHOOK_URL`: URL to send payment notifications to main app

## Scheduled Maintenance
The system requires two periodic jobs (see API docs for cron examples):
1. **Expiration Check**: Run hourly to expire pending invoices (POST /api/invoices/check-expired)
2. **Cleanup Job**: Run daily to purge old expired invoices (POST /api/invoices/cleanup)

## Future Enhancements
- Real Lightning Network listener integration
- Bitcoin on-chain listener with configurable confirmations
- Monero blockchain listener
- Blockchain explorer links for transactions
