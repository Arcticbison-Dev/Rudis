import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertInvoiceSchema, insertTemplateSchema, paymentConfirmationSchema } from "@shared/schema";
import { paymentConfirmationSchema as legacyPaymentConfirmationSchema } from "@shared/webhook-schema";
import axios, { AxiosError } from "axios";
import crypto from "crypto";
import rateLimit from "express-rate-limit";

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

      if (shouldRetry) {
        console.log(`Webhook attempt ${currentAttempt} failed with status ${response.status}, will retry as attempt ${nextAttempt} after ${nextRetryDelay}ms`);
      } else {
        console.error(`✗ Webhook failed permanently after ${currentAttempt} attempts (max: ${WEBHOOK_MAX_ATTEMPTS})`);
      }
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

    if (shouldRetry) {
      console.log(`Webhook attempt ${currentAttempt} failed: ${errorMessage}, will retry as attempt ${nextAttempt} after ${nextRetryDelay}ms`);
    } else {
      console.error(`✗ Webhook failed permanently after ${currentAttempt} attempts (max: ${WEBHOOK_MAX_ATTEMPTS}): ${errorMessage}`);
    }
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
      else if (invoice.status === "paid" && invoiceAge > RETENTION_PAID_DAYS) {
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
    console.error("Error in data retention cleanup:", error);
    return { anonymized: 0, deleted: 0 };
  }
}

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

  // Health check endpoint
  app.get("/health", async (req, res) => {
    const timestamp = new Date().toISOString();
    let storageStatus = "operational";
    let webhookStatus = "operational";
    let pendingCount = 0;
    
    try {
      // Lightweight storage check - just count pending webhooks (bounded query)
      // This is O(n) where n = pending webhooks, not O(all invoices)
      const pendingWebhooks = await storage.getPendingWebhooks();
      pendingCount = pendingWebhooks.length;
      webhookStatus = pendingCount < 100 ? "operational" : "queue_full";
    } catch (error: any) {
      // If we can't even query webhooks, storage is likely down
      storageStatus = "error";
      webhookStatus = "unknown";
    }
    
    const isHealthy = storageStatus === "operational" && webhookStatus === "operational";
    const status = isHealthy ? "healthy" : "degraded";
    
    const response: any = {
      status,
      timestamp,
      version: "1.0.0",
      storage: storageStatus,
      webhooks: webhookStatus,
    };
    
    // Add issues and details if degraded
    if (!isHealthy) {
      response.issues = [];
      if (storageStatus === "error") response.issues.push("storage_error");
      if (webhookStatus === "queue_full") {
        response.issues.push("webhook_queue_full");
        response.pendingWebhookCount = pendingCount;
      }
    }
    
    res.status(isHealthy ? 200 : 503).json(response);
  });

  // Get all invoices
  app.get("/api/invoices", async (req, res) => {
    try {
      await storage.checkAndExpireInvoices();
      const invoices = await storage.getAllInvoices();
      res.json(invoices);
    } catch (error: any) {
      console.error("Error fetching invoices:", error);
      res.status(500).json({ error: error.message });
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
      console.error("Error fetching invoice:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Create new invoice
  app.post("/api/invoices", createInvoiceLimiter, async (req, res) => {
    try {
      const validatedData = insertInvoiceSchema.parse(req.body);
      
      // Check if the requested currency rail is enabled
      if (validatedData.currency === "Lightning" && !ENABLE_LN) {
        return res.status(400).json({ 
          error: "rail_disabled",
          message: "Lightning Network payments are currently disabled"
        });
      }
      if (validatedData.currency === "BTC" && !ENABLE_BTC) {
        return res.status(400).json({ 
          error: "rail_disabled",
          message: "Bitcoin on-chain payments are currently disabled"
        });
      }
      if (validatedData.currency === "XMR" && !ENABLE_XMR) {
        return res.status(400).json({ 
          error: "rail_disabled",
          message: "Monero payments are currently disabled"
        });
      }
      
      const invoice = await storage.createInvoice(validatedData);
      console.log(`✓ Invoice created: ${invoice.id} for ${invoice.amount} ${invoice.currency}`);
      res.status(201).json(invoice);
    } catch (error: any) {
      if (error.name === "ZodError") {
        console.error("Invalid invoice data:", error.errors);
        return res.status(400).json({ 
          error: "Invalid invoice data", 
          details: error.errors 
        });
      }
      console.error("Error creating invoice:", error);
      res.status(500).json({ error: error.message });
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
      if (invoice.status === "paid") {
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
        transactionId,
        confirmations,
      });

      await storage.updateInvoiceStatus(invoiceId, "paid", new Date());
      
      console.log(JSON.stringify({ invoiceId, rail: "ln", event: "settled", status: "confirmed" }));
      
      const altWebhookUrl = process.env.ALTOSTRATUS_WEBHOOK_URL;
      if (altWebhookUrl) {
        const updatedInvoice = await storage.getInvoice(invoiceId);
        const payload = {
          invoiceId: updatedInvoice!.id,
          amount: updatedInvoice!.amount,
          currency: updatedInvoice!.currency,
          status: "paid",
          paidAt: updatedInvoice!.paidAt,
          transactionId,
          confirmations,
        };
        
        invoicePayloads.set(invoiceId, payload);
        await queueWebhook(invoiceId, altWebhookUrl, payload);
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error processing Lightning settlement:", error);
      res.status(500).json({ error: error.message });
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
      if (invoice.status === "paid") {
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
        transactionId,
        confirmations,
        blockHeight,
      });

      await storage.updateInvoiceStatus(invoiceId, "paid", new Date());
      
      console.log(JSON.stringify({ invoiceId, rail: "btc", event: "confirmed", status: "confirmed" }));
      
      const altWebhookUrl = process.env.ALTOSTRATUS_WEBHOOK_URL;
      if (altWebhookUrl) {
        const updatedInvoice = await storage.getInvoice(invoiceId);
        const payload = {
          invoiceId: updatedInvoice!.id,
          amount: updatedInvoice!.amount,
          currency: updatedInvoice!.currency,
          status: "paid",
          paidAt: updatedInvoice!.paidAt,
          transactionId,
          confirmations,
          blockHeight,
        };
        
        invoicePayloads.set(invoiceId, payload);
        await queueWebhook(invoiceId, altWebhookUrl, payload);
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error processing Bitcoin confirmation:", error);
      res.status(500).json({ error: error.message });
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
      if (invoice.status === "paid") {
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
        transactionId,
        confirmations,
        blockHeight,
      });

      await storage.updateInvoiceStatus(invoiceId, "paid", new Date());
      
      console.log(JSON.stringify({ invoiceId, rail: "xmr", event: "confirmed", status: "confirmed" }));
      
      const altWebhookUrl = process.env.ALTOSTRATUS_WEBHOOK_URL;
      if (altWebhookUrl) {
        const updatedInvoice = await storage.getInvoice(invoiceId);
        const payload = {
          invoiceId: updatedInvoice!.id,
          amount: updatedInvoice!.amount,
          currency: updatedInvoice!.currency,
          status: "paid",
          paidAt: updatedInvoice!.paidAt,
          transactionId,
          confirmations,
          blockHeight,
        };
        
        invoicePayloads.set(invoiceId, payload);
        await queueWebhook(invoiceId, altWebhookUrl, payload);
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error processing Monero confirmation:", error);
      res.status(500).json({ error: error.message });
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

      if (invoice.status === "paid") {
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
      await storage.createPaymentTransaction({
        invoiceId,
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

      console.log(`✓ Invoice ${invoiceId} marked as paid (tx: ${transactionId}, confirmations: ${confirmations})`);

      // Queue webhook to main Altostratus app if configured
      const altostratusWebhookUrl = process.env.ALTOSTRATUS_WEBHOOK_URL;
      
      if (altostratusWebhookUrl && updatedInvoice) {
        const webhookPayload = {
          invoiceId: updatedInvoice.id,
          amount: updatedInvoice.amount,
          currency: updatedInvoice.currency,
          status: updatedInvoice.status,
          paidAt: updatedInvoice.paidAt,
          transactionId,
          confirmations,
          blockHeight,
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
        console.error("Invalid payment confirmation payload:", error.errors);
        return res.status(400).json({ 
          error: "Invalid payment confirmation data", 
          details: error.errors 
        });
      }
      console.error("Error processing payment confirmation:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get webhook logs for an invoice
  app.get("/api/invoices/:id/webhook-logs", async (req, res) => {
    try {
      const logs = await storage.getWebhookLogsByInvoice(req.params.id);
      res.json(logs);
    } catch (error: any) {
      console.error("Error fetching webhook logs:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get payment transactions for an invoice
  app.get("/api/invoices/:id/transactions", async (req, res) => {
    try {
      const transactions = await storage.getPaymentTransactionsByInvoice(req.params.id);
      res.json(transactions);
    } catch (error: any) {
      console.error("Error fetching payment transactions:", error);
      res.status(500).json({ error: error.message });
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
      console.error("Error checking expired invoices:", error);
      res.status(500).json({ error: error.message });
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
      console.error("Error purging expired invoices:", error);
      res.status(500).json({ error: error.message });
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
      console.error("Error processing webhook queue:", error);
      res.status(500).json({ error: error.message });
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
      console.error("Error cleaning up webhooks:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Template CRUD operations
  app.get("/api/templates", async (req, res) => {
    try {
      const templates = await storage.getAllTemplates();
      res.json(templates);
    } catch (error: any) {
      console.error("Error fetching templates:", error);
      res.status(500).json({ error: error.message });
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
      console.error("Error fetching template:", error);
      res.status(500).json({ error: error.message });
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
        console.error("Invalid template data:", error.errors);
        return res.status(400).json({ 
          error: "Invalid template data", 
          details: error.errors 
        });
      }
      console.error("Error creating template:", error);
      res.status(500).json({ error: error.message });
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
        console.error("Invalid template data:", error.errors);
        return res.status(400).json({ 
          error: "Invalid template data", 
          details: error.errors 
        });
      }
      console.error("Error updating template:", error);
      res.status(500).json({ error: error.message });
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
      console.error("Error deleting template:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Simulate payment confirmation (for testing only - disabled in production)
  app.post("/api/invoices/:id/simulate-payment", simulationLimiter, authenticateSimulation, async (req, res) => {
    try {
      const invoice = await storage.getInvoice(req.params.id);
      if (!invoice) {
        return res.status(404).json({ error: "Invoice not found" });
      }

      if (invoice.status === "paid") {
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
      console.error("Error simulating payment:", error);
      res.status(500).json({ error: error.message });
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
      if (invoice.status !== "paid" && invoice.status !== "expired") {
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
      console.error("Error anonymizing invoice:", error);
      res.status(500).json({ error: error.message });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
