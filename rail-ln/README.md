# Lightning Rail Service (rail-ln) v2.0

**Production-Ready Lightning Network Payment Rail for Rudis**

## Overview

This service integrates Lightning Network (LND) with the Altostratus Payments system. It creates BOLT11 invoices, monitors settlements, and forwards payment confirmations to the main payments service.

**Architecture:**
- Isolated microservice communicating via authenticated REST callbacks
- Connects to LND node via REST API
- Monitors invoice settlements and forwards to payments service
- Privacy-first: Structured logging with minimal PII
- Security: Bearer token auth, rate limiting, input validation

## Features

✅ **Production-Ready Features (v2.0)**
- Zod schema validation on all inputs
- Rate limiting (10 requests/min)
- Structured JSON logging (privacy-safe)
- Health checks with LND connection status
- Idempotency-safe callback handling
- Graceful degradation if LND disconnects
- TypeScript for type safety
- MPP (Multi-Path Payments) support

## Quick Start

### 1. Prerequisites

- Node.js 18+ installed
- LND node deployed and synced
- Lightning channels with sufficient liquidity
- Invoice macaroon from LND (read-only)

### 2. Installation

```bash
cd rail-ln
npm install
```

### 3. Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

**Required environment variables:**

```env
# LND Connection
LN_REST_URL=https://your-lnd-node:8080/v1
LN_MACAROON_HEX=0201036c6e6402f801030a10...

# Payments Service Integration
PAYMENTS_SERVICE_URL=https://payments.replit.app
RAIL_AUTH_TOKEN=<64-char-random-token>

# Invoice Settings
LN_INVOICE_EXPIRY_SEC=1200
LN_ENABLE_MPP=true

# Server
PORT=5001
NODE_ENV=production
```

**Generate auth token:**
```bash
openssl rand -hex 32
```

**Get macaroon as hex:**
```bash
xxd -ps -u -c 1000 ~/.lnd/data/chain/bitcoin/mainnet/invoice.macaroon
```

### 4. Run Service

**Development:**
```bash
npm run dev
```

**Production:**
```bash
npm run build
npm start
```

## API Reference

### POST /ln/create
**Purpose:** Create Lightning invoice and return BOLT11

**Request:**
```json
{
  "invoiceId": "550e8400-e29b-41d4-a716-446655440000",
  "amountMsat": 10000000,
  "memo": "Altostratus Pro Subscription"
}
```

**Response (200):**
```json
{
  "invoiceId": "550e8400-e29b-41d4-a716-446655440000",
  "bolt11": "lntb100u1p...",
  "paymentHash": "abc123...",
  "expiresAt": "2025-11-06T20:00:00.000Z"
}
```

**Error Responses:**
- `400`: Validation error (invalid invoiceId, amount, or memo)
- `429`: Rate limit exceeded (>10 requests/minute)
- `502`: LND connection failed
- `500`: Internal server error

---

### GET /health
**Purpose:** Health check with LND connection status

**Response (200) - Healthy:**
```json
{
  "status": "healthy",
  "rail": "ln",
  "timestamp": "2025-11-06T18:30:00.000Z",
  "lndConnected": true,
  "mppEnabled": true
}
```

**Response (503) - Degraded:**
```json
{
  "status": "degraded",
  "rail": "ln",
  "timestamp": "2025-11-06T18:30:00.000Z",
  "lndConnected": false,
  "mppEnabled": true
}
```

## How It Works

### Invoice Creation Flow

1. Payments service calls `POST /ln/create`
2. rail-ln validates input (Zod schema)
3. rail-ln creates BOLT11 via LND REST API
4. rail-ln returns BOLT11 synchronously
5. rail-ln starts monitoring invoice settlement (async)

### Settlement Flow

1. User pays BOLT11 invoice
2. LND settles invoice
3. rail-ln polls LND and detects settlement
4. rail-ln sends callback to payments service:
   ```json
   {
     "invoiceId": "550e8400-...",
     "transactionId": "payment_hash",
     "confirmations": 0,
     "blockHeight": null
   }
   ```
5. Payments service marks invoice as paid
6. Payments service sends HMAC-signed webhook to Altostratus

## Security

### Authentication
- All callbacks to payments service require `Authorization: Bearer <RAIL_AUTH_TOKEN>`
- Token must be 64+ characters (32-byte hex minimum)
- Rotate tokens every 90 days

### Macaroon Security
- Use read-only invoice macaroon (never admin.macaroon)
- Store macaroon as hex in environment variable
- Never commit macaroon to version control
- LND node should run on separate infrastructure

### Rate Limiting
- 10 requests per minute on `/ln/create`
- Returns 429 when exceeded
- Per-IP tracking

### Input Validation
- All inputs validated with Zod schemas
- `invoiceId` must be UUID format
- `amountMsat` max: 21M BTC (21,000,000,00,000,000 msat)
- `memo` max length: 639 characters

### Privacy
- Structured logs contain only: invoiceId, rail, event
- No PII logged (addresses, amounts, IPs)
- Payment hashes truncated in logs

## Monitoring

### Health Checks
```bash
curl http://localhost:5001/health
```

Monitor `lndConnected` field - alerts if false for >5 minutes.

### Logs
All logs are structured JSON:
```json
{
  "ts": "2025-11-06T18:30:00.000Z",
  "level": "info",
  "rail": "ln",
  "event": "invoice_created",
  "invoiceId": "550e8400-..."
}
```

**Log Events:**
- `service_started`: Service initialized
- `invoice_create_requested`: Invoice creation requested
- `invoice_created`: BOLT11 generated successfully
- `invoice_settled`: Payment received
- `callback_success`: Callback to payments service succeeded
- `callback_failed`: Callback failed (check payments service)
- `rate_limit_exceeded`: Too many requests from IP

### Metrics

Track these metrics for observability:
- `rail_ln_invoices_created_total`
- `rail_ln_settlements_total`
- `rail_ln_settlement_latency_seconds` (p50, p95, p99)
- `rail_ln_callbacks_sent_total{status="success|failed"}`
- `rail_ln_lnd_connected` (1=connected, 0=disconnected)

### Alerts

**CRITICAL:**
- LND disconnected >5 minutes
- No settlements in 30+ minutes (with pending invoices)

**WARNING:**
- Callback failure rate >10%
- Settlement latency P95 >10 seconds

## Testing

See comprehensive test plan in `docs/E2E_TESTING_GUIDE.md` and `docs/LN_IMPLEMENTATION_CHECKLIST.md`.

**Testnet testing:**
```bash
# 1. Configure testnet LND
export LN_REST_URL=https://testnet-lnd:8080/v1

# 2. Create test invoice
curl -X POST http://localhost:5001/ln/create \
  -H "Content-Type: application/json" \
  -d '{
    "invoiceId": "550e8400-e29b-41d4-a716-446655440000",
    "amountMsat": 10000,
    "memo": "Test invoice"
  }'

# 3. Pay with testnet wallet (Zeus, Phoenix, lncli)

# 4. Verify callback sent to payments service
```

## Deployment

Follow canary deployment strategy in `docs/CANARY_DEPLOYMENT_GUIDE.md`:

**Phase 0: Testnet** (1-2 weeks)
- Deploy to testnet infrastructure
- Execute all 9 test cases
- Monitor metrics and logs

**Phase 1: Lightning Only** (48h minimum)
- Enable for 5-10 canary users
- Monitor settlement latency (<5s target)
- Verify webhook delivery (100% target)

**Phase 2-3: Full Rollout**
- See deployment guide for complete rollout plan

## Troubleshooting

### BOLT11 Not Generated
**Symptom:** Invoice created but bolt11 field is null

**Solution:**
1. Check LND connection: `curl http://localhost:5001/health`
2. Verify macaroon: `echo $LN_MACAROON_HEX | wc -c` (should be >100)
3. Check LND logs for errors
4. Verify network connectivity to LND

### Settlement Not Detected
**Symptom:** Invoice paid but status remains "pending"

**Solution:**
1. Check LND invoice: `lncli lookupinvoice <r_hash>`
2. Check rail-ln logs for `invoice_settled` event
3. Verify monitoring interval (2 seconds default)
4. Check for `callback_failed` errors in logs

### Callback Authentication Failed
**Symptom:** Logs show `callback_failed` with 401 error

**Solution:**
1. Verify RAIL_AUTH_TOKEN matches in both services
2. Check Authorization header format: `Bearer <token>`
3. Regenerate token if needed

## Documentation

**Complete documentation suite:**
- `docs/LN_INTEGRATION_PLAN_V2.md` - Implementation guide
- `docs/LN_INTEGRATION_REVIEW.md` - Gap analysis from v1.0
- `docs/LN_IMPLEMENTATION_CHECKLIST.md` - Validation checklist
- `docs/E2E_TESTING_GUIDE.md` - Testing procedures
- `docs/OBSERVABILITY.md` - Monitoring standards
- `docs/OPS_KEY_MANAGEMENT.md` - Security best practices
- `docs/CANARY_DEPLOYMENT_GUIDE.md` - Rollout strategy

## Version History

**v2.0.0** (2025-11-06)
- Production-ready implementation
- TypeScript with Zod validation
- Corrected callback schema (paymentConfirmationSchema)
- Added rate limiting and health checks
- Structured JSON logging
- MPP support documented

**v1.0.0** (Previous)
- Initial placeholder implementation

## License

MIT — see [LICENSE](../LICENSE).
