import { db } from "../../server/db";
import { organizations, users, employees, loginAuditLog, activityLogs } from "@shared/schema";
import { hashPassword } from "../../server/auth";
import { eq, inArray } from "drizzle-orm";

export const BASE_URL = `http://localhost:${process.env.PORT || 5000}`;
export const TEST_PASSWORD = "TestPass123!";

/** Minimal cookie jar so we can carry the session + csrf cookies across requests. */
export class CookieJar {
  private cookies = new Map<string, string>();

  capture(res: Response) {
    const setCookies = (res.headers as any).getSetCookie?.() ?? [];
    for (const raw of setCookies as string[]) {
      const pair = raw.split(";")[0];
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  get(name: string) {
    return this.cookies.get(name);
  }

  header() {
    return Array.from(this.cookies.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

export interface ApiResult {
  status: number;
  data: any;
  res: Response;
}

export async function apiFetch(
  jar: CookieJar | null,
  path: string,
  options: RequestInit = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  const method = (options.method || "GET").toUpperCase();
  if (jar) {
    headers["Cookie"] = jar.header();
    const csrf = jar.get("csrf-token");
    if (csrf && method !== "GET") headers["x-csrf-token"] = csrf;
  }
  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  if (jar) jar.capture(res);
  const data = await res.json().catch(() => null);
  return { status: res.status, data, res };
}

/** Seeds a csrf-token cookie into the jar. */
export async function primeCsrf(jar: CookieJar) {
  await apiFetch(jar, "/api/csrf-token");
}

export async function login(jar: CookieJar, username: string, password: string): Promise<ApiResult> {
  await primeCsrf(jar);
  return apiFetch(jar, "/api/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export interface Fixtures {
  orgFreeId: number;
  orgAId: number;
  orgBId: number;
  freeUser: string;
  orgAUser: string;
  orgBUser: string;
  orgBEmployeeId: number;
  orglessUser: string;
  cleanup: () => Promise<void>;
}

/**
 * Creates isolated orgs/users/employee directly in the DB shared with the running
 * server, so integration tests can exercise plan gating and tenant isolation
 * against real middleware. Unique suffix avoids collisions across runs.
 */
export async function createFixtures(): Promise<Fixtures> {
  const suffix = `it_${Date.now()}_${Math.floor(Math.random() * 1e4)}`;
  const hashed = await hashPassword(TEST_PASSWORD);

  const [orgFree] = await db.insert(organizations).values({
    name: `Free Org ${suffix}`, slug: `free-${suffix}`, plan: "free",
  } as any).returning();
  const [orgA] = await db.insert(organizations).values({
    name: `Org A ${suffix}`, slug: `orga-${suffix}`, plan: "enterprise",
  } as any).returning();
  const [orgB] = await db.insert(organizations).values({
    name: `Org B ${suffix}`, slug: `orgb-${suffix}`, plan: "enterprise",
  } as any).returning();

  const freeUser = `free_${suffix}`;
  const orgAUser = `orga_${suffix}`;
  const orgBUser = `orgb_${suffix}`;
  const orglessUser = `orgless_${suffix}`;

  const createdUsers = await db.insert(users).values([
    { username: freeUser, password: hashed, email: `${freeUser}@test.local`, fullName: "Free Admin", role: "admin", organizationId: orgFree.id },
    { username: orgAUser, password: hashed, email: `${orgAUser}@test.local`, fullName: "Org A Admin", role: "admin", organizationId: orgA.id },
    { username: orgBUser, password: hashed, email: `${orgBUser}@test.local`, fullName: "Org B Admin", role: "admin", organizationId: orgB.id },
    { username: orglessUser, password: hashed, email: `${orglessUser}@test.local`, fullName: "Orgless User", role: "employee", organizationId: null },
  ] as any).returning();

  const [empB] = await db.insert(employees).values({
    fullName: `Org B Employee ${suffix}`,
    email: `empb_${suffix}@test.local`,
    position: "Engineer",
    department: "Engineering",
    hireDate: new Date("2025-01-01"),
    organizationId: orgB.id,
  } as any).returning();

  const userIds = createdUsers.map((u) => u.id);

  return {
    orgFreeId: orgFree.id,
    orgAId: orgA.id,
    orgBId: orgB.id,
    freeUser,
    orgAUser,
    orgBUser,
    orgBEmployeeId: empB.id,
    orglessUser,
    cleanup: async () => {
      await db.delete(employees).where(eq(employees.id, empB.id));
      if (userIds.length) {
        await db.delete(loginAuditLog).where(inArray(loginAuditLog.userId, userIds));
        await db.delete(activityLogs).where(inArray(activityLogs.userId, userIds));
        await db.delete(users).where(inArray(users.id, userIds));
      }
      await db.delete(organizations).where(inArray(organizations.id, [orgFree.id, orgA.id, orgB.id]));
    },
  };
}
