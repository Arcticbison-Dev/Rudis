/**
 * Monero (XMR) Rail Adapter
 * 
 * Wraps the rail-xmr microservice and implements the common RailAdapter interface.
 * Handles subaddress generation, payment status, and health checks for Monero payments.
 */

import axios, { AxiosError } from "axios";
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
 * XMR rail service response types (rail-specific)
 */
interface XmrCreateResponse {
  subaddress: string;
  accountIndex: number;
  addressIndex: number;
}

interface XmrTransaction {
  txidHash: string; // Already hashed by rail-xmr for privacy
  amountAtomic: string;
  confirmations: number;
  blockHeight?: number;
}

interface XmrStatusResponse {
  status: "pending" | "confirmed" | "expired";
  confirmations: number;
  amountReceivedAtomic: string;
  transactions: XmrTransaction[];
}

interface XmrHealthResponse {
  ok: boolean;
  service: string;
  walletRpc?: string;
}

/**
 * Monero Rail Adapter
 * 
 * Configuration via environment variables:
 * - XMR_SERVICE_URL: URL of rail-xmr service (default: http://localhost:5003)
 * - RAIL_AUTH_TOKEN: Authentication token for rail services
 */
export class XmrAdapter implements RailAdapter {
  readonly currency = "XMR" as const;
  private readonly serviceUrl: string;
  private readonly authToken: string;
  private readonly confirmationsRequired = 10; // Standard for XMR

  constructor() {
    this.serviceUrl = process.env.XMR_SERVICE_URL || "http://localhost:5003";
    this.authToken = process.env.RAIL_AUTH_TOKEN || "";
    
    if (!this.authToken) {
      console.warn("⚠️ XMR Adapter: RAIL_AUTH_TOKEN not set - authentication disabled");
    }
  }

  /**
   * Create a Monero subaddress
   */
  async createPayment(request: CreatePaymentRequest): Promise<CreatePaymentResponse> {
    try {
      const response = await axios.post<XmrCreateResponse>(
        `${this.serviceUrl}/create`,
        {
          invoiceId: request.invoiceId,
          amountAtomic: request.amountAtomic,
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
        paymentAddress: response.data.subaddress,
        confirmationsRequired: this.confirmationsRequired,
        metadata: {
          accountIndex: response.data.accountIndex,
          addressIndex: response.data.addressIndex,
        },
      };
    } catch (error) {
      this.handleError(error, "createPayment");
      throw error;
    }
  }

  /**
   * Get payment status from XMR rail
   * 
   * NOTE: This method queries the rail service directly (makes fresh blockchain RPC calls).
   * The orchestrator's getPaymentStatus() does NOT call this - it reads from database instead.
   * This method is kept for:
   * - Direct debugging/troubleshooting
   * - Manual status verification
   * - Potential future use cases
   * 
   * Production flow: Workers poll → Update DB via callbacks → Orchestrator reads DB
   */
  async getPaymentStatus(invoiceId: string): Promise<RailPaymentStatus> {
    try {
      const response = await axios.get<XmrStatusResponse>(
        `${this.serviceUrl}/status/${invoiceId}`,
        {
          headers: {
            ...(this.authToken && { Authorization: `Bearer ${this.authToken}` }),
          },
          timeout: 10000,
        }
      );

      const data = response.data;

      // Map XMR status to canonical status
      let status: RailPaymentStatus["status"];
      if (data.status === "expired") {
        status = "expired";
      } else if (data.status === "confirmed") {
        status = "confirmed";
      } else if (data.confirmations > 0) {
        status = "confirming";
      } else {
        status = "pending";
      }

      return {
        status,
        confirmations: data.confirmations,
        amountReceived: data.amountReceivedAtomic,
        transactions: data.transactions.map((tx) => this.mapTransaction(tx)),
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
   * Check XMR rail health
   */
  async healthCheck(): Promise<RailHealth> {
    try {
      const response = await axios.get<XmrHealthResponse>(
        `${this.serviceUrl}/health`,
        { timeout: 5000 }
      );

      return {
        ok: response.data.ok,
        rail: "XMR",
        backendStatus: response.data.walletRpc,
      };
    } catch (error) {
      return {
        ok: false,
        rail: "XMR",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Map XMR transaction to canonical format
   * 
   * Note: XMR rail already hashes txids for privacy, so we use them directly
   */
  private mapTransaction(tx: XmrTransaction): BlockchainTransaction {
    return {
      txidHash: tx.txidHash, // Already hashed by rail-xmr
      amountAtomic: tx.amountAtomic,
      confirmations: tx.confirmations,
      blockHeight: tx.blockHeight,
      detectedAt: new Date().toISOString(),
    };
  }

  /**
   * Centralized error handling
   */
  private handleError(error: unknown, operation: string): never {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      
      if (axiosError.code === "ECONNREFUSED" || axiosError.code === "ETIMEDOUT") {
        throw new RailUnavailableError("XMR", {
          operation,
          details: axiosError.message,
        });
      }

      if (axiosError.response) {
        throw new Error(
          `XMR rail error (${operation}): ${axiosError.response.status} - ${JSON.stringify(axiosError.response.data)}`
        );
      }
    }

    throw new Error(
      `XMR adapter error (${operation}): ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
