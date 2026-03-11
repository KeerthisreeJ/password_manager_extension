// popup.js – Main extension logic
// Handles: login → MFA → vault display → autofill / copy

import { hexToBytes, bytesToHex, randomBytes, buildVerifier, encryptVault, decryptVault } from './crypto.js';
import { getAuthSalt, apiLogin, apiLoginMfa, checkMfaStatus, getVault, updateVault, apiLogout } from './api.js';

await sodium.ready;
console.log("[SecureVault] libsodium ready");

// ── Utilities ──────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

function getSession() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'GET_SESSION' }, resolve);
  });
}
function setSession(token, username) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'SET_SESSION', token, username }, resolve);
  });
}
function clearSession() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'CLEAR_SESSION' }, resolve);
  });
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(`screen-${name}`).classList.add('active');
}

function showError(id, msg) {
  const el = $(id);
  el.textContent = msg;
  el.classList.remove('hidden');
}
function hideError(id) { $(id)?.classList.add('hidden'); }

function setLoading(btnId, spinnerId, loading) {
  $(btnId).disabled = loading;
  $(spinnerId).classList.toggle('hidden', !loading);
  $(`${btnId}-text`)?.classList.toggle('hidden', loading);
}

// ── Category colours map ───────────────────────────────────────────────────

const CAT_COLORS = {
  'Work': '#6C5CE7',
  'Personal': '#00B894',
  'Banking': '#FFC312',
  'Shopping': '#FF6B6B',
  'Social Media': '#48DBFB',
  'Other': '#B0B8CC',
};
const CAT_ICONS = {
  'Work': '💼', 'Personal': '👤', 'Banking': '🏦',
  'Shopping': '🛒', 'Social Media': '💬', 'Other': '📁',
};

// ── App state ──────────────────────────────────────────────────────────────

let _token = null;
let _username = null;
let _password = null; // master password (in-memory only)
let _vault = {};   // decrypted vault { site_key: {password, category, updatedAt} }
let _pendingVerifier = null; // for MFA flow

// ── Init ───────────────────────────────────────────────────────────────────

async function init() {
  const session = await getSession();
  showScreen('login');
  if (session?.token && session?.username) {
    _username = session.username;
    // Pre-fill username but keep it editable — password is never cached for security,
    // so the user always needs to re-authenticate. Locking the field prevents changing accounts.
    $('login-username').value = _username;
    $('login-username').disabled = false;
    // Show a "Change" hint so the user knows they can edit it
    const hint = $('login-username-hint');
    if (hint) {
      hint.textContent = 'Not you? Clear the field and type a different username.';
      hint.classList.remove('hidden');
    }
  }

  // Pre-warm the crypto libraries in the background so the first login is fast.
  // Show a gentle status and surface any load errors early (before the button is clicked).
  try {
    $('btn-login').disabled = true;
    const loginText = $('btn-login-text');
    if (loginText) loginText.textContent = 'Initialising…';
    // Import buildVerifier to trigger argon2 WASM load now, not at login time
    const { buildVerifier: _warm } = await import('./crypto.js');
    // Also pre-warm sodium
    const { encryptVault: _warmS } = await import('./crypto.js');
    if (loginText) loginText.textContent = 'Unlock Vault';
    $('btn-login').disabled = false;
  } catch (e) {
    showError('login-error', '⚠️ Crypto library failed to load. Try reloading the extension.');
    $('btn-login').disabled = true;
  }
}

// ── Login flow ─────────────────────────────────────────────────────────────

$('btn-login').addEventListener('click', handleLogin);
$('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });
$('toggle-login-pass').addEventListener('click', () => {
  const inp = $('login-password');
  inp.type = inp.type === 'password' ? 'text' : 'password';
});

async function handleLogin() {
  hideError('login-error');
  const username = $('login-username').value.trim();
  const password = $('login-password').value;
  if (!username || !password) { showError('login-error', 'Please enter username and password.'); return; }

  setLoading('btn-login', 'btn-login-spinner', true);
  try {
    console.log('[SecureVault] Step 1: Getting auth salt for', username);
    const saltHex = await getAuthSalt(username);
    if (!saltHex) { showError('login-error', 'User not found. Register in the app first.'); return; }
    console.log('[SecureVault] Step 2: Got salt, running Argon2id (128MB - may take 10-30s)...');

    const verifierHex = await buildVerifier(password, saltHex);
    console.log('[SecureVault] Step 3: Verifier built. Checking MFA...');

    const mfaEnabled = await checkMfaStatus(username);
    if (mfaEnabled) {
      _pendingVerifier = { username, password, verifierHex };
      showScreen('mfa');
      $('mfa-code').focus();
      return;
    }

    console.log('[SecureVault] Step 4: Logging in...');
    const token = await apiLogin(username, verifierHex);
    if (!token) { showError('login-error', 'Invalid password.'); return; }

    console.log('[SecureVault] Login successful!');
    await onLoginSuccess(token, username, password);
  } catch (err) {
    console.error('[SecureVault] Login error:', err);
    showError('login-error', err.message || 'Login failed. Is the server running?');
  } finally {
    setLoading('btn-login', 'btn-login-spinner', false);
  }
}

// ── MFA flow ───────────────────────────────────────────────────────────────

$('btn-mfa').addEventListener('click', handleMfa);
$('mfa-code').addEventListener('keydown', e => { if (e.key === 'Enter') handleMfa(); });
$('btn-mfa-back').addEventListener('click', () => { _pendingVerifier = null; showScreen('login'); });

async function handleMfa() {
  hideError('mfa-error');
  const code = $('mfa-code').value.trim();
  if (code.length !== 6) { showError('mfa-error', 'Enter a 6-digit code.'); return; }

  setLoading('btn-mfa', 'btn-mfa-spinner', true);
  try {
    const { username, password, verifierHex } = _pendingVerifier;
    const token = await apiLoginMfa(username, verifierHex, code);
    if (!token) { showError('mfa-error', 'Incorrect code. Try again.'); return; }
    await onLoginSuccess(token, username, password);
  } catch (err) {
    showError('mfa-error', err.message || 'MFA verification failed.');
  } finally {
    setLoading('btn-mfa', 'btn-mfa-spinner', false);
  }
}

// ── After successful auth ──────────────────────────────────────────────────

async function onLoginSuccess(token, username, password) {
  console.log("Session start");

  _token = token;
  _username = username;
  _password = password;
  _pendingVerifier = null;

  await setSession(token, username);
  console.log("Session stored");

  const vaultResp = await getVault(token);
  console.log("Vault response:", vaultResp);

  if (vaultResp.blob) {
    console.log("Decrypting vault...");
    _vault = await decryptVault(vaultResp.blob, password);
    console.log("Vault decrypted");
  } else {
    _vault = {};
  }

  renderVault();
  showScreen('vault');
}

// ── Vault rendering ────────────────────────────────────────────────────────

function renderVault(query = '') {
  $('vault-username-label').textContent = _username;
  $('vault-avatar').textContent = (_username?.[0] || '?').toUpperCase();

  const list = $('vault-list');
  list.innerHTML = '';

  const entries = Object.entries(_vault).filter(([key]) =>
    !query || key.toLowerCase().includes(query.toLowerCase())
  );

  if (entries.length === 0) {
    $('vault-empty').classList.remove('hidden');
    list.classList.add('hidden');
    return;
  }

  $('vault-empty').classList.add('hidden');
  list.classList.remove('hidden');

  entries.sort((a, b) => a[0].localeCompare(b[0])).forEach(([key, value], i) => {
    const cat = value.category || 'Other';
    const color = CAT_COLORS[cat] || CAT_COLORS['Other'];
    const icon = CAT_ICONS[cat] || '📁';

    const card = document.createElement('div');
    card.className = 'vault-card';
    card.style.animationDelay = `${i * 40}ms`;
    card.innerHTML = `
      <div class="card-avatar" style="background:${color}22;color:${color}">${icon}</div>
      <div class="card-info">
        <p class="card-key">${escHtml(key)}</p>
        <p class="card-cat" style="color:${color}">${escHtml(cat)}</p>
      </div>
      <button class="icon-btn card-copy" data-key="${escHtml(key)}" title="Copy password">📋</button>
    `;
    // Open detail on card click
    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('card-copy')) return;
      openDetail(key, value);
    });
    // Quick copy
    card.querySelector('.card-copy').addEventListener('click', (e) => {
      e.stopPropagation();
      copyToClipboard(value.password, card.querySelector('.card-copy'));
    });
    list.appendChild(card);
  });
}

$('vault-search').addEventListener('input', e => renderVault(e.target.value));
$('btn-logout').addEventListener('click', async () => {
  if (_token) await apiLogout(_token);
  _token = _password = _username = null;
  _vault = {};
  await clearSession();
  $('login-username').disabled = false;
  $('login-username').value = '';
  $('login-password').value = '';
  const hint = $('login-username-hint');
  if (hint) hint.classList.add('hidden');
  showScreen('login');
});

// ── Detail screen ──────────────────────────────────────────────────────────

let _detailKey = null;
let _detailValue = null;
let _passRevealed = false;

function openDetail(key, value) {
  _detailKey = key;
  _detailValue = value;
  _passRevealed = false;

  $('detail-name').textContent = key;
  $('detail-key').textContent = key;
  $('detail-pass').textContent = '••••••••';
  $('detail-pass').classList.add('masked');
  $('btn-reveal-pass').textContent = '👁';

  const cat = value.category || 'Other';
  const badge = $('detail-category-badge');
  badge.textContent = cat;
  badge.style.color = CAT_COLORS[cat] || CAT_COLORS['Other'];
  badge.style.borderColor = CAT_COLORS[cat] || CAT_COLORS['Other'];

  $('detail-updated').textContent = value.updatedAt || '—';
  hideError('detail-feedback');
  showScreen('detail');
}

$('btn-detail-back').addEventListener('click', () => showScreen('vault'));

$('btn-reveal-pass').addEventListener('click', () => {
  _passRevealed = !_passRevealed;
  $('detail-pass').textContent = _passRevealed ? _detailValue.password : '••••••••';
  $('detail-pass').classList.toggle('masked', !_passRevealed);
  $('btn-reveal-pass').textContent = _passRevealed ? '🙈' : '👁';
});

$('btn-copy-pass').addEventListener('click', () => {
  copyToClipboard(_detailValue.password, $('btn-copy-pass'));
});

$('btn-autofill').addEventListener('click', () => {
  chrome.runtime.sendMessage({
    type: 'AUTOFILL',
    username: _detailKey,
    password: _detailValue.password,
  }, () => {
    showFeedback('detail-feedback', '⚡ Autofilled!', 'success');
    setTimeout(() => window.close(), 1200);
  });
});

// ── Helpers ────────────────────────────────────────────────────────────────

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✅';
    setTimeout(() => { btn.textContent = orig; }, 1500);
    showFeedback('detail-feedback', '📋 Copied to clipboard!', 'success');
  }).catch(() => {
    showFeedback('detail-feedback', '❌ Copy failed', 'error');
  });
}

function showFeedback(id, msg, type) {
  const el = $(id);
  el.textContent = msg;
  el.className = `feedback-box ${type}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 2500);
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Boot ───────────────────────────────────────────────────────────────────
init();
