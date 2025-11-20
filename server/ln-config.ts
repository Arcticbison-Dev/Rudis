/**
 * Lightning Network Configuration Validation
 * 
 * Shared configuration validation for LN adapter and poller.
 * Ensures consistent startup behavior and prevents duplicate env parsing.
 */

export interface LNConfig {
  enabled: boolean;
  lnbitsApiUrl: string | null;
  lnbitsWalletKey: string | null;
  lnbitsWalletId: string | null;
  lnbitsWebhookUrl: string | null;
  lnbitsWebhookSecret: string | null;
  invoiceExpirySeconds: number;
  minAmountSats: number;
  maxAmountSats: number;
  httpTimeout: number;
  pollIntervalMs: number;
  debugLogging: boolean;
}

export interface LNConfigValidationResult {
  config: LNConfig;
  isValid: boolean;
  errors: string[];
}

/**
 * Validate Lightning Network configuration from environment variables
 * 
 * This is the single source of truth for LN config validation.
 * Used by both LnAdapter and LNPoller to ensure consistent behavior.
 * 
 * @returns Validation result with normalized config and any errors
 */
export function validateLNConfig(): LNConfigValidationResult {
  const config: LNConfig = {
    enabled: process.env.ENABLE_LN === "true",
    lnbitsApiUrl: process.env.LNBITS_API_URL || null,
    lnbitsWalletKey: process.env.LNBITS_WALLET_KEY || null,
    lnbitsWalletId: process.env.LNBITS_WALLET_ID || null,
    lnbitsWebhookUrl: process.env.LNBITS_WEBHOOK_URL || null,
    lnbitsWebhookSecret: process.env.LNBITS_WEBHOOK_SECRET || null,
    invoiceExpirySeconds: parseInt(process.env.LN_INVOICE_EXPIRY_SECONDS || "3600", 10),
    minAmountSats: parseInt(process.env.LN_MIN_AMOUNT_SATS || "1", 10),
    maxAmountSats: parseInt(process.env.LN_MAX_AMOUNT_SATS || "100000", 10),
    httpTimeout: parseInt(process.env.LN_HTTP_TIMEOUT || "5000", 10),
    pollIntervalMs: parseInt(process.env.LN_POLL_INTERVAL_MS || "10000", 10),
    debugLogging: process.env.LN_DEBUG_LOGGING === "true",
  };

  const errors: string[] = [];

  // If LN is not enabled, return early (not an error)
  if (!config.enabled) {
    return { config, isValid: true, errors: [] };
  }

  // SECURITY (Step 7.1): Don't expose secret names in error messages
  // Generic errors prevent leaking which specific secrets are configured/missing
  
  // Required fields when ENABLE_LN=true
  if (!config.lnbitsApiUrl) {
    errors.push("LNbits API URL is required when ENABLE_LN=true");
  }

  if (!config.lnbitsWalletKey) {
    errors.push("LNbits wallet authentication is required when ENABLE_LN=true");
  }

  // Webhook secret must be at least 32 characters (security requirement)
  if (config.lnbitsWebhookSecret && config.lnbitsWebhookSecret.length < 32) {
    errors.push("Webhook authentication secret must be at least 32 characters");
  }

  // Amount limits validation
  if (config.minAmountSats < 1) {
    errors.push("LN_MIN_AMOUNT_SATS must be at least 1");
  }

  if (config.maxAmountSats < config.minAmountSats) {
    errors.push("LN_MAX_AMOUNT_SATS must be greater than or equal to LN_MIN_AMOUNT_SATS");
  }

  // Timeout validation
  if (config.httpTimeout < 1000) {
    errors.push("LN_HTTP_TIMEOUT must be at least 1000ms");
  }

  // Poll interval validation
  if (config.pollIntervalMs < 1000) {
    errors.push("LN_POLL_INTERVAL_MS must be at least 1000ms");
  }

  const isValid = errors.length === 0;
  return { config, isValid, errors };
}
