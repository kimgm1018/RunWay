import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import {
  DataProvider,
  createMockRepositories,
  type MeetingPlace,
} from '../src/data';
import { AreaPicker } from '../src/screens/group/CrewCreateScreen';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({}) }));

const search = jest.fn();
const onPick = jest.fn();
const place = (name: string): MeetingPlace => ({
  name,
  address: `${name} 주소`,
  position: [129.118, 35.153],
  distanceM: null,
});
let screen: TestRenderer.ReactTestRenderer;

beforeEach(async () => {
  jest.useFakeTimers();
  search.mockReset().mockResolvedValue([]);
  onPick.mockReset();
  const repositories = createMockRepositories({ latencyMs: 0 });
  repositories.groupRuns.searchPlaces = search;
  await act(async () => {
    screen = TestRenderer.create(
      <DataProvider repositories={repositories}>
        <AreaPicker area={null} onPick={onPick} />
      </DataProvider>,
    );
  });
});

afterEach(async () => {
  await act(async () => screen.unmount());
  jest.useRealTimers();
});

async function type(value: string) {
  await act(async () => {
    screen.root
      .findAll(
        node =>
          node.props.accessibilityLabel === '지역 검색' &&
          typeof node.props.onChangeText === 'function',
      )
      .pop()!
      .props.onChangeText(value);
  });
}

async function advance() {
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
}
function text() {
  return screen.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat()
    .join(' ');
}

test('an older area search cannot overwrite the latest result or reappear after clearing', async () => {
  let oldResult!: (value: MeetingPlace[]) => void;
  let currentResult!: (value: MeetingPlace[]) => void;
  search.mockImplementation(
    (query: string) =>
      new Promise(resolve => {
        if (query === '광안') oldResult = resolve;
        else currentResult = resolve;
      }),
  );
  await type('광안');
  await advance();
  await type('해운대');
  await advance();
  await act(async () => currentResult([place('해운대 공원')]));
  await act(async () => oldResult([place('광안 공원')]));
  expect(text()).toContain('해운대 공원');
  expect(text()).not.toContain('광안 공원');
  await type('미완료');
  await advance();
  await type('');
  await act(async () => currentResult([place('늦은 공원')]));
  expect(text()).not.toContain('늦은 공원');
});

test('shows failure and allows retry before selecting the location', async () => {
  search.mockRejectedValueOnce(new Error('synthetic failure'));
  await type('공원');
  await advance();
  expect(text()).toContain('검색하지 못했어요');
  search.mockResolvedValueOnce([place('선택할 공원')]);
  await act(async () =>
    screen.root
      .findAll(
        node =>
          node.props.accessibilityLabel === '지역 검색 다시 시도' &&
          typeof node.props.onPress === 'function',
      )
      .pop()!
      .props.onPress(),
  );
  await advance();
  await act(async () =>
    screen.root
      .findAll(
        node =>
          node.props.accessibilityLabel === '선택할 공원' &&
          typeof node.props.onPress === 'function',
      )
      .pop()!
      .props.onPress(),
  );
  expect(onPick).toHaveBeenCalledWith(place('선택할 공원'));
});

test('debounces rapid input and renders successful empty results', async () => {
  await type('공');
  await type('공원');
  expect(search).not.toHaveBeenCalled();
  await advance();
  expect(search).toHaveBeenCalledTimes(1);
  expect(search).toHaveBeenCalledWith('공원');
  expect(text()).toContain('찾는 장소가 없어요');
});

// S15P31E105-818: the place search stops at the server's 100.
test('limits the area search to the server limit of 100', async () => {
  const field = screen.root
    .findAll(
      node =>
        node.props.accessibilityLabel === '지역 검색' &&
        typeof node.props.onChangeText === 'function',
    )
    .pop()!;
  expect(field.props.maxLength).toBe(100);
});
