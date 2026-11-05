import { describe, expect, it } from 'vitest';
import { resolveApiBaseUrl } from '../../Banjara/utils/resolveApiUrl';

describe('Mobile development API networking', () => {
  const emulator = { platform: 'android', isDevice: false, development: true, metroHost: '127.0.0.1' };
  it('replaces stale LAN and loopback URLs on the Android emulator', () => {
    for (const envUrl of ['http://192.168.1.99:5000/api', 'http://localhost:5000/api', undefined]) {
      expect(resolveApiBaseUrl({ ...emulator, envUrl })).toBe('http://10.0.2.2:5000/api');
    }
  });
  it('uses Metro LAN discovery on a physical phone', () => {
    expect(resolveApiBaseUrl({ ...emulator, isDevice: true, metroHost: '192.168.1.10', envUrl: 'http://192.168.1.99:5000/api' })).toBe('http://192.168.1.10:5000/api');
  });
  it('preserves an explicitly configured public API on every device', () => {
    expect(resolveApiBaseUrl({ ...emulator, envUrl: 'https://api.example.com/api/' })).toBe('https://api.example.com/api');
  });
  it('does not rewrite release-build or browser configuration', () => {
    const envUrl = 'http://192.168.1.99:5000/api';
    expect(resolveApiBaseUrl({ ...emulator, development: false, envUrl })).toBe(envUrl);
    expect(resolveApiBaseUrl({ ...emulator, platform: 'web', envUrl })).toBe(envUrl);
  });
});
