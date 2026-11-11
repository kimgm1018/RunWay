import type { TodayCondition } from '../../../data';
import { neutralTitle, readinessGuide } from '../readinessGuide';

// S15P31E105-615 준비도 카드의 한 문장: the data's own judgment for today, or neutral. Values are synthetic.

const r02: TodayCondition = {
  date: '2026-11-10',
  syncedAt: null,
  readinessState: 'ready',
  readinessScore: 74,
  condition: null,
  sleepMinutes: 330,
  restingHeartRate: 66,
  readinessSummary: null,
  sleepLabel: null,
  restingHeartRateLabel: null,
  weeklyLoad: null,
  weeklyLoadLabel: null,
  aiAdvice: null,
  lastAssessedDate: '2026-11-10',
};

test('R02 judges nothing, so the sentence is neutral', () => {
  expect(readinessGuide(r02, { isToday: true })).toEqual({
    title: neutralTitle,
    description: '오늘 기록을 확인하고 달릴 강도를 정해 보세요.',
    action: null,
    judged: false,
  });
});

test('a judgment in the data for today leads, with its advice', () => {
  expect(
    readinessGuide(
      {
        ...r02,
        readinessSummary: '주의 · 오늘은 가볍게 달려보세요',
        aiAdvice: '오늘은 속도 목표보다 편하게 달리는 데 집중해 보세요.',
      },
      { isToday: true },
    ),
  ).toEqual({
    title: '오늘은 가볍게 달려보세요',
    description: null,
    action: '오늘은 속도 목표보다 편하게 달리는 데 집중해 보세요.',
    judged: true,
  });
});

test('another day’s score gives no sentence about today', () => {
  const guide = readinessGuide(
    { ...r02, readinessSummary: '양호 · 계획한 강도로 달려도 좋아요' },
    { isToday: false },
  );
  expect(guide.title).toBe(neutralTitle);
  expect(guide.description).toBe(
    '최근 기록을 확인하고 달릴 강도를 정해 보세요.',
  );
});

test('a state without a score says why, and a stale one names its day', () => {
  const none = { ...r02, readinessScore: null };
  expect(
    readinessGuide({ ...none, readinessState: 'collecting' }, { isToday: true })
      .description,
  ).toBe('데이터를 모으는 중이에요.');
  expect(
    readinessGuide(
      { ...none, readinessState: 'stale', lastAssessedDate: '2026-11-05' },
      { isToday: true },
    ).description,
  ).toBe('마지막 평가가 11월 5일이에요.');
  expect(
    readinessGuide(
      { ...none, readinessState: 'permissionDenied' },
      { isToday: true },
    ).description,
  ).toBe('건강 데이터 권한이 없어요.');
});

test('준비도 grade on top: five bands of 20 points (S15P31E105-657)', () => {
  const { gradeOf } = require('../ReadinessPanel');
  expect([100, 80, 79, 60, 59, 40, 39, 20, 19, 0].map(gradeOf)).toEqual([
    '준비도 최상',
    '준비도 최상',
    '준비도 양호',
    '준비도 양호',
    '준비도 보통',
    '준비도 보통',
    '준비도 낮음',
    '준비도 낮음',
    '휴식 권장',
    '휴식 권장',
  ]);
});

test('준비도 grade note: one line per band (S15P31E105-657)', () => {
  const { gradeNoteOf } = require('../ReadinessPanel');
  expect([80, 60, 40, 20, 0].map(gradeNoteOf)).toEqual([
    '몸 상태가 좋아요. 계획한 강도로 달려도 좋아요.',
    '평소처럼 달리기 좋은 상태예요.',
    '무리하지 말고 편한 페이스로 달려요.',
    '가볍게 짧게 달리는 걸 권해요.',
    '오늘은 쉬면서 회복하는 게 좋아요.',
  ]);
});
