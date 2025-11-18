/**
 * Bitcoin (BTC) Rail Adapter
 * 
 * Wraps the rail-btc microservice and implements the common RailAdapter interface.
 * Handles address generation, payment status, and health checks for Bitcoin on-chain payments.
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
 * BTC rail service response types (rail-specific)
 */
interface BtcCreateResponse {
  address: string;
  derivationPath: string;
}

interface BtcTransaction {
  txid: string;
  amountSatoshis: string;
  confirmations: number;
  blockHeight?: number;
}

interface BtcStatusResponse {
  status: "pending" | "confirmed" | "expired";
  confirmations: number;
  amountReceivedSatoshis: string;
  transactions: BtcTransaction[];
}

interface BtcHealthResponse {
  ok: boolean;
  bitcoinCore?: string;
}

/**
 * Bitcoin Rail Adapter
 * 
 * Configuration via environment variables:
 * - BTC_SERVICE_URL: URL of rail-btc service (default: http://localhost:5002)
 * - RAIL_AUTH_TOKEN: Authentication token for rail services
 */
export class BtcAdapter implements RailAdapter {
  readonly currency = "BTC" as const;
  private readonly serviceUrl: string;
  private readonly authToken: string;
  private readonly confirmationsRequired = 6; // Standard for BTC

  constructor() {
    this.serviceUrl = process.env.BTC_SERVICE_URL || "http://localhost:5002";
    this.authToken = process.env.RAIL_AUTH_TOKEN || "";
    
    if (!this.authToken) {
      console.warn("⚠️ BTC Adapter: RAIL_AUTH_TOKEN not set - authentication disabled");
    }
  }

  /**
   * Create a Bitcoin payment address
   */
  async createPayment(request: CreatePaymentRequest): Promise<CreatePaymentResponse> {
    try {
      const response = await axios.post<BtcCreateResponse>(
        `${this.serviceUrl}/create`,
        {
          invoiceId: request.invoiceId,
          amountSatoshis: request.amountAtomic,
        },
        {
          headers: {
            "Content-Type": "application/json",
            ...(this.authToken && { Authorization: `Bearer ${this.authToken}` }),
          },
          timeout: 10000, // 10 second timeout
        }
      );

      return {
        paymentAddress: response.data.address,
        confirmationsRequired: this.confirmationsRequired,
        metadata: {
          derivationPath: response.data.derivationPath,
        },
      };
    } catch (error) {
      this.handleError(error, "createPayment");
      throw error; // TypeScript needs this
    }
  }

  /**
   * Get payment status from BTC rail
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
      const response = await axios.get<BtcStatusResponse>(
        `${this.serviceUrl}/status/${invoiceId}`,
        {
          headers: {
            ...(this.authToken && { Authorization: `Bearer ${this.authToken}` }),
          },
          timeout: 10000,
        }
      );

      const data = response.data;

      // Map BTC status to canonical status
      let status: RailPaymentStatus["status"];
      if (data.status === "expired") {
        status = "expired";
      } else if (data.status === "confirmed") {
        status = "confirmed";
      } else if (data.confirmations > 0) {
        status = "confirming"; // Payment seen but not enough confirmations
      } else {
        status = "pending";
      }

      return {
        status,
        confirmations: data.confirmations,
        amountReceived: data.amountReceivedSatoshis,
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
   * Check BTC rail health
   */
  async healthCheck(): Promise<RailHealth> {
    try {
      const response = await axios.get<BtcHealthResponse>(
        `${this.serviceUrl}/health`,
        { timeout: 5000 }
      );

      return {
        ok: response.data.ok,
        rail: "BTC",
        backendStatus: response.data.bitcoinCore,
      };
    } catch (error) {
      return {
        ok: false,
        rail: "BTC",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Map BTC transaction to canonical format
   */
  private mapTransaction(tx: BtcTransaction): BlockchainTransaction {
    return {
      txidHash: this.hashTxid(tx.txid),
      amountAtomic: tx.amountSatoshis,
      confirmations: tx.confirmations,
      blockHeight: tx.blockHeight,
      detectedAt: new Date().toISOString(),
    };
  }

  /**
   * Hash transaction ID for privacy (SHA256)
   */
  private hashTxid(txid: string): string {
    return crypto.createHash("sha256").update(txid).digest("hex");
  }

  /**
   * Centralized error handling
   */
  private handleError(error: unknown, operation: string): never {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      
      if (axiosError.code === "ECONNREFUSED" || axiosError.code === "ETIMEDOUT") {
        throw new RailUnavailableError("BTC", {
          operation,
          details: axiosError.message,
        });
      }

      if (axiosError.response) {
        throw new Error(
          `BTC rail error (${operation}): ${axiosError.response.status} - ${JSON.stringify(axiosError.response.data)}`
        );
      }
    }

    throw new Error(
      `BTC adapter error (${operation}): ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
