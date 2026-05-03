/**
 * Lightning Network Payment Poller
 * 
 * Step 5.2: Polling fallback for Lightning invoice status checking.
 * 
 * Background worker that periodically checks pending Lightning invoices via LNbits API.
 * Provides fallback detection when webhooks are not configured or fail to deliver.
 * 
 * Dual-Mode Detection Strategy:
 * - Mode 1 (Webhook + Polling): Webhooks are primary (instant), polling is safety net
 * - Mode 2 (Polling-Only): Polling is primary detection method
 * 
 * Polling Interval: Configurable via LN_POLL_INTERVAL_MS (default: 10000ms = 10s)
 * 
 * Idempotency: Safe to run alongside webhooks - duplicate detections are handled gracefully
 */

import { storage } from "./storage";
import { createLNbitsClient } from "./lnbitsClient";
import * as monitoring from "./monitoring";
import { confirmLightningPayment } from "./ln-payment-handler";
import { type LNConfig, validateLNConfig } from "./ln-config";

// LNPoller config now uses the shared LNConfig type
export type LNPollerConfig = LNConfig;

/**
 * Lightning Network Polling Worker
 * 
 * Checks pending Lightning invoices via LNbits API at regular intervals.
 * Updates invoice status and creates payment_transactions when paid.
 */
export class LNPoller {
  private config: LNPollerConfig;
  private pollInterval: NodeJS.Timeout | null = null;
  private isPolling: boolean = false;

  constructor(config: LNPollerConfig) {
    this.config = config;
  }

  /**
   * Start the polling worker
   * 
   * ROBUSTNESS: Uses shared config validation (same as LN adapter).
   * If config is invalid, logs reason and does not start (fail-fast, no spam).
   */
  start(): void {
    if (!this.config.enabled) {
      console.log("LN poller: disabled (ENABLE_LN=false)");
      return;
    }

    // Note: Config validation already happened in createLNPoller()
    // If we got here with enabled=true, config is valid

    console.log(`LN poller: starting (interval: ${this.config.pollIntervalMs}ms)`);

    // Run initial poll immediately
    this.poll().catch((error) => {
      console.error("LN poller: initial poll failed:", error.message);
    });

    // Schedule periodic polling
    this.pollInterval = setInterval(() => {
      this.poll().catch((error) => {
        console.error("LN poller: periodic poll failed:", error.message);
      });
    }, this.config.pollIntervalMs);
  }

  /**
   * Stop the polling worker
   */
  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
      console.log("LN poller: stopped");
    }
  }

  /**
   * Poll pending Lightning invoices
   * 
   * For each pending invoice:
   * 1. Call LNbits getPaymentStatus API
   * 2. If paid (pending=false), update invoice + create payment_transactions
   * 3. Log monitoring events
   */
  private async poll(): Promise<void> {
    // Prevent concurrent polls
    if (this.isPolling) {
      if (this.config.debugLogging) {
        console.log("LN poller: skipping poll (previous poll still running)");
      }
      return;
    }

    this.isPolling = true;

    try {
      // Log poll start
      monitoring.logPollStarted("LN");

      // Get pending Lightning invoices with pagination limit
      // Uses dedicated storage method for efficient filtering (DB-backed pagination in production)
      const MAX_INVOICES_PER_POLL = 100;
      const pendingInvoices = await storage.getPendingLightningInvoices(MAX_INVOICES_PER_POLL);

      if (pendingInvoices.length === 0) {
        // Log successful poll with zero invoices (no failures)
        monitoring.logPollCompleted("LN", pendingInvoices.length, 0);
        return;
      }

      if (this.config.debugLogging) {
        console.log(`LN poller: checking ${pendingInvoices.length} pending invoice(s)`);
      }

      // Create LNbits client
      const lnbitsClient = createLNbitsClient({
        apiUrl: this.config.lnbitsApiUrl!,
        walletKey: this.config.lnbitsWalletKey!,
        httpTimeout: this.config.httpTimeout,
        debugLogging: this.config.debugLogging,
      });

      let successCount = 0;
      let failureCount = 0;

      // Check each pending invoice
      for (const invoice of pendingInvoices) {
        // Skip invoices where address generation failed (no payment hash stored).
        // Also guard against string "null" — can occur if the field was serialized
        // incorrectly when the original LNbits call failed.
        const isInvalidHash =
          !invoice.lnPaymentHash ||
          invoice.lnPaymentHash === "null" ||
          invoice.lnPaymentHash === "undefined";
        if (isInvalidHash) {
          console.warn(`LN poller: skipping invoice ${invoice.id} — no payment hash (address generation failed, marking failed)`);
          try {
            await storage.updateInvoiceStatus(invoice.id, "failed");
          } catch { /* best-effort */ }
          failureCount++;
          continue;
        }

        try {
          // Call LNbits API to get payment status
          const payment = await lnbitsClient.getPaymentStatus(invoice.lnPaymentHash);

          // Use shared payment confirmation handler (same logic as webhook)
          const confirmed = await confirmLightningPayment(payment, "polling");
          if (confirmed) {
            successCount++;
          }

        } catch (error: any) {
          // Log individual invoice check failure
          console.error(`LN poller: failed to check invoice ${invoice.id}:`, error.message);
          failureCount++;

          // Continue checking other invoices (don't fail entire poll)
        }
      }

      // Log poll completion with counts
      monitoring.logPollCompleted("LN", pendingInvoices.length, failureCount);

      if (successCount > 0 || failureCount > 0) {
        console.log(`LN poller: checked ${pendingInvoices.length} invoices (${successCount} paid, ${failureCount} failed)`);
      }

    } catch (error: any) {
      // Log poll failure (fetching invoices failed)
      console.error("LN poller: poll failed:", error.message);
      monitoring.logPollFailed("LN", error.message);

    } finally {
      this.isPolling = false;
    }
  }

}

/**
 * Create and start Lightning polling worker
 */
/**
 * Create and start Lightning polling worker
 * 
 * Uses shared config validation to ensure consistent startup behavior.
 * Returns null if config is invalid (fail-fast, no spam).
 */
export function createLNPoller(): LNPoller | null {
  const { config, isValid, errors } = validateLNConfig();

  if (!config.enabled) {
    console.log("LN poller: disabled (ENABLE_LN=false)");
    return null;
  }

  if (!isValid) {
    console.warn(`LN poller: disabled due to configuration errors: ${errors.join(", ")}`);
    return null;
  }

  const poller = new LNPoller(config);
  poller.start();
  return poller;
}
