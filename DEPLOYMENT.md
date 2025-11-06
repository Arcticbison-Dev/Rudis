# Altostratus Payments Deployment Guide

## Lightning Network Integration - Quick Start

This guide provides step-by-step instructions for deploying the Lightning Network rail service (rail-ln) for Altostratus Payments.

---

## Prerequisites

Before starting, ensure you have:

- [ ] **LND Node** - Lightning Network Daemon deployed and fully synced
- [ ] **Lightning Channels** - At least one channel with sufficient inbound/outbound liquidity
- [ ] **Node.js 18+** - Installed on deployment server
- [ ] **Network Access** - rail-ln service can reach both LND node and payments service
- [ ] **Secrets Management** - Secure way to store macaroons and tokens

---

## Step 1: LND Node Setup

### 1.1 Verify LND is Running

```bash
lncli getinfo
```

Expected output should show:
- `"synced_to_chain": true`
- `"num_active_channels": >0` (at least one channel)
- `"identity_pubkey": "..."` (your node public key)

### 1.2 Generate Invoice Macaroon

If you don't have a read-only invoice macaroon, generate one:

```bash
lncli bakemacaroon invoices:read invoices:write --save_to ~/invoice.macaroon
```

### 1.3 Convert Macaroon to Hex

```bash
xxd -ps -u -c 1000 ~/invoice.macaroon
```

Save this hex string - you'll need it for `LN_MACAROON_HEX`.

**Security Note:** Never use `admin.macaroon` - always use read-only invoice macaroon.

---

## Step 2: Deploy rail-ln Service

### 2.1 Clone Repository

```bash
git clone https://github.com/your-org/altostratus-payments.git
cd altostratus-payments/rail-ln
```

### 2.2 Install Dependencies

```bash
npm install
```

### 2.3 Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# LND Connection
LN_REST_URL=https://your-lnd-node.example.com:8080/v1
LN_MACAROON_HEX=<hex-from-step-1.3>

# Payments Service Integration
PAYMENTS_SERVICE_URL=https://payments.example.com
RAIL_AUTH_TOKEN=<generate-with-openssl-rand-hex-32>

# Invoice Settings
LN_INVOICE_EXPIRY_SEC=1200
LN_ENABLE_MPP=true

# Server
PORT=5001
NODE_ENV=production
```

**Generate RAIL_AUTH_TOKEN:**
```bash
openssl rand -hex 32
```

**Important:** Save this token - you'll need to configure the same value in the payments service.

### 2.4 Test Connection

```bash
npm run dev
```

Expected output:
```
╔═══════════════════════════════════════════════════════════╗
║           rail-ln - Lightning Network Service            ║
╠═══════════════════════════════════════════════════════════╣
║ Port:        5001                                         ║
║ LND Status:  ✓ Connected                                  ║
║ MPP:         ✓ Enabled                                    ║
╚═══════════════════════════════════════════════════════════╝
```

If you see `✗ DISCONNECTED`, troubleshoot:
1. Verify `LN_REST_URL` is correct
2. Check network connectivity to LND
3. Verify macaroon is valid
4. Check LND logs for errors

### 2.5 Build for Production

```bash
npm run build
```

### 2.6 Run Production Server

```bash
npm start
```

Or use a process manager:

```bash
# PM2
pm2 start dist/index.js --name rail-ln

# Systemd
sudo systemctl start rail-ln
```

---

## Step 3: Configure Payments Service

### 3.1 Update Environment Variables

Edit the payments service `.env` file:

```env
# Enable Lightning rail
ENABLE_LN=true

# Rail service URL (must be accessible from payments service)
LN_SERVICE_URL=https://rail-ln.example.com:5001

# Authentication token (MUST match rail-ln service)
RAIL_AUTH_TOKEN=<same-token-from-step-2.3>

# Altostratus webhook (for payment notifications)
ALTOSTRATUS_WEBHOOK_URL=https://altostratus.example.com/api/payments/webhook
ALT_WEBHOOK_SECRET=<your-webhook-secret>
```

### 3.2 Restart Payments Service

```bash
# If using PM2
pm2 restart altostratus-payments

# If using systemd
sudo systemctl restart altostratus-payments

# If using Replit workflow
# Restart via Replit UI or restart_workflow tool
```

### 3.3 Verify Integration

Check startup logs for:
```
Lightning: ✓ ENABLED
```

---

## Step 4: End-to-End Testing

### 4.1 Health Check

```bash
# Check rail-ln health
curl https://rail-ln.example.com:5001/health

# Expected response:
# {
#   "status": "healthy",
#   "rail": "ln",
#   "lndConnected": true,
#   "mppEnabled": true
# }
```

### 4.2 Create Test Invoice

```bash
curl -X POST https://payments.example.com/api/invoices \
  -H "Content-Type: application/json" \
  -d '{
    "amount": "0.00001000",
    "currency": "Lightning",
    "description": "Test Invoice",
    "paymentAddress": "test@example.com",
    "expiresAt": "'$(date -u -d '+1 hour' +%Y-%m-%dT%H:%M:%SZ)'"
  }'
```

**Expected Response:**
```json
{
  "id": "550e8400-...",
  "amount": "0.00001000",
  "currency": "Lightning",
  "status": "pending",
  "bolt11Invoice": "lntb100u1p...",
  "paymentAddress": "test@example.com",
  "expiresAt": "2025-11-06T20:00:00.000Z"
}
```

**Verify:**
- [ ] `bolt11Invoice` field is populated
- [ ] `status` is "pending"
- [ ] Invoice appears in UI

### 4.3 Pay Invoice

Use a Lightning wallet (Zeus, Phoenix, Blue Wallet) to pay the BOLT11 invoice, or use `lncli`:

```bash
lncli payinvoice lntb100u1p...
```

### 4.4 Verify Settlement

Wait 2-5 seconds, then check invoice status:

```bash
curl https://payments.example.com/api/invoices/<invoice-id>
```

**Expected Response:**
```json
{
  "id": "550e8400-...",
  "status": "paid",
  "paidAt": "2025-11-06T18:35:00.000Z",
  "paymentSource": "rail-ln"
}
```

**Verify:**
- [ ] `status` changed to "paid"
- [ ] `paidAt` timestamp is present
- [ ] `paymentSource` is "rail-ln"

---

## Step 5: Monitoring Setup

### 5.1 Health Check Monitoring

Set up monitoring to poll `/health` endpoint every 30 seconds:

```bash
*/1 * * * * curl -sf https://rail-ln.example.com:5001/health > /dev/null || echo "rail-ln health check failed"
```

**Alert if:**
- `lndConnected: false` for >5 minutes
- HTTP status code is 503 for >5 minutes

### 5.2 Log Aggregation

Configure log shipping to your centralized logging system (Loki, Elasticsearch, etc.):

**rail-ln logs** (`/var/log/rail-ln.log`):
```json
{
  "ts": "2025-11-06T18:30:00.000Z",
  "level": "info",
  "rail": "ln",
  "event": "invoice_created",
  "invoiceId": "550e8400-..."
}
```

**Key events to monitor:**
- `invoice_created`: BOLT11 generated
- `invoice_settled`: Payment received
- `callback_success`: Callback to payments succeeded
- `callback_failed`: Callback failed (ALERT)
- `rate_limit_exceeded`: Too many requests

### 5.3 Metrics Collection

If using Prometheus, expose metrics endpoint (requires additional implementation):

```
rail_ln_invoices_created_total
rail_ln_settlements_total
rail_ln_settlement_latency_seconds
rail_ln_callbacks_sent_total{status="success|failed"}
rail_ln_lnd_connected
```

### 5.4 Alerts

**CRITICAL Alerts:**
- LND disconnected >5 minutes
- No settlements in 30+ minutes (when invoices pending)
- Callback failure rate >50%

**WARNING Alerts:**
- Settlement latency P95 >10 seconds
- Callback failure rate >10%
- Rate limit exceeded >10 times/hour

---

## Step 6: Security Checklist

Before production deployment, verify:

- [ ] **RAIL_AUTH_TOKEN** is 64+ characters (32-byte hex)
- [ ] **LN_MACAROON_HEX** is read-only invoice macaroon (not admin)
- [ ] **Tokens rotated** every 90 days (set calendar reminder)
- [ ] **LND node isolated** (not on same server as rail-ln)
- [ ] **Network firewall** configured (rail-ln only accessible by payments service)
- [ ] **HTTPS enabled** for all communication
- [ ] **Secrets not in git** (verified with `git log --all -S "RAIL_AUTH_TOKEN"`)
- [ ] **Environment variables** stored in secure secrets manager
- [ ] **Logs privacy-safe** (no PII, addresses, or amounts logged)
- [ ] **Rate limiting enabled** (10 req/min confirmed)

---

## Step 7: Backup & Recovery

### 7.1 LND Channel Backup

Set up automated Static Channel Backup (SCB):

```bash
# Daily backup
0 2 * * * lncli exportchanbackup --all --output_file /backup/channels-$(date +\%Y\%m\%d).backup
```

Store backups in 3 separate locations:
1. Local encrypted storage
2. Cloud storage (S3, GCS)
3. Offline backup (USB drive)

### 7.2 Recovery Procedure

If LND node fails:

1. Deploy new LND node
2. Restore wallet seed
3. Restore channel backup:
   ```bash
   lncli restorechanbackup --multi_file /backup/channels-latest.backup
   ```
4. Wait for channels to force-close (if necessary)
5. Reconfigure rail-ln service with new LND URL
6. Resume operations

### 7.3 Invoice Data Backup

Payments service invoice data is backed up automatically by Replit (if using in-memory storage, set up persistent DB backups).

---

## Step 8: Canary Deployment

Follow phased rollout per `docs/CANARY_DEPLOYMENT_GUIDE.md`:

### Phase 0: Testnet (1-2 weeks)
- [ ] Deploy to testnet infrastructure
- [ ] Execute all 9 test cases (see docs/LN_IMPLEMENTATION_CHECKLIST.md)
- [ ] Monitor metrics and logs
- [ ] Fix any issues found

### Phase 1: Lightning Only, Canary Users (48h)
- [ ] Enable `ENABLE_LN=true` for 5-10 users
- [ ] Monitor settlement latency (<5s target)
- [ ] Monitor webhook delivery (100% success target)
- [ ] Collect user feedback

### Phase 2: Expand (72h)
- [ ] Enable for 20-50 users
- [ ] Monitor both Lightning and Bitcoin rails (if BTC enabled)
- [ ] Verify no regressions

### Phase 3: Full Rollout (1 week)
- [ ] Enable for all users
- [ ] Monitor system stability
- [ ] Declare production-ready

---

## Troubleshooting

### Issue: BOLT11 Not Generated

**Symptoms:**
- Invoice created but `bolt11Invoice` field is null
- Payments UI shows "Invoice pending" but no QR code

**Diagnosis:**
```bash
# 1. Check rail-ln health
curl https://rail-ln.example.com:5001/health

# 2. Check LND status
lncli getinfo

# 3. Check rail-ln logs
grep "lnd_invoice_failed" /var/log/rail-ln.log
```

**Solutions:**
- Verify `LN_SERVICE_URL` in payments service points to rail-ln
- Verify `LN_REST_URL` in rail-ln service points to LND
- Check macaroon validity
- Verify network connectivity
- Check LND logs: `tail -f ~/.lnd/logs/bitcoin/mainnet/lnd.log`

---

### Issue: Settlement Not Detected

**Symptoms:**
- Invoice paid in wallet but status remains "pending"
- User paid but webhook not sent to Altostratus

**Diagnosis:**
```bash
# 1. Check LND invoice status
lncli lookupinvoice <r_hash>

# 2. Check rail-ln logs for settlement event
grep "invoice_settled" /var/log/rail-ln.log

# 3. Check for callback failures
grep "callback_failed" /var/log/rail-ln.log
```

**Solutions:**
- Verify invoice actually settled in LND
- Check rail-ln monitoring is running (2-second polling)
- Verify payments service is accessible from rail-ln
- Check RAIL_AUTH_TOKEN matches in both services
- Manually trigger callback if needed

---

### Issue: Callback Authentication Failed

**Symptoms:**
- rail-ln logs show `callback_failed` with HTTP 401
- Payments service logs show "Unauthorized"

**Diagnosis:**
```bash
# Check rail-ln logs
grep "callback_failed" /var/log/rail-ln.log | grep "401"

# Check payments logs
grep "Rail callback rejected" /var/log/payments.log
```

**Solutions:**
1. Verify `RAIL_AUTH_TOKEN` is identical in both `.env` files
2. Check for whitespace or encoding issues in token
3. Regenerate token and update both services:
   ```bash
   openssl rand -hex 32
   ```
4. Restart both services after updating token

---

## Rollback Procedure

If critical issues occur in production:

### 1. Disable Lightning Rail

```bash
# In payments service .env
ENABLE_LN=false
```

### 2. Restart Payments Service

```bash
pm2 restart altostratus-payments
# or
sudo systemctl restart altostratus-payments
```

### 3. Communicate to Users

"Lightning payments temporarily unavailable. Bitcoin and Monero payments are operational."

### 4. Investigate Root Cause

- Check all logs (rail-ln, payments, LND)
- Review recent changes
- Verify infrastructure health
- Test in staging environment

### 5. Fix and Re-Deploy

- Fix root cause
- Test in testnet/staging
- Re-enable with canary rollout

---

## Production Readiness Checklist

Before declaring production-ready:

- [ ] All 9 E2E tests passed in testnet (docs/LN_IMPLEMENTATION_CHECKLIST.md)
- [ ] Canary Phase 0 completed successfully (1-2 weeks testnet)
- [ ] Canary Phase 1 completed successfully (48h, 5-10 users)
- [ ] Monitoring dashboards operational
- [ ] Alerts configured and tested
- [ ] Team trained on operations and troubleshooting
- [ ] Incident response runbook created
- [ ] Backup procedures tested
- [ ] Security audit completed
- [ ] Token rotation schedule documented
- [ ] On-call rotation established

---

## Support & Documentation

**Documentation Suite:**
- `docs/LN_INTEGRATION_PLAN_V2.md` - Implementation guide
- `docs/LN_INTEGRATION_REVIEW.md` - Gap analysis
- `docs/LN_IMPLEMENTATION_CHECKLIST.md` - Validation checklist
- `docs/E2E_TESTING_GUIDE.md` - Testing procedures
- `docs/OBSERVABILITY.md` - Monitoring standards
- `docs/OPS_KEY_MANAGEMENT.md` - Security best practices
- `docs/CANARY_DEPLOYMENT_GUIDE.md` - Rollout strategy

**Service Documentation:**
- `rail-ln/README.md` - rail-ln service documentation

**Need Help?**
- Check troubleshooting section above
- Review relevant documentation
- Check logs for structured events
- Contact DevOps team if infrastructure issue

---

## License

© 2025 Arctic Bison LLC. Altostratus™ is a trademark of Arctic Bison LLC.
