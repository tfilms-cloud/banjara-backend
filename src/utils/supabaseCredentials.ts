export const STORAGE_UNAVAILABLE_MESSAGE =
  'Photo uploads are temporarily unavailable. Please try again later or contact support.';

/** Configuration diagnostics only; the Supabase server still verifies the key. Never returns a credential. */
export function supabaseCredentialIssue(projectUrl: string, credential: string): string | null {
  const url = projectUrl.trim();
  const key = credential.trim();
  if (!url || !key) return 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for uploads.';
  let project: URL;
  try { project = new URL(url); }
  catch { return 'SUPABASE_URL is not a valid project URL.'; }
  if (!['https:', 'http:'].includes(project.protocol)) return 'SUPABASE_URL must be an HTTP or HTTPS URL.';
  if (key.startsWith('sb_publishable_')) {
    return 'SUPABASE_SERVICE_ROLE_KEY contains a publishable key. Use a server-only sb_secret_ key or legacy service_role key from the same project.';
  }
  if (key.startsWith('sb_secret_') && key.length > 'sb_secret_'.length) return null;
  try {
    if (key.split('.').length !== 3) throw new Error('Invalid JWT shape');
    const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8')) as { role?: unknown; ref?: unknown };
    if (claims.role !== 'service_role') return 'SUPABASE_SERVICE_ROLE_KEY must use the service_role role; anon and user-session keys cannot perform server uploads.';
    if (project.hostname.endsWith('.supabase.co') && typeof claims.ref === 'string' && claims.ref !== project.hostname.split('.')[0]) {
      return 'SUPABASE_URL and the service_role key belong to different Supabase projects.';
    }
    return null;
  } catch {
    return 'SUPABASE_SERVICE_ROLE_KEY must be a valid server-only secret key or legacy service_role JWT.';
  }
}
