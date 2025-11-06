# Monero Rail Service (rail-xmr)

Minimal Monero payment rail for Altostratus Payments.

## API Contract

### POST /create
Creates a new Monero subaddress via Wallet RPC.

**Request:**
```json
{
  "invoiceId": "uuid-from-payments-service"
}
```

**Response:**
```json
{
  "subaddress": "8...",
  "accountIndex": 0,
  "addressIndex": 123
}
```

### POST /confirmed (Internal)
Called by your Monero watcher when transaction reaches required confirmations.
Automatically forwards to payments service.

**Request:**
```json
{
  "invoiceId": "uuid",
  "txHash": "abc123...",
  "confirmations": 10,
  "blockHeight": 3000000
}
```

### GET /health
Health check endpoint.

**Response:**
```json
{
  "ok": true,
  "service": "rail-xmr"
}
```

## Production Setup

Replace placeholder logic with real Monero Wallet RPC integration:

1. Connect to Monero Wallet RPC (monero-wallet-rpc)
2. Create subaddresses via `create_address` RPC method
3. Poll for incoming transfers via `get_transfers` RPC method
4. Monitor confirmations and forward to payments service when threshold met
5. **Privacy:** Subaddresses ensure payment isolation without view key exposure

## Security

- RAIL_AUTH_TOKEN authenticates callbacks to payments service
- Store Wallet RPC credentials in Replit Secrets
- Never expose view keys or seed phrases to this service
- Consider running wallet RPC behind Tor for maximum privacy
- Run behind firewall in production
