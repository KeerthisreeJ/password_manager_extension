// crypto.js
// Mirrors the Dart AuthService crypto exactly:
//   Key derivation : Argon2id, iter=3, mem=131072KB (128MB), lanes=4, keyLen=32
//   Vault cipher   : XChaCha20-Poly1305 (24-byte nonce, 16-byte MAC appended)
//
// memoryPowerOf2=17 in Dart Argon2Parameters means 2^17 = 131072 KB = 128 MB.
// This MUST match exactly – the server stores the Argon2-derived verifier from
// registration, so login must use identical parameters to reproduce the same hash.

// ── Argon2 via argon2-browser (pure-JS WASM, no npm required) ─────────────
// We load the UMD bundle from the extension's lib/ folder.
// The WASM blob is embedded in the JS bundle – no separate .wasm file needed.

const ARGON2_ITERATIONS = 3;
const ARGON2_MEMORY_KB = 131072; // 128 MB — matches Flutter app (memoryPowerOf2=17)
const ARGON2_PARALLELISM = 4;
const ARGON2_HASH_LEN = 32;
const ARGON2_TYPE = 2;       // Argon2id

// ── Helpers ───────────────────────────────────────────────────────────────

export function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

// ── Argon2id key derivation ───────────────────────────────────────────────

export async function deriveKey(password, saltHex) {
  console.log('[SecureVault] deriveKey: loading argon2...');
  const argon2 = await loadArgon2();
  console.log('[SecureVault] deriveKey: argon2 loaded, starting hash (mem=', ARGON2_MEMORY_KB, 'KB)...');
  const result = await argon2.hash({
    pass: password,
    salt: hexToBytes(saltHex),
    time: ARGON2_ITERATIONS,
    mem: ARGON2_MEMORY_KB,
    parallelism: ARGON2_PARALLELISM,
    hashLen: ARGON2_HASH_LEN,
    type: ARGON2_TYPE,
  });
  console.log('[SecureVault] deriveKey: hash complete.');
  return result.hash; // Uint8Array(32)
}

// ── XChaCha20-Poly1305 via libsodium-wasm ─────────────────────────────────
// libsodium.js exposes sodium.crypto_aead_xchacha20poly1305_ietf_*

async function getSodium() {
  await sodium.ready;
  return sodium;
}

// Encrypt vault JSON → { vault_salt, nonce, ciphertext } all hex strings
export async function encryptVault(vaultObj, password) {
  const sodium = await getSodium();
  const vaultSalt = randomBytes(16);
  const keyBytes = await deriveKey(password, bytesToHex(vaultSalt));
  const nonce = randomBytes(24);

  const plaintext = new TextEncoder().encode(JSON.stringify(vaultObj));

  // XChaCha20-Poly1305: ciphertext || mac (libsodium appends 16-byte mac)
  const combined = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext, null, null, nonce, keyBytes
  );

  return {
    vault_salt: bytesToHex(vaultSalt),
    nonce: bytesToHex(nonce),
    ciphertext: bytesToHex(combined),
  };
}

// Decrypt vault blob → plain JS object
export async function decryptVault(blob, password) {
  const sodium = await getSodium();
  const vaultSalt = blob.vault_salt;
  const keyBytes = await deriveKey(password, vaultSalt);
  const nonce = hexToBytes(blob.nonce);
  const combined = hexToBytes(blob.ciphertext);

  const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null, combined, null, nonce, keyBytes
  );

  return JSON.parse(new TextDecoder().decode(plaintext));
}

// ── Auth helpers ──────────────────────────────────────────────────────────

// Derive and return the verifier hex for login/register
export async function buildVerifier(password, saltHex) {
  const key = await deriveKey(password, saltHex);
  return bytesToHex(key);
}

// ── Lazy load argon2-browser ──────────────────────────────────────────────

let _argon2Promise = null;
function loadArgon2() {
  if (_argon2Promise) return _argon2Promise;
  console.log('[SecureVault] loadArgon2: checking self.argon2:', typeof self.argon2);
  _argon2Promise = new Promise((resolve, reject) => {
    if (self.argon2) {
      console.log('[SecureVault] loadArgon2: argon2 already available');
      resolve(self.argon2);
      return;
    }
    console.log('[SecureVault] loadArgon2: waiting for argon2 to load...');
    // argon2-browser is loaded as a <script> in popup.html
    const iv = setInterval(() => {
      if (self.argon2) {
        console.log('[SecureVault] loadArgon2: argon2 became available');
        clearInterval(iv);
        resolve(self.argon2);
      }
    }, 50);
    setTimeout(() => {
      clearInterval(iv);
      console.error('[SecureVault] loadArgon2: TIMEOUT - argon2 never loaded! self.argon2 =', typeof self.argon2);
      reject(new Error('argon2 load timeout after 20s. Check browser console for errors.'));
    }, 20000);
  });
  return _argon2Promise;
}
