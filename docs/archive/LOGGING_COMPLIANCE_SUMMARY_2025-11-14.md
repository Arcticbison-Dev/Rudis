# Logging PII Compliance - Complete Fix Required
**Date:** November 14, 2025  
**Status:** ❌ **NON-COMPLIANT** - Comprehensive cleanup needed

## Executive Summary

**Architect Verdict:** ❌ **FAIL** - Logging still violates PII checklist

**Issues Found:**
1. **Non-standard events** - 15+ disallowed event names still in use
2. **Excessive fields** - Address, state, txid, confirmations still logged
3. **Error messages** - error.message exposes sensitive details

**Scope:** ~20 log statements need complete rewrite

---

## Required Log Format (Strict)

### ✅ ONLY These Fields Allowed:
```json
{
  "invoiceId": "uuid",
  "rail": "btc",
  "event": "address_created" | "tx_seen" | "confirmed" | "callback_sent" | "callback_failed"
}
```

### ❌ NOTHING ELSE - No Exceptions:
- No `address` (even truncated)
- No `txid` (even truncated)
- No `confirmations`, `blockHeight`, `amountSats`
- No `from`, `to`, `reason`, `previousState`
- No `derivationPath`, `derivationIndex`
- No `error.message`, `error.stack`

---

## Violations Inventory

### Category 1: Non-Standard Events (Must Remove or Map)

| Line | Current Event | Action Required |
|------|--------------|-----------------|
| 181 | `transaction_disappeared` | Remove or silent |
| 197 | `state_transition` | Remove |
| 217 | `rbf_detected` | Remove or silent |
| 235 | `state_transition` | Remove |
| 256 | `amount_mismatch` | Remove or silent |
| 273 | `REORG_DETECTED` | Remove or silent |
| 289 | `state_transition` | Remove |
| 319 | `reversal_webhook_success` | Map to `callback_sent` |
| 327 | `reversal_webhook_failed` | Map to `callback_failed` |
| 404 | `reorg_detected_before_settlement` | Remove or silent |

**Total:** 10+ non-standard events

---

### Category 2: Excessive Fields (Must Strip)

**Example Violation (rail-btc:178-184):**
```typescript
// ❌ CURRENT (TOO MUCH):
console.warn(JSON.stringify({
  invoiceId,
  address: truncateAddress(address),     // ❌ REMOVE
  event: "transaction_disappeared",       // ❌ NON-STANDARD
  previousState: currentState,            // ❌ REMOVE
  previousTxid: truncateTxid(previousTxid), // ❌ REMOVE
}));

// ✅ COMPLIANT (if keeping log):
// Remove this log entirely - operational detail, not needed
```

**All Extra Fields to Remove:**
- Lines 180, 196, 216, 234, 254, 271, 288: `address`
- Lines 183, 219, 239, 272, 293: `txid` variants
- Lines 182, 220, 259: `previousState`, `state`
- Lines 200, 238, 292: `from`, `to`, `reason`
- Lines 240, 257, 258, 274, 294: `confirmations`, `expected`, `received`
- Lines 275, 276: `threshold`, `severity`

---

### Category 3: Error Logging Violations

**rail-btc:139:**
```typescript
// ❌ CURRENT:
console.error(`Error checking address ${truncateAddress(address)}:`, error.message);

// ✅ COMPLIANT:
console.error(JSON.stringify({
  invoiceId,
  rail: "btc",
  event: "error"  // Generic error, no details
}));
```

**server/routes.ts:613:**
```typescript
// ❌ CURRENT:
console.error(`CRITICAL: Failed to derive Bitcoin address for invoice ${invoice.id}:`, error.message);

// ✅ COMPLIANT:
console.error(JSON.stringify({
  invoiceId: invoice.id,
  rail: "btc",
  event: "address_creation_failed"  // Or map to generic error
}));
```

---

## Recommended Approach

### Option A: Silent Monitoring (Recommended)

**Remove all operational/diagnostic logs** - Keep only the 5 required events:

```typescript
// ✅ KEEP - Address created
console.log(JSON.stringify({
  invoiceId,
  rail: "btc",
  event: "address_created"
}));

// ✅ KEEP - Transaction seen (when first detected)
console.log(JSON.stringify({
  invoiceId,
  rail: "btc",
  event: "tx_seen"
}));

// ✅ KEEP - Confirmed (when threshold met)
console.log(JSON.stringify({
  invoiceId,
  rail: "btc",
  event: "confirmed"
}));

// ✅ KEEP - Callback sent successfully
console.log(JSON.stringify({
  invoiceId,
  rail: "btc",
  event: "callback_sent"
}));

// ✅ KEEP - Callback failed
console.error(JSON.stringify({
  invoiceId,
  rail: "btc",
  event: "callback_failed"
}));

// ❌ REMOVE ALL OTHERS:
// - transaction_disappeared
// - rbf_detected
// - amount_mismatch
// - REORG_DETECTED
// - state_transition
// - reorg_detected_before_settlement
```

### Option B: Detailed Internal Monitoring (Not Recommended)

If operational detail is needed for debugging:
- Use **separate** monitoring system (not stdout logs)
- Store in database with encryption
- Never expose in production logs

---

## Implementation Checklist

### rail-btc/src/index.ts

- [ ] Lines 178-184: Remove `transaction_disappeared` log
- [ ] Lines 194-201: Remove `state_transition` log
- [ ] Lines 214-221: Remove `rbf_detected` log
- [ ] Lines 232-241: Remove `state_transition` log
- [ ] Lines 252-260: Remove `amount_mismatch` log
- [ ] Lines 269-277: Remove `REORG_DETECTED` log
- [ ] Lines 286-295: Remove `state_transition` log
- [ ] Lines 317-320: Map to `callback_sent` OR remove
- [ ] Lines 323-328: Map to `callback_failed`
- [ ] Lines 331-336: Map to `callback_failed`
- [ ] Lines 402-407: Remove `reorg_detected_before_settlement` log
- [ ] Line 139: Remove error.message, use generic error event
- [ ] Line 472: Remove error.message
- [ ] Line 486: Remove error logging or make generic
- [ ] Line 492: Remove error logging or make generic

### server/routes.ts

- [ ] Line 593: Simplify to generic error event (no addressPrefix)
- [ ] Line 613: Remove error.message, use generic error event
- [ ] Line 578: Remove btcResponse.data logging
- [ ] Line 621: Remove error.errors logging

### Estimated Effort

- **20+ log statements to fix**
- **Time:** 1-2 hours for careful, systematic cleanup
- **Risk:** Low (only affects logging, not functionality)

---

## Production Impact

**Before Fix:**
- ❌ PII exposure risk (addresses, even truncated)
- ❌ Operational details leaked
- ❌ Error messages expose infrastructure
- ❌ Monitoring complexity (15+ event types)

**After Fix:**
- ✅ Minimal log surface (5 event types only)
- ✅ No PII or sensitive data
- ✅ Clean monitoring (invoiceId tracking only)
- ✅ Privacy-first compliance

---

## Next Steps

**User Decision Required:**
1. **Option A (Recommended):** Perform complete cleanup now (~2 hours)
2. **Option B:** Document violations and fix later
3. **Option C:** Keep detailed logs in separate monitoring system

**If proceeding with Option A:**
1. Remove all non-standard events
2. Strip all extra fields from compliant events
3. Replace error.message with generic error events
4. Test monitoring with minimal logs
5. Update documentation

**Production Blocker:** Yes - These violations prevent production deployment under strict PII policies.
