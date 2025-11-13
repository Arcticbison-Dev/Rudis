# Bitcoin On-Chain Rail Service (rail-btc) v2.0.0

Production-ready Bitcoin on-chain payment rail with xpub-based HD wallet address derivation and blockchain monitoring for Altostratus Payments.

## Features

✅ **HD Wallet Address Derivation** - BIP84 (native segwit) addresses from xpub  
✅ **No Address Reuse** - Fresh address for every invoice (privacy-first)  
✅ **Blockchain Monitoring** - mempool.space API integration  
✅ **Confirmation Tracking** - Configurable confirmation threshold  
✅ **Graceful Degradation** - Returns 503 when misconfigured, doesn't crash  
✅ **Security Hardening** - Bearer token authentication, startup validation  
✅ **Privacy-Safe Logging** - Structured JSON logs, no PII exposure  

## Architecture

```
Payments Service → rail-btc → Derive Address → Track on Blockchain
                   ↑                              ↓
                   └───────── Callback ──────── Payment Confirmed
```

1. **Invoice Creation**: Payments service calls `/create` to derive a fresh Bitcoin address
2. **Address Derivation**: BIP84 HD wallet derivation from xpub (no private keys)
3. **Blockchain Monitoring**: Poll mempool.space API for transactions and confirmations
4. **Payment Detection**: When confirmations >= threshold, callback to payments service

## API Contract

### POST /create
Derives a new BIP84 (native segwit) Bitcoin address for an invoice.

**Request:**
```json
{
  "invoiceId": "550e8400-e29b-41d4-a716-446655440000",
  "amountSats": 100000
}
```

**Response:**
```json
{
  "address": "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
  "derivationPath": "m/84'/1'/0'/0/0"
}
```

**Notes:**
- Address format: `bc1...` (mainnet) or `tb1...` (testnet)
- Each call increments derivation index (no reuse)
- Idempotent: Same invoiceId returns same address

### GET /health
Health check endpoint with service status.

**Response (200 OK):**
```json
{
  "ok": true,
  "service": "rail-btc",
  "network": "testnet",
  "confirmations_required": 2,
  "tracked_addresses": 5
}
```

**Response (503 Misconfigured):**
```json
{
  "ok": false,
  "service": "rail-btc",
  "error": "Misconfigured",
  "details": {
    "xpub_configured": false,
    "auth_token_configured": true
  }
}
```

## Environment Configuration

See `.env.example` for complete configuration template.

### Required Variables

```bash
# Extended public key (BIP84 recommended)
BTC_XPUB=tpubDDCYy...  # testnet: tpub, vpub; mainnet: xpub, zpub

# Authentication token (must match payments service)
RAIL_AUTH_TOKEN=your-64-char-hex-token-here

# Payments service URL
PAYMENTS_SERVICE_URL=http://localhost:5000
```

### Optional Variables

```bash
# Network (default: testnet)
BTC_NETWORK=testnet  # mainnet | testnet

# Confirmations required (default: 6 for mainnet, 2 for testnet)
BTC_CONFIRMATIONS_REQUIRED=2

# Blockchain monitoring interval (default: 30000ms = 30 seconds)
POLLING_INTERVAL_MS=30000

# Service port (default: 5002)
PORT=5002

# Mempool API URL (auto-detected from BTC_NETWORK)
# MEMPOOL_API_BASE=https://mempool.space/testnet/api
```

## HD Wallet Setup

### Generate xpub from Wallet

**Using Bitcoin Core + HWI:**
```bash
# For BIP84 (native segwit)
bitcoin-cli listdescriptors | jq '.descriptors[] | select(.desc | startswith("wpkh"))'
```

**Using Sparrow Wallet:**
1. Settings → Script Policy → Native Segwit (P2WPKH)
2. Copy "Master Fingerprint" and "Derivation Path"
3. Export "Account Xpub" at `m/84'/0'/0'` (mainnet) or `m/84'/1'/0'` (testnet)

**Using Electrum:**
1. Wallet → Information
2. Copy "Master Public Key" (ensure it's BIP84)

**CRITICAL:** Export the **account-level xpub** at `m/84'/coin'/0'`, NOT the root xpub!

### Derivation Path Structure (BIP84)

```
m/84'/coin'/account'/change/index
       └─ 0 = BTC mainnet
       └─ 1 = BTC testnet
              └─ Usually 0 for first account
                       └─ 0 = receiving (external)
                       └─ 1 = change (internal)
                               └─ Increments for each address
```

**This service uses:**
- `m/84'/0'/0'/0/index` (mainnet receiving addresses)
- `m/84'/1'/0'/0/index` (testnet receiving addresses)

## Blockchain Monitoring

### How It Works

1. **Polling Loop**: Every `POLLING_INTERVAL_MS`, check all tracked addresses
2. **Transaction Detection**: Query mempool.space API for address transactions
3. **Confirmation Counting**: Calculate `confirmations = current_height - tx_height + 1`
4. **Payment Callback**: When `confirmations >= BTC_CONFIRMATIONS_REQUIRED`, notify payments service

### mempool.space API Endpoints Used

```
GET /address/{address}/txs          # Get transactions
GET /tx/{txid}/status                # Get confirmation status
GET /blocks/tip/height               # Get current block height
```

### Rate Limiting

- mempool.space has no official rate limit for testnet
- Default 30-second polling is respectful
- Consider self-hosting mempool for production

## Production Deployment

### Step 1: Generate Secure xpub

```bash
# Use a hardware wallet (Ledger, Trezor, Coldcard)
# OR Bitcoin Core with wallet encryption
bitcoin-cli -rpcwallet=payments getnewaddress "" "bech32"

# Export xpub
bitcoin-cli -rpcwallet=payments getaddressinfo <address> | jq .hdkeypath
bitcoin-cli -rpcwallet=payments listdescriptors | jq '.descriptors[] | select(.desc | startswith("wpkh"))'
```

### Step 2: Configure Environment

```bash
# Copy example
cp .env.example .env

# Edit with your values
nano .env
```

### Step 3: Start Service

```bash
npm install
npm run dev  # Development (auto-restart)
npm start    # Production
```

### Step 4: Verify Health

```bash
curl http://localhost:5002/health
```

## Security Best Practices

### 🔐 Key Management

- **NEVER expose private keys** - Use xpub only
- **Hardware wallet recommended** - For xpub generation
- **Separate hot/cold wallets** - Rail service = watch-only
- **Backup xpub securely** - Needed for wallet recovery

### 🛡️ Service Security

- **RAIL_AUTH_TOKEN** - Use cryptographically secure random token (64+ chars)
- **Firewall** - Restrict access to payments service only
- **TLS** - Use HTTPS in production
- **Monitoring** - Alert on unusual address derivation patterns

### 🔍 Privacy

- **No address reuse** - Each invoice gets unique address
- **Minimal logging** - Only invoice IDs, not payment amounts in logs
- **No third-party tracking** - Direct blockchain queries only

## Testing

### Testnet Testing

1. Get testnet coins: https://testnet-faucet.mempool.co
2. Configure `BTC_NETWORK=testnet` and testnet xpub
3. Create invoice and send testnet BTC
4. Monitor logs for confirmation tracking

### Example Test Flow

```bash
# 1. Start service
npm run dev

# 2. Create test invoice (via payments service)
curl -X POST http://localhost:5000/api/invoices \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 10000,
    "currency": "BTC",
    "description": "Test payment"
  }'

# 3. Pay invoice (use Bitcoin testnet wallet)
# Send exact amount to address from response

# 4. Monitor rail-btc logs
# Should see: "transaction found" → "X confirmations" → "payment confirmed"

# 5. Verify payment callback
# Payments service should receive confirmation callback
```

## Troubleshooting

### Service won't start

**Error: "BTC_XPUB not configured"**
- Set `BTC_XPUB` in environment variables
- Verify xpub format (starts with xpub/tpub/zpub/vpub)

**Error: "BTC_XPUB is invalid"**
- Ensure xpub matches `BTC_NETWORK` (tpub for testnet, xpub/zpub for mainnet)
- Verify xpub is account-level (`m/84'/coin'/0'`), not root

### Address not monitored

**Check:**
1. Invoice creation successful? (`/create` returned address)
2. Service logs show "Bitcoin address derived"?
3. Address added to tracking? (check health endpoint `tracked_addresses`)

### Payment not detected

**Check:**
1. Transaction confirmed on blockchain explorer? (mempool.space)
2. Enough confirmations? (check `BTC_CONFIRMATIONS_REQUIRED`)
3. Correct amount sent? (must match invoice amount exactly)
4. Service still running? (check logs)
5. Mempool API accessible? (test: `curl https://mempool.space/testnet/api/blocks/tip/height`)

### Callback failed

**Error: "Failed to notify payments service"**
- Verify `PAYMENTS_SERVICE_URL` is correct
- Check `RAIL_AUTH_TOKEN` matches payments service
- Ensure payments service is running
- Check network connectivity

## Limitations & Future Enhancements

### Current Limitations

- **In-memory tracking** - Address index resets on restart (use database for production)
- **No multi-path payments** - One address per invoice only
- **No underpayment handling** - Exact amount required
- **No RBF detection** - Replace-by-fee transactions not supported

### Planned Enhancements

- **PostgreSQL integration** - Persistent address tracking
- **Electrum server support** - Alternative to mempool.space
- **WebSocket monitoring** - Real-time transaction notifications
- **Gap limit enforcement** - BIP44 gap limit compliance
- **Address recovery** - Regenerate tracked addresses on restart

## License

MIT

## Support

For issues and questions:
- Check logs: `npm run dev` (verbose output)
- Test health: `curl http://localhost:5002/health`
- Verify xpub: Use Sparrow Wallet or Electrum to validate

---

**Version:** 2.0.0  
**Last Updated:** 2025-11-07  
**Status:** Production-ready for testnet deployment
