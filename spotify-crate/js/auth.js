// Spotify Authorization Code flow with PKCE.
//
// PKCE exists so a browser-only app can authenticate without a client secret:
// we hash a random verifier into the authorize request and reveal the verifier
// only at token exchange, so an intercepted redirect is useless on its own.

const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';

const SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
  'playlist-modify-public',
];

const LS_CLIENT_ID = 'crate.clientId';
const LS_TOKENS = 'crate.tokens';
const SS_VERIFIER = 'crate.pkceVerifier';
const SS_STATE = 'crate.pkceState';

// Spotify requires the redirect URI to match a registered one exactly,
// including any trailing path. Derive it from where we are actually served.
export function redirectUri() {
  return window.location.origin + window.location.pathname;
}

export function getClientId() {
  return localStorage.getItem(LS_CLIENT_ID) || '';
}

export function setClientId(id) {
  localStorage.setItem(LS_CLIENT_ID, id.trim());
}

function randomString(length) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

function base64url(buffer) {
  let str = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(digest);
}

function readTokens() {
  try {
    return JSON.parse(localStorage.getItem(LS_TOKENS)) || null;
  } catch {
    return null;
  }
}

function writeTokens(t) {
  localStorage.setItem(LS_TOKENS, JSON.stringify(t));
}

function storeTokenResponse(data, previous) {
  const tokens = {
    accessToken: data.access_token,
    // A refresh response may omit refresh_token, meaning "keep using the old one".
    refreshToken: data.refresh_token || (previous && previous.refreshToken) || null,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  writeTokens(tokens);
  return tokens;
}

export function isLoggedIn() {
  const t = readTokens();
  return Boolean(t && t.refreshToken);
}

export function logout() {
  localStorage.removeItem(LS_TOKENS);
}

export async function login() {
  const clientId = getClientId();
  if (!clientId) throw new Error('No Spotify client ID configured.');

  const verifier = randomString(64);
  const state = randomString(16);
  sessionStorage.setItem(SS_VERIFIER, verifier);
  sessionStorage.setItem(SS_STATE, state);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: await challengeFor(verifier),
    scope: SCOPES.join(' '),
    state,
  });

  window.location.assign(`${AUTH_URL}?${params}`);
}

async function postToken(body) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `Token request failed (${res.status})`);
  }
  return data;
}

// Consume ?code=... on the way back from Spotify. Returns true if a login
// completed on this page load.
export async function handleRedirect() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const error = params.get('error');
  const state = params.get('state');

  if (!code && !error) return false;

  // Clean the URL first, so a refresh never replays a spent authorization code.
  window.history.replaceState({}, '', redirectUri());

  if (error) throw new Error(`Spotify denied the login: ${error}`);

  const expectedState = sessionStorage.getItem(SS_STATE);
  const verifier = sessionStorage.getItem(SS_VERIFIER);
  sessionStorage.removeItem(SS_STATE);
  sessionStorage.removeItem(SS_VERIFIER);

  if (!verifier) throw new Error('Login state was lost. Please try signing in again.');
  if (state !== expectedState) throw new Error('Login state mismatch. Please try signing in again.');

  const data = await postToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    client_id: getClientId(),
    code_verifier: verifier,
  });

  storeTokenResponse(data, null);
  return true;
}

let refreshInFlight = null;

async function refresh(tokens) {
  // Collapse concurrent 401s into a single refresh; Spotify rotates the
  // refresh token, so a second parallel exchange would fail on a stale one.
  if (!refreshInFlight) {
    refreshInFlight = postToken({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: getClientId(),
    })
      .then((data) => storeTokenResponse(data, tokens))
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

export async function getAccessToken({ force = false } = {}) {
  const tokens = readTokens();
  if (!tokens) throw new Error('Not signed in.');

  if (!force && tokens.accessToken && Date.now() < tokens.expiresAt) {
    return tokens.accessToken;
  }
  if (!tokens.refreshToken) throw new Error('Session expired. Please sign in again.');

  const fresh = await refresh(tokens);
  return fresh.accessToken;
}
