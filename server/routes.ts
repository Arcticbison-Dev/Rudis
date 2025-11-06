import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertInvoiceSchema, insertTemplateSchema } from "@shared/schema";
import { paymentConfirmationSchema } from "@shared/webhook-schema";
import axios, { AxiosError } from "axios";

// Configuration from environment variables with sensible defaults and validation
const parseIntWithDefault = (value: string | undefined, defaultValue: number): number => {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
};

const WEBHOOK_TIMEOUT_MS = parseIntWithDefault(process.env.WEBHOOK_TIMEOUT_MS, 10000);
const WEBHOOK_RETRY_ATTEMPTS = parseIntWithDefault(process.env.WEBHOOK_RETRY_ATTEMPTS, 3);
const WEBHOOK_RETRY_DELAY_1 = parseIntWithDefault(process.env.WEBHOOK_RETRY_DELAY_1, 1000);
const WEBHOOK_RETRY_DELAY_2 = parseIntWithDefault(process.env.WEBHOOK_RETRY_DELAY_2, 3000);
const WEBHOOK_RETRY_DELAY_3 = parseIntWithDefault(process.env.WEBHOOK_RETRY_DELAY_3, 9000);
const WEBHOOK_RETRY_DELAYS = [WEBHOOK_RETRY_DELAY_1, WEBHOOK_RETRY_DELAY_2, WEBHOOK_RETRY_DELAY_3];
const CLEANUP_EXPIRED_DAYS = Math.max(30, Math.min(90, parseIntWithDefault(process.env.CLEANUP_EXPIRED_DAYS, 90)));

async function sendWebhookWithRetry(
  url: string,
  payload: any,
  invoiceId: string,
  attempt: number = 1
): Promise<{ success: boolean; statusCode?: number; error?: string; responseBody?: string }> {
  try {
    const response = await axios.post(url, payload, {
      timeout: WEBHOOK_TIMEOUT_MS,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Altostratus-Payments/1.0",
      },
      validateStatus: (status) => status < 500, // Don't throw on 4xx
    });

    const success = response.status >= 200 && response.status < 300;

    await storage.createWebhookLog({
      invoiceId,
      url,
      status: success ? "success" : "failed",
      statusCode: response.status,
      payload: JSON.stringify(payload),
      responseBody: JSON.stringify(response.data),
      attempt,
    });

    if (!success && attempt < WEBHOOK_RETRY_ATTEMPTS) {
      const delay = WEBHOOK_RETRY_DELAYS[attempt - 1] || 9000;
      console.log(`Webhook attempt ${attempt} failed with status ${response.status}, retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return sendWebhookWithRetry(url, payload, invoiceId, attempt + 1);
    }

    return {
      success,
      statusCode: response.status,
      responseBody: JSON.stringify(response.data),
    };
  } catch (error: any) {
    const axiosError = error as AxiosError;
    const errorMessage = axiosError.message || "Unknown error";
    const statusCode = axiosError.response?.status;

    await storage.createWebhookLog({
      invoiceId,
      url,
      status: "failed",
      statusCode,
      errorMessage,
      payload: JSON.stringify(payload),
      attempt,
    });

    if (attempt < WEBHOOK_RETRY_ATTEMPTS) {
      const delay = WEBHOOK_RETRY_DELAYS[attempt - 1] || 9000;
      console.log(`Webhook attempt ${attempt} failed: ${errorMessage}, retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return sendWebhookWithRetry(url, payload, invoiceId, attempt + 1);
    }

    return {
      success: false,
      statusCode,
      error: errorMessage,
    };
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
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
  app.post("/api/invoices", async (req, res) => {
    try {
      const validatedData = insertInvoiceSchema.parse(req.body);
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

  // Webhook endpoint - receives payment confirmations from blockchain listeners
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

      // Send webhook to main Altostratus app if configured
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

        console.log(`Sending webhook to Altostratus app: ${altostratusWebhookUrl}`);
        
        const result = await sendWebhookWithRetry(
          altostratusWebhookUrl,
          webhookPayload,
          invoiceId
        );

        if (result.success) {
          console.log(`✓ Webhook delivered successfully to Altostratus app for invoice ${invoiceId}`);
        } else {
          console.error(`✗ Failed to deliver webhook after ${WEBHOOK_RETRY_ATTEMPTS} attempts: ${result.error || `Status ${result.statusCode}`}`);
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
      console.log(`✓ Template created: ${template.id} - ${template.name}`);
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

  // Simulate payment confirmation (for testing only - remove in production)
  app.post("/api/invoices/:id/simulate-payment", async (req, res) => {
    try {
      const invoice = await storage.getInvoice(req.params.id);
      if (!invoice) {
        return res.status(404).json({ error: "Invoice not found" });
      }

      if (invoice.status === "paid") {
        return res.json({ message: "Invoice already paid" });
      }

      // Simulate receiving a properly validated webhook from blockchain listener
      const simulatedWebhookPayload = {
        invoiceId: invoice.id,
        transactionId: `simulated_tx_${Date.now()}`,
        confirmations: 6,
        blockHeight: Math.floor(Math.random() * 1000000),
      };

      console.log(`Simulating payment for invoice ${invoice.id}...`);

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

  const httpServer = createServer(app);

  return httpServer;
}
