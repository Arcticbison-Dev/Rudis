/**
 * Phase 3B: LNbits webhook initialization
 *
 * This module provides the initializeLNbitsWebhook hook called from registerRoutes().
 * The primary LNbits webhook handler (HMAC-validated) is registered directly in
 * routes.ts as POST /api/lnbits/webhook.
 *
 * This function exists as an extension point for additional Phase 3B route
 * registration (e.g. the two-gate /rails/ln/webhook/:token path) without
 * coupling that logic to the main routes file.
 */

import type { Express } from "express";

/**
 * Initialize LNbits webhook routes on the Express app.
 * Called once during server startup from registerRoutes().
 *
 * @param _app - Express application instance
 */
export async function initializeLNbitsWebhook(_app: Express): Promise<void> {
  // Primary webhook route with HMAC callback auth is registered in routes.ts.
  // Additional route registration (e.g. two-gate /rails/ln/webhook/:token)
  // can be added here as the Phase 3B security model is extended.
}
