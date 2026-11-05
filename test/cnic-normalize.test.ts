import { describe, expect, it } from 'vitest';
import {
  formatCNICDisplay,
  isDateExpired,
  maskCNIC,
  nameSimilarity,
  normalizeCNIC,
  normalizeDate,
  normalizeName,
} from '../src/utils/cnic/normalize';

describe('normalizeCNIC', () => {
  it('strips hyphens and spaces', () => {
    expect(normalizeCNIC('35202-1234567-1')).toBe('3520212345671');
    expect(normalizeCNIC('3520212345671')).toBe('3520212345671');
    expect(normalizeCNIC('35202 1234567 1')).toBe('3520212345671');
  });

  it('masks for logs', () => {
    expect(maskCNIC('35202-1234567-1')).toBe('35202******671');
    expect(formatCNICDisplay('3520212345671')).toBe('35202-1234567-1');
  });
});

describe('normalizeName', () => {
  it('collapses spaces and uppercases', () => {
    expect(normalizeName('Muhammad   Ali')).toBe('MUHAMMAD ALI');
    expect(normalizeName('MUHAMMAD ALI')).toBe('MUHAMMAD ALI');
    expect(normalizeName('  muhammad ali  ')).toBe('MUHAMMAD ALI');
  });

  it('scores similar OCR names highly', () => {
    expect(nameSimilarity('Muhammad Ali', 'MUHAMMAD ALI')).toBe(1);
    expect(nameSimilarity('Muhammad Ali', 'Muharnmad Ali')).toBeGreaterThan(0.7);
  });
});

describe('normalizeDate', () => {
  it('supports common CNIC formats', () => {
    expect(normalizeDate('15.08.2031')).toBe('2031-08-15');
    expect(normalizeDate('15-08-2031')).toBe('2031-08-15');
    expect(normalizeDate('15/08/2031')).toBe('2031-08-15');
    expect(normalizeDate('2031-08-15')).toBe('2031-08-15');
  });

  it('detects expiry', () => {
    expect(isDateExpired('01.01.2020', new Date('2024-01-01'))).toBe(true);
    expect(isDateExpired('01.01.2035', new Date('2024-01-01'))).toBe(false);
  });
});
