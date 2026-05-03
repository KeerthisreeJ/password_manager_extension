// content.js – runs on every page
// Listens for autofill commands from the background service worker
// Also detects login forms and prompts to save/autofill

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'DO_AUTOFILL') {
    autofill(msg.username, msg.password);
  }
});

// Check if we have credentials on page load
window.addEventListener('load', () => {
  const hostname = window.location.hostname;
  const promptKey = `securevault_prompted_${hostname}`;

  if (sessionStorage.getItem(promptKey)) {
    return; // Already prompted for this hostname in this tab session
  }

  chrome.runtime.sendMessage({
    type: 'CHECK_CREDENTIALS',
    hostname
  }, (response) => {
    if (response && response.hasCredentials) {
      // Small delay to ensure DOM is fully ready
      setTimeout(() => {
        if (confirm(`SecureVault: Autofill login for ${response.username}?`)) {
          autofill(response.username, response.password);
        }
        // Mark as prompted regardless of yes/no to avoid nagging
        sessionStorage.setItem(promptKey, 'true');
      }, 500);
    }
  });
});

// Intercept form submissions to save new passwords
document.addEventListener('submit', (e) => {
  const form = e.target;
  const passwordField = form.querySelector('input[type="password"]');

  if (passwordField && passwordField.value) {
    const password = passwordField.value;

    // Try to find the username
    const usernameSelectors = [
      'input[type="email"]',
      'input[type="text"][name*="user"]',
      'input[type="text"][name*="email"]',
      'input[type="text"][id*="user"]',
      'input[type="text"][id*="email"]',
      'input[autocomplete="username"]',
      'input[autocomplete="email"]',
    ];

    let usernameField = null;
    for (const sel of usernameSelectors) {
      usernameField = form.querySelector(sel);
      if (usernameField && usernameField.value) break;
    }

    const username = usernameField ? usernameField.value : 'unknown';

    // We don't want to block the login, so just asynchronously message background
    if (confirm(`SecureVault: Would you like to save this password for ${window.location.hostname}? (You must open the extension popup to complete the save)`)) {
      chrome.runtime.sendMessage({
        type: 'PROMPT_SAVE_CREDENTIAL',
        hostname: window.location.hostname,
        username,
        password
      });
    }
  }
});

function autofill(username, password) {
  // Find the best username/email field
  const usernameSelectors = [
    'input[type="email"]',
    'input[type="text"][name*="user"]',
    'input[type="text"][name*="email"]',
    'input[type="text"][id*="user"]',
    'input[type="text"][id*="email"]',
    'input[autocomplete="username"]',
    'input[autocomplete="email"]',
  ];

  const passwordSelectors = [
    'input[type="password"]',
    'input[autocomplete="current-password"]',
    'input[autocomplete="new-password"]',
  ];

  let usernameField = null;
  for (const sel of usernameSelectors) {
    usernameField = document.querySelector(sel);
    if (usernameField && !usernameField.disabled) break;
  }

  const passwordField = document.querySelector(passwordSelectors.join(', '));

  if (usernameField) {
    fillInput(usernameField, username);
  }
  if (passwordField) {
    fillInput(passwordField, password);
  }

  if (!usernameField && !passwordField) {
    console.warn('[SecureVault] No login fields found on this page.');
  }
}

// Simulate native input events so React/Vue/Angular forms detect the change
function fillInput(el, value) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  )?.set;
  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(el, value);
  } else {
    el.value = value;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
