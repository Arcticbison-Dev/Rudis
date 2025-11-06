# Observability & Monitoring Guide

This document outlines privacy-minimal observability practices for Altostratus Payments.

## Structured Logging

All logs follow a consistent JSON structure for easy parsing and querying:

```json
{
  "ts": "2025-11-06T15:30:00.000Z",
  "level": "info|warn|error",
  "invoiceId": "uuid-here",
  "rail": "ln|btc|xmr|simulate",
  "action": "created|confirmed|expired|webhook_sent",
  "status": "success|pending|failed",
  "errorCode": "optional-error-code"
}
```

### Privacy Principles
- **Never log**: IP addresses, user agents, referrers, full wallet addresses, transaction amounts
- **Always log**: invoiceId, rail type, event name, status codes
- **Conditionally log**: Error messages (sanitized), retry counts

### Log Levels

**INFO** - Normal operations:
```
{ invoiceId, rail, event: "created" }
{ invoiceId, rail, event: "confirmed", status: "confirmed" }
{ invoiceId, action: "webhook_sent", status: "success" }
```

**WARN** - Recoverable issues:
```
{ invoiceId, rail, event: "settled", status: "already_paid" }
{ invoiceId, action: "webhook_retry", attempt: 3 }
```

**ERROR** - Failures requiring attention:
```
{ invoiceId, rail, event: "confirmed", status: "expired", errorCode: "E001" }
{ action: "webhook_delivery", status: "failed", errorCode: "timeout" }
```

## Metrics to Track

### Application Metrics

#### Invoice Metrics
```
invoices_created_total{currency="BTC|Lightning|XMR"}
invoices_paid_total{currency="BTC|Lightning|XMR"}
invoices_expired_total{currency="BTC|Lightning|XMR"}
invoices_pending{currency="BTC|Lightning|XMR"} # Gauge
```

#### Payment Rail Metrics
```
rail_payments_confirmed_total{rail="ln|btc|xmr"}
rail_callback_latency_seconds{rail="ln|btc|xmr"} # Histogram
rail_callback_errors_total{rail="ln|btc|xmr",error_type="..."}
```

#### Webhook Metrics
```
webhook_deliveries_total{status="success|failed"}
webhook_retries_total
webhook_delivery_latency_seconds # Histogram
webhook_queue_size # Gauge
```

#### Timing Metrics
```
avg_time_to_paid_seconds{currency="BTC|Lightning|XMR"} # Histogram
invoice_age_seconds{status="pending|paid|expired"} # Histogram
```

### Infrastructure Metrics

#### Rail Service Health
```
rail_health_check_status{rail="ln|btc|xmr"} # 1=up, 0=down
rail_health_check_latency_seconds{rail="ln|btc|xmr"}
rail_last_successful_callback_timestamp{rail="ln|btc|xmr"}
```

#### Database/Storage
```
invoice_count_total
webhook_log_count_total
template_count_total
storage_operation_latency_seconds{operation="create|read|update"}
```

## Alerts

### Critical Alerts (Page Immediately)

#### Rail Service Down
```yaml
alert: RailServiceDown
expr: rail_health_check_status == 0
for: 5m
severity: critical
message: "Rail service {{ $labels.rail }} has been down for >5 minutes"
```

#### No Payments Received
```yaml
alert: NoPaymentsReceived
expr: rate(invoices_paid_total[1h]) == 0 AND invoices_pending > 0
for: 30m
severity: critical
message: "No payments confirmed in 30+ minutes despite pending invoices"
```

#### Webhook Delivery Failing
```yaml
alert: WebhookDeliveryFailing
expr: rate(webhook_deliveries_total{status="failed"}[5m]) > 0.5
for: 15m
severity: critical
message: "Webhook delivery failure rate >50% for 15+ minutes"
```

### Warning Alerts (Investigate Next Business Day)

#### High Retry Rate
```yaml
alert: HighWebhookRetryRate
expr: webhook_retries_total > 50
for: 1h
severity: warning
message: "Excessive webhook retries detected"
```

#### Slow Payment Confirmation
```yaml
alert: SlowPaymentConfirmation
expr: avg_time_to_paid_seconds{currency="Lightning"} > 30
for: 30m
severity: warning
message: "Lightning payments taking >30s to confirm"
```

```yaml
alert: SlowPaymentConfirmation
expr: avg_time_to_paid_seconds{currency="BTC"} > 3600
for: 1h
severity: warning
message: "Bitcoin payments taking >1 hour to confirm"
```

#### Invoice Expiration Rate High
```yaml
alert: HighExpirationRate
expr: rate(invoices_expired_total[1h]) / rate(invoices_created_total[1h]) > 0.3
for: 2h
severity: warning
message: ">30% of invoices expiring without payment"
```

#### Rail Callback Latency
```yaml
alert: SlowRailCallbacks
expr: histogram_quantile(0.95, rail_callback_latency_seconds) > 5
for: 10m
severity: warning
message: "95th percentile rail callback latency >5s"
```

## SLA Targets

### Time to Paid (95th Percentile)
- Lightning: <5 seconds
- Bitcoin (2 conf): <30 minutes
- Monero (10 conf): <25 minutes

### Availability
- Rail services: 99.5% uptime
- Payments service: 99.9% uptime
- Webhook delivery (first attempt): 99% success rate

### Performance
- Invoice creation: <200ms (p95)
- Invoice lookup: <100ms (p95)
- Webhook delivery: <2s (p95)

## Monitoring Stack Recommendations

### Option 1: Prometheus + Grafana (Self-Hosted)
```
- Prometheus for metrics collection
- Grafana for visualization
- Alertmanager for alerting
- Loki for log aggregation (optional)
```

### Option 2: Cloud-Native
```
- Datadog / New Relic / Grafana Cloud
- Pre-built dashboards
- Integrated alerting
- Log aggregation included
```

### Option 3: Minimal (For Small Deployments)
```
- Structured logs to stdout
- Log aggregation via journald or syslog
- Manual log queries for debugging
- Simple uptime monitoring (UptimeRobot, etc.)
```

## Dashboard Layouts

### Operations Dashboard
```
Row 1: Key Metrics
- Active invoices (pending)
- Payments last hour
- Webhook queue size
- All rails health status

Row 2: Payment Flows
- Invoice creation rate (last 24h)
- Payment confirmation rate by currency
- Time to paid histogram

Row 3: Reliability
- Webhook delivery success rate
- Rail callback error rate
- Failed invoice percentage

Row 4: Latency
- p50/p95/p99 time to paid by currency
- Webhook delivery latency
- Rail callback latency
```

### Debugging Dashboard
```
Row 1: Recent Failures
- Last 10 failed webhooks
- Last 10 expired invoices
- Last 10 rail errors

Row 2: Queue Status
- Pending webhooks by age
- Invoices awaiting payment by age
- Retry attempts distribution

Row 3: Detailed Logs
- Structured log viewer with filters
- Invoice ID search
- Error message search
```

## Log Retention Policy

### Production
- **INFO logs**: 7 days
- **WARN logs**: 30 days
- **ERROR logs**: 90 days
- **Metrics**: 1 year (with rollup)

### Development
- **All logs**: 3 days
- **Metrics**: 30 days

## Privacy Compliance

### GDPR / Privacy Law Considerations
1. Logs contain only invoiceId (UUID), not personal data
2. No IP addresses logged
3. Transaction IDs are public blockchain data (not PII)
4. Automatic log expiration after retention period
5. No cross-referencing with user identity in logs

### Audit Trail
Maintain separate audit log (encrypted at rest) for:
- Configuration changes
- Admin actions
- Security events
- Access to sensitive endpoints

Audit logs stored for 7 years minimum per regulatory requirements.

## Implementation Checklist

- [ ] Implement structured logging throughout codebase
- [ ] Set up metrics collection (Prometheus client library)
- [ ] Configure log rotation and retention
- [ ] Deploy monitoring stack (Prometheus + Grafana)
- [ ] Create Grafana dashboards
- [ ] Configure Alertmanager rules
- [ ] Set up on-call rotation
- [ ] Test alert delivery (email, Slack, PagerDuty)
- [ ] Document runbook procedures
- [ ] Train team on dashboard usage
