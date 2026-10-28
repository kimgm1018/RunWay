import {
  daysInMonth,
  formatClock,
  formatPace,
  formatPhoneNumber,
  isValidLoginId,
  isValidNickname,
  isValidPassword,
  isValidPhoneNumber,
  parseClock,
  parseDistanceKm,
  passwordChecks,
  toBirthDate,
} from '../src/screens/onboarding/validation';

test('login IDs take 4–16 letters or digits only', () => {
  expect(isValidLoginId('minjun01')).toBe(true);
  expect(isValidLoginId('abc')).toBe(false);
  expect(isValidLoginId('a'.repeat(17))).toBe(false);
  expect(isValidLoginId('minjun_run')).toBe(false);
  expect(isValidLoginId('민준1234')).toBe(false);
});

test('passwords need 8 characters with a letter and a digit', () => {
  expect(passwordChecks('abc')).toEqual({
    length: false,
    letter: true,
    digit: false,
  });
  expect(isValidPassword('runway123')).toBe(true);
  expect(isValidPassword('12345678')).toBe(false);
  expect(isValidPassword('runwayrun')).toBe(false);
});

test('phone numbers are Korean mobile numbers shown with dashes', () => {
  expect(isValidPhoneNumber('01024835917')).toBe(true);
  expect(isValidPhoneNumber('0102483591')).toBe(true);
  expect(isValidPhoneNumber('0212345678')).toBe(false);
  expect(formatPhoneNumber('01024835917')).toBe('010-2483-5917');
  expect(formatPhoneNumber('0102483591')).toBe('010-248-3591');
  expect(formatPhoneNumber('0102')).toBe('010-2');
});

test('nicknames are 2–10 characters', () => {
  expect(isValidNickname('민')).toBe(false);
  expect(isValidNickname('민준')).toBe(true);
  expect(isValidNickname('가'.repeat(11))).toBe(false);
});

test('birth dates respect month length and leap years', () => {
  expect(daysInMonth(2000, 2)).toBe(29);
  expect(daysInMonth(1991, 2)).toBe(28);
  expect(toBirthDate(1991, 3, 4)).toBe('1991-03-04');
});

test('finish time and pace convert both ways', () => {
  expect(parseClock('30:00')).toBe(1800);
  expect(parseClock('1:05:30')).toBe(3930);
  expect(parseClock('30:75')).toBeNull();
  expect(parseClock('30')).toBeNull();
  expect(parseDistanceKm('5')).toBe(5);
  expect(parseDistanceKm('10.55')).toBe(10.55);
  expect(parseDistanceKm('0')).toBeNull();
  expect(formatPace(1800 / 5)).toBe('6′00″/km');
  expect(formatClock(3930)).toBe('1:05:30');
  expect(formatClock(1800)).toBe('30:00');
});
