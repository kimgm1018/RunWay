import React from 'react';
import { Modal, Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { CourseMapZoom } from '../src/screens/group/CourseMapZoom';
import type { LngLat } from '../src/geo';

// S15P31E105-739: a press on the group run's small course map opens it full screen with the km paces; 닫기 and the
// back button (onRequestClose) close it.

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const route: LngLat[] = [
  [129.118, 35.153],
  [129.123, 35.1565],
  [129.1285, 35.16],
];

function render() {
  let screen!: TestRenderer.ReactTestRenderer;
  act(() => {
    screen = TestRenderer.create(
      <CourseMapZoom route={route} paces={[336, 343]} distanceM={2000}>
        <Text>작은 지도</Text>
      </CourseMapZoom>,
    );
  });
  return screen;
}

const byLabel = (screen: TestRenderer.ReactTestRenderer, label: string) =>
  screen.root.findAll(
    node =>
      typeof node.props.onPress === 'function' &&
      node.props.accessibilityLabel === label,
  )[0];
const modal = (screen: TestRenderer.ReactTestRenderer) =>
  screen.root.findByType(Modal);
const texts = (screen: TestRenderer.ReactTestRenderer) =>
  screen.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat()
    .filter(child => typeof child === 'string')
    .join('|');

it('opens big on a press and closes with 닫기', () => {
  const screen = render();
  expect(modal(screen).props.visible).toBe(false);
  act(() => byLabel(screen, '코스 지도 크게 보기').props.onPress());
  expect(modal(screen).props.visible).toBe(true);
  expect(texts(screen)).toContain('km별 페이스');
  expect(texts(screen)).toContain('2km');
  act(() => byLabel(screen, '지도 닫기').props.onPress());
  expect(modal(screen).props.visible).toBe(false);
});

it('closes with the back button', () => {
  const screen = render();
  act(() => byLabel(screen, '코스 지도 크게 보기').props.onPress());
  act(() => modal(screen).props.onRequestClose());
  expect(modal(screen).props.visible).toBe(false);
});
