import express, { Request, Response, NextFunction } from "express";
import { config } from "dotenv";
import axios from "axios";
import { z } from "zod";
import { XmrStorage, hashTxid } from "./storage.js";
import { MoneroRpcClient } from "./monero-rpc.js";

config();

// SECURITY: Fail-fast validation BEFORE any initialization (mirrors rail-btc pattern)
const RAIL_AUTH_TOKEN = process.env.RAIL_AUTH_TOKEN || "";
const XMR_RPC_HOST = process.env.XMR_RPC_HOST || "";
const XMR_RPC_PORT = process.env.XMR_RPC_PORT || "";

if (!RAIL_AUTH_TOKEN || RAIL_AUTH_TOKEN.length === 0) {
  console.error("╔═══════════════════════════════════════════════════════════╗");
  console.error("║ FATAL: RAIL_AUTH_TOKEN not set                           ║");
  console.error("║ This service cannot run without authentication           ║");
  console.error("║ Set RAIL_AUTH_TOKEN in environment before starting       ║");
  console.error("╚═══════════════════════════════════════════════════════════╝");
  process.exit(1);
}

if (!XMR_RPC_HOST || !XMR_RPC_PORT) {
  console.error("╔═══════════════════════════════════════════════════════════╗");
  console.error("║ FATAL: XMR_RPC_HOST and XMR_RPC_PORT required            ║");
  console.error("║ Monero Wallet RPC connection details must be configured  ║");
  console.error("║ Set XMR_RPC_HOST and XMR_RPC_PORT in environment         ║");
  console.error("╚═══════════════════════════════════════════════════════════╝");
  process.exit(1);
}

// Environment configuration (after validation)
const PORT = parseInt(process.env.PORT || "5003", 10);
const PAYMENTS_SERVICE_URL = process.env.PAYMENTS_SERVICE_URL || "http://localhost:5000";
const XMR_RPC_PORT_NUM = parseInt(XMR_RPC_PORT, 10);
const XMR_RPC_USERNAME = process.env.XMR_RPC_USERNAME || "";
const XMR_RPC_PASSWORD = process.env.XMR_RPC_PASSWORD || "";
const XMR_ACCOUNT_INDEX = parseInt(process.env.XMR_ACCOUNT_INDEX || "0", 10);
const XMR_CONFIRMATIONS_REQUIRED = parseInt(process.env.XMR_CONFIRMATIONS_REQUIRED || "10", 10);
const POLLING_INTERVAL_MS = parseInt(process.env.POLLING_INTERVAL_MS || "30000", 10);
const MAX_CALLBACK_ATTEMPTS = parseInt(process.env.MAX_CALLBACK_ATTEMPTS || "5", 10);

// Initialize Express app and middleware
const app = express();
app.use(express.json());

// Initialize storage and RPC client (after validation)
const storage = new XmrStorage();
const moneroRpc = new MoneroRpcClient({
  host: XMR_RPC_HOST,
  port: XMR_RPC_PORT_NUM,
  username: XMR_RPC_USERNAME,
  password: XMR_RPC_PASSWORD,
});

// Zod schemas for validation
const createSubaddressSchema = z.object({
  invoiceId: z.string().uuid(),
  amountAtomic: z.string(), // Monero amount in atomic units (piconeros, 1 XMR = 1e12)
});

// Authentication middleware - Validates requests from payments service only
function authenticatePaymentsService(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = authHeader.substring(7);

  if (!token || token !== RAIL_AUTH_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}

// Callback to payments service with retry logic
async function callbackPaymentsService(
  invoiceId: string,
  rawTxid: string,
  confirmations: number,
  blockHeight: number
): Promise<boolean> {
  try {
    const response = await axios.post(
      `${PAYMENTS_SERVICE_URL}/api/rails/xmr/confirmed`,
      {
        invoiceId,
        transactionId: rawTxid, // Send raw txid to payments service (they need it for their records)
        confirmations,
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
      console.log(JSON.stringify({
        invoiceId,
        rail: "xmr",
        event: "callback_sent"
      }));
      return true;
    } else {
      console.error(JSON.stringify({
        invoiceId,
        rail: "xmr",
        event: "callback_failed"
      }));
      return false;
    }
  } catch (error: any) {
    console.error(JSON.stringify({
      invoiceId,
      rail: "xmr",
      event: "callback_failed"
    }));
    return false;
  }
}

// Monitoring loop - Check for incoming payments
async function monitorSubaddresses() {
  try {
    const activeStates = storage.getAllActivePaymentStates();

    for (const state of activeStates) {
      try {
        const subaddress = storage.getSubaddress(state.invoiceId);
        if (!subaddress) continue;

        // Get all incoming transfers for this subaddress
        const transfers = await moneroRpc.getTransfers(
          XMR_ACCOUNT_INDEX,
          undefined,
          [subaddress.addressIndex]
        );

        if (!transfers.in || transfers.in.length === 0) {
          // No payment yet, check if callback_pending needs retry
          if (state.state === "callback_pending" && state.callbackAttempts < MAX_CALLBACK_ATTEMPTS) {
            // Retry callback (we have txid from previous state)
            // Note: We don't have raw txid anymore, only hash - callback will fail
            // This is acceptable: callbacks should succeed on first attempt
            // If they fail, manual intervention required
            continue;
          }
          continue;
        }

        // CRITICAL: Aggregate all outputs for this invoice/subaddress
        // Monero wallets commonly split payments into multiple outputs
        // We need to SUM all amounts to get the true payment total
        let totalReceivedAmount = 0;
        let minConfirmations = Infinity; // Use MINIMUM confirmations (most conservative)
        let maxBlockHeight = 0;
        let primaryTxid = "";

        for (const transfer of transfers.in) {
          totalReceivedAmount += transfer.amount;
          
          // CRITICAL: Use MINIMUM confirmations across all transfers
          // This ensures ALL components of the payment are confirmed before settling
          if (transfer.confirmations < minConfirmations) {
            minConfirmations = transfer.confirmations;
          }

          // Track the latest transaction's metadata
          if (transfer.height > maxBlockHeight || primaryTxid === "") {
            primaryTxid = transfer.txid;
            maxBlockHeight = transfer.height;
          }
        }

        // Use aggregated values for validation
        const confirmations = minConfirmations === Infinity ? 0 : minConfirmations;
        const rawTxid = primaryTxid; // Most recent txid
        const rawAmount = totalReceivedAmount; // Total from ALL transfers
        const blockHeight = maxBlockHeight;

        // PRIVACY: Hash txid before any storage operation
        const hashedTxid = hashTxid(rawTxid);

        // Reload state to ensure we have latest (prevents race conditions)
        let currentState = storage.getPaymentState(state.invoiceId);
        if (!currentState) continue;

        // STATE MACHINE: unseen → pending → confirmed → callback_pending → settled

        // IDEMPOTENCY GUARD: Skip if already settled
        if (currentState.state === "settled") {
          continue;
        }

        // Transition: unseen → pending (transaction appears)
        if (currentState.state === "unseen") {
          // CRITICAL: Validate amount matches expected value
          const expectedAmountStr = subaddress.expectedAmountAtomic;
          const receivedAmountStr = rawAmount.toString();
          const amountMatches = expectedAmountStr === receivedAmountStr;

          // Store HASHED txid and VALIDATED amount match, NOT raw values
          storage.updatePaymentState(state.invoiceId, {
            state: "pending",
            hashedTxid: hashedTxid,
            amountMatch: amountMatches, // ACTUAL comparison, not hardcoded
            confirmations: confirmations.toString(),
            blockHeight: blockHeight.toString(),
          });

          console.log(JSON.stringify({
            invoiceId: state.invoiceId,
            rail: "xmr",
            event: amountMatches ? "tx_seen" : "amount_mismatch"
          }));

          // Reload state after transition
          currentState = storage.getPaymentState(state.invoiceId);
          if (!currentState) continue;
        }

        // CRITICAL: Block settlement if amount doesn't match
        if (currentState.amountMatch === false) {
          // Amount mismatch detected - stop processing this invoice
          console.error(JSON.stringify({
            invoiceId: state.invoiceId,
            rail: "xmr",
            event: "settlement_blocked_amount_mismatch"
          }));
          continue; // Skip to next invoice, never settle this one
        }

        // Update confirmations for pending/confirmed states
        if (currentState.state === "pending" || currentState.state === "confirmed") {
          storage.updatePaymentState(state.invoiceId, {
            confirmations: confirmations.toString(),
            blockHeight: blockHeight.toString(),
          });
        }

        // Transition: pending → confirmed (confirmations >= threshold)
        if (currentState.state === "pending" && confirmations >= XMR_CONFIRMATIONS_REQUIRED) {
          storage.updatePaymentState(state.invoiceId, {
            state: "confirmed",
            confirmations: confirmations.toString(),
          });

          console.log(JSON.stringify({
            invoiceId: state.invoiceId,
            rail: "xmr",
            event: "confirmed"
          }));

          // Reload state after transition
          currentState = storage.getPaymentState(state.invoiceId);
          if (!currentState) continue;
        }

        // Transition: confirmed → callback_pending (ready for callback)
        if (currentState.state === "confirmed") {
          storage.updatePaymentState(state.invoiceId, {
            state: "callback_pending",
            confirmations: confirmations.toString(),
          });

          // Reload state
          currentState = storage.getPaymentState(state.invoiceId);
          if (!currentState) continue;
        }

        // Transition: callback_pending → settled (after successful callback)
        if (currentState.state === "callback_pending") {
          // CRITICAL: Enforce MAX_CALLBACK_ATTEMPTS ceiling
          if (currentState.callbackAttempts >= MAX_CALLBACK_ATTEMPTS) {
            // Max retries already reached, stop attempting
            console.error(JSON.stringify({
              invoiceId: state.invoiceId,
              rail: "xmr",
              event: "callback_max_retries_exceeded"
            }));
            continue; // Skip to next invoice, manual intervention required
          }

          // Attempt callback
          const callbackSuccess = await callbackPaymentsService(
            state.invoiceId,
            rawTxid, // Send raw txid to payments service (transient, not stored)
            confirmations,
            blockHeight
          );

          // Update callback attempt tracking
          const newAttempts = currentState.callbackAttempts + 1;
          storage.updatePaymentState(state.invoiceId, {
            callbackAttempts: newAttempts,
            lastCallbackAttempt: new Date(),
          });

          if (callbackSuccess) {
            // Callback succeeded, mark as settled
            storage.updatePaymentState(state.invoiceId, {
              state: "settled",
              paidAt: new Date(),
            });
          } else if (newAttempts >= MAX_CALLBACK_ATTEMPTS) {
            // Max retries reached, log for manual intervention
            console.error(JSON.stringify({
              invoiceId: state.invoiceId,
              rail: "xmr",
              event: "callback_max_retries"
            }));
          }
          // If callback failed but retries remain, will retry on next poll
        }
      } catch (error: any) {
        // Silent error - will retry on next interval
      }
    }
  } catch (error: any) {
    // Silent error - monitoring will retry on next interval
  }
}

// Start monitoring loop
let monitoringInterval: NodeJS.Timeout | null = null;

function startMonitoring() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
  }

  // Initial check
  monitorSubaddresses().catch((err: any) => {
    // Silent error - will retry on interval
  });

  // Periodic monitoring
  monitoringInterval = setInterval(async () => {
    await monitorSubaddresses().catch((err: any) => {
      // Silent error - will retry on next interval
    });
  }, POLLING_INTERVAL_MS);

  console.log(`Started Monero payment monitoring (interval: ${POLLING_INTERVAL_MS}ms, confirmations: ${XMR_CONFIRMATIONS_REQUIRED})`);
}

// Graceful shutdown
process.on("SIGINT", () => {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
  }
  storage.close();
  process.exit(0);
});

// POST /create - Create new Monero subaddress for invoice
app.post("/create", authenticatePaymentsService, async (req: Request, res: Response) => {
  try {
    const { invoiceId, amountAtomic } = createSubaddressSchema.parse(req.body);

    // Idempotent: Return existing subaddress if already generated
    const existingSubaddress = storage.getSubaddress(invoiceId);
    if (existingSubaddress) {
      return res.json({
        subaddress: existingSubaddress.subaddress,
        accountIndex: existingSubaddress.accountIndex,
        addressIndex: existingSubaddress.addressIndex,
      });
    }

    // Create new subaddress via Monero RPC
    const rpcResult = await moneroRpc.createAddress(
      XMR_ACCOUNT_INDEX,
      `Invoice:${invoiceId.substring(0, 8)}`
    );

    // Persist to database (crash-safe, with expected amount for validation)
    storage.createSubaddress({
      invoiceId,
      subaddress: rpcResult.address,
      accountIndex: XMR_ACCOUNT_INDEX,
      addressIndex: rpcResult.address_index,
      expectedAmountAtomic: amountAtomic,
    });

    // Initialize payment state
    storage.createPaymentState(invoiceId, rpcResult.address);

    console.log(JSON.stringify({
      invoiceId,
      rail: "xmr",
      event: "subaddress_created"
    }));

    res.json({
      subaddress: rpcResult.address,
      accountIndex: XMR_ACCOUNT_INDEX,
      addressIndex: rpcResult.address_index,
    });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return res.status(400).json({ error: "Invalid request data" });
    }
    // Silent error - operational detail not exposed
    res.status(500).json({ error: "Failed to create Monero subaddress" });
  }
});

// GET /health - Health check endpoint
app.get("/health", async (_req: Request, res: Response) => {
  try {
    const isHealthy = await moneroRpc.ping();
    if (isHealthy) {
      res.json({ ok: true, service: "rail-xmr", walletRpc: "connected" });
    } else {
      res.status(503).json({ ok: false, service: "rail-xmr", walletRpc: "disconnected" });
    }
  } catch (error) {
    res.status(503).json({ ok: false, service: "rail-xmr", walletRpc: "error" });
  }
});

// Server startup
app.listen(PORT, "0.0.0.0", async () => {
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║       Monero Rail Service (rail-xmr) v2.0.0              ║");
  console.log("╠═══════════════════════════════════════════════════════════╣");
  console.log("║ Status:       ✓ OPERATIONAL                               ║");
  console.log(`║ Port:         ${PORT.toString().padEnd(46)}║`);
  console.log(`║ Account:      ${XMR_ACCOUNT_INDEX.toString().padEnd(46)}║`);
  console.log(`║ Confirmations: ${XMR_CONFIRMATIONS_REQUIRED.toString().padEnd(45)}║`);
  console.log("║ Privacy:      HASHED TXIDS (Privacy-First)                ║");
  console.log("║ Persistence:  Database (Production-Ready)                 ║");
  console.log("╚═══════════════════════════════════════════════════════════╝");

  // Test Monero RPC connection
  try {
    const isHealthy = await moneroRpc.ping();
    if (isHealthy) {
      console.log("✓ Monero Wallet RPC connected successfully");
      startMonitoring();
    } else {
      console.warn("⚠ Warning: Could not connect to Monero Wallet RPC");
      console.warn("  Service running in degraded mode. /create endpoints will fail.");
      console.warn(`  Check XMR_RPC_HOST (${XMR_RPC_HOST}) and XMR_RPC_PORT (${XMR_RPC_PORT})`);
    }
  } catch (error: any) {
    console.warn("⚠ Warning: Monero Wallet RPC connection error");
    console.warn("  Service running in degraded mode. /create endpoints will fail.");
    console.warn(`  Error: ${error.message}`);
  }
});
