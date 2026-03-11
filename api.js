// api.js – all REST calls to the SecureVault backend
// Mirrors the Dart AuthService HTTP layer exactly

const BASE_URL = 'https://vault-server-16o7.onrender.com';

async function apiFetch(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, options);
  return res;
}

export async function getAuthSalt(username) {
  const res = await apiFetch(`/auth_salt/${encodeURIComponent(username)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Failed to get auth salt');
  const data = await res.json();
  return data.salt; // hex string
}

export async function apiLogin(username, verifierHex) {
  const res = await apiFetch('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, verifier: verifierHex }),
  });
  if (res.status === 429) {
    const d = await res.json();
    throw new Error(d.detail || 'Too many requests');
  }
  if (!res.ok) return null;
  const data = await res.json();
  return data.token;
}

export async function apiLoginMfa(username, verifierHex, mfaCode) {
  const res = await apiFetch('/login/mfa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, verifier: verifierHex, mfa_code: mfaCode }),
  });
  if (res.status === 429) {
    const d = await res.json();
    throw new Error(d.detail || 'Too many requests');
  }
  if (!res.ok) return null;
  const data = await res.json();
  return data.token;
}

export async function checkMfaStatus(username) {
  const res = await apiFetch(`/mfa/status/${encodeURIComponent(username)}`);
  if (!res.ok) return false;
  const data = await res.json();
  return data.mfa_enabled ?? false;
}

export async function getVault(token) {
  const res = await apiFetch('/vault', {
    headers: { Authorization: token },
  });
  if (!res.ok) throw new Error('Failed to fetch vault');
  return res.json();
}

export async function updateVault(token, encryptedBlob) {
  const res = await apiFetch('/vault', {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ blob: encryptedBlob }),
  });
  return res.ok;
}

export async function apiLogout(token) {
  try {
    await apiFetch('/logout', { method: 'POST', headers: { Authorization: token } });
  } catch (_) { /* ignore */ }
}

// ── Passkeys ──
export async function getPasskeyRegisterOptions(token) {
  const res = await apiFetch('/auth/passkey/register/options', {
    method: 'POST',
    headers: { Authorization: token }
  });
  if (!res.ok) throw new Error('Failed to get register options');
  return res.json();
}

export async function verifyPasskeyRegister(token, username, responsePayload, encryptedMasterHex) {
  const res = await apiFetch('/auth/passkey/register/verify', {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, response: responsePayload, encrypted_master: encryptedMasterHex })
  });
  if (!res.ok) throw new Error('Passkey registration failed');
  return res.json();
}

export async function getPasskeyLoginOptions(username) {
  const res = await apiFetch(`/auth/passkey/login/options?username=${encodeURIComponent(username)}`, {
    method: 'POST'
  });
  if (res.status === 404) throw new Error('No passkey found for this user. Register it first!');
  if (!res.ok) throw new Error('Failed to reach server for Passkey login.');
  return res.json();
}

export async function verifyPasskeyLogin(username, responsePayload) {
  const res = await apiFetch('/auth/passkey/login/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, response: responsePayload })
  });
  if (!res.ok) throw new Error('Passkey login failed');
  return res.json();
}
