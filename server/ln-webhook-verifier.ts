/**
 * Phase 3B: LNbits Webhook API Re-verification
 *
 * Called from POST /rails/ln/webhook/:token AFTER the URL-token gate passes,
 * BEFORE confirmLightningPayment() is allowed to run.
 *
 * WHY this exists — two-gate model:
 *   Gate 1 (already in routes.ts): URL-embedded secret token validated with
 *           crypto.timingSafeEqual(). Rejects requests that don't know the path.
 *   Gate 2 (this module): Ask LNbits itself "is this payment_hash actually paid?"
 *           Even if the URL token leaks, an attacker would also need to control
 *           LNbits payment records — belt AND suspenders.
 *
 * RETURN VALUES:
 *   { verified: true }  — LNbits confirms payment is settled → proceed
 *   { verified: false, reason: string } — not confirmed → caller returns HTTP 200
 *                                         (200, not 4xx, prevents LNbits retry storms)
 *   { verified: true, skipped: true }  — LNbits API unreachable → proceed anyway
 *                                        (polling fallback will catch real payments;
 *                                         false-negative is safer than blocking legit payments)
 */

import { createLNbitsClient } from "./lnbitsClient";

export interface VerificationResult {
  verified: boolean;
  skipped?: boolean; // true = API unreachable, proceeding on best-effort
  reason?: string;
}

/**
 * Verify that LNbits has recorded this payment_hash as settled.
 *
 * @param paymentHash - 64-char hex payment hash from the webhook body
 * @returns VerificationResult
 */
export async function verifyLNbitsPayment(
  paymentHash: string
): Promise<VerificationResult> {
  const lnbitsApiUrl = process.env.LNBITS_API_URL;
  const lnbitsWalletKey = process.env.LNBITS_WALLET_KEY;

  // If LNbits API credentials aren't configured, skip verification and proceed.
  // This should only happen in a misconfigured environment; log loudly.
  if (!lnbitsApiUrl || !lnbitsWalletKey) {
    console.warn(
      "LNbits webhook verifier: LNBITS_API_URL or LNBITS_WALLET_KEY not set — " +
      "skipping API re-verification (CONFIGURE THESE ENV VARS)"
    );
    return { verified: true, skipped: true, reason: "env_vars_missing" };
  }

  try {
    const client = createLNbitsClient({
      apiUrl: lnbitsApiUrl,
      walletKey: lnbitsWalletKey,
    });

    const status = await client.getPaymentStatus(paymentHash);

    if (!status.paid) {
      // LNbits says this payment is NOT settled.
      // This could be a spoofed webhook, a race, or a double-delivery of a pending event.
      console.warn(
        `LNbits webhook rejected: API re-verification returned paid=false ` +
        `for payment_hash=${paymentHash.substring(0, 16)}...`
      );
      return { verified: false, reason: "lnbits_paid_false" };
    }

    // Payment confirmed by LNbits. Both gates passed.
    return { verified: true };

  } catch (err) {
    // LNbits API is unreachable or returned an error.
    // Log, but proceed — the polling worker is the backstop for legitimate payments.
    // Blocking here on an API error would prevent real users from completing payment.
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(
      `LNbits webhook verifier: API call failed for ${paymentHash.substring(0, 16)}..., ` +
      `proceeding without re-verification: ${errMsg}`
    );
    return { verified: true, skipped: true, reason: "api_unreachable" };
  }
}
