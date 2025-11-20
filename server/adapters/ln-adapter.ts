/**
 * Lightning Network (LN) Rail Adapter
 * 
 * Wraps the rail-ln microservice and implements the common RailAdapter interface.
 * Handles invoice generation, settlement tracking, and health checks for Lightning payments.
 */

import axios, { AxiosError } from "axios";
import crypto from "crypto";
import {
  type RailAdapter,
  type CreatePaymentRequest,
  type CreatePaymentResponse,
  type RailPaymentStatus,
  type RailHealth,
  type BlockchainTransaction,
  RailUnavailableError,
  PaymentNotFoundError,
} from "../../shared/payment-orchestrator";
import { storage } from "../storage"; // Only used in getPaymentStatus fallback
import { logPaymentCreateFailed, logConfigError, logPaymentCreated } from "../monitoring";
import { createLNbitsClient } from "../lnbitsClient";

/**
 * LN rail service response types (rail-specific)
 */
interface LnCreateResponse {
  paymentRequest: string; // BOLT11 invoice
  paymentHash: string;
  expiresAt: string;
}

interface LnStatusResponse {
  status: "pending" | "settled" | "expired";
  amountReceivedMsat: string;
  settledAt?: string;
}

interface LnHealthResponse {
  ok: boolean;
  lnd?: string;
}

/**
 * Lightning Network Configuration
 * 
 * Direct LNbits Integration (current implementation):
 * - LN_BACKEND: Backend type (only "lnbits" supported)
 * - LNBITS_API_URL: LNbits API endpoint
 * - LNBITS_WALLET_KEY: LNbits wallet invoice/read key
 * - LNBITS_WALLET_ID: Optional wallet ID for multi-wallet setups
 * - LN_MIN_AMOUNT_SATS: Minimum invoice amount in satoshis
 * - LN_MAX_AMOUNT_SATS: Maximum invoice amount in satoshis
 * - LN_HTTP_TIMEOUT: HTTP timeout for API calls (ms)
 * - LN_INVOICE_EXPIRY: Invoice expiration time (seconds)
 * - LN_POLL_INTERVAL_MS: Poll interval for checking invoices (ms)
 * 
 * Webhooks (optional):
 * - LNBITS_WEBHOOK_URL: Webhook endpoint for payment notifications
 * - LNBITS_WEBHOOK_SECRET: Secret for HMAC webhook verification
 * - LNBITS_WEBHOOK_TIMEOUT_MS: Webhook timeout (ms)
 * 
 * LND Backend (used by LNbits, NOT by this app):
 * - LND_GRPC_HOST: LND gRPC host
 * - LND_TLS_CERT_BASE64: LND TLS certificate (base64)
 * - LND_INVOICE_MACAROON: LND invoice macaroon
 * - LND_NETWORK: LND network (mainnet/testnet/regtest)
 */
interface LnConfig {
  // Rail configuration
  enabled: boolean;
  backend: string;
  
  // LNbits API configuration
  lnbitsApiUrl: string | null;
  lnbitsWalletKey: string | null;
  lnbitsWalletId: string | null;
  
  // Amount limits and timeouts
  minAmountSats: number;
  maxAmountSats: number;
  httpTimeout: number;
  invoiceExpiry: number;
  pollInterval: number;
  
  // Webhook configuration (optional)
  webhookUrl: string | null;
  webhookSecret: string | null;
  webhookTimeout: number;
  
  // Debug logging
  debugLogging: boolean;
  logApiBodies: boolean;
  
  // Configuration state
  isConfigured: boolean;
  configErrors: string[];
}

/**
 * Lightning Network Rail Adapter
 * 
 * Safe-Stubbing:
 * When LN service is not configured or unavailable, adapter returns controlled
 * errors instead of attempting HTTP calls. This allows the system to run without
 * crashing when LN is not yet integrated.
 * 
 * Future: Will support direct LND, CLN, LNbits, and Eclair backends.
 */
export class LnAdapter implements RailAdapter {
  readonly currency = "LN" as const;
  private readonly config: LnConfig;
  private readonly confirmationsRequired = 0; // LN is instant (0-conf)

  constructor() {
    // Load and validate configuration
    this.config = this.loadConfig();
    
    // Validate configuration on startup
    this.validateConfig();
  }
  
  /**
   * Load Lightning Network configuration from environment
   * Implements Step 1: LN Rail Bootstrapping & Config
   */
  private loadConfig(): LnConfig {
    const configErrors: string[] = [];
    
    // 1. Feature flag
    const enabled = process.env.ENABLE_LN === "true";
    
    // 2. Backend selection
    const backend = process.env.LN_BACKEND || "lnbits";
    
    // 3. LNbits API configuration
    const lnbitsApiUrl = process.env.LNBITS_API_URL || null;
    const lnbitsWalletKey = process.env.LNBITS_WALLET_KEY || null;
    const lnbitsWalletId = process.env.LNBITS_WALLET_ID || null;
    
    // 4. Optional knobs - Amount limits
    const minAmountSats = parseInt(process.env.LN_MIN_AMOUNT_SATS || "1", 10);
    const maxAmountSats = parseInt(process.env.LN_MAX_AMOUNT_SATS || "100000", 10);
    
    // 5. Optional knobs - Timeouts
    const httpTimeout = parseInt(process.env.LN_HTTP_TIMEOUT || "5000", 10);
    const invoiceExpiry = parseInt(process.env.LN_INVOICE_EXPIRY || "3600", 10);
    const pollInterval = parseInt(process.env.LN_POLL_INTERVAL_MS || "10000", 10);
    
    // 6. Webhook configuration (optional)
    const webhookUrl = process.env.LNBITS_WEBHOOK_URL || null;
    const webhookSecret = process.env.LNBITS_WEBHOOK_SECRET || null;
    const webhookTimeout = parseInt(process.env.LNBITS_WEBHOOK_TIMEOUT_MS || "5000", 10);
    
    // 7. Debug logging
    const debugLogging = process.env.LN_DEBUG_LOGGING === "true";
    const logApiBodies = process.env.LN_LOG_API_BODIES === "true";
    
    // Validate backend selection
    if (enabled && backend !== "lnbits") {
      configErrors.push(`Unsupported LN_BACKEND: "${backend}". Only "lnbits" is supported.`);
    }
    
    // Validate required LNbits configuration
    if (enabled && !lnbitsApiUrl) {
      configErrors.push("LNBITS_API_URL is required when ENABLE_LN=true");
    }
    
    if (enabled && !lnbitsWalletKey) {
      configErrors.push("LNBITS_WALLET_KEY is required when ENABLE_LN=true");
    }
    
    // Validate amount limits
    if (minAmountSats < 1) {
      configErrors.push(`LN_MIN_AMOUNT_SATS must be >= 1 (got ${minAmountSats})`);
    }
    
    if (maxAmountSats < minAmountSats) {
      configErrors.push(`LN_MAX_AMOUNT_SATS (${maxAmountSats}) must be >= LN_MIN_AMOUNT_SATS (${minAmountSats})`);
    }
    
    // Validate webhook secret strength (if webhooks enabled)
    // SECURITY: Weak secrets are vulnerable to brute force attacks
    if (enabled && webhookUrl && webhookSecret) {
      const MIN_SECRET_LENGTH = 32;
      if (webhookSecret.length < MIN_SECRET_LENGTH) {
        configErrors.push(
          `LNBITS_WEBHOOK_SECRET must be >= ${MIN_SECRET_LENGTH} characters (got ${webhookSecret.length}). ` +
          `Generate with: openssl rand -hex 32`
        );
      }
    }
    
    const isConfigured = enabled && lnbitsApiUrl !== null && lnbitsWalletKey !== null && configErrors.length === 0;
    
    return {
      enabled,
      backend,
      lnbitsApiUrl,
      lnbitsWalletKey,
      lnbitsWalletId,
      minAmountSats,
      maxAmountSats,
      httpTimeout,
      invoiceExpiry,
      pollInterval,
      webhookUrl,
      webhookSecret,
      webhookTimeout,
      debugLogging,
      logApiBodies,
      isConfigured,
      configErrors,
    };
  }
  
  /**
   * Validate Lightning Network configuration on startup
   * Implements Step 1: Startup validation with clear error logging
   */
  private validateConfig(): void {
    // If LN is disabled, log and return
    if (!this.config.enabled) {
      console.log("╔═══════════════════════════════════════════════════════════╗");
      console.log("║ Lightning Network Rail: DISABLED                         ║");
      console.log("╠═══════════════════════════════════════════════════════════╣");
      console.log("║ Set ENABLE_LN=true to enable Lightning payments          ║");
      console.log("╚═══════════════════════════════════════════════════════════╝");
      return;
    }
    
    // LN is enabled - validate configuration
    console.log("╔═══════════════════════════════════════════════════════════╗");
    console.log("║ Lightning Network Rail: ENABLED                          ║");
    console.log("╠═══════════════════════════════════════════════════════════╣");
    
    // Check for configuration errors
    if (this.config.configErrors.length > 0) {
      console.error("║ ❌ CONFIGURATION ERRORS DETECTED                          ║");
      console.error("╠═══════════════════════════════════════════════════════════╣");
      
      for (const error of this.config.configErrors) {
        const padding = " ".repeat(Math.max(0, 59 - error.length));
        console.error(`║ • ${error}${padding}║`);
      }
      
      console.error("╠═══════════════════════════════════════════════════════════╣");
      console.error("║ Lightning rail will be DISABLED due to invalid config    ║");
      console.error("╚═══════════════════════════════════════════════════════════╝");
      
      // Log structured error event
      logConfigError("LN", this.config.configErrors, "Lightning Network configuration validation failed");
      
      // Mark as not configured so rail returns disabled errors
      this.config.isConfigured = false;
      return;
    }
    
    // Configuration is valid - log success
    console.log(`║ Backend:         ${this.config.backend}                                    ║`);
    console.log(`║ API URL:         ${this.config.lnbitsApiUrl?.substring(0, 40) || "not set"}...       ║`);
    console.log(`║ Amount Range:    ${this.config.minAmountSats}-${this.config.maxAmountSats} sats                        ║`);
    console.log(`║ Invoice Expiry:  ${this.config.invoiceExpiry}s (${this.config.invoiceExpiry / 60} min)                    ║`);
    console.log(`║ HTTP Timeout:    ${this.config.httpTimeout}ms                                ║`);
    console.log(`║ Poll Interval:   ${this.config.pollInterval}ms                               ║`);
    
    if (this.config.webhookUrl) {
      console.log("║ Webhooks:        ENABLED (primary detection)              ║");
      console.log("║ Polling:         ENABLED (safety net)                     ║");
    } else {
      console.log("║ Webhooks:        DISABLED                                  ║");
      console.log("║ Polling:         ENABLED (primary detection)              ║");
    }
    
    if (this.config.debugLogging) {
      console.log("║ Debug Logging:   ENABLED (disable in production!)         ║");
    }
    
    console.log("║                                                           ║");
    console.log("║ ✓ Lightning Network ready for invoice generation         ║");
    console.log("╚═══════════════════════════════════════════════════════════╝");
  }
  
  /**
   * Check if LN rail is enabled and configured
   */
  private get isEnabled(): boolean {
    return this.config.enabled && this.config.isConfigured;
  }

  /**
   * Create a Lightning invoice
   * 
   * Step 3: Complete implementation with amount validation, LNbits integration, and DB write
   */
  async createPayment(request: CreatePaymentRequest): Promise<CreatePaymentResponse> {
    // Step 1: Check if LN is disabled
    if (!this.config.enabled) {
      logPaymentCreateFailed(
        "LN",
        request.invoiceId,
        "ln_disabled",
        "Lightning Network rail is disabled (ENABLE_LN=false)"
      );
      
      throw new RailUnavailableError("LN", {
        operation: "createPayment",
        reason: "ln_disabled",
        details: "Lightning Network rail is disabled. Set ENABLE_LN=true to enable LN payments.",
        invoiceId: request.invoiceId,
      });
    }
    
    // Step 1: Check if configuration is invalid
    if (!this.config.isConfigured) {
      logPaymentCreateFailed(
        "LN",
        request.invoiceId,
        "ln_config_invalid",
        this.config.configErrors.join("; ")
      );
      
      throw new RailUnavailableError("LN", {
        operation: "createPayment",
        reason: "ln_config_invalid",
        details: `Lightning Network configuration is invalid: ${this.config.configErrors.join("; ")}`,
        invoiceId: request.invoiceId,
      });
    }

    // Step 3: Amount validation
    const amountSats = parseInt(request.amountAtomic, 10);
    
    if (isNaN(amountSats) || amountSats < this.config.minAmountSats) {
      logPaymentCreateFailed(
        "LN",
        request.invoiceId,
        "ln_amount_out_of_range",
        `Amount ${amountSats} sats is below minimum ${this.config.minAmountSats} sats`
      );
      
      throw new RailUnavailableError("LN", {
        operation: "createPayment",
        reason: "ln_amount_out_of_range",
        details: `Lightning amount out of range: ${amountSats} sats is below minimum ${this.config.minAmountSats} sats`,
        invoiceId: request.invoiceId,
      });
    }
    
    if (amountSats > this.config.maxAmountSats) {
      logPaymentCreateFailed(
        "LN",
        request.invoiceId,
        "ln_amount_out_of_range",
        `Amount ${amountSats} sats exceeds maximum ${this.config.maxAmountSats} sats`
      );
      
      throw new RailUnavailableError("LN", {
        operation: "createPayment",
        reason: "ln_amount_out_of_range",
        details: `Lightning amount out of range: ${amountSats} sats exceeds maximum ${this.config.maxAmountSats} sats`,
        invoiceId: request.invoiceId,
      });
    }

    try {
      // Step 3: Call LNbits to create invoice
      const lnbitsClient = createLNbitsClient({
        apiUrl: this.config.lnbitsApiUrl!,
        walletKey: this.config.lnbitsWalletKey!,
        httpTimeout: this.config.httpTimeout,
        debugLogging: this.config.debugLogging,
      });

      const memo = request.metadata?.description as string | undefined || `Invoice ${request.invoiceId}`;
      
      // Construct webhook URL with secret token in path (if configured)
      // Pattern: https://my-app.com/rails/ln/webhook/:token
      // This is more secure than query params (which are logged everywhere)
      let webhookUrl: string | undefined = undefined;
      if (this.config.webhookUrl && this.config.webhookSecret) {
        // Append secret token to base webhook URL
        webhookUrl = `${this.config.webhookUrl}/${this.config.webhookSecret}`;
      }

      const lnbitsInvoice = await lnbitsClient.createInvoice(amountSats, memo, webhookUrl);

      // Step 3: Calculate invoice expiry (current time + invoice expiry duration)
      const expiresAt = new Date(Date.now() + this.config.invoiceExpiry * 1000);

      // Step 3: Return unified response (stateless - no storage operations)
      // POST /payments route will update invoice with BOLT11 and metadata
      return {
        paymentAddress: lnbitsInvoice.payment_request, // BOLT11 invoice for client
        confirmationsRequired: this.confirmationsRequired,
        expiresAt: expiresAt.toISOString(),
        metadata: {
          paymentHash: lnbitsInvoice.payment_hash, // For status tracking & DB
          checkingId: lnbitsInvoice.checking_id, // For LNbits status API & DB
          railType: "ln", // For DB update
        },
      };
    } catch (error) {
      // Log creation failure
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      logPaymentCreateFailed("LN", request.invoiceId, "ln_api_error", errorMsg);

      // Re-throw for caller to handle
      throw new Error(`Failed to create Lightning invoice: ${errorMsg}`);
    }
  }

  /**
   * Get payment status from LN rail
   * 
   * ALWAYS reads from database only - no live RPC calls on read path.
   * Background workers/webhooks update DB, GET /payments/:id reads from DB.
   * This works regardless of LNbits configuration status.
   */
  async getPaymentStatus(invoiceId: string): Promise<RailPaymentStatus> {
    // ALWAYS read from database only - no live RPC calls on read path
    // Background workers/webhooks update DB, GET /payments/:id reads from DB
    // This ensures fast response times and no LNbits load on status queries
    // Works even when LNbits is not configured (DB-only reads)
    return this.getPaymentStatusFromDb(invoiceId);
  }

  /**
   * Get payment status from database only (safe-stub fallback)
   * 
   * Used when LN service is not configured. Reads invoice and transaction
   * data from database to provide status without external calls.
   */
  private async getPaymentStatusFromDb(invoiceId: string): Promise<RailPaymentStatus> {
    const invoice = await storage.getInvoice(invoiceId);
    
    if (!invoice) {
      throw new PaymentNotFoundError(invoiceId);
    }

    // Only process Lightning invoices
    if (invoice.currency !== "Lightning") {
      throw new PaymentNotFoundError(invoiceId);
    }

    const txs = await storage.getPaymentTransactionsByInvoice(invoiceId);

    // Map invoice status to rail status
    let status: RailPaymentStatus["status"];
    if (invoice.status === "expired") {
      status = "expired";
    } else if (invoice.status === "confirmed") {
      status = "confirmed";
    } else {
      status = "pending";
    }

    // Build transaction list from database
    const transactions: BlockchainTransaction[] = txs.map((tx) => ({
      txidHash: tx.transactionId, // Already hashed in DB
      amountAtomic: invoice.amountPaidAtomic || "0",
      confirmations: parseInt(tx.confirmations, 10),
      blockHeight: tx.blockHeight ? parseInt(tx.blockHeight, 10) : undefined,
      detectedAt: tx.confirmedAt.toISOString(),
    }));

    return {
      status,
      confirmations: 0, // LN is always 0-conf
      amountReceived: invoice.amountPaidAtomic || "0",
      transactions,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Check LN rail health
   * 
   * Step 1: Returns appropriate status based on configuration state
   */
  async healthCheck(): Promise<RailHealth> {
    // Return disabled status if LN is disabled
    if (!this.config.enabled) {
      return {
        ok: false,
        rail: "LN",
        error: "Lightning Network rail is disabled (ENABLE_LN=false)",
        backendStatus: "disabled",
      };
    }
    
    // Return config error if misconfigured
    if (!this.config.isConfigured) {
      return {
        ok: false,
        rail: "LN",
        error: `Configuration invalid: ${this.config.configErrors.join("; ")}`,
        backendStatus: "not_configured",
      };
    }

    // TODO: Implement actual LNbits health check (Step 2)
    return {
      ok: false,
      rail: "LN",
      error: "LNbits health check not yet implemented",
      backendStatus: "not_implemented",
    };
  }

  /**
   * Cancel a Lightning invoice (optional feature)
   * 
   * Step 1: Not yet implemented for LNbits
   */
  async cancelPayment(invoiceId: string): Promise<boolean> {
    // TODO: Implement LNbits invoice cancellation (if supported)
    console.warn(`LN invoice cancellation not yet implemented for ${invoiceId}`);
    return false;
  }

  /**
   * Hash invoice ID for pseudo-txid (privacy)
   */
  private hashInvoiceId(invoiceId: string): string {
    return crypto.createHash("sha256").update(invoiceId).digest("hex");
  }

  /**
   * Centralized error handling
   */
  private handleError(error: unknown, operation: string): never {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      
      if (axiosError.code === "ECONNREFUSED" || axiosError.code === "ETIMEDOUT") {
        throw new RailUnavailableError("LN", {
          operation,
          details: axiosError.message,
        });
      }

      if (axiosError.response) {
        throw new Error(
          `LN rail error (${operation}): ${axiosError.response.status} - ${JSON.stringify(axiosError.response.data)}`
        );
      }
    }

    throw new Error(
      `LN adapter error (${operation}): ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
