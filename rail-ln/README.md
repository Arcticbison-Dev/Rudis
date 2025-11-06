# Lightning Rail Service (rail-ln)

Minimal Lightning Network payment rail for Altostratus Payments.

## API Contract

### POST /create
Creates a new Lightning invoice (BOLT11).

**Request:**
```json
{
  "invoiceId": "uuid-from-payments-service",
  "amountSats": 50000,
  "description": "Payment for Pro plan"
}
```

**Response:**
```json
{
  "bolt11": "lnbc500u1...",
  "amountSats": 50000,
  "expiresAt": "2025-11-06T14:00:00Z"
}
```

### POST /settled (Internal)
Called by your Lightning node when an invoice is settled.
Automatically forwards to payments service.

**Request:**
```json
{
  "invoiceId": "uuid",
  "preimage": "hex-string",
  "settledAt": "2025-11-06T13:30:00Z"
}
```

### GET /health
Health check endpoint.

**Response:**
```json
{
  "ok": true,
  "service": "rail-ln"
}
```

## Production Setup

Replace placeholder logic with real LND/Core Lightning integration:

1. Connect to Lightning node REST API
2. Create real BOLT11 invoices via `POST /v1/invoices`
3. Subscribe to settlement events via websocket or long polling
4. Forward settlements to payments service `/api/rails/ln/settled`

## Security

- RAIL_AUTH_TOKEN is used to authenticate callbacks to payments service
- Never expose this service publicly - should only be accessible by Lightning node and payments service
- Run behind firewall or VPN in production
