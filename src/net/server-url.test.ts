import { describe, expect, it } from 'vitest';

import { LOCAL_SERVER, defaultServerUrl } from './server-url';

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
});
