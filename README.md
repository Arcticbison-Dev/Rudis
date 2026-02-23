# Altostratus Payments

A privacy-focused, self-hosted crypto payment invoice system supporting Bitcoin (on-chain), Lightning Network, and Monero. Non-custodial, no KYC, no third-party tracking.

## Features

- **Multi-rail payments**: Bitcoin on-chain, Lightning Network (via LNbits), and Monero
- **Non-custodial**: Your keys, your coins. Payment addresses derived from your xpub/wallet
- **Privacy-first**: No third-party services, no tracking, automatic data anonymization
- **Invoice management**: Create, track, and expire invoices with QR codes
- **Service fee model**: Configurable percentage/fixed fees with min/max caps for licensing
- **Multi-tenant**: Optional merchant-specific fee policies
- **Real-time monitoring**: Health checks, metrics, and alerting
- **Webhook notifications**: HMAC-signed callbacks on payment confirmation
- **Admin dashboard**: Protected endpoints for invoice management and fee reporting
- **Template system**: Reusable invoice templates for subscription plans
- **Docker-ready**: Full containerized deployment with docker-compose

## Quick Start

```bash
# Clone the repository
git clone <repo-url> && cd altostratus-payments

# Run setup (generates secrets, installs deps, pushes DB schema)
./setup.sh

# Configure your .env file
# At minimum: DATABASE_URL and at least one payment rail

# Start the application
npm run dev
```

## Configuration

Copy `.env.example` to `.env` and configure:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `ADMIN_API_TOKEN` | Yes | Protects admin API endpoints |
| `RAIL_AUTH_TOKEN` | Yes | Authenticates rail service callbacks |
| `SESSION_SECRET` | Yes | Express session signing key |
| `ENABLE_LN` | No | Enable Lightning Network payments |
| `ENABLE_BTC` | No | Enable Bitcoin on-chain payments |
| `ENABLE_XMR` | No | Enable Monero payments |

See `.env.example` for the complete list with defaults and descriptions.

## Architecture

```
Client (React SPA)
  |
Express API Server (port 5000)
  |
  +-- /api/invoices      Public invoice CRUD
  +-- /payments           Rail-agnostic payment API
  +-- /admin/*            Protected admin endpoints
  +-- /health, /metrics   Monitoring
  |
  +-- rail-btc/           Bitcoin on-chain listener
  +-- rail-ln/            Lightning Network (LNbits)
  +-- rail-xmr/           Monero listener
  |
PostgreSQL (Drizzle ORM)
```

**Key design decisions:**
- Payment rails are isolated services communicating via authenticated callbacks
- Fee computation uses BigInt arithmetic for precision (no floating point)
- Invoices auto-expire and paid invoices auto-anonymize after configurable retention periods
- All secrets are separated (ADMIN_API_TOKEN, RAIL_AUTH_TOKEN, webhook secrets)

## API Overview

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/invoices` | GET | None | List invoices |
| `/api/invoices` | POST | Rate-limited | Create invoice |
| `/api/invoices/:id` | GET | None | Get invoice detail |
| `/api/templates` | CRUD | None | Manage invoice templates |
| `/payments` | POST | RAIL_AUTH_TOKEN | Create payment (rail-agnostic) |
| `/admin/invoices` | GET | ADMIN_API_TOKEN | List all invoices (admin) |
| `/admin/fee-policies` | CRUD | ADMIN_API_TOKEN | Manage fee policies |
| `/admin/fee-report` | GET | ADMIN_API_TOKEN | Aggregate fee reporting |
| `/health` | GET | None | System health check |
| `/metrics` | GET | None | Monitoring metrics |

See [docs/API_REFERENCE.md](docs/API_REFERENCE.md) for complete API documentation.

## Testing

Tests automatically load environment variables from `.env` (including `ADMIN_API_TOKEN` for admin endpoint tests). Ensure your `.env` is configured before running.

```bash
# Run automated test suite (requires running server)
npm run dev          # Terminal 1
npx vitest run       # Terminal 2

# Watch mode
npx vitest
```

The test suite (50 tests) covers:
- **Fee computation** (18 unit tests): percentage, fixed, min/max caps, BigInt precision, XMR piconero scale
- **Invoice lifecycle** (10 integration tests): create, read, validate, fee attachment
- **Admin endpoints** (13 tests): fee policy CRUD, auth validation, invoice listing, fee reports
- **Templates and health** (9 tests): template CRUD, health/metrics endpoints

Note: Invoice creation tests include rate-limit waits (10 req/min limit on the endpoint).

## Deployment

### Standalone Setup

1. Clone the repo and run `./setup.sh` to generate secrets and push the DB schema
2. Edit `.env` to configure your `DATABASE_URL` and payment rails
3. For each enabled rail, configure its required variables:
   - **Lightning**: `LNBITS_API_URL`, `LNBITS_WALLET_KEY`, `LNBITS_WEBHOOK_SECRET`
   - **Bitcoin**: `BTC_XPUB` (your extended public key for address derivation)
   - **Monero**: `XMR_RPC_HOST`, `XMR_RPC_PORT`, `XMR_RPC_USERNAME`, `XMR_RPC_PASSWORD`
4. Set `ADMIN_API_TOKEN` for admin access and `RAIL_AUTH_TOKEN` for rail service auth

### Docker (recommended for standalone)

```bash
# Lightning only (simplest)
docker-compose up -d

# With Bitcoin on-chain
docker-compose --profile btc up -d

# With all rails
docker-compose --profile btc --profile xmr up -d
```

### Admin API

All admin endpoints require the `ADMIN_API_TOKEN` via `Authorization: Bearer <token>` header:

- `GET /admin/invoices` - List invoices with filtering and pagination
- `GET /admin/invoices/:id` - Invoice detail with payment transactions
- `GET/POST /admin/fee-policies` - List and create fee policies
- `PATCH/DELETE /admin/fee-policies/:id` - Update and delete fee policies
- `GET /admin/fee-report` - Aggregate fee reporting with date range

### Database Migrations

```bash
# Generate migration from schema changes
npx drizzle-kit generate

# Apply migrations
npx drizzle-kit push

# Or push directly (development)
npm run db:push
```

## Documentation

| Document | Description |
|----------|-------------|
| [API Reference](docs/API_REFERENCE.md) | Complete REST API documentation |
| [Operations Guide](docs/OPERATIONS_GUIDE.md) | Production ops, backups, secrets rotation |
| [Standalone Integration](docs/STANDALONE_INTEGRATION_GUIDE.md) | Third-party deployment guide |
| [Observability](docs/OBSERVABILITY.md) | Monitoring, alerting, health checks |

Historical development documentation is archived in `docs/archive/`.

## Service Fee Model

For licensing/SaaS deployments, configure fee policies via admin API:

```bash
# Create a fee policy
curl -X POST http://localhost:5000/admin/fee-policies \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Standard Fee",
    "feePercent": "1.0000",
    "fixedFeeAtomic": "100",
    "minFeeAtomic": "200",
    "maxFeeAtomic": "50000",
    "currency": "BTC",
    "active": true
  }'

# View fee report
curl http://localhost:5000/admin/fee-report \
  -H "Authorization: Bearer $ADMIN_API_TOKEN"
```

## License

MIT
