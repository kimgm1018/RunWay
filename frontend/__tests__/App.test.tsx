import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { HealthScreen } from '../src/screens/HealthScreen';
import type { HealthProvider } from '../src/health/types';
import { emptyResult } from '../src/health/catalog';
import { Text } from 'react-native';
// The first React Native render loads lazy host components on this Windows runner.
jest.setTimeout(15000);
const provider: HealthProvider = {
  platform: 'ios',
  checkAvailability: async () => 'available',
  requestReadAccess: async () => {},
  readMetric: async (metric, window) => ({
    ...emptyResult(metric, window, 'empty'),
    access: 'unobservable',
  }),
  openAccessSettings: async () => {},
  getDeviceInfo: async () => ({
    os: 'iOS',
    manufacturer: 'Apple',
    model: 'iPhone',
    version: '18',
  }),
};
test.each([23400000, null])(
  'Samsung sleep card displays provided duration or real score (%s)',
  async duration => {
    const ready: HealthProvider = {
      ...provider,
      platform: 'android',
      readMetric: async (metric, window) =>
        metric === 'sleep'
          ? {
              ...emptyResult(metric, window, 'ready'),
              summary: {
                value: duration,
                unit: 'ms',
                sleepScore: 84,
                note: '최근 수면 · 삼성 헬스 제공 시간',
              },
              records: [
                {
                  id: 'sleep',
                  metric,
                  startTime: window.start,
                  endTime: window.end,
                  source: { id: 'samsung', name: '삼성 헬스' },
                  reportedSleepMs: duration ?? undefined,
                  sleepScore: 84,
                  stages: [],
                },
              ],
            }
          : emptyResult(metric, window, 'empty'),
    };
    let screen: TestRenderer.ReactTestRenderer;
    await act(async () => {
      screen = TestRenderer.create(<HealthScreen provider={ready} />);
    });
    const rendered = JSON.stringify(screen!.toJSON());
    expect(rendered).toContain(duration === null ? '84점' : '6시간 30분');
    const card = screen!.root.findAll(
      node =>
        node.props.accessibilityLabel?.startsWith('수면,') &&
        typeof node.props.onPress === 'function',
    )[0];
    await act(async () => card.props.onPress());
    const detail = screen!.root
      .findAllByType(Text)
      .flatMap(node => [node.props.children].flat())
      .filter(child => typeof child === 'string')
      .join(' ');
    expect(detail).toContain('수면 점수');
    if (duration !== null) {
      expect(detail).toContain('6시간 30분');
    }
    await act(async () => screen!.unmount());
  },
);
test('iPhone screen exposes seven distinct metrics and read privacy without watch pairing', async () => {
  let screen: TestRenderer.ReactTestRenderer;
  await act(async () => {
    screen = TestRenderer.create(<HealthScreen provider={provider} />);
  });
  const rendered = JSON.stringify(screen!.toJSON());
  for (const text of [
    '최근 심박수',
    '안정 시 심박',
    'HRV',
    'SDNN',
    'Apple 건강',
    '읽기 허용 여부',
    '기록 없음',
  ]) {
    expect(rendered).toContain(text);
  }
  expect(rendered).not.toContain('워치 연결하기');
  await act(async () => screen!.unmount());
});
test('latest measurement source matches card value and details show original records', async () => {
  const ready: HealthProvider = {
    ...provider,
    readMetric: async (metric, window) =>
      metric === 'heartRate'
        ? {
            ...emptyResult(metric, window, 'ready'),
            summary: { value: 72, unit: 'bpm' },
            records: [
              {
                id: 'old',
                metric,
                startTime: '2026-10-20T00:00:00Z',
                endTime: '2026-10-20T00:00:00Z',
                source: { id: 'old.source', name: 'Older source' },
                value: 61,
                unit: 'bpm',
              },
              {
                id: 'new',
                metric,
                startTime: '2026-10-20T01:00:00Z',
                endTime: '2026-10-20T01:00:00Z',
                source: { id: 'new.source', name: 'Latest source' },
                value: 72,
                unit: 'bpm',
              },
            ],
          }
        : emptyResult(metric, window, 'empty'),
  };
  let screen: TestRenderer.ReactTestRenderer;
  await act(async () => {
    screen = TestRenderer.create(<HealthScreen provider={ready} />);
  });
  const card = screen!.root.findAll(
    node =>
      node.props.accessibilityLabel?.startsWith('최근 심박수,') &&
      typeof node.props.onPress === 'function',
  )[0];
  expect(
    card
      .findAllByType(Text)
      .flatMap(node => [node.props.children].flat())
      .filter(child => typeof child === 'string')
      .join(' '),
  ).toContain('Latest source');
  await act(async () => card.props.onPress());
  expect(
    screen!.root
      .findAllByType(Text)
      .flatMap(node => [node.props.children].flat())
      .filter(child => typeof child === 'string')
      .join(' '),
  ).toContain('new.source');
  await act(async () => screen!.unmount());
});

test('Android refresh reads all seven metrics and distinguishes direct aggregate from HC fallback', async () => {
  const readMetric = jest.fn<
    ReturnType<HealthProvider['readMetric']>,
    Parameters<HealthProvider['readMetric']>
  >(async (metric, window) => ({
    ...emptyResult(metric, window, metric === 'steps' ? 'ready' : 'empty'),
    readRoute: metric === 'steps' ? 'samsungDirect' : 'healthConnect',
    summary:
      metric === 'steps'
        ? { value: 0, unit: '걸음' }
        : { value: null, unit: '' },
    records:
      metric === 'steps'
        ? [
            {
              id: 'aggregate',
              metric,
              startTime: window.start,
              endTime: window.end,
              value: 0,
              unit: '걸음',
              aggregation: 'period',
              source: { id: 'com.sec.android.app.shealth', name: '삼성 헬스' },
            },
          ]
        : [],
  }));
  let screen: TestRenderer.ReactTestRenderer;
  await act(async () => {
    screen = TestRenderer.create(
      <HealthScreen
        provider={{
          ...provider,
          platform: 'android',
          readMetric,
          openSamsungSettings: async () => {},
        }}
      />,
    );
  });
  expect(readMetric).toHaveBeenCalledTimes(7);
  const text = JSON.stringify(screen!.toJSON());
  expect(text).toContain('삼성 헬스 직접 조회');
  expect(text).toContain('Health Connect 보완 조회');
  expect(text).toContain('선택 기간 집계');
  const refresh = screen!.root
    .findAll(
      node =>
        node.props.accessibilityRole === 'button' &&
        typeof node.props.onPress === 'function',
    )
    .find(node =>
      node
        .findAllByType(Text)
        .some(child => child.props.children === '다시 조회'),
    )!;
  await act(async () => refresh.props.onPress());
  expect(readMetric).toHaveBeenCalledTimes(14);
  expect(
    new Set(readMetric.mock.calls.slice(7).map(([metric]) => metric)).size,
  ).toBe(7);
  const weekly = screen!.root
    .findAll(
      node =>
        node.props.accessibilityRole === 'button' &&
        typeof node.props.onPress === 'function',
    )
    .find(node =>
      node
        .findAllByType(Text)
        .some(child => child.props.children === '최근 7일'),
    )!;
  await act(async () => weekly.props.onPress());
  const weeklyText = JSON.stringify(screen!.toJSON());
  expect(weeklyText).toContain('하루 평균 걸음수');
  expect(weeklyText).toContain('7/7일');
  expect(weeklyText).toContain('걸음/일');
  const stepsCard = screen!.root.findAll(
    node =>
      node.props.accessibilityLabel?.startsWith('걸음 수,') &&
      typeof node.props.onPress === 'function',
  )[0];
  await act(async () => stepsCard.props.onPress());
  expect(
    screen!.root
      .findAllByType(Text)
      .flatMap(node => [node.props.children].flat())
      .filter(child => typeof child === 'string')
      .join(' '),
  ).toContain('확인된 날의 합계');
  await act(async () => screen!.unmount());
});
