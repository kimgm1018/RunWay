import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import type { TodayCondition } from '../src/data';
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

function texts(today: TodayCondition, phoneSleep?: PhoneSleep) {
  let screen!: TestRenderer.ReactTestRenderer;
  act(() => {
    screen = TestRenderer.create(
      <ReadinessPanel today={today} phoneSleep={phoneSleep} />,
    );
  });
  const all = screen.root
    .findAll(node => typeof node.props.children === 'string')
    .map(node => node.props.children as string);
  const buttons = screen.root
    .findAll(node => node.props.accessibilityRole === 'button' && node.props.onPress)
    .map(node => node.props.accessibilityLabel as string);
  return { all, buttons, screen };
}

describe('2.1 수면 부분 표시', () => {
  it('shows phone sleep with source and wake date when no score exists yet', () => {
    const { all, screen } = texts(base, granted(412));
    expect(all).toContain('6h 52m');
    expect(all).toContain('삼성 헬스 · 11월 9일');
    // The score stays unset: no mock or guessed value.
    expect(
      screen.root.findAll(node => node.props.accessibilityLabel === '준비도 없음').length,
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
      { ...base, readinessState: 'ready', readinessScore: 72, sleepMinutes: 401 },
      granted(380),
    );
    expect(all).toContain('6h 41m');
    expect(all).not.toContain('6h 20m');
    expect(all).not.toContain('삼성 헬스 · 11월 9일');
  });

  it('shows phone sleep next to a score made without sleep (리뷰 B-3)', () => {
    const { all, screen } = texts(
      { ...base, readinessState: 'ready', readinessScore: 72, sleepMinutes: null },
      granted(380),
    );
    expect(all).toContain('6h 20m');
    expect(all).toContain('삼성 헬스 · 11월 9일');
    expect(
      screen.root.findAll(node => node.props.accessibilityLabel === '준비도 72').length,
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
        .find(node => node.props.accessibilityLabel === '삼성 헬스 연결' && node.props.onPress)
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

  it('says why 안정 심박 and 주간 부하 are missing (실기기 E2E 사용자 결정)', () => {
    const collecting = texts(base, granted(400)).all;
    expect(collecting).toContain('준비도 계산 후 표시');
    expect(collecting).toContain('수집 전');

    const scoredWithoutWatch = texts(
      { ...base, readinessState: 'ready', readinessScore: 72, sleepMinutes: 401 },
      granted(400),
    ).all;
    expect(scoredWithoutWatch).toContain('오늘 워치 기록 없음');
    expect(scoredWithoutWatch).toContain('수집 전');

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
    expect(scored).toContain('58 bpm');
    expect(scored).not.toContain('오늘 워치 기록 없음');

    const noConsent = texts({ ...base, readinessState: 'permissionDenied' }).all;
    expect(noConsent).not.toContain('준비도 계산 후 표시');
    expect(noConsent).not.toContain('수집 전');
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
});
