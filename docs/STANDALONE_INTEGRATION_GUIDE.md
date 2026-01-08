# Altostratus Payments - Standalone Integration Guide

**Version**: 1.0.0  
**Last Updated**: 2025-11-20

This guide explains how to integrate Altostratus Payments into your own application as a standalone payment processing service.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Quick Start](#quick-start)
4. [Deployment Options](#deployment-options)
5. [API Integration](#api-integration)
6. [Webhook Configuration](#webhook-configuration)
7. [Security](#security)
8. [Monitoring](#monitoring)
9. [Licensing & Service Fees](#licensing--service-fees)

---

## Overview

Altostratus Payments is a **self-hosted, non-custodial** crypto payment processor supporting:

| Payment Rail | Currency | Settlement Time | Custody |
|--------------|----------|-----------------|---------|
| **Bitcoin** | BTC | ~60 min (6 confirmations) | Non-custodial (your xpub) |
| **Monero** | XMR | ~20 min (10 confirmations) | Non-custodial (your wallet RPC) |
| **Lightning** | BTC | Instant | Your LNbits/LND setup |

### Key Features

- **Privacy-first**: No PII collection, unique addresses per invoice, auto-anonymization
- **Non-custodial**: You control your private keys
- **Production-ready**: Health checks, monitoring, alerting, structured logging
- **Easy integration**: Simple REST API, webhook notifications

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        YOUR APPLICATION                             │
│                                                                     │
│   1. Create Invoice ────────────────────────────────────►           │
│   2. Display QR Code ◄───────────────────────────────────           │
│   3. Receive Webhook ◄─────────────────── (payment confirmed)       │
└─────────────────────────────────────────────────────────────────────┘
                              │                         │
                              │                         │
                              ▼                         │
┌─────────────────────────────────────────────────────────────────────┐
│                   ALTOSTRATUS PAYMENTS SERVICE                      │
│                                                                     │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐                     │
│   │  BTC     │    │  XMR     │    │  LN      │                     │
│   │  Rail    │    │  Rail    │    │  Rail    │                     │
│   └────┬─────┘    └────┬─────┘    └────┬─────┘                     │
│        │               │               │                            │
│        ▼               ▼               ▼                            │
│   ┌─────────────────────────────────────────────────┐              │
│   │           Payment Orchestrator                   │              │
│   │   (Unified API, status tracking, webhooks)       │              │
│   └─────────────────────────────────────────────────┘              │
│                          │                                          │
│                          ▼                                          │
│   ┌─────────────────────────────────────────────────┐              │
│   │              PostgreSQL Database                 │              │
│   └─────────────────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ (polling/callbacks)
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    YOUR BLOCKCHAIN INFRASTRUCTURE                    │
│                                                                     │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│   │ BTC: xpub    │  │ XMR: Wallet  │  │ LN: LNbits   │             │
│   │ (your keys)  │  │ RPC (local)  │  │ (your node)  │             │
│   └──────────────┘  └──────────────┘  └──────────────┘             │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### Option 1: Docker Compose (Recommended)

```bash
# Clone the repository
git clone https://github.com/your-org/altostratus-payments.git
cd altostratus-payments

# Copy environment template
cp .env.example .env

# Configure your environment variables (see below)
nano .env

# Start services (Lightning only)
docker-compose up -d payments postgres

# Or with Bitcoin rail
docker-compose --profile btc up -d

# Or with all rails
docker-compose --profile btc --profile xmr up -d
```

### Option 2: Manual Installation

```bash
# Clone and install
git clone https://github.com/your-org/altostratus-payments.git
cd altostratus-payments
npm install

# Configure environment
cp .env.example .env
nano .env

# Initialize database
npm run db:push

# Start production server
npm run build && npm start
```

---

## Deployment Options

### 1. Single Server (Simplest)

All services run on one server. Best for:
- Small to medium traffic
- Development/staging
- Quick setup

```bash
docker-compose up -d
```

### 2. Distributed Services (Production)

Each rail runs on a separate server. Best for:
- High traffic
- Security isolation
- Geographic distribution

```bash
# Server 1: Main payments service
docker-compose up -d payments postgres

# Server 2: BTC rail (near your Bitcoin node)
docker-compose --profile btc up -d rail-btc

# Server 3: XMR rail (on same machine as wallet RPC)
docker-compose --profile xmr up -d rail-xmr
```

### 3. Kubernetes (Enterprise)

Helm charts available for production Kubernetes deployments:

```bash
helm install altostratus-payments ./charts/altostratus-payments \
  --set btc.enabled=true \
  --set ln.enabled=true \
  --set ln.lnbitsApiUrl=https://your-lnbits.com
```

---

## API Integration

### Base URL

```
https://your-payments-instance.com
```

### Create Invoice

```bash
POST /payments
Content-Type: application/json

{
  "rail": "ln",                      # "btc", "xmr", or "ln"
  "amount_sats": 10000,              # Amount in satoshis
  "currency": "BTC",                 # Asset type
  "description": "Order #12345",     # Optional description
  "expires_in_seconds": 3600         # Optional expiry (default: 1 hour)
}
```

**Response:**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "rail": "ln",
  "status": "pending",
  "amount_atomic": "10000",
  "payment_address": "bc1q...",      # BTC/XMR address
  "bolt11_invoice": "lnbc...",       # LN invoice (if rail=ln)
  "expires_at": "2025-11-20T14:00:00Z",
  "created_at": "2025-11-20T13:00:00Z"
}
```

### Check Invoice Status

```bash
GET /payments/{invoice_id}
```

**Response:**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "rail": "ln",
  "status": "confirmed",
  "amount_atomic": "10000",
  "amount_paid_atomic": "10000",
  "paid_at": "2025-11-20T13:05:00Z",
  "transactions": [
    {
      "tx_hash": "abcd1234...",
      "amount_atomic": "10000",
      "confirmations": 6,
      "detected_at": "2025-11-20T13:04:00Z"
    }
  ]
}
```

### Invoice Status Values

| Status | Description |
|--------|-------------|
| `pending` | Invoice created, awaiting payment |
| `confirmed` | Payment received and confirmed |
| `expired` | Invoice expired without payment |

---

## Webhook Configuration

When a payment is confirmed, Altostratus Payments sends a webhook to your application.

### Configure Webhook

```bash
# In .env
ALTOSTRATUS_WEBHOOK_URL=https://your-app.com/api/payments/webhook
ALT_WEBHOOK_SECRET=your_32_char_secret_here
```

### Webhook Payload

```json
{
  "invoiceId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "confirmed",
  "amount": "10000",
  "currency": "BTC",
  "paidAt": "2025-11-20T13:05:00Z",
  "transactionId": "abcd1234...",
  "confirmations": 6
}
```

### Verify Webhook Signature

```javascript
const crypto = require('crypto');

function verifyWebhook(payload, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

// In your webhook handler
app.post('/api/payments/webhook', (req, res) => {
  const signature = req.headers['x-altostratus-signature'];
  
  if (!verifyWebhook(req.body, signature, process.env.ALT_WEBHOOK_SECRET)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  // Process payment confirmation
  const { invoiceId, status, amount } = req.body;
  // ... update your order, grant access, etc.
  
  res.json({ received: true });
});
```

---

## Security

### API Authentication

For admin endpoints, include the `Authorization` header:

```bash
curl -H "Authorization: Bearer ${ADMIN_API_TOKEN}" \
  https://your-payments.com/admin/invoices
```

### Rail Service Authentication

Rail services authenticate with `RAIL_AUTH_TOKEN`:

```bash
# Must match on all services
RAIL_AUTH_TOKEN=your_64_char_hex_token
```

### Webhook Security

1. **HMAC Signature**: All webhooks are signed with `X-Altostratus-Signature` header
2. **Timing-safe Comparison**: Always use timing-safe comparison to prevent timing attacks
3. **Secret Rotation**: Rotate `ALT_WEBHOOK_SECRET` periodically

### Lightning Webhook Security

LNbits webhooks use path-based authentication:

```bash
# Webhook URL includes secret in path
LNBITS_WEBHOOK_URL=https://your-app.com/rails/ln/webhook/${LNBITS_WEBHOOK_SECRET}
```

---

## Monitoring

### Health Check

```bash
GET /health
```

**Response:**

```json
{
  "status": "ok",
  "timestamp": "2025-11-20T13:00:00Z",
  "rails": {
    "btc": { "status": "ok", "last_poll": "2025-11-20T12:59:30Z" },
    "xmr": { "status": "disabled" },
    "ln": { "status": "ok", "backend": "lnbits" }
  }
}
```

### Metrics

```bash
GET /metrics
```

**Response:**

```json
{
  "bufferSize": 150,
  "activeAlerts": 0,
  "eventsByRail": { "BTC": 45, "XMR": 0, "LN": 105 },
  "eventsByType": { "payment.created": 50, "payment.confirmed": 48 }
}
```

### Alert Webhook

Configure alerts for critical issues:

```bash
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK
```

---

## Licensing & Service Fees

### Service Fee Integration

To charge a service fee on payments processed through your instance:

1. **Percentage-based Fee**: Add a surcharge to the invoice amount

```javascript
// Example: 1% service fee
const baseAmount = 10000; // satoshis
const serviceFee = Math.ceil(baseAmount * 0.01);
const totalAmount = baseAmount + serviceFee;

// Create invoice with total amount
const invoice = await fetch('/payments', {
  method: 'POST',
  body: JSON.stringify({
    rail: 'ln',
    amount_sats: totalAmount,
    description: `Order + ${serviceFee} sat fee`
  })
});
```

2. **Fixed Fee**: Add a flat fee to each transaction

3. **Hybrid Model**: Percentage + minimum fee

### White-Label Deployment

For white-label deployments:

1. Remove Altostratus branding from frontend
2. Configure custom domain
3. Update webhook signatures with your own prefix
4. Customize email/notification templates

### Enterprise Licensing

Contact for:
- Priority support
- Custom feature development
- SLA guarantees
- Multi-tenant deployments

---

## Environment Variables Reference

### Required

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Session encryption secret |
| `RAIL_AUTH_TOKEN` | Authentication between services |

### Bitcoin Rail

| Variable | Description | Default |
|----------|-------------|---------|
| `ENABLE_BTC` | Enable Bitcoin payments | `false` |
| `BTC_XPUB` | Your wallet's extended public key | - |
| `BTC_NETWORK` | `mainnet` or `testnet` | `mainnet` |
| `BTC_CONFIRMATIONS_REQUIRED` | Confirmations for finality | `6` |

### Monero Rail

| Variable | Description | Default |
|----------|-------------|---------|
| `ENABLE_XMR` | Enable Monero payments | `false` |
| `XMR_RPC_HOST` | Wallet RPC host (must be localhost) | `127.0.0.1` |
| `XMR_RPC_PORT` | Wallet RPC port | `18082` |
| `XMR_RPC_USERNAME` | RPC authentication username | - |
| `XMR_RPC_PASSWORD` | RPC authentication password | - |
| `XMR_CONFIRMATIONS_REQUIRED` | Confirmations for finality | `10` |

### Lightning Rail

| Variable | Description | Default |
|----------|-------------|---------|
| `ENABLE_LN` | Enable Lightning payments | `false` |
| `LNBITS_API_URL` | LNbits instance URL | - |
| `LNBITS_WALLET_KEY` | LNbits invoice/read key | - |
| `LNBITS_WEBHOOK_SECRET` | Webhook authentication secret | - |
| `LN_MIN_AMOUNT_SATS` | Minimum invoice amount | `1` |
| `LN_MAX_AMOUNT_SATS` | Maximum invoice amount | `100000` |

### Webhooks

| Variable | Description |
|----------|-------------|
| `ALTOSTRATUS_WEBHOOK_URL` | Your app's webhook endpoint |
| `ALT_WEBHOOK_SECRET` | Webhook signing secret |
| `ALERT_WEBHOOK_URL` | Alert notifications (Slack, etc.) |

---

## Support

- **Documentation**: [/docs](./docs)
- **API Reference**: [/docs/API_REFERENCE.md](./API_REFERENCE.md)
- **Issues**: GitHub Issues
- **Enterprise Support**: Contact sales@altostratus.io
