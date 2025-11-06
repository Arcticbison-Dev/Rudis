# Bitcoin Rail Service (rail-btc)

Minimal Bitcoin on-chain payment rail for Altostratus Payments.

## API Contract

### POST /create
Derives a new Bitcoin address from xpub.

**Request:**
```json
{
  "invoiceId": "uuid-from-payments-service"
}
```

**Response:**
```json
{
  "address": "bc1q...",
  "derivationPath": "m/84'/0'/0'/0/123"
}
```

### POST /confirmed (Internal)
Called by your blockchain watcher when transaction reaches required confirmations.
Automatically forwards to payments service.

**Request:**
```json
{
  "invoiceId": "uuid",
  "txHash": "abcd1234...",
  "confirmations": 6,
  "blockHeight": 850000
}
```

### GET /health
Health check endpoint.

**Response:**
```json
{
  "ok": true,
  "service": "rail-btc"
}
```

## Production Setup

Replace placeholder logic with real xpub derivation and Electrum monitoring:

1. Load BTC_XPUB from environment
2. Derive addresses using HD wallet derivation (BIP84)
3. Monitor addresses via Electrum server connection
4. Track confirmations and forward to payments service when threshold met
5. **CRITICAL:** Never reuse addresses - increment derivation index for each invoice

## Security

- RAIL_AUTH_TOKEN authenticates callbacks to payments service
- Store xpub in Replit Secrets, never in code
- Monitor only - never expose private keys to this service
- Run behind firewall in production
