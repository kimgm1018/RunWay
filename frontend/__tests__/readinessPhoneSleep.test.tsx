import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import {
  createMockRepositories,
  DataProvider,
  type TodayCondition,
} from '../src/data';
import {
  ReadinessPanel,
  type PhoneSleep,
} from '../src/screens/home/ReadinessPanel';

// S15P31E105-572 AC10: 2.1 shows today's Samsung Health sleep read on the phone when R02 has no score for today,
// with its source and wake date, never a mock value. All values are synthetic.

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, getParent: () => undefined }),
}));
jest.setTimeout(30000);

const base: TodayCondition = {
  date: '2026-11-09',
  syncedAt: null,
  readinessState: 'collecting',
  readinessScore: null,
  condition: null,
  sleepMinutes: null,
  restingHeartRate: null,
  readinessSummary: null,
  sleepLabel: null,
  restingHeartRateLabel: null,
  weeklyLoad: null,
  weeklyLoadLabel: null,
  aiAdvice: null,
  lastAssessedDate: null,
};

const granted = (minutes: number): PhoneSleep => ({
  access: 'granted',
  today: { status: 'ready', date: '2026-11-09', minutes },
  requesting: false,
  onConnect: jest.fn(),
});

// These checks are about sleep: the report's 최근 러닝 step waits, so nothing loads after a check has ended.
function withoutRuns() {
  const repositories = createMockRepositories({ latencyMs: 0 });
  repositories.records.getRecent = () => new Promise(() => undefined);
  return repositories;
}

// Each check's card is taken down when it ends, so nothing it still awaits renders after the test environment is gone.
const opened: TestRenderer.ReactTestRenderer[] = [];
afterEach(() => {
  act(() => {
    opened.splice(0).forEach(screen => screen.unmount());
  });
});

function texts(today: TodayCondition, phoneSleep?: PhoneSleep, watchReady = false) {
  let screen!: TestRenderer.ReactTestRenderer;
  act(() => {
    screen = TestRenderer.create(
      // The report's 어제 러닝 step reads runs, so the card sits in the app's data (S15P31E105-615).
      <DataProvider repositories={withoutRuns()}>
        <ReadinessPanel today={today} phoneSleep={phoneSleep} watchReady={watchReady} />
      </DataProvider>,
    );
  });
  opened.push(screen);
  const all = screen.root
    .findAll(node => typeof node.props.children === 'string')
    .map(node => node.props.children as string);
  const buttons = screen.root
    .findAll(
      node => node.props.accessibilityRole === 'button' && node.props.onPress,
    )
    .map(node => node.props.accessibilityLabel as string)
    // The card's own 러닝 시작하기 and the report's toggles (부하란?, 왜 N점인가요?, S15P31E105-594) are always
    // there; these checks are about the other one.
    .filter(
      label =>
        label !== '러닝 시작하기' &&
        label !== '부하란?' &&
        label !== '준비도에 들어가는 기록' &&
        !label.endsWith('점인가요?'),
    )
    .filter((label, index, labels) => labels.indexOf(label) === index);
  return { all, buttons, screen };
}

describe('2.1 수면 부분 표시', () => {
  it('shows phone sleep with source and wake date when no score exists yet', () => {
    const { all, screen } = texts(base, granted(412));
    expect(all).toContain('6h 52m');
    expect(all).toContain('삼성 헬스 · 11월 9일');
    // The score stays unset: no mock or guessed value.
    expect(
      screen.root.findAll(
        node => node.props.accessibilityLabel === '준비도 없음',
      ).length,
    ).toBeGreaterThan(0);
  });

  it('shows phone sleep on a stale score too, without the old score', () => {
    const { all } = texts(
      { ...base, readinessState: 'stale', lastAssessedDate: '2026-11-05' },
      granted(380),
    );
    expect(all).toContain('6h 20m');
    expect(all).toContain('삼성 헬스 · 11월 9일');
  });

  it('keeps the R02 value when today has a score', () => {
    const { all } = texts(
      {
        ...base,
        readinessState: 'ready',
        readinessScore: 72,
        sleepMinutes: 401,
      },
      granted(380),
    );
    expect(all).toContain('6h 41m');
    expect(all).not.toContain('6h 20m');
    expect(all).not.toContain('삼성 헬스 · 11월 9일');
  });

  it('shows phone sleep next to a score made without sleep (리뷰 B-3)', () => {
    const { all, screen } = texts(
      {
        ...base,
        readinessState: 'ready',
        readinessScore: 72,
        sleepMinutes: null,
      },
      granted(380),
    );
    expect(all).toContain('6h 20m');
    expect(all).toContain('삼성 헬스 · 11월 9일');
    expect(
      screen.root.findAll(node => node.props.accessibilityLabel === '준비도 72')
        .length,
    ).toBeGreaterThan(0);
  });

  it('shows nothing health-related without server health consent', () => {
    const { all, buttons } = texts(
      { ...base, readinessState: 'permissionDenied' },
      { ...granted(380), access: 'notRequested' },
    );
    expect(all).not.toContain('6h 20m');
    expect(buttons).toEqual(['설정 열기']);
  });

  it('asks for Samsung Health access instead of the watch button when sleep access is missing', () => {
    const onConnect = jest.fn();
    const sleep: PhoneSleep = {
      access: 'notRequested',
      today: { status: 'accessRequired' },
      requesting: false,
      onConnect,
    };
    const { buttons, screen } = texts(base, sleep);
    expect(buttons).toEqual(['삼성 헬스 연결']);
    act(() => {
      screen.root
        .find(
          node =>
            node.props.accessibilityLabel === '삼성 헬스 연결' &&
            node.props.onPress,
        )
        .props.onPress();
    });
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['denied', { status: 'accessRequired' }, '삼성 헬스 권한 거부됨'],
    ['revoked', { status: 'accessRequired' }, '삼성 헬스 권한 해제됨'],
    ['granted', { status: 'empty' }, '삼성 헬스 기록 없음'],
    ['granted', { status: 'unresolved' }, '삼성 헬스 수면 시간 미확인'],
    ['granted', { status: 'error' }, '삼성 헬스 조회 실패'],
  ] as const)('tells %s / %j apart', (access, today, note) => {
    const { all } = texts(base, {
      access,
      today,
      requesting: false,
      onConnect: jest.fn(),
    });
    expect(all).toContain(note);
    expect(all).toContain('– –');
  });

  it('shows an older night with its own wake date when today has none', () => {
    const { all } = texts(base, {
      ...granted(294),
      today: { status: 'ready', date: '2026-11-06', minutes: 294 },
    });
    expect(all).toContain('4h 54m');
    expect(all).toContain('삼성 헬스 · 11월 6일');
  });

  it('says why 안정 시 심박수 and 최근 운동량 are missing (실기기 E2E 사용자 결정)', () => {
    const collecting = texts(base, granted(400)).all;
    expect(collecting).toContain('준비도 계산 후 표시');
    expect(collecting).toContain('수집 전');

    const scoredWithoutWatch = texts(
      {
        ...base,
        readinessState: 'ready',
        readinessScore: 72,
        sleepMinutes: 401,
      },
      granted(400),
    ).all;
    expect(scoredWithoutWatch).toContain('오늘 워치 기록 없음');
    // S15P31E105-599: a score for today without training load means no exercise with heart rate in 4 weeks.
    expect(scoredWithoutWatch).toContain('최근 4주 심박 기록 운동 없음');
    expect(scoredWithoutWatch).not.toContain('수집 전');

    const scored = texts(
      {
        ...base,
        readinessState: 'ready',
        readinessScore: 72,
        sleepMinutes: 401,
        restingHeartRate: 58,
      },
      granted(400),
    ).all;
    expect(scored).toContain('58회/분');
    expect(scored).not.toContain('오늘 워치 기록 없음');

    const noConsent = texts({
      ...base,
      readinessState: 'permissionDenied',
    }).all;
    expect(noConsent).not.toContain('준비도 계산 후 표시');
    expect(noConsent).not.toContain('수집 전');
    expect(noConsent).not.toContain('최근 4주 심박 기록 운동 없음');
  });

  // S15P31E105-599 (T-9): R02's weekly training load with its band; a stale score's load is not today's.
  it('shows the weekly training load with its band, only for a score of today', () => {
    const loaded = {
      ...base,
      readinessState: 'ready' as const,
      readinessScore: 72,
      weeklyLoad: '312',
      weeklyLoadLabel: '평소보다 많음',
    };
    const scored = texts(loaded).all;
    // One plain line under 최근 운동량 (S15P31E105-615): the value and how it compares with usual.
    expect(scored).toContain('312 · 평소보다 많음');
    expect(scored).not.toContain('최근 4주 심박 기록 운동 없음');

    const stale = texts({
      ...loaded,
      readinessState: 'stale',
      lastAssessedDate: '2026-11-05',
    }).all;
    expect(stale).not.toContain('312 · 평소보다 많음');
    expect(stale).not.toContain('최근 4주 심박 기록 운동 없음');
    expect(stale).toContain('수집 전');
  });

  it('asks for exercise access when it is missing and there is no weekly load', () => {
    const scored = { ...base, readinessState: 'ready' as const, readinessScore: 72, sleepMinutes: 401, restingHeartRate: 58 };
    const missing = texts(scored, { ...granted(400), heartAccess: 'granted', exerciseAccess: 'denied' });
    expect(missing.buttons).toEqual(['삼성 헬스 연결']);
    expect(missing.all).toContain('삼성 헬스 권한 거부됨');
    expect(missing.all).not.toContain('최근 4주 심박 기록 운동 없음');

    const loaded = texts(
      { ...scored, weeklyLoad: '200', weeklyLoadLabel: '평소와 비슷' },
      { ...granted(400), heartAccess: 'granted', exerciseAccess: 'notRequested' },
    );
    expect(loaded.buttons).toEqual([]);
    expect(loaded.all).toContain('200 · 평소와 비슷');
  });

  it('keeps the watch button when sleep is granted or Samsung Health is unavailable', () => {
    expect(texts(base, granted(400)).buttons).toEqual(['워치 동기화']);
    expect(
      texts(base, {
        access: 'unavailable',
        today: { status: 'unavailable' },
        requesting: false,
        onConnect: jest.fn(),
      }).buttons,
    ).toEqual(['워치 동기화']);
  });

  it.each(['collecting', 'stale', 'watchDisconnected'] as const)('hides the watch action after actual readiness is confirmed, even when R02 is %s', readinessState => {
    const today = { ...base, readinessState };
    const confirmed = texts(today, undefined, true);
    expect(confirmed.buttons).toEqual([]);
    expect(confirmed.all).not.toContain('연결된 워치가 없어요');
    expect(texts(today, undefined, false).buttons).toHaveLength(1);
  });

  it('keeps health consent and Samsung Health actions when the watch is ready', () => {
    expect(texts({ ...base, readinessState: 'permissionDenied' }, undefined, true).buttons).toEqual(['설정 열기']);
    expect(texts(base, { ...granted(400), access: 'notRequested', today: { status: 'accessRequired' } }, true).buttons).toEqual(['삼성 헬스 연결']);
  });
});

// S15P31E105-600 AC-6 (D-9): 안정 심박 shows R02's value with its source, then today's value computed on the phone from
// Samsung Health heart rate, then why there is none.
describe('2.1 안정 심박 출처·사유', () => {
  const heart = (
    heartAccess: PhoneSleep['heartAccess'],
    restingHr: PhoneSleep['restingHr'],
  ): PhoneSleep => ({ ...granted(400), heartAccess, restingHr });
  const scored = { ...base, readinessState: 'ready' as const, readinessScore: 72, sleepMinutes: 401 };

  it('shows the R02 value with its source label and not the phone value', () => {
    const { all } = texts(
      { ...scored, restingHeartRate: 58, restingHeartRateLabel: '삼성 헬스' },
      heart('granted', { status: 'ready', date: '2026-11-09', bpm: 51.6 }),
    );
    expect(all).toContain('58회/분');
    expect(all).toContain('삼성 헬스');
    expect(all).not.toContain('52회/분');
    expect(all).not.toContain('삼성 헬스 · 오늘');

    const watch = texts(
      { ...scored, restingHeartRate: 58, restingHeartRateLabel: 'RunWay 워치' },
      heart('granted', { status: 'ready', date: '2026-11-09', bpm: 51.6 }),
    ).all;
    expect(watch).toContain('RunWay 워치');
  });

  it("shows today's phone value with its source when R02 has none (no score, or a score without it)", () => {
    const phone = heart('granted', { status: 'ready', date: '2026-11-09', bpm: 51.6 });
    for (const today of [base, scored, { ...base, readinessState: 'stale' as const }]) {
      const { all } = texts(today, phone);
      expect(all).toContain('52회/분');
      expect(all).toContain('삼성 헬스 · 오늘');
    }
  });

  it.each([
    ['denied', { status: 'accessRequired' }, '삼성 헬스 권한 거부됨'],
    ['revoked', { status: 'accessRequired' }, '삼성 헬스 권한 해제됨'],
    ['granted', { status: 'insufficient' }, '오늘 심박 기록 부족'],
    ['granted', { status: 'error' }, '삼성 헬스 조회 실패'],
  ] as const)('tells %s / %j apart under 안정 심박', (access, restingHr, note) => {
    const { all } = texts(scored, heart(access, restingHr));
    expect(all).toContain(note);
    expect(all).not.toContain('오늘 워치 기록 없음');
  });

  it("does not call a value read before midnight today's (리뷰 B-1)", () => {
    let screen!: TestRenderer.ReactTestRenderer;
    act(() => {
      screen = TestRenderer.create(
        <DataProvider repositories={withoutRuns()}>
          <ReadinessPanel
            today={{ ...scored, date: '2026-11-10' }}
            todayDay="2026-11-10"
            phoneSleep={heart('granted', { status: 'ready', date: '2026-11-09', bpm: 51.6 })}
          />
        </DataProvider>,
      );
    });
    opened.push(screen);
    const all = screen.root
      .findAll(node => typeof node.props.children === 'string')
      .map(node => node.props.children as string);
    expect(all).not.toContain('52회/분');
    expect(all).not.toContain('삼성 헬스 · 오늘');
  });

  it.each([
    [{ status: 'accessRequired' }, '삼성 헬스 권한 확인 필요'],
    [{ status: 'unavailable' }, '삼성 헬스 사용 불가'],
  ] as const)('tells a refused read %j apart even with access granted (리뷰 B-4)', (restingHr, note) => {
    const { all } = texts(scored, heart('granted', restingHr));
    expect(all).toContain(note);
    expect(all).not.toContain('오늘 워치 기록 없음');
  });

  it('keeps the watch note when heart rate was never asked or Samsung Health is unavailable', () => {
    expect(texts(scored, heart('notRequested', { status: 'accessRequired' })).all).toContain('오늘 워치 기록 없음');
    expect(texts(scored, heart('unavailable', { status: 'unavailable' })).all).toContain('오늘 워치 기록 없음');
  });

  it('asks for Samsung Health access when heart rate access is missing even with sleep granted', () => {
    expect(texts(scored, heart('notRequested', { status: 'accessRequired' })).buttons).toEqual(['삼성 헬스 연결']);
    expect(
      texts(
        { ...scored, restingHeartRate: 58, restingHeartRateLabel: 'RunWay 워치' },
        heart('notRequested', { status: 'accessRequired' }),
      ).buttons,
    ).not.toContain('삼성 헬스 연결');
  });

  it('shows no phone resting heart rate without server health consent', () => {
    const { all } = texts(
      { ...base, readinessState: 'permissionDenied' },
      heart('granted', { status: 'ready', date: '2026-11-09', bpm: 51.6 }),
    );
    expect(all).not.toContain('52회/분');
    expect(all).not.toContain('삼성 헬스 · 오늘');
  });
});
