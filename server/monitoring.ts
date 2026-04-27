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
 * Log severity levels
 */
export type LogLevel = "info" | "warn" | "error" | "alert";

/**
 * Payment lifecycle events
 */
export type PaymentEvent = 
  | "payment.created"
  | "payment.create_failed"  // Payment creation failed (e.g., stub mode, rail unavailable)
  | "payment.pending"
  | "payment.confirming"
  | "payment.confirmed"
  | "payment.expired"
  | "payment.failed"  // Payment failed during processing (validation, internal error)
  | "payment.error";

/**
 * Infrastructure events
 */
export type InfraEvent = 
  | "poll.started"        // Polling cycle started
  | "poll.completed"      // Polling cycle completed successfully
  | "poll.success"
  | "poll.failed"
  | "webhook.queued"
  | "webhook.success"
  | "webhook.failed"
  | "rail.unavailable"
  | "rail.healthy"
  | "rail.degraded"       // Rail entered degraded state
  | "rail.down"           // Rail entered error/down state
  | "rail.recovered"      // Rail recovered from degraded/error state
  | "rail.stale"          // Rail has stale polling data
  | "payment.stuck"       // Payment stuck in pending state
  | "config.error"        // Configuration error at startup
  | "database.error";     // Database connectivity error

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
 * Alert conditions to monitor (Step 4.1: Alert conditions defined)
 */
const ALERT_CONDITIONS: AlertCondition[] = [
  // Per-Rail Alert Conditions
  
  // Poll failures: consecutive_poll_failures >= 3 triggers degraded state
  {
    id: "rail_degraded",
    event: "rail.degraded",
    threshold: 1,
    windowMs: 15 * 60 * 1000, // 15 minutes
    severity: "warning",
    description: "Rail entered degraded state (3+ consecutive poll failures)",
  },
  
  // Rail down: consecutive_poll_failures >= 5 or stale polling
  {
    id: "rail_down",
    event: "rail.down",
    threshold: 1,
    windowMs: 15 * 60 * 1000, // 15 minutes
    severity: "critical",
    description: "Rail is down (5+ consecutive poll failures or stale polling)",
  },
  
  // Stale polling: now - last_successful_poll_at > 10 minutes
  {
    id: "rail_stale_polling",
    event: "rail.stale",
    threshold: 1,
    windowMs: 15 * 60 * 1000, // 15 minutes
    severity: "warning",
    description: "Rail has not polled successfully in >10 minutes",
  },
  
  // Stuck pending payments: payment pending for longer than expected
  {
    id: "payment_stuck_pending",
    event: "payment.stuck",
    threshold: 3,
    windowMs: 30 * 60 * 1000, // 30 minutes
    severity: "warning",
    description: "3+ payments stuck in pending state while others are confirming",
  },
  
  // Payment lifecycle alerts
  {
    id: "payment_failures",
    event: "payment.failed",
    threshold: 3,
    windowMs: 5 * 60 * 1000, // 5 minutes
    severity: "critical",
    description: "3+ payment failures in 5 minutes (validation or internal errors)",
  },
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
    description: "5+ webhook delivery failures in 5 minutes (Merchant may not receive notifications)",
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
 * Sensitive keys that should NEVER be logged
 * 
 * This includes:
 * - Private keys, seeds, mnemonics
 * - RPC passwords and auth tokens
 * - Full authentication tokens (only prefix allowed)
 * - API keys and secrets
 */
const SENSITIVE_KEYS = [
  "privateKey",
  "private_key",
  "seed",
  "mnemonic",
  "password",
  "rpcPassword",
  "rpc_password",
  "authToken",
  "auth_token",
  "token",
  "apiKey",
  "api_key",
  "secret",
  "macaroon",
  "cert",
  "certificate",
  "LNBITS_WALLET_KEY",    // LNbits wallet key (explicit protection)
  "LNBITS_WEBHOOK_SECRET", // LNbits webhook secret (explicit protection)
  "wallet_key",           // Generic wallet key pattern
  "webhook_secret",       // Generic webhook secret pattern
];

/**
 * Sanitize metadata to remove sensitive values
 * 
 * @param metadata - Raw metadata object
 * @returns Sanitized metadata safe for logging
 */
function sanitizeMetadata(metadata: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(metadata)) {
    const lowerKey = key.toLowerCase();

    // Check if key is sensitive
    const isSensitive = SENSITIVE_KEYS.some(sensitiveKey => 
      lowerKey.includes(sensitiveKey.toLowerCase())
    );

    if (isSensitive) {
      // For auth tokens, log only first 8 chars as prefix
      if (typeof value === "string" && (lowerKey.includes("token") || lowerKey.includes("auth"))) {
        sanitized[key] = `${value.substring(0, 8)}...`;
      } else {
        sanitized[key] = "[REDACTED]";
      }
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Determine log level based on event type
 * 
 * More specific patterns must be checked first
 */
function getEventLogLevel(event: MonitoringEvent): LogLevel {
  // Check specific events first (before generic patterns)
  if (event === "payment.create_failed") {
    return "warn";
  }
  if (event === "payment.expired") {
    return "warn";
  }
  
  // Check generic error patterns
  if (event.startsWith("payment.error") || event === "payment.failed") {
    return "error";
  }
  if (event.includes("failed") || event === "rail.unavailable") {
    return "error";
  }
  
  // Default to info
  return "info";
}

/**
 * Log a payment or infrastructure event
 * 
 * @param event - Event type
 * @param rail - Payment rail (optional for cross-rail events)
 * @param metadata - Additional context
 * @param level - Optional explicit log level (auto-detected if not provided)
 */
export function logEvent(
  event: MonitoringEvent,
  rail?: Rail,
  metadata?: Record<string, any>,
  level?: LogLevel
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

  // Determine log level
  const logLevel = level || getEventLogLevel(event);

  // Structured logging
  const logEntry: Record<string, any> = {
    ts: new Date(timestamp).toISOString(),
    level: logLevel,
    event,
  };

  if (rail) {
    logEntry.rail = rail;
  }

  if (metadata) {
    // Sanitize and merge metadata
    const sanitized = sanitizeMetadata(metadata);
    Object.assign(logEntry, sanitized);
  }

  // Log to appropriate stream based on level
  if (logLevel === "error" || logLevel === "alert") {
    console.error(JSON.stringify(logEntry));
  } else if (logLevel === "warn") {
    console.warn(JSON.stringify(logEntry));
  } else {
    console.log(JSON.stringify(logEntry));
  }

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
 * (Step 4.2: Alert emission mechanism)
 * 
 * Emits alerts to:
 * - Console (always with level="alert")
 * - Webhook (if ALERT_WEBHOOK_URL configured)
 * 
 * Alert payload includes:
 * - rail
 * - event (rail.degraded, rail.down, etc.)
 * - reason
 * - Relevant counters/timestamps
 */
async function fireAlert(alert: Alert): Promise<void> {
  // Log to console with level="alert" (Step 4.2)
  console.error(JSON.stringify({
    ts: alert.timestamp,
    level: "alert",
    event: alert.condition.event,
    alert: true,
    severity: alert.condition.severity,
    id: alert.condition.id,
    description: alert.condition.description,
    rail: alert.rail,
    count: alert.count,
  }));

  // Send webhook if configured (Step 4.2: Optional external notifier)
  if (ALERT_WEBHOOK_ENABLED) {
    try {
      await axios.post(
        ALERT_WEBHOOK_URL,
        {
          severity: alert.condition.severity,
          alert_id: alert.condition.id,
          event: alert.condition.event,
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
            "User-Agent": "Rudis-Monitoring/1.0",
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
// Per-Rail Health State Tracking
// ============================================================================

/**
 * Health status levels
 */
export type HealthStatus = "ok" | "degraded" | "error";

/**
 * Per-rail health state
 */
interface RailHealthState {
  /** Timestamp of last successful poll */
  lastSuccessfulPollAt: number | null;
  /** Timestamp of last poll error */
  lastPollErrorAt: number | null;
  /** Count of consecutive poll failures */
  consecutivePollFailures: number;
  /** Timestamp of last payment confirmation */
  lastPaymentConfirmedAt: number | null;
  /** Current health status */
  status: HealthStatus;
}

/**
 * Global health state for all rails
 */
const railHealthStates = new Map<Rail, RailHealthState>();

/**
 * Initialize health state for a rail
 */
function initializeRailHealth(rail: Rail): RailHealthState {
  return {
    lastSuccessfulPollAt: null,
    lastPollErrorAt: null,
    consecutivePollFailures: 0,
    lastPaymentConfirmedAt: null,
    status: "ok",
  };
}

/**
 * Get or initialize health state for a rail
 */
function getRailHealthState(rail: Rail): RailHealthState {
  if (!railHealthStates.has(rail)) {
    railHealthStates.set(rail, initializeRailHealth(rail));
  }
  return railHealthStates.get(rail)!;
}

/**
 * Update health status based on current state
 * (Step 4.2: Alert emission mechanism with state change detection)
 * 
 * Rules:
 * - ok: No consecutive failures, recent successful polls
 * - degraded: Some failures but below alert threshold
 * - error: Failures exceed threshold or no polls for extended period
 * 
 * Emits alert events when state changes:
 * - rail.degraded: When entering degraded state
 * - rail.down: When entering error state
 * - rail.stale: When polling data is stale
 * - rail.recovered: When recovering from degraded/error state
 */
function updateRailHealthStatus(rail: Rail): void {
  const state = getRailHealthState(rail);
  const now = Date.now();
  const previousStatus = state.status;
  
  // Configuration (Step 4.1: Alert conditions)
  const MAX_TIME_SINCE_POLL = 10 * 60 * 1000; // 10 minutes
  const DEGRADED_THRESHOLD = 3; // Consecutive failures
  const ERROR_THRESHOLD = 5; // Consecutive failures
  
  // Check if we haven't polled in a long time (stale polling)
  const timeSinceLastPoll = state.lastSuccessfulPollAt 
    ? now - state.lastSuccessfulPollAt 
    : Infinity;
  
  let newStatus: HealthStatus = "ok";
  let stalePolling = false;
  
  if (timeSinceLastPoll > MAX_TIME_SINCE_POLL && state.lastSuccessfulPollAt !== null) {
    newStatus = "error";
    stalePolling = true;
    
    // Emit stale polling alert
    logEvent("rail.stale", rail, {
      timeSinceLastPollMs: timeSinceLastPoll,
      lastSuccessfulPollAt: new Date(state.lastSuccessfulPollAt).toISOString(),
    }, "alert");
  } else if (state.consecutivePollFailures >= ERROR_THRESHOLD) {
    // Check consecutive failures
    newStatus = "error";
  } else if (state.consecutivePollFailures >= DEGRADED_THRESHOLD) {
    newStatus = "degraded";
  } else if (state.consecutivePollFailures === 0) {
    newStatus = "ok";
  } else {
    // 1-2 failures: still ok but being monitored
    newStatus = "ok";
  }
  
  // Update status
  state.status = newStatus;
  
  // Emit alert events on state changes (Step 4.2: Alert emission)
  if (previousStatus !== newStatus) {
    if (newStatus === "degraded" && previousStatus === "ok") {
      // Rail just entered degraded state
      logEvent("rail.degraded", rail, {
        consecutivePollFailures: state.consecutivePollFailures,
        lastPollErrorAt: state.lastPollErrorAt 
          ? new Date(state.lastPollErrorAt).toISOString() 
          : null,
        reason: `${state.consecutivePollFailures} consecutive poll failures`,
      }, "alert");
    } else if (newStatus === "error" && (previousStatus === "ok" || previousStatus === "degraded")) {
      // Rail just went down
      logEvent("rail.down", rail, {
        consecutivePollFailures: state.consecutivePollFailures,
        lastPollErrorAt: state.lastPollErrorAt 
          ? new Date(state.lastPollErrorAt).toISOString() 
          : null,
        stalePolling,
        reason: stalePolling 
          ? `No successful polls for ${Math.round(timeSinceLastPoll / 60000)} minutes`
          : `${state.consecutivePollFailures} consecutive poll failures`,
      }, "alert");
    } else if (newStatus === "ok" && (previousStatus === "degraded" || previousStatus === "error")) {
      // Rail recovered! (Step 4.3: Recovery event)
      logEvent("rail.recovered", rail, {
        previousStatus,
        recoveryTimestamp: new Date(now).toISOString(),
        downtimeDurationMs: state.lastPollErrorAt ? now - state.lastPollErrorAt : null,
      }, "alert");
    } else if (newStatus === "degraded" && previousStatus === "error") {
      // Partial recovery: error → degraded
      logEvent("rail.degraded", rail, {
        consecutivePollFailures: state.consecutivePollFailures,
        previousStatus: "error",
        reason: "Partial recovery from error state",
      }, "info");
    }
  }
}

/**
 * Record successful poll for a rail
 */
export function recordPollSuccess(rail: Rail): void {
  const state = getRailHealthState(rail);
  state.lastSuccessfulPollAt = Date.now();
  state.consecutivePollFailures = 0;
  updateRailHealthStatus(rail);
}

/**
 * Record poll failure for a rail
 */
export function recordPollFailure(rail: Rail): void {
  const state = getRailHealthState(rail);
  state.lastPollErrorAt = Date.now();
  state.consecutivePollFailures++;
  updateRailHealthStatus(rail);
}

/**
 * Record payment confirmation for a rail
 */
export function recordPaymentConfirmed(rail: Rail): void {
  const state = getRailHealthState(rail);
  state.lastPaymentConfirmedAt = Date.now();
}

/**
 * Get health state for a specific rail
 */
export function getRailHealth(rail: Rail): {
  rail: Rail;
  status: HealthStatus;
  lastSuccessfulPollAt: string | null;
  lastPollErrorAt: string | null;
  consecutivePollFailures: number;
  lastPaymentConfirmedAt: string | null;
} {
  const state = getRailHealthState(rail);
  
  return {
    rail,
    status: state.status,
    lastSuccessfulPollAt: state.lastSuccessfulPollAt 
      ? new Date(state.lastSuccessfulPollAt).toISOString() 
      : null,
    lastPollErrorAt: state.lastPollErrorAt 
      ? new Date(state.lastPollErrorAt).toISOString() 
      : null,
    consecutivePollFailures: state.consecutivePollFailures,
    lastPaymentConfirmedAt: state.lastPaymentConfirmedAt 
      ? new Date(state.lastPaymentConfirmedAt).toISOString() 
      : null,
  };
}

/**
 * Get global health snapshot
 * 
 * Overall status derived from all rails:
 * - ok: All rails are ok
 * - degraded: At least one rail is degraded, none in error
 * - error: At least one rail is in error state
 */
export function getGlobalHealth(): {
  overall: HealthStatus;
  rails: {
    BTC: ReturnType<typeof getRailHealth>;
    XMR: ReturnType<typeof getRailHealth>;
    LN: ReturnType<typeof getRailHealth>;
  };
  timestamp: string;
} {
  const btcHealth = getRailHealth("BTC");
  const xmrHealth = getRailHealth("XMR");
  const lnHealth = getRailHealth("LN");
  
  // Determine overall status
  let overall: HealthStatus = "ok";
  
  if (
    btcHealth.status === "error" || 
    xmrHealth.status === "error" || 
    lnHealth.status === "error"
  ) {
    overall = "error";
  } else if (
    btcHealth.status === "degraded" || 
    xmrHealth.status === "degraded" || 
    lnHealth.status === "degraded"
  ) {
    overall = "degraded";
  }
  
  return {
    overall,
    rails: {
      BTC: btcHealth,
      XMR: xmrHealth,
      LN: lnHealth,
    },
    timestamp: new Date().toISOString(),
  };
}

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
  health: ReturnType<typeof getGlobalHealth>;
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
    health: getGlobalHealth(),
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
 * Log payment creation failed
 * 
 * Used when payment creation fails due to:
 * - Stub mode (rail not configured)
 * - Rail service unavailable
 * - Invalid request
 * 
 * @param rail - Payment rail (BTC, XMR, LN)
 * @param invoiceId - Invoice ID (if created before failure)
 * @param reason - Failure reason (e.g., "ln_not_implemented", "service_unavailable")
 * @param details - Additional error details
 */
export function logPaymentCreateFailed(
  rail: Rail,
  invoiceId: string | undefined,
  reason: string,
  details?: string
): void {
  const metadata: Record<string, any> = { reason };
  if (invoiceId) metadata.invoiceId = invoiceId;
  if (details) metadata.details = details;
  
  logEvent("payment.create_failed", rail, metadata);
}

/**
 * Log payment status change
 */
export function logPaymentStatus(
  rail: Rail,
  invoiceId: string,
  status: "pending" | "confirming" | "confirmed" | "expired"
): void {
  // Record payment confirmation in health state
  if (status === "confirmed") {
    recordPaymentConfirmed(rail);
  }
  
  logEvent(`payment.${status}` as PaymentEvent, rail, { invoiceId });
}

/**
 * Log payment error
 * 
 * Use this for errors that occur during payment processing but don't
 * necessarily mean the payment failed permanently.
 * 
 * @param rail - Payment rail
 * @param invoiceId - Invoice ID
 * @param error - Error message
 * @param errorStack - Optional error stack trace (will be sanitized)
 */
export function logPaymentError(
  rail: Rail,
  invoiceId: string,
  error: string,
  errorStack?: string
): void {
  const metadata: Record<string, any> = { invoiceId, error };
  
  if (errorStack) {
    // Sanitize stack trace: remove file paths that might contain sensitive info
    metadata.stack = errorStack
      .split("\n")
      .slice(0, 5) // Limit to first 5 lines
      .map(line => line.trim())
      .join(" | ");
  }
  
  logEvent("payment.error", rail, metadata, "error");
}

/**
 * Log payment failure
 * 
 * Use this when a payment permanently fails (e.g., validation error, internal error).
 * This is different from payment.error which may be transient.
 * 
 * @param rail - Payment rail
 * @param invoiceId - Invoice ID
 * @param reason - Failure reason
 * @param details - Optional additional details
 */
export function logPaymentFailed(
  rail: Rail,
  invoiceId: string,
  reason: string,
  details?: string
): void {
  const metadata: Record<string, any> = { invoiceId, reason };
  if (details) metadata.details = details;
  
  logEvent("payment.failed", rail, metadata, "error");
}

/**
 * Log polling cycle started
 * 
 * @param rail - Payment rail
 * @param paymentCount - Number of payments being polled (optional)
 */
export function logPollStarted(rail: Rail, paymentCount?: number): void {
  const metadata = paymentCount !== undefined ? { paymentCount } : undefined;
  logEvent("poll.started", rail, metadata, "info");
}

/**
 * Log polling cycle completed
 * 
 * @param rail - Payment rail
 * @param duration - Duration in milliseconds (optional)
 * @param updatedCount - Number of payments updated (optional)
 */
export function logPollCompleted(
  rail: Rail,
  duration?: number,
  updatedCount?: number
): void {
  const metadata: Record<string, any> = {};
  if (duration !== undefined) metadata.durationMs = duration;
  if (updatedCount !== undefined) metadata.updatedCount = updatedCount;
  
  // Record successful poll in health state
  recordPollSuccess(rail);
  
  logEvent("poll.completed", rail, Object.keys(metadata).length > 0 ? metadata : undefined, "info");
}

/**
 * Log poll result (legacy - prefer logPollCompleted/logPollFailed)
 * 
 * @deprecated Use logPollCompleted() and logPollFailed() instead
 */
export function logPollResult(rail: Rail, success: boolean, error?: string): void {
  if (success) {
    logPollCompleted(rail);
  } else {
    logPollFailed(rail, error);
  }
}

/**
 * Log poll failure
 * 
 * Use this when a polling cycle fails due to RPC errors, network issues, etc.
 * This should NOT be used for individual payment errors.
 * 
 * @param rail - Payment rail
 * @param error - Error message
 * @param errorStack - Optional error stack trace (will be sanitized)
 */
export function logPollFailed(rail: Rail, error?: string, errorStack?: string): void {
  const metadata: Record<string, any> = {};
  
  if (error) metadata.error = error;
  
  if (errorStack) {
    // Sanitize stack trace
    metadata.stack = errorStack
      .split("\n")
      .slice(0, 5)
      .map(line => line.trim())
      .join(" | ");
  }
  
  // Record poll failure in health state
  recordPollFailure(rail);
  
  logEvent("poll.failed", rail, Object.keys(metadata).length > 0 ? metadata : undefined, "error");
}

/**
 * Log webhook result
 */
export function logWebhookResult(invoiceId: string, success: boolean, statusCode?: number): void {
  logEvent(
    success ? "webhook.success" : "webhook.failed",
    undefined,
    { invoiceId, statusCode },
    success ? "info" : "error"
  );
}

/**
 * Log rail health change
 */
export function logRailHealth(rail: Rail, healthy: boolean, error?: string): void {
  logEvent(
    healthy ? "rail.healthy" : "rail.unavailable",
    rail,
    error ? { error } : undefined,
    healthy ? "info" : "error"
  );
}

// ============================================================================
// Global Alerts (Step 4.1: Global alert conditions)
// ============================================================================

/**
 * Log startup configuration error
 * (Step 4.1: Global alert - missing env vars for enabled rail)
 * 
 * @param rail - Payment rail with config error
 * @param missingEnvVars - Array of missing environment variables
 * @param details - Additional error details
 */
export function logConfigError(
  rail: Rail,
  missingEnvVars: string[],
  details?: string
): void {
  logEvent("config.error", rail, {
    missingEnvVars,
    details,
    reason: `Missing required environment variables: ${missingEnvVars.join(", ")}`,
  }, "alert");
}

/**
 * Log database connectivity error
 * (Step 4.1: Global alert - database issues detected at bootstrap)
 * 
 * @param operation - Database operation that failed (e.g., "bootstrap", "query")
 * @param error - Error message
 * @param willRetry - Whether the operation will be retried
 */
export function logDatabaseError(
  operation: string,
  error: string,
  willRetry: boolean = false
): void {
  logEvent("database.error", undefined, {
    operation,
    error,
    willRetry,
  }, "alert");
}

/**
 * Log stuck pending payment alert
 * (Step 4.1: Per-rail alert - payment stuck in pending state)
 * 
 * @param rail - Payment rail
 * @param invoiceId - Invoice ID
 * @param pendingDurationMs - How long payment has been pending (ms)
 * @param otherPaymentsConfirming - Whether other payments are confirming
 */
export function logPaymentStuck(
  rail: Rail,
  invoiceId: string,
  pendingDurationMs: number,
  otherPaymentsConfirming: boolean
): void {
  logEvent("payment.stuck", rail, {
    invoiceId,
    pendingDurationMs,
    pendingDurationMinutes: Math.round(pendingDurationMs / 60000),
    otherPaymentsConfirming,
    reason: `Payment stuck in pending state for ${Math.round(pendingDurationMs / 60000)} minutes`,
  }, "alert");
}
