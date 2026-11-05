import { describe, expect, it } from 'vitest';
import {
  extractCnicFieldsFromText,
  fatherNameFromRegionText,
  reconcileExpiryWithIssue,
} from '../src/utils/cnic/extract';
import { matchCnicFields } from '../src/utils/cnic/match';
import { verifyFromOcrTextForTests } from '../src/services/cnicVerification.service';

/** Classic same-line OCR dump */
const SAMPLE_OCR = `
NAME
AHMED KHAN
Father's Name
MUHAMMAD ALI
Gender
M
Country of Stay
Pakistan
Identity Number
35202-1234567-1
Date of Birth
12.03.1990
Date of Issue
15.08.2021
Date of Expiry
15.08.2031
`;

/** NADRA-style layout (labels then values on following lines) — matches real card photos */
const NADRA_LAYOUT = `
PAKISTAN
National Identity Card
Name
Aurangzeb Khalil
Father Name
Afsar Jan
Gender
M
Country of Stay
Pakistan
Identity Number
71702-0344277-5
Date of Birth
13.06.2003
Date of Issue
27.03.2023
Date of Expiry
27.03.2033
`;

describe('extractCnicFieldsFromText', () => {
  it('extracts identity number, father name, and expiry (not DOB/issue)', () => {
    const fields = extractCnicFieldsFromText(SAMPLE_OCR);
    expect(fields.cnicNumber).toBe('3520212345671');
    expect(fields.fatherName).toBe('MUHAMMAD ALI');
    expect(fields.expiryDate).toBe('2031-08-15');
  });

  it('reads NADRA next-line Father Name / Identity Number / Expiry', () => {
    const fields = extractCnicFieldsFromText(NADRA_LAYOUT);
    expect(fields.cnicNumber).toBe('7170203442775');
    expect(fields.fatherName).toBe('AFSAR JAN');
    expect(fields.expiryDate).toBe('2033-03-27');
  });

  it('does not pick DOB when expiry label is present', () => {
    const fields = extractCnicFieldsFromText(NADRA_LAYOUT);
    expect(fields.expiryDate).not.toBe('2003-06-13');
    expect(fields.expiryDate).not.toBe('2023-03-27');
  });

  it('recovers CNIC digits with OCR letter confusions', () => {
    const fields = extractCnicFieldsFromText(`
      Identity Number
      7I7O2-O344277-S
      Father Name
      Afsar Jan
      Date of Expiry
      27.03.2033
    `);
    expect(fields.cnicNumber).toBe('7170203442775');
    expect(fields.fatherName).toBe('AFSAR JAN');
    expect(fields.expiryDate).toBe('2033-03-27');
  });

  it('picks latest date as expiry when label OCR fails', () => {
    const fields = extractCnicFieldsFromText(`
      Name Aurangzeb Khalil
      Father Name Afsar Jan
      13.06.2003
      27.03.2023
      27.03.2033
      71702-0344277-5
    `);
    expect(fields.cnicNumber).toBe('7170203442775');
    expect(fields.fatherName).toBe('AFSAR JAN');
    expect(fields.expiryDate).toBe('2033-03-27');
  });

  it('handles two-column OCR lines (Father Name | Identity Number)', () => {
    const fields = extractCnicFieldsFromText(`
Name
Aurangzeb Khalil
Father Name                                   Identity Number
Afsar Jan                                      71702-0344277-5
Gender                                          Date of Birth
M                                              13.06.2003
Date of Issue
27.03.2023
Date of Expiry
27.03.2033
`);
    expect(fields.cnicNumber).toBe('7170203442775');
    expect(fields.fatherName).toBe('AFSAR JAN');
    expect(fields.expiryDate).toBe('2033-03-27');
  });

  it('prefers real dashed CNIC over OCR letter-noise fake numbers', () => {
    const fields = extractCnicFieldsFromText(`
      noisy BB758 lOlSlll B patterns
      88758-1015111-1
      Identity Number
      71702-0344277-5
      Father Name
      Afsar Jan
      Date of Birth 13.06.2003
      Date of Issue 27.03.2023
      Date of Expiry 27.03.2033
    `);
    expect(fields.cnicNumber).toBe('7170203442775');
    expect(fields.fatherName).toBe('AFSAR JAN');
    expect(fields.expiryDate).toBe('2033-03-27');
  });

  it('rejects garbage father names like FORS AE', () => {
    const fields = extractCnicFieldsFromText(`
      Father Name
      FORS AE
      Identity Number
      71702-0344277-5
      13.06.2003
      27.03.2023
      27.03.2033
    `);
    expect(fields.fatherName).toBeNull();
    expect(fields.cnicNumber).toBe('7170203442775');
    expect(fields.expiryDate).toBe('2033-03-27');
  });

  it('finds father name by card layout when OCR misses the label', () => {
    const fields = extractCnicFieldsFromText(`
      PAKISTAN
      National Identity Card
      Name
      Aurangzeb Khalil
      Afsar Jan
      Gender
      M
      Identity Number
      71702-0344277-5
    `);
    expect(fields.fatherName).toBe('AFSAR JAN');
  });

  it('reads fuzzy OCR label "Fathe Nane"', () => {
    const fields = extractCnicFieldsFromText(`
      Fathe Nane
      Afsar Jan
    `);
    expect(fields.fatherName).toBe('AFSAR JAN');
  });

  it('takes expiry from two-column date row', () => {
    const fields = extractCnicFieldsFromText(`
      Date of Issue        Date of Expiry
      27.03.2023           27,03.2033
    `);
    expect(fields.expiryDate).toBe('2033-03-27');
  });

  it('rejects OCR soup names and impossible expiry years', () => {
    const fields = extractCnicFieldsFromText(`
      random latin noise without labels
      BSA SSORY PERC BY RAE
      7170203842775
      02.02.2318
      13.06.2003
      27.03.2023
      27.03.2033
    `);
    expect(fields.fatherName).toBeNull();
    expect(fields.expiryDate).toBe('2033-03-27');
    expect(fields.expiryDate).not.toBe('2318-02-02');
  });

  it('reads spaced / OCR-mangled expiry dates', () => {
    const fields = extractCnicFieldsFromText(`
      Identity Number 71702-0344277-5
      Father Name Afsar Jan
      Date of Expiry
      27 O3 2033
    `);
    expect(fields.expiryDate).toBe('2033-03-27');
  });

  it('reads CNIC with broken spacing and father on next line', () => {
    const fields = extractCnicFieldsFromText(`
      Name
      Aurangzeb Khalil
      Father Name
      Afsar Jan
      Gender M
      Identity Number
      71702 0344277 5
      Date of Birth 13.06.2003
      Date of Issue 27.03.2023
      Date of Expiry 27.03.2033
    `);
    expect(fields.cnicNumber).toBe('7170203442775');
    expect(fields.fatherName).toBe('AFSAR JAN');
    expect(fields.expiryDate).toBe('2033-03-27');
  });
});

describe('field-region helpers', () => {
  it('fixes a misread expiry day using the issue date', () => {
    expect(reconcileExpiryWithIssue(['2033-03-07'], ['2023-03-27'])).toBe('2033-03-27');
  });

  it('keeps expiry that agrees with the issue date', () => {
    expect(reconcileExpiryWithIssue(['2033-03-07', '2033-03-27'], ['2023-03-27'])).toBe(
      '2033-03-27'
    );
  });

  it('ignores a box border read as a leading digit in dates', () => {
    const fields = extractCnicFieldsFromText('Date of Expiry\n127.03.2033 =');
    expect(fields.expiryDate).toBe('2033-03-27');
  });

  it('reads father name from a tight Father Name crop', () => {
    expect(fatherNameFromRegionText('Father Name\nAfsar Jan\n')).toBe('AFSAR JAN');
    expect(fatherNameFromRegionText('Fathe Nane\n\nAfsar Jan')).toBe('AFSAR JAN');
  });
});

describe('matchCnicFields', () => {
  it('verifies when all fields match', () => {
    const result = verifyFromOcrTextForTests({
      cnicNumber: '71702-0344277-5',
      fatherName: 'Afsar Jan',
      expiryDate: '27.03.2033',
      ocrText: NADRA_LAYOUT,
    });
    expect(result.status).toBe('verified');
    expect(result.verified).toBe(true);
    expect(result.fields.cnicNumber.matched).toBe(true);
    expect(result.fields.fatherName.matched).toBe(true);
    expect(result.fields.expiryDate.matched).toBe(true);
  });

  it('fails on wrong CNIC', () => {
    const result = verifyFromOcrTextForTests({
      cnicNumber: '35202-9999999-9',
      fatherName: 'Muhammad Ali',
      expiryDate: '15.08.2031',
      ocrText: SAMPLE_OCR,
    });
    expect(result.status).toBe('failed');
    expect(result.fields.cnicNumber.matched).toBe(false);
  });

  it('fails on wrong father name', () => {
    const result = verifyFromOcrTextForTests({
      cnicNumber: '35202-1234567-1',
      fatherName: 'Completely Different',
      expiryDate: '15.08.2031',
      ocrText: SAMPLE_OCR,
    });
    expect(result.status).toBe('failed');
    expect(result.fields.fatherName.matched).toBe(false);
  });

  it('fails on wrong expiry', () => {
    const result = verifyFromOcrTextForTests({
      cnicNumber: '35202-1234567-1',
      fatherName: 'Muhammad Ali',
      expiryDate: '01.01.2030',
      ocrText: SAMPLE_OCR,
    });
    expect(result.status).toBe('failed');
    expect(result.fields.expiryDate.matched).toBe(false);
  });

  it('fails when CNIC is expired', () => {
    const expiredOcr = SAMPLE_OCR.replace('15.08.2031', '15.08.2018');
    const result = matchCnicFields({
      enteredCnic: '3520212345671',
      enteredFatherName: 'MUHAMMAD ALI',
      enteredExpiryDate: '2018-08-15',
      extracted: extractCnicFieldsFromText(expiredOcr),
    });
    expect(result.fields.expiryDate.expired).toBe(true);
    expect(result.status).toBe('failed');
  });

  it('requests manual review when OCR fields are missing', () => {
    const result = verifyFromOcrTextForTests({
      cnicNumber: '35202-1234567-1',
      fatherName: 'Muhammad Ali',
      expiryDate: '15.08.2031',
      ocrText: 'blurry unreadable card',
    });
    expect(result.status).toBe('manual_review');
  });
});
