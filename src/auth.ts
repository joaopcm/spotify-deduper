import { createHash, randomBytes } from "node:crypto";
import { readToken, writeToken, type Token } from "./store";

const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const SCOPES = "user-library-read user-library-modify";
const VERIFIER_LENGTH = 64;
const REFRESH_MARGIN_MS = 60_000;
const UNRESERVED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = [...randomBytes(VERIFIER_LENGTH)].map((b) => UNRESERVED[b % UNRESERVED.length]).join("");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function buildAuthorizeUrl(o: { clientId: string; redirectUri: string; challenge: string; state: string }): string {
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: o.clientId,
    response_type: "code",
    redirect_uri: o.redirectUri,
    code_challenge_method: "S256",
    code_challenge: o.challenge,
    scope: SCOPES,
    state: o.state,
  }).toString();
  return url.toString();
}

export function parseCallbackUrl(pasted: string, expectedState: string): string {
  const text = pasted.trim();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`pasted text is not a URL: ${text}`);
  }
  const params = url.searchParams;
  const error = params.get("error");
  if (error) throw new Error(`login denied: ${error}`);
  const state = params.get("state");
  if (state !== expectedState) throw new Error(`state mismatch: expected ${expectedState}, got ${state}`);
  const code = params.get("code");
  if (!code) throw new Error("no code in pasted URL");
  return code;
}

async function requestToken(
  body: Record<string, string>,
  fetchFn: typeof fetch,
  now: () => number,
  previousRefreshToken?: string,
): Promise<Token> {
  const response = await fetchFn(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  if (!response.ok) throw new Error(`spotify token request failed: ${response.status} ${await response.text()}`);
  const json = (await response.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  const refreshToken = json.refresh_token ?? previousRefreshToken;
  if (!refreshToken) throw new Error("spotify token response had no refresh_token");
  return { accessToken: json.access_token, refreshToken, expiresAt: now() + json.expires_in * 1000 };
}

export function exchangeCode(o: {
  clientId: string;
  redirectUri: string;
  code: string;
  verifier: string;
  fetch?: typeof fetch;
  now?: () => number;
}): Promise<Token> {
  return requestToken(
    {
      grant_type: "authorization_code",
      code: o.code,
      redirect_uri: o.redirectUri,
      client_id: o.clientId,
      code_verifier: o.verifier,
    },
    o.fetch ?? fetch,
    o.now ?? Date.now,
  );
}

export function refresh(o: { clientId: string; token: Token; fetch?: typeof fetch; now?: () => number }): Promise<Token> {
  return requestToken(
    { grant_type: "refresh_token", refresh_token: o.token.refreshToken, client_id: o.clientId },
    o.fetch ?? fetch,
    o.now ?? Date.now,
    o.token.refreshToken,
  );
}

export function tokenProvider(o: { dir: string; clientId: string; fetch?: typeof fetch; now?: () => number }): {
  getToken(): Promise<string>;
  refreshToken(): Promise<string>;
} {
  const now = o.now ?? Date.now;
  const savedToken = () => {
    const token = readToken(o.dir);
    if (!token) throw new Error("not logged in: run spotify-deduper scan");
    return token;
  };
  const forceRefresh = async () => {
    const token = await refresh({ clientId: o.clientId, token: savedToken(), fetch: o.fetch, now });
    writeToken(o.dir, token);
    return token.accessToken;
  };
  return {
    async getToken() {
      const token = savedToken();
      return token.expiresAt - REFRESH_MARGIN_MS < now() ? forceRefresh() : token.accessToken;
    },
    refreshToken: forceRefresh,
  };
}
