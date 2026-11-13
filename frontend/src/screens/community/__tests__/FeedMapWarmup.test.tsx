import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RunMap } from '../../../components/RunMap';
import type { LngLat } from '../../../geo';
import { FeedMapWarmup, resetFeedMapWarmup } from '../FeedMapWarmup';

const course: LngLat[] = [
  [129.06, 35.15],
  [129.07, 35.16],
];

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 24, left: 0, right: 0, bottom: 0 },
};

function warmup(found: Promise<LngLat[] | null> | null, stop = false) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <FeedMapWarmup course={found} stop={stop} />
    </SafeAreaProvider>
  );
}

let root: ReactTestRenderer;
function render(element: React.ReactElement) {
  act(() => {
    root = TestRenderer.create(element);
  });
  const current = root;
  return {
    rerender: (next: React.ReactElement) => act(() => current.update(next)),
    unmount: () => act(() => current.unmount()),
  };
}
const byTestId = (id: string) =>
  root.root.findAll(
    node => node.props.testID === id && typeof node.type === 'string',
  );
const screen = {
  queryByTestId: (id: string) => byTestId(id)[0] ?? null,
  getByTestId: (id: string) => {
    const found = byTestId(id);
    if (!found.length) {
      throw new Error(`no ${id}`);
    }
    return found[0];
  },
};

beforeEach(() => {
  jest.useFakeTimers();
  resetFeedMapWarmup();
});

afterEach(() => {
  jest.useRealTimers();
});

test('draws the first course once behind the tabs, then lets it go', async () => {
  render(warmup(Promise.resolve(course)));
  await act(async () => {});
  // The tab the app opens on draws first.
  expect(screen.queryByTestId('feed-map-warmup')).toBeNull();
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  expect(screen.getByTestId('feed-map-warmup')).toBeTruthy();
  expect(screen.getByTestId('naver-map')).toBeTruthy();
  // A map that never says it is shown is still let go.
  await act(async () => {
    jest.advanceTimersByTime(8000);
  });
  expect(screen.queryByTestId('feed-map-warmup')).toBeNull();
});

// S15P31E105-763: a SurfaceView map sits under the window and showed over the run start screen's map; the warm map
// draws in the window so the tab screen in front covers it.
test('the warm map draws in the window, under the tab screen in front', async () => {
  render(warmup(Promise.resolve(course)));
  await act(async () => {});
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  expect(root.root.findByType(RunMap).props.textureView).toBe(true);
});

test('opening 커뮤니티 lets the warm map go at once, and it is not drawn again', async () => {
  const found = Promise.resolve(course);
  const view = render(warmup(found));
  await act(async () => {});
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  expect(screen.getByTestId('feed-map-warmup')).toBeTruthy();
  view.rerender(warmup(found, true));
  expect(screen.queryByTestId('feed-map-warmup')).toBeNull();
  view.rerender(warmup(found, false));
  await act(async () => {
    jest.advanceTimersByTime(10_000);
  });
  expect(screen.queryByTestId('feed-map-warmup')).toBeNull();
});

test('nothing is drawn when the first posts share no course', async () => {
  render(warmup(Promise.resolve(null)));
  await act(async () => {
    jest.advanceTimersByTime(10_000);
  });
  expect(screen.queryByTestId('naver-map')).toBeNull();
});

test('signing in again in the same app run does not draw it again', async () => {
  const first = render(warmup(Promise.resolve(course)));
  await act(async () => {
    jest.advanceTimersByTime(9000);
  });
  first.unmount();
  render(warmup(Promise.resolve(course)));
  await act(async () => {
    jest.advanceTimersByTime(10_000);
  });
  expect(screen.queryByTestId('naver-map')).toBeNull();
});
