import { describe, it, expect, afterAll } from "vitest";
import { api } from "./helpers";

const createdTemplateIds: string[] = [];

afterAll(async () => {
  for (const id of createdTemplateIds) {
    await api(`/api/templates/${id}`, { method: "DELETE" });
  }
});

describe("Template Endpoints", () => {
  it("creates a template", async () => {
    const { status, body } = await api("/api/templates", {
      method: "POST",
      body: {
        planName: "Basic Plan",
        asset: "BTC",
        amountUsd: "9.99",
        interval: "monthly",
        description: "Basic monthly plan",
      },
    });

    expect(status).toBe(201);
    expect(body.id).toBeDefined();
    expect(body.planName).toBe("Basic Plan");
    expect(body.asset).toBe("BTC");
    createdTemplateIds.push(body.id);
  });

  it("lists all templates", async () => {
    const { status, body } = await api("/api/templates");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it("gets a specific template", async () => {
    const templateId = createdTemplateIds[0];
    const { status, body } = await api(`/api/templates/${templateId}`);
    expect(status).toBe(200);
    expect(body.id).toBe(templateId);
  });

  it("updates a template", async () => {
    const templateId = createdTemplateIds[0];
    const { status, body } = await api(`/api/templates/${templateId}`, {
      method: "PATCH",
      body: { planName: "Updated Plan", amountUsd: "19.99" },
    });

    expect(status).toBe(200);
    expect(body.planName).toBe("Updated Plan");
    expect(body.amountUsd).toBe("19.99");
  });

  it("deletes a template", async () => {
    const createRes = await api("/api/templates", {
      method: "POST",
      body: {
        planName: "Delete Me",
        asset: "XMR",
        interval: "one-time",
      },
    });

    const { status } = await api(`/api/templates/${createRes.body.id}`, {
      method: "DELETE",
    });
    expect(status).toBe(200);

    const getRes = await api(`/api/templates/${createRes.body.id}`);
    expect(getRes.status).toBe(404);
  });

  it("returns 404 for non-existent template", async () => {
    const { status } = await api("/api/templates/00000000-0000-0000-0000-000000000000");
    expect(status).toBe(404);
  });

  it("rejects template with missing plan name", async () => {
    const { status } = await api("/api/templates", {
      method: "POST",
      body: { asset: "BTC" },
    });
    expect(status).toBe(400);
  });
});

describe("Health Endpoint", () => {
  it("returns health status", async () => {
    const { status, body } = await api("/health");
    expect(status).toBe(200);
    expect(body.status).toBeDefined();
    expect(body.timestamp).toBeDefined();
  });
});

describe("Metrics Endpoint", () => {
  it("returns metrics data", async () => {
    const { status, body } = await api("/metrics");
    expect(status).toBe(200);
    expect(body.health).toBeDefined();
  });
});
