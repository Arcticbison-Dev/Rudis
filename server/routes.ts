import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertInvoiceSchema, insertTemplateSchema, paymentConfirmationSchema } from "@shared/schema";
import { paymentConfirmationSchema as legacyPaymentConfirmationSchema } from "@shared/webhook-schema";
import axios, { AxiosError } from "axios";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { getOrchestrator } from "./payment-orchestrator";
import { PaymentCurrency, type CanonicalPayment } from "@shared/payment-orchestrator";
import { z } from "zod";
import * as monitoring from "./monitoring";

// Privacy helpers - truncate addresses and txids for logging
function truncateAddress(address: string | null | undefined): string {
  if (!address || address.length <= 16) return address || "null";
  return `${address.substring(0, 8)}...${address.substring(address.length - 8)}`;
}

function truncateTxid(txid: string | null | undefined): string {
  if (!txid || txid.length <= 16) return txid || "null";
  return `${txid.substring(0, 8)}...${txid.substring(txid.length - 8)}`;
}

// Configuration from environment variables with sensible defaults and validation
const parseIntWithDefault = (value: string | undefined, defaultValue: number): number => {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
};

const WEBHOOK_TIMEOUT_MS = parseIntWithDefault(process.env.WEBHOOK_TIMEOUT_MS, 10000);
const WEBHOOK_MAX_ATTEMPTS = parseIntWithDefault(process.env.WEBHOOK_MAX_ATTEMPTS, 10);
const WEBHOOK_MAX_AGE_HOURS = parseIntWithDefault(process.env.WEBHOOK_MAX_AGE_HOURS, 24);
const WEBHOOK_RETRY_DELAY_1 = parseIntWithDefault(process.env.WEBHOOK_RETRY_DELAY_1, 1000);
const WEBHOOK_RETRY_DELAY_2 = parseIntWithDefault(process.env.WEBHOOK_RETRY_DELAY_2, 3000);
const WEBHOOK_RETRY_DELAY_3 = parseIntWithDefault(process.env.WEBHOOK_RETRY_DELAY_3, 9000);
const WEBHOOK_RETRY_DELAYS = [WEBHOOK_RETRY_DELAY_1, WEBHOOK_RETRY_DELAY_2, WEBHOOK_RETRY_DELAY_3];
const CLEANUP_EXPIRED_DAYS = Math.max(30, Math.min(90, parseIntWithDefault(process.env.CLEANUP_EXPIRED_DAYS, 90)));
const RETENTION_PAID_DAYS = parseIntWithDefault(process.env.RETENTION_PAID_DAYS, 90);
const RETENTION_MAX_DAYS = parseIntWithDefault(process.env.RETENTION_MAX_DAYS, 365);
const AUTO_ANONYMIZE_ENABLED = process.env.AUTO_ANONYMIZE_ENABLED !== "false";
const ALT_WEBHOOK_SECRET = process.env.ALT_WEBHOOK_SECRET || "";

// Rail service configuration
const RAIL_AUTH_TOKEN = process.env.RAIL_AUTH_TOKEN || "";
const LN_SERVICE_URL = process.env.LN_SERVICE_URL || "http://localhost:5001";
const BTC_SERVICE_URL = process.env.BTC_SERVICE_URL || "http://localhost:5002";
const XMR_SERVICE_URL = process.env.XMR_SERVICE_URL || "http://localhost:5003";
const ENABLE_LN = process.env.ENABLE_LN === "true";
const ENABLE_BTC = process.env.ENABLE_BTC === "true";
const ENABLE_XMR = process.env.ENABLE_XMR === "true";

// Admin API configuration (Step 5.3: Security for admin endpoints)
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN || "";

// Simulation configuration  
const SIMULATION_ENABLED = process.env.SIMULATION_ENABLED === "true";
const ADMIN_SIM_TOKEN = process.env.ADMIN_SIM_TOKEN || "";

// Rate limiters
const createInvoiceLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute per IP
  message: { error: "Too many invoice creation requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

const simulationLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 3, // 3 requests per minute per IP
  message: { error: "Too many simulation requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

// HMAC signature generation for webhook security
function generateWebhookSignature(payload: any): string {
  if (!ALT_WEBHOOK_SECRET || ALT_WEBHOOK_SECRET.length === 0) {
    // This should never happen due to startup validation, but defense in depth
    throw new Error("Cannot generate webhook signature: ALT_WEBHOOK_SECRET not configured");
  }
  const payloadString = JSON.stringify(payload);
  return crypto
    .createHmac("sha256", ALT_WEBHOOK_SECRET)
    .update(payloadString)
    .digest("hex");
}

// Rail authentication middleware
function authenticateRailCallback(req: Request, res: Response, next: NextFunction) {
  // Fail fast if RAIL_AUTH_TOKEN is not configured
  if (!RAIL_AUTH_TOKEN || RAIL_AUTH_TOKEN.length === 0) {
    console.error("CRITICAL: RAIL_AUTH_TOKEN not configured but rail callback endpoint called");
    return res.status(500).json({ error: "Server configuration error" });
  }
  
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.warn("Rail callback rejected: missing or invalid Authorization header");
    return res.status(401).json({ error: "Unauthorized" });
  }
  
  const token = authHeader.substring(7);
  
  if (!token || token.length === 0 || token !== RAIL_AUTH_TOKEN) {
    console.warn("Rail callback rejected: invalid token");
    return res.status(401).json({ error: "Unauthorized" });
  }
  
  next();
}

// Authenticate simulation endpoint
function authenticateSimulation(req: Request, res: Response, next: NextFunction) {
  if (!SIMULATION_ENABLED) {
    return res.status(403).json({ error: "simulation_disabled" });
  }
  
  // Fail fast if ADMIN_SIM_TOKEN is not configured
  if (!ADMIN_SIM_TOKEN || ADMIN_SIM_TOKEN.length === 0) {
    console.error("CRITICAL: SIMULATION_ENABLED=true but ADMIN_SIM_TOKEN not configured");
    return res.status(500).json({ error: "Server configuration error" });
  }
  
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  
  const token = authHeader.substring(7);
  
  if (!token || token.length === 0 || token !== ADMIN_SIM_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  
  next();
}

// Authenticate admin operations (privacy, etc.) - works in production independent of simulation
function authenticateAdmin(req: Request, res: Response, next: NextFunction) {
  // Fail fast if ADMIN_SIM_TOKEN is not configured
  if (!ADMIN_SIM_TOKEN || ADMIN_SIM_TOKEN.length === 0) {
    console.error("CRITICAL: ADMIN_SIM_TOKEN not configured for admin operations");
    return res.status(500).json({ error: "Server configuration error" });
  }
  
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  
  const token = authHeader.substring(7);
  
  if (!token || token.length === 0 || token !== ADMIN_SIM_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  
  next();
}

// Authenticate admin API operations (Step 5.3: Security for admin endpoints)
// Uses ADMIN_API_TOKEN for production admin endpoints (viewing invoices, metrics, etc.)
function authenticateAdminApi(req: Request, res: Response, next: NextFunction) {
  // Fail fast if ADMIN_API_TOKEN is not configured
  if (!ADMIN_API_TOKEN || ADMIN_API_TOKEN.length === 0) {
    console.error("CRITICAL: ADMIN_API_TOKEN not configured for admin API operations");
    return res.status(500).json({ error: "Server configuration error" });
  }
  
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  
  const token = authHeader.substring(7);
  
  if (!token || token.length === 0 || token !== ADMIN_API_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  
  next();
}

// ============================================================================
// Payment API Types & Helpers
// ============================================================================

/**
 * Request schema for POST /payments
 */
const createPaymentRequestSchema = z.object({
  rail: z.enum(["BTC", "XMR", "LN"]),
  amount_atomic: z.string()
    .regex(/^\d+$/, "amount_atomic must be a positive integer string")
    .refine((val) => BigInt(val) > 0, {
      message: "amount_atomic must be greater than 0"
    }),
  metadata: z.record(z.any()).optional(),
});

/**
 * Convert API rail name to database currency format
 * API uses "LN", database uses "Lightning"
 */
function railToCurrency(rail: "BTC" | "XMR" | "LN"): "BTC" | "XMR" | "Lightning" {
  return rail === "LN" ? "Lightning" : rail;
}

/**
 * Convert database currency to API rail name
 * Database uses "Lightning", API uses "LN"
 */
function currencyToRail(currency: string): "BTC" | "XMR" | "LN" {
  return currency === "Lightning" ? "LN" : currency as "BTC" | "XMR" | "LN";
}

/**
 * API response format for payments
 * Simpler than CanonicalPayment, focused on client needs
 */
interface PaymentApiResponse {
  id: string;
  rail: "BTC" | "XMR" | "LN";
  asset: "BTC" | "XMR";
  /** Payment address (BTC/XMR) or invoice (LN) */
  address: string;
  amount_atomic: string;
  status: "pending" | "confirming" | "confirmed" | "expired" | "failed";
  confirmations?: number;
  confirmations_required?: number;
  amount_received?: string;
  created_at: string;
  updated_at: string;
  expires_at?: string;
  /** BOLT11 invoice (Lightning only) */
  invoice_bolt11?: string;
}

/**
 * Transform CanonicalPayment to simpler API format
 * 
 * Note: For Lightning payments, includes invoice_bolt11 from database.
 * This is async because it may need to fetch from storage.
 */
async function canonicalToApiResponse(payment: CanonicalPayment): Promise<PaymentApiResponse> {
  // Determine asset from rail
  const asset = payment.currency === "LN" ? "BTC" : payment.currency;
  
  // Base response
  const response: PaymentApiResponse = {
    id: payment.invoiceId,
    rail: payment.currency,
    asset,
    address: payment.paymentAddress,
    amount_atomic: payment.amountAtomic,
    status: payment.status,
    confirmations: payment.confirmations,
    confirmations_required: payment.confirmationsRequired,
    amount_received: payment.amountReceived,
    created_at: payment.createdAt,
    updated_at: payment.updatedAt,
    ...(payment.expiresAt && { expires_at: payment.expiresAt }),
  };
  
  // For Lightning payments, include BOLT11 invoice from database
  if (payment.currency === "LN") {
    const invoice = await storage.getInvoice(payment.invoiceId);
    if (invoice?.bolt11Invoice) {
      response.invoice_bolt11 = invoice.bolt11Invoice;
    }
  }
  
  return response;
}

// Queue a webhook for delivery (creates pending webhook log)
async function queueWebhook(
  invoiceId: string,
  url: string,
  payload: any
): Promise<string> {
  const webhookLog = await storage.createWebhookLog({
    invoiceId,
    url,
    status: "pending",
    attempt: 1,
    retryAfter: new Date(), // Immediate first attempt
  });
  
  console.log(`Webhook queued for invoice ${invoiceId}, will attempt delivery immediately`);
  return webhookLog.id;
}

// Attempt to deliver a single webhook
async function attemptWebhookDelivery(
  webhookLogId: string,
  invoiceId: string,
  url: string,
  payload: any,
  currentAttempt: number
): Promise<boolean> {
  try {
    // Generate HMAC signature for this delivery attempt
    const signature = generateWebhookSignature(payload);
    
    const response = await axios.post(url, payload, {
      timeout: WEBHOOK_TIMEOUT_MS,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Altostratus-Payments/1.0",
        "X-Altostratus-Signature": signature,
      },
      validateStatus: (status) => status < 500, // Don't throw on 4xx
    });

    const success = response.status >= 200 && response.status < 300;

    if (success) {
      // Mark as successful - no retry needed
      await storage.updateWebhookLog(webhookLogId, {
        status: "success",
        statusCode: response.status,
        attempt: currentAttempt,
        lastAttemptAt: new Date(),
        retryAfter: null,
      });
      console.log(`✓ Webhook delivered successfully to ${url} (attempt ${currentAttempt})`);
      
      // Log successful webhook delivery
      monitoring.logWebhookResult(invoiceId, true, response.status);
      
      return true;
    } else {
      // Failed but might retry - INCREMENT attempt counter for next retry
      const nextAttempt = currentAttempt + 1;
      const shouldRetry = nextAttempt <= WEBHOOK_MAX_ATTEMPTS;
      const nextRetryDelay = WEBHOOK_RETRY_DELAYS[Math.min(currentAttempt - 1, WEBHOOK_RETRY_DELAYS.length - 1)];
      const retryAfter = shouldRetry ? new Date(Date.now() + nextRetryDelay) : null;

      await storage.updateWebhookLog(webhookLogId, {
        status: shouldRetry ? "pending" : "failed",
        statusCode: response.status,
        errorMessage: `HTTP ${response.status}`,
        attempt: nextAttempt,
        lastAttemptAt: new Date(),
        retryAfter,
      });

      // Log failed webhook delivery
      if (!shouldRetry) {
        monitoring.logWebhookResult(invoiceId, false, response.status);
      }

      // Silent - webhook status tracked in database
      return false;
    }
  } catch (error: any) {
    const axiosError = error as AxiosError;
    const errorMessage = axiosError.message || "Unknown error";
    const statusCode = axiosError.response?.status;
    
    // Failed with exception - INCREMENT attempt counter for next retry
    const nextAttempt = currentAttempt + 1;
    const shouldRetry = nextAttempt <= WEBHOOK_MAX_ATTEMPTS;
    const nextRetryDelay = WEBHOOK_RETRY_DELAYS[Math.min(currentAttempt - 1, WEBHOOK_RETRY_DELAYS.length - 1)];
    const retryAfter = shouldRetry ? new Date(Date.now() + nextRetryDelay) : null;

    await storage.updateWebhookLog(webhookLogId, {
      status: shouldRetry ? "pending" : "failed",
      statusCode,
      errorMessage,
      attempt: nextAttempt,
      lastAttemptAt: new Date(),
      retryAfter,
    });

    // Log failed webhook delivery
    if (!shouldRetry) {
      monitoring.logWebhookResult(invoiceId, false, statusCode);
    }

    // Silent - webhook status tracked in database
    return false;
  }
}

// Process all pending webhooks in the queue
async function processWebhookQueue(invoicePayloads: Map<string, any>) {
  const pendingWebhooks = await storage.getPendingWebhooks();
  const now = new Date();

  for (const webhook of pendingWebhooks) {
    // Check if it's time to retry
    if (webhook.retryAfter && new Date(webhook.retryAfter) > now) {
      continue; // Not yet time to retry
    }

    // Get the payload for this invoice
    const payload = invoicePayloads.get(webhook.invoiceId);
    if (!payload) {
      console.warn(`No payload found for webhook ${webhook.id}, skipping`);
      continue;
    }

    const attempt = parseInt(webhook.attempt || "1", 10);
    await attemptWebhookDelivery(
      webhook.id,
      webhook.invoiceId,
      webhook.url,
      payload,
      attempt
    );
  }
}

// Clean up old failed webhooks (called periodically)
async function cleanupOldWebhooks() {
  const cutoffDate = new Date(Date.now() - WEBHOOK_MAX_AGE_HOURS * 60 * 60 * 1000);
  const deletedCount = await storage.deleteOldFailedWebhooks(cutoffDate, WEBHOOK_MAX_ATTEMPTS);
  if (deletedCount > 0) {
    console.log(`Cleaned up ${deletedCount} old failed webhook(s)`);
  }
  return deletedCount;
}

// Data retention and privacy cleanup
async function performDataRetentionCleanup() {
  try {
    const results = {
      anonymized: 0,
      deleted: 0,
    };

    // Get all invoices
    const allInvoices = await storage.getAllInvoices();
    const now = new Date();

    for (const invoice of allInvoices) {
      const invoiceAge = (now.getTime() - new Date(invoice.createdAt).getTime()) / (1000 * 60 * 60 * 24);

      // Delete invoices older than RETENTION_MAX_DAYS
      if (invoiceAge > RETENTION_MAX_DAYS) {
        // Note: This would cascade delete related records (webhooks, transactions)
        // For now, we just log - implement actual deletion in storage layer
        console.log(JSON.stringify({
          action: "data_retention",
          invoiceId: invoice.id,
          age_days: Math.floor(invoiceAge),
          decision: "delete_candidate",
        }));
        results.deleted++;
      }
      // Anonymize paid invoices older than RETENTION_PAID_DAYS
      else if (invoice.status === "confirmed" && invoiceAge > RETENTION_PAID_DAYS) {
        // Check if already anonymized (description starts with [Anonymized])
        if (!invoice.description.startsWith("[Anonymized")) {
          // Use salted hash for payment address anonymization
          const salt = crypto.randomBytes(16).toString('hex');
          const hashedAddress = crypto.createHash('sha256')
            .update(invoice.paymentAddress + salt)
            .digest('hex')
            .substring(0, 16);
          
          const anonymized = await storage.updateInvoice(invoice.id, {
            description: `[Anonymized ${Math.floor(invoiceAge)} days old]`,
            paymentAddress: hashedAddress,
          });
          
          if (anonymized) {
            console.log(JSON.stringify({
              action: "data_retention",
              invoiceId: invoice.id,
              age_days: Math.floor(invoiceAge),
              decision: "anonymized",
            }));
            results.anonymized++;
          }
        }
      }
    }

    if (results.anonymized > 0 || results.deleted > 0) {
      console.log(`Data retention cleanup: ${results.anonymized} anonymized, ${results.deleted} marked for deletion`);
    }

    return results;
  } catch (error) {
    // Silent error - cleanup will retry on next interval
    return { anonymized: 0, deleted: 0 };
  }
}

// Note: transactionId (blockchain tx hashes) are stored in paymentTransactions
// but are PUBLIC blockchain data, not PII - safe for long-term storage
// Addresses in invoices are anonymized after 90 days (see above)

// In-memory store for invoice payloads (needed for webhook retries after server restart)
const invoicePayloads = new Map<string, any>();

export async function registerRoutes(app: Express): Promise<Server> {
  // Validate critical security configuration on startup
  const anyRailEnabled = ENABLE_LN || ENABLE_BTC || ENABLE_XMR;
  if (anyRailEnabled && (!RAIL_AUTH_TOKEN || RAIL_AUTH_TOKEN.length === 0)) {
    console.error("╔═══════════════════════════════════════════════════════════╗");
    console.error("║ FATAL: Rail services enabled but RAIL_AUTH_TOKEN not set ║");
    console.error("║ Set RAIL_AUTH_TOKEN in environment before enabling rails ║");
    console.error("╚═══════════════════════════════════════════════════════════╝");
    throw new Error("RAIL_AUTH_TOKEN required when rail services are enabled");
  }
  
  if (SIMULATION_ENABLED && (!ADMIN_SIM_TOKEN || ADMIN_SIM_TOKEN.length === 0)) {
    console.error("╔═══════════════════════════════════════════════════════════╗");
    console.error("║ FATAL: Simulation enabled but ADMIN_SIM_TOKEN not set    ║");
    console.error("║ Set ADMIN_SIM_TOKEN or disable simulation                ║");
    console.error("╚═══════════════════════════════════════════════════════════╝");
    throw new Error("ADMIN_SIM_TOKEN required when SIMULATION_ENABLED=true");
  }
  
  // Validate webhook security configuration
  const webhookUrlConfigured = process.env.ALTOSTRATUS_WEBHOOK_URL && process.env.ALTOSTRATUS_WEBHOOK_URL.length > 0;
  if (webhookUrlConfigured && (!ALT_WEBHOOK_SECRET || ALT_WEBHOOK_SECRET.length === 0)) {
    console.error("╔═══════════════════════════════════════════════════════════╗");
    console.error("║ FATAL: ALTOSTRATUS_WEBHOOK_URL set but ALT_WEBHOOK_SECRET║");
    console.error("║        not configured. Webhooks MUST be signed for       ║");
    console.error("║        security. Set ALT_WEBHOOK_SECRET or remove         ║");
    console.error("║        ALTOSTRATUS_WEBHOOK_URL from environment.          ║");
    console.error("╚═══════════════════════════════════════════════════════════╝");
    throw new Error("ALT_WEBHOOK_SECRET required when ALTOSTRATUS_WEBHOOK_URL is configured");
  }

  // Initialize payment orchestrator
  const orchestrator = getOrchestrator();
  const enabledCurrencies = orchestrator.getEnabledCurrencies();
  console.log(`╔═══════════════════════════════════════════════════════════╗`);
  console.log(`║      Payment Orchestrator Initialized                    ║`);
  console.log(`╠═══════════════════════════════════════════════════════════╣`);
  console.log(`║ Enabled rails: ${enabledCurrencies.length > 0 ? enabledCurrencies.join(", ") : "NONE"}${" ".repeat(Math.max(0, 37 - (enabledCurrencies.length > 0 ? enabledCurrencies.join(", ").length : 4)))}║`);
  console.log(`╚═══════════════════════════════════════════════════════════╝`);
  
  // Log configuration status
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║         Altostratus Payments - Configuration             ║");
  console.log("╠═══════════════════════════════════════════════════════════╣");
  console.log(`║ Lightning:   ${ENABLE_LN ? "✓ ENABLED " : "✗ DISABLED"}                                   ║`);
  console.log(`║ Bitcoin:     ${ENABLE_BTC ? "✓ ENABLED " : "✗ DISABLED"}                                   ║`);
  console.log(`║ Monero:      ${ENABLE_XMR ? "✓ ENABLED " : "✗ DISABLED"}                                   ║`);
  console.log(`║ Simulation:  ${SIMULATION_ENABLED ? "⚠  ENABLED (DEV ONLY)" : "✓ DISABLED"}                         ║`);
  console.log("╚═══════════════════════════════════════════════════════════╝");
  
  // Start periodic webhook processing (every 5 seconds)
  setInterval(async () => {
    await processWebhookQueue(invoicePayloads);
  }, 5000);

  // Periodic invoice expiration check (every 30 seconds)
  setInterval(async () => {
    await storage.checkAndExpireInvoices();
  }, 30 * 1000);

  // Periodic cleanup of old failed webhooks (every hour)
  setInterval(async () => {
    await cleanupOldWebhooks();
  }, 60 * 60 * 1000);

  // Periodic data retention and privacy cleanup (every 24 hours)
  if (AUTO_ANONYMIZE_ENABLED) {
    setInterval(async () => {
      await performDataRetentionCleanup();
    }, 24 * 60 * 60 * 1000);
    
    // Run once on startup (after 1 minute delay)
    setTimeout(async () => {
      await performDataRetentionCleanup();
    }, 60 * 1000);
  }

  // Process any pending webhooks from previous server session on startup
  console.log("Processing any pending webhooks from previous session...");
  setTimeout(async () => {
    // Reconstruct payloads for pending webhooks by fetching invoices
    const pendingWebhooks = await storage.getPendingWebhooks();
    for (const webhook of pendingWebhooks) {
      const invoice = await storage.getInvoice(webhook.invoiceId);
      if (invoice) {
        // Reconstruct the webhook payload
        const transactions = await storage.getPaymentTransactionsByInvoice(webhook.invoiceId);
        const latestTx = transactions[0];
        if (latestTx) {
          invoicePayloads.set(webhook.invoiceId, {
            invoiceId: invoice.id,
            amount: invoice.amount,
            currency: invoice.currency,
            status: invoice.status,
            paidAt: invoice.paidAt,
            transactionId: latestTx.transactionId,
            confirmations: parseInt(latestTx.confirmations, 10),
            blockHeight: latestTx.blockHeight ? parseInt(latestTx.blockHeight, 10) : undefined,
          });
        }
      }
    }
    await processWebhookQueue(invoicePayloads);
  }, 1000);

  // Health check endpoint (Step 3: Fast, no RPC calls, secure)
  // Public endpoint with minimal sensitive data exposure
  app.get("/health", async (req, res) => {
    const timestamp = new Date().toISOString();
    
    // Fast, in-memory health checks only - NO network I/O
    // Read from internal state and monitoring system
    const globalHealth = monitoring.getGlobalHealth();
    const orchestrator = getOrchestrator();
    
    // Lightweight storage check (bounded query, no full table scan)
    let storageStatus: "ok" | "error" = "ok";
    try {
      // Quick check: can we query pending webhooks? (small dataset)
      await storage.getPendingWebhooks();
    } catch (error: any) {
      storageStatus = "error";
    }
    
    // Build response matching exact specification format
    const response: any = {
      status: globalHealth.overall,
      timestamp,
      rails: {
        btc: buildRailHealthResponse("BTC", globalHealth.rails.BTC, orchestrator),
        xmr: buildRailHealthResponse("XMR", globalHealth.rails.XMR, orchestrator),
        ln: buildRailHealthResponse("LN", globalHealth.rails.LN, orchestrator),
      },
    };
    
    // Include storage status if there are issues (degraded/error only)
    if (storageStatus === "error" || globalHealth.overall !== "ok") {
      response.storage = storageStatus;
    }
    
    // HTTP status code based on overall health
    const httpStatus = globalHealth.overall === "error" ? 503 : 200;
    res.status(httpStatus).json(response);
  });
  
  /**
   * Build rail health response for /health endpoint
   * Handles disabled, not_implemented, and health states
   * 
   * Security: No sensitive data (secrets, stack traces, detailed errors)
   */
  function buildRailHealthResponse(
    rail: "BTC" | "XMR" | "LN",
    health: ReturnType<typeof monitoring.getRailHealth>,
    orchestrator: ReturnType<typeof getOrchestrator>
  ): any {
    const currency = rail as PaymentCurrency;
    const enabled = orchestrator.isCurrencyEnabled(currency);
    
    // If rail is not enabled, return minimal disabled status
    if (!enabled) {
      return {
        status: "disabled",
        reason: `${rail} rail is not enabled (ENABLE_${rail}=false)`,
      };
    }
    
    // For Lightning Network, check if it's in stub/not_implemented mode
    if (rail === "LN") {
      const lnServiceUrl = process.env.LN_SERVICE_URL || "";
      if (!lnServiceUrl) {
        return {
          status: "not_implemented",
          reason: "ln_not_implemented",
          message: "Lightning Network service not configured (LN_SERVICE_URL not set)",
          health: {
            last_successful_poll_at: health.lastSuccessfulPollAt,
            last_poll_error_at: health.lastPollErrorAt,
            consecutive_poll_failures: health.consecutivePollFailures,
          },
        };
      }
    }
    
    // Normal rail with health tracking
    return {
      status: health.status,
      last_successful_poll_at: health.lastSuccessfulPollAt,
      last_poll_error_at: health.lastPollErrorAt,
      consecutive_poll_failures: health.consecutivePollFailures,
      last_payment_confirmed_at: health.lastPaymentConfirmedAt,
    };
  }

  // Monitoring metrics endpoint
  app.get("/metrics", (req, res) => {
    const metrics = monitoring.getMetrics();
    res.json(metrics);
  });

  // ============================================================================
  // Admin Endpoints (Step 5: Admin / Ops View - Invoices)
  // ============================================================================
  
  /**
   * GET /admin/invoices - List all invoices with filtering (Step 5.1: Admin endpoint basics)
   * 
   * Protected by ADMIN_API_TOKEN for security (Step 5.3)
   * 
   * Query params:
   * - rail: Filter by rail (btc, xmr, ln)
   * - status: Filter by status (pending, confirmed, expired, failed)
   * - created_after: ISO 8601 timestamp
   * - created_before: ISO 8601 timestamp
   * - limit: Max results (default: 100, max: 1000)
   * - offset: Pagination offset (default: 0)
   * 
   * Response:
   * - invoices: Array of invoice objects (Step 5.2: Invoice list view)
   * - total: Total count matching filters
   * - limit: Applied limit
   * - offset: Applied offset
   */
  app.get("/admin/invoices", authenticateAdminApi, async (req, res) => {
    try {
      // Parse and validate query parameters
      const rail = req.query.rail as string | undefined;
      const status = req.query.status as string | undefined;
      const created_after = req.query.created_after as string | undefined;
      const created_before = req.query.created_before as string | undefined;
      const limitParam = req.query.limit as string | undefined;
      const offsetParam = req.query.offset as string | undefined;
      
      // Validate rail param
      if (rail && !["btc", "xmr", "ln"].includes(rail.toLowerCase())) {
        return res.status(400).json({
          error: "invalid_rail",
          message: "rail must be one of: btc, xmr, ln"
        });
      }
      
      // Validate status param
      if (status && !["pending", "confirmed", "expired", "failed", "confirming"].includes(status.toLowerCase())) {
        return res.status(400).json({
          error: "invalid_status",
          message: "status must be one of: pending, confirming, confirmed, expired, failed"
        });
      }
      
      // Parse pagination params
      const limit = Math.min(
        parseInt(limitParam || "100", 10) || 100,
        1000 // Max 1000 results per page
      );
      const offset = parseInt(offsetParam || "0", 10) || 0;
      
      // Get all invoices (we'll filter in memory for MVP)
      // In production, this should use database queries with WHERE clauses
      let invoices = await storage.listInvoices();
      
      // Apply filters
      if (rail) {
        const dbCurrency = railToCurrency(rail.toUpperCase() as "BTC" | "XMR" | "LN");
        invoices = invoices.filter(inv => inv.currency === dbCurrency);
      }
      
      if (status) {
        invoices = invoices.filter(inv => inv.status.toLowerCase() === status.toLowerCase());
      }
      
      if (created_after) {
        const afterDate = new Date(created_after);
        if (isNaN(afterDate.getTime())) {
          return res.status(400).json({
            error: "invalid_date",
            message: "created_after must be a valid ISO 8601 timestamp"
          });
        }
        invoices = invoices.filter(inv => new Date(inv.createdAt) >= afterDate);
      }
      
      if (created_before) {
        const beforeDate = new Date(created_before);
        if (isNaN(beforeDate.getTime())) {
          return res.status(400).json({
            error: "invalid_date",
            message: "created_before must be a valid ISO 8601 timestamp"
          });
        }
        invoices = invoices.filter(inv => new Date(inv.createdAt) <= beforeDate);
      }
      
      // Sort by creation date (newest first)
      invoices.sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      
      const total = invoices.length;
      
      // Apply pagination
      const paginatedInvoices = invoices.slice(offset, offset + limit);
      
      // Format response (Step 5.2: Invoice list view)
      const formattedInvoices = paginatedInvoices.map(inv => {
        const rail = currencyToRail(inv.currency);
        
        const result: any = {
          id: inv.id,
          rail: rail.toLowerCase(),
          asset: inv.asset,
          amount_atomic: inv.amount,
          status: inv.status,
          created_at: inv.createdAt,
          updated_at: inv.updatedAt,
        };
        
        // Include address for BTC/XMR
        if (rail === "BTC" || rail === "XMR") {
          result.address = inv.paymentAddress;
        }
        
        // Include BOLT11 invoice for Lightning (can be truncated in UI)
        if (rail === "LN" && inv.bolt11Invoice) {
          result.invoice_bolt11 = inv.bolt11Invoice;
        }
        
        // Include additional useful fields
        if (inv.paidAt) {
          result.paid_at = inv.paidAt;
        }
        if (inv.expiresAt) {
          result.expires_at = inv.expiresAt;
        }
        if (inv.amountPaidAtomic) {
          result.amount_paid_atomic = inv.amountPaidAtomic;
        }
        
        return result;
      });
      
      res.json({
        invoices: formattedInvoices,
        total,
        limit,
        offset,
      });
    } catch (error: any) {
      console.error("Error fetching admin invoices:", error);
      res.status(500).json({
        error: "internal_error",
        message: "Failed to fetch invoices"
      });
    }
  });

  // ============================================================================
  // Payment API Endpoints (Rail-Agnostic Client Interface)
  // ============================================================================
  
  /**
   * POST /payments - Create a new payment
   * 
   * Clean, rail-agnostic API for Altostratus apps and external clients.
   * Protected by RAIL_AUTH_TOKEN.
   * 
   * Request: { rail, amount_atomic, metadata? }
   * Response: { id, rail, asset, address, amount_atomic, status, ... }
   */
  app.post("/payments", authenticateRailCallback, async (req, res) => {
    try {
      // Validate request
      const validated = createPaymentRequestSchema.parse(req.body);
      const { rail, amount_atomic, metadata } = validated;
      
      // Get orchestrator
      const orchestrator = getOrchestrator();
      
      // Check if rail is enabled
      if (!orchestrator.isCurrencyEnabled(rail)) {
        return res.status(400).json({ 
          error: "rail_disabled",
          message: `Payment rail ${rail} is not enabled on this server`
        });
      }
      
      // Create invoice first (generates ID, stores with placeholder address)
      // Note: Database uses "Lightning", API uses "LN"
      // Compute asset from rail: LN → BTC, others map directly
      const asset = rail === "LN" ? "BTC" : rail;
      
      const invoice = await storage.createInvoice({
        amount: amount_atomic,
        currency: railToCurrency(rail),
        asset,
        paymentAddress: "pending", // Placeholder, will be updated
        description: metadata?.description || `Payment via ${rail}`,
      });
      
      // Create payment address via orchestrator
      const payment = await orchestrator.createPayment(rail, {
        invoiceId: invoice.id,
        amountAtomic: amount_atomic,
      });
      
      // Update invoice with real payment address
      await storage.updateInvoice(invoice.id, {
        paymentAddress: payment.paymentAddress,
        ...(payment.expiresAt && { expiresAt: new Date(payment.expiresAt) }),
      });
      
      // Update invoice with BOLT11 for Lightning payments
      if (rail === "LN" && payment.paymentAddress) {
        await storage.updateInvoice(invoice.id, {
          bolt11Invoice: payment.paymentAddress,
        });
      }
      
      // Update payment with final invoice ID for response
      payment.invoiceId = invoice.id;
      
      // Transform to API response format
      const apiResponse = await canonicalToApiResponse(payment);
      
      // Note: monitoring.logPaymentCreated() already called by orchestrator
      // This is additional structured logging for the HTTP layer
      console.log(JSON.stringify({
        event: "payment.created",
        rail,
        id: invoice.id,
        amount_atomic: amount_atomic,
      }));
      
      res.status(201).json(apiResponse);
      
    } catch (error: any) {
      console.error(JSON.stringify({
        event: "payment.error",
        error: error.message,
        context: "payment_creation",
      }));
      
      // Handle validation errors
      if (error.name === "ZodError") {
        return res.status(400).json({ 
          error: "validation_failed",
          details: error.errors 
        });
      }
      
      // Handle RailUnavailableError (e.g., LN not configured)
      if (error.code === "RAIL_UNAVAILABLE") {
        // Extract specific error reason (e.g., "ln_not_implemented")
        const errorCode = error.details?.reason || "rail_unavailable";
        const rail = error.details?.currency || req.body?.rail;
        
        return res.status(503).json({ 
          error: errorCode,
          rail: rail?.toLowerCase(),
          message: error.message
        });
      }
      
      // Handle unsupported currency
      if (error.code === "UNSUPPORTED_CURRENCY") {
        return res.status(400).json({ 
          error: "unsupported_currency",
          rail: error.details?.currency?.toLowerCase(),
          message: error.message
        });
      }
      
      // Generic error
      res.status(500).json({ 
        error: "payment_creation_failed",
        message: "Failed to create payment" 
      });
    }
  });
  
  /**
   * GET /payments/:id - Get payment status
   * 
   * Returns normalized status regardless of rail (BTC, XMR, LN).
   * Protected by RAIL_AUTH_TOKEN.
   * 
   * Response: { id, rail, asset, address, amount_atomic, status, ... }
   */
  app.get("/payments/:id", authenticateRailCallback, async (req, res) => {
    try {
      const paymentId = req.params.id;
      
      // Get orchestrator
      const orchestrator = getOrchestrator();
      
      // First, get the invoice from storage to determine the rail
      const invoice = await storage.getInvoice(paymentId);
      if (!invoice) {
        return res.status(404).json({ 
          error: "payment_not_found",
          message: `Payment ${paymentId} not found`
        });
      }
      
      // Get payment status via orchestrator
      const payment = await orchestrator.getPaymentStatus(
        currencyToRail(invoice.currency),
        paymentId
      );
      
      // Transform to API response format
      const apiResponse = await canonicalToApiResponse(payment);
      
      res.json(apiResponse);
      
    } catch (error: any) {
      console.error(JSON.stringify({
        event: "payment.error",
        id: req.params.id,
        error: error.message,
        context: "status_fetch",
      }));
      
      if (error.message?.includes("not found")) {
        return res.status(404).json({ 
          error: "payment_not_found",
          message: error.message 
        });
      }
      
      res.status(500).json({ 
        error: "status_fetch_failed",
        message: "Failed to fetch payment status" 
      });
    }
  });

  // ============================================================================
  // Legacy Invoice Endpoints (Deprecated - Use /payments instead)
  // ============================================================================
  
  // Get all invoices
  app.get("/api/invoices", async (req, res) => {
    try {
      await storage.checkAndExpireInvoices();
      const invoices = await storage.getAllInvoices();
      res.json(invoices);
    } catch (error: any) {
      // Silent error - endpoint returns 500 to client
      res.status(500).json({ error: "Failed to fetch invoices" });
    }
  });

  // Get invoice by ID
  app.get("/api/invoices/:id", async (req, res) => {
    try {
      await storage.checkAndExpireInvoices();
      const invoice = await storage.getInvoice(req.params.id);
      if (!invoice) {
        return res.status(404).json({ error: "Invoice not found" });
      }
      res.json(invoice);
    } catch (error: any) {
      // Silent error - endpoint returns 500 to client
      res.status(500).json({ error: "Failed to fetch invoice" });
    }
  });

  // Create new invoice (using unified payment orchestrator)
  app.post("/api/invoices", createInvoiceLimiter, async (req, res) => {
    try {
      const validatedData = insertInvoiceSchema.parse(req.body);
      
      // Map currency names to orchestrator format
      const currencyMap: Record<string, "BTC" | "XMR" | "LN"> = {
        "BTC": "BTC",
        "XMR": "XMR",
        "Lightning": "LN",
      };
      const currency = currencyMap[validatedData.currency];
      
      if (!currency) {
        return res.status(400).json({ 
          error: "unsupported_currency",
          message: `Currency ${validatedData.currency} is not supported`
        });
      }

      // Check if currency is enabled via orchestrator
      if (!orchestrator.isCurrencyEnabled(currency)) {
        return res.status(400).json({ 
          error: "rail_disabled",
          message: `${validatedData.currency} payments are currently disabled`
        });
      }
      
      // Create invoice first (will have placeholder address)
      const invoice = await storage.createInvoice(validatedData);
      
      // Get payment address from orchestrator
      try {
        const paymentRequest = {
          invoiceId: invoice.id,
          amountAtomic: invoice.amount,
        };

        const payment = await orchestrator.createPayment(currency, paymentRequest);

        // Update invoice with real payment address
        await storage.updateInvoice(invoice.id, {
          paymentAddress: payment.paymentAddress,
        });
        invoice.paymentAddress = payment.paymentAddress;
        
        console.log(JSON.stringify({
          invoiceId: invoice.id,
          rail: currency.toLowerCase(),
          event: "address_created"
        }));
      } catch (error: any) {
        // Handle orchestrator errors
        if (error.code === "RAIL_UNAVAILABLE") {
          // Log internally but don't expose details to client
          console.error({
            event: "rail_unavailable",
            currency,
            invoiceId: invoice.id,
            error: error.message,
          });
          
          return res.status(503).json({ 
            error: "rail_unavailable",
            message: `Payment rail ${currency} is temporarily unavailable`
          });
        }
        
        // Silent error - address derivation failed (log internally, generic to client)
        console.error({
          event: "address_generation_failed",
          currency,
          invoiceId: invoice.id,
          error: error.message,
        });
        
        return res.status(500).json({ 
          error: "address_generation_failed",
          message: "Failed to generate payment address"
        });
      }
      
      console.log(JSON.stringify({
        invoiceId: invoice.id,
        rail: currency.toLowerCase(),
        event: "invoice_created"
      }));
      res.status(201).json(invoice);
    } catch (error: any) {
      if (error.name === "ZodError") {
        // Silent error - validation failed (returned to client)
        return res.status(400).json({ 
          error: "Invalid invoice data", 
          details: error.errors 
        });
      }
      // Silent error - invoice creation failed (operational detail)
      res.status(500).json({ error: "Failed to create invoice" });
    }
  });

  // Rail callback endpoints (authenticated with RAIL_AUTH_TOKEN)
  app.post("/api/rails/ln/settled", authenticateRailCallback, async (req, res) => {
    try {
      const { invoiceId, transactionId, confirmations } = paymentConfirmationSchema.parse(req.body);
      
      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice) {
        console.log(JSON.stringify({ invoiceId, rail: "ln", event: "settled", status: "not_found" }));
        return res.status(404).json({ error: "Invoice not found" });
      }

      // Idempotent: ignore if already paid
      if (invoice.status === "confirmed") {
        console.log(JSON.stringify({ invoiceId, rail: "ln", event: "settled", status: "already_paid" }));
        return res.json({ message: "Invoice already paid" });
      }

      // Idempotent: ignore if expired
      if (invoice.status === "expired" || (invoice.expiresAt && new Date(invoice.expiresAt) <= new Date())) {
        console.log(JSON.stringify({ invoiceId, rail: "ln", event: "settled", status: "expired" }));
        return res.status(400).json({ error: "Invoice has expired" });
      }

      await storage.createPaymentTransaction({
        invoiceId,
        rail: "ln",
        transactionId,
        confirmations,
      });

      await storage.updateInvoiceStatus(invoiceId, "confirmed", new Date());
      
      // Log payment confirmation with transaction details
      console.log(JSON.stringify({ 
        rail: "ln", 
        event: "payment.confirmed", 
        id: invoiceId,
        tx_hash: transactionId,
        confirmations: confirmations 
      }));
      
      // Log to monitoring system
      monitoring.logPaymentStatus("LN", invoiceId, "confirmed");
      
      const altWebhookUrl = process.env.ALTOSTRATUS_WEBHOOK_URL;
      if (altWebhookUrl) {
        const updatedInvoice = await storage.getInvoice(invoiceId);
        const payload = {
          invoiceId: updatedInvoice!.id,
          status: "confirmed",
          amount: updatedInvoice!.amount,
          currency: updatedInvoice!.currency,
          timestamp: new Date().toISOString(),
        };
        
        invoicePayloads.set(invoiceId, payload);
        await queueWebhook(invoiceId, altWebhookUrl, payload);
      }

      res.json({ success: true });
    } catch (error: any) {
      // Silent error - endpoint returns error to rail service
      res.status(500).json({ error: "Lightning settlement processing failed" });
    }
  });

  app.post("/api/rails/btc/confirmed", authenticateRailCallback, async (req, res) => {
    try {
      const { invoiceId, transactionId, confirmations, blockHeight } = paymentConfirmationSchema.parse(req.body);
      
      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice) {
        console.log(JSON.stringify({ invoiceId, rail: "btc", event: "confirmed", status: "not_found" }));
        return res.status(404).json({ error: "Invoice not found" });
      }

      // Idempotent: ignore if already paid
      if (invoice.status === "confirmed") {
        console.log(JSON.stringify({ invoiceId, rail: "btc", event: "confirmed", status: "already_paid" }));
        return res.json({ message: "Invoice already paid" });
      }

      // Idempotent: ignore if expired
      if (invoice.status === "expired" || (invoice.expiresAt && new Date(invoice.expiresAt) <= new Date())) {
        console.log(JSON.stringify({ invoiceId, rail: "btc", event: "confirmed", status: "expired" }));
        return res.status(400).json({ error: "Invoice has expired" });
      }

      await storage.createPaymentTransaction({
        invoiceId,
        rail: "btc",
        transactionId,
        confirmations,
        blockHeight,
      });

      await storage.updateInvoiceStatus(invoiceId, "confirmed", new Date());
      
      // Log payment confirmation with transaction details
      console.log(JSON.stringify({ 
        rail: "btc", 
        event: "payment.confirmed", 
        id: invoiceId,
        tx_hash: transactionId,
        confirmations: confirmations,
        block_height: blockHeight
      }));
      
      // Log to monitoring system
      monitoring.logPaymentStatus("BTC", invoiceId, "confirmed");
      
      const altWebhookUrl = process.env.ALTOSTRATUS_WEBHOOK_URL;
      if (altWebhookUrl) {
        const updatedInvoice = await storage.getInvoice(invoiceId);
        const payload = {
          invoiceId: updatedInvoice!.id,
          status: "confirmed",
          amount: updatedInvoice!.amount,
          currency: updatedInvoice!.currency,
          timestamp: new Date().toISOString(),
        };
        
        invoicePayloads.set(invoiceId, payload);
        await queueWebhook(invoiceId, altWebhookUrl, payload);
      }

      res.json({ success: true });
    } catch (error: any) {
      // Silent error - endpoint returns error to rail service
      res.status(500).json({ error: "Bitcoin confirmation processing failed" });
    }
  });

  app.post("/api/rails/xmr/confirmed", authenticateRailCallback, async (req, res) => {
    try {
      const { invoiceId, transactionId, confirmations, blockHeight } = paymentConfirmationSchema.parse(req.body);
      
      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice) {
        console.log(JSON.stringify({ invoiceId, rail: "xmr", event: "confirmed", status: "not_found" }));
        return res.status(404).json({ error: "Invoice not found" });
      }

      // Idempotent: ignore if already paid
      if (invoice.status === "confirmed") {
        console.log(JSON.stringify({ invoiceId, rail: "xmr", event: "confirmed", status: "already_paid" }));
        return res.json({ message: "Invoice already paid" });
      }

      // Idempotent: ignore if expired
      if (invoice.status === "expired" || (invoice.expiresAt && new Date(invoice.expiresAt) <= new Date())) {
        console.log(JSON.stringify({ invoiceId, rail: "xmr", event: "confirmed", status: "expired" }));
        return res.status(400).json({ error: "Invoice has expired" });
      }

      await storage.createPaymentTransaction({
        invoiceId,
        rail: "xmr",
        transactionId,
        confirmations,
        blockHeight,
      });

      await storage.updateInvoiceStatus(invoiceId, "confirmed", new Date());
      
      // Log payment confirmation with transaction details
      console.log(JSON.stringify({ 
        rail: "xmr", 
        event: "payment.confirmed", 
        id: invoiceId,
        tx_hash: transactionId,
        confirmations: confirmations,
        block_height: blockHeight
      }));
      
      // Log to monitoring system
      monitoring.logPaymentStatus("XMR", invoiceId, "confirmed");
      
      const altWebhookUrl = process.env.ALTOSTRATUS_WEBHOOK_URL;
      if (altWebhookUrl) {
        const updatedInvoice = await storage.getInvoice(invoiceId);
        const payload = {
          invoiceId: updatedInvoice!.id,
          status: "confirmed",
          amount: updatedInvoice!.amount,
          currency: updatedInvoice!.currency,
          timestamp: new Date().toISOString(),
        };
        
        invoicePayloads.set(invoiceId, payload);
        await queueWebhook(invoiceId, altWebhookUrl, payload);
      }

      res.json({ success: true });
    } catch (error: any) {
      // Silent error - endpoint returns error to rail service
      res.status(500).json({ error: "Monero confirmation processing failed" });
    }
  });

  // Webhook endpoint - receives payment confirmations from blockchain listeners (legacy/direct)
  app.post("/api/webhooks/payment-confirmed", async (req, res) => {
    try {
      // Validate incoming webhook payload with strict schema
      const validatedPayload = paymentConfirmationSchema.parse(req.body);
      const { invoiceId, transactionId, confirmations, blockHeight } = validatedPayload;

      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice) {
        console.warn(`Webhook received for non-existent invoice: ${invoiceId}`);
        return res.status(404).json({ error: "Invoice not found" });
      }

      if (invoice.status === "confirmed") {
        console.log(`Invoice ${invoiceId} already paid, skipping`);
        return res.json({ message: "Invoice already paid" });
      }

      // Prevent payment of expired invoices - each payment must create new invoice
      if (invoice.status === "expired") {
        console.warn(`Payment attempt rejected for expired invoice: ${invoiceId}`);
        return res.status(400).json({ 
          error: "Invoice has expired",
          message: "This invoice has expired. Please create a new invoice to make a payment."
        });
      }

      // Double-check expiration even if status not yet updated
      if (invoice.expiresAt && new Date(invoice.expiresAt) <= new Date()) {
        console.warn(`Payment attempt rejected for expired invoice (past expiresAt): ${invoiceId}`);
        // Update the status to expired
        await storage.updateInvoiceStatus(invoiceId, "expired");
        return res.status(400).json({ 
          error: "Invoice has expired",
          message: "This invoice has expired. Please create a new invoice to make a payment."
        });
      }

      // Store payment transaction details
      // Note: Simulation endpoint - rail inferred from invoice currency
      const rail = invoice.currency === "Lightning" ? "ln" : invoice.currency === "BTC" ? "btc" : "xmr";
      await storage.createPaymentTransaction({
        invoiceId,
        rail,
        transactionId,
        confirmations,
        blockHeight,
      });

      // Update invoice status to paid
      const updatedInvoice = await storage.updateInvoiceStatus(
        invoiceId,
        "paid",
        new Date()
      );

      console.log(JSON.stringify({ invoiceId, rail: "xmr", event: "confirmed", status: "confirmed" }));

      // Queue webhook to main Altostratus app if configured
      const altostratusWebhookUrl = process.env.ALTOSTRATUS_WEBHOOK_URL;
      
      if (altostratusWebhookUrl && updatedInvoice) {
        const webhookPayload = {
          invoiceId: updatedInvoice.id,
          status: updatedInvoice.status,
          amount: updatedInvoice.amount,
          currency: updatedInvoice.currency,
          timestamp: new Date().toISOString(),
        };

        // Store payload for persistent retries
        invoicePayloads.set(invoiceId, webhookPayload);

        // Queue the webhook for delivery (will be processed by periodic worker)
        await queueWebhook(invoiceId, altostratusWebhookUrl, webhookPayload);
        
        // Attempt immediate delivery (don't wait for periodic processing)
        const webhooks = await storage.getPendingWebhooks();
        const thisWebhook = webhooks.find(w => w.invoiceId === invoiceId);
        if (thisWebhook) {
          const attempt = parseInt(thisWebhook.attempt || "1", 10);
          await attemptWebhookDelivery(
            thisWebhook.id,
            invoiceId,
            altostratusWebhookUrl,
            webhookPayload,
            attempt
          );
        }
      } else if (!altostratusWebhookUrl) {
        console.log(`No ALTOSTRATUS_WEBHOOK_URL configured, skipping outbound webhook`);
      }

      res.json({
        success: true,
        message: "Payment confirmed and processed",
        invoice: updatedInvoice,
        transactionId,
      });
    } catch (error: any) {
      if (error.name === "ZodError") {
        // Silent error - validation failed (returned to client)
        return res.status(400).json({ 
          error: "Invalid payment confirmation data", 
          details: error.errors 
        });
      }
      // Silent error - payment processing failed (operational detail)
      res.status(500).json({ error: "Payment confirmation failed" });
    }
  });

  // Get webhook logs for an invoice
  app.get("/api/invoices/:id/webhook-logs", async (req, res) => {
    try {
      const logs = await storage.getWebhookLogsByInvoice(req.params.id);
      res.json(logs);
    } catch (error: any) {
      // Silent error - endpoint returns 500 to client
      res.status(500).json({ error: "Failed to fetch webhook logs" });
    }
  });

  // Get payment transactions for an invoice
  app.get("/api/invoices/:id/transactions", async (req, res) => {
    try {
      const transactions = await storage.getPaymentTransactionsByInvoice(req.params.id);
      res.json(transactions);
    } catch (error: any) {
      // Silent error - endpoint returns 500 to client
      res.status(500).json({ error: "Failed to fetch payment transactions" });
    }
  });

  // Check and expire invoices (can be called by external scheduler/cron)
  app.post("/api/invoices/check-expired", async (req, res) => {
    try {
      const expiredCount = await storage.checkAndExpireInvoices();
      console.log(`✓ Expiration check completed: ${expiredCount} invoice(s) expired`);
      res.json({
        success: true,
        expiredCount,
        message: `${expiredCount} invoice(s) expired`,
      });
    } catch (error: any) {
      // Silent error - endpoint returns error to caller
      res.status(500).json({ error: "Failed to check expired invoices" });
    }
  });

  // Cleanup old expired invoices (can be called by external scheduler/cron)
  app.post("/api/invoices/cleanup", async (req, res) => {
    try {
      // Enforce 30-90 day retention window
      const requestedDays = req.body.daysOld || CLEANUP_EXPIRED_DAYS;
      const daysOld = Math.max(30, Math.min(90, requestedDays));
      
      if (requestedDays !== daysOld) {
        console.warn(`Cleanup daysOld adjusted from ${requestedDays} to ${daysOld} (must be 30-90)`);
      }
      
      const purgedCount = await storage.purgeExpiredInvoices(daysOld);
      console.log(`✓ Cleanup completed: ${purgedCount} expired invoice(s) purged (older than ${daysOld} days)`);
      res.json({
        success: true,
        purgedCount,
        daysOld,
        message: `${purgedCount} expired invoice(s) purged`,
      });
    } catch (error: any) {
      // Silent error - endpoint returns error to caller
      res.status(500).json({ error: "Failed to purge expired invoices" });
    }
  });

  // Process pending webhooks manually (can be called by external scheduler)
  app.post("/api/webhooks/process-queue", async (req, res) => {
    try {
      await processWebhookQueue(invoicePayloads);
      const pendingCount = (await storage.getPendingWebhooks()).length;
      res.json({
        success: true,
        pendingCount,
        message: `Webhook queue processed, ${pendingCount} still pending`,
      });
    } catch (error: any) {
      // Silent error - endpoint returns error to caller
      res.status(500).json({ error: "Failed to process webhook queue" });
    }
  });

  // Cleanup old failed webhooks manually (can be called by external scheduler)
  app.post("/api/webhooks/cleanup", async (req, res) => {
    try {
      const deletedCount = await cleanupOldWebhooks();
      res.json({
        success: true,
        deletedCount,
        message: `${deletedCount} old failed webhook(s) cleaned up`,
      });
    } catch (error: any) {
      // Silent error - endpoint returns error to caller
      res.status(500).json({ error: "Failed to clean up webhooks" });
    }
  });

  // Template CRUD operations
  app.get("/api/templates", async (req, res) => {
    try {
      const templates = await storage.getAllTemplates();
      res.json(templates);
    } catch (error: any) {
      // Silent error - endpoint returns 500 to client
      res.status(500).json({ error: "Failed to fetch templates" });
    }
  });

  app.get("/api/templates/:id", async (req, res) => {
    try {
      const template = await storage.getTemplate(req.params.id);
      if (!template) {
        return res.status(404).json({ error: "Template not found" });
      }
      res.json(template);
    } catch (error: any) {
      // Silent error - endpoint returns 500 to client
      res.status(500).json({ error: "Failed to fetch template" });
    }
  });

  app.post("/api/templates", async (req, res) => {
    try {
      const validatedData = insertTemplateSchema.parse(req.body);
      const template = await storage.createTemplate(validatedData);
      console.log(`✓ Template created: ${template.id} - ${template.planName}`);
      res.status(201).json(template);
    } catch (error: any) {
      if (error.name === "ZodError") {
        // Silent error - validation failed (returned to client)
        return res.status(400).json({ 
          error: "Invalid template data", 
          details: error.errors 
        });
      }
      // Silent error - endpoint returns error to client
      res.status(500).json({ error: "Failed to create template" });
    }
  });

  app.patch("/api/templates/:id", async (req, res) => {
    try {
      const validatedData = insertTemplateSchema.partial().parse(req.body);
      const template = await storage.updateTemplate(req.params.id, validatedData);
      if (!template) {
        return res.status(404).json({ error: "Template not found" });
      }
      console.log(`✓ Template updated: ${template.id}`);
      res.json(template);
    } catch (error: any) {
      if (error.name === "ZodError") {
        // Silent error - validation failed (returned to client)
        return res.status(400).json({ 
          error: "Invalid template data", 
          details: error.errors 
        });
      }
      // Silent error - endpoint returns error to client
      res.status(500).json({ error: "Failed to update template" });
    }
  });

  app.delete("/api/templates/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteTemplate(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Template not found" });
      }
      console.log(`✓ Template deleted: ${req.params.id}`);
      res.json({ success: true });
    } catch (error: any) {
      // Silent error - endpoint returns error to client
      res.status(500).json({ error: "Failed to delete template" });
    }
  });

  // Simulate payment confirmation (for testing only - disabled in production)
  app.post("/api/invoices/:id/simulate-payment", simulationLimiter, authenticateSimulation, async (req, res) => {
    try {
      const invoice = await storage.getInvoice(req.params.id);
      if (!invoice) {
        return res.status(404).json({ error: "Invoice not found" });
      }

      if (invoice.status === "confirmed") {
        // Block simulation if already paid by a real rail
        if (invoice.paymentSource && invoice.paymentSource !== "simulate") {
          return res.status(400).json({ 
            error: "Invoice already paid via real rail",
            message: "Cannot simulate payment on invoice paid by real blockchain listener"
          });
        }
        return res.json({ message: "Invoice already paid" });
      }

      if (invoice.status === "expired") {
        return res.status(400).json({ error: "Invoice has expired" });
      }

      // Mark invoice with simulation source before processing
      await storage.updateInvoice(invoice.id, { paymentSource: "simulate" });

      // Simulate receiving a properly validated webhook from blockchain listener
      const simulatedWebhookPayload = {
        invoiceId: invoice.id,
        transactionId: `simulated_tx_${Date.now()}`,
        confirmations: 6,
        blockHeight: Math.floor(Math.random() * 1000000),
      };

      console.log(JSON.stringify({ invoiceId: invoice.id, action: "simulate_payment", source: "simulate" }));

      // Call our own webhook endpoint
      const response = await axios.post(
        `http://localhost:${process.env.PORT || 5000}/api/webhooks/payment-confirmed`,
        simulatedWebhookPayload,
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      res.json({
        message: "Payment simulated successfully",
        result: response.data,
      });
    } catch (error: any) {
      // Silent error - endpoint returns error to client
      res.status(500).json({ error: "Failed to simulate payment" });
    }
  });

  // Privacy endpoint: Manual invoice anonymization (GDPR compliance)
  // Requires admin authentication to prevent unauthorized data manipulation
  // Uses authenticateAdmin (not authenticateSimulation) so it works in production
  app.post("/api/privacy/anonymize/:id", authenticateAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const invoice = await storage.getInvoice(id);
      
      if (!invoice) {
        return res.status(404).json({ error: "Invoice not found" });
      }

      // Only allow anonymization of paid or expired invoices (protect active pending invoices)
      if (invoice.status !== "confirmed" && invoice.status !== "expired") {
        return res.status(400).json({
          error: "Invalid invoice status",
          message: "Only paid or expired invoices can be anonymized"
        });
      }

      // Check if already anonymized
      if (invoice.description.startsWith("[Anonymized")) {
        return res.json({
          success: true,
          message: "Invoice already anonymized",
          invoice,
        });
      }

      // Use salted hash for payment address anonymization
      const salt = crypto.randomBytes(16).toString('hex');
      const hashedAddress = crypto.createHash('sha256')
        .update(invoice.paymentAddress + salt)
        .digest('hex')
        .substring(0, 16);
      
      const invoiceAge = Math.floor((Date.now() - new Date(invoice.createdAt).getTime()) / (1000 * 60 * 60 * 24));
      
      const anonymized = await storage.updateInvoice(id, {
        description: `[Anonymized at user request - ${invoiceAge} days old]`,
        paymentAddress: hashedAddress,
      });

      console.log(JSON.stringify({
        action: "privacy_request",
        invoiceId: id,
        age_days: invoiceAge,
        decision: "anonymized",
        trigger: "manual",
      }));

      res.json({
        success: true,
        message: "Invoice anonymized successfully",
        invoice: anonymized,
      });
    } catch (error: any) {
      // Silent error - endpoint returns error to client
      res.status(500).json({ error: "Failed to anonymize invoice" });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
