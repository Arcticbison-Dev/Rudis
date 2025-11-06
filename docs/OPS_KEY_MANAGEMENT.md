# Operations & Key Management Guide

This document outlines best practices for operating Altostratus Payments in production with a focus on security and key management.

## Critical Security Principles

### No Private Keys on Replit
**NEVER store private keys, wallet seeds, or spend keys on Replit or any shared infrastructure.**

- Lightning node runs on separate infrastructure
- Bitcoin only uses xpub (extended public key) - never xpriv
- Monero uses view-only wallet - spend keys kept offline

### Service Isolation
Each blockchain listener (rail service) runs in its own isolated environment:
- Separate VPS or container
- Network isolation from main app
- Minimal permissions
- No shared credentials

## Key Types & Storage

### 1. Lightning Network

#### LN Node Setup
```
Environment: Dedicated VPS or hardware
Node Software: LND, CLN, or Eclair
Keys: Stored in node's encrypted wallet
Backup: Encrypted SCB (Static Channel Backup)
```

#### Access Pattern
```
rail-ln service → LND gRPC API → Create invoices
                 → Subscribe to settlements
                 → NO access to node keys
```

#### Key Management
- Generate seed phrase offline, store in encrypted vault
- Never expose macaroon with spending permission
- Use read-only macaroon for rail-ln service
- Rotate macaroons every 90 days

#### Backup Strategy
```
Daily:   Encrypted SCB backup to 3 locations
Weekly:  Verify backup restoration
Monthly: Channel state audit
```

### 2. Bitcoin On-Chain

#### Wallet Setup (BIP84 - Native SegWit)
```
Generate offline:
- Master seed (24 words)
- Derive xpriv (m/84'/0'/0')
- Export xpub ONLY

Store xpriv:
- Hardware wallet (Ledger, Trezor)
- Encrypted USB in safe
- Paper backup in bank vault

Deploy xpub:
- rail-btc service uses xpub only
- Can derive addresses but cannot spend
- Address derivation index tracked in DB
```

#### Address Derivation
```python
# Pseudocode for rail-btc
def derive_address(xpub, index):
    # BIP84 derivation: m/84'/0'/0'/0/{index}
    address = derive_p2wpkh(xpub, 0, index)
    return address
```

#### Spending Process (Manual)
```
1. Export list of received addresses and amounts
2. Connect hardware wallet
3. Construct transaction offline
4. Sign with hardware wallet
5. Broadcast via separate node
6. Never expose xpriv to internet-connected machine
```

#### Key Rotation
xpub cannot be rotated - requires:
1. Generate new master seed
2. Create new xpub
3. Update rail-btc configuration
4. New invoices use new addresses
5. Continue monitoring old xpub indefinitely

### 3. Monero

#### Wallet Setup
```
Generate offline:
- Seed phrase (25 words)
- Spend key (private)
- View key (private)

Deploy to Wallet RPC:
- View key ONLY
- Can see incoming transactions
- Cannot spend funds
```

#### Wallet RPC Configuration
```bash
# View-only wallet
monero-wallet-rpc \
  --wallet-file view-only-wallet \
  --rpc-bind-port 28088 \
  --rpc-login user:password \
  --disable-rpc-login false \
  --trusted-daemon \
  --daemon-address mainnet-node:18081
```

#### Spending Process (Manual)
```
1. Export list of received subaddresses
2. On air-gapped machine with full wallet
3. Create transaction
4. Sign offline
5. Export signed transaction
6. Broadcast via online node
```

#### View Key Security
- View key stored in Wallet RPC only
- Wallet RPC runs on isolated server
- No internet access except from rail-xmr
- Encrypted at rest

## API Token Management

### RAIL_AUTH_TOKEN

**Purpose**: Authenticates callbacks from rail services to payments service

**Generation**:
```bash
openssl rand -hex 32
```

**Storage**:
- Production: Secret management service (Vault, AWS Secrets Manager)
- Development: .env file (gitignored)

**Rotation Schedule**: Every 90 days
```
1. Generate new token
2. Update payments service (add both tokens temporarily)
3. Update all rail services
4. Remove old token from payments service
5. Verify no errors
```

### ALT_WEBHOOK_SECRET

**Purpose**: HMAC signing of webhooks to Altostratus app

**Generation**:
```bash
openssl rand -hex 32
```

**Shared With**: Altostratus main application (for verification)

**Rotation Schedule**: Every 90 days
```
1. Generate new secret
2. Update Altostratus app (accept both signatures temporarily)
3. Update payments service
4. Remove old secret from Altostratus
```

### ADMIN_SIM_TOKEN

**Purpose**: Authenticates access to simulation endpoint

**Usage**: Development/staging ONLY - NEVER in production

**Generation**:
```bash
openssl rand -hex 32
```

**Production Requirement**: SIMULATION_ENABLED=false

### Wallet RPC Credentials

**Monero Wallet RPC**:
```
Username: Set to unique value per deployment
Password: 32+ character random password
Rotation: Every 90 days
```

**Lightning Node Macaroons**:
```
Invoice-only macaroon (read + invoice)
Rotation: Every 90 days via lncli bakemacaroon
```

## Backup Strategies

### 1. Invoice Database

**Frequency**: Continuous + Daily snapshots

**Method**:
```bash
# If using PostgreSQL
pg_dump --format=custom \
        --file=invoices_$(date +%Y%m%d).dump \
        payments_db

# Encrypt
gpg --encrypt --recipient ops@example.com \
    invoices_$(date +%Y%m%d).dump
```

**Storage Locations**:
- Primary: S3 / B2 / Object Storage (encrypted)
- Secondary: Different datacenter
- Tertiary: Offline encrypted USB

**Retention**:
- Daily backups: 30 days
- Weekly backups: 1 year
- Monthly backups: 7 years

### 2. Template Configuration

**Frequency**: On every change + Daily

**Storage**: templates.json file

**Method**:
```bash
# Already persisted to disk
# Backup with database backups
```

### 3. Channel State (Lightning)

**Frequency**: Real-time + Daily

**Method**:
```bash
# LND Static Channel Backup
lncli exportchanbackup --all \
      --output_file=channels_$(date +%Y%m%d).backup

# Encrypt and upload
gpg --encrypt channels_$(date +%Y%m%d).backup
aws s3 cp channels_$(date +%Y%m%d).backup.gpg \
          s3://backups/lightning/
```

**Critical**: SCB must be updated after EVERY channel open/close

**Automation**:
```python
# Monitor for channel events
# Auto-upload new SCB on change
```

### 4. Wallet Seeds & Keys

**Storage**:
- Primary: Hardware wallet (offline)
- Backup 1: Paper in bank safe deposit box
- Backup 2: Encrypted USB in different location
- Backup 3: Steel backup (Billfodl, Cryptosteel)

**NEVER**:
- Store in cloud
- Store in plain text
- Store on internet-connected machine
- Email or message

## Operational Procedures

### Deployment Checklist

**Pre-Deployment**:
- [ ] All secrets generated with proper entropy
- [ ] Secrets stored in secret management system
- [ ] No hardcoded credentials in code
- [ ] .env.example updated (no real values)
- [ ] SIMULATION_ENABLED=false in production
- [ ] Feature flags configured (ENABLE_LN, etc.)
- [ ] Monitoring dashboards configured
- [ ] Alerts tested and working
- [ ] Backup restoration tested

**Deployment**:
- [ ] Deploy rail services first
- [ ] Verify rail health checks
- [ ] Deploy payments service
- [ ] Verify connectivity to all rails
- [ ] Test invoice creation (testnet)
- [ ] Test payment flow end-to-end
- [ ] Verify webhooks delivering
- [ ] Monitor logs for errors

**Post-Deployment**:
- [ ] Create test invoice with small amount
- [ ] Make real payment
- [ ] Verify full flow works
- [ ] Document any issues
- [ ] Update runbook

### Disaster Recovery

#### Scenario 1: Database Lost
```
1. Restore from latest backup
2. Verify data integrity
3. Check for missing invoices (compare blockchain)
4. Re-process any missed payments manually
5. Update documentation
```

#### Scenario 2: Lightning Node Lost
```
1. Restore LND from seed + SCB
2. Node will force-close all channels
3. Wait for channel funds to unlock
4. Re-establish channels
5. Update rail-ln service endpoint
6. Resume operations
```

#### Scenario 3: Bitcoin Wallet Compromised
```
1. IMMEDIATELY sweep all funds to new secure wallet
2. Generate new xpub
3. Update rail-btc configuration
4. Notify users (if applicable)
5. Audit logs for breach source
6. Report to authorities if needed
```

#### Scenario 4: API Token Leaked
```
1. Generate new token immediately
2. Update both services atomically
3. Audit logs for unauthorized access
4. Check for fraudulent invoices
5. Rotate all related secrets
6. Review access controls
```

### Monitoring & Alerting

**24/7 Monitoring**:
- [ ] Rail service health checks
- [ ] Payment confirmations
- [ ] Webhook delivery success rate
- [ ] Disk space on all servers
- [ ] Database connection pool
- [ ] Certificate expiration (TLS)

**Alert Escalation**:
1. First alert: Slack channel
2. 5 minutes: Email on-call engineer
3. 15 minutes: Page on-call engineer
4. 30 minutes: Escalate to manager

### Security Incident Response

**If Breach Suspected**:
1. Isolate affected systems immediately
2. Preserve logs (copy to secure location)
3. Assess scope of breach
4. Rotate all credentials
5. Notify affected parties
6. Engage security audit firm
7. Document timeline and lessons learned

## Compliance & Audit

### Regular Security Audits
- **Quarterly**: Internal security review
- **Annually**: Third-party penetration test
- **Annually**: Code audit (smart contract style)

### Access Logging
Maintain audit log of:
- Who accessed what system
- When credentials were rotated
- Configuration changes
- Admin actions

### Regulatory Compliance
- No KYC required (non-custodial)
- Transaction monitoring not required (public blockchain)
- Data retention policies (GDPR compliant)
- Right to deletion (invoice anonymization)

## Team Training

### Required Knowledge
- [ ] Backup restoration procedure
- [ ] Key rotation procedure
- [ ] Incident response plan
- [ ] Monitoring dashboard usage
- [ ] Manual payment verification

### Documentation
- [ ] Runbook for common issues
- [ ] Emergency contact list
- [ ] Escalation procedures
- [ ] Backup locations and access

## Cost Management

### Infrastructure Costs
```
Lightning Node VPS:     $50-100/month
Bitcoin Full Node:      $20-40/month
Monero Full Node:       $40-80/month
Payments Service:       $10-20/month
Monitoring:             $20-50/month
Backups (Storage):      $5-10/month
------------------------
Total:                  $145-300/month
```

### Optimization Opportunities
- Use testnet for development
- Prune Bitcoin blockchain (if not full archival needed)
- Compress backups before upload
- Use reserved instances / annual billing

## Next Steps

After reading this guide:
1. Review your current key storage - are any keys at risk?
2. Set up proper backup procedures
3. Create credential rotation calendar
4. Test disaster recovery procedures
5. Train team members
6. Document any deviations from this guide
