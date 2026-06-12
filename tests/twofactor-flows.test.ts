import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as otplib from "otplib";
import { CookieJar, apiFetch, login, createFixtures, TEST_PASSWORD, type Fixtures } from "./helpers/integration";

/**
 * End-to-end 2FA / TOTP flow against the live /api/2fa routes (otplib-backed):
 * status -> setup -> verify (with a REAL generated TOTP token) -> disable.
 * Proves the secret is issued, an enable requires a valid code, and the gate
 * rejects bad codes. Uses the same otplib authenticator the server uses so the
 * generated token actually validates.
 */
describe("Two-Factor Auth (TOTP) Flow", () => {
  let fx: Fixtures;
  const jar = new CookieJar();

  beforeAll(async () => {
    fx = await createFixtures();
    const r = await login(jar, fx.orgAUser, TEST_PASSWORD);
    expect(r.status).toBe(200);
  });

  afterAll(async () => {
    await fx?.cleanup();
  });

  it("requires authentication for 2FA endpoints (401)", async () => {
    const { status } = await apiFetch(null, "/api/2fa/status");
    expect(status).toBe(401);
  });

  it("reports 2FA disabled before setup", async () => {
    const { status, data } = await apiFetch(jar, "/api/2fa/status");
    expect(status).toBe(200);
    expect(data.enabled).toBe(false);
  });

  it("issues a secret + QR code on setup", async () => {
    const { status, data } = await apiFetch(jar, "/api/2fa/setup", { method: "POST" });
    expect(status).toBe(200);
    expect(typeof data.secret).toBe("string");
    expect(data.secret.length).toBeGreaterThan(0);
    expect(data.qrCodeUrl).toMatch(/^data:image\/png;base64,/);
    expect(data.otpauth).toMatch(/^otpauth:\/\/totp\//);
  });

  it("rejects verification with an invalid token (400)", async () => {
    // setup first to ensure a secret exists for this user
    const setup = await apiFetch(jar, "/api/2fa/setup", { method: "POST" });
    const valid = otplib.generateSync({ secret: setup.data.secret });
    // Derive a token guaranteed to differ from the current valid one.
    const invalid = String((Number(valid) + 1) % 1_000_000).padStart(6, "0");
    const { status } = await apiFetch(jar, "/api/2fa/verify", {
      method: "POST",
      body: JSON.stringify({ token: invalid }),
    });
    expect(status).toBe(400);
  });

  it("enables 2FA with a valid TOTP token, then reports enabled", async () => {
    const setup = await apiFetch(jar, "/api/2fa/setup", { method: "POST" });
    const token = otplib.generateSync({ secret: setup.data.secret });
    const verify = await apiFetch(jar, "/api/2fa/verify", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
    expect(verify.status).toBe(200);

    const status = await apiFetch(jar, "/api/2fa/status");
    expect(status.data.enabled).toBe(true);
  });

  it("requires a token to disable (400) and disables with a valid token", async () => {
    const missing = await apiFetch(jar, "/api/2fa/disable", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(400);

    // Re-derive the current secret by re-running setup, enabling, then disabling.
    const setup = await apiFetch(jar, "/api/2fa/setup", { method: "POST" });
    await apiFetch(jar, "/api/2fa/verify", {
      method: "POST",
      body: JSON.stringify({ token: otplib.generateSync({ secret: setup.data.secret }) }),
    });
    const disable = await apiFetch(jar, "/api/2fa/disable", {
      method: "POST",
      body: JSON.stringify({ token: otplib.generateSync({ secret: setup.data.secret }) }),
    });
    expect(disable.status).toBe(200);

    const status = await apiFetch(jar, "/api/2fa/status");
    expect(status.data.enabled).toBe(false);
  });
});
