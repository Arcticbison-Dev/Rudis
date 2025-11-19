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
import { storage } from "../storage";
import { logPaymentCreateFailed } from "../monitoring";

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
 * Future Backend Support (reserved env vars):
 * - LN_BACKEND: Backend type (lnd, cln, lnbits, eclair) - not yet used
 * - LN_RPC_URL: RPC endpoint for Lightning backend - not yet used
 * - LN_MACAROON: LND macaroon (hex-encoded) - not yet used
 * - LN_API_KEY: API key for backends like LNbits - not yet used
 * - LN_CERT: TLS certificate path for LND - not yet used
 * 
 * Current Implementation:
 * - LN_SERVICE_URL: URL of rail-ln service (microservice architecture)
 * - RAIL_AUTH_TOKEN: Authentication token for rail services
 * - ENABLE_LN: Enable Lightning Network rail (default: false)
 */
interface LnConfig {
  // Future backend configuration (reserved, not yet implemented)
  backend?: "lnd" | "cln" | "lnbits" | "eclair";
  rpcUrl?: string;
  macaroon?: string;
  apiKey?: string;
  certPath?: string;
  
  // Current microservice architecture
  serviceUrl: string;
  authToken: string;
  serviceConfigured: boolean;
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
   */
  private loadConfig(): LnConfig {
    return {
      // Future backend configuration (reserved)
      backend: (process.env.LN_BACKEND as LnConfig["backend"]) || undefined,
      rpcUrl: process.env.LN_RPC_URL || undefined,
      macaroon: process.env.LN_MACAROON || undefined,
      apiKey: process.env.LN_API_KEY || undefined,
      certPath: process.env.LN_CERT || undefined,
      
      // Current microservice architecture
      serviceUrl: process.env.LN_SERVICE_URL || "http://localhost:5001",
      authToken: process.env.RAIL_AUTH_TOKEN || "",
      serviceConfigured: !!process.env.LN_SERVICE_URL,
    };
  }
  
  /**
   * Validate Lightning Network configuration on startup
   * 
   * Logs clear errors if LN_BACKEND is set but required vars are missing.
   * This helps developers catch configuration issues early.
   */
  private validateConfig(): void {
    // Check for future backend configuration (not yet implemented)
    if (this.config.backend) {
      console.warn("╔═══════════════════════════════════════════════════════════╗");
      console.warn("║ ⚠️  LN Backend Configuration Detected (Not Implemented)  ║");
      console.warn("╠═══════════════════════════════════════════════════════════╣");
      console.warn(`║ LN_BACKEND=${this.config.backend} is set but not yet supported.     ║`);
      console.warn("║ The system will use microservice architecture (rail-ln). ║");
      console.warn("║                                                           ║");
      console.warn("║ Future backend support planned for:                      ║");
      console.warn("║ - lnd: Lightning Network Daemon (LND)                    ║");
      console.warn("║ - cln: Core Lightning (CLN)                              ║");
      console.warn("║ - lnbits: LNbits wallet                                  ║");
      console.warn("║ - eclair: ACINQ Eclair                                   ║");
      console.warn("║                                                           ║");
      console.warn("║ Required environment variables per backend:              ║");
      console.warn("║ LND:    LN_RPC_URL, LN_MACAROON, LN_CERT                 ║");
      console.warn("║ CLN:    LN_RPC_URL                                       ║");
      console.warn("║ LNbits: LN_RPC_URL, LN_API_KEY                           ║");
      console.warn("║ Eclair: LN_RPC_URL, LN_API_KEY                           ║");
      console.warn("╚═══════════════════════════════════════════════════════════╝");
      
      // Check if required vars are set (for future use)
      const missingVars = this.getMissingBackendVars();
      if (missingVars.length > 0) {
        console.warn(`⚠️ Missing environment variables for ${this.config.backend}: ${missingVars.join(", ")}`);
        console.warn("⚠️ These will be required when backend support is implemented.");
      }
    }
    
    // Current microservice architecture validation
    if (!this.config.authToken) {
      console.warn("⚠️ LN Adapter: RAIL_AUTH_TOKEN not set - authentication disabled");
    }
    
    if (!this.config.serviceConfigured) {
      console.warn("⚠️ LN Adapter: LN_SERVICE_URL not configured - running in stub mode");
      console.warn("   Set LN_SERVICE_URL to enable Lightning Network payments");
    } else {
      console.log(`✓ LN Adapter: Service configured at ${this.config.serviceUrl}`);
    }
  }
  
  /**
   * Get missing environment variables for the configured backend
   * (Reserved for future implementation)
   */
  private getMissingBackendVars(): string[] {
    if (!this.config.backend) return [];
    
    const missing: string[] = [];
    
    switch (this.config.backend) {
      case "lnd":
        if (!this.config.rpcUrl) missing.push("LN_RPC_URL");
        if (!this.config.macaroon) missing.push("LN_MACAROON");
        if (!this.config.certPath) missing.push("LN_CERT");
        break;
      case "cln":
        if (!this.config.rpcUrl) missing.push("LN_RPC_URL");
        break;
      case "lnbits":
      case "eclair":
        if (!this.config.rpcUrl) missing.push("LN_RPC_URL");
        if (!this.config.apiKey) missing.push("LN_API_KEY");
        break;
    }
    
    return missing;
  }
  
  /**
   * Get service URL (current implementation uses microservice)
   */
  private get serviceUrl(): string {
    return this.config.serviceUrl;
  }
  
  /**
   * Get auth token
   */
  private get authToken(): string {
    return this.config.authToken;
  }
  
  /**
   * Check if service is configured
   */
  private get serviceConfigured(): boolean {
    return this.config.serviceConfigured;
  }

  /**
   * Create a Lightning invoice
   * 
   * Safe-stubbed: Returns controlled error when LN service not configured.
   * This prevents crashes while LN integration is in progress.
   */
  async createPayment(request: CreatePaymentRequest): Promise<CreatePaymentResponse> {
    // Safe-stub: Return controlled error if service not configured
    if (!this.serviceConfigured) {
      // Log payment creation failure in stub mode with rail='ln'
      logPaymentCreateFailed(
        "LN",
        request.invoiceId,
        "ln_not_implemented",
        "Lightning Network service (LN_SERVICE_URL) is not configured"
      );
      
      throw new RailUnavailableError("LN", {
        operation: "createPayment",
        reason: "ln_not_implemented",
        details: "Lightning Network service (LN_SERVICE_URL) is not configured. Set LN_SERVICE_URL to enable LN payments.",
        invoiceId: request.invoiceId,
      });
    }

    try {
      const response = await axios.post<LnCreateResponse>(
        `${this.serviceUrl}/create`,
        {
          invoiceId: request.invoiceId,
          amountMsat: request.amountAtomic,
          memo: request.metadata?.memo || "Altostratus Payment",
        },
        {
          headers: {
            "Content-Type": "application/json",
            ...(this.authToken && { Authorization: `Bearer ${this.authToken}` }),
          },
          timeout: 10000,
        }
      );

      return {
        paymentAddress: response.data.paymentRequest, // BOLT11 invoice
        confirmationsRequired: this.confirmationsRequired,
        expiresAt: response.data.expiresAt,
        metadata: {
          paymentHash: response.data.paymentHash,
        },
      };
    } catch (error) {
      this.handleError(error, "createPayment");
      throw error;
    }
  }

  /**
   * Get payment status from LN rail
   * 
   * Safe-stubbed: Reads from database only when LN service not configured.
   * This allows status checks without requiring live service connection.
   */
  async getPaymentStatus(invoiceId: string): Promise<RailPaymentStatus> {
    // Safe-stub: Read from database only if service not configured
    if (!this.serviceConfigured) {
      return this.getPaymentStatusFromDb(invoiceId);
    }

    try {
      const response = await axios.get<LnStatusResponse>(
        `${this.serviceUrl}/status/${invoiceId}`,
        {
          headers: {
            ...(this.authToken && { Authorization: `Bearer ${this.authToken}` }),
          },
          timeout: 10000,
        }
      );

      const data = response.data;

      // Map LN status to canonical status
      let status: RailPaymentStatus["status"];
      if (data.status === "expired") {
        status = "expired";
      } else if (data.status === "settled") {
        status = "confirmed"; // LN settlement = confirmed (instant)
      } else {
        status = "pending";
      }

      // Build transaction if settled
      const transactions: BlockchainTransaction[] = [];
      if (data.status === "settled" && data.settledAt) {
        transactions.push({
          txidHash: this.hashInvoiceId(invoiceId), // Use invoiceId as pseudo-txid
          amountAtomic: data.amountReceivedMsat,
          confirmations: 0, // LN is 0-conf
          detectedAt: data.settledAt,
        });
      }

      return {
        status,
        confirmations: 0, // LN is always 0-conf
        amountReceived: data.amountReceivedMsat,
        transactions,
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        throw new PaymentNotFoundError(invoiceId);
      }
      this.handleError(error, "getPaymentStatus");
      throw error;
    }
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
   * Safe-stubbed: Returns service unavailable when not configured.
   */
  async healthCheck(): Promise<RailHealth> {
    // Safe-stub: Return unavailable if service not configured
    if (!this.serviceConfigured) {
      return {
        ok: false,
        rail: "LN",
        error: "LN service not configured (LN_SERVICE_URL not set)",
        backendStatus: "not_configured",
      };
    }

    try {
      const response = await axios.get<LnHealthResponse>(
        `${this.serviceUrl}/health`,
        { timeout: 5000 }
      );

      return {
        ok: response.data.ok,
        rail: "LN",
        backendStatus: response.data.lnd,
      };
    } catch (error) {
      return {
        ok: false,
        rail: "LN",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Cancel a Lightning invoice (optional feature)
   * 
   * Note: LND supports invoice cancellation via CancelInvoice RPC
   */
  async cancelPayment(invoiceId: string): Promise<boolean> {
    try {
      await axios.post(
        `${this.serviceUrl}/cancel`,
        { invoiceId },
        {
          headers: {
            "Content-Type": "application/json",
            ...(this.authToken && { Authorization: `Bearer ${this.authToken}` }),
          },
          timeout: 10000,
        }
      );
      return true;
    } catch (error) {
      console.error(`Failed to cancel LN invoice ${invoiceId}:`, error);
      return false;
    }
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
