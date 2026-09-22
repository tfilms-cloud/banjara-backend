/**
 * Guards for destructive seed/clear scripts. Enforced in-process so an accidental run on
 * a production host cannot wipe the database.
 */
export function assertDestructiveSeedAllowed() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Refusing to run a destructive seed/clear in production. Use `npm run bootstrap` for an idempotent admin bootstrap.'
    );
  }
  const uri = process.env.MONGODB_URI ?? '';
  const isLocal = /(^|\/\/)(localhost|127\.0\.0\.1)([:/]|$)/i.test(uri);
  if (!isLocal && process.env.ALLOW_DESTRUCTIVE_SEED !== 'yes') {
    throw new Error(
      'Refusing to touch a non-local database. Set ALLOW_DESTRUCTIVE_SEED=yes to override.'
    );
  }
}
