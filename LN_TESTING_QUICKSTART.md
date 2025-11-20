# Lightning Network Testing - Quick Start Guide

## Prerequisites

1. **LNbits Instance**
   - Self-hosted: https://github.com/lnbits/lnbits
   - Cloud: https://legend.lnbits.com (free tier)

2. **Lightning Wallet**
   - Phoenix Wallet (recommended)
   - Wallet of Satoshi
   - Zeus

## Setup (5 minutes)

### 1. Get LNbits Credentials

Visit your LNbits wallet dashboard and copy:

```bash
# From LNbits dashboard
LNBITS_API_URL=https://your-lnbits.com
LNBITS_WALLET_KEY=your_invoice_read_key_here
LNBITS_WALLET_ID=your_wallet_id_here  # Optional
```

### 2. Generate Secrets

```bash
# Generate webhook secret (64 chars)
export LNBITS_WEBHOOK_SECRET=$(openssl rand -hex 32)

# Generate admin token
export ADMIN_API_TOKEN=$(openssl rand -hex 32)

# Generate rail auth token
export RAIL_AUTH_TOKEN=$(openssl rand -hex 32)
```

### 3. Set Environment Variables

Add to Replit Secrets:

```bash
ENABLE_LN=true
LNBITS_API_URL=https://your-lnbits.com
LNBITS_WALLET_KEY=your_invoice_read_key
LNBITS_WEBHOOK_SECRET=your_generated_secret
LNBITS_WEBHOOK_URL=https://your-replit-app.replit.app/rails/ln/webhook/your_generated_secret
ADMIN_API_TOKEN=your_generated_token
RAIL_AUTH_TOKEN=your_generated_token
```

### 4. Restart Application

Application auto-restarts when secrets change.

## Quick Test (2 minutes)

### 1. Create Invoice

```bash
curl -X POST https://your-app.replit.app/payments \
  -H "Content-Type: application/json" \
  -d '{
    "rail": "ln",
    "amount_sats": 100,
    "currency": "BTC",
    "description": "Test Payment"
  }'
```

**Copy the `invoice_bolt11` from response.**

### 2. Pay Invoice

Open your Lightning wallet and pay the BOLT11 invoice.

### 3. Verify Payment

```bash
# Check payment status
curl https://your-app.replit.app/payments/PAYMENT_ID

# Should show: "status": "confirmed"
```

## Automated Testing

Run the full test suite:

```bash
export API_URL=https://your-app.replit.app
export ADMIN_API_TOKEN=your_admin_token

./test-ln-e2e.sh
```

## Health Check

```bash
curl https://your-app.replit.app/health
```

**Expected:**
```json
{
  "status": "healthy",
  "rails": {
    "LN": {
      "status": "healthy",
      "last_successful_poll": "2025-11-20T12:00:00.000Z"
    }
  }
}
```

## Troubleshooting

### Issue: "LNbits configuration errors"

**Check:**
1. `LNBITS_API_URL` is correct
2. `LNBITS_WALLET_KEY` has Invoice/read permissions
3. Wallet has sufficient liquidity/open channels

### Issue: Webhook not firing

**Check:**
1. `LNBITS_WEBHOOK_URL` matches your app URL
2. Webhook registered in LNbits dashboard
3. HTTPS enabled (webhooks require HTTPS)

**Fallback:**
- Polling detects payments every 10 seconds
- Webhook is optional (but faster)

### Issue: Invoice creation fails

**Check:**
1. LNbits has outbound liquidity
2. Amount within min/max limits (1-100000 sats)
3. Channels are open and active

## Next Steps

1. ✅ Run automated test suite
2. ✅ Test failure scenarios (see STEP8_LN_E2E_TESTING.md)
3. ✅ Monitor logs during production use
4. ✅ Set up alerting for critical errors

## Documentation

- **Full Testing Guide**: `STEP8_LN_E2E_TESTING.md`
- **Security Guide**: `STEP7_LN_SECURITY_PRIVACY.md`
- **Main README**: `replit.md`

## Support

If tests fail, check:
- Application logs: `/tmp/logs/Start_application_*.log`
- Health endpoint: `/health`
- LNbits dashboard for errors
