import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BroadcastChannel } from 'node:worker_threads';
import { BrowserUtils, PublicClientApplication } from '@azure/msal-browser';
import { authConfiguration } from '../src/web/auth.js';

test('the configured MSAL cache permits redirect sign-in', () => {
  const previousChannel = Object.getOwnPropertyDescriptor(
    globalThis,
    'BroadcastChannel',
  );
  Object.defineProperty(globalThis, 'BroadcastChannel', {
    value: class extends BroadcastChannel {
      constructor(name: string) {
        super(name);
        this.unref();
      }
    },
    configurable: true,
  });
  const msal = new PublicClientApplication(
    authConfiguration(
      {
        tenantId: '11111111-1111-4111-8111-111111111111',
        spaClientId: '22222222-2222-4222-8222-222222222222',
      },
      'https://app.example.test',
    ),
  );
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const browser = { opener: null, location: { hash: '', search: '' } };
  Object.defineProperty(browser, 'parent', { value: browser });
  Object.defineProperty(globalThis, 'window', {
    value: browser,
    configurable: true,
  });
  try {
    assert.doesNotThrow(() =>
      BrowserUtils.redirectPreflightCheck(true, msal.getConfiguration()),
    );
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
    if (previousChannel) {
      Object.defineProperty(globalThis, 'BroadcastChannel', previousChannel);
    } else {
      Reflect.deleteProperty(globalThis, 'BroadcastChannel');
    }
  }
});
