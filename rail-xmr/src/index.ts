import express, { Request, Response, NextFunction } from "express";
import { config } from "dotenv";
import axios from "axios";
import { z } from "zod";
import { XmrStorage, hashTxid } from "./storage.js";
import { MoneroRpcClient } from "./monero-rpc.js";
import { randomBytes, createHash } from "crypto";

config();

const DEV_MODE = process.env.XMR_DEV_MODE === "true";
const XMR_NETWORK = process.env.XMR_NETWORK || "mainnet";
const RAIL_AUTH_TOKEN = process.env.RAIL_AUTH_TOKEN || "";
const XMR_RPC_HOST = process.env.XMR_RPC_HOST || "";
const XMR_RPC_PORT = process.env.XMR_RPC_PORT || "";

if (!RAIL_AUTH_TOKEN || RAIL_AUTH_TOKEN.length === 0) {
  console.error("FATAL: RAIL_AUTH_TOKEN not set");
  process.exit(1);
}

if (!DEV_MODE) {
  if (!XMR_RPC_HOST || !XMR_RPC_PORT) {
    console.error("FATAL: XMR_RPC_HOST and XMR_RPC_PORT required (set XMR_DEV_MODE=true for simulation)");
    process.exit(1);
  }

  const XMR_RPC_USERNAME = process.env.XMR_RPC_USERNAME || "";
  const XMR_RPC_PASSWORD = process.env.XMR_RPC_PASSWORD || "";

  if (!XMR_RPC_USERNAME || !XMR_RPC_PASSWORD) {
    console.error("FATAL: XMR_RPC_USERNAME and XMR_RPC_PASSWORD required");
    process.exit(1);
  }

  if (XMR_RPC_HOST !== "127.0.0.1" && XMR_RPC_HOST !== "localhost") {
    console.error("FATAL: Remote RPC host detected. For privacy, only localhost allowed. Use SSH tunnel for remote wallets.");
    process.exit(1);
  }
}

const PORT = parseInt(process.env.PORT || "5003", 10);
const PAYMENTS_SERVICE_URL = process.env.PAYMENTS_SERVICE_URL || "http://localhost:5000";
const XMR_ACCOUNT_INDEX = parseInt(process.env.XMR_ACCOUNT_INDEX || "0", 10);
const XMR_CONFIRMATIONS_REQUIRED = parseInt(process.env.XMR_CONFIRMATIONS_REQUIRED || "10", 10);
const POLLING_INTERVAL_MS = parseInt(process.env.POLLING_INTERVAL_MS || "30000", 10);
const MAX_CALLBACK_ATTEMPTS = parseInt(process.env.MAX_CALLBACK_ATTEMPTS || "5", 10);

const app = express();
app.use(express.json());

const storage = new XmrStorage();

let moneroRpc: MoneroRpcClient | null = null;
if (!DEV_MODE) {
  moneroRpc = new MoneroRpcClient({
    host: XMR_RPC_HOST,
    port: parseInt(XMR_RPC_PORT, 10),
    username: process.env.XMR_RPC_USERNAME,
    password: process.env.XMR_RPC_PASSWORD,
  });
}

let devAddressCounter = 0;

function generateDevSubaddress(): { address: string; address_index: number } {
  devAddressCounter++;
  const prefix = XMR_NETWORK === "stagenet" ? "5" : "4";
  const hash = createHash("sha256").update(`dev-subaddr-${devAddressCounter}-${Date.now()}`).digest("hex");
  const address = `${prefix}${hash}${hash}`.substring(0, 95);
  return {
    address,
    address_index: devAddressCounter,
  };
}

const createSubaddressSchema = z.object({
  invoiceId: z.string().uuid(),
  amountAtomic: z.string(),
});

function authenticatePaymentsService(req: Request, res: Response, next: NextFunction) {
  if (!RAIL_AUTH_TOKEN || RAIL_AUTH_TOKEN.length === 0) {
    return res.status(500).json({ error: "Server configuration error" });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = authHeader.substring(7);
  if (!token || token.length === 0 || token !== RAIL_AUTH_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}

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
        transactionId: rawTxid,
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
        rail: "xmr", event: "webhook.success", id: invoiceId
      }));
      return true;
    }
    console.error(JSON.stringify({
      rail: "xmr", event: "webhook.failed", id: invoiceId, error: `HTTP ${response.status}`
    }));
    return false;
  } catch (error: any) {
    console.error(JSON.stringify({
      rail: "xmr", event: "webhook.failed", id: invoiceId, error: error.message
    }));
    return false;
  }
}

async function monitorSubaddresses() {
  if (DEV_MODE) return;

  try {
    const activeStates = storage.getAllActivePaymentStates();

    for (const state of activeStates) {
      try {
        const subaddress = storage.getSubaddress(state.invoiceId);
        if (!subaddress || !moneroRpc) continue;

        const transfers = await moneroRpc.getTransfers(
          XMR_ACCOUNT_INDEX,
          undefined,
          [subaddress.addressIndex]
        );

        if (!transfers.in || transfers.in.length === 0) {
          continue;
        }

        let totalReceivedAmount = 0;
        let minConfirmations = Infinity;
        let maxBlockHeight = 0;
        let primaryTxid = "";

        for (const transfer of transfers.in) {
          totalReceivedAmount += transfer.amount;
          if (transfer.confirmations < minConfirmations) {
            minConfirmations = transfer.confirmations;
          }
          if (transfer.height > maxBlockHeight || primaryTxid === "") {
            primaryTxid = transfer.txid;
            maxBlockHeight = transfer.height;
          }
        }

        const confirmations = minConfirmations === Infinity ? 0 : minConfirmations;
        const rawTxid = primaryTxid;
        const rawAmount = totalReceivedAmount;
        const blockHeight = maxBlockHeight;
        const hashedTxid = hashTxid(rawTxid);

        const expectedAmountStr = subaddress.expectedAmountAtomic;
        const receivedAmountStr = rawAmount.toString();
        const amountMatches = expectedAmountStr === receivedAmountStr;

        let currentState = storage.getPaymentState(state.invoiceId);
        if (!currentState) continue;

        if (currentState.state === "settled") continue;

        if (currentState.state === "unseen") {
          storage.updatePaymentState(state.invoiceId, {
            state: "pending",
            hashedTxid,
            amountMatch: amountMatches,
            confirmations: confirmations.toString(),
            blockHeight: blockHeight.toString(),
          });
          console.log(JSON.stringify({
            rail: "xmr",
            event: amountMatches ? "payment.pending" : "payment.error",
            id: state.invoiceId,
            tx_hash: hashedTxid,
            ...(amountMatches ? {} : { error: "amount_mismatch" })
          }));
          currentState = storage.getPaymentState(state.invoiceId);
          if (!currentState) continue;
        }

        if (currentState.state === "pending" || currentState.state === "confirmed") {
          storage.updatePaymentState(state.invoiceId, { amountMatch: amountMatches });
          currentState = storage.getPaymentState(state.invoiceId);
          if (!currentState) continue;
        }

        if (currentState.amountMatch === false) continue;

        if (currentState.state === "pending" || currentState.state === "confirmed") {
          storage.updatePaymentState(state.invoiceId, {
            confirmations: confirmations.toString(),
            blockHeight: blockHeight.toString(),
          });
        }

        if (currentState.state === "pending" && confirmations >= XMR_CONFIRMATIONS_REQUIRED) {
          storage.updatePaymentState(state.invoiceId, {
            state: "confirmed",
            confirmations: confirmations.toString(),
          });
          console.log(JSON.stringify({
            rail: "xmr", event: "payment.confirmed", id: state.invoiceId,
            tx_hash: hashedTxid, confirmations
          }));
          currentState = storage.getPaymentState(state.invoiceId);
          if (!currentState) continue;
        }

        if (currentState.state === "confirmed") {
          storage.updatePaymentState(state.invoiceId, {
            state: "callback_pending",
            confirmations: confirmations.toString(),
          });
          currentState = storage.getPaymentState(state.invoiceId);
          if (!currentState) continue;
        }

        if (currentState.state === "callback_pending") {
          if (currentState.callbackAttempts >= MAX_CALLBACK_ATTEMPTS) continue;

          const callbackSuccess = await callbackPaymentsService(
            state.invoiceId, rawTxid, confirmations, blockHeight
          );

          const newAttempts = currentState.callbackAttempts + 1;
          storage.updatePaymentState(state.invoiceId, {
            callbackAttempts: newAttempts,
            lastCallbackAttempt: new Date(),
          });

          if (callbackSuccess) {
            storage.updatePaymentState(state.invoiceId, {
              state: "settled",
              paidAt: new Date(),
            });
          }
        }
      } catch (error: any) {
        // Will retry on next interval
      }
    }
  } catch (error: any) {
    // Will retry on next interval
  }
}

let monitoringInterval: NodeJS.Timeout | null = null;

function startMonitoring() {
  if (DEV_MODE) {
    console.log("DEV MODE: Monitoring disabled (use POST /simulate-payment to test)");
    return;
  }

  if (monitoringInterval) clearInterval(monitoringInterval);

  monitorSubaddresses().catch(() => {});

  monitoringInterval = setInterval(async () => {
    await monitorSubaddresses().catch(() => {});
  }, POLLING_INTERVAL_MS);

  console.log(`Started Monero payment monitoring (interval: ${POLLING_INTERVAL_MS}ms, confirmations: ${XMR_CONFIRMATIONS_REQUIRED})`);
}

process.on("SIGINT", () => {
  if (monitoringInterval) clearInterval(monitoringInterval);
  storage.close();
  process.exit(0);
});

app.post("/create", authenticatePaymentsService, async (req: Request, res: Response) => {
  try {
    const { invoiceId, amountAtomic } = createSubaddressSchema.parse(req.body);

    const existingSubaddress = storage.getSubaddress(invoiceId);
    if (existingSubaddress) {
      return res.json({
        subaddress: existingSubaddress.subaddress,
        accountIndex: existingSubaddress.accountIndex,
        addressIndex: existingSubaddress.addressIndex,
      });
    }

    let rpcResult: { address: string; address_index: number };

    if (DEV_MODE) {
      rpcResult = generateDevSubaddress();
    } else {
      if (!moneroRpc) {
        return res.status(503).json({ error: "Monero RPC not available" });
      }
      rpcResult = await moneroRpc.createAddress(
        XMR_ACCOUNT_INDEX,
        `Invoice:${invoiceId.substring(0, 8)}`
      );
    }

    storage.createSubaddress({
      invoiceId,
      subaddress: rpcResult.address,
      accountIndex: XMR_ACCOUNT_INDEX,
      addressIndex: rpcResult.address_index,
      expectedAmountAtomic: amountAtomic,
    });

    storage.createPaymentState(invoiceId, rpcResult.address);

    console.log(JSON.stringify({
      rail: "xmr", event: "payment.created", id: invoiceId,
      address: rpcResult.address.substring(0, 12) + "...",
      mode: DEV_MODE ? "dev" : "production"
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
    console.error(`XMR /create error: ${error.message}`);
    res.status(500).json({ error: "Failed to create Monero subaddress" });
  }
});

const simulatePaymentSchema = z.object({
  invoiceId: z.string().uuid(),
  confirmations: z.number().int().min(0).optional().default(10),
  blockHeight: z.number().int().min(0).optional().default(100000),
});

app.post("/simulate-payment", authenticatePaymentsService, async (req: Request, res: Response) => {
  if (!DEV_MODE) {
    return res.status(403).json({ error: "Simulation only available in dev mode" });
  }

  try {
    const { invoiceId, confirmations, blockHeight } = simulatePaymentSchema.parse(req.body);

    const subaddress = storage.getSubaddress(invoiceId);
    if (!subaddress) {
      return res.status(404).json({ error: "No subaddress found for this invoice" });
    }

    const currentState = storage.getPaymentState(invoiceId);
    if (!currentState) {
      return res.status(404).json({ error: "No payment state found" });
    }

    if (currentState.state === "settled") {
      return res.json({ message: "Already settled", state: "settled" });
    }

    const fakeTxid = randomBytes(32).toString("hex");
    const hashedTxid = hashTxid(fakeTxid);

    storage.updatePaymentState(invoiceId, {
      state: "confirmed",
      hashedTxid,
      amountMatch: true,
      confirmations: confirmations.toString(),
      blockHeight: blockHeight.toString(),
    });

    console.log(JSON.stringify({
      rail: "xmr", event: "payment.simulated", id: invoiceId,
      tx_hash: hashedTxid, confirmations
    }));

    const callbackSuccess = await callbackPaymentsService(
      invoiceId, fakeTxid, confirmations, blockHeight
    );

    if (callbackSuccess) {
      storage.updatePaymentState(invoiceId, {
        state: "settled",
        paidAt: new Date(),
        callbackAttempts: 1,
      });

      res.json({
        message: "Payment simulated and confirmed",
        state: "settled",
        txHash: hashedTxid,
        callbackSuccess: true,
      });
    } else {
      storage.updatePaymentState(invoiceId, {
        state: "callback_pending",
        callbackAttempts: 1,
        lastCallbackAttempt: new Date(),
      });

      res.json({
        message: "Payment simulated but callback failed",
        state: "callback_pending",
        txHash: hashedTxid,
        callbackSuccess: false,
      });
    }
  } catch (error: any) {
    if (error.name === "ZodError") {
      return res.status(400).json({ error: "Invalid request data" });
    }
    console.error(`Simulate error: ${error.message}`);
    res.status(500).json({ error: "Simulation failed" });
  }
});

app.get("/status/:invoiceId", authenticatePaymentsService, async (req: Request, res: Response) => {
  try {
    const { invoiceId } = req.params;
    const paymentState = storage.getPaymentState(invoiceId);
    const subaddress = storage.getSubaddress(invoiceId);

    if (!paymentState || !subaddress) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    let status: "pending" | "confirmed" | "expired" = "pending";
    if (paymentState.state === "confirmed" || paymentState.state === "callback_pending" || paymentState.state === "settled") {
      status = "confirmed";
    }

    res.json({
      status,
      confirmations: parseInt(paymentState.confirmations || "0", 10),
      amountReceivedAtomic: paymentState.amountMatch ? subaddress.expectedAmountAtomic : "0",
      transactions: paymentState.hashedTxid ? [{
        txidHash: paymentState.hashedTxid,
        amountAtomic: subaddress.expectedAmountAtomic,
        confirmations: parseInt(paymentState.confirmations || "0", 10),
        blockHeight: paymentState.blockHeight ? parseInt(paymentState.blockHeight, 10) : undefined,
      }] : [],
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to get status" });
  }
});

app.get("/health", async (_req: Request, res: Response) => {
  if (DEV_MODE) {
    return res.json({ ok: true, service: "rail-xmr", mode: "dev", network: XMR_NETWORK, walletRpc: "simulated" });
  }

  try {
    const isHealthy = moneroRpc ? await moneroRpc.ping() : false;
    if (isHealthy) {
      res.json({ ok: true, service: "rail-xmr", walletRpc: "connected" });
    } else {
      res.status(503).json({ ok: false, service: "rail-xmr", walletRpc: "disconnected" });
    }
  } catch (error) {
    res.status(503).json({ ok: false, service: "rail-xmr", walletRpc: "error" });
  }
});

app.listen(PORT, "0.0.0.0", async () => {
  console.log("===========================================================");
  console.log("       Monero Rail Service (rail-xmr) v2.1.0");
  console.log("===========================================================");
  console.log(` Mode:          ${DEV_MODE ? "DEV (Simulation)" : "PRODUCTION"}`);
  console.log(` Network:       ${XMR_NETWORK}`);
  console.log(` Port:          ${PORT}`);
  console.log(` Account:       ${XMR_ACCOUNT_INDEX}`);
  console.log(` Confirmations: ${XMR_CONFIRMATIONS_REQUIRED}`);
  console.log(` Privacy:       HASHED TXIDS`);
  console.log("===========================================================");

  if (DEV_MODE) {
    console.log("DEV MODE active - using simulated subaddresses");
    console.log("Use POST /simulate-payment to test payment flow");
    startMonitoring();
  } else {
    try {
      const isHealthy = moneroRpc ? await moneroRpc.ping() : false;
      if (isHealthy) {
        console.log("Monero Wallet RPC connected");
        startMonitoring();
      } else {
        console.warn("Could not connect to Monero Wallet RPC - degraded mode");
      }
    } catch (error: any) {
      console.warn(`Monero Wallet RPC error: ${error.message}`);
    }
  }
});
