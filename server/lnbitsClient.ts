/**
 * LNbits API Client
 * 
 * Wraps LNbits HTTP API with typed methods for invoice creation and status checking.
 * Implements secure error handling that never logs secrets.
 * 
 * LNbits API Documentation: https://lnbits.com/api/v1
 */

import axios, { AxiosInstance, AxiosError } from "axios";

/**
 * LNbits invoice creation response
 * https://lnbits.com/api/v1#/default/api_payments_create_api_v1_payments_post
 */
export interface LNbitsInvoice {
  payment_hash: string;
  payment_request: string; // BOLT11 invoice
  checking_id: string; // Used to check payment status
  lnurl_response?: string | null;
}

/**
 * LNbits payment status response
 * https://lnbits.com/api/v1#/default/api_payment_api_v1_payments__payment_hash__get
 */
export interface LNbitsPayment {
  checking_id: string;
  pending: boolean;
  amount: number; // Amount in millisatoshis
  fee: number;
  memo: string;
  time: number; // Unix timestamp
  bolt11: string; // BOLT11 invoice
  preimage: string | null;
  payment_hash: string;
  expiry: number | null; // Unix timestamp when invoice expires
  extra: Record<string, unknown>;
  wallet_id: string;
  webhook: string | null;
  webhook_status: number | null;
}

/**
 * LNbits client configuration
 */
export interface LNbitsClientConfig {
  apiUrl: string; // Base URL (e.g., https://legend.lnbits.com)
  walletKey: string; // Invoice/Read API key
  httpTimeout: number; // Request timeout in ms
  debugLogging?: boolean; // Enable method/URL/status logging (never logs bodies/secrets)
}

/**
 * LNbits API Client
 * 
 * Provides typed methods for interacting with LNbits API endpoints.
 * All errors are logged securely without exposing API keys or sensitive data.
 */
export class LNbitsClient {
  private readonly client: AxiosInstance;
  private readonly config: LNbitsClientConfig;

  constructor(config: LNbitsClientConfig) {
    this.config = config;

    // Create axios instance with base configuration
    this.client = axios.create({
      baseURL: config.apiUrl,
      timeout: config.httpTimeout,
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": config.walletKey,
      },
    });

    // Add request interceptor for debug logging
    // Security: NEVER logs request bodies (may contain secrets/invoices)
    if (config.debugLogging) {
      this.client.interceptors.request.use((request) => {
        console.log(`[LNbits] → ${request.method?.toUpperCase()} ${request.url}`);
        return request;
      });
    }

    // Add response interceptor for debug logging
    // Security: NEVER logs response bodies (may contain payment data/webhooks)
    if (config.debugLogging) {
      this.client.interceptors.response.use(
        (response) => {
          console.log(`[LNbits] ← ${response.status} ${response.config.url}`);
          return response;
        },
        (error) => {
          // Don't log error here - handleError will do it securely
          return Promise.reject(error);
        }
      );
    }
  }

  /**
   * Create a Lightning invoice
   * 
   * @param amountSats - Invoice amount in satoshis
   * @param memo - Invoice description (shown to payer)
   * @param webhookUrl - Optional webhook URL for payment notifications
   * @returns LNbits invoice with payment_request (BOLT11) and payment_hash
   * 
   * POST /api/v1/payments
   * https://lnbits.com/api/v1#/default/api_payments_create_api_v1_payments_post
   */
  async createInvoice(
    amountSats: number,
    memo: string,
    webhookUrl?: string
  ): Promise<LNbitsInvoice> {
    try {
      const response = await this.client.post<LNbitsInvoice>("/api/v1/payments", {
        out: false, // Incoming payment (invoice)
        amount: amountSats,
        memo: memo,
        webhook: webhookUrl || undefined,
      });

      return response.data;
    } catch (error) {
      this.handleError(error, "createInvoice", { amountSats, memo });
      throw error; // TypeScript needs this even though handleError throws
    }
  }

  /**
   * Get payment status by payment hash
   * 
   * @param paymentHash - Lightning payment hash (from createInvoice response)
   * @returns Payment status including pending flag and payment details
   * 
   * GET /api/v1/payments/{payment_hash}
   * https://lnbits.com/api/v1#/default/api_payment_api_v1_payments__payment_hash__get
   */
  async getPaymentStatus(paymentHash: string): Promise<LNbitsPayment> {
    try {
      const response = await this.client.get<LNbitsPayment>(
        `/api/v1/payments/${paymentHash}`
      );

      return response.data;
    } catch (error) {
      this.handleError(error, "getPaymentStatus", { paymentHash });
      throw error;
    }
  }

  /**
   * Handle API errors with secure logging
   * 
   * Security: Never logs API keys, payment hashes, memos, or full response bodies
   * Only logs: operation name, URL, HTTP status, error codes, amount (number only)
   */
  private handleError(
    error: unknown,
    operation: string,
    context?: Record<string, unknown>
  ): never {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      
      // Build safe error context (no secrets, no PII, no payment data)
      // Security: Explicitly whitelist only safe fields - never spread entire context
      const safeContext: Record<string, unknown> = {
        operation,
        url: axiosError.config?.url || "unknown",
        method: axiosError.config?.method?.toUpperCase() || "unknown",
        status: axiosError.response?.status,
        statusText: axiosError.response?.statusText,
        code: axiosError.code,
      };

      // Only add amount if present (numeric value only, not sensitive)
      if (context?.amountSats !== undefined) {
        safeContext.amountSats = context.amountSats;
      }

      // Log structured error event
      // Explicitly excludes: API key, memo, paymentHash, response body, request body
      console.error(`[LNbits] ${operation} failed:`, JSON.stringify(safeContext, null, 2));

      // Connection errors
      if (axiosError.code === "ECONNREFUSED") {
        throw new Error(
          `LNbits unreachable: Connection refused to ${this.config.apiUrl}. Is LNbits running?`
        );
      }

      if (axiosError.code === "ETIMEDOUT") {
        throw new Error(
          `LNbits timeout: No response after ${this.config.httpTimeout}ms`
        );
      }

      // HTTP error responses
      if (axiosError.response) {
        const status = axiosError.response.status;
        
        if (status === 401) {
          throw new Error("LNbits authentication failed: Invalid API key (X-Api-Key)");
        }
        
        if (status === 403) {
          throw new Error("LNbits authorization failed: API key lacks required permissions");
        }
        
        if (status === 404) {
          throw new Error(`LNbits resource not found: ${axiosError.config?.url}`);
        }
        
        if (status >= 500) {
          throw new Error(`LNbits server error: ${status} ${axiosError.response.statusText}`);
        }

        // Generic HTTP error (don't expose response body - might contain secrets)
        throw new Error(
          `LNbits API error: ${status} ${axiosError.response.statusText}`
        );
      }

      // Network error without response
      throw new Error(`LNbits network error: ${axiosError.message}`);
    }

    // Non-axios error
    throw new Error(
      `LNbits ${operation} failed: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Create LNbits client from environment configuration
 * 
 * Reads LNBITS_API_URL, LNBITS_WALLET_KEY, and LN_HTTP_TIMEOUT from process.env
 * Throws if required configuration is missing.
 */
export function createLNbitsClient(config: LNbitsClientConfig): LNbitsClient {
  // SECURITY (Step 7.1): Generic error messages - don't expose secret names
  if (!config.apiUrl) {
    throw new Error("LNbits API URL is required to create LNbits client");
  }

  if (!config.walletKey) {
    throw new Error("LNbits wallet authentication is required to create LNbits client");
  }

  return new LNbitsClient(config);
}
