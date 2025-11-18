/**
 * Unified Payment Orchestrator - Type Definitions
 * 
 * This module defines the canonical payment model and common rail interface
 * used across all payment rails (BTC, XMR, LN).
 * 
 * Design Goals:
 * - Single source of truth for payment data
 * - Rail-agnostic abstractions
 * - Type-safe interfaces
 * - Future-proof for additional rails
 */

import { z } from "zod";

// ============================================================================
// Canonical Payment Model
// ============================================================================

/**
 * Supported payment currencies/rails
 */
export const PaymentCurrency = z.enum(["BTC", "XMR", "LN"]);
export type PaymentCurrency = z.infer<typeof PaymentCurrency>;

/**
 * Payment status lifecycle
 * - pending: Waiting for payment (0 confirmations or not seen)
 * - confirming: Payment detected but not enough confirmations
 * - confirmed: Payment fully confirmed
 * - expired: Invoice expired before payment
 * - failed: Payment failed (rail-specific error)
 */
export const PaymentStatus = z.enum([
  "pending",
  "confirming", 
  "confirmed",
  "expired",
  "failed"
]);
export type PaymentStatus = z.infer<typeof PaymentStatus>;

/**
 * Blockchain transaction details (rail-agnostic)
 */
export const BlockchainTransaction = z.object({
  /** Hashed transaction ID (SHA256 for privacy) */
  txidHash: z.string(),
  /** Amount in atomic units (satoshis, piconero, millisats) */
  amountAtomic: z.string(),
  /** Current confirmations */
  confirmations: z.number().int().min(0),
  /** Block height (if confirmed) */
  blockHeight: z.number().int().optional(),
  /** Timestamp when detected */
  detectedAt: z.string().datetime(),
});
export type BlockchainTransaction = z.infer<typeof BlockchainTransaction>;

/**
 * Canonical payment representation
 * 
 * This is the unified model used by the orchestrator.
 * Rail-specific details are abstracted away.
 */
export const CanonicalPayment = z.object({
  /** Unique invoice identifier */
  invoiceId: z.string().uuid(),
  
  /** Payment rail/currency */
  currency: PaymentCurrency,
  
  /** Expected amount in atomic units */
  amountAtomic: z.string(),
  
  /** Payment address (BTC address, XMR subaddress, or LN invoice) */
  paymentAddress: z.string(),
  
  /** Current payment status */
  status: PaymentStatus,
  
  /** Total confirmations across all transactions */
  confirmations: z.number().int().min(0).default(0),
  
  /** Required confirmations for this rail */
  confirmationsRequired: z.number().int().min(0),
  
  /** Blockchain transactions contributing to this payment */
  transactions: z.array(BlockchainTransaction).default([]),
  
  /** Total amount received (sum of all transactions) */
  amountReceived: z.string().default("0"),
  
  /** When the payment address was created */
  createdAt: z.string().datetime(),
  
  /** When the payment was last updated */
  updatedAt: z.string().datetime(),
  
  /** When the invoice expires */
  expiresAt: z.string().datetime().optional(),
});
export type CanonicalPayment = z.infer<typeof CanonicalPayment>;

// ============================================================================
// Common Rail Adapter Interface
// ============================================================================

/**
 * Request to create a payment address
 */
export const CreatePaymentRequest = z.object({
  /** Unique invoice identifier */
  invoiceId: z.string().uuid(),
  /** Amount in atomic units (satoshis, piconero, millisats) */
  amountAtomic: z.string(),
  /** Optional metadata (rail-specific) */
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreatePaymentRequest = z.infer<typeof CreatePaymentRequest>;

/**
 * Response from creating a payment address
 */
export const CreatePaymentResponse = z.object({
  /** Payment address (BTC address, XMR subaddress, LN invoice) */
  paymentAddress: z.string(),
  /** Required confirmations for this rail */
  confirmationsRequired: z.number().int().min(0),
  /** Optional expiry time (e.g., LN invoices expire quickly) */
  expiresAt: z.string().datetime().optional(),
  /** Rail-specific metadata */
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreatePaymentResponse = z.infer<typeof CreatePaymentResponse>;

/**
 * Payment status from a rail
 */
export const RailPaymentStatus = z.object({
  /** Current status */
  status: PaymentStatus,
  /** Confirmations */
  confirmations: z.number().int().min(0).default(0),
  /** Amount received in atomic units */
  amountReceived: z.string().default("0"),
  /** Transactions */
  transactions: z.array(BlockchainTransaction).default([]),
  /** Last updated */
  updatedAt: z.string().datetime(),
});
export type RailPaymentStatus = z.infer<typeof RailPaymentStatus>;

/**
 * Health status of a rail service
 */
export const RailHealth = z.object({
  /** Is the rail operational? */
  ok: z.boolean(),
  /** Rail name */
  rail: PaymentCurrency,
  /** Optional error message */
  error: z.string().optional(),
  /** Backend connection status (e.g., Bitcoin Core, Wallet RPC) */
  backendStatus: z.string().optional(),
});
export type RailHealth = z.infer<typeof RailHealth>;

/**
 * Common interface that all payment rails must implement
 * 
 * This ensures consistency across BTC, XMR, and LN adapters.
 */
export interface RailAdapter {
  /**
   * The currency/rail this adapter handles
   */
  readonly currency: PaymentCurrency;
  
  /**
   * Create a payment address for an invoice
   * 
   * @param request - Invoice details
   * @returns Payment address and metadata
   * @throws Error if creation fails
   */
  createPayment(request: CreatePaymentRequest): Promise<CreatePaymentResponse>;
  
  /**
   * Get the current status of a payment
   * 
   * @param invoiceId - Unique invoice identifier
   * @returns Current payment status
   * @throws Error if invoice not found
   */
  getPaymentStatus(invoiceId: string): Promise<RailPaymentStatus>;
  
  /**
   * Check if the rail service is healthy
   * 
   * @returns Health status
   */
  healthCheck(): Promise<RailHealth>;
  
  /**
   * Optional: Cancel a payment (e.g., LN invoice cancellation)
   * 
   * @param invoiceId - Unique invoice identifier
   * @returns Success boolean
   */
  cancelPayment?(invoiceId: string): Promise<boolean>;
}

// ============================================================================
// Orchestrator Error Types
// ============================================================================

/**
 * Base error for payment orchestrator
 */
export class PaymentOrchestratorError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "PaymentOrchestratorError";
  }
}

/**
 * Rail service unavailable
 */
export class RailUnavailableError extends PaymentOrchestratorError {
  constructor(currency: PaymentCurrency, details?: Record<string, unknown>) {
    super(
      `Payment rail ${currency} is currently unavailable`,
      "RAIL_UNAVAILABLE",
      { currency, ...details }
    );
    this.name = "RailUnavailableError";
  }
}

/**
 * Unsupported currency
 */
export class UnsupportedCurrencyError extends PaymentOrchestratorError {
  constructor(currency: string) {
    super(
      `Currency ${currency} is not supported`,
      "UNSUPPORTED_CURRENCY",
      { currency }
    );
    this.name = "UnsupportedCurrencyError";
  }
}

/**
 * Payment not found
 */
export class PaymentNotFoundError extends PaymentOrchestratorError {
  constructor(invoiceId: string) {
    super(
      `Payment ${invoiceId} not found`,
      "PAYMENT_NOT_FOUND",
      { invoiceId }
    );
    this.name = "PaymentNotFoundError";
  }
}
