import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BACKEND_URL,
  buildBackendUrl,
  normalizeBackendUrl,
} from './backend';

describe('normalizeBackendUrl', () => {
  it('falls back to localhost', () => {
    expect(normalizeBackendUrl(undefined)).toBe(DEFAULT_BACKEND_URL);
    expect(normalizeBackendUrl('   ')).toBe(DEFAULT_BACKEND_URL);
  });

  it('removes trailing slashes', () => {
    expect(normalizeBackendUrl('http://backend:3001///')).toBe(
      'http://backend:3001',
    );
  });
});

describe('buildBackendUrl', () => {
  it('targets the backend /api namespace', () => {
    expect(
      buildBackendUrl('http://backend:3001', ['health'], '?verbose=1'),
    ).toBe('http://backend:3001/api/health?verbose=1');
  });

  it('encodes path segments', () => {
    expect(buildBackendUrl('http://backend:3001/', ['items', 'a b'])).toBe(
      'http://backend:3001/api/items/a%20b',
    );
  });
});
