import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { LightGlass } from '../src/components';
import {
  DataProvider,
  createMockRepositories,
  DataError,
  type MeetingPlace,
  type PhoneLocation,
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

async function open(phoneLocation?: PhoneLocation) {
  const repositories = {
    ...createMockRepositories({ latencyMs: 0 }),
    phoneLocation,
  };
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
  // The search box itself is the navy pill of 그룹런 시안 (S15P31E105-673), no longer glass.
  const glassSearch = screen.root
    .findAllByType(LightGlass)
    .find(
      node =>
        node.findAll(item => item.props.accessibilityLabel === '장소·주소 검색')
          .length,
    );
  expect(glassSearch).toBeUndefined();
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

// S15P31E105-798 (TEAM QA T22): 내 위치로 answers every outcome of the phone's fix.
const phone = (current: PhoneLocation['current']): PhoneLocation => ({
  start: async () => false,
  stop: async () => undefined,
  subscribe: () => () => undefined,
  requestPermission: async () => true,
  current,
});

test('내 위치로 puts the pin on the phone fix and takes its place', async () => {
  await open(
    phone(async () => ({
      latitude: 35.1551,
      longitude: 129.1301,
      accuracyM: 5,
      altitudeM: null,
      time: 1,
    })),
  );
  await press('내 위치로');
  await advance(0);
  expect(text()).not.toContain('위치 권한');
  await press('이 위치로 정하기');
  await press('확정');
  const chosen = JSON.parse(
    screen.root.findAll(node => node.props.testID === 'chosen').pop()!.props
      .children,
  );
  expect(chosen.position).toEqual([129.1301, 35.1551]);
});

test.each([
  ['LOCATION_PERMISSION_DENIED', '위치 권한이 없어 현재 위치를 쓸 수 없어요.'],
  ['LOCATION_DISABLED', '휴대폰 위치가 꺼져 있어요.'],
  ['LOCATION_TIMEOUT', '현재 위치를 찾지 못했어요.'],
] as const)(
  '내 위치로 says why when the phone gives %s',
  async (code, said) => {
    await open(
      phone(async () => {
        throw new DataError(code, '위치 실패');
      }),
    );
    await press('내 위치로');
    await advance(0);
    expect(text()).toContain(said);
    // The pin stays where it was and the button works again.
    expect(labelled('내 위치로').props.disabled).toBeFalsy();
  },
);

// S15P31E105-818: the inputs stop at the server's limits (G01·G04 meetingPlaceName 200, description 10000,
// GET /places/search 100), so a long text never reaches the server to be refused.
test('limits the search, 장소 이름 and 찾아오는 법 to the server limits', async () => {
  await open();
  expect(labelled('장소·주소 검색', 'onChangeText').props.maxLength).toBe(100);
  search.mockImplementation((query: string) =>
    Promise.resolve(query ? [place('공원 입구')] : []),
  );
  await type('공원');
  await advance(300);
  await press('공원 입구');
  await advance(0);
  await press('이 위치로 정하기');
  expect(labelled('장소 이름', 'onChangeText').props.maxLength).toBe(200);
  expect(labelled('찾아오는 법 · 선택', 'onChangeText').props.maxLength).toBe(
    10000,
  );
});
