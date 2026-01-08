# Altostratus Payments - API Reference

**Version**: 1.0.0  
**Base URL**: `https://your-instance.com`

---

## Authentication

### Public Endpoints (No Auth Required)

- `POST /payments` - Create invoice
- `GET /payments/:id` - Get invoice status

### Admin Endpoints (Requires Bearer Token)

Include header: `Authorization: Bearer {ADMIN_API_TOKEN}`

- `GET /admin/invoices` - List all invoices
- `GET /admin/invoices/:id` - Get invoice with internal metadata
- `GET /health` - Health check
- `GET /metrics` - System metrics

---

## Endpoints

### Create Invoice

Creates a new payment invoice for the specified rail.

```
POST /payments
```

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `rail` | string | Yes | Payment rail: `btc`, `xmr`, or `ln` |
| `amount_sats` | integer | Yes | Amount in satoshis (or atomic units for XMR) |
| `currency` | string | Yes | Currency code: `BTC`, `XMR`, or `Lightning` |
| `description` | string | No | Invoice description (max 256 chars) |
| `expires_in_seconds` | integer | No | Expiry time in seconds (default: 3600) |

**Example Request:**

```bash
curl -X POST https://payments.example.com/payments \
  -H "Content-Type: application/json" \
  -d '{
    "rail": "ln",
    "amount_sats": 10000,
    "currency": "BTC",
    "description": "Order #12345"
  }'
```

**Success Response (201):**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "rail": "ln",
  "status": "pending",
  "amount": "10000",
  "amount_atomic": "10000",
  "currency": "BTC",
  "description": "Order #12345",
  "payment_address": null,
  "bolt11_invoice": "lnbc100n1pj...",
  "expires_at": "2025-11-20T14:00:00.000Z",
  "created_at": "2025-11-20T13:00:00.000Z"
}
```

**Error Responses:**

| Code | Error | Description |
|------|-------|-------------|
| 400 | `Invalid request body` | Validation failed |
| 400 | `Amount below minimum` | Amount < LN_MIN_AMOUNT_SATS |
| 400 | `Amount exceeds maximum` | Amount > LN_MAX_AMOUNT_SATS |
| 503 | `Rail unavailable` | Rail service is down or disabled |

---

### Get Invoice Status

Retrieves the current status of an invoice.

```
GET /payments/:id
```

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | UUID | Invoice ID |

**Example Request:**

```bash
curl https://payments.example.com/payments/550e8400-e29b-41d4-a716-446655440000
```

**Success Response (200):**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "rail": "ln",
  "status": "confirmed",
  "amount": "10000",
  "amount_atomic": "10000",
  "amount_paid_atomic": "10000",
  "currency": "BTC",
  "description": "Order #12345",
  "payment_address": null,
  "bolt11_invoice": "lnbc100n1pj...",
  "paid_at": "2025-11-20T13:05:00.000Z",
  "expires_at": "2025-11-20T14:00:00.000Z",
  "created_at": "2025-11-20T13:00:00.000Z",
  "transactions": [
    {
      "id": "tx_abc123",
      "rail": "ln",
      "tx_hash": "abcd1234567890...",
      "amount_atomic": "10000",
      "confirmations": 0,
      "detected_at": "2025-11-20T13:05:00.000Z"
    }
  ]
}
```

**Error Responses:**

| Code | Error | Description |
|------|-------|-------------|
| 404 | `Invoice not found` | No invoice with this ID |

---

### List Invoices (Admin)

Lists all invoices with filtering and pagination.

```
GET /admin/invoices
```

**Headers:**

```
Authorization: Bearer {ADMIN_API_TOKEN}
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | Filter by status: `pending`, `confirmed`, `expired` |
| `rail` | string | Filter by rail: `btc`, `xmr`, `ln` |
| `limit` | integer | Max results (default: 50, max: 100) |
| `offset` | integer | Pagination offset |

**Example Request:**

```bash
curl -H "Authorization: Bearer ${ADMIN_API_TOKEN}" \
  "https://payments.example.com/admin/invoices?status=pending&rail=ln&limit=20"
```

**Success Response (200):**

```json
{
  "invoices": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "rail": "ln",
      "status": "pending",
      "amount": "10000",
      "currency": "BTC",
      "created_at": "2025-11-20T13:00:00.000Z",
      "expires_at": "2025-11-20T14:00:00.000Z"
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0
}
```

---

### Get Invoice Details (Admin)

Gets invoice with internal metadata (for debugging).

```
GET /admin/invoices/:id
```

**Headers:**

```
Authorization: Bearer {ADMIN_API_TOKEN}
```

**Example Request:**

```bash
curl -H "Authorization: Bearer ${ADMIN_API_TOKEN}" \
  https://payments.example.com/admin/invoices/550e8400-e29b-41d4-a716-446655440000
```

**Success Response (200):**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "rail": "ln",
  "status": "confirmed",
  "amount": "10000",
  "currency": "BTC",
  "bolt11_invoice": "lnbc100n1pj...",
  "ln_checking_id": "abc123xyz",
  "ln_payment_hash": "0123456789abcdef...",
  "paid_at": "2025-11-20T13:05:00.000Z",
  "transactions": [...]
}
```

**Note**: Admin endpoint includes internal fields like `ln_checking_id` and `ln_payment_hash` that are hidden from public API.

---

### Health Check

Returns system health status for all rails.

```
GET /health
```

**Example Request:**

```bash
curl https://payments.example.com/health
```

**Success Response (200):**

```json
{
  "status": "ok",
  "timestamp": "2025-11-20T13:00:00.000Z",
  "rails": {
    "btc": {
      "status": "ok",
      "backend": "mempool.space",
      "last_successful_poll_at": "2025-11-20T12:59:30.000Z",
      "consecutive_poll_failures": 0
    },
    "xmr": {
      "status": "disabled",
      "reason": "XMR rail is not enabled (ENABLE_XMR=false)"
    },
    "ln": {
      "status": "ok",
      "backend": "lnbits",
      "last_successful_poll_at": "2025-11-20T12:59:45.000Z",
      "consecutive_poll_failures": 0
    }
  }
}
```

**Status Values:**

| Status | Description |
|--------|-------------|
| `ok` | Rail is healthy and operational |
| `degraded` | Rail has issues but is partially functional |
| `error` | Rail is not functional |
| `disabled` | Rail is disabled via configuration |
| `not_implemented` | Rail is not configured |

---

### Metrics

Returns system metrics and event counts.

```
GET /metrics
```

**Example Request:**

```bash
curl https://payments.example.com/metrics
```

**Success Response (200):**

```json
{
  "bufferSize": 150,
  "activeAlerts": 0,
  "eventsByRail": {
    "BTC": 45,
    "XMR": 0,
    "LN": 105
  },
  "eventsByType": {
    "payment.created": 50,
    "payment.confirmed": 48,
    "payment.expired": 2,
    "poll.completed": 120,
    "poll.failed": 0
  },
  "health": {
    "overall": "ok",
    "rails": {...}
  }
}
```

---

## Webhooks

### Payment Confirmation Webhook

When an invoice is paid and confirmed, a webhook is sent to your configured endpoint.

**Endpoint**: Configured via `ALTOSTRATUS_WEBHOOK_URL`

**Headers:**

| Header | Description |
|--------|-------------|
| `Content-Type` | `application/json` |
| `X-Altostratus-Signature` | HMAC-SHA256 signature |
| `X-Altostratus-Timestamp` | Unix timestamp of signature |

**Payload:**

```json
{
  "invoiceId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "confirmed",
  "amount": "10000",
  "currency": "BTC",
  "paidAt": "2025-11-20T13:05:00.000Z",
  "transactionId": "abcd1234567890...",
  "confirmations": 6,
  "timestamp": "2025-11-20T13:05:00.000Z"
}
```

### Signature Verification

The signature is an HMAC-SHA256 hash of the JSON payload:

```javascript
const crypto = require('crypto');

function verifySignature(payload, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
  
  // Use timing-safe comparison
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}
```

### Retry Policy

Failed webhook deliveries are retried with exponential backoff:

| Attempt | Delay |
|---------|-------|
| 1 | Immediate |
| 2 | 1 second |
| 3 | 3 seconds |
| 4 | 9 seconds |
| 5+ | Exponential (up to 10 attempts) |

---

## Error Handling

### Error Response Format

```json
{
  "error": "Human-readable error message",
  "code": "ERROR_CODE",
  "details": {}
}
```

### Common Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| `VALIDATION_ERROR` | 400 | Request validation failed |
| `INVOICE_NOT_FOUND` | 404 | Invoice does not exist |
| `INVOICE_EXPIRED` | 400 | Invoice has expired |
| `RAIL_UNAVAILABLE` | 503 | Rail service is down |
| `RAIL_DISABLED` | 400 | Rail is not enabled |
| `UNAUTHORIZED` | 401 | Missing or invalid auth |
| `INTERNAL_ERROR` | 500 | Server error |

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| `POST /payments` | 100/minute |
| `GET /payments/:id` | 300/minute |
| `GET /admin/*` | 60/minute |
| `GET /health` | No limit |

Exceeded limits return `429 Too Many Requests`.

---

## Data Types

### Invoice Status

| Value | Description |
|-------|-------------|
| `pending` | Awaiting payment |
| `confirmed` | Payment confirmed |
| `expired` | Invoice expired |

### Payment Rails

| Value | Description |
|-------|-------------|
| `btc` | Bitcoin on-chain |
| `xmr` | Monero |
| `ln` | Lightning Network |

### Currencies

| Value | Description |
|-------|-------------|
| `BTC` | Bitcoin |
| `XMR` | Monero |
| `Lightning` | Bitcoin via Lightning |

---

## SDK Examples

### JavaScript/TypeScript

```typescript
class AltostratusPay {
  constructor(private baseUrl: string, private adminToken?: string) {}

  async createInvoice(rail: 'btc' | 'xmr' | 'ln', amount: number, description?: string) {
    const response = await fetch(`${this.baseUrl}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rail,
        amount_sats: amount,
        currency: rail === 'xmr' ? 'XMR' : 'BTC',
        description
      })
    });
    return response.json();
  }

  async getInvoice(id: string) {
    const response = await fetch(`${this.baseUrl}/payments/${id}`);
    return response.json();
  }

  async pollUntilPaid(id: string, timeoutMs = 3600000): Promise<any> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const invoice = await this.getInvoice(id);
      if (invoice.status === 'confirmed') return invoice;
      if (invoice.status === 'expired') throw new Error('Invoice expired');
      await new Promise(r => setTimeout(r, 5000));
    }
    throw new Error('Timeout waiting for payment');
  }
}

// Usage
const pay = new AltostratusPay('https://payments.example.com');
const invoice = await pay.createInvoice('ln', 10000, 'Order #123');
console.log('Pay this invoice:', invoice.bolt11_invoice);
const paid = await pay.pollUntilPaid(invoice.id);
console.log('Payment confirmed!', paid);
```

### Python

```python
import requests
import time

class AltostratusPay:
    def __init__(self, base_url: str, admin_token: str = None):
        self.base_url = base_url
        self.admin_token = admin_token
    
    def create_invoice(self, rail: str, amount: int, description: str = None):
        response = requests.post(
            f"{self.base_url}/payments",
            json={
                "rail": rail,
                "amount_sats": amount,
                "currency": "XMR" if rail == "xmr" else "BTC",
                "description": description
            }
        )
        return response.json()
    
    def get_invoice(self, invoice_id: str):
        response = requests.get(f"{self.base_url}/payments/{invoice_id}")
        return response.json()
    
    def wait_for_payment(self, invoice_id: str, timeout: int = 3600):
        start = time.time()
        while time.time() - start < timeout:
            invoice = self.get_invoice(invoice_id)
            if invoice["status"] == "confirmed":
                return invoice
            if invoice["status"] == "expired":
                raise Exception("Invoice expired")
            time.sleep(5)
        raise Exception("Timeout waiting for payment")

# Usage
pay = AltostratusPay("https://payments.example.com")
invoice = pay.create_invoice("ln", 10000, "Order #123")
print(f"Pay this invoice: {invoice['bolt11_invoice']}")
paid = pay.wait_for_payment(invoice["id"])
print("Payment confirmed!", paid)
```

---

## Changelog

### v1.0.0 (2025-11-20)

- Initial release
- Support for BTC, XMR, and LN rails
- Webhook notifications with HMAC signing
- Admin endpoints for invoice management
- Health and metrics endpoints
