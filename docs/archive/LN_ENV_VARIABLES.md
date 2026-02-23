# Lightning Network Environment Variables

## Overview
Complete documentation of all environment variables used for Lightning Network integration via LNbits on LND.

**Architecture**: `Payment App → LNbits API → LND Backend`

**Key Design Principle**: Your payment app only talks to LNbits API. LNbits handles all communication with the LND backend.

---

## Quick Reference

### Minimal Required Configuration

```bash
# Enable Lightning Network
ENABLE_LN=true

# LNbits API connection (REQUIRED)
LNBITS_API_URL=https://legend.lnbits.com
LNBITS_WALLET_KEY=your_invoice_read_key_here  # Store in Replit Secrets!

# Recommended: Webhook for instant notifications
LNBITS_WEBHOOK_URL=https://your-app.repl.co/webhooks/lnbits
LNBITS_WEBHOOK_SECRET=your_webhook_secret_here  # Store in Replit Secrets!
```

### Full Configuration (All Options)

See `.env.example` for all 19 Lightning Network environment variables organized into 5 categories.

**Note**: `ENABLE_LN` is the primary toggle defined in the LN Rail Controls section of `.env.example`. It is also cross-referenced in the Feature Flags section for consistency with `ENABLE_BTC` and `ENABLE_XMR`.

---

## 1️⃣ LN Rail Controls

Controls overall Lightning Network rail behavior and limits.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `ENABLE_LN` | boolean | `false` | **Enable Lightning Network payment rail** (PRIMARY TOGGLE - authoritative source consumed by `process.env.ENABLE_LN`) |
| `LN_BACKEND` | string | `lnbits` | Lightning backend type (currently only `lnbits` supported) |
| `LN_HTTP_TIMEOUT` | integer | `5000` | HTTP timeout for LNbits API calls (milliseconds) |
| `LN_INVOICE_EXPIRY` | integer | `3600` | Invoice expiration time (seconds, default 1 hour) |
| `LN_MIN_AMOUNT_SATS` | integer | `1` | Minimum invoice amount in satoshis (prevents dust) |
| `LN_MAX_AMOUNT_SATS` | integer | `100000` | Maximum invoice amount in satoshis (0.001 BTC) |
| `LN_POLL_INTERVAL_MS` | integer | `10000` | Poll interval for checking invoices (milliseconds) |

### Amount Validation

**Business Rules**:
- Invoices below `LN_MIN_AMOUNT_SATS` → **400 Bad Request** (validation error)
- Invoices above `LN_MAX_AMOUNT_SATS` → **400 Bad Request** (business rule violation)

**Why Limits?**
- **Min (1 sat)**: Prevents dust that costs more in routing fees than it's worth
- **Max (100,000 sats)**: Conservative exposure limit until funds settle

**Adjusting Limits**:
```bash
# Accept larger payments (0.01 BTC max)
LN_MAX_AMOUNT_SATS=1000000

# Stricter minimum (10 sats)
LN_MIN_AMOUNT_SATS=10
```

### Instant Settlement Design

**IMPORTANT**: Lightning Network has **no confirmation delay** - this is a fundamental design difference from BTC/XMR.

**Instant Settlement Model**:
- ✅ Invoice status changes from `pending` to `confirmed` **as soon as LNbits reports it as paid**
- ❌ **No `LN_CONFIRMATIONS` variable** - there is no waiting period (by design)
- ⚡ Payment is **final and irreversible** once confirmed by LNbits
- 🔒 LND backend handles all routing and settlement complexity

**Why No Confirmation Variable?**
- Lightning payments are atomic cryptographic swaps
- Either the payment succeeds completely or fails completely
- No blockchain confirmation waiting (payments happen off-chain)
- Settlement is instant once the HTLC (Hash Time-Locked Contract) resolves

**Timing Controls** (NOT confirmation delays):
1. **Poll interval** (`LN_POLL_INTERVAL_MS`): How often to check LNbits for status updates (if not using webhooks)
2. **Webhook delivery**: Instant push notification from LNbits when invoice paid
3. **Invoice expiry** (`LN_INVOICE_EXPIRY`): When unpaid invoices auto-expire (default: 1 hour)

**Comparison with Other Rails**:
- **BTC**: Requires 6 confirmations (~60 minutes) before status changes to `confirmed`
- **XMR**: Requires 10 confirmations (~20 minutes) before status changes to `confirmed`
- **LN**: **Instant** - no waiting, status changes to `confirmed` immediately when paid

---

## 2️⃣ LNbits API Configuration

Configures your app's connection to LNbits API (the only service your app talks to).

| Variable | Type | Required | Description |
|----------|------|----------|-------------|
| `LNBITS_API_URL` | string | ✅ Yes | LNbits server base URL (no trailing slash) |
| `LNBITS_WALLET_KEY` | string | ✅ Yes | Wallet API key (Invoice/Read key) |
| `LNBITS_WALLET_ID` | string | No | Wallet ID (optional, for multi-wallet setups) |

### LNBITS_API_URL

**Examples**:
- Hosted: `https://legend.lnbits.com`
- Self-hosted: `https://lnbits.yourdomain.com`
- Local dev: `http://localhost:5000`

**Format Rules**:
- ❌ No trailing slash: `https://example.com/` (wrong)
- ✅ Clean base URL: `https://example.com` (correct)
- ❌ Don't include `/api/v1`: App adds this automatically

### LNBITS_WALLET_KEY

**🔐 CRITICAL SECURITY**:

**Key Type**: Use **Invoice/Read key** (NOT Admin key)

**How to Generate**:
1. Open LNbits wallet
2. Navigate to: **Wallet → API Info**
3. Copy: **"Invoice/Read key"** (or "Invoice key")
4. Store in: **Replit Secrets** (never commit to git)

**Permissions**:
- ✅ Create invoices (generate BOLT11 payment requests)
- ✅ Read wallet balance and payment status
- ❌ Cannot spend funds (no outgoing payments)

**Why NOT Admin Key?**
- Admin key can **spend funds** (unnecessary risk)
- Invoice/Read key is **sufficient** for receiving payments
- Principle of least privilege

**Security Checklist**:
- [ ] Use Invoice/Read key (NOT Admin key)
- [ ] Store in Replit Secrets
- [ ] Never commit to git
- [ ] Never log in plaintext
- [ ] Rotate periodically

### LNBITS_WALLET_ID

**Optional**: Only needed for multi-wallet setups.

If you have one wallet, leave this empty. The `LNBITS_WALLET_KEY` already identifies the wallet.

**When to use**:
- Managing multiple wallets with different keys
- Advanced accounting separation

**Default**: Empty (use key's default wallet)

---

## 3️⃣ LND Backend Configuration

**⚠️ IMPORTANT**: These variables are **NOT used by your payment app**.

These configure **LNbits' connection to its LND backend**. Only set these if you're self-hosting LNbits and need to configure it.

| Variable | Type | Used By | Description |
|----------|------|---------|-------------|
| `LND_GRPC_HOST` | string | LNbits only | LND gRPC endpoint (e.g., `localhost:10009`) |
| `LND_TLS_CERT_BASE64` | string | LNbits only | LND TLS certificate (base64-encoded) |
| `LND_INVOICE_MACAROON` | string | LNbits only | LND invoice macaroon (hex-encoded) |
| `LND_NETWORK` | string | LNbits only | LND network (`mainnet`, `testnet`, `regtest`) |

### When Are These Needed?

**Hosted LNbits (e.g., legend.lnbits.com)**:
- ❌ NOT needed
- LNbits already configured with its own LND backend

**Self-Hosted LNbits**:
- ✅ Required if LNbits not already configured
- Set these in LNbits configuration, not your payment app

### Architecture Diagram

```
┌─────────────────────┐
│   Payment App       │  Reads: LNBITS_API_URL, LNBITS_WALLET_KEY
│ (Altostratus)       │  Ignores: LND_* variables
└──────────┬──────────┘
           │ HTTPS API
           ▼
┌─────────────────────┐
│      LNbits         │  Reads: LND_GRPC_HOST, LND_TLS_CERT_BASE64,
│   (Middleware)      │         LND_INVOICE_MACAROON, LND_NETWORK
└──────────┬──────────┘
           │ gRPC
           ▼
┌─────────────────────┐
│    LND Backend      │  Lightning Network node
│  (Bitcoin Layer 2)  │  Manages channels, routing, settlements
└─────────────────────┘
```

### Security Notes

- ✅ All LND credentials stored in Replit Secrets
- ✅ Never commit to git
- ✅ Only LNbits uses these, not your app
- ✅ Invoice macaroon (read/write invoices) is sufficient
- ❌ Don't use Admin macaroon (unnecessary permissions)

---

## 4️⃣ Webhook Configuration (Recommended)

Configure LNbits to push instant payment notifications to your app.

| Variable | Type | Required | Description |
|----------|------|----------|-------------|
| `LNBITS_WEBHOOK_URL` | string | Recommended | URL for LNbits payment notifications |
| `LNBITS_WEBHOOK_SECRET` | string | If webhooks | Secret for verifying webhook authenticity |
| `LNBITS_WEBHOOK_TIMEOUT_MS` | integer | No | Webhook timeout (default: 5000ms) |

### Why Webhooks?

**Webhook Mode** (Recommended):
- ⚡ **Instant notifications** when invoices are paid
- 📉 **Lower API usage** (no constant polling)
- 🎯 **Better UX** (immediate payment confirmations)
- 🛡️ **Safety net**: Light polling continues in background

**Polling-Only Mode**:
- 📊 **Higher API usage** (checks every 10 seconds)
- ⏱️ **Delayed notifications** (up to 10 second lag)
- ✅ **Works reliably** (but not ideal for production)

### LNBITS_WEBHOOK_URL

**Format**: `https://your-app.repl.co/webhooks/lnbits`

**How It Works**:
1. You create invoice
2. LNbits generates BOLT11 payment request
3. User pays invoice
4. LNbits **immediately POSTs** to your webhook URL
5. Your app confirms payment instantly

**Replit Deployment**:
- Production: `https://your-app.repl.co/webhooks/lnbits`
- Staging: `https://your-app-staging.repl.co/webhooks/lnbits`
- Dev: `https://your-replit-dev.repl.co/webhooks/lnbits`

**Empty → Polling-only mode**

### LNBITS_WEBHOOK_SECRET

**🔐 Security**: Generate with `openssl rand -hex 32`

**Purpose**: Verify webhook authenticity (prevent spoofed payment notifications)

**How LNbits Uses It**:
- LNbits signs webhook with HMAC-SHA256
- Includes signature in HTTP header
- Your app verifies signature before processing

**Implementation**:
```typescript
// Pseudo-code
const expectedSignature = hmac_sha256(
  LNBITS_WEBHOOK_SECRET,
  webhookBody
);

if (receivedSignature !== expectedSignature) {
  throw new Error("Invalid webhook signature");
}
```

**Security Checklist**:
- [ ] Generate strong random secret (32+ bytes hex)
- [ ] Store in Replit Secrets
- [ ] Verify signature on all webhook requests
- [ ] Reject unsigned or invalid webhooks
- [ ] Never log webhook secret

### Webhook Strategy & Dual-Mode Behavior

Lightning Network payment detection operates in one of two modes:

#### Mode 1: Webhook + Polling (Recommended for Production)

**When**: `LNBITS_WEBHOOK_URL` is configured

**Behavior**:
1. **Primary Detection**: LNbits webhooks
   - LNbits POSTs to `LNBITS_WEBHOOK_URL` when invoice paid
   - **Instant notification** (milliseconds after payment)
   - LNbits handles webhook retries internally (your app does not retry)
   - Webhook includes payment hash and status

2. **Fallback Detection**: Light polling
   - Worker polls every `LN_POLL_INTERVAL_MS` (default: 10 seconds)
   - Acts as **safety net** for missed webhooks
   - Catches payments even if webhook delivery fails
   - Minimal API overhead (only checks pending invoices)

3. **Failure Escalation**:
   - If webhook fails but polling succeeds → Payment confirmed, webhook failure logged
   - If both fail → Payment remains pending, operator alerted after consecutive failures
   - No duplicate confirmations (payment status update is idempotent)

**Result**: **Near-instant payment detection** with **100% reliability** (webhook speed + polling safety)

**Configuration**:
```bash
LNBITS_WEBHOOK_URL=https://your-app.repl.co/webhooks/lnbits
LNBITS_WEBHOOK_SECRET=<32-byte-hex-secret>
LN_POLL_INTERVAL_MS=10000  # Safety net polling
```

#### Mode 2: Polling-Only (Development/Fallback)

**When**: `LNBITS_WEBHOOK_URL` is NOT configured

**Behavior**:
1. **Primary Detection**: Polling only
   - Worker polls every `LN_POLL_INTERVAL_MS` (default: 10 seconds)
   - **Only payment detection mechanism** (no webhooks)
   - Higher API usage (more frequent requests to LNbits)

2. **No Fallback**: Single point of detection

3. **Failure Escalation**:
   - If polling fails → Payment remains pending until next successful poll
   - Consecutive poll failures trigger degraded/error rail status
   - No alternative detection path

**Result**: **Delayed payment detection** (up to `LN_POLL_INTERVAL_MS` lag) with **higher API load**

**Configuration**:
```bash
# LNBITS_WEBHOOK_URL= (not set)
LN_POLL_INTERVAL_MS=10000  # Primary detection method
```

#### Webhook vs Polling Comparison

| Aspect | Webhook Mode | Polling-Only Mode |
|--------|--------------|-------------------|
| **Detection Speed** | Instant (< 1 second) | Delayed (up to 10 seconds) |
| **API Requests** | Low (webhook + light polling) | High (constant polling) |
| **Reliability** | Dual detection (webhook + poll) | Single detection (poll only) |
| **User Experience** | Excellent (instant confirmation) | Good (slight delay) |
| **Production Readiness** | ✅ Recommended | ⚠️ Works but not ideal |
| **Failure Recovery** | Webhook fails → poll catches | Poll fails → wait for next poll |

**Production Recommendation**: **Always configure webhooks** for best performance, user experience, and API efficiency.

---

## 5️⃣ Logging & Debug Controls

Control verbosity and debugging output for Lightning Network operations.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `LN_DEBUG_LOGGING` | boolean | `false` | Enable verbose LN debug logging |
| `LN_LOG_API_BODIES` | boolean | `false` | Log LNbits API request/response bodies |

### LN_DEBUG_LOGGING

**Default**: `false` (production-safe)

**When `true`**:
- Logs API requests/responses
- Logs webhook payloads
- Logs polling cycles
- Logs invoice status changes

**⚠️ WARNING**: May log sensitive data in development mode

**Production Rule**: **MUST be `false`** in production

**Use Cases**:
- ✅ Local development (troubleshooting integration)
- ✅ Staging (debugging payment flows)
- ❌ Production (security risk)

### LN_LOG_API_BODIES

**Default**: `false` (production-safe)

**When `true`**:
- Logs full HTTP request bodies to LNbits
- Logs full HTTP response bodies from LNbits
- Useful for debugging API integration issues

**⚠️ WARNING**: May contain payment details, BOLT11 invoices, amounts

**Production Rule**: **MUST be `false`** in production

**Use Cases**:
- ✅ Debugging LNbits API errors
- ✅ Troubleshooting malformed requests
- ❌ Production (may leak payment details)

### Logging Best Practices

**Development**:
```bash
LN_DEBUG_LOGGING=true
LN_LOG_API_BODIES=true
```

**Staging**:
```bash
LN_DEBUG_LOGGING=true
LN_LOG_API_BODIES=false  # Less sensitive
```

**Production**:
```bash
LN_DEBUG_LOGGING=false  # REQUIRED
LN_LOG_API_BODIES=false  # REQUIRED
```

---

## Security Checklist

Before enabling `ENABLE_LN=true` in production:

### Secrets Management
- [ ] `LNBITS_WALLET_KEY` stored in Replit Secrets (NOT in code)
- [ ] `LNBITS_WEBHOOK_SECRET` stored in Replit Secrets (NOT in code)
- [ ] Invoice/Read key used (NOT Admin key)
- [ ] All secrets excluded from git (check `.gitignore`)
- [ ] No secrets in logs (verified with `sanitizeMetadata()`)

### Configuration Validation
- [ ] `LNBITS_API_URL` is accessible and LNbits server is healthy
- [ ] Amount limits configured (`LN_MIN_AMOUNT_SATS`, `LN_MAX_AMOUNT_SATS`)
- [ ] Webhook URL is publicly accessible (if using webhooks)
- [ ] Webhook signature verification implemented (if using webhooks)
- [ ] Poll interval is reasonable (`LN_POLL_INTERVAL_MS` ≥ 5000ms)

### Production Hardening
- [ ] `LN_DEBUG_LOGGING=false` (REQUIRED)
- [ ] `LN_LOG_API_BODIES=false` (REQUIRED)
- [ ] Tested invoice creation on testnet first
- [ ] Tested payment flow end-to-end
- [ ] Error handling tested (LNbits offline, invalid invoices, etc.)
- [ ] Monitoring alerts configured for LN rail failures

### Testing
- [ ] Create invoice (testnet)
- [ ] Pay invoice (testnet)
- [ ] Verify instant confirmation
- [ ] Test webhook delivery (if configured)
- [ ] Test polling fallback (if webhooks configured)
- [ ] Test amount validation (below min, above max)
- [ ] Test expired invoices
- [ ] Test LNbits connectivity failures

---

## Example Configurations

### Development (Local LNbits)

```bash
# Feature flag
ENABLE_LN=true

# Rail controls
LN_BACKEND=lnbits
LN_HTTP_TIMEOUT=5000
LN_INVOICE_EXPIRY=3600
LN_MIN_AMOUNT_SATS=1
LN_MAX_AMOUNT_SATS=100000
LN_POLL_INTERVAL_MS=10000

# LNbits API (testnet)
LNBITS_API_URL=http://localhost:5000
LNBITS_WALLET_KEY=your_testnet_invoice_key_here

# Webhooks (optional in dev)
LNBITS_WEBHOOK_URL=
LNBITS_WEBHOOK_SECRET=

# Debug (enabled in dev)
LN_DEBUG_LOGGING=true
LN_LOG_API_BODIES=true
```

### Staging (Hosted LNbits Testnet)

```bash
# Feature flag
ENABLE_LN=true

# Rail controls
LN_BACKEND=lnbits
LN_HTTP_TIMEOUT=5000
LN_INVOICE_EXPIRY=3600
LN_MIN_AMOUNT_SATS=1
LN_MAX_AMOUNT_SATS=100000
LN_POLL_INTERVAL_MS=10000

# LNbits API (hosted testnet)
LNBITS_API_URL=https://legend.lnbits.com
LNBITS_WALLET_KEY=<stored_in_replit_secrets>

# Webhooks (recommended in staging)
LNBITS_WEBHOOK_URL=https://your-app-staging.repl.co/webhooks/lnbits
LNBITS_WEBHOOK_SECRET=<stored_in_replit_secrets>

# Debug (moderate in staging)
LN_DEBUG_LOGGING=true
LN_LOG_API_BODIES=false
```

### Production (Mainnet)

```bash
# Feature flag
ENABLE_LN=true

# Rail controls
LN_BACKEND=lnbits
LN_HTTP_TIMEOUT=5000
LN_INVOICE_EXPIRY=3600
LN_MIN_AMOUNT_SATS=1
LN_MAX_AMOUNT_SATS=100000
LN_POLL_INTERVAL_MS=10000

# LNbits API (mainnet)
LNBITS_API_URL=https://your-lnbits-mainnet.com
LNBITS_WALLET_KEY=<stored_in_replit_secrets>

# Webhooks (REQUIRED in production)
LNBITS_WEBHOOK_URL=https://your-app.repl.co/webhooks/lnbits
LNBITS_WEBHOOK_SECRET=<stored_in_replit_secrets>

# Debug (MUST be false in production)
LN_DEBUG_LOGGING=false
LN_LOG_API_BODIES=false
```

---

## Troubleshooting

### Common Issues

**Issue**: Invoices not being created

**Checklist**:
- [ ] `ENABLE_LN=true`
- [ ] `LNBITS_API_URL` is accessible
- [ ] `LNBITS_WALLET_KEY` is valid (Invoice/Read key)
- [ ] LNbits server is online and healthy
- [ ] Check logs for API errors

**Issue**: Payments not detected

**Checklist**:
- [ ] Invoice was paid to correct BOLT11 string
- [ ] Webhook URL is publicly accessible (if using webhooks)
- [ ] Webhook secret matches between LNbits and your app
- [ ] Polling is running (check logs for poll cycles)
- [ ] LNbits server is responding to API requests

**Issue**: Webhook signature validation fails

**Checklist**:
- [ ] `LNBITS_WEBHOOK_SECRET` matches in both systems
- [ ] Webhook payload is not modified in transit
- [ ] Signature header is being read correctly
- [ ] HMAC algorithm matches LNbits implementation

**Issue**: Amount validation rejecting valid invoices

**Checklist**:
- [ ] Check `LN_MIN_AMOUNT_SATS` and `LN_MAX_AMOUNT_SATS`
- [ ] Invoice amount is in satoshis (not millisatoshis)
- [ ] Amount is within configured limits

---

## Variable Summary Table

**Total: 19 Lightning Network Variables**

**Breakdown**:
- **7 LN Rail Control Variables** (including feature toggle): `ENABLE_LN`, `LN_BACKEND`, `LN_HTTP_TIMEOUT`, `LN_INVOICE_EXPIRY`, `LN_MIN_AMOUNT_SATS`, `LN_MAX_AMOUNT_SATS`, `LN_POLL_INTERVAL_MS`
- **3 LNbits API Variables**: `LNBITS_API_URL`, `LNBITS_WALLET_KEY`, `LNBITS_WALLET_ID`
- **4 LND Backend Variables**: `LND_GRPC_HOST`, `LND_TLS_CERT_BASE64`, `LND_INVOICE_MACAROON`, `LND_NETWORK` (NOT used by your app)
- **3 Webhook Variables**: `LNBITS_WEBHOOK_URL`, `LNBITS_WEBHOOK_SECRET`, `LNBITS_WEBHOOK_TIMEOUT_MS`
- **2 Logging Variables**: `LN_DEBUG_LOGGING`, `LN_LOG_API_BODIES`

**Total**: 7 + 3 + 4 + 3 + 2 = **19 variables**

**Security Classification**:
- **4 Secrets** (MUST store in Replit Secrets): `LNBITS_WALLET_KEY`, `LNBITS_WEBHOOK_SECRET`, `LND_TLS_CERT_BASE64`, `LND_INVOICE_MACAROON`
- **15 Public Config**: All other variables including `ENABLE_LN` (URLs, timeouts, limits, flags)

**Single Source of Truth for ENABLE_LN**:
- **Primary Definition**: `.env.example` line 95 (LN Rail Controls section)
- **Application reads from**: `process.env.ENABLE_LN` (standard environment variable)
- **Feature Flags section**: Cross-reference only (commented out to avoid duplication)
- **Validation**: Application checks `ENABLE_LN === 'true'` before activating LN rail

**Amount Limit Independence**:
- Lightning amount limits (`LN_MIN_AMOUNT_SATS`, `LN_MAX_AMOUNT_SATS`) are **independent** of BTC/XMR validation
- Each rail (BTC, XMR, LN) has its own amount validation rules
- **No regressions**: Changing LN limits does not affect BTC or XMR invoice validation

| Variable | Required | Default | Category | Security |
|----------|----------|---------|----------|----------|
| `ENABLE_LN` | ✅ | `false` | Feature Flag / Rail Control | Public |
| `LN_BACKEND` | No | `lnbits` | Rail Control | Public |
| `LN_HTTP_TIMEOUT` | No | `5000` | Rail Control | Public |
| `LN_INVOICE_EXPIRY` | No | `3600` | Rail Control | Public |
| `LN_MIN_AMOUNT_SATS` | No | `1` | Rail Control | Public |
| `LN_MAX_AMOUNT_SATS` | No | `100000` | Rail Control | Public |
| `LN_POLL_INTERVAL_MS` | No | `10000` | Rail Control | Public |
| `LNBITS_API_URL` | ✅ | - | LNbits API | Public |
| `LNBITS_WALLET_KEY` | ✅ | - | LNbits API | **Secret** |
| `LNBITS_WALLET_ID` | No | - | LNbits API | Public |
| `LNBITS_WEBHOOK_URL` | Recommended | - | Webhook | Public |
| `LNBITS_WEBHOOK_SECRET` | If webhooks | - | Webhook | **Secret** |
| `LNBITS_WEBHOOK_TIMEOUT_MS` | No | `5000` | Webhook | Public |
| `LN_DEBUG_LOGGING` | No | `false` | Debug | Public |
| `LN_LOG_API_BODIES` | No | `false` | Debug | Public |
| `LND_GRPC_HOST` | No | - | LND Backend | Public |
| `LND_TLS_CERT_BASE64` | No | - | LND Backend | **Secret** |
| `LND_INVOICE_MACAROON` | No | - | LND Backend | **Secret** |
| `LND_NETWORK` | No | `mainnet` | LND Backend | Public |

**Note**: Independent from BTC/XMR validation - each rail has its own amount limits and rules.

---

## Related Documentation

- **`.env.example`**: Full configuration template with all variables
- **`replit.md`**: Project overview and architecture decisions
- **`STEP8_TESTING_DRILLS.md`**: Testing procedures for LN rail
- **`ADMIN_API.md`**: Admin endpoints for invoice management

---

## Version History

**v1.0.0** (2025-11-20):
- Initial Lightning Network environment variable specification
- LNbits on LND architecture
- Direct integration (no microservice)
- Instant settlement design (no confirmations)
- Webhook-first with polling fallback
- Configurable amount limits in satoshis
- Comprehensive security checklist
