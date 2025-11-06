# Invoice Status Semantics

This document defines the precise meaning and behavior of each invoice status in the Altostratus Payments system.

## Status Flow Diagram

```
┌─────────┐
│ pending │◄─────┐
└────┬────┘      │
     │           │ (reorg: confirmations drop)
     │           │
     ├──────────►│
     │     paid  │
     │   (revert)│
     │           │
     ▼           │
┌─────────┐      │
│  paid   │──────┘
└─────────┘

     ▲
     │
     │ (time expired)
     │
┌─────────┐
│ expired │
└─────────┘
     ▲
     │ (payment received late)
     │
┌───────────┐
│ late-paid │ (future feature)
└───────────┘
```

## Status Definitions

### `pending`

**Meaning**: Invoice created and awaiting payment

**Characteristics**:
- Invoice was created successfully
- Payment address/BOLT11 invoice generated
- QR code can be scanned
- Blockchain listener actively monitoring for payment
- No payment detected yet OR payment detected but insufficient confirmations

**User Actions Available**:
- Pay the invoice
- View invoice details
- Cancel/abandon (system will auto-expire)

**System Behavior**:
- Auto-refresh UI every 5 seconds
- Check for expiration on every view
- Show countdown if expiring soon
- Monitor blockchain for incoming transactions

**Transitions To**:
- `paid`: When payment confirmed with required confirmations
- `expired`: When `expiresAt` time passes without payment

**API Behavior**:
- GET /api/invoices/:id returns full invoice
- Payment callback accepted (if not expired)
- Can be simulated (dev only)

---

### `paid`

**Meaning**: Payment received and confirmed on blockchain

**Characteristics**:
- Full payment amount received
- Required confirmations met
- Transaction ID recorded
- Webhook successfully sent to Altostratus (or queued)
- Invoice is finalized and cannot be paid again

**User Actions Available**:
- View invoice details
- View transaction details
- View blockchain explorer link

**System Behavior**:
- No longer monitoring for additional payments
- Displays transaction confirmation details
- Shows "Payment confirmed" success message
- Records payment source (rail-ln, rail-btc, rail-xmr, simulate)

**Transitions To**:
- `pending`: Only if blockchain reorg causes confirmations to drop below threshold (rare)
- (No other transitions - terminal state in normal operation)

**API Behavior**:
- GET /api/invoices/:id returns full invoice with `paidAt` timestamp
- GET /api/invoices/:id/transactions returns payment details
- Further payment callbacks rejected with "already paid"

---

### `expired`

**Meaning**: Invoice expiration time passed without payment

**Characteristics**:
- `expiresAt` timestamp has passed
- No payment received (or insufficient confirmations before expiry)
- Payment address/BOLT11 no longer monitored
- Cannot be paid (system will reject payment)
- Marked for eventual deletion per retention policy

**User Actions Available**:
- View invoice details
- Create new invoice with same details (if needed)

**System Behavior**:
- Shows "Invoice expired" message
- Automated cleanup job will purge after CLEANUP_EXPIRED_DAYS (30-90)
- Payment callbacks rejected with 400 error
- UI no longer auto-refreshes

**Transitions To**:
- `late-paid`: If payment received after expiration (future feature, requires manual intervention)
- (Deleted): After retention period

**API Behavior**:
- GET /api/invoices/:id returns invoice with status="expired"
- Payment callbacks rejected: `{ error: "Invoice has expired" }`
- Cannot simulate payment

---

### `late-paid` (Future Enhancement)

**Meaning**: Payment received after invoice expiration

**Characteristics**:
- Invoice was `expired`
- Payment detected on blockchain anyway (Bitcoin/Monero only)
- Requires manual admin review
- Not automatically credited

**User Actions Available**:
- Contact support
- Wait for manual processing
- Request refund

**System Behavior**:
- Admin dashboard shows "late-paid" invoices
- Admin can:
  - Accept payment and manually credit
  - Issue refund
  - Mark as resolved
- Webhook not sent automatically (manual trigger only)

**Transitions To**:
- `paid`: After admin accepts and processes
- `refunded`: After admin issues refund
- (Deleted): If admin marks as invalid/spam

**API Behavior** (not yet implemented):
- GET /api/invoices/:id returns status="late-paid"
- Admin-only endpoint: POST /api/invoices/:id/resolve

---

### `refunded` (Future Enhancement)

**Meaning**: Payment was refunded to customer

**Characteristics**:
- Invoice was previously `paid`
- Admin initiated refund transaction
- Refund transaction sent on blockchain
- Refund amount = payment - network fees

**User Actions Available**:
- View refund details
- View refund transaction ID
- Track refund on blockchain

**System Behavior**:
- Records refund transaction ID
- Shows refund amount and fees
- Webhook sent to Altostratus notifying of refund
- Displays blockchain explorer link for refund tx

**Transitions To**:
- (Terminal state)

**API Behavior** (not yet implemented):
- GET /api/invoices/:id returns status="refunded"
- Additional fields: `refundedAt`, `refundTransactionId`, `refundAmount`

---

## Edge Cases & Special Behaviors

### Idempotent Payment Processing

If a payment callback is received for an invoice that's already `paid`:
- Return 200 OK with message: "Invoice already paid"
- Do NOT create duplicate transaction record
- Do NOT send duplicate webhook
- Log event: `{ invoiceId, rail, event: "confirmed", status: "already_paid" }`

### Blockchain Reorganization (Reorg)

**Bitcoin/Monero Only**:

If an invoice is `paid` but confirmations drop due to blockchain reorg:
1. Invoice status reverts to `pending`
2. System continues monitoring
3. When confirmations reach threshold again → `paid`
4. Webhook sent again (may be duplicate - Altostratus must handle idempotently)

**Lightning**: Not applicable (HTLCs are atomic)

### Expired Invoice Payment Attempt

If payment is sent to an expired invoice address:

**Lightning**: 
- BOLT11 invoice invalid (node rejects payment)
- Payment fails immediately
- User sees "Invoice expired" error from wallet

**Bitcoin/Monero**:
- Payment technically possible (address still exists)
- Rail service detects payment
- Rail service checks invoice status
- Status is `expired`
- Callback rejected with 400 error
- Invoice marked `late-paid` (future) or remains `expired`
- Admin notified for manual review

### Simulation Source Tracking

When an invoice is paid via `/simulate-payment`:
- Invoice status: `paid`
- Additional field: `paymentSource: "simulate"`
- Cannot simulate already-paid invoices from real rails
- Simulation payments clearly labeled in admin UI
- Webhook still sent (for integration testing)

### Multiple Payments (Bitcoin/Monero)

If multiple payments sent to same address:
- System accumulates total amount received
- When total ≥ invoice amount → mark `paid`
- Record all transaction IDs
- Overpayment handled per policy (credit to account)

**Lightning**: Not applicable (one HTLC per BOLT11)

### Invoice with No Expiration

If `expiresAt` is `null`:
- Invoice never auto-expires
- Remains `pending` until paid
- Manual cleanup required (not recommended)
- Use case: Donations or open-ended invoices

## Status History & Audit Trail

### What is Logged
- Status transitions (pending → paid, paid → pending, pending → expired)
- Timestamps of each transition
- Who/what triggered transition (callback source, admin action, automated job)
- Related transaction IDs

### What is NOT Logged
- IP addresses
- User agents
- Full payment addresses
- Customer identity
- Payment amounts in logs (only in database)

## Status in Different Contexts

### Database
- Stored as string: "pending", "paid", "expired"
- Indexed for fast queries
- Status changes are updates (not new records)

### API Response
```json
{
  "id": "uuid",
  "status": "paid",
  "paidAt": "2025-11-06T12:34:56.789Z",
  "paymentSource": "rail-btc"
}
```

### UI Display
- **pending**: Yellow/Amber badge with clock icon
- **paid**: Green/Emerald badge with checkmark icon
- **expired**: Gray/Slate badge with X icon
- **late-paid**: Orange badge with warning icon
- **refunded**: Blue badge with return arrow icon

### Webhooks
```json
{
  "invoiceId": "uuid",
  "status": "paid",
  "paidAt": "2025-11-06T12:34:56.789Z",
  "transactionId": "bitcoin-txid",
  "confirmations": 2
}
```

## Testing Status Transitions

### Test Suite Checklist

- [ ] Create invoice → status is `pending`
- [ ] Pay invoice → status changes to `paid`
- [ ] Pay invoice twice → second payment rejected
- [ ] Wait for expiration → status becomes `expired`
- [ ] Pay expired invoice → rejected with 400
- [ ] Simulate reorg (testnet) → status reverts to `pending`
- [ ] Simulate partial payment (accumulation) → remains `pending` until total met
- [ ] Simulate overpayment → status `paid`, overpayment logged

## Status Query Examples

### Get all pending invoices
```bash
curl http://localhost:5000/api/invoices | jq '.[] | select(.status=="pending")'
```

### Get paid invoices from last 24 hours
```bash
curl http://localhost:5000/api/invoices | jq '.[] | select(.status=="paid" and .paidAt > "2025-11-05T00:00:00Z")'
```

### Count invoices by status
```bash
curl http://localhost:5000/api/invoices | jq 'group_by(.status) | map({status: .[0].status, count: length})'
```

---

*This document defines the authoritative behavior for invoice status handling. Any deviations from this behavior are considered bugs.*
