# Rudis

**Self-hosted, non-custodial crypto payment invoicing.** Accept Bitcoin, Lightning Network, and Monero — no KYC, no third-party custody, no tracking.

> Built by [Arctic Bison LLC](https://arcticbison.com). MIT licensed.

---

## What it does

Rudis is a standalone payment service you run on your own infrastructure. You point it at your wallets (xpub for Bitcoin, LNbits for Lightning, monero-wallet-rpc for Monero), and it handles invoice creation, QR codes, payment monitoring, webhook delivery, and data retention — without ever holding your keys.

**Payment rails:**

| Rail | Currency | Settlement | Custody |
|------|----------|------------|---------|
| Lightning Network | BTC (sats) | Instant | Your LNbits node |
| Bitcoin on-chain | BTC | ~60 min (6 conf) | Your xpub |
| Monero | XMR | ~20 min (10 conf) | Your wallet RPC |

**Key features:**
- Non-custodial — keys never leave your infrastructure
- Privacy-first — no PII collection, unique addresses per invoice, auto-anonymization
- Multi-tenant fee model — configurable per-merchant fee policies with automatic collection
- Webhook notifications — HMAC-signed callbacks on payment confirmation
- Invoice templates — reusable templates for subscription plans
- Admin dashboard — invoice management, fee reporting, settlements
- Docker-ready — spin up with a single `docker-compose up`

---

## Quick start

```bash
git clone https://github.com/Arcticbison-Dev/Rudis
cd CryptoInvoiceNotifier

# Generate secrets and install dependencies
./setup.sh

# Edit .env — at minimum: DATABASE_URL and one payment rail
cp .env.example .env
$EDITOR .env

# Start (Lightning only by default)
docker-compose up -d
```

See [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md) for a complete walkthrough including Lightning (LNbits), Bitcoin xpub, and Monero wallet RPC setup.

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

See [.env.example](.env.example) for the full list with descriptions and defaults.

---

## Architecture

```
Client (React SPA)
  |
Express API Server (port 5000)
  |
  +-- /api/invoices      Invoice CRUD (public, rate-limited)
  +-- /payments          Rail-agnostic payment callback API
  +-- /admin/*           Protected admin endpoints
  +-- /health, /metrics  Observability
  |
  +-- rail-btc/          Bitcoin on-chain listener (optional)
  +-- rail-ln/           Lightning Network via LNbits (optional)
  +-- rail-xmr/          Monero wallet RPC listener (optional)
  |
PostgreSQL (Drizzle ORM)
```

Payment rails are isolated services that communicate back to the main service via authenticated callbacks. Each rail can be enabled or disabled independently.

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

Rudis includes an optional operator fee model — useful for SaaS deployments where you want to collect a percentage of each payment.

**Lightning (instant forwarding):** Fees are auto-forwarded to your Lightning Address after each payment. Requires `OPERATOR_LN_ADDRESS` and `LNBITS_ADMIN_KEY`.

**BTC / XMR (accumulated settlement):** Fees accumulate per-invoice. Once the total exceeds `FEE_SETTLEMENT_THRESHOLD_SATS` (default: 10,000 sats), a settlement record is created. Overdue settlements block new invoice creation (HTTP 402).

To disable fee collection entirely, simply don't set `OPERATOR_LN_ADDRESS`, `OPERATOR_BTC_ADDRESS`, or `OPERATOR_XMR_ADDRESS`.

---

## Testing

```bash
npm run dev          # Terminal 1 — start the server
npx vitest run       # Terminal 2 — run test suite (62 tests)
```

Tests cover fee computation (unit), invoice lifecycle (integration), admin endpoints, templates, health checks, and fee collection. The test suite requires a running server and a configured `.env`.

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

For production deployments, see [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md) and [docs/OPERATIONS_GUIDE.md](docs/OPERATIONS_GUIDE.md).

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

Rudis integrates natively with [Altostratus](https://altostratus.io) — multi-cloud infrastructure management built by the same team. If you're already running Altostratus, Rudis crypto billing is available on all plans without additional setup.

---

## Roadmap

- **Rudis Cloud** — a hosted managed version for operators who want it to run without self-hosting. Self-hosted is free forever.
- Additional payment rail support
- Multi-merchant dashboard improvements

Rudis is MIT licensed. Self-hosted will always be free.

---

## License

MIT — see [LICENSE](LICENSE).
