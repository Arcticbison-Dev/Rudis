import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertInvoiceSchema } from "@shared/schema";
import crypto from "crypto";
import axios, { AxiosError } from "axios";
import * as monitoring from "./monitoring";
import { initializeLNbitsWebhook } from "./lnbits-webhook";
import { createLNbitsClient } from "./lnbitsClient";

// ─────────────────────────────────────────────────────────────────────────────
// Webhook delivery constants
// ─────────────────────────────────────────────────────────────────────────────
const WEBHOOK_TIMEOUT_MS = 30_000; // 30 s per attempt
const WEBHOOK_MAX_ATTEMPTS = 5;
const WEBHOOK_RETRY_DELAYS = [
  60_000,    // 1 min
  300_000,   // 5 min
  900_000,   // 15 min
  3_600_000, // 1 hr
  86_400_000 // 24 hr
];

// ─────────────────────────────────────────────────────────────────────────────
// HMAC signature helpers
// ─────────────────────────────────────────────────────────────────────────────
function generateWebhookSignature(payload: any): string {
  const secret = process.env.RUDIS_WEBHOOK_SECRET;
  if (!secret) return "";
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: map invoice to public-facing response shape
// ─────────────────────────────────────────────────────────────────────────────
function mapInvoiceResponse(invoice: any): any {
  const response: any = {
    id:          invoice.id,
    amount:      invoice.amount,
    currency:    invoice.currency,
    status:      invoice.status,
    description: invoice.description,
    createdAt:   invoice.createdAt,
    expiresAt:   invoice.expiresAt,
    paymentRail: invoice.railType,
    metadata:    invoice.metadata,
  };

  if (invoice.railType === "lightning" || invoice.currency === "Lightning") {
    response.paymentRequest = invoice.bolt11Invoice;
    response.paymentHash    = invoice.lnPaymentHash;
  }

  if (invoice.railType === "bitcoin" || invoice.currency === "BTC") {
    response.bitcoinAddress = invoice.derivedAddress || invoice.paymentAddress;
    response.bitcoinAmount  = invoice.amount;
  }

  if (invoice.railType === "monero" || invoice.currency === "XMR") {
    response.moneroAddress   = invoice.subaddress || invoice.paymentAddress;
    response.moneroAmount    = invoice.amount;
  }

  if (invoice.paidAt) {
    response.paidAt = invoice.paidAt instanceof Date
      ? invoice.paidAt.toISOString()
      : new Date(invoice.paidAt).toISOString();
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
        // Layer 1: Cloudflare Access service token (machine-to-machine identity)
        // Injected when CF_ACCESS_CLIENT_ID + CF_ACCESS_CLIENT_SECRET are configured.
        ...(process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET
          ? {
              "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID,
              "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET,
            }
          : {}),
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

    return false;
  }
}

// Process pending webhooks from database (called by cron job)
async function processPendingWebhooks(): Promise<void> {
  try {
    const pendingWebhooks = await storage.getPendingWebhooks();
    
    if (pendingWebhooks.length === 0) return;

    console.log(`Processing ${pendingWebhooks.length} pending webhook(s)`);

    for (const webhookLog of pendingWebhooks) {
      // Parse the stored payload
      let payload: any;
      try {
        payload = JSON.parse(webhookLog.payload || "{}");
      } catch {
        console.error(`Failed to parse payload for webhook ${webhookLog.id}`);
        await storage.updateWebhookLog(webhookLog.id, {
          status: "failed",
          errorMessage: "Invalid payload JSON",
          lastAttemptAt: new Date(),
        });
        continue;
      }

      await attemptWebhookDelivery(
        webhookLog.id,
        webhookLog.invoiceId,
        webhookLog.url,
        payload,
        parseInt(webhookLog.attempt || "1", 10)
      );
    }
  } catch (error) {
    console.error("Error processing pending webhooks:", error);
  }
}

export async function registerRoutes(app: Express): Promise<Server> {

  // ─────────────────────────────────────────────────────────────────────────
  // Health check
  // ─────────────────────────────────────────────────────────────────────────
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Invoice CRUD
  // ─────────────────────────────────────────────────────────────────────────

  // POST /api/invoices — create a new invoice
  app.post("/api/invoices", async (req: Request, res: Response) => {
    try {
      const apiKey = req.headers["x-api-key"];
      if (!apiKey || apiKey !== process.env.INVOICE_API_KEY) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const parsed = insertInvoiceSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body", details: parsed.error.format() });
      }

      const invoice = await storage.createInvoice(parsed.data);

      // For Lightning invoices, call LNbits immediately to generate the BOLT11
      let finalInvoice = invoice;
      if (invoice.currency === "Lightning") {
        try {
          const lnbitsApiUrl = process.env.LNBITS_API_URL;
          const lnbitsWalletKey = process.env.LNBITS_WALLET_KEY;
          if (lnbitsApiUrl && lnbitsWalletKey) {
            const lnbitsClient = createLNbitsClient({
              apiUrl: lnbitsApiUrl,
              walletKey: lnbitsWalletKey,
              httpTimeout: parseInt(process.env.LN_HTTP_TIMEOUT || "10000", 10),
            });

            // Convert BTC decimal amount to sats
            const amountSats = Math.ceil(parseFloat(invoice.amount) * 100_000_000);
            const memo = invoice.description || `Invoice ${invoice.id}`;

            // Webhook URL: base + secret token in path (same pattern as ln-adapter)
            let webhookUrl: string | undefined;
            const lnWebhookBase = process.env.LNBITS_WEBHOOK_URL;
            const lnWebhookSecret = process.env.LNBITS_WEBHOOK_SECRET;
            if (lnWebhookBase && lnWebhookSecret) {
              webhookUrl = `${lnWebhookBase}/${lnWebhookSecret}`;
            }

            const lnbitsInvoice = await lnbitsClient.createInvoice(amountSats, memo, webhookUrl);
            console.log(`[LN] Created LNbits invoice for ${invoice.id}: hash=${lnbitsInvoice.payment_hash}`);

            // Update invoice record with BOLT11 and payment tracking fields
            const updated = await storage.updateInvoice(invoice.id, {
              bolt11Invoice: lnbitsInvoice.payment_request || null,
              lnPaymentHash: lnbitsInvoice.payment_hash || null,
              lnCheckingId: lnbitsInvoice.checking_id || null,
              paymentAddress: lnbitsInvoice.payment_request || invoice.paymentAddress,
              railType: "ln",
            });
            if (updated) finalInvoice = updated;
          } else {
            console.warn("[LN] LNBITS_API_URL or LNBITS_WALLET_KEY not set — skipping LNbits call");
          }
        } catch (lnError) {
          const msg = lnError instanceof Error ? lnError.message : String(lnError);
          console.error(`[LN] Failed to create LNbits invoice for ${invoice.id}:`, msg);
          // Non-fatal: return invoice without bolt11 so Altostratus can handle gracefully
        }
      }

      return res.status(201).json(mapInvoiceResponse(finalInvoice));
    } catch (error) {
      console.error("Error creating invoice:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/invoices/:id — fetch a single invoice
  app.get("/api/invoices/:id", async (req: Request, res: Response) => {
    try {
      const apiKey = req.headers["x-api-key"];
      if (!apiKey || apiKey !== process.env.INVOICE_API_KEY) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const invoice = await storage.getInvoice(req.params.id);
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });
      return res.json(mapInvoiceResponse(invoice));
    } catch (error) {
      console.error("Error fetching invoice:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/invoices — list invoices (optionally filter by status)
  app.get("/api/invoices", async (req: Request, res: Response) => {
    try {
      const apiKey = req.headers["x-api-key"];
      if (!apiKey || apiKey !== process.env.INVOICE_API_KEY) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const statusFilter = req.query.status as string | undefined;
      const allInvoices = await storage.getAllInvoices();
      const filtered = statusFilter
        ? allInvoices.filter((inv: any) => inv.status === statusFilter)
        : allInvoices;
      return res.json(filtered.map(mapInvoiceResponse));
    } catch (error) {
      console.error("Error listing invoices:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // LNbits webhook — Lightning payment confirmation
  // ─────────────────────────────────────────────────────────────────────────
  app.post("/api/lnbits/webhook", async (req: Request, res: Response) => {
    try {
      // Validate LNbits HMAC callback auth
      const lnbitsSecret = process.env.LNBITS_WEBHOOK_SECRET;
      if (lnbitsSecret) {
        const incomingSig = req.headers["x-lnbits-signature"] as string | undefined;
        if (!incomingSig) {
          return res.status(401).json({ error: "Missing signature" });
        }
        const rawBody = JSON.stringify(req.body);
        const expectedSig = crypto.createHmac("sha256", lnbitsSecret).update(rawBody).digest("hex");
        if (!crypto.timingSafeEqual(Buffer.from(incomingSig), Buffer.from(expectedSig))) {
          return res.status(401).json({ error: "Invalid signature" });
        }
      }

      const { payment_hash, payment_preimage, amount } = req.body;
      if (!payment_hash) {
        return res.status(400).json({ error: "Missing payment_hash" });
      }

      // Look up the invoice by payment hash (lnPaymentHash field)
      const allInvoices = await storage.getAllInvoices();
      const invoice = allInvoices.find((inv: any) => inv.lnPaymentHash === payment_hash);
      if (!invoice) {
        console.log(`LNbits webhook: no invoice found for payment_hash ${payment_hash}`);
        return res.json({ received: true });
      }

      // Idempotency: skip if already paid
      if (invoice.status === "paid") {
        console.log(`LNbits webhook: invoice ${invoice.id} already paid, skipping`);
        return res.json({ received: true });
      }

      // Mark invoice as paid
      const paidInvoice = await storage.updateInvoiceStatus(invoice.id, "paid", new Date());

      console.log(`✓ Lightning payment confirmed for invoice ${invoice.id}`);

      // Fire webhook to Altostratus if configured
      const webhookUrl = process.env.RUDIS_WEBHOOK_URL;
      if (webhookUrl) {
        const webhookPayload = {
          event: "payment.confirmed",
          invoiceId: invoice.id,
          paymentRail: "lightning",
          amount: invoice.amount,
          currency: invoice.currency,
          metadata: (invoice as any).metadata,
          paidAt: paidInvoice?.paidAt instanceof Date
            ? paidInvoice.paidAt.toISOString()
            : new Date().toISOString(),
        };
        await queueWebhook(invoice.id, webhookUrl, webhookPayload);
        // Immediate first attempt
        const pendingWebhooks = await storage.getPendingWebhooks();
        const thisWebhook = pendingWebhooks.find((w: any) => w.invoiceId === invoice.id);
        if (thisWebhook) {
          await attemptWebhookDelivery(thisWebhook.id, invoice.id, webhookUrl, webhookPayload, 1);
        }
      }

      return res.json({ received: true });
    } catch (error) {
      console.error("Error processing LNbits webhook:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Bitcoin payment polling endpoint (called by BTC monitoring service)
  // ─────────────────────────────────────────────────────────────────────────
  app.post("/api/bitcoin/payment-confirmed", async (req: Request, res: Response) => {
    try {
      const apiKey = req.headers["x-api-key"];
      if (!apiKey || apiKey !== process.env.INVOICE_API_KEY) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { invoiceId, txid, confirmations } = req.body;
      if (!invoiceId) {
        return res.status(400).json({ error: "Missing invoiceId" });
      }

      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });

      if (invoice.status === "paid") {
        return res.json({ received: true, message: "Already paid" });
      }

      const paidInvoice = await storage.updateInvoiceStatus(invoiceId, "paid", new Date());

      console.log(`✓ Bitcoin payment confirmed for invoice ${invoiceId} (txid: ${txid}, confirmations: ${confirmations})`);

      const webhookUrl = process.env.RUDIS_WEBHOOK_URL;
      if (webhookUrl) {
        const webhookPayload = {
          event: "payment.confirmed",
          invoiceId,
          paymentRail: "bitcoin",
          amount: invoice.amount,
          currency: invoice.currency,
          metadata: (invoice as any).metadata,
          paidAt: paidInvoice?.paidAt instanceof Date
            ? paidInvoice.paidAt.toISOString()
            : new Date().toISOString(),
          txid,
          confirmations,
        };
        await queueWebhook(invoiceId, webhookUrl, webhookPayload);
        const pendingWebhooks = await storage.getPendingWebhooks();
        const thisWebhook = pendingWebhooks.find((w: any) => w.invoiceId === invoiceId);
        if (thisWebhook) {
          await attemptWebhookDelivery(thisWebhook.id, invoiceId, webhookUrl, webhookPayload, 1);
        }
      }

      return res.json({ received: true });
    } catch (error) {
      console.error("Error processing Bitcoin payment confirmation:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Monero payment confirmation (called by XMR monitoring service)
  // ─────────────────────────────────────────────────────────────────────────
  app.post("/api/monero/payment-confirmed", async (req: Request, res: Response) => {
    try {
      const apiKey = req.headers["x-api-key"];
      if (!apiKey || apiKey !== process.env.INVOICE_API_KEY) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { invoiceId, txid, confirmations } = req.body;
      if (!invoiceId) {
        return res.status(400).json({ error: "Missing invoiceId" });
      }

      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });

      if (invoice.status === "paid") {
        return res.json({ received: true, message: "Already paid" });
      }

      const paidInvoice = await storage.updateInvoiceStatus(invoiceId, "paid", new Date());

      console.log(`✓ Monero payment confirmed for invoice ${invoiceId} (txid: ${txid}, confirmations: ${confirmations})`);

      const webhookUrl = process.env.RUDIS_WEBHOOK_URL;
      if (webhookUrl) {
        const webhookPayload = {
          event: "payment.confirmed",
          invoiceId,
          paymentRail: "monero",
          amount: invoice.amount,
          currency: invoice.currency,
          metadata: (invoice as any).metadata,
          paidAt: paidInvoice?.paidAt instanceof Date
            ? paidInvoice.paidAt.toISOString()
            : new Date().toISOString(),
          txid,
          confirmations,
        };
        await queueWebhook(invoiceId, webhookUrl, webhookPayload);
        const pendingWebhooks = await storage.getPendingWebhooks();
        const thisWebhook = pendingWebhooks.find((w: any) => w.invoiceId === invoiceId);
        if (thisWebhook) {
          await attemptWebhookDelivery(thisWebhook.id, invoiceId, webhookUrl, webhookPayload, 1);
        }
      }

      return res.json({ received: true });
    } catch (error) {
      console.error("Error processing Monero payment confirmation:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Webhook retry cron — called every minute by the scheduler
  // ─────────────────────────────────────────────────────────────────────────
  app.post("/api/internal/process-webhooks", async (req: Request, res: Response) => {
    try {
      const cronSecret = process.env.CRON_SECRET;
      if (cronSecret) {
        const authHeader = req.headers["authorization"];
        if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
          return res.status(401).json({ error: "Unauthorized" });
        }
      }

      await processPendingWebhooks();
      return res.json({ processed: true });
    } catch (error) {
      console.error("Error in process-webhooks cron:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // LNbits webhook initialization
  // ─────────────────────────────────────────────────────────────────────────
  await initializeLNbitsWebhook(app);

  // ─────────────────────────────────────────────────────────────────────────
  // Periodic webhook retry (every 60 seconds)
  // ─────────────────────────────────────────────────────────────────────────
  setInterval(processPendingWebhooks, 60_000);

  const httpServer = createServer(app);

  return httpServer;
}
