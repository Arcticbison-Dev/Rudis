import axios from "axios";
import { storage } from "./storage";
import { LNbitsClient } from "./lnbitsClient";
import * as monitoring from "./monitoring";

const FEE_SETTLEMENT_THRESHOLD_SATS = parseInt(process.env.FEE_SETTLEMENT_THRESHOLD_SATS || "10000", 10);
const FEE_SETTLEMENT_GRACE_DAYS = parseInt(process.env.FEE_SETTLEMENT_GRACE_DAYS || "30", 10);
const OPERATOR_LN_ADDRESS = process.env.OPERATOR_LN_ADDRESS || "";
const OPERATOR_BTC_ADDRESS = process.env.OPERATOR_BTC_ADDRESS || "";
const OPERATOR_XMR_ADDRESS = process.env.OPERATOR_XMR_ADDRESS || "";

export interface LnurlPayResponse {
  callback: string;
  minSendable: number;
  maxSendable: number;
  metadata: string;
  tag: string;
}

export interface LnurlInvoiceResponse {
  pr: string;
  routes: unknown[];
}

export async function resolveLightningAddress(address: string, amountMsats: number): Promise<string> {
  const [user, domain] = address.split("@");
  if (!user || !domain) {
    throw new Error("Invalid Lightning Address format (expected user@domain)");
  }

  const lnurlUrl = `https://${domain}/.well-known/lnurlp/${user}`;
  const metaResponse = await axios.get<LnurlPayResponse>(lnurlUrl, { timeout: 10000 });
  const meta = metaResponse.data;

  if (meta.tag !== "payRequest") {
    throw new Error("Lightning Address did not return a payRequest");
  }

  if (amountMsats < meta.minSendable || amountMsats > meta.maxSendable) {
    throw new Error(
      `Amount ${amountMsats} msats outside allowed range [${meta.minSendable}, ${meta.maxSendable}]`
    );
  }

  const separator = meta.callback.includes("?") ? "&" : "?";
  const invoiceUrl = `${meta.callback}${separator}amount=${amountMsats}`;
  const invoiceResponse = await axios.get<LnurlInvoiceResponse>(invoiceUrl, { timeout: 10000 });

  if (!invoiceResponse.data.pr) {
    throw new Error("Lightning Address callback did not return an invoice");
  }

  return invoiceResponse.data.pr;
}

export async function forwardLnFee(
  invoiceId: string,
  feeAmountSats: number,
  lnbitsClient: LNbitsClient
): Promise<boolean> {
  if (!OPERATOR_LN_ADDRESS) {
    return false;
  }

  if (!lnbitsClient.canMakeOutboundPayments) {
    return false;
  }

  if (feeAmountSats <= 0) {
    return false;
  }

  const invoice = await storage.getInvoice(invoiceId);
  if (!invoice) return false;
  if (invoice.feeForwardingStatus === "forwarded" || invoice.feeForwardingStatus === "settled") {
    return true;
  }

  try {
    const amountMsats = feeAmountSats * 1000;
    const bolt11 = await resolveLightningAddress(OPERATOR_LN_ADDRESS, amountMsats);
    await lnbitsClient.payInvoice(bolt11);

    await storage.updateInvoice(invoiceId, { feeForwardingStatus: "forwarded" });

    console.log(JSON.stringify({
      event: "fee.forward.success",
      rail: "LN",
      invoiceId,
      feeSats: feeAmountSats,
    }));

    monitoring.logPaymentStatus("LN", invoiceId, "fee_forwarded");
    return true;
  } catch (error: any) {
    console.error(JSON.stringify({
      event: "fee.forward.failed",
      rail: "LN",
      invoiceId,
      feeSats: feeAmountSats,
      error: error.message,
    }));

    if (!invoice.feeForwardingStatus || invoice.feeForwardingStatus === "pending") {
      await storage.updateInvoice(invoiceId, { feeForwardingStatus: "pending" });
    }
    return false;
  }
}

export async function markFeeAccumulated(invoiceId: string): Promise<void> {
  await storage.updateInvoice(invoiceId, { feeForwardingStatus: "accumulated" });
}

let settlementCheckInProgress = false;

export async function checkAndCreateSettlements(): Promise<void> {
  if (settlementCheckInProgress) return;
  settlementCheckInProgress = true;

  try {
    for (const currency of ["BTC", "XMR"]) {
      const operatorAddress = currency === "BTC" ? OPERATOR_BTC_ADDRESS : OPERATOR_XMR_ADDRESS;
      if (!operatorAddress) continue;

      try {
        const { total, count } = await storage.getAccumulatedFees(currency);
        const totalBigInt = BigInt(total);

        const thresholdAtomic = currency === "BTC"
          ? BigInt(FEE_SETTLEMENT_THRESHOLD_SATS)
          : BigInt(FEE_SETTLEMENT_THRESHOLD_SATS) * BigInt(1000000000000) / BigInt(100000000);

        if (totalBigInt >= thresholdAtomic && count > 0) {
          const affectedInvoices = await storage.getInvoicesWithUnforwardedFees(currency);
          if (affectedInvoices.length === 0) continue;

          const dueAt = new Date(Date.now() + FEE_SETTLEMENT_GRACE_DAYS * 24 * 60 * 60 * 1000);

          for (const inv of affectedInvoices) {
            await storage.updateInvoice(inv.id, { feeForwardingStatus: "settled" });
          }

          await storage.createFeeSettlement({
            currency,
            totalFeeAtomic: total,
            invoiceCount: affectedInvoices.length,
            status: "pending",
            operatorAddress,
            dueAt,
          });

          console.log(JSON.stringify({
            event: "fee.settlement.created",
            currency,
            totalFeeAtomic: total,
            invoiceCount: affectedInvoices.length,
            dueAt: dueAt.toISOString(),
          }));
        }
      } catch (error: any) {
        console.error(JSON.stringify({
          event: "fee.settlement.error",
          currency,
          error: error.message,
        }));
      }
    }
  } finally {
    settlementCheckInProgress = false;
  }
}

export async function checkOverdueSettlements(): Promise<boolean> {
  try {
    const overdue = await storage.getOverdueSettlements(FEE_SETTLEMENT_GRACE_DAYS);
    return overdue.length > 0;
  } catch {
    return false;
  }
}

export function getOperatorConfig() {
  return {
    lnAddress: OPERATOR_LN_ADDRESS || null,
    btcAddress: OPERATOR_BTC_ADDRESS ? "configured" : null,
    xmrAddress: OPERATOR_XMR_ADDRESS ? "configured" : null,
    settlementThresholdSats: FEE_SETTLEMENT_THRESHOLD_SATS,
    settlementGraceDays: FEE_SETTLEMENT_GRACE_DAYS,
    feeCollectionEnabled: !!(OPERATOR_LN_ADDRESS || OPERATOR_BTC_ADDRESS || OPERATOR_XMR_ADDRESS),
  };
}

export async function retryPendingLnForwards(lnbitsClient: LNbitsClient): Promise<void> {
  if (!OPERATOR_LN_ADDRESS || !lnbitsClient.canMakeOutboundPayments) return;

  try {
    const pending = await storage.getInvoicesWithUnforwardedFees("Lightning");
    const lnPending = pending.filter(inv => inv.feeForwardingStatus === "pending" || inv.feeForwardingStatus === "accumulated");

    for (const inv of lnPending.slice(0, 5)) {
      const feeSats = parseInt(inv.feeAmountAtomic || "0", 10);
      if (feeSats > 0) {
        await forwardLnFee(inv.id, feeSats, lnbitsClient);
      }
    }
  } catch (error: any) {
    console.error(JSON.stringify({
      event: "fee.retry.error",
      error: error.message,
    }));
  }
}
