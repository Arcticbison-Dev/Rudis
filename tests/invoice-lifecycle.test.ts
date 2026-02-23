import { describe, it, expect, beforeAll } from "vitest";
import { api, randomDescription } from "./helpers";

const INVOICE_API_KEY = process.env.INVOICE_API_KEY || "";

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe("Invoice Lifecycle", () => {
  beforeAll(async () => {
    await wait(10000);
  });

  describe("POST /api/invoices - valid", () => {
    it("creates a BTC invoice with valid data", async () => {
      const { status, body } = await api("/api/invoices", {
        method: "POST",
        body: {
          amount: "0.001",
          currency: "BTC",
          description: randomDescription(),
        },
      });

      expect(status).toBe(201);
      expect(body.id).toBeDefined();
      expect(body.amount).toBe("0.00100000");
      expect(body.currency).toBe("BTC");
      expect(body.status).toBe("pending");
      expect(body.createdAt).toBeDefined();
    });

    it("creates an XMR invoice with valid data", async () => {
      const { status, body } = await api("/api/invoices", {
        method: "POST",
        body: {
          amount: "0.1",
          currency: "XMR",
          description: randomDescription(),
        },
      });

      expect(status).toBe(201);
      expect(body.currency).toBe("XMR");
      expect(body.asset).toBe("XMR");
    });
  });

  describe("POST /api/invoices - validation", () => {
    it("rejects invalid amount format", async () => {
      const { status } = await api("/api/invoices", {
        method: "POST",
        body: {
          amount: "not-a-number",
          currency: "BTC",
          description: randomDescription(),
        },
      });

      expect(status).toBe(400);
    });

    it("rejects missing description", async () => {
      const { status } = await api("/api/invoices", {
        method: "POST",
        body: {
          amount: "0.001",
          currency: "BTC",
        },
      });

      expect(status).toBe(400);
    });

    it("rejects unsupported currency", async () => {
      const { status } = await api("/api/invoices", {
        method: "POST",
        body: {
          amount: "0.001",
          currency: "DOGE",
          description: randomDescription(),
        },
      });

      expect(status).toBe(400);
    });

    it("rejects negative amount", async () => {
      const { status } = await api("/api/invoices", {
        method: "POST",
        body: {
          amount: "-0.001",
          currency: "BTC",
          description: randomDescription(),
        },
      });

      expect(status).toBe(400);
    });
  });

  describe("GET /api/invoices", () => {
    it("returns a list of invoices", async () => {
      const { status, body } = await api("/api/invoices");
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });
  });

  describe("GET /api/invoices/:id", () => {
    it("returns a specific invoice by fetching from list", async () => {
      const listRes = await api("/api/invoices");
      expect(listRes.status).toBe(200);
      expect(listRes.body.length).toBeGreaterThan(0);

      const invoiceId = listRes.body[0].id;
      const { status, body } = await api(`/api/invoices/${invoiceId}`);
      expect(status).toBe(200);
      expect(body.id).toBe(invoiceId);
    });

    it("returns 404 for non-existent invoice", async () => {
      const { status } = await api("/api/invoices/00000000-0000-0000-0000-000000000000");
      expect(status).toBe(404);
    });
  });

  describe("INVOICE_API_KEY auth enforcement", () => {
    it("returns 401 when INVOICE_API_KEY is set and no auth header provided", async () => {
      if (!INVOICE_API_KEY) {
        console.log("Skipping: INVOICE_API_KEY not set");
        return;
      }
      const { status, body } = await api("/api/invoices", {
        method: "POST",
        body: {
          amount: "0.001",
          currency: "BTC",
          description: randomDescription(),
        },
      });
      expect(status).toBe(401);
      expect(body.error).toBe("Unauthorized");
    });

    it("returns 401 when INVOICE_API_KEY is set and wrong key provided", async () => {
      if (!INVOICE_API_KEY) {
        console.log("Skipping: INVOICE_API_KEY not set");
        return;
      }
      const { status, body } = await api("/api/invoices", {
        method: "POST",
        headers: { Authorization: "Bearer wrong-key-value" },
        body: {
          amount: "0.001",
          currency: "BTC",
          description: randomDescription(),
        },
      });
      expect(status).toBe(401);
      expect(body.error).toBe("Unauthorized");
    });

    it("succeeds when INVOICE_API_KEY is set and correct key provided", async () => {
      if (!INVOICE_API_KEY) {
        console.log("Skipping: INVOICE_API_KEY not set");
        return;
      }
      const { status, body } = await api("/api/invoices", {
        method: "POST",
        headers: { Authorization: `Bearer ${INVOICE_API_KEY}` },
        body: {
          amount: "0.001",
          currency: "BTC",
          description: randomDescription(),
        },
      });
      expect(status).toBe(201);
      expect(body.id).toBeDefined();
    });

    it("allows GET /api/invoices without auth even when INVOICE_API_KEY is set", async () => {
      const { status } = await api("/api/invoices");
      expect(status).toBe(200);
    });
  });

  describe("Invoice with fee policy", () => {
    it("attaches fee data when active policy exists", async () => {
      await wait(10000);

      const policyRes = await api("/admin/fee-policies", {
        method: "POST",
        adminAuth: true,
        body: {
          name: "Test Fee Policy for Lifecycle",
          feePercent: "2.0000",
          fixedFeeAtomic: "50",
          minFeeAtomic: "100",
          currency: "BTC",
          active: true,
        },
      });
      expect(policyRes.status).toBe(201);

      const invoiceRes = await api("/api/invoices", {
        method: "POST",
        body: {
          amount: "0.01",
          currency: "BTC",
          description: randomDescription(),
        },
      });

      expect(invoiceRes.status).toBe(201);
      expect(invoiceRes.body.feePolicyId).toBeDefined();
      expect(invoiceRes.body.feeAmountAtomic).toBeDefined();
      expect(invoiceRes.body.feePercent).toBeDefined();
      expect(parseFloat(invoiceRes.body.feePercent)).toBeGreaterThan(0);

      await api(`/admin/fee-policies/${policyRes.body.id}`, {
        method: "DELETE",
        adminAuth: true,
      });
    });
  });
});
