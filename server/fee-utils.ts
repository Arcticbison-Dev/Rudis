import type { FeePolicy } from "@shared/schema";

export interface ComputedFee {
  feeAmountAtomic: string;
  feePercent: string;
  feePolicyId: string;
}

export function convertToAtomic(amount: string, currency: string): string {
  const num = parseFloat(amount);
  if (currency === "XMR") {
    return Math.round(num * 1e12).toString();
  }
  return Math.round(num * 1e8).toString();
}

export function computeFee(amountAtomic: string, policy: FeePolicy): ComputedFee {
  const amount = BigInt(amountAtomic);
  const percentFee = (amount * BigInt(Math.round(parseFloat(policy.feePercent) * 10000))) / BigInt(1000000);
  const fixedFee = BigInt(policy.fixedFeeAtomic || "0");
  let totalFee = percentFee + fixedFee;
  const minFee = BigInt(policy.minFeeAtomic || "0");
  const maxFee = policy.maxFeeAtomic ? BigInt(policy.maxFeeAtomic) : null;
  if (totalFee < minFee) totalFee = minFee;
  if (maxFee !== null && totalFee > maxFee) totalFee = maxFee;
  return {
    feeAmountAtomic: totalFee.toString(),
    feePercent: policy.feePercent,
    feePolicyId: policy.id,
  };
}
