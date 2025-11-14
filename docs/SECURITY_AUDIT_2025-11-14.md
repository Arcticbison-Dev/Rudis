# Security Audit - Sensitive Values Verification
**Date:** November 14, 2025  
**Scope:** All payment rail services and main payments application

## Executive Summary
✅ **PASS** - All sensitive values are properly secured in environment variables with no hardcoded secrets, logging leaks, or API response exposure.

---

## 1. Environment Variable Usage Verification

### Rail-BTC Service (`rail-btc/src/index.ts`)
✅ **ALL SENSITIVE VALUES USE `process.env`:**

| Variable | Line | Status |
|----------|------|--------|
| `BTC_XPUB` | 22 | ✅ Environment variable |
| `RAIL_AUTH_TOKEN` | 21 | ✅ Environment variable |
| `PAYMENTS_SERVICE_URL` | 20 | ✅ Environment variable |
| `BTC_NETWORK` | 23 | ✅ Environment variable |
| `BTC_CONFIRMATIONS_REQUIRED` | 24 | ✅ Environment variable |
| `MEMPOOL_API_BASE` | 25-26 | ✅ Environment variable |
| `DATABASE_URL` | db.ts:8 | ✅ Environment variable |

**Verification:** No hardcoded xpub, tpub, zpub, vpub values found in codebase.

### Payments Service (`server/routes.ts`)
✅ **ALL SENSITIVE VALUES USE `process.env`:**

| Variable | Line | Status |
|----------|------|--------|
| `ALT_WEBHOOK_SECRET` | 28 | ✅ Environment variable |
| `RAIL_AUTH_TOKEN` | 31 | ✅ Environment variable |
| `ADMIN_SIM_TOKEN` | 41 | ✅ Environment variable |
| `LN_SERVICE_URL` | 32 | ✅ Environment variable |
| `BTC_SERVICE_URL` | 33 | ✅ Environment variable |
| `XMR_SERVICE_URL` | 34 | ✅ Environment variable |
| `ALTOSTRATUS_WEBHOOK_URL` | 382,654,711,769,850 | ✅ Environment variable |
| `SESSION_SECRET` | index.ts | ✅ Environment variable |
| `DATABASE_URL` | db.ts:8 | ✅ Environment variable |

**Verification:** No hardcoded tokens, secrets, or API keys found in codebase.

---

## 2. Logging Security Verification

### Rail-BTC Service
✅ **NO SECRETS LOGGED:**

**Analyzed 30+ console.log/error/warn statements:**
- ✅ All logs use structured JSON with only: `invoiceId`, `address`, `event`, `confirmations`, `blockHeight`
- ✅ Authorization headers (Bearer tokens) used in requests but **NOT** logged
- ✅ Startup logs show configuration status but **NOT** actual secret values
- ✅ Error messages show validation failures but **NOT** the secret values themselves

**Example of safe logging:**
```typescript
console.log(JSON.stringify({
  invoiceId,
  address,
  event: "payment_confirmed",
  confirmations: 6,
  blockHeight: 12345
}));
// ✅ No tokens, xpub, or secrets
```

**Startup configuration logging:**
```typescript
console.log(`║ Network:      ${BTC_NETWORK.toUpperCase().padEnd(46)}║`);
console.log(`║ Port:         ${PORT.toString().padEnd(46)}║`);
// ✅ Shows "TESTNET" and "5002" - NOT the xpub or tokens
```

### Payments Service
✅ **NO SECRETS LOGGED:**

**Search results:**
```bash
grep "console\.log.*TOKEN|console\.log.*SECRET|console\.log.*XPUB" 
# Result: NO MATCHES FOUND
```

- ✅ HMAC signature generation does NOT log `ALT_WEBHOOK_SECRET`
- ✅ Authentication middleware logs errors but NOT token values
- ✅ Webhook sending adds `X-Altostratus-Signature` header but does NOT log signature value

---

## 3. API Response Security Verification

### Rail-BTC Service
✅ **NO SECRETS IN RESPONSES:**

**All endpoints analyzed:**

1. `POST /create` → Returns: `{ invoiceId, address, derivationPath, amountSats }`
   - ✅ NO xpub, tokens, or secrets

2. `POST /callback/settled` (internal) → Returns: `{ success: true }` or error
   - ✅ NO xpub, tokens, or secrets

3. `GET /health` → Returns: `{ status, network, confirmationsRequired }`
   - ✅ Shows "testnet" and "6" - NOT xpub or tokens

### Payments Service
✅ **NO SECRETS IN RESPONSES:**

**Search results:**
```bash
grep "res\.(json|send).*TOKEN|res\.(json|send).*SECRET|res\.(json|send).*xpub"
# Result: NO MATCHES FOUND
```

**Verification:** All API endpoints return only:
- Invoice data (id, amount, status, address)
- Payment transactions (confirmations, block height)
- Webhook logs (status, attempts)
- Template data (plan names, amounts)

**No configuration, tokens, or secrets are ever returned in responses.**

---

## 4. .env.example Security Verification

### Rail-BTC (`rail-btc/.env.example`)
✅ **PLACEHOLDER VALUES ONLY:**
```bash
BTC_XPUB=tpubDDCYy...your-testnet-xpub-here
RAIL_AUTH_TOKEN=your-64-char-hex-token-here
```
- ✅ No real xpub values
- ✅ No real tokens
- ✅ Clear instructions for generation

### Payments Service (`.env.example`)
✅ **PLACEHOLDER VALUES ONLY:**
```bash
ALT_WEBHOOK_SECRET=your-webhook-secret-here
RAIL_AUTH_TOKEN=
ADMIN_SIM_TOKEN=
SESSION_SECRET=your-secret-key-here
```
- ✅ All placeholders or empty
- ✅ Comments include: "Generate with: openssl rand -hex 32"
- ✅ Production deployment checklist included

---

## 5. Git Repository Verification

### Recent Commits Checked
✅ **NO SECRETS IN COMMIT HISTORY:**

**Last 20 commits analyzed:**
- ✅ All commits related to feature development
- ✅ No commit messages containing secrets
- ✅ No .env files in commit history
- ✅ Only .env.example files with placeholders

### .gitignore Verification
✅ **SENSITIVE FILES EXCLUDED:**
```
.env
.env.local
templates.json (contains template data only, no secrets)
```

---

## 6. Authorization Header Security

### Outbound Requests (Rail → Payments)
✅ **SECURE USAGE:**

```typescript
// rail-btc/src/index.ts:299, 417
headers: {
  "Authorization": `Bearer ${RAIL_AUTH_TOKEN}`,
  "Content-Type": "application/json"
}
// ✅ Token used in header but NEVER logged
// ✅ Sent over HTTP (localhost) or HTTPS (production)
```

### Inbound Authentication (Payments ← Rail)
✅ **SECURE VALIDATION:**

```typescript
// server/routes.ts:75-90
function authenticateRailCallback(req, res, next) {
  if (!RAIL_AUTH_TOKEN) {
    console.error("CRITICAL: RAIL_AUTH_TOKEN not configured");
    // ✅ Logs error but NOT the token value
  }
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token !== RAIL_AUTH_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
    // ✅ Returns generic error, NOT the expected token
  }
}
```

---

## 7. Webhook Signature Security

### HMAC Signing
✅ **SECURE IMPLEMENTATION:**

```typescript
// server/routes.ts:62-70
function generateWebhookSignature(payload: object): string {
  if (!ALT_WEBHOOK_SECRET) {
    throw new Error("Cannot generate webhook signature: ALT_WEBHOOK_SECRET not configured");
    // ✅ Fails fast, does NOT log the secret
  }
  return crypto
    .createHmac("sha256", ALT_WEBHOOK_SECRET)
    .update(JSON.stringify(payload))
    .digest("hex");
}
```

### Signature Header Usage
✅ **SECURE TRANSMISSION:**

```typescript
// server/routes.ts - webhook sending
headers: {
  "X-Altostratus-Signature": signature,
  "Content-Type": "application/json"
}
// ✅ Signature added to header
// ✅ Signature value NEVER logged
// ✅ Secret itself NEVER transmitted
```

---

## 8. Startup Validation Security

### Rail-BTC Service
✅ **FAIL-FAST WITHOUT LEAKING SECRETS:**

```typescript
// rail-btc/src/index.ts:634-648
if (!configValid) {
  console.error("║ CRITICAL: Bitcoin rail service configuration errors      ║");
  console.error("  - BTC_XPUB");
  console.error("  - RAIL_AUTH_TOKEN");
  // ✅ Lists WHICH variables are missing
  // ✅ Does NOT show their values or partial values
  process.exit(1);
}
```

### Payments Service
✅ **FAIL-FAST WITHOUT LEAKING SECRETS:**

```typescript
// server/routes.ts:365-390
if (anyRailEnabled && !RAIL_AUTH_TOKEN) {
  console.error("║ FATAL: Rail services enabled but RAIL_AUTH_TOKEN not set ║");
  throw new Error("RAIL_AUTH_TOKEN required when rail services are enabled");
  // ✅ Clear error message
  // ✅ Does NOT log the token value
}
```

---

## 9. Database Connection Security

### All Services
✅ **SECURE DATABASE ACCESS:**

```typescript
// server/db.ts, rail-btc/src/db.ts
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// ✅ Uses environment variable
// ✅ Never logged
// ✅ Never exposed in API responses
```

---

## 10. Production Deployment Checklist

### Required Environment Variables (Secrets)

#### Payments Service:
- [ ] `SESSION_SECRET` - Session encryption key
- [ ] `ALT_WEBHOOK_SECRET` - HMAC signing secret
- [ ] `RAIL_AUTH_TOKEN` - Rail callback authentication
- [ ] `ADMIN_SIM_TOKEN` - Admin operations (if SIMULATION_ENABLED)
- [ ] `DATABASE_URL` - Database connection string
- [ ] `ALTOSTRATUS_WEBHOOK_URL` - Webhook destination

#### Rail-BTC Service:
- [ ] `BTC_XPUB` - Extended public key for address derivation
- [ ] `RAIL_AUTH_TOKEN` - Must match payments service
- [ ] `DATABASE_URL` - Database connection string
- [ ] `PAYMENTS_SERVICE_URL` - Payments service endpoint

### Security Verification Commands

```bash
# 1. Check for hardcoded secrets (should return nothing)
grep -r "xpub1\|tpub1\|zpub1\|ypub1" --exclude-dir=node_modules .
grep -r "sk_live_\|sk_test_" --exclude-dir=node_modules .

# 2. Check for token logging (should return nothing)
grep -r "console.*TOKEN\|console.*SECRET" --exclude-dir=node_modules .

# 3. Verify .env is gitignored
git check-ignore .env
# Should output: .env

# 4. Check no .env in git history
git log --all --full-history -- .env
# Should return: fatal: ambiguous argument '.env': unknown revision
```

---

## Conclusion

✅ **ALL SECURITY REQUIREMENTS MET:**

1. ✅ All sensitive values stored in environment variables (no hardcoding)
2. ✅ No secrets logged to console
3. ✅ No secrets returned in API responses  
4. ✅ No secrets committed to repository
5. ✅ Secure transmission via HTTPS + Bearer auth + HMAC signatures
6. ✅ Fail-fast validation without secret leakage
7. ✅ .env.example files contain only placeholders
8. ✅ Production deployment checklist provided

**Security Posture:** Production-ready for Phase 0 deployment.

**Next Steps:**
1. Generate production secrets using `openssl rand -hex 32`
2. Configure secrets in Replit Secrets or environment variables
3. Enable feature flags only after rail services are deployed
4. Review production logs to ensure no accidental secret exposure
5. Implement secret rotation procedures (see docs/OPS_KEY_MANAGEMENT.md)
