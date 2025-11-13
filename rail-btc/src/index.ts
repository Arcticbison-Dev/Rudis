import express, { Request, Response, NextFunction } from "express";
import { config } from "dotenv";
import * as bitcoin from "bitcoinjs-lib";
import BIP32Factory from "bip32";
import * as ecc from "tiny-secp256k1";
import axios from "axios";
import { z } from "zod";

config();

const app = express();
app.use(express.json());

// Initialize BIP32 with elliptic curve library
const bip32 = BIP32Factory(ecc);

// Environment configuration
const PAYMENTS_SERVICE_URL = process.env.PAYMENTS_SERVICE_URL || "http://localhost:5000";
const RAIL_AUTH_TOKEN = process.env.RAIL_AUTH_TOKEN || "";
const BTC_XPUB = process.env.BTC_XPUB || "";
const BTC_NETWORK = process.env.BTC_NETWORK || "testnet"; // "mainnet" | "testnet"
const BTC_CONFIRMATIONS_REQUIRED = parseInt(process.env.BTC_CONFIRMATIONS_REQUIRED || "6", 10);
const MEMPOOL_API_BASE = process.env.MEMPOOL_API_BASE || 
  (BTC_NETWORK === "testnet" ? "https://mempool.space/testnet/api" : "https://mempool.space/api");
const POLLING_INTERVAL_MS = parseInt(process.env.POLLING_INTERVAL_MS || "30000", 10); // 30 seconds
const PORT = parseInt(process.env.PORT || "5002", 10);

// Validation schemas
const createAddressSchema = z.object({
  invoiceId: z.string().uuid(),
  amountSats: z.number().int().positive(),
});

// In-memory storage for address tracking
// In production, this should be persisted to a database
interface TrackedAddress {
  invoiceId: string;
  address: string;
  derivationIndex: number;
  derivationPath: string;
  amountSats: number;
  createdAt: Date;
  lastChecked?: Date;
  txid?: string;
  confirmations?: number;
  paid?: boolean;
  paidAt?: Date;
}

const trackedAddresses: Map<string, TrackedAddress> = new Map();
let nextDerivationIndex = 0;

// Get Bitcoin network configuration
function getBitcoinNetwork(): bitcoin.Network {
  return BTC_NETWORK === "mainnet" ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
}

// Derive BIP84 (native segwit) address from xpub
function deriveAddress(xpub: string, index: number): { address: string; path: string } {
  if (!xpub || xpub.length === 0) {
    throw new Error("BTC_XPUB not configured");
  }

  const network = getBitcoinNetwork();
  const node = bip32.fromBase58(xpub, network);
  
  // BIP84 path: m/84'/0'/0'/0/index (external/receiving chain)
  // xpub is already at account level (m/84'/0'/0'), so we derive 0/index
  const child = node.derive(0).derive(index);
  
  const { address } = bitcoin.payments.p2wpkh({
    pubkey: child.publicKey,
    network,
  });

  if (!address) {
    throw new Error("Failed to derive address");
  }

  return {
    address,
    path: `m/84'/${BTC_NETWORK === "mainnet" ? 0 : 1}'/0'/0/${index}`,
  };
}

// Check address transactions and confirmations via mempool.space API
async function checkAddress(address: string): Promise<{
  txid?: string;
  confirmations?: number;
  amountSats?: number;
}> {
  try {
    // Get address transactions
    const response = await axios.get(`${MEMPOOL_API_BASE}/address/${address}/txs`, {
      timeout: 10000,
    });

    const txs = response.data;
    if (!Array.isArray(txs) || txs.length === 0) {
      return {}; // No transactions
    }

    // Find the most recent transaction that credits this address
    for (const tx of txs) {
      // Check if this tx has an output to our address
      const vout = tx.vout.find((output: any) => 
        output.scriptpubkey_address === address
      );

      if (vout) {
        const amountSats = vout.value;
        
        // Get confirmation count
        let confirmations = 0;
        if (tx.status && tx.status.confirmed) {
          // Get current block height
          const tipResponse = await axios.get(`${MEMPOOL_API_BASE}/blocks/tip/height`, {
            timeout: 10000,
          });
          const tipHeight = tipResponse.data;
          confirmations = tipHeight - tx.status.block_height + 1;
        }

        return {
          txid: tx.txid,
          confirmations,
          amountSats,
        };
      }
    }

    return {}; // No relevant transactions
  } catch (error: any) {
    console.error(`Error checking address ${address}:`, error.message);
    return {};
  }
}

// Monitor tracked addresses and report confirmed payments
async function monitorAddresses() {
  const now = new Date();
  const REORG_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours - continue monitoring paid invoices
  
  for (const [invoiceId, tracked] of trackedAddresses.entries()) {
    // Continue monitoring paid invoices within reorg window for security
    const isPaidRecently = tracked.paid && tracked.paidAt && 
      (now.getTime() - tracked.paidAt.getTime() < REORG_WINDOW_MS);
    
    // Skip old paid invoices outside reorg window
    if (tracked.paid && !isPaidRecently) continue;

    // Check blockchain
    const result = await checkAddress(tracked.address);
    
    // Update last checked
    tracked.lastChecked = now;

    if (result.txid) {
      // Transaction found
      tracked.txid = result.txid;
      tracked.confirmations = result.confirmations || 0;

      // Validate amount matches invoice (critical security check)
      const amountMismatch = result.amountSats && result.amountSats !== tracked.amountSats;
      if (amountMismatch) {
        console.error(JSON.stringify({
          invoiceId,
          address: tracked.address,
          txid: result.txid,
          event: "amount_mismatch",
          expected: tracked.amountSats,
          received: result.amountSats,
        }));
        // Don't mark as paid if amount doesn't match
        continue;
      }

      console.log(JSON.stringify({
        invoiceId,
        address: tracked.address,
        txid: result.txid,
        confirmations: tracked.confirmations,
        amountSats: result.amountSats,
        event: tracked.confirmations >= BTC_CONFIRMATIONS_REQUIRED ? "confirmed" : "pending",
      }));

      // Reorg detection for already-paid invoices
      if (tracked.paid && tracked.confirmations < BTC_CONFIRMATIONS_REQUIRED) {
        console.error(JSON.stringify({
          invoiceId,
          address: tracked.address,
          txid: result.txid,
          event: "reorg_detected_post_payment",
          confirmations: tracked.confirmations,
          threshold: BTC_CONFIRMATIONS_REQUIRED,
        }));
        // WARNING: Invoice already marked paid but confirmations dropped
        // Manual intervention may be required to reverse payment
        // Future enhancement: Implement automatic payment reversal callback
      }

      // If enough confirmations, notify payments service
      if (tracked.confirmations >= BTC_CONFIRMATIONS_REQUIRED && !tracked.paid) {
        try {
          // Re-check confirmations before finalizing (reorg protection)
          const recheckResult = await checkAddress(tracked.address);
          if (!recheckResult.txid || (recheckResult.confirmations || 0) < BTC_CONFIRMATIONS_REQUIRED) {
            console.warn(`Reorg detected or confirmations dropped for invoice ${invoiceId}, skipping payment confirmation`);
            tracked.confirmations = recheckResult.confirmations || 0;
            continue;
          }

          // Get current block height for blockHeight field
          const tipResponse = await axios.get(`${MEMPOOL_API_BASE}/blocks/tip/height`, {
            timeout: 10000,
          });
          const tipHeight = tipResponse.data;
          
          // Get transaction details to find block height
          const txResponse = await axios.get(`${MEMPOOL_API_BASE}/tx/${result.txid}/status`, {
            timeout: 10000,
          });
          const blockHeight = txResponse.data.block_height;

          const response = await axios.post(
            `${PAYMENTS_SERVICE_URL}/api/rails/btc/confirmed`,
            {
              invoiceId,
              transactionId: result.txid,
              confirmations: recheckResult.confirmations,
              blockHeight,
            },
            {
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${RAIL_AUTH_TOKEN}`,
              },
              timeout: 10000,
            }
          );

          if (response.status === 200) {
            tracked.paid = true;
            tracked.paidAt = new Date();
            console.log(`✓ Payment confirmed and reported for invoice ${invoiceId}`);
          } else {
            console.error(`Payment callback failed for invoice ${invoiceId}: HTTP ${response.status}`);
          }
        } catch (error: any) {
          console.error(`Failed to notify payments service for invoice ${invoiceId}:`, error.message);
        }
      }
    }
  }
}

// Start monitoring loop
let monitoringInterval: NodeJS.Timeout | null = null;

function startMonitoring() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
  }

  // Initial check
  monitorAddresses().catch(err => {
    console.error("Error in initial monitoring:", err);
  });

  // Set up interval
  monitoringInterval = setInterval(() => {
    monitorAddresses().catch(err => {
      console.error("Error in monitoring interval:", err);
    });
  }, POLLING_INTERVAL_MS);

  console.log(`Started blockchain monitoring (interval: ${POLLING_INTERVAL_MS}ms, confirmations: ${BTC_CONFIRMATIONS_REQUIRED})`);
}

// POST /create - Derive a new Bitcoin address for an invoice
app.post("/create", async (req: Request, res: Response) => {
  try {
    const { invoiceId, amountSats } = createAddressSchema.parse(req.body);

    // Check if we already have an address for this invoice
    if (trackedAddresses.has(invoiceId)) {
      const existing = trackedAddresses.get(invoiceId)!;
      return res.json({
        address: existing.address,
        derivationPath: existing.derivationPath,
      });
    }

    // Derive new address
    const index = nextDerivationIndex++;
    const { address, path } = deriveAddress(BTC_XPUB, index);

    // Track this address
    const tracked: TrackedAddress = {
      invoiceId,
      address,
      derivationIndex: index,
      derivationPath: path,
      amountSats,
      createdAt: new Date(),
      paid: false,
    };

    trackedAddresses.set(invoiceId, tracked);

    console.log(`✓ Bitcoin address derived: ${address} (${path}) for invoice ${invoiceId}`);

    res.json({
      address,
      derivationPath: path,
    });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return res.status(400).json({ 
        error: "Invalid request",
        details: error.errors 
      });
    }
    console.error("Error creating Bitcoin address:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /health - Health check endpoint
app.get("/health", (_req: Request, res: Response) => {
  const hasXpub = BTC_XPUB && BTC_XPUB.length > 0;
  const hasAuthToken = RAIL_AUTH_TOKEN && RAIL_AUTH_TOKEN.length > 0;
  
  if (!hasXpub || !hasAuthToken) {
    return res.status(503).json({ 
      ok: false, 
      service: "rail-btc",
      error: "Misconfigured",
      details: {
        xpub_configured: hasXpub,
        auth_token_configured: hasAuthToken,
      }
    });
  }

  res.json({ 
    ok: true, 
    service: "rail-btc",
    network: BTC_NETWORK,
    confirmations_required: BTC_CONFIRMATIONS_REQUIRED,
    tracked_addresses: trackedAddresses.size,
  });
});

// Startup validation
function validateConfiguration(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!RAIL_AUTH_TOKEN || RAIL_AUTH_TOKEN.length === 0) {
    errors.push("RAIL_AUTH_TOKEN not configured");
  }

  if (!BTC_XPUB || BTC_XPUB.length === 0) {
    errors.push("BTC_XPUB not configured");
  } else {
    // Validate xpub format and network compatibility
    try {
      const network = getBitcoinNetwork();
      const node = bip32.fromBase58(BTC_XPUB, network);
      
      // Additional validation: check prefix matches network
      const expectedPrefixes = BTC_NETWORK === "mainnet" 
        ? ["xpub", "ypub", "zpub"] 
        : ["tpub", "upub", "vpub"];
      
      const hasValidPrefix = expectedPrefixes.some(prefix => BTC_XPUB.startsWith(prefix));
      if (!hasValidPrefix) {
        errors.push(`BTC_XPUB prefix doesn't match BTC_NETWORK=${BTC_NETWORK} (expected: ${expectedPrefixes.join(", ")})`);
      }
    } catch (error) {
      errors.push(`BTC_XPUB is invalid: ${error}`);
    }
  }

  if (BTC_CONFIRMATIONS_REQUIRED < 1) {
    errors.push("BTC_CONFIRMATIONS_REQUIRED must be at least 1");
  }

  if (!PAYMENTS_SERVICE_URL || PAYMENTS_SERVICE_URL.length === 0) {
    errors.push("PAYMENTS_SERVICE_URL not configured");
  }

  return { valid: errors.length === 0, errors };
}

// Start server
const configResult = validateConfiguration();

if (!configResult.valid) {
  console.error("╔═══════════════════════════════════════════════════════════╗");
  console.error("║ CRITICAL: Bitcoin rail service configuration errors      ║");
  console.error("╠═══════════════════════════════════════════════════════════╣");
  configResult.errors.forEach(err => {
    const paddedErr = err.length > 57 ? err.substring(0, 54) + "..." : err;
    console.error(`║ • ${paddedErr.padEnd(57)}║`);
  });
  console.error("╚═══════════════════════════════════════════════════════════╝");
  console.error("\n❌ Service will not start - fix configuration and restart\n");
  console.error("Set required environment variables:");
  console.error("  - BTC_XPUB");
  console.error("  - RAIL_AUTH_TOKEN");
  console.error("  - PAYMENTS_SERVICE_URL\n");
  
  // Exit with error code - don't run the server in misconfigured state
  process.exit(1);
}

app.listen(PORT, "0.0.0.0", () => {
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║       Bitcoin Rail Service (rail-btc) v2.0.0             ║");
  console.log("╠═══════════════════════════════════════════════════════════╣");
  console.log("║ Status:       ✓ OPERATIONAL                               ║");
  console.log(`║ Network:      ${BTC_NETWORK.toUpperCase().padEnd(46)}║`);
  console.log(`║ Port:         ${PORT.toString().padEnd(46)}║`);
  console.log(`║ Confirmations: ${BTC_CONFIRMATIONS_REQUIRED.toString().padEnd(45)}║`);
  console.log("╚═══════════════════════════════════════════════════════════╝");

  startMonitoring();
});
