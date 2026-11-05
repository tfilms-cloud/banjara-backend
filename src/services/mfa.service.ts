import crypto from 'crypto';
import { User, type IUser } from '../models/User';
import { AppError } from '../utils/AppError';
import { comparePassword } from '../utils/password';
import { open, seal } from '../utils/secretBox';
import { generateTotpSecret, matchTotp, otpauthUrl } from '../utils/totp';
import { recordAdminEvent } from './audit.service';

const RECOVERY_CODE_COUNT = 10;
const MFA_FIELDS = '+twoFactor.secret +twoFactor.pendingSecret +twoFactor.recoveryCodes +twoFactor.lastUsedStep';

function hashCode(code: string) {
  return crypto.createHash('sha256').update(code.replace(/[\s-]/g, '').toUpperCase()).digest('hex');
}

/** Ten codes like `7KQ2-M9XD`, each usable once if the phone is lost. */
function newRecoveryCodes() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const bytes = crypto.randomBytes(8);
    const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
    return `${chars.slice(0, 4)}-${chars.slice(4)}`;
  });
}

async function loadWithSecrets(userId: string) {
  const user = await User.findById(userId).select(MFA_FIELDS);
  if (!user) throw new AppError('User not found', 404);
  return user;
}

export async function status(userId: string) {
  const user = await loadWithSecrets(userId);
  return {
    enabled: Boolean(user.twoFactor?.enabled),
    enabledAt: user.twoFactor?.enabledAt ?? null,
    recoveryCodesLeft: user.twoFactor?.enabled ? user.twoFactor.recoveryCodes?.length ?? 0 : 0,
  };
}

/** Starts setup: a new secret the user adds to their authenticator app. */
export async function beginSetup(userId: string) {
  const user = await loadWithSecrets(userId);
  if (user.twoFactor?.enabled) throw new AppError('2-step verification is already on', 409);
  const secret = generateTotpSecret();
  await User.updateOne({ _id: user._id }, { $set: { 'twoFactor.pendingSecret': seal(secret) } });
  return { secret, otpauthUrl: otpauthUrl(secret, user.email) };
}

/** Confirms setup with a first code, turns it on and returns one-time recovery codes. */
export async function enable(userId: string, code: string, meta?: Record<string, unknown>) {
  const user = await loadWithSecrets(userId);
  if (user.twoFactor?.enabled) throw new AppError('2-step verification is already on', 409);
  const pending = user.twoFactor?.pendingSecret;
  if (!pending) throw new AppError('Start setup first', 400);
  const secret = open(pending);
  const step = matchTotp(secret, code);
  if (step === null) throw new AppError('That code is not right. Check the time on your phone and try again.', 400);

  const recoveryCodes = newRecoveryCodes();
  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        'twoFactor.enabled': true,
        'twoFactor.secret': seal(secret),
        'twoFactor.recoveryCodes': recoveryCodes.map(hashCode),
        'twoFactor.lastUsedStep': step,
        'twoFactor.enabledAt': new Date(),
      },
      $unset: { 'twoFactor.pendingSecret': 1 },
    }
  );
  await recordAdminEvent(user, 'auth.2fa.enabled', meta);
  return { recoveryCodes };
}

/** Turns it off; needs the password and a current code (or a recovery code). */
export async function disable(userId: string, password: string, code: string, meta?: Record<string, unknown>) {
  const user = await User.findById(userId).select(`+passwordHash ${MFA_FIELDS}`);
  if (!user) throw new AppError('User not found', 404);
  if (!user.twoFactor?.enabled) throw new AppError('2-step verification is not on', 400);
  if (!(await comparePassword(password, user.passwordHash))) throw new AppError('Password is incorrect', 400);
  if (!(await verifyCode(user, code))) throw new AppError('That code is not right', 400);
  await User.updateOne(
    { _id: user._id },
    {
      $set: { 'twoFactor.enabled': false },
      $unset: {
        'twoFactor.secret': 1,
        'twoFactor.pendingSecret': 1,
        'twoFactor.recoveryCodes': 1,
        'twoFactor.lastUsedStep': 1,
        'twoFactor.enabledAt': 1,
      },
    }
  );
  await recordAdminEvent(user, 'auth.2fa.disabled', meta);
  return { enabled: false };
}

/**
 * Checks a sign-in code: a TOTP code (each one usable once) or a recovery code
 * (removed when used). `user` must be loaded with the 2-step fields.
 */
export async function verifyCode(user: IUser, code: string): Promise<boolean> {
  const tf = user.twoFactor;
  if (!tf?.enabled || !tf.secret) return false;
  const trimmed = code.trim();

  if (/^\d{3}\s?\d{3}$/.test(trimmed)) {
    const step = matchTotp(open(tf.secret), trimmed);
    if (step === null || (tf.lastUsedStep !== undefined && step <= tf.lastUsedStep)) return false;
    // Conditional update: two requests racing with the same code cannot both win.
    const res = await User.updateOne(
      {
        _id: user._id,
        $or: [{ 'twoFactor.lastUsedStep': { $lt: step } }, { 'twoFactor.lastUsedStep': { $exists: false } }],
      },
      { $set: { 'twoFactor.lastUsedStep': step } }
    );
    return res.modifiedCount === 1;
  }

  const hashed = hashCode(trimmed);
  if (!tf.recoveryCodes?.includes(hashed)) return false;
  const res = await User.updateOne(
    { _id: user._id, 'twoFactor.recoveryCodes': hashed },
    { $pull: { 'twoFactor.recoveryCodes': hashed } }
  );
  return res.modifiedCount === 1;
}

export { MFA_FIELDS };
