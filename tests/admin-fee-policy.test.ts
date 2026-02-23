import { describe, it, expect, afterAll } from "vitest";
import { api, randomDescription } from "./helpers";

const createdPolicyIds: string[] = [];

afterAll(async () => {
  for (const id of createdPolicyIds) {
    await api(`/admin/fee-policies/${id}`, { method: "DELETE", adminAuth: true });
  }
});

describe("Admin Fee Policy Endpoints", () => {
  describe("Authentication", () => {
    it("rejects requests without auth token", async () => {
      const { status } = await api("/admin/fee-policies");
      expect(status).toBe(401);
    });

    it("rejects requests with wrong auth token", async () => {
      const { status } = await api("/admin/fee-policies", {
        headers: { Authorization: "Bearer wrong-token-123" },
      });
      expect(status).toBe(401);
    });

    it("accepts requests with valid admin token", async () => {
      const { status } = await api("/admin/fee-policies", { adminAuth: true });
      expect(status).toBe(200);
    });
  });

  describe("CRUD Operations", () => {
    it("creates a fee policy", async () => {
      const { status, body } = await api("/admin/fee-policies", {
        method: "POST",
        adminAuth: true,
        body: {
          name: "Test CRUD Policy",
          feePercent: "1.5000",
          fixedFeeAtomic: "200",
          minFeeAtomic: "100",
          maxFeeAtomic: "10000",
          currency: "BTC",
          active: true,
        },
      });

      expect(status).toBe(201);
      expect(body.id).toBeDefined();
      expect(body.name).toBe("Test CRUD Policy");
      expect(body.feePercent).toBe("1.5000");
      expect(body.fixedFeeAtomic).toBe("200");
      expect(body.minFeeAtomic).toBe("100");
      expect(body.maxFeeAtomic).toBe("10000");
      expect(body.active).toBe(true);
      createdPolicyIds.push(body.id);
    });

    it("lists all fee policies", async () => {
      const { status, body } = await api("/admin/fee-policies", { adminAuth: true });
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);
    });

    it("gets a specific fee policy by id", async () => {
      const policyId = createdPolicyIds[0];
      const { status, body } = await api(`/admin/fee-policies/${policyId}`, { adminAuth: true });
      expect(status).toBe(200);
      expect(body.id).toBe(policyId);
      expect(body.name).toBe("Test CRUD Policy");
    });

    it("updates a fee policy", async () => {
      const policyId = createdPolicyIds[0];
      const { status, body } = await api(`/admin/fee-policies/${policyId}`, {
        method: "PATCH",
        adminAuth: true,
        body: {
          name: "Updated CRUD Policy",
          feePercent: "2.0000",
          maxFeeAtomic: "20000",
        },
      });

      expect(status).toBe(200);
      expect(body.name).toBe("Updated CRUD Policy");
      expect(body.feePercent).toBe("2.0000");
      expect(body.maxFeeAtomic).toBe("20000");
    });

    it("deletes a fee policy", async () => {
      const createRes = await api("/admin/fee-policies", {
        method: "POST",
        adminAuth: true,
        body: {
          name: "Delete Me Policy",
          feePercent: "0.5000",
          currency: "BTC",
        },
      });
      const deleteId = createRes.body.id;

      const { status } = await api(`/admin/fee-policies/${deleteId}`, {
        method: "DELETE",
        adminAuth: true,
      });
      expect(status).toBe(200);

      const getRes = await api(`/admin/fee-policies/${deleteId}`, { adminAuth: true });
      expect(getRes.status).toBe(404);
    });

    it("returns 404 for non-existent policy", async () => {
      const { status } = await api("/admin/fee-policies/00000000-0000-0000-0000-000000000000", { adminAuth: true });
      expect(status).toBe(404);
    });
  });

  describe("Fee Report", () => {
    it("returns fee report with admin auth", async () => {
      const { status, body } = await api("/admin/fee-report", { adminAuth: true });
      expect(status).toBe(200);
      expect(body.from).toBeDefined();
      expect(body.to).toBeDefined();
    });

    it("rejects fee report without auth", async () => {
      const { status } = await api("/admin/fee-report");
      expect(status).toBe(401);
    });
  });

  describe("Admin Invoice List", () => {
    it("returns invoices with admin auth", async () => {
      const { status, body } = await api("/admin/invoices", { adminAuth: true });
      expect(status).toBe(200);
      expect(body.invoices).toBeDefined();
      expect(body.total).toBeDefined();
    });

    it("rejects invoice list without auth", async () => {
      const { status } = await api("/admin/invoices");
      expect(status).toBe(401);
    });
  });
});
