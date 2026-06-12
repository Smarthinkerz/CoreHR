import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { CookieJar, apiFetch, login, primeCsrf, createFixtures, TEST_PASSWORD, type Fixtures } from "./helpers/integration";

/** End-to-end auth flow: login success/failure, session retrieval, logout. */
describe("Auth Flows", () => {
  let fx: Fixtures;

  beforeAll(async () => {
    fx = await createFixtures();
  });

  afterAll(async () => {
    await fx?.cleanup();
  });

  it("logs in with valid credentials and returns the user without the password", async () => {
    const jar = new CookieJar();
    const { status, data } = await login(jar, fx.orgAUser, TEST_PASSWORD);
    expect(status).toBe(200);
    expect(data.username).toBe(fx.orgAUser);
    expect(data.password).toBeUndefined();
    expect(data.twoFactorSecret).toBeUndefined();
  });

  it("rejects login with an invalid password (401)", async () => {
    const jar = new CookieJar();
    const { status } = await login(jar, fx.orgAUser, "WrongPassword!");
    expect(status).toBe(401);
  });

  it("rejects login for a non-existent user (401)", async () => {
    const jar = new CookieJar();
    const { status } = await login(jar, `nobody_${Date.now()}`, "whatever");
    expect(status).toBe(401);
  });

  it("returns 401 from /api/user when unauthenticated", async () => {
    const jar = new CookieJar();
    await primeCsrf(jar);
    const { status } = await apiFetch(jar, "/api/user");
    expect(status).toBe(401);
  });

  it("returns the current user from /api/user after login", async () => {
    const jar = new CookieJar();
    await login(jar, fx.orgAUser, TEST_PASSWORD);
    const { status, data } = await apiFetch(jar, "/api/user");
    expect(status).toBe(200);
    expect(data.username).toBe(fx.orgAUser);
  });

  it("logs out and invalidates the session", async () => {
    const jar = new CookieJar();
    await login(jar, fx.orgAUser, TEST_PASSWORD);
    const out = await apiFetch(jar, "/api/logout", { method: "POST" });
    expect(out.status).toBe(200);
    const after = await apiFetch(jar, "/api/user");
    expect(after.status).toBe(401);
  });
});
