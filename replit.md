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
MVP implementation with:
- Complete schema for invoices and webhook logs
- Full frontend with dashboard, invoice creation, invoice detail pages, and API documentation
- In-memory storage (ready for pluggable blockchain listeners)
- Simulated payment confirmation system for testing
- Beautiful, responsive UI following design guidelines

## Recent Changes
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
- `/create` - Create new invoice form
- `/invoice/:id` - Invoice detail with QR code and payment info
- `/api-docs` - API documentation and examples

### Backend (`server/`)
- **Express.js** server
- **In-memory storage** (MemStorage) for MVP
- **REST API** for invoice CRUD operations
- **Webhook system** for incoming payment confirmations and outgoing notifications

#### API Endpoints (planned)
- `POST /api/invoices` - Create new invoice
- `GET /api/invoices` - List all invoices
- `GET /api/invoices/:id` - Get invoice by ID
- `POST /api/webhooks/payment-confirmed` - Receive payment confirmation from blockchain listener
- Internal webhook sender to notify main Altostratus app

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
- `status`: success | failed
- `createdAt`: Timestamp

## User Preferences
- Privacy-first: No third-party services, no KYC
- Self-hosted architecture with pluggable blockchain listeners
- Clean, developer-friendly interface inspired by Linear and Stripe
- Fast, responsive interactions with real-time updates
- Support for Bitcoin, Lightning Network, and Monero

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
- All data models defined
- All React components built with exceptional quality
- Design system configured
- Theme system implemented

**Phase 2 Pending:** Backend Implementation
- API endpoints
- Storage interface
- Simulated payment confirmation
- Webhook sender/receiver

**Phase 3 Pending:** Integration & Testing
- Connect frontend to backend
- Add error handling and loading states
- Test core functionality
- Architect review

## Future Enhancements
- Real Lightning Network listener integration
- Bitcoin on-chain listener with configurable confirmations
- Monero blockchain listener
- Invoice expiration handling
- Webhook retry logic with exponential backoff
- Payment history with transaction IDs
- Blockchain explorer links
