import {
  InteractionRequiredAuthError,
  PublicClientApplication,
} from '@azure/msal-browser';
import type { FilePage, PublicConfig } from '../shared.js';
import { collectBytes, decryptFile, protectFile } from './tdf.js';
import { MAX_CIPHER_BYTES } from '../shared.js';
import './style.css';
import { authConfiguration } from './auth.js';

function element<T extends HTMLElement>(id: string, type: new () => T): T {
  const value = document.getElementById(id);
  if (!(value instanceof type)) throw new Error(`Missing UI element: ${id}`);
  return value;
}
const status = element('status', HTMLParagraphElement);
const file = element('file', HTMLInputElement);
const signIn = element('signin', HTMLButtonElement);
const signOut = element('signout', HTMLButtonElement);
const upload = element('upload', HTMLButtonElement);
const refresh = element('refresh', HTMLButtonElement);
const files = element('files', HTMLUListElement);
let busy = false;

function showError(error: unknown) {
  status.textContent =
    error instanceof Error
      ? error.message.slice(0, 500)
      : 'Operation failed. Check application and KAS audit logs.';
  status.classList.add('error');
}

function save(bytes: Uint8Array<ArrayBuffer>, name: string) {
  const url = URL.createObjectURL(
    new Blob([bytes], { type: 'application/octet-stream' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

async function start() {
  const configResponse = await fetch('/api/config', { cache: 'no-store' });
  if (!configResponse.ok)
    throw new Error('Unable to load application configuration');
  const config: PublicConfig = await configResponse.json();
  element('attribute', HTMLElement).textContent = config.attribute;
  const msal = new PublicClientApplication(
    authConfiguration(config, window.location.origin),
  );
  await msal.initialize();
  const redirect = await msal.handleRedirectPromise();
  if (redirect?.account) msal.setActiveAccount(redirect.account);

  function controls() {
    const signedIn = msal.getActiveAccount() !== null;
    signIn.disabled = busy || signedIn;
    signOut.disabled = busy || !signedIn;
    file.disabled = busy || !signedIn;
    upload.disabled = busy || !signedIn;
    refresh.disabled = busy || !signedIn;
    for (const button of files.querySelectorAll('button')) {
      button.disabled = busy || !signedIn;
    }
    element('account', HTMLElement).textContent =
      msal.getActiveAccount()?.username ?? 'Not signed in';
  }
  async function getToken() {
    const account = msal.getActiveAccount();
    if (!account) throw new Error('Sign in before accessing protected files');
    try {
      const result = await msal.acquireTokenSilent({
        account,
        scopes: [config.apiScope],
      });
      return result.accessToken;
    } catch (error) {
      if (error instanceof InteractionRequiredAuthError) {
        throw new Error(
          'Your session needs interaction. Sign out and sign in again.',
        );
      }
      throw error;
    }
  }
  async function api(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${await getToken()}`);
    const response = await fetch(path, { ...init, headers, cache: 'no-store' });
    if (!response.ok) {
      throw new Error(
        `File API ${response.status}; request ${response.headers.get('X-Request-Id') ?? 'unknown'}`,
      );
    }
    return response;
  }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    busy = true;
    status.classList.remove('error');
    controls();
    try {
      await action();
    } catch (error) {
      showError(error);
    } finally {
      busy = false;
      controls();
    }
  }
  async function getFile(id: string) {
    const response = await api(`/api/files/${encodeURIComponent(id)}`);
    if (!response.body) throw new Error('File API returned no body');
    return collectBytes(response.body, MAX_CIPHER_BYTES);
  }
  async function list() {
    const response = await api('/api/files');
    const page: FilePage = await response.json();
    files.replaceChildren();
    for (const item of page.files) {
      const row = document.createElement('li');
      const text = document.createElement('code');
      text.textContent = `${item.id} / ${item.size.toLocaleString()} encrypted bytes`;
      const encrypted = document.createElement('button');
      encrypted.textContent = 'Download TDF';
      encrypted.addEventListener(
        'click',
        () =>
          void run(async () => {
            save(await getFile(item.id), `${item.id}.tdf`);
            status.textContent =
              'Ciphertext downloaded. This does not grant plaintext access.';
          }),
      );
      const decrypt = document.createElement('button');
      decrypt.textContent = 'Decrypt';
      decrypt.addEventListener(
        'click',
        () =>
          void run(async () => {
            status.textContent = 'Requesting a fresh OpenTDF key release...';
            const plaintext = await decryptFile(
              await getFile(item.id),
              config,
              getToken,
            );
            save(plaintext, `${item.id}.decrypted`);
            status.textContent =
              'OpenTDF authorized key release; plaintext downloaded locally.';
          }),
      );
      row.append(text, encrypted, decrypt);
      files.append(row);
    }
    element('page-note', HTMLElement).textContent = page.hasMore
      ? 'Only the first 100 files are listed. This MVP does not provide a full catalog.'
      : `${page.files.length} protected file(s). Original filenames are not stored in the catalog.`;
  }
  signIn.addEventListener(
    'click',
    () =>
      void run(async () => {
        await msal.loginRedirect({ scopes: [config.apiScope] });
      }),
  );
  signOut.addEventListener(
    'click',
    () =>
      void run(async () => {
        files.replaceChildren();
        file.value = '';
        await msal.logoutRedirect();
      }),
  );
  refresh.addEventListener(
    'click',
    () =>
      void run(async () => {
        await list();
        status.textContent = 'Ciphertext catalog refreshed.';
      }),
  );
  upload.addEventListener(
    'click',
    () =>
      void run(async () => {
        const selected = file.files?.[0];
        if (!selected) throw new Error('Choose a file first');
        status.textContent = 'Encrypting locally with the OpenTDF SDK...';
        const ciphertext = await protectFile(selected, config, getToken);
        const response = await api('/api/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: ciphertext,
        });
        const result: { id: string } = await response.json();
        file.value = '';
        await list();
        status.textContent = `Encrypted file stored: ${result.id}`;
      }),
  );
  controls();
  if (msal.getActiveAccount()) {
    await run(list);
  } else {
    status.textContent = 'Sign in to protect files and request OpenTDF access.';
  }
}

start().catch(showError);
