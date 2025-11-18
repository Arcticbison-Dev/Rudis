/**
 * Cross-Rail Payment Monitoring & Alerting System
 * 
 * Provides centralized event logging and alerting for all payment rails.
 * Tracks payment lifecycle events and detects anomalies requiring operator attention.
 */

import axios from "axios";

// ============================================================================
// Types & Configuration
// ============================================================================

/**
 * Payment rails
 */
export type Rail = "BTC" | "XMR" | "LN";

/**
 * Payment lifecycle events
 */
export type PaymentEvent = 
  | "payment.created"
  | "payment.pending"
  | "payment.confirming"
  | "payment.confirmed"
  | "payment.expired"
  | "payment.error";

/**
 * Infrastructure events
 */
export type InfraEvent = 
  | "poll.success"
  | "poll.failed"
  | "webhook.queued"
  | "webhook.success"
  | "webhook.failed"
  | "rail.unavailable"
  | "rail.healthy";

export type MonitoringEvent = PaymentEvent | InfraEvent;

/**
 * Alert severity levels
 */
export type AlertSeverity = "warning" | "critical";

/**
 * Alert conditions
 */
interface AlertCondition {
  /** Unique identifier for this alert */
  id: string;
  /** Event pattern to match */
  event: MonitoringEvent;
  /** Rail to monitor (or null for all rails) */
  rail?: Rail | null;
  /** Threshold: trigger after N occurrences */
  threshold: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Alert severity */
  severity: AlertSeverity;
  /** Human-readable description */
  description: string;
}

/**
 * Triggered alert
 */
interface Alert {
  condition: AlertCondition;
  count: number;
  rail?: Rail;
  timestamp: string;
  recentEvents: Array<{
    event: MonitoringEvent;
    rail?: Rail;
    timestamp: string;
    metadata?: Record<string, any>;
  }>;
}

// ============================================================================
// Configuration
// ============================================================================

const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || "";
const ALERT_WEBHOOK_ENABLED = ALERT_WEBHOOK_URL.length > 0;

/**
 * Alert conditions to monitor
 */
const ALERT_CONDITIONS: AlertCondition[] = [
  {
    id: "payment_error_spike",
    event: "payment.error",
    threshold: 5,
    windowMs: 5 * 60 * 1000, // 5 minutes
    severity: "warning",
    description: "5+ payment errors in 5 minutes",
  },
  {
    id: "poll_failures",
    event: "poll.failed",
    threshold: 10,
    windowMs: 10 * 60 * 1000, // 10 minutes
    severity: "warning",
    description: "10+ poll failures in 10 minutes (blockchain node may be down)",
  },
  {
    id: "webhook_failures",
    event: "webhook.failed",
    threshold: 5,
    windowMs: 5 * 60 * 1000, // 5 minutes
    severity: "critical",
    description: "5+ webhook delivery failures in 5 minutes (Altostratus may not receive notifications)",
  },
  {
    id: "rail_unavailable",
    event: "rail.unavailable",
    threshold: 3,
    windowMs: 5 * 60 * 1000, // 5 minutes
    severity: "critical",
    description: "Rail unavailable 3+ times in 5 minutes",
  },
];

// ============================================================================
// Event Storage & Alert Detection
// ============================================================================

/**
 * In-memory event buffer for alert detection
 * In production, this could be Redis or a time-series DB
 */
interface EventRecord {
  event: MonitoringEvent;
  rail?: Rail;
  timestamp: number;
  metadata?: Record<string, any>;
}

const eventBuffer: EventRecord[] = [];
const MAX_BUFFER_SIZE = 10000; // Keep last 10k events
const CLEANUP_INTERVAL_MS = 60 * 1000; // Cleanup every minute

/**
 * Alert cooldown to prevent spam
 * Track when each alert was last fired
 */
const alertCooldowns = new Map<string, number>();
const ALERT_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes between same alert

// ============================================================================
// Event Logging
// ============================================================================

/**
 * Log a payment or infrastructure event
 * 
 * @param event - Event type
 * @param rail - Payment rail (optional for cross-rail events)
 * @param metadata - Additional context
 */
export function logEvent(
  event: MonitoringEvent,
  rail?: Rail,
  metadata?: Record<string, any>
): void {
  const timestamp = Date.now();
  
  // Add to event buffer for alert detection
  eventBuffer.push({
    event,
    rail,
    timestamp,
    metadata,
  });

  // Trim buffer if too large
  if (eventBuffer.length > MAX_BUFFER_SIZE) {
    eventBuffer.splice(0, eventBuffer.length - MAX_BUFFER_SIZE);
  }

  // Structured logging
  const logEntry: Record<string, any> = {
    ts: new Date(timestamp).toISOString(),
    event,
  };

  if (rail) {
    logEntry.rail = rail;
  }

  if (metadata) {
    // Merge metadata but avoid logging sensitive data
    Object.entries(metadata).forEach(([key, value]) => {
      if (!["address", "txid", "signature"].includes(key)) {
        logEntry[key] = value;
      }
    });
  }

  console.log(JSON.stringify(logEntry));

  // Check if this event triggers any alerts
  checkAlertConditions(event, rail);
}

// ============================================================================
// Alert Detection
// ============================================================================

/**
 * Check if event triggers any alert conditions
 */
function checkAlertConditions(event: MonitoringEvent, rail?: Rail): void {
  const now = Date.now();

  for (const condition of ALERT_CONDITIONS) {
    // Skip if event doesn't match
    if (condition.event !== event) continue;

    // Skip if rail-specific and doesn't match
    if (condition.rail && condition.rail !== rail) continue;

    // Check cooldown
    const cooldownKey = condition.rail 
      ? `${condition.id}_${condition.rail}`
      : condition.id;
    
    const lastAlert = alertCooldowns.get(cooldownKey);
    if (lastAlert && now - lastAlert < ALERT_COOLDOWN_MS) {
      continue; // Still in cooldown
    }

    // Count matching events in time window
    const windowStart = now - condition.windowMs;
    const matchingEvents = eventBuffer.filter(e => 
      e.event === condition.event &&
      e.timestamp >= windowStart &&
      (!condition.rail || e.rail === condition.rail)
    );

    // Trigger alert if threshold exceeded
    if (matchingEvents.length >= condition.threshold) {
      const alert: Alert = {
        condition,
        count: matchingEvents.length,
        rail: condition.rail || rail,
        timestamp: new Date(now).toISOString(),
        recentEvents: matchingEvents.slice(-10).map(e => ({
          event: e.event,
          rail: e.rail,
          timestamp: new Date(e.timestamp).toISOString(),
          metadata: e.metadata,
        })),
      };

      // Set cooldown
      alertCooldowns.set(cooldownKey, now);

      // Fire alert
      fireAlert(alert);
    }
  }
}

/**
 * Fire an alert via configured channels
 */
async function fireAlert(alert: Alert): Promise<void> {
  // Log to console (always)
  console.error(JSON.stringify({
    alert: true,
    severity: alert.condition.severity,
    id: alert.condition.id,
    description: alert.condition.description,
    rail: alert.rail,
    count: alert.count,
    timestamp: alert.timestamp,
  }));

  // Send webhook if configured
  if (ALERT_WEBHOOK_ENABLED) {
    try {
      await axios.post(
        ALERT_WEBHOOK_URL,
        {
          severity: alert.condition.severity,
          alert_id: alert.condition.id,
          description: alert.condition.description,
          rail: alert.rail,
          event_count: alert.count,
          timestamp: alert.timestamp,
          recent_events: alert.recentEvents,
        },
        {
          timeout: 5000,
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "Altostratus-Payments-Monitoring/1.0",
          },
        }
      );
    } catch (error: any) {
      console.error({
        error: "alert_webhook_failed",
        message: error.message,
      });
    }
  }
}

// ============================================================================
// Cleanup & Maintenance
// ============================================================================

/**
 * Periodically clean up old events from buffer
 * 
 * Note: Does NOT log cleanup events to avoid recursive buffer growth
 */
function cleanupEventBuffer(): void {
  const now = Date.now();
  const maxAge = Math.max(...ALERT_CONDITIONS.map(c => c.windowMs));
  const cutoff = now - maxAge - (60 * 1000); // Keep extra minute for safety

  let removed = 0;
  while (eventBuffer.length > 0 && eventBuffer[0].timestamp < cutoff) {
    eventBuffer.shift();
    removed++;
  }

  if (removed > 0) {
    // Log directly to console (not via logEvent to avoid recursive growth)
    console.log(JSON.stringify({
      ts: new Date(now).toISOString(),
      event: "monitoring.cleanup",
      eventsRemoved: removed,
      bufferSize: eventBuffer.length,
    }));
  }
}

// Start cleanup interval
setInterval(cleanupEventBuffer, CLEANUP_INTERVAL_MS);

// ============================================================================
// Metrics & Health
// ============================================================================

/**
 * Get current monitoring metrics
 */
export function getMetrics(): {
  bufferSize: number;
  activeAlerts: number;
  eventsByRail: Record<Rail, number>;
  eventsByType: Record<string, number>;
} {
  const eventsByRail: Record<Rail, number> = { BTC: 0, XMR: 0, LN: 0 };
  const eventsByType: Record<string, number> = {};

  for (const event of eventBuffer) {
    if (event.rail) {
      eventsByRail[event.rail]++;
    }
    eventsByType[event.event] = (eventsByType[event.event] || 0) + 1;
  }

  return {
    bufferSize: eventBuffer.length,
    activeAlerts: alertCooldowns.size,
    eventsByRail,
    eventsByType,
  };
}

// ============================================================================
// Convenience Helpers
// ============================================================================

/**
 * Log payment created
 */
export function logPaymentCreated(rail: Rail, invoiceId: string, amount: string): void {
  logEvent("payment.created", rail, { invoiceId, amount });
}

/**
 * Log payment status change
 */
export function logPaymentStatus(
  rail: Rail,
  invoiceId: string,
  status: "pending" | "confirming" | "confirmed" | "expired"
): void {
  logEvent(`payment.${status}` as PaymentEvent, rail, { invoiceId });
}

/**
 * Log payment error
 */
export function logPaymentError(rail: Rail, invoiceId: string, error: string): void {
  logEvent("payment.error", rail, { invoiceId, error });
}

/**
 * Log poll result
 */
export function logPollResult(rail: Rail, success: boolean, error?: string): void {
  logEvent(success ? "poll.success" : "poll.failed", rail, error ? { error } : undefined);
}

/**
 * Log webhook result
 */
export function logWebhookResult(invoiceId: string, success: boolean, statusCode?: number): void {
  logEvent(
    success ? "webhook.success" : "webhook.failed",
    undefined,
    { invoiceId, statusCode }
  );
}

/**
 * Log rail health change
 */
export function logRailHealth(rail: Rail, healthy: boolean, error?: string): void {
  logEvent(
    healthy ? "rail.healthy" : "rail.unavailable",
    rail,
    error ? { error } : undefined
  );
}
