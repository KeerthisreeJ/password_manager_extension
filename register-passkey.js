import { encryptMasterPassword } from './crypto.js';
import { getPasskeyRegisterOptions, verifyPasskeyRegister } from './api.js';

function base64urlToBuffer(base64url) {
    const padding = '='.repeat((4 - base64url.length % 4) % 4);
    const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray.buffer;
}

function bufferToBase64url(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function init() {
    await sodium.ready;
    const btn = document.getElementById('btn-start');
    const status = document.getElementById('status');

    btn.addEventListener('click', async () => {
        btn.disabled = true;
        status.innerText = 'Creating session...';

        try {
            const session = await new Promise(resolve => chrome.runtime.sendMessage({ type: 'GET_SESSION' }, resolve));
            if (!session.token || !session.password) {
                throw new Error("Session expired or invalid. Please login to the extension normally first.");
            }

            status.innerText = 'Requesting options from server...';
            const opts = await getPasskeyRegisterOptions(session.token);
            // opts is the PublicKeyCredentialCreationOptions object
            opts.challenge = base64urlToBuffer(opts.challenge);
            opts.user.id = base64urlToBuffer(opts.user.id);
            if (opts.excludeCredentials) {
                for (let c of opts.excludeCredentials) c.id = base64urlToBuffer(c.id);
            }

            status.innerText = 'Please follow your browser prompts...';
            const credential = await navigator.credentials.create({ publicKey: opts });

            status.innerText = 'Encrypting & finalizing...';
            const responsePayload = {
                id: credential.id,
                rawId: bufferToBase64url(credential.rawId),
                response: {
                    clientDataJSON: bufferToBase64url(credential.response.clientDataJSON),
                    attestationObject: bufferToBase64url(credential.response.attestationObject)
                },
                type: credential.type
            };

            const encData = await encryptMasterPassword(session.password);
            await verifyPasskeyRegister(session.token, session.username, responsePayload, JSON.stringify(encData.encryptedPass));

            await new Promise(resolve => chrome.storage.local.set({ passkeyAesKey: encData.keyHex }, resolve));

            status.classList.add('success');
            status.innerText = '✅ Passkey registered successfully! You can close this tab and try logging in with Passkey in the extension.';
            document.getElementById('title').innerText = '🎉 Success!';
            btn.style.display = 'none';

        } catch (err) {
            console.error(err);
            status.classList.add('error');
            status.innerText = '❌ Error: ' + err.message;
            btn.disabled = false;
        }
    });
}

init();
