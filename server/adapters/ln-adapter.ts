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
 * Lightning Network Rail Adapter
 * 
 * Configuration via environment variables:
 * - LN_SERVICE_URL: URL of rail-ln service (default: http://localhost:5001)
 * - RAIL_AUTH_TOKEN: Authentication token for rail services
 */
export class LnAdapter implements RailAdapter {
  readonly currency = "LN" as const;
  private readonly serviceUrl: string;
  private readonly authToken: string;
  private readonly confirmationsRequired = 0; // LN is instant (0-conf)

  constructor() {
    this.serviceUrl = process.env.LN_SERVICE_URL || "http://localhost:5001";
    this.authToken = process.env.RAIL_AUTH_TOKEN || "";
    
    if (!this.authToken) {
      console.warn("⚠️ LN Adapter: RAIL_AUTH_TOKEN not set - authentication disabled");
    }
  }

  /**
   * Create a Lightning invoice
   */
  async createPayment(request: CreatePaymentRequest): Promise<CreatePaymentResponse> {
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
   */
  async getPaymentStatus(invoiceId: string): Promise<RailPaymentStatus> {
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
   * Check LN rail health
   */
  async healthCheck(): Promise<RailHealth> {
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
