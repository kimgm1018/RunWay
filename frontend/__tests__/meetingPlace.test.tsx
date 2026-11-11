import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { LightGlass } from '../src/components';
import {
  DataProvider,
  createMockRepositories,
  type MeetingPlace,
} from '../src/data';
import { MeetingPlaceScreen } from '../src/screens/group/MeetingPlaceScreen';
import {
  GroupRunDraftProvider,
  useGroupRunDraft,
} from '../src/screens/group/parts';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
}));
jest.mock('../src/screens/group/GroupRunDetailScreen', () => {
  const ReactMock = require('react');
  const { Pressable, Text: NativeText } = require('react-native');
  return {
    FooterButton: ({ title, ...props }: { title: string }) =>
      ReactMock.createElement(
        Pressable,
        { ...props, accessibilityLabel: title },
        ReactMock.createElement(NativeText, null, title),
      ),
  };
});

function Chosen() {
  const { draft } = useGroupRunDraft();
  return <Text testID="chosen">{JSON.stringify(draft.place)}</Text>;
}

const place = (name: string): MeetingPlace => ({
  name,
  address: `${name} 주소`,
  position: [129.118, 35.153],
  distanceM: null,
});
let screen: TestRenderer.ReactTestRenderer;
const search = jest.fn();

beforeEach(() => {
  jest.useFakeTimers();
  search.mockReset().mockResolvedValue([]);
  mockGoBack.mockReset();
});

afterEach(async () => {
  if (screen) await act(async () => screen.unmount());
  jest.useRealTimers();
});

async function open() {
  const repositories = createMockRepositories({ latencyMs: 0 });
  repositories.groupRuns.searchPlaces = search;
  await act(async () => {
    screen = TestRenderer.create(
      <DataProvider repositories={repositories}>
        <GroupRunDraftProvider>
          <MeetingPlaceScreen />
          <Chosen />
        </GroupRunDraftProvider>
      </DataProvider>,
    );
  });
  await advance(0);
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

function labelled(label: string, prop = 'onPress') {
  return screen.root
    .findAll(
      node =>
        node.props.accessibilityLabel === label &&
        typeof node.props[prop] === 'function',
    )
    .pop()!;
}

async function type(value: string) {
  await act(async () =>
    labelled('장소·주소 검색', 'onChangeText').props.onChangeText(value),
  );
}

async function press(label: string) {
  await act(async () => labelled(label).props.onPress());
}

function text() {
  return screen.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat()
    .join(' ');
}

test('debounces input and ignores responses for an older search', async () => {
  await open();
  let oldResult!: (value: MeetingPlace[]) => void;
  search.mockImplementation((query: string) =>
    query === '이전'
      ? new Promise(resolve => {
          oldResult = resolve;
        })
      : Promise.resolve([place('최신 장소')]),
  );
  await type('이');
  await advance(100);
  await type('이전');
  await advance(299);
  expect(search).not.toHaveBeenCalledWith('이전', null);
  await advance(1);
  await type('최신');
  await advance(300);
  expect(text()).toContain('최신 장소');
  await act(async () => oldResult([place('이전 장소')]));
  expect(text()).toContain('최신 장소');
  expect(text()).not.toContain('이전 장소');
});

test('distinguishes failure from empty results and allows retry', async () => {
  await open();
  search.mockRejectedValueOnce(new Error('synthetic failure'));
  await type('공원');
  await advance(300);
  expect(text()).toContain('검색하지 못했어요');
  expect(text()).not.toContain('찾는 장소가 없어요');
  search.mockResolvedValueOnce([]);
  await press('장소 검색 다시 시도');
  await advance(300);
  expect(text()).toContain('찾는 장소가 없어요');
});

// S15P31E105-679: the result rows over the map are opaque, so map labels do not show through the names.
test('search results and their notices sit on an opaque background over the map', async () => {
  await open();
  const opaqueRowWith = (label: string) =>
    screen.root
      .findAllByType(LightGlass)
      .filter(node =>
        node
          .findAllByType(Text)
          .some(item => [item.props.children].flat().join('').includes(label)),
      )
      .every(node => typeof node.props.solid === 'string');
  search.mockRejectedValueOnce(new Error('synthetic failure'));
  await type('공원');
  await advance(300);
  expect(opaqueRowWith('검색하지 못했어요')).toBe(true);
  search.mockResolvedValueOnce([place('공원 입구'), place('공원 정문')]);
  await press('장소 검색 다시 시도');
  await advance(300);
  expect(text()).toContain('공원 정문');
  expect(opaqueRowWith('공원 입구')).toBe(true);
  expect(opaqueRowWith('공원 정문')).toBe(true);
  // The search box itself stays glass.
  const searchBox = screen.root
    .findAllByType(LightGlass)
    .find(node =>
      node.findAll(item => item.props.accessibilityLabel === '장소·주소 검색')
        .length,
    )!;
  expect(searchBox.props.solid).toBeUndefined();
});

test('selects the result on the map and confirms its coordinates into the group draft', async () => {
  await open();
  search.mockImplementation((query: string) =>
    Promise.resolve(query ? [place('공원 입구')] : []),
  );
  await type('공원');
  await advance(300);
  await press('공원 입구');
  await advance(0);
  expect(text()).not.toContain('NaN');
  await press('이 위치로 정하기');
  await press('확정');
  const chosen = JSON.parse(
    screen.root.findAll(node => node.props.testID === 'chosen').pop()!.props
      .children,
  );
  expect(chosen).toMatchObject(place('공원 입구'));
  expect(mockGoBack).toHaveBeenCalledTimes(1);
});
