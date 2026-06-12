import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { CookieJar, apiFetch, login, createFixtures, TEST_PASSWORD, type Fixtures } from "./helpers/integration";

/**
 * Proves plan-based feature gating is actually ENFORCED at the route layer:
 * a lower-tier (free) org is blocked from paid routes, while an enterprise org
 * is allowed through. Covers pro-tier, enterprise-tier, and the two bare-/api
 * routers (wellness, ai) that gate at the router level.
 */
describe("Feature Gating Enforcement", () => {
  let fx: Fixtures;
  const freeJar = new CookieJar();
  const entJar = new CookieJar();
  const orglessJar = new CookieJar();

  // Representative gated endpoints across tiers. Each maps to a requireFeature() guard.
  const PRO_ROUTES = [
    "/api/payroll",
    "/api/candidates",
    "/api/analytics",
    "/api/documents",
    "/api/performance-reviews",
    "/api/wellness-programs", // bare /api wellness router → requireFeature('wellness')
  ];
  const ENTERPRISE_ROUTES = [
    "/api/digital-twins",
    "/api/emotion-ai",
    "/api/integrations",
    "/api/reports",
    "/api/resignation-risk",
    "/api/insights", // bare /api ai router → requireFeature('ai_insights')
  ];
  const ALL_GATED = [...PRO_ROUTES, ...ENTERPRISE_ROUTES];
  // For the "allowed" assertion we exclude routes whose handler performs a live
  // external AI call (slow); the gate runs before the handler, so the 403 path
  // above already proves those routes are gated.
  const ALLOWED_FAST = ALL_GATED.filter((r) => r !== "/api/insights");

  beforeAll(async () => {
    fx = await createFixtures();
    const f = await login(freeJar, fx.freeUser, TEST_PASSWORD);
    const e = await login(entJar, fx.orgAUser, TEST_PASSWORD);
    const o = await login(orglessJar, fx.orglessUser, TEST_PASSWORD);
    expect(f.status).toBe(200);
    expect(e.status).toBe(200);
    expect(o.status).toBe(200);
  });

  afterAll(async () => {
    await fx?.cleanup();
  });

  it("blocks a FREE-plan org from a gated paid route (403 + plan metadata)", async () => {
    const { status, data } = await apiFetch(freeJar, "/api/payroll");
    expect(status).toBe(403);
    expect(data.error).toBe("Feature not available");
    expect(data.currentPlan).toBe("free");
    expect(data.requiredPlan).toBeDefined();
  });

  it.each(ALL_GATED)("blocks FREE-plan org from %s with 403", async (route) => {
    const { status } = await apiFetch(freeJar, route);
    expect(status).toBe(403);
  });

  it.each(ALLOWED_FAST)("allows ENTERPRISE-plan org through %s (not gated, status !== 403)", async (route) => {
    const { status } = await apiFetch(entJar, route);
    expect(status).not.toBe(403);
  });

  it("gates the AI router for FREE and lets ENTERPRISE past the gate (no AI provider call)", async () => {
    // POST with an empty body: the requireFeature('ai_insights') gate runs first.
    // FREE -> 403 (blocked at the gate). ENTERPRISE passes the gate and reaches the
    // handler's own validation -> 400 (missing fields). This proves the gate allows
    // enterprise through WITHOUT triggering the slow live OpenAI call in /api/insights.
    const free = await apiFetch(freeJar, "/api/workforce-plans/review", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(free.status).toBe(403);

    const ent = await apiFetch(entJar, "/api/workforce-plans/review", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(ent.status).not.toBe(403);
    expect(ent.status).toBe(400);
  });

  it("fails CLOSED: a user with no organization is blocked from paid routes (403)", async () => {
    // An authenticated user with organizationId = null has no active plan and must
    // NOT be waved through the gate. This guards against fail-open authorization.
    for (const route of ["/api/payroll", "/api/insights"]) {
      const { status } = await apiFetch(orglessJar, route);
      expect(status).toBe(403);
    }
  });

  it("does NOT gate free/essential routes for a FREE-plan org", async () => {
    for (const route of ["/api/employees", "/api/departments", "/api/tasks", "/api/billing/plans"]) {
      const { status } = await apiFetch(freeJar, route);
      expect(status).not.toBe(403);
    }
  });

  it("demo/seeded enterprise account retains access to paid features", async () => {
    // The seeded demo org (SmartHinkerz Corp) is on the enterprise plan and the
    // seed backfills organization_id onto demo users, so demo accounts must still
    // pass the gate after the fail-closed change. Uses the real seeded credentials.
    const demoJar = new CookieJar();
    const r = await login(demoJar, "sarah.johnson", "Welcome1!");
    expect(r.status).toBe(200);
    for (const route of ["/api/payroll", "/api/digital-twins", "/api/analytics"]) {
      const { status } = await apiFetch(demoJar, route);
      expect(status).not.toBe(403);
    }
  });
});
