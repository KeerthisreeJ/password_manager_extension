// background.js – Service Worker
// Handles session persistence in chrome.storage.local

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_SESSION') {
    chrome.storage.local.get(['token', 'username', 'password'], (data) => {
      sendResponse({ token: data.token || null, username: data.username || null, password: data.password || null });
    });
    return true; // keep channel open for async
  }

  if (msg.type === 'SET_SESSION') {
    chrome.storage.local.set({ token: msg.token, username: msg.username, password: msg.password }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === 'CLEAR_SESSION') {
    chrome.storage.local.remove(['token', 'username', 'password'], () => {
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
