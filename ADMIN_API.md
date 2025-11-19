# Admin API Documentation

## Overview
The Admin API provides secure endpoints for viewing and managing invoices in the Altostratus Payments system.

## Authentication

All admin endpoints require authentication using the `ADMIN_API_TOKEN`.

### Setting up ADMIN_API_TOKEN

1. **Generate a secure token:**
   ```bash
   openssl rand -hex 32
   ```

2. **Add to Replit Secrets:**
   - Click on "Secrets" in the left sidebar
   - Add a new secret:
     - Key: `ADMIN_API_TOKEN`
     - Value: Your generated token

3. **Or add to `.env` file (development only):**
   ```bash
   ADMIN_API_TOKEN=your_generated_token_here
   ```

### Making Authenticated Requests

Include the token in the `Authorization` header:

```bash
Authorization: Bearer <your_token_here>
```

## Endpoints

### GET /admin/invoices

List all invoices with optional filtering and pagination.

### GET /admin/invoices/:id

Get detailed information for a specific invoice including transactions and debug info.

**See [STEP6_ADMIN_INVOICE_DETAIL.md](./STEP6_ADMIN_INVOICE_DETAIL.md) for complete documentation.**

#### Query Parameters

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `rail` | string | Filter by payment rail | `btc`, `xmr`, `ln` |
| `status` | string | Filter by invoice status | `pending`, `confirming`, `confirmed`, `expired`, `failed` |
| `created_after` | ISO 8601 | Filter invoices created after this date | `2025-11-01T00:00:00Z` |
| `created_before` | ISO 8601 | Filter invoices created before this date | `2025-11-30T23:59:59Z` |
| `limit` | number | Max results per page (max: 1000) | `100` |
| `offset` | number | Pagination offset | `0` |

#### Response Format

```json
{
  "invoices": [
    {
      "id": "a1b2c3d4-...",
      "rail": "btc",
      "asset": "BTC",
      "amount_atomic": "1000000",
      "status": "pending",
      "created_at": "2025-11-19T18:00:00.000Z",
      "updated_at": "2025-11-19T18:00:00.000Z",
      "address": "bc1q...",
      "expires_at": "2025-11-19T20:00:00.000Z"
    },
    {
      "id": "e5f6g7h8-...",
      "rail": "ln",
      "asset": "BTC",
      "amount_atomic": "5000",
      "status": "confirmed",
      "created_at": "2025-11-19T17:30:00.000Z",
      "updated_at": "2025-11-19T17:45:00.000Z",
      "invoice_bolt11": "lnbc50u1...",
      "paid_at": "2025-11-19T17:45:00.000Z",
      "amount_paid_atomic": "5000"
    }
  ],
  "total": 2,
  "limit": 100,
  "offset": 0
}
```

#### Invoice Fields

| Field | Type | Description | Rails |
|-------|------|-------------|-------|
| `id` | string | Invoice ID (UUID) | All |
| `rail` | string | Payment rail | `btc`, `xmr`, `ln` |
| `asset` | string | Asset type | `BTC`, `XMR` |
| `amount_atomic` | string | Amount in smallest unit (sats, piconero) | All |
| `status` | string | Invoice status | All |
| `created_at` | ISO 8601 | Creation timestamp | All |
| `updated_at` | ISO 8601 | Last update timestamp | All |
| `address` | string | Payment address | BTC, XMR only |
| `invoice_bolt11` | string | BOLT11 invoice | LN only |
| `paid_at` | ISO 8601 | Payment timestamp (if paid) | All |
| `expires_at` | ISO 8601 | Expiration timestamp | All |
| `amount_paid_atomic` | string | Actual amount received | All |

## Usage Examples

### List all invoices

```bash
curl -X GET "http://localhost:5000/admin/invoices" \
  -H "Authorization: Bearer your_admin_token_here"
```

### Filter by Bitcoin invoices only

```bash
curl -X GET "http://localhost:5000/admin/invoices?rail=btc" \
  -H "Authorization: Bearer your_admin_token_here"
```

### Filter by confirmed status

```bash
curl -X GET "http://localhost:5000/admin/invoices?status=confirmed" \
  -H "Authorization: Bearer your_admin_token_here"
```

### Filter by date range

```bash
curl -X GET "http://localhost:5000/admin/invoices?created_after=2025-11-01T00:00:00Z&created_before=2025-11-30T23:59:59Z" \
  -H "Authorization: Bearer your_admin_token_here"
```

### Combine multiple filters with pagination

```bash
curl -X GET "http://localhost:5000/admin/invoices?rail=ln&status=confirmed&limit=50&offset=0" \
  -H "Authorization: Bearer your_admin_token_here"
```

## Error Responses

### 401 Unauthorized

Missing or invalid authentication token:

```json
{
  "error": "Unauthorized"
}
```

### 400 Bad Request

Invalid query parameters:

```json
{
  "error": "invalid_rail",
  "message": "rail must be one of: btc, xmr, ln"
}
```

### 500 Server Configuration Error

ADMIN_API_TOKEN not configured:

```json
{
  "error": "Server configuration error"
}
```

## Security Notes

1. **Separate Token**: `ADMIN_API_TOKEN` is separate from `RAIL_AUTH_TOKEN` for better security
2. **No Public Access**: Admin endpoints are not linked from public UI
3. **Token Rotation**: Rotate your `ADMIN_API_TOKEN` regularly
4. **HTTPS Only**: Always use HTTPS in production
5. **Rate Limiting**: Consider implementing rate limiting for production deployments

## Privacy Compliance

The admin endpoint respects the privacy design of Altostratus Payments:
- No PII is exposed in invoice data
- Payment addresses are unique per invoice
- Sensitive data follows configured retention policies

## Future Enhancements

Potential additions for future versions:
- Invoice detail view endpoint
- Export to CSV/JSON
- Webhook log viewing
- Payment transaction details
- Real-time invoice updates via WebSocket
