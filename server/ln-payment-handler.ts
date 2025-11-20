/**
 * Shared Lightning Payment Confirmation Handler
 * 
 * Step 5: Unified payment confirmation logic used by both webhooks and polling.
 * Ensures consistent validation, idempotency, and status updates across all detection methods.
 * 
 * This shared handler eliminates code duplication and prevents divergent update paths.
 */

import { storage } from "./storage";
import * as monitoring from "./monitoring";

export interface LNPaymentData {
  checking_id: string;
  payment_hash: string;
  amount: number; // millisatoshis
  pending: boolean;
}

/**
 * Confirm a Lightning payment
 * 
 * Shared logic for marking invoices as paid, used by:
 * - Webhook handler (instant detection from LNbits)
 * - Polling worker (fallback detection)
 * 
 * SECURITY:
 * - Validates both checking_id AND payment_hash before updating
 * - Does NOT trust arbitrary invoice IDs from caller
 * - Looks up invoice by checking_id
 * 
 * IDEMPOTENCY:
 * - Safe to call multiple times for same payment
 * - Returns success if already paid
 * - Checks for existing transactions before creating new ones
 * 
 * @param payment - LNbits payment data (from webhook or polling API)
 * @param source - Detection source ("webhook" or "polling") for monitoring
 * @returns true if payment confirmed, false if skipped (already paid/expired/invalid)
 */
export async function confirmLightningPayment(
  payment: LNPaymentData,
  source: "webhook" | "polling"
): Promise<boolean> {
  try {
    // SECURITY: Look up invoice by checking_id using indexed query
    // Uses dedicated storage method for efficient lookup (DB-backed index in production)
    const invoice = await storage.getInvoiceByCheckingId(payment.checking_id);

    if (!invoice) {
      console.warn(JSON.stringify({
        event: "payment_confirmation_failed",
        rail: "ln",
        checking_id: payment.checking_id,
        reason: "invoice_not_found",
        source
      }));
      return false;
    }

    // SECURITY: Validate payment_hash matches stored value
    if (invoice.lnPaymentHash && invoice.lnPaymentHash !== payment.payment_hash) {
      console.error(JSON.stringify({
        event: "payment_confirmation_failed",
        rail: "ln",
        invoiceId: invoice.id,
        reason: "payment_hash_mismatch",
        source
      }));
      return false;
    }

    // IDEMPOTENCY: If already paid, return success (not an error)
    if (invoice.status === "confirmed") {
      console.log(JSON.stringify({
        event: "payment_confirmation_skipped",
        rail: "ln",
        invoiceId: invoice.id,
        reason: "already_paid",
        source
      }));
      return false; // Already processed, skip
    }

    // Check if expired (reject late payments)
    if (invoice.status === "expired" || (invoice.expiresAt && new Date(invoice.expiresAt) <= new Date())) {
      console.warn(JSON.stringify({
        event: "payment_confirmation_failed",
        rail: "ln",
        invoiceId: invoice.id,
        reason: "expired",
        source
      }));
      return false;
    }

    // Only process settled payments (pending=false)
    if (payment.pending) {
      console.log(JSON.stringify({
        event: "payment_confirmation_skipped",
        rail: "ln",
        invoiceId: invoice.id,
        reason: "still_pending",
        source
      }));
      return false;
    }

    // Convert millisatoshis to satoshis for storage
    const amountSats = Math.floor(payment.amount / 1000);
    const amountPaidAtomic = amountSats.toString();

    // Create payment transaction record (idempotent - check for duplicates)
    const existingTx = await storage.getPaymentTransactionsByInvoice(invoice.id);
    if (!existingTx.some(tx => tx.transactionId === payment.payment_hash)) {
      await storage.createPaymentTransaction({
        invoiceId: invoice.id,
        rail: "ln",
        transactionId: payment.payment_hash,
        confirmations: 0, // Lightning is instant (0-conf)
      });
    }

    // Update invoice status to confirmed
    await storage.updateInvoiceStatus(invoice.id, "confirmed", new Date());

    // Update Lightning-specific fields
    await storage.updateInvoice(invoice.id, {
      amountPaidAtomic,
      paidAt: new Date(),
    });

    // Log payment confirmation event
    console.log(JSON.stringify({
      event: "payment.confirmed",
      rail: "ln",
      invoiceId: invoice.id,
      amount_sats: amountSats,
      payment_hash: payment.payment_hash,
      source
    }));

    // Log to monitoring system
    monitoring.logPaymentStatus("LN", invoice.id, "confirmed");

    return true; // Successfully confirmed

  } catch (error: any) {
    console.error(`Lightning payment confirmation failed:`, error.message);
    throw error;
  }
}
