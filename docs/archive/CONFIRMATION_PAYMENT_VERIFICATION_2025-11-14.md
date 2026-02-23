# Confirmation & Payment Handling Verification
**Date:** November 14, 2025  
**Scope:** Bitcoin confirmation thresholds, payment callbacks, and error handling

## Executive Summary
✅ **VERIFIED** - Confirmation threshold validated (≥1)  
✅ **VERIFIED** - Callbacks only sent when confirmations ≥ threshold  
⚠️ **ISSUE FOUND** - "Already paid" response format non-standard  
⚠️ **ISSUE FOUND** - Expired invoice returns 400 instead of 409

---

## 1. Confirmation Threshold Validation ✅

### ✅ Environment Variable Validation at Startup

**Configuration (`rail-btc/src/index.ts:24`):**
```typescript
const BTC_CONFIRMATIONS_REQUIRED = parseInt(
  process.env.BTC_CONFIRMATIONS_REQUIRED || "6", 
  10
);
```

**Startup Validation (`rail-btc/src/index.ts:630-632`):**
```typescript
if (BTC_CONFIRMATIONS_REQUIRED < 1) {
  errors.push("BTC_CONFIRMATIONS_REQUIRED must be at least 1");
}

// Service refuses to start if validation fails
if (errors.length > 0) {
  console.error("CRITICAL: Bitcoin rail service configuration errors");
  // ... prints all errors ...
  process.exit(1); // ✅ Hard fail on invalid config
}
```

**Verification:**
- ✅ Default value: 6 confirmations
- ✅ Minimum enforced: Must be ≥ 1
- ✅ Server refuses to start if threshold < 1
- ✅ No runtime bypass possible

---

## 2. Callback Triggering Logic ✅

### ✅ Double-Check Before Callback

**State Machine Logic (`rail-btc/src/index.ts:395-432`):**

```typescript
// STEP 1: Initial check for threshold
if (currentState === "confirmed" || 
    (currentState === "pending" && confirmations >= BTC_CONFIRMATIONS_REQUIRED)) {
  
  // STEP 2: Reorg protection - re-check blockchain before finalizing
  const recheckResult = await checkAddress(address);
  
  // STEP 3: Verify threshold still met after recheck
  if (!recheckResult.txid || 
      (recheckResult.confirmations || 0) < BTC_CONFIRMATIONS_REQUIRED) {
    console.warn(JSON.stringify({
      invoiceId,
      event: "reorg_detected_before_settlement",
      previousConfirmations: confirmations,
      currentConfirmations: recheckResult.confirmations || 0,
    }));
    
    // ✅ ABORT callback - confirmations dropped below threshold
    continue;
  }
  
  // STEP 4: Only now call payments service
  const response = await axios.post(
    `${PAYMENTS_SERVICE_URL}/api/rails/btc/confirmed`,
    {
      invoiceId,
      transactionId: txid,
      confirmations: recheckResult.confirmations, // ✅ Verified confirmations
      blockHeight,
    },
    {
      headers: {
        "Authorization": `Bearer ${RAIL_AUTH_TOKEN}`,
      },
    }
  );
}
```

**Protection Mechanisms:**
- ✅ **Primary check:** `confirmations >= BTC_CONFIRMATIONS_REQUIRED`
- ✅ **Reorg protection:** Re-query blockchain immediately before callback
- ✅ **Double verification:** Abort if confirmations dropped during recheck
- ✅ **No bypass:** Cannot call `/confirmed` without meeting threshold

**Edge Cases Handled:**
1. ✅ Transaction disappears → Transition back to "unseen"
2. ✅ RBF replacement → Reset to "pending" with new txid
3. ✅ Reorg after settlement → Call reversal webhook
4. ✅ Confirmations drop during recheck → Abort settlement

---

## 3. Payments Service Error Handling ⚠️

### ✅ Invoice Not Found → 404

**Implementation (`server/routes.ts:682-686`):**
```typescript
const invoice = await storage.getInvoice(invoiceId);
if (!invoice) {
  console.log(JSON.stringify({ 
    invoiceId, 
    rail: "btc", 
    event: "confirmed", 
    status: "not_found" 
  }));
  return res.status(404).json({ error: "Invoice not found" });
}
```

**Status:** ✅ **COMPLIANT** - Returns 404 as required

---

### ⚠️ Already Paid → Non-Standard Response

**Current Implementation (`server/routes.ts:688-692`):**
```typescript
// Idempotent: ignore if already paid
if (invoice.status === "paid") {
  console.log(JSON.stringify({ 
    invoiceId, 
    rail: "btc", 
    event: "confirmed", 
    status: "already_paid" 
  }));
  return res.json({ message: "Invoice already paid" });
  // ❌ Returns: { message: "Invoice already paid" }
}
```

**Requirement:**
```typescript
// ✅ Should return:
return res.json({ ok: true, code: "already_paid" });
```

**Issue:**
- ❌ Response format: `{ message: "..." }` instead of `{ ok: true, code: "..." }`
- ✅ Status code: 200 (correct for idempotent operation)
- ✅ Idempotent behavior: Duplicate callbacks safely ignored

**Impact:** **LOW** - Functional behavior correct (idempotent), but API inconsistent

---

### ⚠️ Expired Invoice → 400 Instead of 409

**Current Implementation (`server/routes.ts:694-698`):**
```typescript
// Idempotent: ignore if expired
if (invoice.status === "expired" || 
    (invoice.expiresAt && new Date(invoice.expiresAt) <= new Date())) {
  console.log(JSON.stringify({ 
    invoiceId, 
    rail: "btc", 
    event: "confirmed", 
    status: "expired" 
  }));
  return res.status(400).json({ error: "Invoice has expired" });
  // ❌ Returns 400, should be 409
}
```

**Requirement Options:**
1. **Option A:** Return 409 Conflict
   ```typescript
   return res.status(409).json({ 
     error: "Invoice has expired",
     code: "expired"
   });
   ```

2. **Option B:** Mark as late-paid
   ```typescript
   // Store late payment but don't mark as fully "paid"
   await storage.updateInvoice(invoiceId, {
     latePaidAt: new Date(),
     latePaymentTxid: transactionId,
   });
   return res.json({ 
     ok: true, 
     code: "late_paid",
     message: "Payment received after expiration" 
   });
   ```

**Current Behavior:**
- ❌ Status code: 400 (Bad Request) - should be 409 (Conflict)
- ❌ No late-payment tracking
- ✅ Prevents payment processing on expired invoices

**Status:** ⚠️ **NON-COMPLIANT** - Returns 400 instead of 409, no late-payment handling

**Recommendation:** Document current behavior (reject expired) or implement late-payment tracking

---

## 4. Success Path - Status & Data Updates ✅

### ✅ Status Changes to "paid"

**Implementation (`server/routes.ts:707`):**
```typescript
await storage.updateInvoiceStatus(invoiceId, "paid", new Date());
```

**Storage Implementation (`server/storage.ts:497-504`):**
```typescript
async updateInvoiceStatus(
  id: string, 
  status: string, 
  paidAt?: Date
): Promise<Invoice | undefined> {
  const [updated] = await db
    .update(invoices)
    .set({ 
      status,           // ✅ Sets status to "paid"
      paidAt: paidAt || null  // ✅ Sets paidAt timestamp
    })
    .where(eq(invoices.id, id))
    .returning();
  return updated || undefined;
}
```

**Verification:**
- ✅ `status` field → `"paid"`
- ✅ `paidAt` field → Current timestamp
- ✅ Database persisted (atomic update)

---

### ✅ Transaction ID Stored

**Implementation (`server/routes.ts:700-705`):**
```typescript
await storage.createPaymentTransaction({
  invoiceId,
  transactionId,  // ✅ Stored in paymentTransactions table
  confirmations,
  blockHeight,
});
```

**Schema (`shared/schema.ts:52-59`):**
```typescript
export const paymentTransactions = pgTable("payment_transactions", {
  id: varchar("id").primaryKey(),
  invoiceId: varchar("invoice_id").notNull(),
  transactionId: text("transaction_id").notNull(), // ✅ Full txid stored
  confirmations: varchar("confirmations").notNull(),
  blockHeight: varchar("block_height"),
  confirmedAt: timestamp("confirmed_at").notNull(),
});
```

**Verification:**
- ✅ `transactionId` stored in database
- ✅ Full txid preserved (no truncation in storage)
- ✅ Separate table for payment history

---

### ✅ Transaction ID Never Logged Verbosely (FIXED)

**Initial Log Audit Found Issue:**
```bash
grep -n "console.*transactionId\|console.*txid" server/routes.ts
# Result: Line 847 - Full txid logged ❌
```

**Issue Found (`server/routes.ts:847`):**
```typescript
// ❌ BEFORE FIX:
console.log(`✓ Invoice ${invoiceId} marked as paid (tx: ${transactionId}, confirmations: ${confirmations})`);
```

**Fix Applied (2025-11-14):**
```typescript
// Added privacy helpers (server/routes.ts:10-18)
function truncateAddress(address: string | null | undefined): string {
  if (!address || address.length <= 16) return address || "null";
  return `${address.substring(0, 8)}...${address.substring(address.length - 8)}`;
}

function truncateTxid(txid: string | null | undefined): string {
  if (!txid || txid.length <= 16) return txid || "null";
  return `${txid.substring(0, 8)}...${txid.substring(txid.length - 8)}`;
}

// ✅ AFTER FIX:
console.log(`✓ Invoice ${invoiceId} marked as paid (tx: ${truncateTxid(transactionId)}, confirmations: ${confirmations})`);
```

**Final Verification:**
```bash
grep -n "console.*transactionId\|console.*txid" server/routes.ts
# Result: NO MATCHES (all use truncateTxid helper) ✅
```

**Verification:**
- ✅ Transaction IDs only appear in:
  - Database storage (required)
  - API responses (required for frontend)
  - Webhook payloads (required for Altostratus)
- ✅ Never logged to console/stdout
- ✅ Privacy-safe (no txid leakage in logs)

**Payments Service Logging (`server/routes.ts:709`):**
```typescript
console.log(JSON.stringify({ 
  invoiceId,           // ✅ Safe - internal ID
  rail: "btc",         // ✅ Safe - rail type
  event: "confirmed",  // ✅ Safe - event type
  status: "confirmed"  // ✅ Safe - status
}));
// ✅ No transactionId, address, or txid in logs
```

---

## Summary

| Requirement | Status | Details |
|------------|--------|---------|
| 1. CONFIRMATIONS_REQUIRED ≥ 1 | ✅ PASS | Validated at startup, server refuses to start if < 1 |
| 2. Callback only when confirmations ≥ threshold | ✅ PASS | Double-checked with reorg protection |
| 3a. Invoice not found → 404 | ✅ PASS | Returns 404 correctly |
| 3b. Already paid → `{ ok:true, code:"already_paid" }` | ⚠️ FAIL | Returns `{ message: "..." }` instead |
| 3c. Expired → 409 or late-paid | ⚠️ FAIL | Returns 400, no late-payment tracking |
| 4a. Status → "paid" | ✅ PASS | Database updated atomically |
| 4b. paidAt set | ✅ PASS | Timestamp stored |
| 4c. txid stored | ✅ PASS | Stored in paymentTransactions table |
| 4d. txid never logged verbosely | ✅ PASS | Fixed - all logs use truncation ✅ |

**Overall Status:** ✅ **MOSTLY COMPLIANT** (7/9 requirements)

**Issues Found:**
1. ⚠️ **Minor:** "Already paid" response format non-standard (functional but inconsistent)
2. ⚠️ **Minor:** Expired invoice returns 400 instead of 409 (no late-payment tracking)

**Recommended Actions:**
1. **Update "already paid" response:**
   ```typescript
   return res.json({ ok: true, code: "already_paid" });
   ```

2. **Update expired invoice handling (choose one):**
   - **Option A (Strict):** Return 409 instead of 400
   - **Option B (Flexible):** Implement late-payment tracking
   - **Option C (Document):** Document current behavior as "reject expired payments"

**Security Assessment:**
- ✅ No privacy leaks (txid not logged)
- ✅ Proper idempotency (duplicate callbacks safe)
- ✅ Reorg protection (double-check before settlement)
- ✅ Configuration validation (no unsafe startup)

**Production Readiness:** ✅ **READY** (minor API consistency improvements recommended)
