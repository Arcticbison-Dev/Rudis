# Logging & PII Compliance Audit
**Date:** November 14, 2025  
**Scope:** Verify logs contain only safe fields, no PII or credentials

## Executive Summary
❌ **CRITICAL VIOLATIONS FOUND**  
⚠️ **Event names non-standard**  
⚠️ **Excessive detail in logs**

---

## Required Log Format (Checklist)

### ✅ Logs SHOULD Include:
- `timestamp` (automatic in structured logs)
- `invoiceId`
- `rail: "btc"` (or "ln", "xmr")
- `event: "address_created" | "tx_seen" | "confirmed" | "callback_sent" | "callback_failed"`

### ❌ Logs MUST NOT Include:
- IP addresses
- Full BTC addresses
- Full transaction IDs
- Raw transactions / full tx details
- Node credentials
- Electrum URLs
- API tokens
- Derivation paths/indices
- Payment amounts (unless explicitly allowed)
- Error stack traces with sensitive data

---

## Critical Violations Found

### ❌ VIOLATION 1: Full Bitcoin Address Logged

**Location:** `server/routes.ts:604`

```typescript
console.log(`✓ Bitcoin address derived and assigned: ${address}`);
// ❌ LOGS FULL ADDRESS: bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh
```

**Fix Required:**
```typescript
console.log(JSON.stringify({
  invoiceId: invoice.id,
  rail: "btc",
  event: "address_created",
  address: truncateAddress(address)  // ✅ bc1qxy2k...fjhx0wlh
}));
```

---

### ⚠️ VIOLATION 2: Non-Standard Event Names

**Current Events in rail-btc:**
- `address_created` ✅ (matches spec)
- `transaction_disappeared` ❌ (should be generic event or removed)
- `state_transition` ❌ (too generic, not in spec)
- `rbf_detected` ❌ (not in spec)
- `amount_mismatch` ❌ (not in spec)
- `REORG_DETECTED` ❌ (not in spec)
- `reversal_webhook_success` ❌ (should be `callback_sent`)
- `reversal_webhook_failed` ❌ (should be `callback_failed`)
- `payment_callback_failed` ❌ (should be `callback_failed`)
- `reorg_detected_before_settlement` ❌ (not in spec)

**Required Events:**
- `address_created` ✅
- `tx_seen` (when transaction first detected)
- `confirmed` (when confirmations meet threshold)
- `callback_sent` (successful callback to payments service)
- `callback_failed` (failed callback)

---

### ⚠️ VIOLATION 3: Excessive Detail in Logs

**Example 1: Address Creation (rail-btc:535-546)**
```typescript
// ❌ TOO MUCH DETAIL:
console.log(JSON.stringify({
  invoiceId,
  address: truncateAddress(address),  // OK
  derivationPath: path,               // ❌ REMOVE - internal implementation
  derivationIndex: index,             // ❌ REMOVE - internal implementation
  amountSats,                          // ❌ REMOVE - payment amount
  event: "address_created",
  state: "unseen",                     // ❌ REMOVE - internal state
}));

// ✅ SHOULD BE:
console.log(JSON.stringify({
  invoiceId,
  rail: "btc",
  event: "address_created"
}));
```

**Example 2: State Transitions (rail-btc:194-204)**
```typescript
// ❌ TOO MUCH DETAIL:
console.log(JSON.stringify({
  invoiceId,
  address: truncateAddress(address),  // ❌ REMOVE - not needed
  event: "state_transition",           // ❌ NON-STANDARD event
  from: currentState,                  // ❌ REMOVE - internal state
  to: "unseen",                        // ❌ REMOVE - internal state
  reason: "transaction_disappeared",   // ❌ REMOVE - internal detail
}));

// ✅ SHOULD BE: Remove or use standard event
```

---

### ⚠️ VIOLATION 4: Error Messages May Contain Sensitive Data

**Examples:**
```typescript
// rail-btc:139
console.error(`Error checking address ${truncateAddress(address)}:`, error.message);
// ⚠️ error.message could contain API URLs, endpoints, etc.

// rail-btc:472
console.error("Error in monitorAddresses:", error.message);
// ⚠️ error.message could expose internal details

// server/routes.ts:606
console.error(`CRITICAL: Failed to derive Bitcoin address for invoice ${invoice.id}:`, error.message);
// ⚠️ error.message could expose xpub details or derivation failures
```

**Fix:**
```typescript
// ✅ SAFE ERROR LOGGING:
console.error(JSON.stringify({
  invoiceId,
  rail: "btc",
  event: "error",
  errorType: error.name || "UnknownError"
  // ❌ NOT: error.message, error.stack
}));
```

---

## Violations by Category

### 🔴 CRITICAL (Must Fix Immediately)

1. **Full Bitcoin address logged** (server/routes.ts:604)
   - Impact: Privacy violation, address tracking
   - Fix: Use `truncateAddress()`

### 🟡 HIGH (Should Fix Before Production)

2. **Non-standard event names** (rail-btc: multiple locations)
   - Impact: Log analysis inconsistency, monitoring complexity
   - Fix: Map to standard events or remove detailed logs

3. **Excessive log detail** (rail-btc: multiple locations)
   - Impact: Privacy leakage, implementation details exposed
   - Fix: Strip derivationPath, amountSats, state transitions

4. **Error messages with sensitive data** (both services)
   - Impact: Potential credential/URL exposure
   - Fix: Log error types only, not messages

### 🟢 LOW (Nice to Have)

5. **Startup banners with config details** (both services)
   - Impact: Minor information disclosure
   - Fix: Remove network/port details from production logs

---

## Compliance Matrix

| Log Location | Has invoiceId | Has rail | Has standard event | Has PII | Status |
|--------------|---------------|----------|-------------------|---------|--------|
| server/routes.ts:604 | ❌ No | ❌ No | ❌ No | ❌ **FULL ADDRESS** | 🔴 **CRITICAL** |
| rail-btc:535-546 | ✅ Yes | ❌ No | ✅ Yes | ⚠️ derivationPath, amount | 🟡 HIGH |
| rail-btc:181-187 | ✅ Yes | ❌ No | ❌ No (state_transition) | ✅ None (truncated) | 🟡 HIGH |
| rail-btc:442-450 | ✅ Yes | ❌ No | ❌ No (state_transition) | ✅ None (truncated) | 🟡 HIGH |
| server/routes.ts:639 | ✅ Yes | ✅ Yes | ⚠️ "settled" vs "confirmed" | ✅ None | 🟢 LOW |
| server/routes.ts:709 | ✅ Yes | ✅ Yes | ✅ "confirmed" | ✅ None | ✅ **PASS** |

---

## Recommended Fixes

### Fix 1: Replace Full Address Logging

**File:** `server/routes.ts:604`

```typescript
// ❌ BEFORE:
console.log(`✓ Bitcoin address derived and assigned: ${address}`);

// ✅ AFTER:
console.log(JSON.stringify({
  invoiceId: invoice.id,
  rail: "btc",
  event: "address_created"
}));
```

### Fix 2: Standardize Event Names

**Create event mapping:**
```typescript
// rail-btc/src/index.ts - Add at top
const STANDARD_EVENTS = {
  ADDRESS_CREATED: "address_created",
  TX_SEEN: "tx_seen",
  CONFIRMED: "confirmed",
  CALLBACK_SENT: "callback_sent",
  CALLBACK_FAILED: "callback_failed",
} as const;
```

**Update logs:**
```typescript
// ✅ Transaction first seen
console.log(JSON.stringify({
  invoiceId,
  rail: "btc",
  event: STANDARD_EVENTS.TX_SEEN
}));

// ✅ Payment confirmed (threshold met)
console.log(JSON.stringify({
  invoiceId,
  rail: "btc",
  event: STANDARD_EVENTS.CONFIRMED
}));

// ✅ Callback sent successfully
console.log(JSON.stringify({
  invoiceId,
  rail: "btc",
  event: STANDARD_EVENTS.CALLBACK_SENT
}));

// ✅ Callback failed
console.log(JSON.stringify({
  invoiceId,
  rail: "btc",
  event: STANDARD_EVENTS.CALLBACK_FAILED
}));
```

### Fix 3: Strip Excessive Details

**Remove from all logs:**
- `derivationPath`
- `derivationIndex`
- `amountSats` / `amount`
- `from` / `to` (state names)
- `reason`
- `confirmations` (except in confirmed event)
- `blockHeight`
- `address` (except where required, then truncated)
- `txid` (except where required, then truncated)

**Minimal log format:**
```typescript
// ✅ COMPLIANT LOG:
console.log(JSON.stringify({
  invoiceId: "550e8400-e29b-41d4-a716-446655440000",
  rail: "btc",
  event: "tx_seen"
}));
```

### Fix 4: Safe Error Logging

```typescript
// ❌ BEFORE:
console.error(`Error checking address ${truncateAddress(address)}:`, error.message);

// ✅ AFTER:
console.error(JSON.stringify({
  invoiceId,
  rail: "btc",
  event: "error",
  errorType: error.constructor.name
}));
```

---

## Credentials & URLs Audit

### ✅ PASS: No Credentials Logged

**Verified:**
```bash
grep -r "RAIL_AUTH_TOKEN\|BTC_XPUB\|ADMIN_SIM_TOKEN" rail-btc/src/*.ts server/routes.ts | grep console
# Result: NO MATCHES ✅ (only used in conditionals, never logged)
```

**Startup messages mention variable names but not values:**
```typescript
// ✅ SAFE (names only, no values):
console.error("Set required environment variables:");
console.error("  - BTC_XPUB");  // ✅ Just the name
console.error("  - RAIL_AUTH_TOKEN");  // ✅ Just the name
```

### ✅ PASS: No API URLs Logged

**Verified:**
```bash
grep -r "PAYMENTS_SERVICE_URL\|MEMPOOL_API_BASE" rail-btc/src/*.ts | grep console
# Result: Only in variable assignment, not in logs ✅
```

---

## IP Address Logging Audit

### ✅ PASS: No IP Addresses Logged

**Verified:**
```bash
grep -r "req\.ip\|req\.headers\|x-forwarded-for" server/routes.ts
# Result: NO MATCHES ✅
```

**Note:** Express may log IPs in access logs, but application code doesn't explicitly log them.

---

## Action Items

### Immediate (Critical - Block Production)

- [ ] **Fix full address logging** (server/routes.ts:604)
  - Replace with truncated address or remove

### High Priority (Before Production)

- [ ] **Standardize event names** (rail-btc: all locations)
  - Map to: address_created, tx_seen, confirmed, callback_sent, callback_failed
  - Remove non-standard events or map them

- [ ] **Strip excessive details** (rail-btc: all JSON logs)
  - Remove: derivationPath, derivationIndex, amountSats, states, reasons

- [ ] **Safe error logging** (both services)
  - Log error types only, not messages

### Low Priority (Nice to Have)

- [ ] **Minimize startup banners** (both services)
  - Keep essential info only
  - Remove network/port in production

---

## Compliance Summary

| Requirement | Status | Details |
|------------|--------|---------|
| Only timestamp, invoiceId, rail, event | ❌ **FAIL** | Too many extra fields |
| Standard event names | ⚠️ **PARTIAL** | Many non-standard events |
| No IP addresses | ✅ **PASS** | None logged |
| No full BTC addresses | ❌ **FAIL** | server/routes.ts:604 |
| No full tx details | ✅ **PASS** | Truncated |
| No credentials/tokens | ✅ **PASS** | Only names, not values |
| No API URLs | ✅ **PASS** | None logged |

**Overall Status:** ❌ **NON-COMPLIANT** - Critical fixes required

**Estimated Fix Time:** 2 hours (systematic log cleanup across both services)
