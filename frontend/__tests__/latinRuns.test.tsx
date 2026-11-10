import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { AppText } from '../src/components';
import { fontFamily } from '../src/theme';

// S15P31E105-662: AppText draws figure and Latin runs in Archivo, Korean in Noto Sans KR. jest.setup.js turns the
// split off for the other tests, so it is turned on here.
const flag = globalThis as { __RUNWAY_LATIN_SPLIT__?: boolean };
beforeAll(() => {
  flag.__RUNWAY_LATIN_SPLIT__ = true;
});
afterAll(() => {
  flag.__RUNWAY_LATIN_SPLIT__ = false;
});

function render(element: React.ReactElement) {
  let screen: TestRenderer.ReactTestRenderer;
  act(() => {
    screen = TestRenderer.create(element);
  });
  return screen!;
}

// Each nested run with its text and family.
function runs(screen: TestRenderer.ReactTestRenderer) {
  const [, ...inner] = screen.root.findAllByType(Text);
  return inner.map(node => ({
    text: String(node.props.children),
    family: node.props.style.fontFamily,
  }));
}

test('figure and Latin runs in a Korean line are drawn in Archivo of the same weight', () => {
  const screen = render(
    <AppText variant="bodyStrong">
      광안대교 루프 5.0km · 목표 6′00″ · D-4
    </AppText>,
  );
  expect(runs(screen)).toEqual([
    { text: '5.0km', family: fontFamily.numberBold },
    { text: '6′00″', family: fontFamily.numberBold },
    { text: 'D-4', family: fontFamily.numberBold },
  ]);
  const line = screen.root.findAllByType(Text)[0].props.children;
  expect(line.filter((part: unknown) => typeof part === 'string')).toEqual([
    '광안대교 루프 ',
    ' · 목표 ',
    ' · ',
  ]);
});

test('regular and medium lines map to the Archivo cuts of their weight', () => {
  expect(runs(render(<AppText>10월 19일</AppText>))).toEqual([
    { text: '10', family: fontFamily.numberRegular },
    { text: '19', family: fontFamily.numberRegular },
  ]);
  expect(runs(render(<AppText variant="button">82점</AppText>))).toEqual([
    { text: '82', family: fontFamily.numberMedium },
  ]);
});

test('Korean-only lines and lines already in another family stay whole', () => {
  const korean = render(<AppText>러닝 시작하기</AppText>);
  expect(korean.root.findAllByType(Text)).toHaveLength(1);
  expect(korean.root.findAllByType(Text)[0].props.children).toBe(
    '러닝 시작하기',
  );

  const figure = render(<AppText variant="metric">6′05″</AppText>);
  expect(figure.root.findAllByType(Text)).toHaveLength(1);
});

test('nested AppText and elements are kept, only plain strings split', () => {
  const screen = render(
    <AppText>
      {'함께 '}
      <AppText variant="metric">5</AppText>
      {'km 달렸어요'}
    </AppText>,
  );
  const texts = screen.root
    .findAllByType(Text)
    .map(node =>
      [node.props.children].flat().filter(c => typeof c === 'string'),
    );
  expect(texts.flat()).toEqual(['함께 ', ' 달렸어요', '5', 'km']);
});
