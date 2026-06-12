import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import { organizations } from "@shared/schema";
import { eq } from "drizzle-orm";
import { CookieJar, apiFetch, login, createFixtures, TEST_PASSWORD, type Fixtures } from "./helpers/integration";

/**
 * Proves multi-tenant isolation: an authenticated user in Org A can neither
 * READ nor MUTATE an employee belonging to Org B via any employees route.
 * Enforced by enforceOrgScope + filterByOrg + per-record org-ownership checks.
 */
describe("Tenant Isolation (Org A cannot access Org B data)", () => {
  let fx: Fixtures;
  const orgAJar = new CookieJar();

  beforeAll(async () => {
    fx = await createFixtures();
    const a = await login(orgAJar, fx.orgAUser, TEST_PASSWORD);
    expect(a.status).toBe(200);
  });

  afterAll(async () => {
    await fx?.cleanup();
  });

  it("Org A cannot READ Org B's employee by id (404)", async () => {
    const { status } = await apiFetch(orgAJar, `/api/employees/${fx.orgBEmployeeId}`);
    expect(status).toBe(404);
  });

  it("Org A's employee list never includes Org B's employee", async () => {
    const { status, data } = await apiFetch(orgAJar, "/api/employees");
    expect(status).toBe(200);
    const rows = Array.isArray(data) ? data : data?.data ?? [];
    expect(rows.some((e: any) => e.id === fx.orgBEmployeeId)).toBe(false);
  });

  it("Org A cannot UPDATE Org B's employee (404)", async () => {
    const { status } = await apiFetch(orgAJar, `/api/employees/${fx.orgBEmployeeId}`, {
      method: "PUT",
      body: JSON.stringify({ position: "Hijacked" }),
    });
    expect(status).toBe(404);
  });

  it("Org A cannot DELETE Org B's employee (404)", async () => {
    const { status } = await apiFetch(orgAJar, `/api/employees/${fx.orgBEmployeeId}`, {
      method: "DELETE",
    });
    expect(status).toBe(404);
  });

  it("unauthenticated requests to entity routes are rejected (401)", async () => {
    const { status } = await apiFetch(null, "/api/employees");
    expect(status).toBe(401);
  });

  it("Org A cannot mutate Org B's billing plan via any billing route", async () => {
    // The insecure POST /api/billing/webhook/tap (which trusted a client-supplied
    // metadata.organizationId behind requireAuth) has been removed. Attempting it
    // as Org A must NOT succeed, and Org B's plan must remain unchanged.
    const before = await db.select().from(organizations).where(eq(organizations.id, fx.orgBId));
    const res = await apiFetch(orgAJar, "/api/billing/webhook/tap", {
      method: "POST",
      body: JSON.stringify({
        charge_id: "chg_attack",
        status: "CAPTURED",
        metadata: { organizationId: String(fx.orgBId), plan: "free" },
      }),
    });
    // The route is gone, so no plan-mutation handler runs (the request falls
    // through to the SPA fallback). The authoritative proof of isolation is that
    // Org B's plan is unchanged and no { received: true } ack was returned.
    expect(res.data?.received).not.toBe(true);

    const after = await db.select().from(organizations).where(eq(organizations.id, fx.orgBId));
    expect(after[0].plan).toBe(before[0].plan);
    expect(after[0].plan).toBe("enterprise");
  });
});
