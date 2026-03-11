// content.js – runs on every page
// Listens for autofill commands from the background service worker

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'DO_AUTOFILL') {
    autofill(msg.username, msg.password);
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
    if (usernameField) break;
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
