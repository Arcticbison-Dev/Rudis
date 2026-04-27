/**
 * Payment Orchestrator Service
 * 
 * Central service that provides a unified API for all payment rails (BTC, XMR, LN).
 * Routes requests to appropriate rail adapters based on currency.
 * 
 * Benefits:
 * - Single, stable API for merchant applications
 * - Centralized error handling and retry logic
 * - Feature flag support (ENABLE_BTC, ENABLE_XMR, ENABLE_LN)
 * - Rail-agnostic business logic
 * - Easy to add new payment rails
 */

import {
  type RailAdapter,
  type CanonicalPayment,
  type CreatePaymentRequest,
  type RailHealth,
  PaymentCurrency,
  UnsupportedCurrencyError,
  RailUnavailableError,
} from "../shared/payment-orchestrator";
import { BtcAdapter } from "./adapters/btc-adapter";
import { XmrAdapter } from "./adapters/xmr-adapter";
import { LnAdapter } from "./adapters/ln-adapter";
import { storage } from "./storage";
import * as monitoring from "./monitoring";

/**
 * Payment Orchestrator Configuration
 */
interface OrchestratorConfig {
  enableBtc: boolean;
  enableXmr: boolean;
  enableLn: boolean;
}

/**
 * Health status for all rails
 */
interface OrchestratorHealth {
  ok: boolean;
  rails: {
    btc: RailHealth | null;
    xmr: RailHealth | null;
    ln: RailHealth | null;
  };
  enabledRails: string[];
}

/**
 * Payment Orchestrator
 * 
 * Coordinates payment operations across multiple rails (BTC, XMR, LN).
 */
export class PaymentOrchestrator {
  private adapters: Map<PaymentCurrency, RailAdapter>;
  private config: OrchestratorConfig;

  constructor(config?: Partial<OrchestratorConfig>) {
    // Load configuration from environment variables
    this.config = {
      enableBtc: config?.enableBtc ?? process.env.ENABLE_BTC === "true",
      enableXmr: config?.enableXmr ?? process.env.ENABLE_XMR === "true",
      enableLn: config?.enableLn ?? process.env.ENABLE_LN === "true",
    };

    // Initialize adapters
    this.adapters = new Map();
    
    if (this.config.enableBtc) {
      this.adapters.set("BTC", new BtcAdapter());
      console.log("✓ Payment Orchestrator: BTC rail enabled");
    }
    
    if (this.config.enableXmr) {
      this.adapters.set("XMR", new XmrAdapter());
      console.log("✓ Payment Orchestrator: XMR rail enabled");
    }
    
    if (this.config.enableLn) {
      this.adapters.set("LN", new LnAdapter());
      console.log("✓ Payment Orchestrator: LN rail enabled");
    }

    // Validate at least one rail is enabled
    if (this.adapters.size === 0) {
      console.warn("⚠️ Payment Orchestrator: No payment rails enabled!");
    }

    console.log(`Payment Orchestrator initialized with ${this.adapters.size} rail(s)`);
  }

  /**
   * Create a payment address for an invoice
   * 
   * Routes to the appropriate rail based on currency.
   * 
   * @param currency - Payment currency (BTC, XMR, LN)
   * @param request - Payment creation request
   * @returns Canonical payment with address
   */
  async createPayment(
    currency: PaymentCurrency,
    request: CreatePaymentRequest
  ): Promise<CanonicalPayment> {
    try {
      // Get the appropriate adapter
      const adapter = this.getAdapter(currency);

      // Create payment address via rail
      const response = await adapter.createPayment(request);

      // Map to canonical payment model
      const payment: CanonicalPayment = {
        invoiceId: request.invoiceId,
        currency,
        amountAtomic: request.amountAtomic,
        paymentAddress: response.paymentAddress,
        status: "pending",
        confirmations: 0,
        confirmationsRequired: response.confirmationsRequired,
        transactions: [],
        amountReceived: "0",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...(response.expiresAt && { expiresAt: response.expiresAt }),
        ...(response.metadata && { metadata: response.metadata }),
      };

      console.log({
        orchestrator: "createPayment",
        invoiceId: request.invoiceId,
        currency,
        confirmationsRequired: response.confirmationsRequired,
      });

      // Log monitoring event
      monitoring.logPaymentCreated(currency, request.invoiceId, request.amountAtomic);

      return payment;
    } catch (error: any) {
      // Log error for monitoring
      monitoring.logPaymentError(currency, request.invoiceId, error.message);
      throw error;
    }
  }

  /**
   * Get the current status of a payment
   * 
   * Delegates to the appropriate rail adapter for DB-only status reads.
   * Workers poll blockchains and update DB via callbacks.
   * 
   * @param currency - Payment currency
   * @param invoiceId - Invoice identifier
   * @returns Current payment status with complete canonical fields
   */
  async getPaymentStatus(
    currency: PaymentCurrency,
    invoiceId: string
  ): Promise<CanonicalPayment> {
    // Get the appropriate adapter
    const adapter = this.getAdapter(currency);

    // Load invoice from storage - this is the source of truth
    const invoice = await storage.getInvoice(invoiceId);
    if (!invoice) {
      throw new Error(`Invoice ${invoiceId} not found in storage`);
    }

    // Delegate to adapter for rail-specific status logic (DB-only)
    const railStatus = await adapter.getPaymentStatus(invoiceId);

    // Map confirmations required based on currency
    const confirmationsRequired = 
      currency === "LN" ? 0 : 
      currency === "BTC" ? 6 : 
      10; // XMR

    // Build canonical payment from adapter status + invoice data
    // Fall back to invoice.updatedAt if adapter doesn't provide it (e.g., LN with no LNbits config)
    const payment: CanonicalPayment = {
      invoiceId,
      currency,
      amountAtomic: invoice.amount,
      paymentAddress: invoice.paymentAddress,
      status: railStatus.status,
      confirmations: railStatus.confirmations,
      confirmationsRequired,
      transactions: railStatus.transactions,
      amountReceived: railStatus.amountReceived,
      createdAt: invoice.createdAt.toISOString(),
      updatedAt: railStatus.updatedAt || invoice.updatedAt.toISOString(),
      ...(invoice.expiresAt && { expiresAt: invoice.expiresAt.toISOString() }),
    };

    return payment;
  }

  /**
   * Cancel a payment (if supported by rail)
   * 
   * Currently only Lightning Network supports cancellation.
   * 
   * @param currency - Payment currency
   * @param invoiceId - Invoice identifier
   * @returns True if cancelled successfully
   */
  async cancelPayment(currency: PaymentCurrency, invoiceId: string): Promise<boolean> {
    const adapter = this.getAdapter(currency);

    if (!adapter.cancelPayment) {
      throw new Error(`Payment cancellation not supported for ${currency}`);
    }

    return await adapter.cancelPayment(invoiceId);
  }

  /**
   * Check health of all enabled rails
   * 
   * @returns Health status for all rails
   */
  async healthCheck(): Promise<OrchestratorHealth> {
    const healthChecks = await Promise.allSettled([
      this.config.enableBtc ? this.adapters.get("BTC")?.healthCheck() : Promise.resolve(null),
      this.config.enableXmr ? this.adapters.get("XMR")?.healthCheck() : Promise.resolve(null),
      this.config.enableLn ? this.adapters.get("LN")?.healthCheck() : Promise.resolve(null),
    ]);

    const [btcHealth, xmrHealth, lnHealth] = healthChecks.map((result) =>
      result.status === "fulfilled" ? result.value : null
    ) as [RailHealth | null, RailHealth | null, RailHealth | null];

    const enabledRails = [];
    if (this.config.enableBtc) enabledRails.push("BTC");
    if (this.config.enableXmr) enabledRails.push("XMR");
    if (this.config.enableLn) enabledRails.push("LN");

    // Log rail health status for monitoring (only if rail is enabled and health check returned)
    if (this.config.enableBtc && btcHealth) {
      monitoring.logRailHealth("BTC", btcHealth.ok, btcHealth.error);
    }
    if (this.config.enableXmr && xmrHealth) {
      monitoring.logRailHealth("XMR", xmrHealth.ok, xmrHealth.error);
    }
    if (this.config.enableLn && lnHealth) {
      monitoring.logRailHealth("LN", lnHealth.ok, lnHealth.error);
    }

    // Overall health: true if at least one rail is healthy
    const ok =
      (btcHealth?.ok ?? false) ||
      (xmrHealth?.ok ?? false) ||
      (lnHealth?.ok ?? false);

    return {
      ok,
      rails: {
        btc: btcHealth,
        xmr: xmrHealth,
        ln: lnHealth,
      },
      enabledRails,
    };
  }

  /**
   * Get the adapter for a currency
   * 
   * @param currency - Payment currency
   * @returns Rail adapter
   * @throws UnsupportedCurrencyError if currency not supported
   * @throws RailUnavailableError if rail disabled
   */
  private getAdapter(currency: PaymentCurrency): RailAdapter {
    const adapter = this.adapters.get(currency);

    if (!adapter) {
      // Check if it's a valid currency but disabled
      if (["BTC", "XMR", "LN"].includes(currency)) {
        throw new RailUnavailableError(currency, {
          reason: "Rail is disabled via feature flag",
        });
      }
      throw new UnsupportedCurrencyError(currency);
    }

    return adapter;
  }

  /**
   * Check if a currency is enabled
   * 
   * @param currency - Payment currency
   * @returns True if enabled
   */
  isCurrencyEnabled(currency: PaymentCurrency): boolean {
    return this.adapters.has(currency);
  }

  /**
   * Get list of enabled currencies
   * 
   * @returns Array of enabled currencies
   */
  getEnabledCurrencies(): PaymentCurrency[] {
    return Array.from(this.adapters.keys());
  }
}

// Singleton instance
let orchestrator: PaymentOrchestrator | null = null;

/**
 * Get the payment orchestrator singleton
 * 
 * @returns Payment orchestrator instance
 */
export function getOrchestrator(): PaymentOrchestrator {
  if (!orchestrator) {
    orchestrator = new PaymentOrchestrator();
  }
  return orchestrator;
}

/**
 * Initialize orchestrator with custom config (for testing)
 * 
 * @param config - Orchestrator configuration
 * @returns Payment orchestrator instance
 */
export function initOrchestrator(config: Partial<OrchestratorConfig>): PaymentOrchestrator {
  orchestrator = new PaymentOrchestrator(config);
  return orchestrator;
}
