import { describe, expect, it } from 'vitest';
import { commissionFor, summarizeBalance } from '../src/services/driverBalance.service';

const now = new Date('2026-11-20T12:00:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 3600_000);
const limits = { maxDriverDue: 5000, maxDueDays: 7 };
const commission = (amount: number, days: number) => ({ kind: 'commission' as const, status: 'posted' as const, amount, createdAt: daysAgo(days) });
const payment = (amount: number, status: 'pending' | 'approved' | 'rejected', days = 0) => ({ kind: 'payment' as const, status, amount, createdAt: daysAgo(days) });

describe('City to City driver balance (pure)', () => {
  it('commission is 10% of the agreed fare, in whole rupees', () => {
    expect(commissionFor(22000, 10)).toBe(2200);
    expect(commissionFor(4205, 10)).toBe(421);
    expect(commissionFor(-5, 10)).toBe(0);
  });

  it('owes commission minus approved payments; pending and rejected payments do not count', () => {
    const s = summarizeBalance(
      [commission(2000, 3), commission(1500, 1), payment(1000, 'approved'), payment(500, 'pending'), payment(900, 'rejected')],
      limits,
      now
    );
    expect(s).toMatchObject({ owed: 2500, pendingPayments: 500, blocked: false, blockReason: null });
  });

  it('settles the oldest commission first, so dueSince is the oldest still unpaid', () => {
    const entries = [commission(2000, 6), commission(1500, 2), payment(2000, 'approved')];
    expect(summarizeBalance(entries, limits, now).dueSince).toEqual(daysAgo(2));
    // A partial payment leaves the oldest one open.
    expect(summarizeBalance([commission(2000, 6), commission(1500, 2), payment(1999, 'approved')], limits, now).dueSince).toEqual(daysAgo(6));
  });

  it('nothing owed: not blocked and no due date, even with an old fully-paid commission', () => {
    const s = summarizeBalance([commission(3000, 30), payment(3000, 'approved')], limits, now);
    expect(s).toMatchObject({ owed: 0, dueSince: null, blocked: false });
  });

  it('blocks above the limit (not at it)', () => {
    expect(summarizeBalance([commission(5000, 1)], limits, now).blocked).toBe(false);
    expect(summarizeBalance([commission(5001, 1)], limits, now)).toMatchObject({ blocked: true, blockReason: 'over_limit' });
  });

  it('blocks when the oldest unpaid commission is more than 7 days old', () => {
    expect(summarizeBalance([commission(100, 7)], limits, now).blocked).toBe(false);
    expect(summarizeBalance([commission(100, 8)], limits, now)).toMatchObject({ blocked: true, blockReason: 'overdue' });
    // Paying off the old one leaves only a recent one: not overdue.
    expect(summarizeBalance([commission(100, 8), commission(300, 1), payment(100, 'approved')], limits, now).blocked).toBe(false);
  });
});
