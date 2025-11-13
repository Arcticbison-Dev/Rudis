import express, { Request, Response, NextFunction } from "express";
import { config } from "dotenv";
import * as bitcoin from "bitcoinjs-lib";
import BIP32Factory from "bip32";
import * as ecc from "tiny-secp256k1";
import axios from "axios";
import { z } from "zod";
import { storage } from "./storage";
import type { BtcPaymentState } from "../../shared/schema";

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
// ENHANCED: Aggregates ALL outputs sent to address (multi-output transaction support)
async function checkAddress(address: string): Promise<{
  txid?: string;
  confirmations?: number;
  amountSats?: number;
  blockHeight?: number;
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
    // ENHANCEMENT: Aggregate ALL outputs to this address in the transaction
    for (const tx of txs) {
      // Find all outputs to our address in this transaction
      const relevantOutputs = tx.vout.filter((output: any) => 
        output.scriptpubkey_address === address
      );

      if (relevantOutputs.length > 0) {
        // Aggregate total amount across all outputs to this address
        const amountSats = relevantOutputs.reduce(
          (sum: number, output: any) => sum + output.value,
          0
        );
        
        // Get confirmation count
        let confirmations = 0;
        let blockHeight: number | undefined;
        
        if (tx.status && tx.status.confirmed) {
          blockHeight = tx.status.block_height;
          // Get current block height
          const tipResponse = await axios.get(`${MEMPOOL_API_BASE}/blocks/tip/height`, {
            timeout: 10000,
          });
          const tipHeight = tipResponse.data;
          confirmations = tipHeight - blockHeight + 1;
        }

        return {
          txid: tx.txid,
          confirmations,
          amountSats,
          blockHeight,
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
// ENHANCED: Production-ready state machine with database persistence
async function monitorAddresses() {
  const now = new Date();
  const REORG_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

  try {
    // Get all active payment states (unseen, pending, confirmed)
    const activeStates = await storage.getAllActivePaymentStates();
    
    // Get recently settled states for reorg monitoring
    const recentlySettled = await storage.getRecentlySettledStates(REORG_WINDOW_MS);

    // Combine both sets for monitoring
    const allStatesToMonitor = [...activeStates, ...recentlySettled];

    for (const state of allStatesToMonitor) {
      const invoiceId = state.invoiceId;
      const address = state.address;
      const currentState = state.state;
      const previousTxid = state.txid;

      // Check blockchain
      const result = await checkAddress(address);

      // Update last checked timestamp
      await storage.updatePaymentState(invoiceId, {
        lastChecked: now,
      });

      if (!result.txid) {
        // No transaction found
        // If state was previously pending/confirmed, this might indicate a reorg
        if (currentState === "pending" || currentState === "confirmed") {
          console.warn(JSON.stringify({
            invoiceId,
            address,
            event: "transaction_disappeared",
            previousState: currentState,
            previousTxid,
          }));
          
          // Transition back to unseen
          await storage.updatePaymentState(invoiceId, {
            state: "unseen",
            txid: null,
            confirmations: "0",
            blockHeight: null,
          });

          console.log(JSON.stringify({
            invoiceId,
            address,
            event: "state_transition",
            from: currentState,
            to: "unseen",
            reason: "transaction_disappeared",
          }));
        }
        continue;
      }

      // Transaction found
      const txid = result.txid;
      const confirmations = result.confirmations || 0;
      const amountSats = result.amountSats || 0;
      const blockHeight = result.blockHeight;

      // RBF Detection: Check if txid changed
      if (previousTxid && previousTxid !== txid) {
        console.warn(JSON.stringify({
          invoiceId,
          address,
          event: "rbf_detected",
          oldTxid: previousTxid,
          newTxid: txid,
          previousState: currentState,
        }));

        // Reset to pending state with new txid
        await storage.updatePaymentState(invoiceId, {
          state: "pending",
          txid,
          confirmations: confirmations.toString(),
          blockHeight: blockHeight?.toString() || null,
          amountSats: amountSats.toString(),
        });

        console.log(JSON.stringify({
          invoiceId,
          address,
          event: "state_transition",
          from: currentState,
          to: "pending",
          reason: "rbf_detected",
          txid,
          confirmations,
        }));

        continue;
      }

      // Get expected amount from address derivation
      const derivation = await storage.getAddressDerivation(invoiceId);
      const expectedAmountSats = derivation ? parseInt(derivation.amountSats) : 0;

      // Validate amount matches invoice (critical security check)
      if (amountSats !== expectedAmountSats) {
        console.error(JSON.stringify({
          invoiceId,
          address,
          txid,
          event: "amount_mismatch",
          expected: expectedAmountSats,
          received: amountSats,
          state: currentState,
        }));
        // Don't transition state if amount doesn't match
        continue;
      }

      // STATE MACHINE TRANSITIONS

      // Handle reorg for settled states
      if (currentState === "settled" && confirmations < BTC_CONFIRMATIONS_REQUIRED) {
        console.error(JSON.stringify({
          invoiceId,
          address,
          txid,
          event: "REORG_DETECTED",
          confirmations,
          threshold: BTC_CONFIRMATIONS_REQUIRED,
          severity: "CRITICAL",
        }));

        // Transition settled -> pending
        await storage.updatePaymentState(invoiceId, {
          state: "pending",
          confirmations: confirmations.toString(),
          paidAt: null,
        });

        console.log(JSON.stringify({
          invoiceId,
          address,
          event: "state_transition",
          from: "settled",
          to: "pending",
          reason: "reorg_detected",
          txid,
          confirmations,
        }));

        // Call reversal webhook to notify payments service
        try {
          const reversalResponse = await axios.post(
            `${PAYMENTS_SERVICE_URL}/api/rails/btc/reverted`,
            {
              invoiceId,
              reason: "reorg_detected",
              originalTxid: txid,
              confirmations,
            },
            {
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${RAIL_AUTH_TOKEN}`,
              },
              timeout: 10000,
            }
          );

          if (reversalResponse.status === 200) {
            console.log(JSON.stringify({
              invoiceId,
              event: "reversal_webhook_success",
              txid,
            }));
          } else {
            console.error(JSON.stringify({
              invoiceId,
              event: "reversal_webhook_failed",
              status: reversalResponse.status,
              txid,
            }));
          }
        } catch (error: any) {
          console.error(JSON.stringify({
            invoiceId,
            event: "reversal_webhook_error",
            error: error.message,
            txid,
          }));
        }

        continue;
      }

      // Transition: unseen -> pending (transaction appears in mempool)
      if (currentState === "unseen") {
        await storage.updatePaymentState(invoiceId, {
          state: "pending",
          txid,
          confirmations: confirmations.toString(),
          blockHeight: blockHeight?.toString() || null,
          amountSats: amountSats.toString(),
        });

        console.log(JSON.stringify({
          invoiceId,
          address,
          event: "state_transition",
          from: "unseen",
          to: "pending",
          txid,
          confirmations,
          amountSats,
        }));

        continue;
      }

      // Update confirmations for pending/confirmed states
      if (currentState === "pending" || currentState === "confirmed") {
        await storage.updatePaymentState(invoiceId, {
          confirmations: confirmations.toString(),
          blockHeight: blockHeight?.toString() || null,
        });
      }

      // Transition: pending -> confirmed (confirmations >= threshold)
      if (currentState === "pending" && confirmations >= BTC_CONFIRMATIONS_REQUIRED) {
        await storage.updatePaymentState(invoiceId, {
          state: "confirmed",
          confirmations: confirmations.toString(),
        });

        console.log(JSON.stringify({
          invoiceId,
          address,
          event: "state_transition",
          from: "pending",
          to: "confirmed",
          txid,
          confirmations,
          amountSats,
        }));

        // Don't continue - let it proceed to the settled transition
      }

      // Transition: confirmed -> settled (after successful callback)
      if (currentState === "confirmed" || 
          (currentState === "pending" && confirmations >= BTC_CONFIRMATIONS_REQUIRED)) {
        try {
          // Re-check confirmations before finalizing (reorg protection)
          const recheckResult = await checkAddress(address);
          if (!recheckResult.txid || (recheckResult.confirmations || 0) < BTC_CONFIRMATIONS_REQUIRED) {
            console.warn(JSON.stringify({
              invoiceId,
              event: "reorg_detected_before_settlement",
              previousConfirmations: confirmations,
              currentConfirmations: recheckResult.confirmations || 0,
            }));
            
            // Update confirmations and don't settle
            await storage.updatePaymentState(invoiceId, {
              confirmations: (recheckResult.confirmations || 0).toString(),
            });
            continue;
          }

          // Call payments service to confirm payment
          const response = await axios.post(
            `${PAYMENTS_SERVICE_URL}/api/rails/btc/confirmed`,
            {
              invoiceId,
              transactionId: txid,
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
            // Transition to settled
            await storage.updatePaymentState(invoiceId, {
              state: "settled",
              confirmations: recheckResult.confirmations.toString(),
              paidAt: new Date(),
            });

            console.log(JSON.stringify({
              invoiceId,
              address,
              event: "state_transition",
              from: currentState,
              to: "settled",
              txid,
              confirmations: recheckResult.confirmations,
            }));

            console.log(`✓ Payment confirmed and settled for invoice ${invoiceId}`);
          } else {
            console.error(JSON.stringify({
              invoiceId,
              event: "payment_callback_failed",
              status: response.status,
              txid,
            }));
          }
        } catch (error: any) {
          console.error(JSON.stringify({
            invoiceId,
            event: "payment_callback_error",
            error: error.message,
            txid,
          }));
        }
      }
    }
  } catch (error: any) {
    console.error("Error in monitorAddresses:", error.message);
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
// ENHANCED: Uses database persistence for crash-safe operation
app.post("/create", async (req: Request, res: Response) => {
  try {
    const { invoiceId, amountSats } = createAddressSchema.parse(req.body);

    // Check if we already have an address for this invoice (idempotent operation)
    const existingDerivation = await storage.getAddressDerivation(invoiceId);
    if (existingDerivation) {
      return res.json({
        address: existingDerivation.address,
        derivationPath: existingDerivation.derivationPath,
      });
    }

    // Get next derivation index from database
    const index = await storage.getNextDerivationIndex();
    const { address, path } = deriveAddress(BTC_XPUB, index);

    // Persist address derivation to database
    await storage.createAddressDerivation({
      invoiceId,
      address,
      derivationIndex: index,
      derivationPath: path,
      amountSats,
    });

    // Initialize payment state as "unseen"
    await storage.createPaymentState({
      invoiceId,
      address,
      state: "unseen",
      confirmations: 0,
    });

    console.log(JSON.stringify({
      invoiceId,
      address,
      derivationPath: path,
      derivationIndex: index,
      amountSats,
      event: "address_created",
      state: "unseen",
    }));

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
app.get("/health", async (_req: Request, res: Response) => {
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

  try {
    // Get count of active payment states from database
    const activeStates = await storage.getAllActivePaymentStates();
    
    res.json({ 
      ok: true, 
      service: "rail-btc",
      network: BTC_NETWORK,
      confirmations_required: BTC_CONFIRMATIONS_REQUIRED,
      tracked_addresses: activeStates.length,
      persistence: "database",
    });
  } catch (error: any) {
    return res.status(503).json({
      ok: false,
      service: "rail-btc",
      error: "Database unavailable",
      details: error.message,
    });
  }
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
  console.log("║       Bitcoin Rail Service (rail-btc) v3.0.0             ║");
  console.log("╠═══════════════════════════════════════════════════════════╣");
  console.log("║ Status:       ✓ OPERATIONAL                               ║");
  console.log(`║ Network:      ${BTC_NETWORK.toUpperCase().padEnd(46)}║`);
  console.log(`║ Port:         ${PORT.toString().padEnd(46)}║`);
  console.log(`║ Confirmations: ${BTC_CONFIRMATIONS_REQUIRED.toString().padEnd(45)}║`);
  console.log("║ Persistence:  Database (Production-Ready)                 ║");
  console.log("╚═══════════════════════════════════════════════════════════╝");

  startMonitoring();
});
