import { describe, expect, it, vi } from 'vitest';
import { supabaseCredentialIssue, STORAGE_UNAVAILABLE_MESSAGE } from '../src/utils/supabaseCredentials';

const project = 'https://banjara-test.supabase.co';
function jwt(role: string, ref = 'banjara-test') {
  return `header.${Buffer.from(JSON.stringify({ role, ref })).toString('base64url')}.signature`;
}

describe('Server upload credentials', () => {
  it('rejects publishable and anon keys with a secret-free diagnostic', () => {
    const key = 'sb_publishable_test-only-key';
    const issue = supabaseCredentialIssue(project, key);
    expect(issue).toMatch(/publishable key/);
    expect(issue).not.toContain(key);
    expect(supabaseCredentialIssue(project, jwt('anon'))).toMatch(/service_role/);
    expect(supabaseCredentialIssue(project, jwt('authenticated'))).toMatch(/service_role/);
  });

  it('accepts modern secret keys and matching legacy service_role keys', () => {
    expect(supabaseCredentialIssue(project, 'sb_secret_test-only-key')).toBeNull();
    expect(supabaseCredentialIssue(project, jwt('service_role'))).toBeNull();
    expect(supabaseCredentialIssue(` ${project} `, ` ${jwt('service_role')} `)).toBeNull();
  });

  it('rejects legacy keys from another project', () => {
    expect(supabaseCredentialIssue(project, jwt('service_role', 'other-project'))).toMatch(/different Supabase projects/);
  });

  it('reports missing and malformed configuration without including its value', () => {
    expect(supabaseCredentialIssue('', '')).toMatch(/required/);
    expect(supabaseCredentialIssue('invalid-url', 'sb_secret_test')).toMatch(/valid project URL/);
    expect(supabaseCredentialIssue(project, 'not-a-key')).toMatch(/server-only/);
    expect(supabaseCredentialIssue(project, 'a.malformed.c')).toMatch(/server-only/);
  });

  it('stops before calling the Storage API and returns a customer-friendly error', async () => {
    vi.resetModules();
    vi.doMock('../src/config/env', () => ({ env: { SUPABASE_URL: project, SUPABASE_SERVICE_ROLE_KEY: 'sb_publishable_test-only-key' } }));
    vi.doMock('../src/utils/logger', () => ({ logger: { error: vi.fn() } }));
    const createClient = vi.fn();
    vi.doMock('@supabase/supabase-js', () => ({ createClient }));
    try {
      const { getSupabase } = await import('../src/config/supabase');
      expect(getSupabase).toThrow(STORAGE_UNAVAILABLE_MESSAGE);
      expect(createClient).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock('../src/config/env');
      vi.doUnmock('../src/utils/logger');
      vi.doUnmock('@supabase/supabase-js');
      vi.resetModules();
    }
  });
});
