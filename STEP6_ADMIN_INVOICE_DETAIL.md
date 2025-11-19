# Step 6: Admin / Ops View – Invoice Detail & Transactions ✅

## Overview
The invoice detail endpoint provides comprehensive debugging capabilities for individual invoices, including full invoice details, payment transaction history, and rail-specific state information.

## Endpoint

### GET /admin/invoices/:id

Get complete details for a single invoice including all transactions and debug information.

**Authentication**: Requires `ADMIN_API_TOKEN`

**URL Parameters:**
- `id` (string, required): Invoice UUID

## Response Format

### Complete Response Structure

```json
{
  "invoice": {
    "id": "a1b2c3d4-...",
    "rail": "btc",
    "asset": "BTC",
    "amount_atomic": "1000000",
    "status": "confirmed",
    "created_at": "2025-11-19T18:00:00.000Z",
    "updated_at": "2025-11-19T18:05:00.000Z",
    "address": "bc1q...",
    "paid_at": "2025-11-19T18:05:00.000Z",
    "expires_at": "2025-11-19T20:00:00.000Z",
    "amount_paid_atomic": "1000000",
    "description": "Payment via BTC",
    "rail_type": "btc"
  },
  "transactions": [
    {
      "id": "tx-uuid-...",
      "tx_hash": "abc123...",
      "tx_ref": "abc123...",
      "rail": "btc",
      "amount_atomic": "1000000",
      "confirmations": 6,
      "block_height": 850000,
      "first_seen_at": "2025-11-19T18:05:00.000Z",
      "confirmed_at": "2025-11-19T18:05:00.000Z"
    }
  ],
  "payment_state": {
    "state": "confirmed",
    "txid": "abc123...",
    "confirmations": 6,
    "block_height": 850000,
    "amount_sats": 1000000,
    "last_checked": "2025-11-19T18:15:00.000Z",
    "paid_at": "2025-11-19T18:05:00.000Z",
    "created_at": "2025-11-19T18:00:00.000Z",
    "updated_at": "2025-11-19T18:15:00.000Z"
  },
  "debug": {
    "has_been_seen_on_chain": true,
    "is_being_polled": true,
    "time_since_last_check_ms": 120000,
    "needs_attention": false
  }
}
```

## 6.1 Invoice Detail Fields

### All Rails (Required)

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Invoice UUID |
| `rail` | string | Payment rail (`btc`, `xmr`, `ln`) |
| `asset` | string | Asset type (`BTC`, `XMR`) |
| `amount_atomic` | string | Amount in smallest unit |
| `status` | string | Invoice status |
| `created_at` | ISO 8601 | Creation timestamp |
| `updated_at` | ISO 8601 | Last update timestamp |

### Rail-Specific Fields

**Bitcoin/Monero:**
| Field | Type | Description |
|-------|------|-------------|
| `address` | string | Payment address |

**Lightning Network:**
| Field | Type | Description |
|-------|------|-------------|
| `invoice_bolt11` | string | BOLT11 invoice |

### Optional Fields (All Rails)

| Field | Type | Description |
|-------|------|-------------|
| `paid_at` | ISO 8601 | Payment confirmation time |
| `expires_at` | ISO 8601 | Invoice expiration time |
| `amount_paid_atomic` | string | Actual amount received |
| `description` | string | Invoice description |
| `rail_type` | string | Rail type identifier |

## 6.2 Linked Payment Transactions

The `transactions` array contains all on-chain transactions associated with this invoice.

### Transaction Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Transaction record UUID |
| `tx_hash` | string | Blockchain transaction hash |
| `tx_ref` | string | Transaction reference (same as tx_hash) |
| `rail` | string | Payment rail (`btc`, `xmr`, `ln`) |
| `amount_atomic` | string | Transaction amount in smallest unit |
| `confirmations` | number | Number of confirmations |
| `block_height` | number | Block height (if confirmed) |
| `first_seen_at` | ISO 8601 | When transaction was first recorded |
| `confirmed_at` | ISO 8601 | Confirmation timestamp |

### Multiple Transactions

An invoice may have multiple transactions if:
- User sent multiple partial payments
- Transaction was replaced (RBF)
- Different confirmation records were created

All transactions are sorted by `confirmed_at` (most recent first).

## 6.3 Debug Information (Bitcoin Only)

For Bitcoin invoices, the response includes `payment_state` and `debug` sections for troubleshooting.

### Payment State Fields

| Field | Type | Description | Debug Value |
|-------|------|-------------|-------------|
| `state` | string | Payment state machine | `unseen`, `pending`, `confirmed`, `settled` |
| `txid` | string | Transaction ID | Null if unseen |
| `confirmations` | number | Current confirmations | 0 if unseen |
| `block_height` | number | Block height | Undefined if unconfirmed |
| `amount_sats` | number | Amount in satoshis | Undefined if unseen |
| `last_checked` | ISO 8601 | Last polling time | **Key for debugging** |
| `paid_at` | ISO 8601 | Payment time | Null if unconfirmed |
| `created_at` | ISO 8601 | State creation time | - |
| `updated_at` | ISO 8601 | Last state update | - |

### Debug Flags

The `debug` object provides quick answers to common questions:

| Field | Type | Question Answered |
|-------|------|-------------------|
| `has_been_seen_on_chain` | boolean | **Has the payment been seen on-chain?** |
| `is_being_polled` | boolean | **Is the worker polling this invoice?** |
| `time_since_last_check_ms` | number | **How long since last check?** |
| `needs_attention` | boolean | **Does this need manual investigation?** |

### Debug Use Cases

#### Case 1: Payment Not Detected

**Question**: User says they paid but invoice shows pending

**Investigation**:
```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:5000/admin/invoices/$INVOICE_ID
```

**Check**:
- `payment_state.state` == "unseen"? Payment hasn't been detected
- `debug.has_been_seen_on_chain` == false? Not visible on blockchain
- `debug.is_being_polled` == false? Worker might not be running
- `debug.time_since_last_check_ms` > 600000? Worker hasn't checked in 10+ minutes

**Actions**:
1. Check if worker is running (`GET /health`)
2. Verify address is correct (`invoice.address`)
3. Check blockchain explorer for transaction
4. Look at rail health status (`GET /metrics`)

#### Case 2: Confirmations Not Updating

**Question**: Payment has confirmations but invoice still shows 0

**Investigation**:
```json
{
  "payment_state": {
    "state": "pending",
    "confirmations": 2,
    "last_checked": "2025-11-19T17:00:00.000Z"
  },
  "debug": {
    "time_since_last_check_ms": 3600000,
    "is_being_polled": true
  }
}
```

**Analysis**:
- Worker is configured (`is_being_polled: true`)
- But hasn't checked in 1 hour (`time_since_last_check_ms: 3600000`)
- Payment is stuck at 2 confirmations

**Actions**:
1. Check rail health: `GET /health`
2. Look for polling errors in logs
3. Verify BTC worker is connected to node

#### Case 3: Payment Stuck in Unseen State

**Question**: Invoice created 20 minutes ago but still "unseen"

```json
{
  "invoice": {
    "created_at": "2025-11-19T17:00:00.000Z",
    "status": "pending"
  },
  "payment_state": {
    "state": "unseen",
    "last_checked": "2025-11-19T17:18:00.000Z"
  },
  "debug": {
    "has_been_seen_on_chain": false,
    "needs_attention": true,
    "time_since_last_check_ms": 120000
  }
}
```

**Analysis**:
- `needs_attention: true` flags this automatically (>10 min old, still unseen)
- Worker is polling (checked 2 minutes ago)
- But no payment detected

**Actions**:
1. Verify user actually sent payment
2. Check if they sent to correct address
3. Check mempool for transaction
4. Verify amount matches (not underpaid)

## Usage Examples

### Get Full Invoice Details

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:5000/admin/invoices/a1b2c3d4-5678-90ab-cdef-123456789abc
```

### Get Details with Formatting (using jq)

```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:5000/admin/invoices/$INVOICE_ID | jq
```

### Extract Specific Debug Info

```bash
# Check if payment has been seen
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:5000/admin/invoices/$INVOICE_ID | \
  jq '.debug.has_been_seen_on_chain'

# Get last check time
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:5000/admin/invoices/$INVOICE_ID | \
  jq '.payment_state.last_checked'

# Get confirmation count
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:5000/admin/invoices/$INVOICE_ID | \
  jq '.payment_state.confirmations'
```

### Check All Transactions

```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:5000/admin/invoices/$INVOICE_ID | \
  jq '.transactions[] | {tx_hash, confirmations, confirmed_at}'
```

## Error Responses

### 404 Not Found

Invoice doesn't exist:

```json
{
  "error": "invoice_not_found",
  "message": "Invoice a1b2c3d4-... not found"
}
```

### 401 Unauthorized

Missing or invalid admin token:

```json
{
  "error": "Unauthorized"
}
```

### 500 Server Configuration Error

ADMIN_API_TOKEN not configured:

```json
{
  "error": "Server configuration error"
}
```

## Debugging Workflow

### Standard Debugging Process

1. **Get invoice list** to find invoice ID:
   ```bash
   curl -H "Authorization: Bearer $ADMIN_TOKEN" \
     "http://localhost:5000/admin/invoices?rail=btc&status=pending"
   ```

2. **Get invoice details**:
   ```bash
   curl -H "Authorization: Bearer $ADMIN_TOKEN" \
     http://localhost:5000/admin/invoices/$INVOICE_ID
   ```

3. **Check debug flags**:
   - `has_been_seen_on_chain`: false → Payment not detected
   - `is_being_polled`: false → Worker not running
   - `needs_attention`: true → Manual investigation needed

4. **Check system health**:
   ```bash
   curl http://localhost:5000/health
   curl http://localhost:5000/metrics
   ```

5. **Review transactions**:
   - Check tx_hash on blockchain explorer
   - Verify confirmations match blockchain
   - Check if amount matches invoice

## Field Availability by Rail

| Field | BTC | XMR | LN |
|-------|-----|-----|----|
| `address` | ✅ | ✅ | ❌ |
| `invoice_bolt11` | ❌ | ❌ | ✅ |
| `payment_state` | ✅ | ❌ | ❌ |
| `debug` | ✅ | ❌ | ❌ |
| `transactions` | ✅ | ✅ | ✅ |

**Note**: XMR and LN payment states coming in future updates.

## Production Considerations

### Performance
- Response time: <100ms for invoices with <10 transactions
- No external API calls (reads from database only)
- Safe to call frequently for monitoring

### Caching
Not recommended - payment states change frequently. Always fetch fresh data.

### Rate Limiting
Consider implementing rate limits for production:
- Suggested: 60 requests/minute per token
- Prevents abuse of admin endpoints

### Monitoring
Track admin endpoint usage:
- Log all admin API calls
- Alert on unusual patterns
- Monitor for unauthorized attempts

## Security Notes

1. **Authentication Required**: All requests must include valid `ADMIN_API_TOKEN`
2. **No PII**: Invoice data doesn't include personal information
3. **Audit Trail**: Consider logging all admin endpoint access
4. **Token Rotation**: Rotate `ADMIN_API_TOKEN` regularly
5. **HTTPS Only**: Always use HTTPS in production

## Future Enhancements

Potential additions:
- [ ] XMR payment state tracking
- [ ] LN payment state tracking
- [ ] Webhook delivery history
- [ ] Related invoices (same address)
- [ ] Payment timeline visualization data
- [ ] Export individual invoice as JSON
- [ ] Manual state override (with audit log)
