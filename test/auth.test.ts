import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAuthorizeUrl, createPkcePair, exchangeCode, parseCallbackUrl, refresh, tokenProvider } from "../src/auth";
import { readToken, writeToken } from "../src/store";

function tokenEndpoint(body: Record<string, unknown>) {
  const requests: URLSearchParams[] = [];
  const fetchFn = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new URLSearchParams(String(init?.body)));
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return { requests, fetchFn };
}

test("PKCE challenge is base64url SHA-256 of a 64 char verifier", () => {
  const { verifier, challenge } = createPkcePair();
  expect(verifier).toHaveLength(64);
  expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
});

test("authorize URL carries PKCE, scopes and state", () => {
  const url = new URL(buildAuthorizeUrl({ clientId: "cid", redirectUri: "http://127.0.0.1:8888/callback", challenge: "ch", state: "st" }));
  expect(url.origin + url.pathname).toBe("https://accounts.spotify.com/authorize");
  expect(url.searchParams.get("response_type")).toBe("code");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("code_challenge")).toBe("ch");
  expect(url.searchParams.get("scope")).toBe("user-library-read user-library-modify");
  expect(url.searchParams.get("state")).toBe("st");
  expect(url.searchParams.get("client_id")).toBe("cid");
});

describe("parseCallbackUrl", () => {
  test("returns the code", () => {
    expect(parseCallbackUrl("http://127.0.0.1:8888/callback?code=abc&state=st", "st")).toBe("abc");
  });
  test("tolerates surrounding whitespace", () => {
    expect(parseCallbackUrl("  http://127.0.0.1:8888/callback?code=abc&state=st\n", "st")).toBe("abc");
  });
  test("names a denied login", () => {
    expect(() => parseCallbackUrl("http://127.0.0.1:8888/callback?error=access_denied&state=st", "st")).toThrow(
      "login denied: access_denied",
    );
  });
  test("names a state mismatch", () => {
    expect(() => parseCallbackUrl("http://127.0.0.1:8888/callback?code=abc&state=zz", "st")).toThrow(
      "state mismatch: expected st, got zz",
    );
  });
  test("names a missing code", () => {
    expect(() => parseCallbackUrl("http://127.0.0.1:8888/callback?state=st", "st")).toThrow("no code in pasted URL");
  });
  test("names a non-URL paste", () => {
    expect(() => parseCallbackUrl("hello", "st")).toThrow("pasted text is not a URL: hello");
  });
});

test("exchangeCode posts the verifier and computes expiry", async () => {
  const api = tokenEndpoint({ access_token: "at", refresh_token: "rt", expires_in: 3600 });
  const token = await exchangeCode({ clientId: "cid", redirectUri: "r", code: "c", verifier: "v", fetch: api.fetchFn, now: () => 1000 });
  expect(token).toEqual({ accessToken: "at", refreshToken: "rt", expiresAt: 1000 + 3_600_000 });
  const body = api.requests[0]!;
  expect(body.get("grant_type")).toBe("authorization_code");
  expect(body.get("code_verifier")).toBe("v");
  expect(body.get("client_id")).toBe("cid");
});

test("refresh keeps the old refresh token when none is returned", async () => {
  const api = tokenEndpoint({ access_token: "new", expires_in: 60 });
  const token = await refresh({ clientId: "cid", token: { accessToken: "old", refreshToken: "rt", expiresAt: 0 }, fetch: api.fetchFn, now: () => 0 });
  expect(token).toEqual({ accessToken: "new", refreshToken: "rt", expiresAt: 60_000 });
  expect(api.requests[0]!.get("grant_type")).toBe("refresh_token");
});

test("token endpoint errors are named", async () => {
  const fetchFn = (async () => new Response('{"error":"invalid_grant"}', { status: 400 })) as unknown as typeof fetch;
  await expect(exchangeCode({ clientId: "c", redirectUri: "r", code: "x", verifier: "v", fetch: fetchFn })).rejects.toThrow(
    'spotify token request failed: 400 {"error":"invalid_grant"}',
  );
});

describe("tokenProvider", () => {
  test("refreshes and persists an expiring token", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deduper-"));
    writeToken(dir, { accessToken: "old", refreshToken: "rt", expiresAt: 30_000 });
    const api = tokenEndpoint({ access_token: "new", expires_in: 3600 });
    const provider = tokenProvider({ dir, clientId: "cid", fetch: api.fetchFn, now: () => 0 });
    expect(await provider.getToken()).toBe("new");
    expect(readToken(dir)?.accessToken).toBe("new");
  });

  test("returns a valid token without refreshing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deduper-"));
    writeToken(dir, { accessToken: "ok", refreshToken: "rt", expiresAt: 10_000_000 });
    const api = tokenEndpoint({});
    expect(await tokenProvider({ dir, clientId: "cid", fetch: api.fetchFn, now: () => 0 }).getToken()).toBe("ok");
    expect(api.requests).toHaveLength(0);
  });

  test("refreshToken forces a refresh", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deduper-"));
    writeToken(dir, { accessToken: "ok", refreshToken: "rt", expiresAt: 10_000_000 });
    const api = tokenEndpoint({ access_token: "forced", expires_in: 3600 });
    expect(await tokenProvider({ dir, clientId: "cid", fetch: api.fetchFn, now: () => 0 }).refreshToken()).toBe("forced");
  });

  test("no saved token is a named error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deduper-"));
    await expect(tokenProvider({ dir, clientId: "cid" }).getToken()).rejects.toThrow("not logged in: run spotify-deduper scan");
  });
});
