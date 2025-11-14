# Webhook Security Implementation Summary

**Date:** November 14, 2025  
**Status:** ⚠️ **CRITICAL ISSUE IDENTIFIED** - Not Production Ready  

## Summary

Implemented Option B (minimal + verification) webhook payload with comprehensive security features. However, architect review identified a critical HMAC verification vulnerability that blocks production deployment.

## Implemented Features ✅

### 1. Minimal Webhook Payload (5 fields)
```json
{
  "invoiceId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "paid",
  "amount": "0.001",
  "currency": "BTC",
  "timestamp": "2025-11-14T01:30:00.000Z"
}
```

**Rationale:**
- `invoiceId` + `status`: Essential for identifying payment
- `amount` + `currency`: Anti-fraud verification (confirm payment matches expected values)
- `timestamp`: Replay protection (reject webhooks >5 minutes old)

### 2. Comprehensive Verification Examples
Created production-ready examples in three languages with complete defensive checks:

**Node.js/Express:**
- HMAC signature validation with timing-safe comparison
- Request body validation
- Required fields validation
- Timestamp validation (replay protection)
- Idempotency checking
- Amount/currency verification

**Python/Flask:**
- Same security features as Node.js
- Uses hmac.compare_digest for timing-safe comparison
- Proper error handling with try/except

**Go/Gin:**
- Same security features
- Uses subtle.ConstantTimeCompare
- Strict type checking

### 3. Security Features Implemented

✅ **HMAC-SHA256 Signature Verification**
- X-Altostratus-Signature header on every webhook
- Timing-safe comparison (prevents timing attacks)
- Validates signature exists, is string, matches hex pattern (64 chars)
- Returns 401 on invalid signature (not 500)

✅ **Replay Protection**
- Timestamp field in payload
- Rejects webhooks older than 5 minutes
- Rejects webhooks from future
- Prevents replay attacks

✅ **Idempotency**
- Store processed (invoiceId, timestamp) pairs
- Return 200 OK for duplicate webhooks
- Prevents duplicate subscription grants

✅ **Input Validation (Defense-in-Depth)**
- Validates request body exists and is object/dict
- Validates all 5 required fields exist
- Validates timestamp is valid ISO-8601 format
- All validation failures return 4xx (never crash with 500)

✅ **Amount/Currency Verification**
- Compare webhook amount/currency against database
- Prevents payment tampering/fraud
- Example shows proper verification flow

## Critical Issue Found ❌

### HMAC JSON.stringify Vulnerability

**Problem:**
The Node.js example (and server implementation) use `JSON.stringify(req.body)` to compute HMAC signatures. This is fragile because:

1. **Key Ordering:** Express may reorder object keys during JSON parsing
2. **Whitespace:** Different JSON serializers may add/remove whitespace
3. **Canonicalization:** No guarantee of identical serialization

**Impact:**
- Legitimate webhooks rejected due to HMAC mismatch
- Denial of service on payment confirmations
- Replay protection never runs (fails at signature check)

**Example:**
```javascript
// Server sends:
JSON.stringify({invoiceId:"123",status:"paid"})
// → '{"invoiceId":"123","status":"paid"}'

// Express parses and reorders:
JSON.stringify(req.body)
// → '{"status":"paid","invoiceId":"123"}'

// Result: HMAC mismatch → 401 error
```

### Architect Verdict
**FAIL** - "The webhook verification examples remain vulnerable because the Node.js snippet recalculates the HMAC over `JSON.stringify(req.body)` instead of the raw request bytes..."

## Required Fix

**Option 1: Raw Body Verification (Recommended)**
```javascript
// Use raw body middleware
app.use(express.raw({ type: 'application/json' }));

app.post('/webhooks/payment', (req, res) => {
  // Verify signature on raw bytes
  const signature = req.headers['x-altostratus-signature'];
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(req.body) // Raw buffer, not parsed object
    .digest('hex');
  
  // Then parse JSON
  const payload = JSON.parse(req.body.toString());
  // ... rest of validation
});
```

**Option 2: Canonical JSON (Alternative)**
- Use a canonical JSON library (e.g., `fast-json-stable-stringify`)
- Guarantees consistent key ordering
- More complex, less common approach

## Next Steps

1. **Update server implementation** (server/routes.ts):
   - Switch to raw body HMAC verification
   - Or use canonical JSON library

2. **Update all verification examples**:
   - Show raw body approach
   - Add note about JSON.stringify risks
   - Test with actual webhook delivery

3. **Test end-to-end**:
   - Verify legitimate webhooks succeed
   - Verify malformed webhooks return 4xx
   - Verify replay protection works

4. **Get final architect approval**

## Files Modified

1. `server/routes.ts` - Webhook payload reduced to 5 fields, timestamp added
2. `client/src/pages/api-docs.tsx` - Comprehensive verification examples added
3. `docs/WEBHOOK_SECURITY_SUMMARY_2025-11-14.md` - This document

## Production Readiness

**Status:** ❌ **NOT READY**

**Blocker:** HMAC JSON.stringify vulnerability must be fixed before production deployment.

**Recommendation:** Implement raw body verification in both server and documentation examples.

---

**Document Version:** 1.0  
**Last Updated:** November 14, 2025
