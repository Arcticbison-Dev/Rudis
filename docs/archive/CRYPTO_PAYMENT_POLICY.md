# Crypto Payment Policy

**Effective Date**: 2025-11-06  
**Version**: 1.0  
**Service**: Altostratus Payments

## Overview

Altostratus Payments is a self-hosted, non-custodial crypto payment invoice system. This document outlines the policies governing the creation, payment, and lifecycle of crypto payment invoices.

## Supported Assets

### Lightning Network (BTC)
- **Type**: Layer 2 Bitcoin payment channel network
- **Confirmations Required**: Instant (settlement occurs when HTLC is claimed)
- **Typical Confirmation Time**: <5 seconds
- **Minimum Amount**: 1 satoshi
- **Maximum Amount**: Limited by channel liquidity
- **Invoice Expiry**: 1 hour (configurable per invoice)

### Bitcoin On-Chain (BTC)
- **Type**: Bitcoin blockchain native transactions
- **Confirmations Required**: 2 confirmations (configurable)
- **Typical Confirmation Time**: 20-60 minutes (depends on network congestion)
- **Minimum Amount**: Dust limit (~546 satoshis)
- **Maximum Amount**: No limit
- **Invoice Expiry**: 24 hours (configurable per invoice)
- **Address Type**: Native SegWit (Bech32) - P2WPKH

### Monero (XMR)
- **Type**: Privacy-focused cryptocurrency
- **Confirmations Required**: 10 confirmations (configurable)
- **Typical Confirmation Time**: 20-25 minutes
- **Minimum Amount**: 0.000000000001 XMR
- **Maximum Amount**: No limit
- **Invoice Expiry**: 24 hours (configurable per invoice)
- **Address Type**: Integrated addresses or subaddresses

## Invoice Lifecycle

### Status Definitions

#### `pending`
- Invoice created but payment not yet received
- Monitoring blockchain for incoming transactions
- Invoice is payable
- Customer can scan QR code and send payment

#### `paid`
- Payment received and confirmed
- Required confirmations met
- Webhook notification sent to Altostratus app
- Invoice is finalized
- Transaction ID recorded

#### `expired`
- Invoice expiration time passed without payment
- No longer accepting payments for this invoice
- New invoice must be created for new payment
- Invoice will be purged after retention period

#### `late-paid` (Future Enhancement)
- Payment received after invoice expiration
- Requires manual admin review
- May be processed or refunded depending on circumstances
- Not automatically credited to account

## Payment Handling

### Exact Payment
- Payment amount matches invoice amount exactly
- Invoice marked as `paid`
- Webhook sent to Altostratus
- Standard flow

### Underpayment

**Policy**: Reject and require manual review

**Process**:
1. Payment detected on blockchain
2. Amount is less than invoice total
3. Invoice remains in `pending` status
4. Admin notified of underpayment
5. Admin options:
   - Request additional payment (new invoice)
   - Accept partial payment (manual credit)
   - Refund underpayment (minus network fees)

**Customer Communication**:
- "Payment received: {amount} {currency}"
- "Invoice amount: {invoice_amount} {currency}"  
- "Please contact support to resolve"

### Overpayment

**Policy**: Accept overpayment, apply excess as credit

**Process**:
1. Payment detected on blockchain
2. Amount exceeds invoice total
3. Invoice marked as `paid`
4. Overpayment amount logged
5. Webhook includes overpayment details
6. Altostratus app applies excess as account credit

**Example**:
- Invoice: 0.001 BTC
- Payment: 0.0015 BTC
- Overpayment: 0.0005 BTC
- Result: Invoice paid, 0.0005 BTC credit applied

### Multiple Payments to Same Address

**Bitcoin & Monero**: Accumulated

**Process**:
1. Customer sends partial payment
2. System tracks cumulative total
3. When total ≥ invoice amount, mark paid
4. Handle overpayment per overpayment policy

**Lightning**: Not applicable (single HTLC per invoice)

### Multi-Path Payments (Lightning Only)

**Policy**: Accepted

Lightning Network supports splitting a payment across multiple paths (MPP/AMP). This is transparent to the invoice system and fully supported.

## Refund Policy

### Crypto-to-Crypto Refunds

**When Refunds are Issued**:
- Duplicate payments
- Service cancellation before fulfillment
- Technical errors
- Overpayment (customer requests refund instead of credit)

**Refund Process**:
1. Customer provides refund address (must be same currency)
2. Admin initiates refund transaction
3. Refund amount: Payment amount minus network fees
4. Network fees: Paid by customer (deducted from refund)
5. Refund transaction sent from offline wallet
6. Customer notified with transaction ID

**Timeline**:
- Lightning: Instant (if channels available)
- Bitcoin: 1-3 business days
- Monero: 1-3 business days

**Fees**:
- Lightning: Minimal routing fees (<1%)
- Bitcoin: Current mempool fees (~$1-10 depending on congestion)
- Monero: ~$0.01-0.10

### No Fiat Refunds

This system does not handle fiat currency. All refunds are crypto-to-crypto only.

## Blockchain Reorganization (Reorg) Handling

### Bitcoin

**Risk**: Blocks can be reorganized, causing confirmations to drop

**Policy**:
1. Monitor confirmation count continuously
2. If confirmations drop below threshold, revert invoice to `pending`
3. Wait for confirmations to reach threshold again
4. Notify Altostratus app of reversion (if already notified)
5. Re-send webhook when re-confirmed

**Likelihood**: Rare (<0.1% for 2+ confirmations)

### Monero

**Risk**: Very low due to CryptoNote protocol

**Policy**: Same as Bitcoin (monitor confirmations)

### Lightning

**Risk**: None (HTLC is atomic - either settles or fails)

## Expired Invoices

### Prevention

**Expiry Warnings**:
- UI shows "Expiring Soon" when <1 hour remaining (configurable)
- Auto-refresh invoice page updates countdown
- Clear expiration timestamp displayed

**Expiry Process**:
1. Invoice `expiresAt` time passes
2. Automated job runs hourly to mark expired invoices
3. Status changed from `pending` to `expired`
4. Payment address/BOLT11 no longer monitored
5. Invoice appears in history as expired

### Late Payments

**Lightning**: Cannot pay expired BOLT11 invoice (node rejects)

**Bitcoin/Monero**: Payment technically possible but:
1. Payment detected by listener
2. Invoice status checked - is `expired`
3. Callback rejected with 400 error
4. Invoice marked `late-paid` (requires implementation)
5. Admin reviews and processes manually

**Customer Communication**:
"This invoice has expired. Please create a new invoice to make payment."

## Security & Anti-Abuse

### Rate Limiting

**Invoice Creation**:
- 10 invoices per minute per IP address
- Prevents spam invoice generation
- Legitimate users unaffected

**Simulation Endpoint** (Development Only):
- 3 requests per minute per IP
- Only enabled in dev/staging
- Requires admin authentication token

### Sanctions & Compliance

**Policy**: Decentralized, non-custodial system

We do not:
- Hold customer funds
- Act as money transmitter
- Require KYC
- Monitor transaction sources
- Screen addresses against sanctions lists

**Responsibility**:
- Users are responsible for compliance with local laws
- System provides invoice generation only
- Payments occur directly on public blockchains
- No intermediary or custodian

### Prohibited Uses

Users may not use this system for:
- Illegal goods or services
- Sanctioned entities
- Money laundering
- Terrorist financing
- Any activity prohibited by applicable law

**Enforcement**:
- Self-hosted nature limits enforcement ability
- Operators must configure according to local regulations
- Logs contain minimal data (no PII)

## Data Retention & Privacy

### Invoice Data

**Storage Duration**:
- **Paid invoices**: 90 days before anonymization
- **Expired invoices**: 90 days before deletion (configurable: 30-90)
- **All invoices**: 365 days maximum before permanent deletion

**Anonymization Process**:
After 90 days (configurable), paid invoices are anonymized:
- Description: Replaced with "[Anonymized X days old]"
- Payment address: Hashed (first 16 chars of SHA256)
- Amount, currency, timestamps: Preserved (for accounting)
- Transaction IDs: Preserved (public blockchain data)

**Permanent Deletion**:
After 365 days (configurable), invoices and all associated data permanently deleted:
- Invoice record deleted
- Payment transactions deleted
- Webhook logs deleted
- Templates unaffected

### Privacy Principles

**No PII Logged**:
- No IP addresses
- No user agents
- No referrers
- No email addresses in logs
- No wallet addresses in logs

**Minimal Data Collection**:
- InvoiceId (UUID)
- Amount (for accounting)
- Currency
- Status
- Timestamps
- Transaction ID (public blockchain data)

### GDPR / Privacy Law Compliance

**Right to Deletion**:
- Contact admin to request invoice deletion
- Invoice immediately anonymized
- Permanent deletion after 30 days
- Transaction IDs cannot be deleted (public blockchain)

**Data Portability**:
- API provides invoice data in JSON format
- User can export their own invoices

## Support & Dispute Resolution

### Payment Issues

**Customer Support Process**:
1. Customer emails support with:
   - Invoice ID
   - Transaction ID (if available)
   - Description of issue
2. Admin reviews:
   - Blockchain confirmation status
   - Invoice status and logs
   - Webhook delivery status
3. Resolution:
   - Manual payment verification
   - Manual webhook trigger
   - Refund if appropriate
   - New invoice if necessary

**Response Time**:
- Critical (payment confirmed but not credited): 4 hours
- High (payment sent but not detected): 24 hours
- Normal (general inquiries): 72 hours

### Blockchain Issues

**Stuck Bitcoin Transaction**:
- Recommend: Replace-by-fee (RBF) or CPFP
- Wait for mempool clearance
- Potentially issue new invoice

**Lightning Route Failure**:
- Retry payment with different route
- Try smaller amount
- Use on-chain alternative

**Monero Not Detected**:
- Wait for 10 confirmations
- Verify correct subaddress used
- Check Monero node sync status
- Manual verification via view key

## Changes to This Policy

We reserve the right to modify this policy at any time. Changes will be:
- Documented with version number and effective date
- Communicated to users (if applicable)
- Applied to new invoices only (not retroactive)

**Change History**:
- 2025-11-06: Version 1.0 - Initial policy

## Contact

For questions about this policy:
- Technical issues: Submit issue on GitHub
- Payment disputes: Contact system administrator
- Policy questions: Review documentation at docs/

---

*This is a technical policy document for a self-hosted payment system. Operators are responsible for compliance with applicable laws and regulations in their jurisdiction.*
