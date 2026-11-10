import {
  coachingSentence,
  spokenPace,
  type CoachingLevel,
} from '../src/screens/run/coachingVoice';

// S15P31E105-579: Jira 본문의 문장 표(AI04 담당 결정, 2026-11-09)를 그대로 고정한다.

const guide = (paceSecPerKm: number, level: CoachingLevel | null) => ({
  paceSecPerKm,
  level,
});

test('pace reads as minutes, adding seconds only when it is not on the minute', () => {
  expect(spokenPace(360)).toBe('6분 페이스');
  expect(spokenPace(390)).toBe('6분 30초 페이스');
  expect(spokenPace(305)).toBe('5분 5초 페이스');
  // 소수 페이스는 초 단위로 반올림한다.
  expect(spokenPace(369.6)).toBe('6분 10초 페이스');
  expect(spokenPace(359.6)).toBe('6분 페이스');
});

test.each([
  // [단계, 직전 단계, 직전 페이스, 새 페이스, 문장]
  ['DANGER', 'CAUTION', 360, 390, '심박이 너무 높아요. 6분 30초 페이스로 늦춰 주세요.'],
  ['DANGER', 'CAUTION', 360, 360, '심박이 너무 높아요. 6분 페이스로 늦춰 주세요.'],
  ['DANGER', 'CAUTION', 380, 360, '심박이 너무 높아요. 6분 페이스로 늦춰 주세요.'],
  ['CAUTION', 'OK', 360, 370, '심박이 오르고 있어요. 6분 10초 페이스로 늦춰 주세요.'],
  ['CAUTION', 'OK', 360, 360, '조금 빨라요. 6분 페이스로 맞춰 주세요.'],
  ['CAUTION', 'CAUTION', 360, 340, '5분 40초 페이스로 올려 주세요.'],
  ['OK', 'OK', 360, 340, '여유가 있어요. 5분 40초 페이스로 올려도 좋아요.'],
  ['OK', 'OK', 360, 370, '6분 10초 페이스로 조절해 주세요.'],
  ['OK', 'CAUTION', 360, 360, '좋아요. 지금 페이스를 유지하세요.'],
  ['OK', 'DANGER', 390, 390, '좋아요. 지금 페이스를 유지하세요.'],
] as const)(
  '%s after %s, %i → %i s/km reads the table sentence',
  (level, previousLevel, previousPace, nextPace, sentence) => {
    expect(
      coachingSentence(
        guide(nextPace, level),
        guide(previousPace, previousLevel),
      ),
    ).toBe(sentence);
  },
);

test('a pace change under 5 s/km counts as the same pace', () => {
  // 4초 느려짐은 같음: CAUTION/같음 문장.
  expect(coachingSentence(guide(364, 'CAUTION'), guide(360, 'OK'))).toBe(
    '조금 빨라요. 6분 4초 페이스로 맞춰 주세요.',
  );
  // 정확히 5초면 느려짐.
  expect(coachingSentence(guide(365, 'CAUTION'), guide(360, 'OK'))).toBe(
    '심박이 오르고 있어요. 6분 5초 페이스로 늦춰 주세요.',
  );
  expect(coachingSentence(guide(355, 'OK'), guide(360, 'OK'))).toBe(
    '여유가 있어요. 5분 55초 페이스로 올려도 좋아요.',
  );
});

test('the first guide after the start is not read', () => {
  expect(coachingSentence(guide(360, 'DANGER'), null)).toBeNull();
  expect(coachingSentence(guide(360, 'OK'), null)).toBeNull();
});

test('an unchanged reminder is read again only at DANGER', () => {
  // 백엔드 2분 재안내: 페이스·단계가 그대로다.
  expect(coachingSentence(guide(390, 'DANGER'), guide(390, 'DANGER'))).toBe(
    '심박이 너무 높아요. 6분 30초 페이스로 늦춰 주세요.',
  );
  expect(coachingSentence(guide(360, 'CAUTION'), guide(360, 'CAUTION'))).toBeNull();
  expect(coachingSentence(guide(360, 'OK'), guide(360, 'OK'))).toBeNull();
});

test('a missing level counts as OK', () => {
  expect(coachingSentence(guide(340, null), guide(360, null))).toBe(
    '여유가 있어요. 5분 40초 페이스로 올려도 좋아요.',
  );
  expect(coachingSentence(guide(360, null), guide(360, null))).toBeNull();
  // 직전이 CAUTION이고 이번 단계가 비어 있으면 OK/같음: 유지 안내.
  expect(coachingSentence(guide(360, null), guide(360, 'CAUTION'))).toBe(
    '좋아요. 지금 페이스를 유지하세요.',
  );
});

test('an unusable pace is not read', () => {
  expect(coachingSentence(guide(0, 'DANGER'), guide(360, 'OK'))).toBeNull();
  expect(coachingSentence(guide(Number.NaN, 'DANGER'), guide(360, 'OK'))).toBeNull();
  expect(coachingSentence(guide(360, 'DANGER'), guide(-1, 'OK'))).toBeNull();
});
