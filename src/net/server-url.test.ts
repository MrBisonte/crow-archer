import { describe, expect, it } from 'vitest';

import { LOCAL_SERVER, PAGES_ORIGIN, SERVER_ORIGIN, defaultServerUrl, isStaticHost } from './server-url';

describe('defaultServerUrl', () => {
  it('talks to the origin that served the page', () => {
    expect(defaultServerUrl({ protocol: 'http:', host: 'crow.example.com' })).toBe(
      'ws://crow.example.com/ws',
    );
  });

  it('upgrades to wss on an https page, which is the only thing it may open', () => {
    expect(defaultServerUrl({ protocol: 'https:', host: 'crow.example.com' })).toBe(
      'wss://crow.example.com/ws',
    );
  });

  it('keeps a non-default port, so the dev proxy is reached and not the game server', () => {
    expect(defaultServerUrl({ protocol: 'http:', host: 'localhost:8081' })).toBe(
      'ws://localhost:8081/ws',
    );
  });

  it('falls back to the local server for a page opened from disk', () => {
    expect(defaultServerUrl({ protocol: 'file:', host: '' })).toBe(LOCAL_SERVER);
  });

  it('falls back when a scheme carries a host it cannot serve a socket from', () => {
    expect(defaultServerUrl({ protocol: 'blob:', host: 'example.com' })).toBe(LOCAL_SERVER);
  });

  it('points the fallback at the port the server listens on by default', () => {
    expect(LOCAL_SERVER).toBe('ws://127.0.0.1:8082/ws');
  });

  it('sends a Pages visitor to the deployed server, which is the only one there is', () => {
    // A shared link is a Pages link. Deriving from the page's own origin would
    // open a socket against a static host, so this is the one origin that is
    // named rather than derived.
    expect(defaultServerUrl({ protocol: 'https:', host: 'mrbisonte.github.io' })).toBe(
      'wss://crow-archer.fly.dev/ws',
    );
  });

  it('still derives on every other https host, so a self-hosted build is unchanged', () => {
    expect(defaultServerUrl({ protocol: 'https:', host: 'crow-archer.fly.dev' })).toBe(
      'wss://crow-archer.fly.dev/ws',
    );
  });
});

describe('isStaticHost', () => {
  it('names the page host and nothing else', () => {
    expect(isStaticHost({ protocol: 'https:', host: 'mrbisonte.github.io' })).toBe(true);
    expect(isStaticHost({ protocol: 'https:', host: 'crow-archer.fly.dev' })).toBe(false);
    expect(isStaticHost({ protocol: 'http:', host: 'localhost:8081' })).toBe(false);
    expect(isStaticHost({ protocol: 'file:', host: '' })).toBe(false);
  });

  it('checks the scheme too, so a lookalike served over http is not the real one', () => {
    expect(isStaticHost({ protocol: 'http:', host: 'mrbisonte.github.io' })).toBe(false);
  });
});

describe('the deployment origins', () => {
  it('are whole origins, since the server compares an Origin header against them', () => {
    // A trailing slash or a path here would never match what a browser sends,
    // and the failure would arrive as a CORS error rather than as a typo.
    for (const origin of [SERVER_ORIGIN, PAGES_ORIGIN]) {
      expect(origin).toMatch(/^https:\/\/[^/]+$/);
    }
  });
});
