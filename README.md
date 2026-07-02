# Rudis

**Self-hosted, non-custodial crypto payment invoicing.** Accept Bitcoin, Lightning Network, and Monero — no KYC, no third-party custody, no tracking.

> Built by [Arctic Bison LLC](https://arcticbison.com). MIT licensed. I don't just build Rudis — I use it.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/docker-ready-blue.svg)](docker-compose.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-green.svg)](package.json)

---

## What it does

Rudis is a standalone payment service you run on your own infrastructure. Point it at your wallets (xpub for Bitcoin, LNbits for Lightning, monero-wallet-rpc for Monero) and it handles invoice creation, QR codes, payment monitoring, HMAC-signed webhook delivery, and auto-anonymization — without ever holding your keys.

**Payment rails:**

| Rail | Currency | Settlement | Custody |
|------|----------|------------|---------|
| Lightning Network | BTC (sats) | Instant | Your LNbits node |
| Bitcoin on-chain | BTC | ~60 min (6 conf) | Your xpub |
| Monero | XMR | ~20 min (10 conf) | Your wallet RPC |

**Key features:**
- Non-custodial — keys never leave your infrastructure
- Privacy-first — no PII collection, unique address per invoice, auto-anonymization after configurable retention window
- HMAC-signed webhooks — `X-Rudis-Signature` header on every callback
- Multi-tenant fee model — configurable per-merchant fee policies with automatic Lightning forwarding
- Invoice templates — reusable templates for subscription plans
- Admin dashboard — invoice management, fee reporting, settlements
- Docker-ready — single `docker-compose up` brings up the full stack

---

## Quick start

```bash
git clone https://github.com/Arcticbison-Dev/Rudis
cd Rudis

# Generate secrets, install dependencies, run DB migration
./setup.sh

# Configure — at minimum set DATABASE_URL and one payment rail
cp .env.example .env
$EDITOR .env

# Start (Lightning only by default)
docker-compose up -d
```

**What comes up:**

| Container | Port | Purpose |
|-----------|------|---------|
| `rudis` | 5000 | Main API + admin dashboard |
| `rudis-postgres` | 5432 | PostgreSQL (bundled) |
| `rudis-rail-btc` | 5002 | Bitcoin on-chain rail (optional, `--profile btc`) |
| `rudis-rail-xmr` | 5003 | Monero rail (optional, `--profile xmr`) |

**Verify it's running:**

```bash
curl http://localhost:5000/health
# {"status":"ok"}
```

**Create your first invoice:**

```bash
curl -X POST http://localhost:5000/api/invoices \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 10000,
    "currency": "sats",
    "rail": "ln",
    "description": "Test payment",
    "webhookUrl": "https://your-app.com/webhooks/payment"
  }'
```

```json
{
  "id": "inv_abc123",
  "status": "pending",
  "paymentRequest": "lnbc100n1...",
  "qrCode": "data:image/png;base64,...",
  "expiresAt": "2026-07-02T19:00:00Z"
}
```

**Check status:**

```bash
curl http://localhost:5000/api/invoices/inv_abc123
```

See [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md) for full Lightning, Bitcoin xpub, and Monero wallet RPC setup.

---

## Webhook verification

Every webhook Rudis sends includes an `X-Rudis-Signature` header — HMAC-SHA256 of the raw request body, signed with your `ALT_WEBHOOK_SECRET`.

```javascript
const crypto = require('crypto');

function verifyWebhook(rawBody, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}
```

See [docs/API_REFERENCE.md](docs/API_REFERENCE.md) for the full webhook payload schema.

---

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `ADMIN_API_TOKEN` | Yes | Protects admin API and dashboard |
| `RAIL_AUTH_TOKEN` | Yes | Authenticates payment rail callbacks |
| `SESSION_SECRET` | Yes | Express session signing key |
| `ENABLE_LN` | No | Enable Lightning Network (requires LNbits) |
| `ENABLE_BTC` | No | Enable Bitcoin on-chain (requires xpub) |
| `ENABLE_XMR` | No | Enable Monero (requires wallet RPC) |
| `INVOICE_API_KEY` | No | Require Bearer auth on invoice creation |
| `ALT_WEBHOOK_SECRET` | No | HMAC secret for outbound webhook signing |

See [.env.example](.env.example) for the full list with descriptions and defaults.

---

## Deployment

### Docker (recommended)

```bash
# Lightning only
docker-compose up -d

# Lightning + Bitcoin on-chain
docker-compose --profile btc up -d

# All rails
docker-compose --profile btc --profile xmr up -d
```

### Manual / Railway / Render

```bash
./setup.sh          # generates secrets, installs deps, runs DB migration
npm run build
npm run start
```

For production deployments see [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md) and [docs/OPERATIONS_GUIDE.md](docs/OPERATIONS_GUIDE.md).

---

## Architecture

```
Client (React SPA)
  │
Express API Server — port 5000
  │
  ├── /api/invoices      Invoice CRUD (public, rate-limited)
  ├── /payments          Rail-agnostic payment callback
  ├── /admin/*           Protected admin endpoints
  └── /health, /metrics  Observability
  │
  ├── rail-btc/          Bitcoin on-chain listener (optional)
  ├── rail-ln/           Lightning via LNbits webhook (optional)
  └── rail-xmr/          Monero wallet RPC listener (optional)
  │
PostgreSQL (Drizzle ORM)
```

Payment rails are isolated services that communicate back to the main service via HMAC-authenticated callbacks. Each rail can be enabled or disabled independently.

---

## API

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/invoices` | GET | None | List invoices |
| `/api/invoices` | POST | Rate-limited + optional key | Create invoice |
| `/api/invoices/:id` | GET | None | Invoice detail |
| `/api/templates` | CRUD | None | Manage templates |
| `/payments` | POST | `RAIL_AUTH_TOKEN` | Payment callback (rail → service) |
| `/admin/invoices` | GET | `ADMIN_API_TOKEN` | Admin invoice list |
| `/admin/fee-policies` | CRUD | `ADMIN_API_TOKEN` | Fee policy management |
| `/admin/fee-report` | GET | `ADMIN_API_TOKEN` | Aggregate fee report |
| `/admin/fee-settlements` | GET/POST | `ADMIN_API_TOKEN` | Settlement management |
| `/health` | GET | None | Health check |
| `/metrics` | GET | None | Monitoring metrics |

See [docs/API_REFERENCE.md](docs/API_REFERENCE.md) for full API documentation.

---

## Fee model

Rudis includes an optional operator fee model — useful for SaaS deployments where you collect a percentage of each payment.

**Lightning (instant forwarding):** Fees are auto-forwarded to your Lightning Address after each payment. Requires `OPERATOR_LN_ADDRESS` and `LNBITS_ADMIN_KEY`.

**BTC / XMR (accumulated settlement):** Fees accumulate per-invoice. Once the total exceeds `FEE_SETTLEMENT_THRESHOLD_SATS` (default: 10,000 sats), a settlement record is created. Overdue settlements block new invoice creation (HTTP 402).

To disable fee collection entirely, don't set any `OPERATOR_*_ADDRESS` variables.

---

## Testing

```bash
npm run dev          # Terminal 1 — start the server
npx vitest run       # Terminal 2 — run test suite (62 tests)
```

Tests cover fee computation (unit), invoice lifecycle (integration), admin endpoints, templates, health checks, and fee collection. Requires a running server and a configured `.env`.

---

## Documentation

| Document | Description |
|----------|-------------|
| [Self-Hosting Guide](docs/SELF_HOSTING.md) | Full setup walkthrough — Docker, Lightning, Bitcoin, Monero |
| [API Reference](docs/API_REFERENCE.md) | Complete REST API docs |
| [Operations Guide](docs/OPERATIONS_GUIDE.md) | Secrets rotation, backups, production ops |
| [Observability](docs/OBSERVABILITY.md) | Monitoring, alerting, health checks |
| [Standalone Integration](docs/STANDALONE_INTEGRATION_GUIDE.md) | Integrating Rudis into your own app |

---

## Integrations

Rudis integrates natively with [Altostratus](https://arcticbison.com/altostratus) — sovereign multi-cloud infrastructure management built by the same team. Rudis handles crypto billing for all Altostratus plans.

---

## Roadmap

- **Rudis Cloud** — hosted managed version for operators who want it without self-hosting. Self-hosted is free forever.
- Additional payment rail support
- Multi-merchant dashboard improvements

---

## License

MIT — see [LICENSE](LICENSE). Self-hosted will always be free.
