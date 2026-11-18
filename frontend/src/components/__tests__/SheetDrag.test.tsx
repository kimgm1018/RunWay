import React from 'react';
import { Animated, PanResponder, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TestRenderer, { act } from 'react-test-renderer';
import { BottomSheet } from '../BottomSheet';
import {
  claimsSheetDrag,
  clampSheetDrag,
  commitsSheetDrag,
  useSheetDrag,
  type SheetDragDirection,
} from '../SheetDrag';

// 시트 드래그 (S15P31E105-899): bottom sheets close when dragged down, and a card folded to its title opens when
// dragged up, while taps, sideways rulers and short drags keep what they did.

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const mounted: TestRenderer.ReactTestRenderer[] = [];

function mount(element: React.ReactElement) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  mounted.push(renderer);
  return renderer;
}

afterEach(() => {
  act(() => {
    mounted.splice(0).forEach(renderer => renderer.unmount());
  });
  jest.restoreAllMocks();
});

type Config = Parameters<typeof PanResponder.create>[0];

// The responder each sheet makes, so a test can drive a drag without native touches.
function captureResponders() {
  const configs: Config[] = [];
  const create = PanResponder.create;
  jest.spyOn(PanResponder, 'create').mockImplementation(config => {
    configs.push(config);
    return create(config);
  });
  return configs;
}

const gesture = (dy: number, { dx = 0, vy = 0 } = {}) =>
  ({ dx, dy, vy } as unknown as Parameters<
    NonNullable<Config['onPanResponderMove']>
  >[1]);
const event = {} as Parameters<NonNullable<Config['onPanResponderMove']>>[0];

function drag(
  config: Config,
  dy: number,
  options?: { dx?: number; vy?: number },
) {
  act(() => {
    config.onPanResponderGrant?.(event, gesture(0));
    config.onPanResponderMove?.(event, gesture(dy, options));
    config.onPanResponderRelease?.(event, gesture(dy, options));
  });
}

test('only an up-and-down drag the way the card goes takes it', () => {
  expect(claimsSheetDrag({ dx: 0, dy: 20, vy: 0 }, 'down')).toBe(true);
  expect(claimsSheetDrag({ dx: 0, dy: -20, vy: 0 }, 'down')).toBe(false);
  expect(claimsSheetDrag({ dx: 0, dy: -20, vy: 0 }, 'up')).toBe(true);
  // A tap's jitter and a sideways ruler drag stay with what is under the finger.
  expect(claimsSheetDrag({ dx: 0, dy: 4, vy: 0 }, 'down')).toBe(false);
  expect(claimsSheetDrag({ dx: 40, dy: 20, vy: 0 }, 'down')).toBe(false);
});

test('the card follows only its way and no further than the move', () => {
  expect(clampSheetDrag(50, 'down', 300)).toBe(50);
  expect(clampSheetDrag(-50, 'down', 300)).toBe(0);
  expect(clampSheetDrag(500, 'down', 300)).toBe(300);
  expect(clampSheetDrag(-50, 'up', 300)).toBe(-50);
  expect(clampSheetDrag(50, 'up', 300)).toBe(-0);
  expect(clampSheetDrag(-500, 'up', 300)).toBe(-300);
});

test('a long or quick drag finishes the move, a short slow one does not', () => {
  expect(commitsSheetDrag({ dx: 0, dy: 120, vy: 0 }, 'down', 500)).toBe(true);
  expect(commitsSheetDrag({ dx: 0, dy: 40, vy: 0.1 }, 'down', 500)).toBe(false);
  expect(commitsSheetDrag({ dx: 0, dy: 30, vy: 1 }, 'down', 500)).toBe(true);
  // A card that moves little needs a third of its way.
  expect(commitsSheetDrag({ dx: 0, dy: -40, vy: 0 }, 'up', 90)).toBe(true);
  expect(commitsSheetDrag({ dx: 0, dy: 40, vy: 0 }, 'up', 90)).toBe(false);
});

function renderSheet(onClose: () => void) {
  return mount(
    <SafeAreaProvider initialMetrics={metrics}>
      <BottomSheet visible onClose={onClose} title="시간">
        <Text>18:00</Text>
      </BottomSheet>
    </SafeAreaProvider>,
  );
}

test('a bottom sheet dragged down far enough closes', () => {
  const configs = captureResponders();
  const onClose = jest.fn();
  renderSheet(onClose);

  drag(configs[0], 160);

  expect(onClose).toHaveBeenCalledTimes(1);
});

test('a short drag settles the sheet back without closing it', () => {
  const configs = captureResponders();
  const spring = jest.spyOn(Animated, 'spring');
  const onClose = jest.fn();
  renderSheet(onClose);

  drag(configs[0], 30);

  expect(onClose).not.toHaveBeenCalled();
  expect(spring).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ toValue: 0 }),
  );
});

test('a sideways drag on a sheet never closes it', () => {
  const configs = captureResponders();
  const onClose = jest.fn();
  renderSheet(onClose);

  drag(configs[0], 160, { dx: 300 });

  expect(onClose).not.toHaveBeenCalled();
});

// S15P31E105-916: claiming on start grabbed a touch before a nested ruler's ScrollView ever saw it move, so the
// ruler never scrolled. Leaving the start unclaimed lets whatever is under the finger answer the first move.
test('a touch does not claim the sheet before it moves', () => {
  const configs = captureResponders();
  renderSheet(jest.fn());

  expect(configs[0].onStartShouldSetPanResponder?.(event, gesture(0))).toBeFalsy();
});

// 코스 조건: open it folds when dragged down, folded it opens when dragged up.
function Fold({ onCommit }: { onCommit: (folded: boolean) => void }) {
  const [folded, setFolded] = React.useState(false);
  useSheetDrag({
    direction: (folded ? 'up' : 'down') as SheetDragDirection,
    range: 300,
    onCommit: () => {
      onCommit(!folded);
      setFolded(!folded);
    },
  });
  return null;
}

test('a folding card goes down, then comes back up, by drags', () => {
  const configs = captureResponders();
  const onCommit = jest.fn();
  mount(<Fold onCommit={onCommit} />);

  // Folded already, dragging further down does nothing; dragging up opens it.
  drag(configs[0], 160);
  drag(configs[0], 160);
  drag(configs[0], -160);

  expect(onCommit.mock.calls).toEqual([[true], [false]]);
});
