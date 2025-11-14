# Rail Security Audit - November 14, 2025

## Security Requirement Verification

### ✅ 1. Payments Service Rate Limiting
**Requirement:** `/api/invoices` (create invoice) has rate limit (10 requests/min per IP)

**Status:** ✅ **SECURE**

**Implementation:**
```typescript
// server/routes.ts
const createInvoiceLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute per IP
  message: { error: "Too many invoice creation requests, please try again later" },
});

app.post("/api/invoices", createInvoiceLimiter, async (req, res) => {
  // Invoice creation logic
});
```

---

### ✅ 2. Rail-BTC Authentication (FIXED)
**Requirement:** `rail-btc` does not accept public requests; only payments service can call `/create`

**Status:** ✅ **SECURE** (Fixed on 2025-11-14)

**Previous Vulnerability:**
- `/create` endpoint was publicly accessible without authentication
- Anyone could generate unlimited Bitcoin addresses

**Fix Implemented:**
```typescript
// rail-btc/src/index.ts

// Authentication middleware
function authenticatePaymentsService(req: Request, res: Response, next: NextFunction) {
  if (!RAIL_AUTH_TOKEN || RAIL_AUTH_TOKEN.length === 0) {
    console.error("CRITICAL: RAIL_AUTH_TOKEN not configured but /create endpoint called");
    return res.status(500).json({ error: "Server configuration error" });
  }
  
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.warn("Rail /create rejected: missing or invalid Authorization header");
    return res.status(401).json({ error: "Unauthorized" });
  }
  
  const token = authHeader.substring(7);
  
  if (!token || token.length === 0 || token !== RAIL_AUTH_TOKEN) {
    console.warn("Rail /create rejected: invalid token");
    return res.status(401).json({ error: "Unauthorized" });
  }
  
  next();
}

// Apply to endpoint
app.post("/create", authenticatePaymentsService, async (req: Request, res: Response) => {
  // ... address derivation logic
});
```

**Payments Service Update:**
```typescript
// server/routes.ts - Now sends Authorization header
const btcResponse = await axios.post(
  `${BTC_SERVICE_URL}/create`,
  {
    invoiceId: invoice.id,
    amountSats: invoice.amount,
  },
  {
    timeout: 10000,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${RAIL_AUTH_TOKEN}`,
    },
  }
);
```

---

### ✅ 3. No Public BTC Address Generation
**Requirement:** No public endpoint generates unlimited BTC addresses without auth

**Status:** ✅ **SECURE** (Fixed on 2025-11-14)

**Rail-BTC Endpoints:**
1. `POST /create` - ✅ **PROTECTED** (requires RAIL_AUTH_TOKEN)
2. `GET /health` - ✅ **PUBLIC** (safe - read-only status check, no address generation)

**Attack Prevention:**
```bash
# Before fix - VULNERABLE:
curl -X POST http://rail-btc:5002/create \
  -H "Content-Type: application/json" \
  -d '{"invoiceId":"'$(uuidgen)'","amountSats":1000}'
# → Would generate address without authentication

# After fix - PROTECTED:
curl -X POST http://rail-btc:5002/create \
  -H "Content-Type: application/json" \
  -d '{"invoiceId":"'$(uuidgen)'","amountSats":1000}'
# → Returns 401 Unauthorized

# Only payments service can call with valid token:
curl -X POST http://rail-btc:5002/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${RAIL_AUTH_TOKEN}" \
  -d '{"invoiceId":"valid-uuid","amountSats":1000}'
# → Success (generates address)
```

---

## Additional Security Layers

### Defense-in-Depth

1. **Idempotency Protection**
   - Same `invoiceId` returns existing address (no duplicate generation)
   - Prevents accidental address exhaustion even with valid auth

2. **Input Validation (Zod)**
   - `invoiceId` must be valid UUID
   - `amountSats` must be positive integer
   - Invalid inputs return 400 Bad Request

3. **Configuration Validation**
   - Server fails to start if `RAIL_AUTH_TOKEN` not configured
   - Health check reports misconfiguration (503 status)

4. **Structured Logging**
   - Authentication failures logged with event tracking
   - No PII exposure (only invoiceId, rail, event)

---

## Lightning & Monero Rails

**Lightning (rail-ln):**
- ✅ No public address generation endpoint
- ✅ Payments service does NOT call LN service for address generation
- ✅ LN invoices created via direct LND integration (not exposed publicly)

**Monero (rail-xmr):**
- ⚠️ Not yet implemented
- 📝 Should follow same pattern as rail-btc when implemented:
  - Authentication middleware required on /create endpoint
  - RAIL_AUTH_TOKEN validation
  - Rate limiting at payments service level

---

## Summary

**All Three Requirements Met:** ✅

1. ✅ Payments service has rate limiting (10/min per IP)
2. ✅ Rail-BTC requires authentication from payments service
3. ✅ No public endpoint generates unlimited BTC addresses

**Security Posture:** **PRODUCTION-READY**

---

## Files Modified

1. `rail-btc/src/index.ts`
   - Added `authenticatePaymentsService` middleware
   - Applied to `POST /create` endpoint

2. `server/routes.ts`
   - Added `Authorization: Bearer ${RAIL_AUTH_TOKEN}` header to BTC rail calls

3. `docs/RAIL_SECURITY_AUDIT_2025-11-14.md`
   - This document

---

**Audit Date:** November 14, 2025  
**Auditor:** Replit Agent  
**Status:** All security requirements verified and met
