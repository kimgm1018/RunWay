import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import type { GroupPaceInfo } from '../src/data';
import { GroupPaceCard } from '../src/screens/group/GroupPaceCard';
import { ThemeProvider } from '../src/theme';

// S15P31E105-739: the detail card folds the start plan's km paces under a 'km별 보기 ▾' toggle.

const pace: GroupPaceInfo = {
  mode: 'TOGETHER',
  appliedSecPerKm: 380,
  aiSecPerKm: 380,
  goalSecPerKm: 360,
  basis: 'MEMBER',
  basisNickname: null,
  calculating: false,
  slowerThanGoalCount: 0,
  kmPaces: [370, 395, 380],
  kmDistanceM: 2500,
  startStrategy: { label: '초반 안정', expectedDurationSec: 955 },
};

function render(info: GroupPaceInfo, showKmPaces = true) {
  let screen!: TestRenderer.ReactTestRenderer;
  act(() => {
    screen = TestRenderer.create(
      <ThemeProvider>
        <GroupPaceCard
          pace={info}
          showKmPaces={showKmPaces}
          change={null}
          canChangeMode={false}
          busy={false}
          onChangeMode={() => {}}
        />
      </ThemeProvider>,
    );
  });
  return screen;
}

const text = (screen: TestRenderer.ReactTestRenderer) =>
  screen.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat()
    .filter(child => typeof child === 'string')
    .join('|');

const toggle = (screen: TestRenderer.ReactTestRenderer) =>
  screen.root.findAll(
    node =>
      typeof node.props.onPress === 'function' &&
      node.props.accessibilityLabel === 'km별 페이스 보기',
  )[0];

it('starts folded and opens the km paces on press', () => {
  const screen = render(pace);
  const button = toggle(screen);
  expect(button?.props.accessibilityState).toEqual({ expanded: false });
  expect(text(screen)).toContain('km별 보기 ▾');
  expect(text(screen)).not.toContain('2.5km');
  act(() => button!.props.onPress());
  expect(toggle(screen)?.props.accessibilityState).toEqual({ expanded: true });
  expect(text(screen)).toContain('km별 접기 ▴');
  expect(text(screen)).toContain('1km');
  expect(text(screen)).toContain('2.5km');
});

it('leaves km paces to the course map when requested', () => {
  expect(toggle(render(pace, false))).toBeUndefined();
});

it('has no toggle while calculating or without km paces', () => {
  expect(toggle(render({ ...pace, calculating: true }))).toBeUndefined();
  expect(
    toggle(render({ ...pace, kmPaces: [], kmDistanceM: 0 })),
  ).toBeUndefined();
});

// The waiting room uses the same toggle (KmPaceToggle): closed until pressed.
it('the shared toggle starts closed in the waiting room too', () => {
  const { KmPaceToggle } = require('../src/screens/run/KmPacePills');
  let screen!: TestRenderer.ReactTestRenderer;
  act(() => {
    screen = TestRenderer.create(
      <ThemeProvider>
        <KmPaceToggle paces={[360, 370]} distanceM={2000} color="#00C2A8" />
      </ThemeProvider>,
    );
  });
  expect(toggle(screen)?.props.accessibilityState).toEqual({ expanded: false });
  expect(text(screen)).not.toContain('2km');
  act(() => toggle(screen)!.props.onPress());
  expect(text(screen)).toContain('2km');
});

// The waiting room puts the course map over the pills: it shows and hides with them.
it('shows the map slot only while open', () => {
  const { KmPaceToggle } = require('../src/screens/run/KmPacePills');
  let screen!: TestRenderer.ReactTestRenderer;
  act(() => {
    screen = TestRenderer.create(
      <ThemeProvider>
        <KmPaceToggle
          paces={[360]}
          distanceM={1000}
          color="#00C2A8"
          map={<Text>코스 지도</Text>}
        />
      </ThemeProvider>,
    );
  });
  expect(text(screen)).not.toContain('코스 지도');
  act(() => toggle(screen)!.props.onPress());
  expect(text(screen)).toContain('코스 지도');
  act(() => toggle(screen)!.props.onPress());
  expect(text(screen)).not.toContain('코스 지도');
});

// The detail card reads AI 추천, then its km split.
it('puts the km toggle right under the AI row', () => {
  const screen = render(pace);
  const order = text(screen).split('|');
  expect(order.indexOf('km별 보기 ▾')).toBeGreaterThan(
    order.indexOf('AI 추천'),
  );
  expect(order.indexOf('km별 보기 ▾')).toBeLessThan(order.indexOf('목표'));
});

it('shows one pace when both ends of the comfortable range read the same', () => {
  const { rangeText } = require('../src/screens/group/WaitingRoomScreen');
  expect(rangeText([376, 376])).toBe('6′16″');
  expect(rangeText([370, 380])).toBe('6′10″ – 6′20″');
});
