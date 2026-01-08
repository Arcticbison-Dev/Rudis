# Altostratus Payments - Operations Guide

**Version**: 1.0.0  
**Last Updated**: 2025-11-20

This guide covers production operations including secrets management, database backups, monitoring, and licensing automation.

---

## Table of Contents

1. [Secrets Management](#secrets-management)
2. [Database Operations](#database-operations)
3. [Backup & Recovery](#backup--recovery)
4. [Secret Rotation](#secret-rotation)
5. [Monitoring & Alerting](#monitoring--alerting)
6. [Licensing & Billing Automation](#licensing--billing-automation)

---

## Secrets Management

### Required Secrets

Generate all secrets before first deployment:

```bash
# Generate all required secrets
echo "SESSION_SECRET=$(openssl rand -hex 32)"
echo "RAIL_AUTH_TOKEN=$(openssl rand -hex 32)"
echo "ADMIN_API_TOKEN=$(openssl rand -hex 32)"
echo "ALT_WEBHOOK_SECRET=$(openssl rand -hex 32)"
echo "LNBITS_WEBHOOK_SECRET=$(openssl rand -hex 32)"
echo "PGPASSWORD=$(openssl rand -base64 24)"
```

### Secrets Checklist

Before starting Docker Compose:

| Secret | Required | Generate Command |
|--------|----------|------------------|
| `PGPASSWORD` | Yes | `openssl rand -base64 24` |
| `SESSION_SECRET` | Yes | `openssl rand -hex 32` |
| `RAIL_AUTH_TOKEN` | Yes | `openssl rand -hex 32` |
| `ADMIN_API_TOKEN` | Yes | `openssl rand -hex 32` |
| `ALT_WEBHOOK_SECRET` | If using webhooks | `openssl rand -hex 32` |
| `LNBITS_WALLET_KEY` | If LN enabled | From LNbits dashboard |
| `LNBITS_WEBHOOK_SECRET` | If LN webhooks | `openssl rand -hex 32` |
| `BTC_XPUB` | If BTC enabled | From wallet |
| `XMR_RPC_PASSWORD` | If XMR enabled | `openssl rand -hex 32` |

### Secure .env File

```bash
# Create .env with proper permissions
cp .env.example .env
chmod 600 .env  # Owner read/write only

# Edit with your values
nano .env

# Verify permissions
ls -la .env
# Should show: -rw------- 1 user user ... .env
```

### Docker Secrets (Production)

For production Kubernetes/Swarm deployments, use native secrets:

```yaml
# docker-compose.prod.yml
services:
  payments:
    secrets:
      - db_password
      - session_secret
      - rail_auth_token
    environment:
      - PGPASSWORD_FILE=/run/secrets/db_password
      - SESSION_SECRET_FILE=/run/secrets/session_secret

secrets:
  db_password:
    external: true
  session_secret:
    external: true
  rail_auth_token:
    external: true
```

---

## Database Operations

### Initial Setup

```bash
# Start PostgreSQL first
docker-compose up -d postgres

# Wait for health check
docker-compose exec postgres pg_isready

# Run migrations
docker-compose run --rm payments npm run db:push
```

### Database URL Format

```bash
# For docker-compose internal networking
DATABASE_URL=postgresql://payments:${PGPASSWORD}@postgres:5432/payments

# For external access
DATABASE_URL=postgresql://payments:${PGPASSWORD}@localhost:5432/payments
```

### Connecting to Database

```bash
# Via docker-compose
docker-compose exec postgres psql -U payments -d payments

# Direct connection
psql "postgresql://payments:${PGPASSWORD}@localhost:5432/payments"
```

---

## Backup & Recovery

### Automated Backup Script

Create `backup.sh`:

```bash
#!/bin/bash
set -euo pipefail

BACKUP_DIR="/backups/altostratus"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/payments_${DATE}.sql.gz"
RETENTION_DAYS=30

# Create backup directory
mkdir -p "${BACKUP_DIR}"

# Backup database
docker-compose exec -T postgres pg_dump -U payments payments | gzip > "${BACKUP_FILE}"

# Verify backup
if [ -s "${BACKUP_FILE}" ]; then
    echo "Backup successful: ${BACKUP_FILE}"
    echo "Size: $(du -h ${BACKUP_FILE} | cut -f1)"
else
    echo "ERROR: Backup file is empty!"
    exit 1
fi

# Cleanup old backups
find "${BACKUP_DIR}" -name "payments_*.sql.gz" -mtime +${RETENTION_DAYS} -delete
echo "Cleaned up backups older than ${RETENTION_DAYS} days"

# List recent backups
echo "Recent backups:"
ls -lh "${BACKUP_DIR}" | tail -5
```

### Cron Schedule

```bash
# Add to crontab (daily at 2 AM)
0 2 * * * /opt/altostratus/backup.sh >> /var/log/altostratus-backup.log 2>&1
```

### Manual Backup

```bash
# Quick backup
docker-compose exec postgres pg_dump -U payments payments > backup.sql

# Compressed backup
docker-compose exec postgres pg_dump -U payments payments | gzip > backup.sql.gz
```

### Restore from Backup

```bash
# Stop application (keep database running)
docker-compose stop payments rail-btc rail-xmr

# Restore from backup
gunzip -c backup.sql.gz | docker-compose exec -T postgres psql -U payments -d payments

# Or for uncompressed
docker-compose exec -T postgres psql -U payments -d payments < backup.sql

# Restart application
docker-compose up -d
```

### Volume Backup (Full)

```bash
# Stop all services
docker-compose down

# Backup volume
docker run --rm \
  -v altostratus-payments_postgres_data:/data \
  -v $(pwd)/backups:/backup \
  alpine tar czf /backup/postgres_volume_$(date +%Y%m%d).tar.gz -C /data .

# Restart services
docker-compose up -d
```

---

## Secret Rotation

### Rotate RAIL_AUTH_TOKEN

```bash
# 1. Generate new token
NEW_TOKEN=$(openssl rand -hex 32)

# 2. Update .env file
sed -i "s/RAIL_AUTH_TOKEN=.*/RAIL_AUTH_TOKEN=${NEW_TOKEN}/" .env

# 3. Restart all services (must be simultaneous)
docker-compose down
docker-compose up -d
```

### Rotate Database Password

```bash
# 1. Generate new password
NEW_PASSWORD=$(openssl rand -base64 24)

# 2. Update PostgreSQL password
docker-compose exec postgres psql -U payments -c "ALTER USER payments PASSWORD '${NEW_PASSWORD}';"

# 3. Update .env and DATABASE_URL
sed -i "s/PGPASSWORD=.*/PGPASSWORD=${NEW_PASSWORD}/" .env

# 4. Restart application services (not postgres)
docker-compose restart payments rail-btc rail-xmr
```

### Rotate Webhook Secrets

```bash
# 1. Generate new secret
NEW_SECRET=$(openssl rand -hex 32)

# 2. Update your receiving application FIRST
# (configure it to accept both old and new signatures temporarily)

# 3. Update .env
sed -i "s/ALT_WEBHOOK_SECRET=.*/ALT_WEBHOOK_SECRET=${NEW_SECRET}/" .env

# 4. Restart payments service
docker-compose restart payments

# 5. Remove old secret acceptance from receiving application
```

---

## Monitoring & Alerting

### Health Check Endpoints

| Endpoint | Purpose | Expected |
|----------|---------|----------|
| `GET /health` | Overall system health | `{"status": "ok"}` |
| `GET /metrics` | System metrics | Event counts, buffer sizes |

### Alert Configuration

```bash
# Slack webhook for alerts
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/T00/B00/XXX

# Discord webhook
ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/XXX

# PagerDuty
ALERT_WEBHOOK_URL=https://events.pagerduty.com/integration/XXX/enqueue
```

### Log Monitoring

```bash
# View all logs
docker-compose logs -f

# View specific service
docker-compose logs -f payments

# Filter for errors
docker-compose logs payments 2>&1 | grep -i error

# Filter for alerts
docker-compose logs payments 2>&1 | grep '"level":"alert"'
```

### Prometheus Metrics (Optional)

Add to docker-compose.yml:

```yaml
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
    networks:
      - payments-network
```

Create `prometheus.yml`:

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'altostratus-payments'
    static_configs:
      - targets: ['payments:5000']
    metrics_path: '/metrics'
```

---

## Licensing & Billing Automation

### Service Fee Models

#### 1. Percentage-Based Fee

Add a percentage to each invoice amount:

```javascript
const SERVICE_FEE_PERCENT = 0.01; // 1%

async function createInvoiceWithFee(baseAmount, rail, description) {
  const serviceFee = Math.ceil(baseAmount * SERVICE_FEE_PERCENT);
  const totalAmount = baseAmount + serviceFee;
  
  const invoice = await fetch('/payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rail,
      amount_sats: totalAmount,
      description: `${description} (includes ${serviceFee} sat service fee)`
    })
  });
  
  // Track fee for billing
  await trackServiceFee({
    invoiceId: invoice.id,
    baseAmount,
    serviceFee,
    totalAmount
  });
  
  return invoice;
}
```

#### 2. Fixed Fee Per Transaction

```javascript
const FIXED_FEE_SATS = 100; // 100 sats per transaction

async function createInvoiceWithFixedFee(baseAmount, rail, description) {
  const totalAmount = baseAmount + FIXED_FEE_SATS;
  
  const invoice = await fetch('/payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rail,
      amount_sats: totalAmount,
      description
    })
  });
  
  return invoice;
}
```

#### 3. Hybrid Model (Percentage + Minimum)

```javascript
const FEE_PERCENT = 0.01; // 1%
const MIN_FEE_SATS = 50;  // Minimum 50 sats

function calculateServiceFee(baseAmount) {
  const percentageFee = Math.ceil(baseAmount * FEE_PERCENT);
  return Math.max(percentageFee, MIN_FEE_SATS);
}
```

### Billing Webhook Integration

Track confirmed payments for billing:

```javascript
app.post('/api/payments/webhook', (req, res) => {
  const { invoiceId, status, amount } = req.body;
  
  if (status === 'confirmed') {
    // Record confirmed payment for billing
    recordBillableEvent({
      merchantId: getMerchantFromInvoice(invoiceId),
      invoiceId,
      amount,
      serviceFee: calculateServiceFee(amount),
      timestamp: new Date()
    });
  }
  
  res.json({ received: true });
});
```

### Monthly Billing Report

```javascript
async function generateMonthlyBilling(merchantId, month, year) {
  const events = await getBillableEvents(merchantId, month, year);
  
  const summary = {
    merchantId,
    period: `${year}-${month.toString().padStart(2, '0')}`,
    totalTransactions: events.length,
    totalVolume: events.reduce((sum, e) => sum + e.amount, 0),
    totalFees: events.reduce((sum, e) => sum + e.serviceFee, 0),
    breakdown: {
      btc: events.filter(e => e.rail === 'btc'),
      xmr: events.filter(e => e.rail === 'xmr'),
      ln: events.filter(e => e.rail === 'ln')
    }
  };
  
  return summary;
}
```

### Multi-Tenant Configuration

For hosting multiple merchants:

```javascript
// Merchant-specific configuration
const merchantConfigs = {
  'merchant-abc': {
    feePercent: 0.01,
    minFee: 50,
    webhookUrl: 'https://abc.com/webhook'
  },
  'merchant-xyz': {
    feePercent: 0.015,
    minFee: 100,
    webhookUrl: 'https://xyz.com/webhook'
  }
};

// Route webhook to correct merchant
function routePaymentNotification(invoice, payment) {
  const config = merchantConfigs[invoice.merchantId];
  
  return fetch(config.webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Signature': signPayload(payment, config.webhookSecret)
    },
    body: JSON.stringify(payment)
  });
}
```

### API Rate Limiting by Tier

```javascript
const rateLimits = {
  free: { invoicesPerDay: 10, maxAmount: 10000 },
  starter: { invoicesPerDay: 100, maxAmount: 100000 },
  pro: { invoicesPerDay: 1000, maxAmount: 1000000 },
  enterprise: { invoicesPerDay: Infinity, maxAmount: Infinity }
};

function checkRateLimits(merchantId, amount) {
  const tier = getMerchantTier(merchantId);
  const limits = rateLimits[tier];
  const todayCount = getTodayInvoiceCount(merchantId);
  
  if (todayCount >= limits.invoicesPerDay) {
    throw new Error('Daily invoice limit exceeded');
  }
  
  if (amount > limits.maxAmount) {
    throw new Error(`Amount exceeds tier limit of ${limits.maxAmount} sats`);
  }
}
```

---

## Troubleshooting

### Service Won't Start

```bash
# Check logs
docker-compose logs payments

# Common issues:
# 1. Database not ready - check postgres health
docker-compose exec postgres pg_isready

# 2. Missing environment variables
docker-compose config  # Shows interpolated config

# 3. Port conflicts
lsof -i :5000
```

### Database Connection Issues

```bash
# Test connection from payments container
docker-compose exec payments sh -c 'nc -zv postgres 5432'

# Check DATABASE_URL format
docker-compose exec payments printenv DATABASE_URL
```

### Rail Communication Issues

```bash
# Check rail health
curl http://localhost:5002/health  # BTC
curl http://localhost:5003/health  # XMR

# Verify RAIL_AUTH_TOKEN matches
docker-compose exec payments printenv RAIL_AUTH_TOKEN
docker-compose exec rail-btc printenv RAIL_AUTH_TOKEN
```

---

## Quick Reference

### Start Everything

```bash
# Just Lightning (simplest)
docker-compose up -d

# With Bitcoin
docker-compose --profile btc up -d

# With Monero
docker-compose --profile xmr up -d

# All rails
docker-compose --profile btc --profile xmr up -d
```

### Stop Everything

```bash
docker-compose down
```

### View Logs

```bash
docker-compose logs -f
```

### Restart Service

```bash
docker-compose restart payments
```

### Scale (if needed)

```bash
docker-compose up -d --scale payments=3
```
