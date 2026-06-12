import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { CookieJar, apiFetch, login, createFixtures, TEST_PASSWORD, type Fixtures } from "./helpers/integration";

/** Billing flow: plan catalog, current-plan resolution, and upgrade validation. */
describe("Billing Flows", () => {
  let fx: Fixtures;
  const entJar = new CookieJar();
  const freeJar = new CookieJar();

  beforeAll(async () => {
    fx = await createFixtures();
    await login(entJar, fx.orgAUser, TEST_PASSWORD);
    await login(freeJar, fx.freeUser, TEST_PASSWORD);
  });

  afterAll(async () => {
    await fx?.cleanup();
  });

  it("exposes the pricing plan catalog (free/pro/enterprise)", async () => {
    const { status, data } = await apiFetch(entJar, "/api/billing/plans");
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    const ids = data.map((p: any) => p.id);
    expect(ids).toEqual(expect.arrayContaining(["free", "pro", "enterprise"]));
    // Internal payment slugs must not leak to the client.
    expect(data.every((p: any) => p.tapPlanSlug === undefined)).toBe(true);
  });

  it("resolves the enterprise org's current plan + feature set", async () => {
    const { status, data } = await apiFetch(entJar, "/api/billing/current");
    expect(status).toBe(200);
    expect(data.plan).toBe("enterprise");
    expect(data.features).toEqual(expect.arrayContaining(["payroll", "digital_twins"]));
  });

  it("resolves the free org's current plan with the limited feature set", async () => {
    const { status, data } = await apiFetch(freeJar, "/api/billing/current");
    expect(status).toBe(200);
    expect(data.plan).toBe("free");
    expect(data.features).not.toContain("payroll");
  });

  it("rejects upgrading to a paid plan without payment (400)", async () => {
    const { status } = await apiFetch(entJar, "/api/billing/upgrade", {
      method: "POST",
      body: JSON.stringify({ plan: "pro" }),
    });
    expect(status).toBe(400);
  });

  it("rejects an invalid plan value via schema validation (400)", async () => {
    const { status } = await apiFetch(entJar, "/api/billing/upgrade", {
      method: "POST",
      body: JSON.stringify({ plan: "platinum" }),
    });
    expect(status).toBe(400);
  });

  it("requires authentication for billing endpoints (401)", async () => {
    const { status } = await apiFetch(null, "/api/billing/current");
    expect(status).toBe(401);
  });

  // --- Checkout flow ---

  it("rejects checkout for a paid plan without a phone number (400 requiresPhone)", async () => {
    const { status, data } = await apiFetch(entJar, "/api/billing/checkout", {
      method: "POST",
      body: JSON.stringify({ plan: "pro" }),
    });
    expect(status).toBe(400);
    expect(data.requiresPhone).toBe(true);
  });

  it("returns a Tap checkout payload for a paid plan when a phone is supplied", async () => {
    const { status, data } = await apiFetch(entJar, "/api/billing/checkout", {
      method: "POST",
      body: JSON.stringify({ plan: "pro", phone: "+96899887766" }),
    });
    expect(status).toBe(200);
    expect(typeof data.checkoutUrl).toBe("string");
    expect(data.method).toBe("POST");
    // The internal Tap plan slug is resolved server-side into the POST payload.
    expect(data.fields.plan).toBe("brainpower-pro");
    expect(data.fields.phone).toBe("+96899887766");
  });

  it("rejects checkout for a non-purchasable plan via schema validation (400)", async () => {
    const { status } = await apiFetch(entJar, "/api/billing/checkout", {
      method: "POST",
      body: JSON.stringify({ plan: "free", phone: "+96899887766" }),
    });
    expect(status).toBe(400);
  });

  it("requires authentication for checkout (401)", async () => {
    const { status } = await apiFetch(null, "/api/billing/checkout", {
      method: "POST",
      body: JSON.stringify({ plan: "pro", phone: "+96899887766" }),
    });
    expect(status).toBe(401);
  });

  // --- Webhook flow (public, HMAC-verified) ---

  it("rejects a payment webhook with no signature (401)", async () => {
    const { status, data } = await apiFetch(null, "/api/tap-payments/webhook", {
      method: "POST",
      body: JSON.stringify({ id: "chg_test", status: "CAPTURED" }),
    });
    expect(status).toBe(401);
    expect(data.error).toBe("Invalid signature");
  });

  it("rejects a payment webhook with a forged signature (401)", async () => {
    const { status } = await apiFetch(null, "/api/tap-payments/webhook", {
      method: "POST",
      headers: { hashstring: "deadbeef" },
      body: JSON.stringify({ id: "chg_test", status: "CAPTURED" }),
    });
    expect(status).toBe(401);
  });
});
