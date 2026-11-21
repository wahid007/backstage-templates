import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildHealthPayload } from './health';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('buildHealthPayload', () => {
  it('returns an ok payload with a deterministic timestamp', () => {
    const payload = buildHealthPayload(
      'demo-service',
      new Date('2025-01-02T03:04:05.000Z'),
    );

    expect(payload).toEqual({
      status: 'ok',
      service: 'demo-service',
      version: 'dev',
      timestamp: '2025-01-02T03:04:05.000Z',
    });
  });

  it('uses APP_VERSION when it is set', () => {
    vi.stubEnv('APP_VERSION', '1.2.3');

    const payload = buildHealthPayload('demo-service', new Date(0));

    expect(payload.version).toBe('1.2.3');
  });
});
