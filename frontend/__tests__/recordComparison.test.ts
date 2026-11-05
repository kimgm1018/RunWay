import type { RecordComparison } from '../src/data/types';
import {
  comparisonLine,
  comparisonResult,
} from '../src/screens/run/recordComparison';

// S15P31E105-422: 4.2·4.5는 서버 기록 비교를 그대로 옮긴다(평균 페이스 근사 없음). 날짜는 한국시간 기준이다.
const result = (change: Partial<RecordComparison> = {}): RecordComparison => ({
  status: 'AVAILABLE',
  // 한국시간 10월 21일 오전 8시
  targetStartedAt: '2026-10-20T23:00:00Z',
  distanceM: 1000,
  currentElapsedSec: 280,
  pastElapsedSec: 300,
  ...change,
});

test('no comparison chosen shows nothing', () => {
  expect(comparisonLine(null)).toBeNull();
  expect(comparisonLine(undefined)).toBeNull();
  expect(comparisonResult(null)).toBeNull();
});

test('ahead, behind and even come from the server times only', () => {
  expect(comparisonLine(result())).toEqual({ label: '10.21 기록보다', text: '20초 앞서는 중' });
  expect(comparisonLine(result({ currentElapsedSec: 375 }))).toEqual({
    label: '10.21 기록보다',
    text: '1분 15초 뒤처지는 중',
  });
  expect(comparisonLine(result({ currentElapsedSec: 300 }))?.text).toBe('같은 속도');
});

test('waiting, no record and unavailable reuse the plain states', () => {
  expect(comparisonLine(result({ status: 'WAITING', distanceM: null, currentElapsedSec: null, pastElapsedSec: null }))).toEqual({
    label: '10.21 기록과',
    text: '비교 준비 중',
  });
  expect(comparisonLine(result({ status: 'WAITING', targetStartedAt: null }))?.label).toBe('지난 기록과');
  expect(comparisonLine(result({ status: 'NO_RECORD', currentElapsedSec: null, pastElapsedSec: null }))?.text).toBe(
    '거리 기록이 없어요',
  );
  expect(comparisonLine(result({ status: 'UNAVAILABLE', targetStartedAt: null }))).toEqual({
    label: '비교 기록을',
    text: '볼 수 없어 멈췄어요',
  });
});

test('the result line is shown only for an available comparison', () => {
  expect(comparisonResult(result())).toBe('1.0km 지점에서 10.21 기록보다 20초 빨랐어요');
  expect(comparisonResult(result({ distanceM: 4830, currentElapsedSec: 330 }))).toBe(
    '4.8km 지점에서 10.21 기록보다 30초 느렸어요',
  );
  expect(comparisonResult(result({ currentElapsedSec: 300 }))).toBe('1.0km 지점에서 10.21 기록과 같았어요');
  expect(comparisonResult(result({ status: 'UNAVAILABLE' }))).toBeNull();
});
