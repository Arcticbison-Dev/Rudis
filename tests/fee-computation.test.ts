import { describe, it, expect } from "vitest";
import { computeFee, convertToAtomic } from "../server/fee-utils";
import type { FeePolicy } from "@shared/schema";

function makePolicy(overrides: Partial<FeePolicy> = {}): FeePolicy {
  return {
    id: "test-policy-id",
    name: "Test Policy",
    merchantId: null,
    feePercent: "1.0000",
    fixedFeeAtomic: "0",
    minFeeAtomic: "0",
    maxFeeAtomic: null,
    currency: "BTC",
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("convertToAtomic", () => {
  it("converts BTC to satoshis", () => {
    expect(convertToAtomic("1.0", "BTC")).toBe("100000000");
    expect(convertToAtomic("0.001", "BTC")).toBe("100000");
    expect(convertToAtomic("0.00000001", "BTC")).toBe("1");
    expect(convertToAtomic("21000000", "BTC")).toBe("2100000000000000");
  });

  it("converts Lightning to satoshis (same as BTC)", () => {
    expect(convertToAtomic("0.001", "Lightning")).toBe("100000");
  });

  it("converts XMR to piconero", () => {
    expect(convertToAtomic("1.0", "XMR")).toBe("1000000000000");
    expect(convertToAtomic("0.001", "XMR")).toBe("1000000000");
    expect(convertToAtomic("0.000000000001", "XMR")).toBe("1");
  });

  it("handles zero", () => {
    expect(convertToAtomic("0", "BTC")).toBe("0");
    expect(convertToAtomic("0", "XMR")).toBe("0");
  });
});

describe("computeFee", () => {
  it("computes percentage-only fee", () => {
    const policy = makePolicy({ feePercent: "1.0000", fixedFeeAtomic: "0" });
    const result = computeFee("100000", policy);
    expect(result.feeAmountAtomic).toBe("1000");
    expect(result.feePercent).toBe("1.0000");
    expect(result.feePolicyId).toBe("test-policy-id");
  });

  it("computes fixed-only fee", () => {
    const policy = makePolicy({ feePercent: "0", fixedFeeAtomic: "500" });
    const result = computeFee("100000", policy);
    expect(result.feeAmountAtomic).toBe("500");
  });

  it("computes combined percentage + fixed fee", () => {
    const policy = makePolicy({ feePercent: "1.0000", fixedFeeAtomic: "100" });
    const result = computeFee("100000", policy);
    expect(result.feeAmountAtomic).toBe("1100");
  });

  it("enforces minimum fee", () => {
    const policy = makePolicy({ feePercent: "0.1000", fixedFeeAtomic: "0", minFeeAtomic: "500" });
    const result = computeFee("10000", policy);
    expect(result.feeAmountAtomic).toBe("500");
  });

  it("enforces maximum fee cap", () => {
    const policy = makePolicy({ feePercent: "1.0000", fixedFeeAtomic: "100", maxFeeAtomic: "5000" });
    const result = computeFee("100000000", policy);
    expect(result.feeAmountAtomic).toBe("5000");
  });

  it("does not cap when below max", () => {
    const policy = makePolicy({ feePercent: "1.0000", maxFeeAtomic: "50000" });
    const result = computeFee("100000", policy);
    expect(result.feeAmountAtomic).toBe("1000");
  });

  it("handles zero amount", () => {
    const policy = makePolicy({ feePercent: "1.0000", fixedFeeAtomic: "100", minFeeAtomic: "0" });
    const result = computeFee("0", policy);
    expect(result.feeAmountAtomic).toBe("100");
  });

  it("handles fractional percentages", () => {
    const policy = makePolicy({ feePercent: "0.5000" });
    const result = computeFee("1000000", policy);
    expect(result.feeAmountAtomic).toBe("5000");
  });

  it("handles very small percentages", () => {
    const policy = makePolicy({ feePercent: "0.0100" });
    const result = computeFee("1000000", policy);
    expect(result.feeAmountAtomic).toBe("100");
  });

  it("handles large amounts (1 BTC in sats)", () => {
    const policy = makePolicy({ feePercent: "2.5000", fixedFeeAtomic: "1000" });
    const result = computeFee("100000000", policy);
    expect(result.feeAmountAtomic).toBe("2501000");
  });

  it("min fee takes precedence when computed fee is lower", () => {
    const policy = makePolicy({ feePercent: "0.0100", fixedFeeAtomic: "0", minFeeAtomic: "200" });
    const result = computeFee("1000", policy);
    expect(result.feeAmountAtomic).toBe("200");
  });

  it("computed fee used when above min", () => {
    const policy = makePolicy({ feePercent: "1.0000", fixedFeeAtomic: "100", minFeeAtomic: "200" });
    const result = computeFee("100000", policy);
    expect(result.feeAmountAtomic).toBe("1100");
  });

  it("min and max interact correctly", () => {
    const policy = makePolicy({ feePercent: "50.0000", minFeeAtomic: "100", maxFeeAtomic: "500" });
    const result = computeFee("100000", policy);
    expect(result.feeAmountAtomic).toBe("500");
  });

  it("handles XMR-scale piconero amounts", () => {
    const policy = makePolicy({ feePercent: "1.0000", currency: "XMR" });
    const result = computeFee("1000000000000", policy);
    expect(result.feeAmountAtomic).toBe("10000000000");
  });
});
