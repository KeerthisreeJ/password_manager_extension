// background.js – Service Worker
// Handles session persistence in chrome.storage.session for in-memory only storage

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_SESSION') {
    chrome.storage.session.get(['token', 'username', 'password', 'vault'], (data) => {
      sendResponse({
        token: data.token || null,
        username: data.username || null,
        password: data.password || null,
        vault: data.vault || null
      });
    });
    return true; // keep channel open for async
  }

  if (msg.type === 'SET_SESSION') {
    chrome.storage.session.set({
      token: msg.token,
      username: msg.username,
      password: msg.password,
      vault: msg.vault || {}
    }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === 'CLEAR_SESSION') {
    chrome.storage.session.remove(['token', 'username', 'password', 'vault'], () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  // Check if we have credentials for a specific url
  if (msg.type === 'CHECK_CREDENTIALS') {
    chrome.storage.session.get(['vault'], (data) => {
      if (!data.vault) {
        sendResponse({ hasCredentials: false });
        return;
      }

      const hostname = msg.hostname.toLowerCase();
      // Simple matching: check if any vault key is a substring of the hostname or vice versa
      const match = Object.entries(data.vault).find(([key, _]) => {
        const keyLower = key.toLowerCase();
        return hostname.includes(keyLower) || keyLower.includes(hostname);
      });

      if (match) {
        const key = match[0];
        // The key is typically formatted as "hostname (username)"
        // Try to extract just the username part
        let username = key;
        const matchRegex = /\(([^)]+)\)$/;
        const regexResult = matchRegex.exec(key);
        if (regexResult && regexResult[1]) {
          username = regexResult[1];
        }

        sendResponse({ hasCredentials: true, username: username, password: match[1].password });
      } else {
        sendResponse({ hasCredentials: false });
      }
    });
    return true;
  }

  // Triggered by content script when a new password is submitted
  if (msg.type === 'PROMPT_SAVE_CREDENTIAL') {
    // Store the pending save request in session storage
    chrome.storage.session.set({
      pendingSave: {
        hostname: msg.hostname,
        username: msg.username,
        password: msg.password,
        timestamp: Date.now()
      }
    }, () => {
      // We could show a notification here, but native notifications might be intrusive.
      // The popup can check for 'pendingSave' on load.
      sendResponse({ ok: true });
    });
    return true;
  }

  // Autofill: inject credentials into active tab
  if (msg.type === 'AUTOFILL') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'DO_AUTOFILL',
          username: msg.username,
          password: msg.password,
        }, () => sendResponse({ ok: true }));
      }
    });
    return true;
  }
});
