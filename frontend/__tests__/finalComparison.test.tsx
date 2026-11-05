import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { createMockRepositories, DataProvider } from '../src/data';
import type { RecordComparison } from '../src/data/types';
import { useFinalComparison } from '../src/screens/run/recordComparison';

// S15P31E105-422: 4.5는 종료 뒤 S02를 한 번 다시 읽어 마지막 batch까지 반영한 비교를 쓴다.
const comparison = (change: Partial<RecordComparison> = {}): RecordComparison => ({
  status: 'AVAILABLE',
  targetStartedAt: '2026-10-20T23:00:00Z',
  distanceM: 4700,
  currentElapsedSec: 1500,
  pastElapsedSec: 1520,
  ...change,
});

function Probe({ sessionId, live }: { sessionId: string | null; live: RecordComparison | null }) {
  const value = useFinalComparison(sessionId, live);
  return <Text>{value ? String(value.distanceM) : 'none'}</Text>;
}

async function render(sessionId: string | null, live: RecordComparison | null, server: RecordComparison | null) {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const get = jest
    .spyOn(repositories.session, 'get')
    .mockResolvedValue({
      sessionId: '201',
      controlDeviceId: '101',
      relayDeviceId: '102',
      state: 'COMPLETED',
      stateVersion: 6,
      startedAt: null,
      endedAt: null,
      recordingMode: 'WATCH',
      pendingCommand: null,
      lastCommand: null,
      analysisStatus: 'READY',
      comparison: server,
    });
  let screen: TestRenderer.ReactTestRenderer;
  await act(async () => {
    screen = TestRenderer.create(
      <DataProvider repositories={repositories}>
        <Probe sessionId={sessionId} live={live} />
      </DataProvider>,
    );
  });
  const shown = screen!.root.findByType(Text).props.children;
  await act(async () => screen!.unmount());
  return { shown, get };
}

test('the result reads S02 once and uses the comparison saved after the last batch', async () => {
  const { shown, get } = await render('201', comparison(), comparison({ distanceM: 5000 }));
  expect(get).toHaveBeenCalledTimes(1);
  expect(get).toHaveBeenCalledWith('201');
  expect(shown).toBe('5000');
});

test('without a chosen record nothing is read', async () => {
  const { shown, get } = await render('201', null, comparison());
  expect(get).not.toHaveBeenCalled();
  expect(shown).toBe('none');
});

test('a failed read keeps the last value seen during the run', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  jest.spyOn(repositories.session, 'get').mockRejectedValue(new Error('offline'));
  let screen: TestRenderer.ReactTestRenderer;
  await act(async () => {
    screen = TestRenderer.create(
      <DataProvider repositories={repositories}>
        <Probe sessionId="201" live={comparison()} />
      </DataProvider>,
    );
  });
  expect(screen!.root.findByType(Text).props.children).toBe('4700');
  await act(async () => screen!.unmount());
});
