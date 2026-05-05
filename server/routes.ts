import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertInvoiceSchema, insertTemplateSchema, insertFeePolicySchema, paymentConfirmationSchema, type Invoice, type FeePolicy } from "@shared/schema";
import { paymentConfirmationSchema as legacyPaymentConfirmationSchema } from "@shared/webhook-schema";
import axios, { AxiosError } from "axios";
import crypto, { randomUUID } from "crypto";
import rateLimit from "express-rate-limit";
import { getOrchestrator } from "./payment-orchestrator";
import { PaymentCurrency, type CanonicalPayment } from "@shared/payment-orchestrator";
import { z } from "zod";
import * as monitoring from "./monitoring";
import { confirmLightningPayment } from "./ln-payment-handler";
import { forwardLnFee, markFeeAccumulated, checkAndCreateSettlements, checkOverdueSettlements, getOperatorConfig, retryPendingLnForwards } from "./fee-forwarding";
import { createLNbitsClient, type LNbitsClient } from "./lnbitsClient";

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
// Exponential backoff: 1s, 3s, 9s, 27s, 60s, 2m, 5m, 10m, 30m, 1hr
// First 3 are overridable via env; beyond that the schedule is fixed
const WEBHOOK_RETRY_DELAY_1 = parseIntWithDefault(process.env.WEBHOOK_RETRY_DELAY_1, 1000);
const WEBHOOK_RETRY_DELAY_2 = parseIntWithDefault(process.env.WEBHOOK_RETRY_DELAY_2, 3000);
const WEBHOOK_RETRY_DELAY_3 = parseIntWithDefault(process.env.WEBHOOK_RETRY_DELAY_3, 9000);
const WEBHOOK_RETRY_DELAYS = [
  WEBHOOK_RETRY_DELAY_1,   // attempt 1 → attempt 2:  1s
  WEBHOOK_RETRY_DELAY_2,   // attempt 2 → attempt 3:  3s
  WEBHOOK_RETRY_DELAY_3,   // attempt 3 → attempt 4:  9s
  27_000,                  // attempt 4 → attempt 5:  27s
  60_000,                  // attempt 5 → attempt 6:  1 min
  120_000,                 // attempt 6 → attempt 7:  2 min
  300_000,                 // attempt 7 → attempt 8:  5 min
  600_000,                 // attempt 8 → attempt 9:  10 min
  1_800_000,               // attempt 9 → attempt 10: 30 min
  3_600_000,               // attempt 10 → final:     1 hr
];
const CLEANUP_EXPIRED_DAYS = Math.max(30, Math.min(90, parseIntWithDefault(process.env.CLEANUP_EXPIRED_DAYS, 90)));
const RETENTION_PAID_DAYS = parseIntWithDefault(process.env.RETENTION_PAID_DAYS, 90);
const RETENTION_MAX_DAYS = parseIntWithDefault(process.env.RETENTION_MAX_DAYS, 365);
const AUTO_ANONYMIZE_ENABLED = process.env.AUTO_ANONYMIZE_ENABLED !== "false";
const RUDIS_WEBHOOK_SECRET = process.env.RUDIS_WEBHOOK_SECRET || "";

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

// Optional API key for invoice creation
const INVOICE_API_KEY = process.env.INVOICE_API_KEY || "";

// Simulation configuration
// SAFETY: Simulation mode is blocked in production to prevent invoice fraud.
const SIMULATION_ENABLED = process.env.SIMULATION_ENABLED === "true";
if (SIMULATION_ENABLED && process.env.NODE_ENV === "production") {
  throw new Error(
    "SIMULATION_ENABLED cannot be true in production (NODE_ENV=production). " +
    "Disable simulation mode before deploying."
  );
}
const ADMIN_SIM_TOKEN = process.env.ADMIN_SIM_TOKEN || "";

let feeForwardingLnClient: LNbitsClient | null = null;
if (process.env.LNBITS_API_URL && process.env.LNBITS_WALLET_KEY && process.env.LNBITS_ADMIN_KEY) {
  feeForwardingLnClient = createLNbitsClient({
    apiUrl: process.env.LNBITS_API_URL,
    walletKey: process.env.LNBITS_WALLET_KEY,
    adminKey: process.env.LNBITS_ADMIN_KEY,
    httpTimeout: parseInt(process.env.LN_HTTP_TIMEOUT || "5000", 10),
  });
}

async function handleFeeForwarding(invoice: any, rail: string): Promise<void> {
  const feeAtomic = invoice.feeAmountAtomic;
  if (!feeAtomic || BigInt(feeAtomic) <= 0n) return;

  try {
    if (rail === "LN" && feeForwardingLnClient) {
      const feeSats = parseInt(feeAtomic, 10);
      await forwardLnFee(invoice.id, feeSats, feeForwardingLnClient);
    } else {
      await markFeeAccumulated(invoice.id);
    }
  } catch (error: any) {
    console.error(JSON.stringify({
      event: "fee.forwarding.error",
      invoiceId: invoice.id,
      rail,
      error: error.message,
    }));
    await markFeeAccumulated(invoice.id);
  }
}

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

// Rate limiter for admin API and metrics endpoints
const adminApiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute per IP (generous for dashboards, still blocks scrapers)
  message: { error: "Too many admin requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

// HMAC signature generation for webhook security
function generateWebhookSignature(payload: any): string {
  if (!RUDIS_WEBHOOK_SECRET || RUDIS_WEBHOOK_SECRET.length === 0) {
    // This should never happen due to startup validation, but defense in depth
    throw new Error("Cannot generate webhook signature: RUDIS_WEBHOOK_SECRET not configured");
  }
  const payloadString = JSON.stringify(payload);
  return crypto
    .createHmac("sha256", RUDIS_WEBHOOK_SECRET)
    .update(payloadString)
    .digest("hex");
}

// Rail authentication middleware
/**
 * Timing-safe token comparison.
 * Prevents timing attacks where an attacker can deduce valid tokens
 * by measuring response time differences byte-by-byte.
 * Handles length mismatches by always running a dummy comparison.
 */
function timingSafeTokenCompare(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  // Pad shorter buffer to prevent length leakage, then compare full expected-length slice
  if (a.length !== b.length) {
    // Run a dummy comparison to prevent timing shortcut on length check
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

/** Extract Bearer token from Authorization header, or return null */
function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.substring(7);
  return token.length > 0 ? token : null;
}

function authenticateRailCallback(req: Request, res: Response, next: NextFunction) {
  if (!RAIL_AUTH_TOKEN) {
    console.error("CRITICAL: RAIL_AUTH_TOKEN not configured");
    return res.status(500).json({ error: "Server configuration error" });
  }
  const token = extractBearerToken(req);
  if (!token || !timingSafeTokenCompare(token, RAIL_AUTH_TOKEN)) {
    console.warn("Rail callback rejected: invalid or missing token");
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// Authenticate simulation endpoint
function authenticateSimulation(req: Request, res: Response, next: NextFunction) {
  if (!SIMULATION_ENABLED) {
    return res.status(403).json({ error: "simulation_disabled" });
  }
  if (!ADMIN_SIM_TOKEN) {
    console.error("CRITICAL: SIMULATION_ENABLED=true but ADMIN_SIM_TOKEN not configured");
    return res.status(500).json({ error: "Server configuration error" });
  }
  const token = extractBearerToken(req);
  if (!token || !timingSafeTokenCompare(token, ADMIN_SIM_TOKEN)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// Admin operations token — uses ADMIN_PRIVACY_TOKEN (separate from simulation token)
const ADMIN_PRIVACY_TOKEN = process.env.ADMIN_PRIVACY_TOKEN || "";

// Authenticate admin privacy/anonymization operations
// Uses ADMIN_PRIVACY_TOKEN — separate from ADMIN_SIM_TOKEN to prevent sim creds granting prod access
function authenticateAdmin(req: Request, res: Response, next: NextFunction) {
  const secret = ADMIN_PRIVACY_TOKEN || ADMIN_API_TOKEN; // Fall back to ADMIN_API_TOKEN if ADMIN_PRIVACY_TOKEN not set
  if (!secret) {
    console.error("CRITICAL: Neither ADMIN_PRIVACY_TOKEN nor ADMIN_API_TOKEN configured for admin operations");
    return res.status(500).json({ error: "Server configuration error" });
  }
  const token = extractBearerToken(req);
  if (!token || !timingSafeTokenCompare(token, secret)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// Authenticate admin API operations (Step 5.3: Security for admin endpoints)
function authenticateAdminApi(req: Request, res: Response, next: NextFunction) {
  if (!ADMIN_API_TOKEN) {
    console.error("CRITICAL: ADMIN_API_TOKEN not configured");
    return res.status(500).json({ error: "Server configuration error" });
  }
  const token = extractBearerToken(req);
  if (!token || !timingSafeTokenCompare(token, ADMIN_API_TOKEN)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// Optional API key authentication for invoice creation
// Accepts either INVOICE_API_KEY (for external callers like Altostratus)
// or ADMIN_API_TOKEN (for the Rudis admin UI when logged in)
function authenticateInvoiceApiKey(req: Request, res: Response, next: NextFunction) {
  if (!INVOICE_API_KEY) return next(); // Public when not configured
  const token = extractBearerToken(req);
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  const validInvoiceKey = timingSafeTokenCompare(token, INVOICE_API_KEY);
  const validAdminToken = ADMIN_API_TOKEN ? timingSafeTokenCompare(token, ADMIN_API_TOKEN) : false;
  if (!validInvoiceKey && !validAdminToken) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// Authenticate incoming LNbits webhooks (Step 5.1: Webhook handling)
// Different from authenticateRailCallback - this validates LNBITS_WEBHOOK_SECRET
// for webhooks FROM LNbits when invoices are paid
//
// Security Model:
// - LNbits doesn't support HMAC signatures or custom headers
// - We use URL path-based authentication (similar to Stripe, GitHub, etc.)
// - Secret token is part of URL path: /rails/ln/webhook/:token
// - Long random token + HTTPS provides adequate security
// - Better than query params (which are logged everywhere)
function authenticateLNbitsWebhook(req: Request, res: Response, next: NextFunction) {
  const webhookSecret = process.env.LNBITS_WEBHOOK_SECRET;
  
  // SECURITY (Step 7.1): Generic error messages - don't expose secret names
  // If webhook secret is not configured, reject all webhook calls
  if (!webhookSecret || webhookSecret.length === 0) {
    console.warn("LNbits webhook rejected: webhook authentication not configured");
    return res.status(401).json({ error: "Unauthorized" });
  }
  
  // Extract token from URL path parameter
  const providedSecret = req.params.token;
  
  if (!providedSecret) {
    console.warn("LNbits webhook rejected: missing token in URL path");
    return res.status(401).json({ error: "Unauthorized" });
  }
  
  // CRITICAL: Check length first to prevent RangeError in timingSafeEqual
  // Mismatched buffer lengths would throw and expose 500 errors (DoS vector)
  if (providedSecret.length !== webhookSecret.length) {
    console.warn("LNbits webhook rejected: invalid secret token length");
    return res.status(401).json({ error: "Unauthorized" });
  }
  
  // Timing-safe comparison to prevent timing attacks
  if (!crypto.timingSafeEqual(
    Buffer.from(providedSecret),
    Buffer.from(webhookSecret)
  )) {
    console.warn("LNbits webhook rejected: invalid secret token");
    return res.status(401).json({ error: "Unauthorized" });
  }
  
  next();
}

// ============================================================================
// Fee Calculation Helpers
// ============================================================================

import { computeFee, convertToAtomic, type ComputedFee } from "./fee-utils";

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
  /** When payment was confirmed (all rails) */
  paid_at?: string;
  /** Exact amount paid in atomic units (Lightning only) */
  amount_paid_atomic?: string;
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
  
  // Fetch invoice once for additional fields
  const invoice = await storage.getInvoice(payment.invoiceId);
  
  // For Lightning payments, include LN-specific fields from database
  if (payment.currency === "LN" && invoice) {
    if (invoice.bolt11Invoice) {
      response.invoice_bolt11 = invoice.bolt11Invoice;
    }
    if (invoice.amountPaidAtomic) {
      response.amount_paid_atomic = invoice.amountPaidAtomic;
    }
  }
  
  // Add paid_at timestamp for all rails (if payment confirmed)
  if (payment.status === "confirmed" && invoice?.paidAt) {
    response.paid_at = invoice.paidAt.toISOString();
  }
  
  return response;
}

// Queue a webhook for delivery (creates pending webhook log with persisted payload)
async function queueWebhook(
  invoiceId: string,
  url: string,
  payload: any
): Promise<string> {
  const webhookLog = await storage.createWebhookLog({
    invoiceId,
    url,
    status: "pending",
    payload: JSON.stringify(payload), // Persist payload so retries survive restarts
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
        "User-Agent": "Rudis/1.0",
        "X-Rudis-Signature": signature,
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
// Payloads are read from the DB (webhook.payload column) — no in-memory Map needed
async function processWebhookQueue() {
  const pendingWebhooks = await storage.getPendingWebhooks();
  const now = new Date();

  for (const webhook of pendingWebhooks) {
    // Check if it's time to retry (DB-level filter already handles this, belt-and-suspenders)
    if (webhook.retryAfter && new Date(webhook.retryAfter) > now) {
      continue;
    }

    // Read payload from DB — no dependency on in-memory Map
    if (!webhook.payload) {
      console.warn(`Webhook ${webhook.id} (invoice ${webhook.invoiceId}) has no persisted payload — skipping`);
      continue;
    }

    let payload: any;
    try {
      payload = JSON.parse(webhook.payload);
    } catch {
      console.warn(`Webhook ${webhook.id} has malformed payload JSON — skipping`);
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

// Note: webhook payloads are now persisted in the DB (webhook_logs.payload column),
// so no in-memory Map is needed for retries across restarts.

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
  const webhookUrlConfigured = process.env.RUDIS_WEBHOOK_URL && process.env.RUDIS_WEBHOOK_URL.length > 0;
  if (webhookUrlConfigured && (!RUDIS_WEBHOOK_SECRET || RUDIS_WEBHOOK_SECRET.length === 0)) {
    console.error("╔═══════════════════════════════════════════════════════════╗");
    console.error("║ FATAL: RUDIS_WEBHOOK_URL set but RUDIS_WEBHOOK_SECRET║");
    console.error("║        not configured. Webhooks MUST be signed for       ║");
    console.error("║        security. Set RUDIS_WEBHOOK_SECRET or remove         ║");
    console.error("║        RUDIS_WEBHOOK_URL from environment.          ║");
    console.error("╚═══════════════════════════════════════════════════════════╝");
    throw new Error("RUDIS_WEBHOOK_SECRET required when RUDIS_WEBHOOK_URL is configured");
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
  console.log("║         Rudis - Configuration             ║");
  console.log("╠═══════════════════════════════════════════════════════════╣");
  console.log(`║ Lightning:   ${ENABLE_LN ? "✓ ENABLED " : "✗ DISABLED"}                                   ║`);
  console.log(`║ Bitcoin:     ${ENABLE_BTC ? "✓ ENABLED " : "✗ DISABLED"}                                   ║`);
  console.log(`║ Monero:      ${ENABLE_XMR ? "✓ ENABLED " : "✗ DISABLED"}                                   ║`);
  console.log(`║ Simulation:  ${SIMULATION_ENABLED ? "⚠  ENABLED (DEV ONLY)" : "✓ DISABLED"}                         ║`);
  console.log(`║ Invoice API: ${INVOICE_API_KEY ? "✓ PROTECTED  " : "⚠  OPEN (set INVOICE_API_KEY!)"}                   ║`);
  console.log("╚═══════════════════════════════════════════════════════════╝");

  // Warn loudly if invoice API key is not set in production
  if (!INVOICE_API_KEY && process.env.NODE_ENV === "production") {
    console.error("╔═══════════════════════════════════════════════════════════╗");
    console.error("║  ⚠  SECURITY WARNING                                      ║");
    console.error("║  INVOICE_API_KEY is not set.                              ║");
    console.error("║  POST /api/invoices is publicly accessible — anyone       ║");
    console.error("║  can create invoices on your instance.                    ║");
    console.error("║  Set INVOICE_API_KEY in your environment to restrict      ║");
    console.error("║  invoice creation to authorized callers only.             ║");
    console.error("╚═══════════════════════════════════════════════════════════╝");
  }
  
  // Start periodic webhook processing (every 5 seconds)
  setInterval(async () => {
    await processWebhookQueue();
  }, 5000);

  // Periodic invoice expiration check (every 30 seconds)
  setInterval(async () => {
    await storage.checkAndExpireInvoices();
  }, 30 * 1000);

  // Periodic cleanup of old failed webhooks (every hour)
  setInterval(async () => {
    await cleanupOldWebhooks();
  }, 60 * 60 * 1000);

  // Periodic fee settlement check (every hour)
  setInterval(async () => {
    try {
      await checkAndCreateSettlements();
      if (feeForwardingLnClient) {
        await retryPendingLnForwards(feeForwardingLnClient);
      }
    } catch (e) {}
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
  // Payloads are persisted in the DB so no reconstruction needed
  console.log("Processing any pending webhooks from previous session...");
  setTimeout(async () => {
    await processWebhookQueue();
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
    
    // For Lightning Network, check if LNbits is configured
    if (rail === "LN") {
      const lnbitsApiUrl = process.env.LNBITS_API_URL || "";
      if (!lnbitsApiUrl) {
        return {
          status: "not_configured",
          reason: "ln_not_configured",
          message: "Lightning Network not configured (LNBITS_API_URL not set)",
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
  app.get("/metrics", adminApiLimiter, authenticateAdminApi, (req, res) => {
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
  app.get("/admin/invoices", adminApiLimiter, authenticateAdminApi, async (req, res) => {
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
      let invoices: Invoice[] = await storage.getAllInvoices();
      
      // Apply filters
      if (rail) {
        const dbCurrency = railToCurrency(rail.toUpperCase() as "BTC" | "XMR" | "LN");
        invoices = invoices.filter((inv: Invoice) => inv.currency === dbCurrency);
      }
      
      if (status) {
        invoices = invoices.filter((inv: Invoice) => inv.status.toLowerCase() === status.toLowerCase());
      }
      
      if (created_after) {
        const afterDate = new Date(created_after);
        if (isNaN(afterDate.getTime())) {
          return res.status(400).json({
            error: "invalid_date",
            message: "created_after must be a valid ISO 8601 timestamp"
          });
        }
        invoices = invoices.filter((inv: Invoice) => new Date(inv.createdAt) >= afterDate);
      }
      
      if (created_before) {
        const beforeDate = new Date(created_before);
        if (isNaN(beforeDate.getTime())) {
          return res.status(400).json({
            error: "invalid_date",
            message: "created_before must be a valid ISO 8601 timestamp"
          });
        }
        invoices = invoices.filter((inv: Invoice) => new Date(inv.createdAt) <= beforeDate);
      }
      
      // Sort by creation date (newest first)
      invoices.sort((a: Invoice, b: Invoice) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      
      const total = invoices.length;
      
      // Apply pagination
      const paginatedInvoices = invoices.slice(offset, offset + limit);
      
      // Format response (Step 5.2: Invoice list view)
      const formattedInvoices = paginatedInvoices.map((inv: Invoice) => {
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
        
        // SECURITY (Step 7.4): Admin endpoints show internal LN metadata for debugging
        // Public APIs filter these out - only admins see them
        if (rail === "LN") {
          if (inv.lnCheckingId) {
            result.ln_checking_id = inv.lnCheckingId;
          }
          if (inv.lnPaymentHash) {
            result.ln_payment_hash = inv.lnPaymentHash;
          }
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
      // Step 7.3: Log safety - don't log full error object (may contain invoice data)
      console.error("Error fetching admin invoices:", {
        message: error.message,
        code: error.code,
        name: error.name,
      });
      res.status(500).json({
        error: "internal_error",
        message: "Failed to fetch invoices"
      });
    }
  });

  /**
   * GET /admin/invoices/:id - Get invoice detail with transactions (Step 6.1: Invoice detail endpoint)
   * 
   * Protected by ADMIN_API_TOKEN for security
   * 
   * Returns:
   * - Complete invoice details (Step 6.1)
   * - All payment transactions (Step 6.2: Linked payment_transactions)
   * - BTC payment state (if BTC rail) - for debugging (Step 6.3)
   * - Debug information: last_checked, confirmations, errors
   * 
   * Response format:
   * {
   *   invoice: { id, rail, asset, amount_atomic, status, ... },
   *   transactions: [ { tx_hash, rail, amount_atomic, confirmations, ... } ],
   *   payment_state: { state, txid, confirmations, last_checked, ... } // BTC only
   * }
   */
  app.get("/admin/invoices/:id", adminApiLimiter, authenticateAdminApi, async (req, res) => {
    try {
      const { id } = req.params;
      
      // Get invoice
      const invoice = await storage.getInvoice(id);
      if (!invoice) {
        return res.status(404).json({
          error: "invoice_not_found",
          message: `Invoice ${id} not found`
        });
      }
      
      // Convert currency to rail
      const rail = currencyToRail(invoice.currency);
      
      // Build base invoice response (Step 6.1: All invoice fields)
      const invoiceResponse: any = {
        id: invoice.id,
        rail: rail.toLowerCase(),
        asset: invoice.asset,
        amount_atomic: invoice.amount,
        status: invoice.status,
        created_at: invoice.createdAt,
        updated_at: invoice.updatedAt,
      };
      
      // Add rail-specific fields (Step 6.1)
      if (rail === "BTC" || rail === "XMR") {
        invoiceResponse.address = invoice.paymentAddress;
      }
      
      if (rail === "LN" && invoice.bolt11Invoice) {
        invoiceResponse.invoice_bolt11 = invoice.bolt11Invoice;
      }
      
      // SECURITY (Step 7.4): Admin endpoints show internal LN metadata for debugging
      // Public APIs filter these out - only admins see them
      if (rail === "LN") {
        if (invoice.lnCheckingId) {
          invoiceResponse.ln_checking_id = invoice.lnCheckingId;
        }
        if (invoice.lnPaymentHash) {
          invoiceResponse.ln_payment_hash = invoice.lnPaymentHash;
        }
      }
      
      // Add optional fields
      if (invoice.paidAt) {
        invoiceResponse.paid_at = invoice.paidAt;
      }
      if (invoice.expiresAt) {
        invoiceResponse.expires_at = invoice.expiresAt;
      }
      if (invoice.amountPaidAtomic) {
        invoiceResponse.amount_paid_atomic = invoice.amountPaidAtomic;
      }
      if (invoice.description) {
        invoiceResponse.description = invoice.description;
      }
      if (invoice.railType) {
        invoiceResponse.rail_type = invoice.railType;
      }
      
      // Get payment transactions (Step 6.2: Linked payment_transactions)
      const transactions = await storage.getPaymentTransactionsByInvoice(id);
      const formattedTransactions = transactions.map(tx => ({
        id: tx.id,
        tx_hash: tx.transactionId, // tx_hash for clarity
        tx_ref: tx.transactionId, // also provide tx_ref
        rail: tx.rail?.toLowerCase() || rail.toLowerCase(),
        amount_atomic: invoice.amount, // Use invoice amount as transaction amount
        confirmations: parseInt(tx.confirmations || "0", 10),
        block_height: tx.blockHeight ? parseInt(tx.blockHeight, 10) : undefined,
        first_seen_at: tx.confirmedAt, // When transaction was first recorded
        confirmed_at: tx.confirmedAt,
      }));
      
      // Build response
      const response: any = {
        invoice: invoiceResponse,
        transactions: formattedTransactions,
      };
      
      // Add BTC payment state for debugging (Step 6.3: Debug usefulness)
      if (rail === "BTC") {
        const btcState = await storage.getBtcPaymentState(id);
        if (btcState) {
          response.payment_state = {
            state: btcState.state, // unseen, pending, confirmed, settled
            txid: btcState.txid || null,
            confirmations: btcState.confirmations ? parseInt(btcState.confirmations, 10) : 0,
            block_height: btcState.blockHeight ? parseInt(btcState.blockHeight, 10) : undefined,
            amount_sats: btcState.amountSats ? parseInt(btcState.amountSats, 10) : undefined,
            last_checked: btcState.lastChecked, // Step 6.3: Has the worker been polling?
            paid_at: btcState.paidAt,
            created_at: btcState.createdAt,
            updated_at: btcState.updatedAt,
          };
          
          // Step 6.3: Debug usefulness - add summary flags
          response.debug = {
            has_been_seen_on_chain: btcState.state !== "unseen",
            is_being_polled: btcState.lastChecked !== null,
            time_since_last_check_ms: btcState.lastChecked 
              ? Date.now() - new Date(btcState.lastChecked).getTime() 
              : null,
            needs_attention: btcState.state === "unseen" && Date.now() - new Date(invoice.createdAt).getTime() > 600000, // >10 min old but unseen
          };
        }
      }
      
      res.json(response);
    } catch (error: any) {
      // Step 7.3: Log safety - don't log full error object (may contain invoice data)
      console.error("Error fetching admin invoice detail:", {
        message: error.message,
        code: error.code,
        name: error.name,
      });
      res.status(500).json({
        error: "internal_error",
        message: "Failed to fetch invoice detail"
      });
    }
  });

  // ============================================================================
  // Payment API Endpoints (Rail-Agnostic Client Interface)
  // ============================================================================
  
  /**
   * POST /payments - Create a new payment
   * 
   * Clean, rail-agnostic API for merchant apps and external clients.
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
      
      // Create payment address via orchestrator FIRST
      // This ensures we have all data before creating the invoice (atomic)
      // Generate temporary ID for adapter to use
      const tempInvoiceId = crypto.randomUUID();
      
      const payment = await orchestrator.createPayment(rail, {
        invoiceId: tempInvoiceId,
        amountAtomic: amount_atomic,
        metadata,
      });
      
      // CRITICAL: Validate and extract Lightning metadata BEFORE any DB writes
      // Extract validated values into local constants for explicit safety
      let lnPaymentHash: string | null = null;
      let lnCheckingId: string | null = null;
      let bolt11Invoice: string | null = null;
      
      if (rail === "LN") {
        // Fail fast if adapter didn't return required fields
        if (!payment.metadata?.paymentHash || !payment.metadata?.checkingId) {
          throw new Error("Lightning adapter must return paymentHash and checkingId in metadata");
        }
        
        // Extract to local constants (validated above)
        lnPaymentHash = payment.metadata.paymentHash as string;
        lnCheckingId = payment.metadata.checkingId as string;
        bolt11Invoice = payment.paymentAddress;
      }
      
      // Compute asset from rail: LN → BTC, others map directly
      const asset = rail === "LN" ? "BTC" : rail;
      
      // Look up active fee policy for this rail/currency
      const invoiceCurrency = railToCurrency(rail);
      const paymentMerchantId = (metadata?.merchantId as string) || null;
      const paymentFeePolicy = await storage.getActiveFeePolicy(invoiceCurrency, paymentMerchantId);
      let paymentFeeData: Record<string, string | undefined> = {};
      if (paymentFeePolicy) {
        const fee = computeFee(amount_atomic, paymentFeePolicy);
        paymentFeeData = {
          merchantId: paymentMerchantId || undefined,
          feePolicyId: fee.feePolicyId,
          feeAmountAtomic: fee.feeAmountAtomic,
          feePercent: fee.feePercent,
        };
      }

      // Create invoice with ALL data in one atomic operation
      // All required fields extracted and validated above
      const invoiceData: any = {
        amount: amount_atomic,
        currency: invoiceCurrency,
        asset,
        paymentAddress: payment.paymentAddress,
        description: metadata?.description || `Payment via ${rail}`,
        ...(payment.expiresAt && { expiresAt: new Date(payment.expiresAt) }),
        ...(bolt11Invoice && { bolt11Invoice }),
        ...(lnPaymentHash && { lnPaymentHash }),
        ...(lnCheckingId && { lnCheckingId }),
        ...(paymentFeeData.feePolicyId ? paymentFeeData : {}),
      };
      
      // Create invoice with complete validated data
      let invoice;
      try {
        invoice = await storage.createInvoice(invoiceData);
      } catch (storageError: any) {
        // Log storage failure for monitoring (adapter succeeded but DB failed)
        console.error(JSON.stringify({
          event: "invoice.storage_failed",
          rail,
          amount_atomic,
          error: storageError.message,
          context: "Adapter succeeded, DB write failed - LNbits invoice orphaned",
        }));
        throw new Error(`Failed to persist invoice: ${storageError.message}`);
      }
      
      // Update payment with final invoice ID for response
      payment.invoiceId = invoice.id;
      
      // Transform to API response format and send response
      // If this fails, delete the invoice (compensating transaction)
      let apiResponse;
      try {
        apiResponse = await canonicalToApiResponse(payment);
        
        // Note: monitoring.logPaymentCreated() already called by orchestrator
        // This is additional structured logging for the HTTP layer
        console.log(JSON.stringify({
          event: "payment.created",
          rail,
          id: invoice.id,
          amount_atomic: amount_atomic,
        }));
        
        res.status(201).json(apiResponse);
      } catch (responseError: any) {
        // Compensating action: mark invoice as failed
        // Rationale: User never received BOLT11/address, can't pay, invoice is orphaned
        console.error(JSON.stringify({
          event: "invoice.response_failed",
          rail,
          invoice_id: invoice.id,
          error: responseError.message,
          context: "Marking orphaned invoice as failed (user never received payment address)",
        }));
        
        try {
          await storage.updateInvoiceStatus(invoice.id, "failed");
        } catch (updateError: any) {
          console.error(JSON.stringify({
            event: "invoice.failed_status_update_failed",
            rail,
            invoice_id: invoice.id,
            error: updateError.message,
            context: "Failed to mark orphaned invoice as failed - manual cleanup required",
          }));
        }
        
        throw new Error(`Failed to generate response: ${responseError.message}`);
      }
      
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
  // SECURITY (Step 7.3): Filter response - no internal fields exposed
  app.get("/api/invoices", async (req, res) => {
    try {
      await storage.checkAndExpireInvoices();
      const invoices = await storage.getAllInvoices();
      
      // SECURITY: Filter out internal LN metadata from public response
      const publicInvoices = invoices.map(invoice => ({
        id: invoice.id,
        currency: invoice.currency,
        asset: invoice.asset,
        amount: invoice.amount,
        status: invoice.status,
        paymentAddress: invoice.paymentAddress,
        createdAt: invoice.createdAt,
        updatedAt: invoice.updatedAt,
        expiresAt: invoice.expiresAt || undefined,
        paidAt: invoice.paidAt || undefined,
        // Include BOLT11 for Lightning (users need this to pay)
        ...(invoice.bolt11Invoice && { bolt11Invoice: invoice.bolt11Invoice }),
        // Include amount paid for confirmed invoices
        ...(invoice.amountPaidAtomic && { amountPaidAtomic: invoice.amountPaidAtomic }),
        // Include description if present
        ...(invoice.description && { description: invoice.description }),
      }));
      
      res.json(publicInvoices);
    } catch (error: any) {
      // Silent error - endpoint returns 500 to client
      res.status(500).json({ error: "Failed to fetch invoices" });
    }
  });

  // Dashboard stats: invoice counts + volume received by currency
  app.get("/api/stats", async (req, res) => {
    try {
      await storage.checkAndExpireInvoices();
      const invoices = await storage.getAllInvoices();

      const counts = { total: 0, pending: 0, paid: 0, expired: 0 };
      // Volume tracking: currency → total atomic units received (as bigint strings)
      const volumeByRail: Record<string, bigint> = {};

      for (const inv of invoices) {
        counts.total++;
        if (inv.status === "pending") counts.pending++;
        else if (inv.status === "paid") counts.paid++;
        else if (inv.status === "expired") counts.expired++;

        if (inv.status === "paid" && inv.amountPaidAtomic) {
          const rail = inv.currency || "BTC";
          try {
            const atomic = BigInt(inv.amountPaidAtomic);
            volumeByRail[rail] = (volumeByRail[rail] || BigInt(0)) + atomic;
          } catch {
            // skip non-parseable values
          }
        }
      }

      // Format volumes: BTC/Lightning in sats (8 decimal places), XMR in atomic (12 dp)
      const formatVolume = (rail: string, atomicBig: bigint): string => {
        if (rail === "BTC" || rail === "Lightning") {
          // sats → BTC (8 decimals)
          const sats = Number(atomicBig);
          return (sats / 1e8).toFixed(8);
        } else if (rail === "XMR") {
          // piconeros → XMR (12 decimals)
          const atomic = Number(atomicBig);
          return (atomic / 1e12).toFixed(12);
        }
        return atomicBig.toString();
      };

      const volume: Record<string, { atomic: string; formatted: string }> = {};
      for (const [rail, atomicBig] of Object.entries(volumeByRail)) {
        volume[rail] = {
          atomic: atomicBig.toString(),
          formatted: formatVolume(rail, atomicBig),
        };
      }

      res.json({ counts, volume });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  // Get invoice by ID
  // SECURITY (Step 7.3): Filter response - no internal fields exposed
  app.get("/api/invoices/:id", async (req, res) => {
    try {
      await storage.checkAndExpireInvoices();
      const invoice = await storage.getInvoice(req.params.id);
      if (!invoice) {
        return res.status(404).json({ error: "Invoice not found" });
      }
      
      // SECURITY: Only return public-safe fields
      // DO NOT expose: lnCheckingId, lnPaymentHash (internal LN metadata)
      const publicInvoice = {
        id: invoice.id,
        currency: invoice.currency,
        asset: invoice.asset,
        amount: invoice.amount,
        status: invoice.status,
        paymentAddress: invoice.paymentAddress,
        createdAt: invoice.createdAt,
        updatedAt: invoice.updatedAt,
        expiresAt: invoice.expiresAt || undefined,
        paidAt: invoice.paidAt || undefined,
        // Include BOLT11 for Lightning (users need this to pay)
        ...(invoice.bolt11Invoice && { bolt11Invoice: invoice.bolt11Invoice }),
        // Include amount paid for confirmed invoices
        ...(invoice.amountPaidAtomic && { amountPaidAtomic: invoice.amountPaidAtomic }),
        // Include description if present
        ...(invoice.description && { description: invoice.description }),
      };
      
      res.json(publicInvoice);
    } catch (error: any) {
      // Silent error - endpoint returns 500 to client
      res.status(500).json({ error: "Failed to fetch invoice" });
    }
  });

  // Create new invoice (using unified payment orchestrator)
  app.post("/api/invoices", createInvoiceLimiter, authenticateInvoiceApiKey, async (req, res) => {
    try {
      const hasOverdueFees = await checkOverdueSettlements();
      if (hasOverdueFees) {
        return res.status(402).json({
          error: "fees_overdue",
          message: "Invoice creation is blocked: outstanding fee settlements must be paid before creating new invoices. Contact the system operator.",
        });
      }

      const validatedData = insertInvoiceSchema.parse(req.body);
      
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
      
      // Look up active fee policy for this currency
      const merchantId = (req.body.merchantId as string) || null;
      const feePolicy = await storage.getActiveFeePolicy(validatedData.currency, merchantId);
      let feeData: { merchantId?: string; feePolicyId?: string; feeAmountAtomic?: string; feePercent?: string } = {};
      if (feePolicy) {
        const amountAtomic = convertToAtomic(validatedData.amount, validatedData.currency);
        const fee = computeFee(amountAtomic, feePolicy);
        feeData = {
          merchantId: merchantId || undefined,
          feePolicyId: fee.feePolicyId,
          feeAmountAtomic: fee.feeAmountAtomic,
          feePercent: fee.feePercent,
        };
      }

      // Create invoice first (will have placeholder address)
      const invoice = await storage.createInvoice({
        ...validatedData,
        ...(feeData.feePolicyId ? feeData : {}),
      } as any);
      
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

  // ============================================================================
  // LNbits Webhook Endpoint (Step 5.1: Webhook handling)
  // ============================================================================
  
  /**
   * POST /rails/ln/webhook/:token
   * 
   * Incoming webhook from LNbits when a Lightning invoice is paid.
   * Different from /api/rails/ln/settled (internal rail callback).
   * 
   * Security (Step 7: Security & Privacy):
   * - Validates LNBITS_WEBHOOK_SECRET via URL path token (not query param/header)
   * - Strict input validation: rejects malformed/unexpected payloads
   * - Does NOT trust arbitrary invoiceId from payload
   * - Looks up invoice by checking_id (prevents unauthorized updates)
   * - Only extracts fields needed for matching & status
   * - Long random token + HTTPS provides adequate security
   * 
   * Idempotency:
   * - Safe to call multiple times for same payment
   * - Returns 200 OK if already paid (no duplicate transactions)
   * 
   * Example URL: https://my-app.com/rails/ln/webhook/abc123def456...
   */
  app.post("/rails/ln/webhook/:token", authenticateLNbitsWebhook, async (req, res) => {
    try {
      const payload = req.body;
      
      // SECURITY (Step 7.2): Strict input validation - reject invalid types
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        console.warn("LNbits webhook rejected: invalid payload format (not an object)");
        return res.status(400).json({ error: "Invalid webhook payload" });
      }
      
      // Extract ONLY the fields we need for matching & status
      // Ignore all other fields to prevent injection attacks
      const {
        checking_id,
        payment_hash,
        pending,
        amount, // millisatoshis
      } = payload;
      
      // Validate required fields exist and have correct types
      if (!checking_id || typeof checking_id !== "string") {
        console.warn("LNbits webhook rejected: invalid or missing checking_id");
        return res.status(400).json({ error: "Invalid webhook payload" });
      }
      
      if (!payment_hash || typeof payment_hash !== "string") {
        console.warn("LNbits webhook rejected: invalid or missing payment_hash");
        return res.status(400).json({ error: "Invalid webhook payload" });
      }
      
      // Validate checking_id format (prevent injection)
      // LNbits checking_id format: alphanumeric + hyphens/underscores
      if (!/^[a-zA-Z0-9_-]+$/.test(checking_id)) {
        console.warn("LNbits webhook rejected: invalid checking_id format");
        return res.status(400).json({ error: "Invalid webhook payload" });
      }
      
      // Validate payment_hash format (64 hex chars)
      if (!/^[a-f0-9]{64}$/i.test(payment_hash)) {
        console.warn("LNbits webhook rejected: invalid payment_hash format");
        return res.status(400).json({ error: "Invalid webhook payload" });
      }
      
      // Validate amount if present (must be positive integer)
      if (amount !== undefined && amount !== null) {
        if (typeof amount !== "number" || amount <= 0 || !Number.isInteger(amount)) {
          console.warn("LNbits webhook rejected: invalid amount (must be positive integer)");
          return res.status(400).json({ error: "Invalid webhook payload" });
        }
      }
      
      // Use shared payment confirmation handler (same logic as poller)
      const paymentData = {
        checking_id,
        payment_hash,
        pending: pending === 1 || pending === true,
        amount, // millisatoshis
      };
      
      const confirmed = await confirmLightningPayment(paymentData, "webhook");
      
      if (!confirmed) {
        // Payment was not confirmed (already paid, expired, pending, etc.)
        // confirmLightningPayment already logged the reason
        // Return success to acknowledge webhook receipt
        return res.status(200).json({ message: "Webhook processed" });
      }
      
      // Payment confirmed! Get the invoice for webhook notification
      const invoices = await storage.getAllInvoices();
      const invoice = invoices.find(inv => inv.lnCheckingId === checking_id);
      
      if (invoice) {
        // Queue webhook to merchant app (if configured)
        const rudisWebhookUrl = process.env.RUDIS_WEBHOOK_URL;
        if (rudisWebhookUrl) {
          const webhookPayload = {
            invoiceId: invoice.id,
            status: "confirmed",
            amount: invoice.amount,
            currency: invoice.currency,
            timestamp: new Date().toISOString(),
          };
          
          await queueWebhook(invoice.id, rudisWebhookUrl, webhookPayload);
        }
        
        // Return success
        res.status(200).json({ 
          success: true,
          invoiceId: invoice.id 
        });
      } else {
        // This shouldn't happen (invoice was found in confirmLightningPayment)
        res.status(200).json({ message: "Payment confirmed but invoice not found" });
      }
      
    } catch (error: any) {
      console.error("LNbits webhook processing error:", error.message);
      res.status(500).json({ error: "Webhook processing failed" });
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
      
      console.log(JSON.stringify({ 
        rail: "ln", 
        event: "payment.confirmed", 
        id: invoiceId,
        tx_hash: transactionId,
        confirmations: confirmations 
      }));
      
      monitoring.logPaymentStatus("LN", invoiceId, "confirmed");

      await handleFeeForwarding(invoice, "LN");
      
      const rudisWebhookUrl = process.env.RUDIS_WEBHOOK_URL;
      if (rudisWebhookUrl) {
        const updatedInvoice = await storage.getInvoice(invoiceId);
        const payload = {
          invoiceId: updatedInvoice!.id,
          status: "confirmed",
          amount: updatedInvoice!.amount,
          currency: updatedInvoice!.currency,
          timestamp: new Date().toISOString(),
        };
        
        await queueWebhook(invoiceId, rudisWebhookUrl, payload);
      }

      res.json({ success: true });
    } catch (error: any) {
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
      
      console.log(JSON.stringify({ 
        rail: "btc", 
        event: "payment.confirmed", 
        id: invoiceId,
        tx_hash: transactionId,
        confirmations: confirmations,
        block_height: blockHeight
      }));
      
      monitoring.logPaymentStatus("BTC", invoiceId, "confirmed");

      await handleFeeForwarding(invoice, "BTC");
      
      const rudisWebhookUrl = process.env.RUDIS_WEBHOOK_URL;
      if (rudisWebhookUrl) {
        const updatedInvoice = await storage.getInvoice(invoiceId);
        const payload = {
          invoiceId: updatedInvoice!.id,
          status: "confirmed",
          amount: updatedInvoice!.amount,
          currency: updatedInvoice!.currency,
          timestamp: new Date().toISOString(),
        };
        
        await queueWebhook(invoiceId, rudisWebhookUrl, payload);
      }

      res.json({ success: true });
    } catch (error: any) {
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
      
      console.log(JSON.stringify({ 
        rail: "xmr", 
        event: "payment.confirmed", 
        id: invoiceId,
        tx_hash: transactionId,
        confirmations: confirmations,
        block_height: blockHeight
      }));
      
      monitoring.logPaymentStatus("XMR", invoiceId, "confirmed");

      await handleFeeForwarding(invoice, "XMR");
      
      const rudisWebhookUrl = process.env.RUDIS_WEBHOOK_URL;
      if (rudisWebhookUrl) {
        const updatedInvoice = await storage.getInvoice(invoiceId);
        const payload = {
          invoiceId: updatedInvoice!.id,
          status: "confirmed",
          amount: updatedInvoice!.amount,
          currency: updatedInvoice!.currency,
          timestamp: new Date().toISOString(),
        };
        
        await queueWebhook(invoiceId, rudisWebhookUrl, payload);
      }

      res.json({ success: true });
    } catch (error: any) {
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

      // Queue webhook to merchant app if configured
      const rudisWebhookUrl = process.env.RUDIS_WEBHOOK_URL;
      
      if (rudisWebhookUrl && updatedInvoice) {
        const webhookPayload = {
          invoiceId: updatedInvoice.id,
          status: updatedInvoice.status,
          amount: updatedInvoice.amount,
          currency: updatedInvoice.currency,
          timestamp: new Date().toISOString(),
        };

        // Store payload for persistent retries

        // Queue the webhook for delivery (will be processed by periodic worker)
        await queueWebhook(invoiceId, rudisWebhookUrl, webhookPayload);
        
        // Attempt immediate delivery (don't wait for periodic processing)
        const webhooks = await storage.getPendingWebhooks();
        const thisWebhook = webhooks.find(w => w.invoiceId === invoiceId);
        if (thisWebhook) {
          const attempt = parseInt(thisWebhook.attempt || "1", 10);
          await attemptWebhookDelivery(
            thisWebhook.id,
            invoiceId,
            rudisWebhookUrl,
            webhookPayload,
            attempt
          );
        }
      } else if (!rudisWebhookUrl) {
        console.log(`No RUDIS_WEBHOOK_URL configured, skipping outbound webhook`);
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
      await processWebhookQueue();
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

  // Send a test webhook to the configured RUDIS_WEBHOOK_URL
  app.post("/api/webhooks/test", async (req, res) => {
    const rudisWebhookUrl = process.env.RUDIS_WEBHOOK_URL;
    if (!rudisWebhookUrl) {
      return res.status(400).json({
        success: false,
        error: "RUDIS_WEBHOOK_URL is not configured",
      });
    }
    if (!RUDIS_WEBHOOK_SECRET || RUDIS_WEBHOOK_SECRET.length === 0) {
      return res.status(400).json({
        success: false,
        error: "RUDIS_WEBHOOK_SECRET is not configured",
      });
    }

    const testPayload = {
      invoiceId: "test-" + randomUUID(),
      status: "paid",
      amount: "0.00001000",
      currency: "BTC",
      timestamp: new Date().toISOString(),
      _isTest: true,
    };

    try {
      const signature = generateWebhookSignature(testPayload);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

      let statusCode: number;
      let responseBody: string;
      try {
        const response = await fetch(rudisWebhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "Rudis/1.0",
            "X-Rudis-Signature": signature,
          },
          body: JSON.stringify(testPayload),
          signal: controller.signal,
        });
        statusCode = response.status;
        responseBody = await response.text().catch(() => "");
      } finally {
        clearTimeout(timeout);
      }

      const success = statusCode >= 200 && statusCode < 300;
      res.json({
        success,
        statusCode,
        url: rudisWebhookUrl,
        payload: testPayload,
        message: success
          ? `Test webhook delivered successfully (HTTP ${statusCode})`
          : `Webhook endpoint returned HTTP ${statusCode}`,
      });
    } catch (error: any) {
      const isTimeout = error?.name === "AbortError";
      res.status(200).json({
        success: false,
        url: rudisWebhookUrl,
        payload: testPayload,
        error: isTimeout ? "Request timed out" : (error?.message ?? "Unknown error"),
        message: isTimeout
          ? `Webhook timed out after ${WEBHOOK_TIMEOUT_MS}ms`
          : "Failed to reach webhook endpoint",
      });
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

  // ============================================================================
  // Fee Policy Admin Endpoints (protected by ADMIN_API_TOKEN)
  // ============================================================================

  app.get("/admin/fee-policies", adminApiLimiter, authenticateAdminApi, async (req, res) => {
    try {
      const policies = await storage.getAllFeePolicies();
      res.json(policies);
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch fee policies" });
    }
  });

  app.get("/admin/fee-policies/:id", adminApiLimiter, authenticateAdminApi, async (req, res) => {
    try {
      const policy = await storage.getFeePolicy(req.params.id);
      if (!policy) {
        return res.status(404).json({ error: "Fee policy not found" });
      }
      res.json(policy);
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch fee policy" });
    }
  });

  app.post("/admin/fee-policies", adminApiLimiter, authenticateAdminApi, async (req, res) => {
    try {
      const validatedData = insertFeePolicySchema.parse(req.body);
      const policy = await storage.createFeePolicy(validatedData);
      console.log(JSON.stringify({ event: "fee_policy.created", id: policy.id, name: policy.name }));
      res.status(201).json(policy);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ error: "Invalid fee policy data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create fee policy" });
    }
  });

  app.patch("/admin/fee-policies/:id", authenticateAdminApi, async (req, res) => {
    try {
      const validatedData = insertFeePolicySchema.partial().parse(req.body);
      const policy = await storage.updateFeePolicy(req.params.id, validatedData);
      if (!policy) {
        return res.status(404).json({ error: "Fee policy not found" });
      }
      console.log(JSON.stringify({ event: "fee_policy.updated", id: policy.id }));
      res.json(policy);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ error: "Invalid fee policy data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update fee policy" });
    }
  });

  app.delete("/admin/fee-policies/:id", authenticateAdminApi, async (req, res) => {
    try {
      const deleted = await storage.deleteFeePolicy(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Fee policy not found" });
      }
      console.log(JSON.stringify({ event: "fee_policy.deleted", id: req.params.id }));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to delete fee policy" });
    }
  });

  // Fee summary report - aggregate fees collected within a date range
  app.get("/admin/fee-report", adminApiLimiter, authenticateAdminApi, async (req, res) => {
    try {
      const from = req.query.from ? new Date(req.query.from as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const to = req.query.to ? new Date(req.query.to as string) : new Date();

      const allInvoices = await storage.getAllInvoices();
      const feeInvoices = allInvoices.filter(inv => {
        if (!inv.feeAmountAtomic || inv.feeAmountAtomic === "0") return false;
        if (inv.status !== "confirmed") return false;
        const created = new Date(inv.createdAt);
        return created >= from && created <= to;
      });

      const summary: Record<string, { count: number; totalFeeAtomic: bigint; currency: string }> = {};
      for (const inv of feeInvoices) {
        const key = inv.currency;
        if (!summary[key]) {
          summary[key] = { count: 0, totalFeeAtomic: BigInt(0), currency: key };
        }
        summary[key].count += 1;
        summary[key].totalFeeAtomic += BigInt(inv.feeAmountAtomic!);
      }

      const report = Object.values(summary).map(s => ({
        currency: s.currency,
        invoiceCount: s.count,
        totalFeeAtomic: s.totalFeeAtomic.toString(),
      }));

      res.json({
        from: from.toISOString(),
        to: to.toISOString(),
        currencies: report,
        totalInvoicesWithFees: feeInvoices.length,
      });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to generate fee report" });
    }
  });

  // Fee settlement management endpoints
  app.get("/admin/fee-settlements", adminApiLimiter, authenticateAdminApi, async (req, res) => {
    try {
      const settlements = await storage.getAllFeeSettlements();
      res.json(settlements);
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch fee settlements" });
    }
  });

  app.post("/admin/fee-settlements/:id/mark-paid", adminApiLimiter, authenticateAdminApi, async (req, res) => {
    try {
      const settlement = await storage.getFeeSettlement(req.params.id);
      if (!settlement) {
        return res.status(404).json({ error: "Settlement not found" });
      }
      if (settlement.status === "paid") {
        return res.json({ message: "Settlement already marked as paid", settlement });
      }
      const updated = await storage.updateFeeSettlementStatus(req.params.id, "paid", new Date());
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: "Failed to update settlement" });
    }
  });

  app.post("/admin/fee-settlements/check", adminApiLimiter, authenticateAdminApi, async (req, res) => {
    try {
      await checkAndCreateSettlements();
      const settlements = await storage.getAllFeeSettlements();
      res.json({ message: "Settlement check completed", settlements });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to check settlements" });
    }
  });

  app.get("/api/fee-status", async (req, res) => {
    try {
      const hasOverdue = await checkOverdueSettlements();
      const config = getOperatorConfig();
      res.json({
        feeCollectionEnabled: config.feeCollectionEnabled,
        systemInGoodStanding: !hasOverdue,
        invoiceCreationBlocked: hasOverdue,
      });
    } catch (error: any) {
      res.json({ feeCollectionEnabled: false, systemInGoodStanding: true, invoiceCreationBlocked: false });
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

  /**
   * GET /admin/node/funding-address
   * Returns a Bitcoin on-chain funding address from phoenixd.
   * Proxies to the internal phoenixd service — keeps phoenixd off the public internet.
   * Protected by ADMIN_API_TOKEN.
   *
   * Probes known endpoint variants across phoenixd versions so we can identify
   * the correct path without trial-and-error deploys.
   */
  app.get("/admin/node/funding-address", adminApiLimiter, authenticateAdminApi, async (req, res) => {
    const phoenixdUrl = process.env.PHOENIXD_API_ENDPOINT || "http://phoenixd.railway.internal:9740";
    const phoenixdPassword = process.env.PHOENIXD_API_PASSWORD || "";

    if (!phoenixdPassword) {
      return res.status(503).json({ error: "PHOENIXD_API_PASSWORD not configured" });
    }

    const credentials = Buffer.from(`:${phoenixdPassword}`).toString("base64");
    const authHeaders = {
      "Authorization": `Basic ${credentials}`,
    };

    // Helper: attempt a single phoenixd endpoint
    const probe = async (path: string, method = "GET"): Promise<{ ok: boolean; status: number; body: any }> => {
      try {
        const opts: RequestInit = { method, headers: { ...authHeaders } };
        if (method === "POST") {
          (opts.headers as any)["Content-Type"] = "application/x-www-form-urlencoded";
          opts.body = "";
        }
        const r = await fetch(`${phoenixdUrl}${path}`, opts);
        // Read body as text first to avoid "body already read" errors,
        // then try to parse as JSON
        const text = await r.text();
        let body: any;
        try { body = JSON.parse(text); } catch { body = text; }
        return { ok: r.ok, status: r.status, body };
      } catch (e: any) {
        return { ok: false, status: 0, body: e.message };
      }
    };

    // Ordered list of candidates — covers known phoenixd naming across versions
    const candidates: Array<{ path: string; method?: string }> = [
      // lowercase (old style)
      { path: "/getfundingaddress" },
      { path: "/getfundingaddress", method: "POST" },
      { path: "/getswapinaddress" },
      { path: "/getswapinaddress", method: "POST" },
      // camelCase (Ktor is case-sensitive, v0.6+ may use camelCase)
      { path: "/getFundingAddress" },
      { path: "/getSwapInAddress" },
      { path: "/getSwapinAddress" },
      // REST-style paths
      { path: "/swap-in/address" },
      { path: "/swap-in" },
      { path: "/swapIn" },
      { path: "/swapIn/address" },
      { path: "/swapin/address" },
      { path: "/funding/address" },
      { path: "/funding" },
      { path: "/onchain/address" },
      { path: "/bitcoin/address" },
      { path: "/wallet/address" },
      { path: "/getnewaddress" },
      // probe root + api index for hints
      { path: "/" },
      { path: "/api" },
      { path: "/swagger" },
      { path: "/openapi.json" },
      // other known phoenixd endpoints (to confirm connectivity / routing)
      { path: "/getbalance" },
      { path: "/listchannels" },
    ];

    for (const { path, method } of candidates) {
      const result = await probe(path, method);
      if (result.ok) {
        const data = result.body;
        const address =
          typeof data === "object"
            ? data.address || data.bitcoinAddress || data.swapInAddress || data.fundingAddress
            : null;
        if (address) {
          return res.json({
            address,
            message: "Send BTC to this address to fund your Lightning node.",
            raw: data,
            _resolvedVia: `${method || "GET"} ${path}`,
          });
        }
        // Responded 200 but no recognised address field — return raw so we can inspect
        return res.json({
          address: null,
          raw: data,
          _resolvedVia: `${method || "GET"} ${path}`,
          note: "phoenixd responded 200 but no address field found — check raw for structure",
        });
      }
    }

    // All candidates failed — return diagnostic results
    const diagnostics: Record<string, any> = {};
    for (const { path, method } of candidates) {
      const r = await probe(path, method);
      diagnostics[`${method || "GET"} ${path}`] = { status: r.status, body: r.body };
    }
    return res.status(502).json({
      error: "No known phoenixd funding-address endpoint responded successfully",
      diagnostics,
    });
  });

  const httpServer = createServer(app);

  return httpServer;
}
