# Rudis — Self-Hosting Guide

This guide covers everything you need to run Rudis on your own infrastructure, from a five-minute Docker quickstart to a full production setup with all three payment rails.

---

## Table of contents

1. [Prerequisites](#prerequisites)
2. [Option A — Docker quickstart (recommended)](#option-a--docker-quickstart-recommended)
3. [Option B — Manual / cloud deploy](#option-b--manual--cloud-deploy)
4. [Payment rail setup](#payment-rail-setup)
   - [Lightning Network (LNbits)](#lightning-network-lnbits)
   - [Bitcoin on-chain (xpub)](#bitcoin-on-chain-xpub)
   - [Monero (wallet RPC)](#monero-wallet-rpc)
5. [Environment variable reference](#environment-variable-reference)
6. [Production checklist](#production-checklist)
7. [Upgrading](#upgrading)

---

## Prerequisites

- **Docker + Docker Compose** (for Option A) OR **Node.js 18+** (for Option B)
- **PostgreSQL 14+** — bundled in Docker Compose, or bring your own (Railway, Neon, Supabase, etc.)
- **At least one payment rail** — Lightning requires a running LNbits instance; Bitcoin requires an xpub; Monero requires a running monero-wallet-rpc

---

## Option A — Docker quickstart (recommended)

The fastest path to a running instance. Docker Compose bundles Postgres and starts the payment rails you need.

### 1. Clone and configure

```bash
git clone https://github.com/Arcticbison-Dev/CryptoInvoiceNotifier
cd CryptoInvoiceNotifier
cp .env.example .env
```

### 2. Generate secrets

```bash
./setup.sh
```

`setup.sh` generates random values for `ADMIN_API_TOKEN`, `RAIL_AUTH_TOKEN`, and `SESSION_SECRET`, writes them into `.env`, installs dependencies, and pushes the database schema. If you'd rather generate secrets manually:

```bash
openssl rand -hex 32   # use output for each secret token
```

### 3. Configure your .env

Open `.env` and fill in at minimum:

```env
# Enable the rails you want to use
ENABLE_LN=true        # Lightning Network via LNbits
ENABLE_BTC=false      # Bitcoin on-chain (set true if you have an xpub)
ENABLE_XMR=false      # Monero (set true if you have wallet RPC running)
```

Then add credentials for each enabled rail — see [Payment rail setup](#payment-rail-setup) below.

### 4. Start

```bash
# Lightning only (simplest)
docker-compose up -d

# Lightning + Bitcoin
docker-compose --profile btc up -d

# All rails
docker-compose --profile btc --profile xmr up -d
```

The main service is available at `http://localhost:5000`.

### Stopping / restarting

```bash
docker-compose down          # stop containers, keep data
docker-compose down -v       # stop containers and wipe Postgres volume
docker-compose restart       # restart all services
```

---

## Option B — Manual / cloud deploy

Use this for Railway, Render, Fly.io, or a bare VPS.

### 1. Clone and install

```bash
git clone https://github.com/Arcticbison-Dev/CryptoInvoiceNotifier
cd CryptoInvoiceNotifier
npm install
```

### 2. Set up environment

```bash
cp .env.example .env
# Edit .env — see Environment variable reference below
```

Or set environment variables directly in your platform's dashboard (Railway Variables, Render Environment, etc.).

### 3. Run database migrations

```bash
npm run db:push
```

This applies the Drizzle schema to your Postgres database. Run this once on first deploy and again after any schema changes.

### 4. Build and start

```bash
npm run build
npm run start     # production
# or
npm run dev       # development with hot reload
```

### Railway one-click deploy

The repo includes `railway.json`. Connect your GitHub repo to Railway, add your environment variables, and deploy. The `npm run db:push` runs automatically during the build step.

---

## Payment rail setup

Enable at least one rail. You can add more later without downtime — just add the env vars and restart.

---

### Lightning Network (LNbits)

Rudis uses [LNbits](https://lnbits.com) as its Lightning backend. LNbits is a wallet server that connects to an underlying Lightning node (LND, phoenixd, CLN, etc.) and exposes a simple API.

**What you need:**
- A running LNbits instance (self-hosted or hosted)
- A wallet created inside LNbits
- The wallet's API key and admin key

#### Option 1 — Self-hosted LNbits + phoenixd (recommended for simplicity)

[phoenixd](https://phoenix.acinq.co/server) is the easiest Lightning node to self-host. It manages channels automatically and requires no manual channel management.

```bash
# Install phoenixd (Linux x86-64)
wget https://github.com/ACINQ/phoenixd/releases/latest/download/phoenix-<version>-linux-x64.zip
unzip phoenix-*.zip
chmod +x phoenixd

# Start phoenixd (first run creates a seed phrase — back it up)
./phoenixd

# phoenixd runs on port 9740 by default
# Get your HTTP password from ~/.phoenix/phoenix.conf
```

Then deploy LNbits and point it at phoenixd:
```env
# In your LNbits .env
LNBITS_BACKEND_WALLET_CLASS=PhoenixdWallet
PHOENIXD_API_ENDPOINT=http://127.0.0.1:9740
PHOENIXD_API_PASSWORD=<your-phoenixd-password>
```

#### Option 2 — Self-hosted LNbits + existing LND

If you already run an LND node, point LNbits at it instead:
```env
LNBITS_BACKEND_WALLET_CLASS=LndRestWallet
LND_REST_ENDPOINT=https://your-lnd-node:8080
LND_REST_MACAROON=<admin-macaroon-hex>
```

#### Option 3 — Hosted LNbits

[legend.lnbits.com](https://legend.lnbits.com) provides free hosted LNbits wallets. Good for testing; for production you want self-hosted so you control the node.

#### Configuring Rudis for LNbits

Once you have LNbits running and a wallet created:

1. In LNbits, go to your wallet → API Info
2. Copy the **Invoice/read key** (for creating invoices) and the **Admin key** (for outbound payments, only needed for fee forwarding)
3. In Rudis `.env`:

```env
ENABLE_LN=true
LNBITS_API_URL=https://your-lnbits-instance.com
LNBITS_WALLET_KEY=<invoice-read-key>
LNBITS_WEBHOOK_SECRET=<generate with: openssl rand -hex 32>
LNBITS_WEBHOOK_URL=https://your-rudis-domain.com/payments/ln/webhook

# Only needed for operator fee forwarding:
LNBITS_ADMIN_KEY=<admin-key>
OPERATOR_LN_ADDRESS=you@your-ln-address.com
```

> **Webhook URL:** LNbits needs to be able to reach your Rudis instance to deliver payment notifications. If Rudis is behind NAT during development, use [ngrok](https://ngrok.com) or [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) to expose it.

---

### Bitcoin on-chain (xpub)

Rudis derives a unique receiving address for each invoice from your extended public key (xpub). Your private key never touches the server — only the xpub is stored.

**What you need:** An xpub from a BIP32/BIP44/BIP84 compatible wallet (Electrum, Sparrow, Ledger, Trezor, etc.).

#### Getting your xpub

**Electrum:** Wallet → Information → Master Public Key

**Sparrow:** Wallet Settings → Keystores → (your keystore) → xpub

**Hardware wallet:** Most hardware wallets display the xpub in their companion app under "Account Public Key" or similar.

> Use a **watch-only** xpub (starts with `xpub`, `ypub`, or `zpub` depending on address type). Never share your private key or seed phrase.

#### Configuring Rudis

```env
ENABLE_BTC=true
BTC_XPUB=xpub6CUGRUo...
BTC_NETWORK=mainnet          # or testnet for testing
BTC_CONFIRMATIONS_REQUIRED=6 # lower for faster confirmation (minimum 1)
MEMPOOL_API_BASE=https://mempool.space/api  # or your own mempool instance
```

The Bitcoin rail (`rail-btc`) polls mempool.space to detect incoming transactions. No Bitcoin node required on your end — but you can point `MEMPOOL_API_BASE` at a self-hosted mempool instance if you prefer.

For Docker, start with the `btc` profile:
```bash
docker-compose --profile btc up -d
```

---

### Monero (wallet RPC)

Rudis connects to a running `monero-wallet-rpc` instance to generate subaddresses and monitor for incoming payments.

**What you need:** A synced Monero daemon and `monero-wallet-rpc` running on the same network as Rudis.

#### Running monero-wallet-rpc

```bash
# Start a Monero daemon (or use a remote node)
monerod --detach

# Start wallet RPC (creates a wallet if it doesn't exist)
monero-wallet-rpc \
  --wallet-file /path/to/your/wallet \
  --password "your-wallet-password" \
  --rpc-bind-port 18082 \
  --rpc-login rudis:your-rpc-password \
  --daemon-address 127.0.0.1:18081 \
  --disable-rpc-login false
```

For stagenet testing (recommended before mainnet):
```bash
monerod --stagenet --detach
monero-wallet-rpc --stagenet --wallet-file /path/to/stagenet-wallet ...
```

#### Configuring Rudis

```env
ENABLE_XMR=true
XMR_RPC_HOST=127.0.0.1    # host running monero-wallet-rpc
XMR_RPC_PORT=18082
XMR_RPC_USERNAME=rudis
XMR_RPC_PASSWORD=your-rpc-password
XMR_NETWORK=mainnet        # or stagenet
XMR_CONFIRMATIONS_REQUIRED=10
XMR_ACCOUNT_INDEX=0
```

For Docker, start with the `xmr` profile:
```bash
docker-compose --profile xmr up -d
```

> **Note:** The XMR rail expects `monero-wallet-rpc` to be accessible from within Docker. If it's running on the host, use `host.docker.internal` (macOS/Windows) or the host's IP address (Linux) for `XMR_RPC_HOST`.

---

## Environment variable reference

### Core (required)

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string. Example: `postgresql://user:password@localhost:5432/rudis` |
| `ADMIN_API_TOKEN` | Protects all `/admin/*` endpoints and the admin dashboard. Generate with `openssl rand -hex 32`. |
| `RAIL_AUTH_TOKEN` | Shared secret between Rudis and each rail service. Must match across all services. |
| `SESSION_SECRET` | Signs Express sessions. Generate with `openssl rand -hex 32`. |

### Payment rails

| Variable | Rail | Description |
|----------|------|-------------|
| `ENABLE_LN` | LN | `true` to enable Lightning Network |
| `ENABLE_BTC` | BTC | `true` to enable Bitcoin on-chain |
| `ENABLE_XMR` | XMR | `true` to enable Monero |
| `LNBITS_API_URL` | LN | LNbits instance URL |
| `LNBITS_WALLET_KEY` | LN | Invoice/read key from LNbits wallet |
| `LNBITS_WEBHOOK_SECRET` | LN | HMAC secret for LNbits → Rudis webhook |
| `LNBITS_WEBHOOK_URL` | LN | Public URL Rudis is reachable at for LNbits webhooks |
| `BTC_XPUB` | BTC | Extended public key for address derivation |
| `BTC_NETWORK` | BTC | `mainnet` or `testnet` |
| `BTC_CONFIRMATIONS_REQUIRED` | BTC | Confirmations before marking paid (default: 6) |
| `XMR_RPC_HOST` | XMR | Host running monero-wallet-rpc |
| `XMR_RPC_PORT` | XMR | monero-wallet-rpc port (default: 18082) |
| `XMR_RPC_USERNAME` | XMR | RPC login username |
| `XMR_RPC_PASSWORD` | XMR | RPC login password |
| `XMR_NETWORK` | XMR | `mainnet` or `stagenet` |

### Operator fee collection (optional)

| Variable | Description |
|----------|-------------|
| `OPERATOR_LN_ADDRESS` | Lightning Address for instant fee forwarding (e.g. `you@getalby.com`) |
| `LNBITS_ADMIN_KEY` | LNbits Admin Key — required for outbound Lightning payments |
| `OPERATOR_BTC_ADDRESS` | BTC address for on-chain fee settlements |
| `OPERATOR_XMR_ADDRESS` | XMR address for Monero fee settlements |
| `FEE_SETTLEMENT_THRESHOLD_SATS` | Min accumulated fees before settlement record is created (default: 10000) |
| `FEE_SETTLEMENT_GRACE_DAYS` | Days before a pending settlement is overdue (default: 30) |

### Webhooks (outbound notifications)

| Variable | Description |
|----------|-------------|
| `RUDIS_WEBHOOK_URL` | URL to notify on payment confirmation |
| `RUDIS_WEBHOOK_SECRET` | HMAC secret for signing outbound webhook payloads |
| `WEBHOOK_MAX_ATTEMPTS` | Max retry attempts on delivery failure (default: 10) |
| `WEBHOOK_MAX_AGE_HOURS` | Stop retrying after this many hours (default: 24) |

### Data retention and privacy

| Variable | Description |
|----------|-------------|
| `RETENTION_PAID_DAYS` | Days to retain paid invoice data before anonymization (default: 90) |
| `RETENTION_MAX_DAYS` | Hard maximum retention for any invoice (default: 365) |
| `AUTO_ANONYMIZE_ENABLED` | Automatically anonymize expired/old invoices (default: true) |

### Security and access control

| Variable | Description |
|----------|-------------|
| `INVOICE_API_KEY` | When set, `POST /api/invoices` requires `Authorization: Bearer <key>`. Leave unset for public (rate-limited) access. |
| `PORT` | Port to bind on (default: 5000) |

---

## Production checklist

Before going live:

- [ ] `SIMULATION_ENABLED=false` and `ADMIN_SIM_TOKEN` is empty
- [ ] `BTC_NETWORK=mainnet` and `XMR_NETWORK=mainnet` (not testnet/stagenet)
- [ ] `XMR_DEV_MODE=false`
- [ ] All secret tokens are 32+ bytes of random hex (`openssl rand -hex 32`)
- [ ] `.env` is in `.gitignore` and not committed
- [ ] Database is on persistent storage (not ephemeral)
- [ ] HTTPS is configured on your domain (Rudis itself doesn't terminate TLS — put it behind a reverse proxy like Caddy, nginx, or use Railway/Render which handle this)
- [ ] `LNBITS_WEBHOOK_URL` is publicly accessible from LNbits
- [ ] phoenixd seed phrase (or LND seed) is backed up securely, offline
- [ ] `ADMIN_API_TOKEN` is stored in a password manager
- [ ] Health endpoint responds: `curl https://your-domain.com/health`

---

## Upgrading

```bash
git pull origin main
npm install           # pick up dependency updates
npm run db:push       # apply any schema changes
npm run build
npm run start         # or restart your container
```

For Docker:
```bash
git pull origin main
docker-compose build --no-cache
docker-compose up -d
```

Check the [CHANGELOG](../CHANGELOG.md) (if present) or commit history for breaking changes before upgrading.
