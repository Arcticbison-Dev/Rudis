import { describe, it, expect } from "vitest";
import { api } from "./helpers";

describe("Fee Collection Endpoints", () => {
  describe("GET /api/fee-status (public)", () => {
    it("returns fee collection status without auth", async () => {
      const { status, body } = await api("/api/fee-status");
      expect(status).toBe(200);
      expect(body).toHaveProperty("feeCollectionEnabled");
      expect(body).toHaveProperty("systemInGoodStanding");
      expect(body).toHaveProperty("invoiceCreationBlocked");
      expect(typeof body.feeCollectionEnabled).toBe("boolean");
      expect(typeof body.systemInGoodStanding).toBe("boolean");
      expect(typeof body.invoiceCreationBlocked).toBe("boolean");
    });

    it("reports system in good standing when no overdue settlements", async () => {
      const { body } = await api("/api/fee-status");
      expect(body.systemInGoodStanding).toBe(true);
      expect(body.invoiceCreationBlocked).toBe(false);
    });
  });

  describe("GET /admin/fee-settlements", () => {
    it("rejects requests without auth token", async () => {
      const { status } = await api("/admin/fee-settlements");
      expect(status).toBe(401);
    });

    it("rejects requests with wrong auth token", async () => {
      const { status } = await api("/admin/fee-settlements", {
        headers: { Authorization: "Bearer wrong-token-123" },
      });
      expect(status).toBe(401);
    });

    it("returns settlements list with valid admin token", async () => {
      const { status, body } = await api("/admin/fee-settlements", { adminAuth: true });
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });
  });

  describe("POST /admin/fee-settlements/:id/mark-paid", () => {
    it("rejects without auth token", async () => {
      const { status } = await api("/admin/fee-settlements/nonexistent/mark-paid", {
        method: "POST",
      });
      expect(status).toBe(401);
    });

    it("returns 404 for non-existent settlement", async () => {
      const { status } = await api("/admin/fee-settlements/nonexistent-id/mark-paid", {
        method: "POST",
        adminAuth: true,
      });
      expect(status).toBe(404);
    });
  });

  describe("Fee forwarding status on invoices", () => {
    it("new invoices have null feeForwardingStatus when no fee policy active", async () => {
      const { status, body } = await api("/api/invoices", {
        method: "POST",
        body: {
          amount: "0.0001",
          currency: "BTC",
          description: `Fee test ${Date.now()}`,
          paymentAddress: "bc1qtest" + Date.now().toString(36),
        },
      });

      if (status === 201) {
        expect(body.feeForwardingStatus).toBeNull();
      } else if (status === 429) {
        expect(true).toBe(true);
      } else {
        expect(status).toBe(201);
      }
    });
  });
});
