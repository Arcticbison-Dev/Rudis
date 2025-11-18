# Monero Rail Service (rail-xmr) v2.0.0

Production-ready Monero payment rail for Altostratus Payments with database persistence, authentication, and privacy-safe logging.

## Architecture

**Payment Detection Pattern:**
- Uses `monero-wallet-rpc` with view-only wallet for secure payment monitoring
- Generates unique subaddresses per invoice via RPC `create_address` method
- Polls `get_transfers` to detect incoming payments with confirmation tracking
- Database persistence for crash-safe operation
- Authenticated callbacks to payments service using `RAIL_AUTH_TOKEN`

**Security Features:**
- ✅ View-only wallet (no spend key exposure)
- ✅ Bearer token authentication on all endpoints
- ✅ Privacy-safe structured JSON logging (only invoiceId, rail, event)
- ✅ Idempotent operations (same invoice always returns same subaddress)
- ✅ Database persistence prevents data loss on service restart

---

## API Endpoints

### POST /create

Creates a new Monero subaddress for an invoice.

**Authentication:** Requires `Authorization: Bearer ${RAIL_AUTH_TOKEN}` header

**Request:**
```json
{
  "invoiceId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response:**
```json
{
  "subaddress": "8BN...abc123",
  "accountIndex": 0,
  "addressIndex": 42
}
```

**Idempotency:** Calling with the same `invoiceId` returns the previously generated subaddress.

---

### GET /health

Health check endpoint with Wallet RPC connection status.

**Response (Healthy):**
```json
{
  "ok": true,
  "service": "rail-xmr",
  "walletRpc": "connected"
}
```

**Response (Unhealthy):**
```json
{
  "ok": false,
  "service": "rail-xmr",
  "walletRpc": "disconnected"
}
```

---

## Environment Configuration

Create a `.env` file based on `.env.example`:

```bash
# Rail Service Configuration
PORT=5003
RAIL_AUTH_TOKEN=your-shared-secret-token-here  # REQUIRED
PAYMENTS_SERVICE_URL=http://localhost:5000

# Monero Wallet RPC Configuration
XMR_RPC_HOST=127.0.0.1
XMR_RPC_PORT=18082
XMR_RPC_USERNAME=your-rpc-username-here         # REQUIRED
XMR_RPC_PASSWORD=your-rpc-password-here         # REQUIRED
XMR_ACCOUNT_INDEX=0

# Blockchain Configuration
XMR_CONFIRMATIONS_REQUIRED=10                   # Default: 10 blocks (~20 minutes)
POLLING_INTERVAL_MS=30000                       # Default: 30 seconds

# Database
DATABASE_PATH=./xmr_rail.db
```

---

## Production Setup

### 1. Create View-Only Wallet

Generate a view-only wallet from your full wallet to safely monitor payments without exposing spend keys:

```bash
# From existing wallet
monero-wallet-cli --wallet-file fullwallet --generate-from-view-key viewonly_wallet

# Or restore from keys
monero-wallet-cli --generate-from-view-key viewonly_wallet
# Provide: address, view key, restore height
```

### 2. Start Monero Wallet RPC

```bash
monero-wallet-rpc \
  --wallet-file viewonly_wallet \
  --password "" \
  --rpc-bind-port 18082 \
  --rpc-bind-ip 127.0.0.1 \
  --daemon-address node.moneroworld.com:18089 \
  --rpc-login username:password
```

**Important Security Notes:**
- View-only wallets can see incoming payments but cannot spend funds
- RPC binds to localhost only (`127.0.0.1`) for privacy
- For remote wallet RPC, use SSH tunnel:
  ```bash
  ssh -L 18082:127.0.0.1:18082 user@remote-server
  ```
  Then connect to `localhost:18082` from the rail service

### 3. Start Rail Service

```bash
cd rail-xmr
npm install
npm run build
npm start
```

### 4. Verify Connection

```bash
curl http://localhost:5003/health
```

---

## Payment Flow

1. **Invoice Created:** Payments service calls `POST /create` with `invoiceId`
2. **Subaddress Generated:** Rail creates unique Monero subaddress via Wallet RPC
3. **Database Persistence:** Subaddress and payment state saved to SQLite
4. **QR Code Display:** Frontend shows subaddress as QR code to customer
5. **Payment Monitoring:** Rail polls Wallet RPC every 30s for incoming transfers
6. **Confirmation Tracking:** Monitors confirmations (0 → 10+ blocks)
7. **Callback:** When confirmations reach threshold, rail calls payments service
8. **Invoice Marked Paid:** Payments service updates invoice status to "paid"

---

## State Machine

Payments transition through these states:

```
unseen → pending → confirmed → settled
  ↑         |          |          |
  |         v          v          v
  └──────(tx seen)──(10 conf)──(callback)
```

**States:**
- `unseen`: Subaddress created, awaiting payment
- `pending`: Transaction detected in mempool (0+ confirmations)
- `confirmed`: Transaction reached confirmation threshold (10+ blocks)
- `settled`: Callback sent to payments service successfully

---

## Database Schema

### xmr_subaddresses

Stores subaddress derivation mapping:

| Column        | Type    | Description                          |
|---------------|---------|--------------------------------------|
| id            | TEXT    | Primary key (random hex)             |
| invoice_id    | TEXT    | UUID from payments service (UNIQUE)  |
| subaddress    | TEXT    | Monero subaddress (8...)             |
| account_index | INTEGER | Wallet account index (default: 0)    |
| address_index | INTEGER | Subaddress index (incremental)       |
| created_at    | DATETIME| Timestamp                            |

### xmr_payment_states

Tracks payment confirmations:

| Column         | Type    | Description                           |
|----------------|---------|---------------------------------------|
| id             | TEXT    | Primary key (random hex)              |
| invoice_id     | TEXT    | UUID from payments service (UNIQUE)   |
| subaddress     | TEXT    | Monero subaddress                     |
| state          | TEXT    | unseen/pending/confirmed/settled      |
| txid           | TEXT    | Transaction hash (nullable)           |
| confirmations  | TEXT    | Number of confirmations               |
| block_height   | TEXT    | Block height (nullable)               |
| amount_atomic  | TEXT    | Amount in atomic units (nullable)     |
| paid_at        | DATETIME| Payment timestamp (nullable)          |
| created_at     | DATETIME| Timestamp                             |
| updated_at     | DATETIME| Last update timestamp                 |

---

## Security Best Practices

### Authentication

All requests to `/create` require authentication:

```bash
# From payments service
curl -X POST http://localhost:5003/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${RAIL_AUTH_TOKEN}" \
  -d '{"invoiceId": "550e8400-e29b-41d4-a716-446655440000"}'
```

### View-Only Wallet Isolation

- ✅ Run Wallet RPC on localhost or private network
- ✅ Never expose view keys or seed phrases
- ✅ View-only wallet cannot spend funds (secure by design)
- ✅ Consider running Wallet RPC behind Tor for maximum privacy

### Logging

Only privacy-safe structured logs:

```json
{
  "invoiceId": "550e8400-e29b-41d4-a716-446655440000",
  "rail": "xmr",
  "event": "subaddress_created"
}
```

**Approved Events:**
- `subaddress_created`: Subaddress generated for invoice
- `tx_seen`: Transaction detected in mempool
- `confirmed`: Transaction reached confirmation threshold
- `callback_sent`: Successfully notified payments service
- `callback_failed`: Failed to notify payments service

**Never Logged:**
- ❌ Full subaddresses
- ❌ Full transaction IDs
- ❌ IP addresses
- ❌ User identifiers

---

## Confirmation Requirements

**Mainnet Recommendations:**
- **10 confirmations** (~20 minutes): Standard for most merchants
- **60 confirmations** (~2 hours): High-value transactions or exchanges

**Testnet/Stagenet:**
- 1-2 confirmations for testing

**Block Time:** ~2 minutes per block average

---

## Troubleshooting

### Wallet RPC Not Connected

**Symptom:** `/health` returns `"walletRpc": "disconnected"`

**Solutions:**
1. Verify `monero-wallet-rpc` is running: `curl http://localhost:18082/json_rpc`
2. Check `XMR_RPC_HOST` and `XMR_RPC_PORT` in `.env`
3. Verify firewall allows connection to Wallet RPC

### Subaddress Creation Fails

**Symptom:** `/create` returns 500 error

**Solutions:**
1. Check Wallet RPC logs for errors
2. Verify wallet is synchronized: `monero-wallet-cli --wallet-file viewonly_wallet refresh`
3. Ensure account 0 exists (default account)

### Payments Not Detected

**Symptom:** Invoice stays in "pending" status despite payment

**Solutions:**
1. Check Wallet RPC sync status: `get_height` RPC method
2. Verify `XMR_ACCOUNT_INDEX` matches the account used for subaddresses
3. Check `POLLING_INTERVAL_MS` (default: 30s)
4. View rail service logs for `tx_seen` event

---

## Development

### Run in Development Mode

```bash
npm run dev
```

Uses `tsx watch` for hot reload on code changes.

### Build for Production

```bash
npm run build
npm start
```

### Testing

Create test invoice:

```bash
curl -X POST http://localhost:5003/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-token" \
  -d '{"invoiceId": "550e8400-e29b-41d4-a716-446655440000"}'
```

---

## Integration with Payments Service

The payments service must:

1. **Send RAIL_AUTH_TOKEN** when calling `/create`
2. **Accept callbacks** at `/api/rails/xmr/confirmed` with authentication
3. **Verify invoiceId** exists before marking as paid
4. **Handle idempotency** (duplicate callbacks return 200 OK)

See `server/routes.ts` in main payments service for callback handler implementation.

---

## License

MIT

---

## Support

For issues or questions, see main Altostratus Payments documentation.
