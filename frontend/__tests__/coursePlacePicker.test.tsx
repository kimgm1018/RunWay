import React from 'react';
import { Text, Modal } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import {
  DataProvider,
  createMockRepositories,
  type MeetingPlace,
  type Place,
  type PhoneFix,
} from '../src/data';
import { CoursePlacePicker } from '../src/screens/course/CoursePlacePicker';
import { placeNameOf } from '../src/data/placeName';

jest.mock('../src/data/placeName', () => ({ placeNameOf: jest.fn() }));
const lookupName = jest.mocked(placeNameOf);

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
const initial: Place = { name: '기존 출발지', position: [129.118, 35.153] };
const result: MeetingPlace = {
  name: '검색된 공원',
  address: '합성 주소',
  position: [129.13, 35.16],
  distanceM: null,
};
const search = jest.fn();
const confirm = jest.fn();
const cancel = jest.fn();
let screen: TestRenderer.ReactTestRenderer;

beforeEach(() => {
  jest.useFakeTimers();
  lookupName.mockReset().mockResolvedValue(null);
  search.mockReset().mockResolvedValue([]);
  confirm.mockReset();
  cancel.mockReset();
});
afterEach(async () => {
  if (screen) await act(async () => screen.unmount());
  jest.useRealTimers();
});

async function open(
  selected: Place | null = initial,
  current?: () => Promise<PhoneFix>,
) {
  const repositories = createMockRepositories({ latencyMs: 0 });
  repositories.groupRuns.searchPlaces = search;
  if (current)
    repositories.phoneLocation = {
      start: async () => false,
      stop: async () => undefined,
      subscribe: () => () => undefined,
      requestPermission: async () => true,
      current,
    };
  await act(async () => {
    screen = TestRenderer.create(
      <DataProvider repositories={repositories}>
        <CoursePlacePicker
          kind="destination"
          selected={selected}
          reference={initial}
          onConfirm={confirm}
          onCancel={cancel}
        />
      </DataProvider>,
    );
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
async function press(label: string) {
  await act(async () => labelled(label).props.onPress());
}
async function type(value: string) {
  await act(async () =>
    labelled('장소·주소 검색', 'onChangeText').props.onChangeText(value),
  );
}
async function advance() {
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
}
async function tap(latitude = 35.17, longitude = 129.14) {
  await act(async () =>
    screen.root
      .findAll(node => typeof node.props.onTapMap === 'function')
      .pop()!
      .props.onTapMap({ latitude, longitude }),
  );
}
function text() {
  return screen.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat()
    .join(' ');
}

test('map selection is a draft until confirmed and retains longitude latitude order', async () => {
  await open(null);
  expect(labelled('이 위치로 확정').props.disabled).toBe(true);
  await tap();
  expect(confirm).not.toHaveBeenCalled();
  expect(text()).toContain('지도에서 고른 위치');
  expect(text()).not.toContain('35.17000, 129.14000');
  await press('이 위치로 확정');
  expect(confirm).toHaveBeenCalledWith({
    name: '지도에서 고른 위치',
    position: [129.14, 35.17],
  });
});

test('a map selection uses the device place name when available', async () => {
  lookupName.mockResolvedValue('지도 지점의 장소명');
  await open(null);
  await tap();
  expect(text()).toContain('지도 지점의 장소명');
  await press('이 위치로 확정');
  expect(confirm).toHaveBeenCalledWith({
    name: '지도 지점의 장소명',
    position: [129.14, 35.17],
  });
});

test('a delayed place name cannot overwrite a newer map selection', async () => {
  let finish!: (name: string | null) => void;
  lookupName.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  await open(null);
  await tap();
  await tap(35.18, 129.15);
  await act(async () => finish('이전 지점'));
  await press('이 위치로 확정');
  expect(confirm).toHaveBeenCalledWith({
    name: '지도에서 고른 위치',
    position: [129.15, 35.18],
  });
});

test('cancel and Android back never commit an edited location', async () => {
  await open();
  await tap();
  await press('취소');
  await act(async () => screen.root.findByType(Modal).props.onRequestClose());
  expect(cancel).toHaveBeenCalledTimes(2);
  expect(confirm).not.toHaveBeenCalled();
});

test('search picks a point for preview and a subsequent map tap replaces it', async () => {
  search.mockResolvedValue([result]);
  await open();
  await type(' 공원 ');
  await advance();
  expect(search).toHaveBeenCalledWith('공원', initial.position);
  await press('검색된 공원, 합성 주소');
  expect(text()).toContain('검색된 공원');
  expect(confirm).not.toHaveBeenCalled();
  await tap();
  expect(text()).not.toContain('합성 주소');
  await press('이 위치로 확정');
  expect(confirm.mock.calls[0][0].position).toEqual([129.14, 35.17]);
});

test('older searches cannot overwrite a later response and failures can be retried', async () => {
  let answerOld!: (places: MeetingPlace[]) => void;
  search.mockImplementation((query: string) =>
    query === '이전'
      ? new Promise(resolve => {
          answerOld = resolve;
        })
      : Promise.resolve([result]),
  );
  await open();
  await type('이전');
  await advance();
  await type('최신');
  await advance();
  await act(async () => answerOld([{ ...result, name: '이전 장소' }]));
  expect(text()).not.toContain('이전 장소');
  expect(text()).toContain('검색된 공원');
  search.mockRejectedValueOnce(new Error('synthetic'));
  await type('실패');
  await advance();
  expect(text()).toContain('장소를 검색하지 못했어요.');
  search.mockResolvedValueOnce([]);
  await press('장소 검색 다시 시도');
  await advance();
  expect(text()).toContain('검색 결과가 없어요.');
});

test('a late current-location fix cannot replace a manually chosen point', async () => {
  let answer!: (fix: PhoneFix) => void;
  await open(
    null,
    () =>
      new Promise(resolve => {
        answer = resolve;
      }),
  );
  await act(async () => {
    labelled('현재 위치').props.onPress();
  });
  await tap();
  await act(async () =>
    answer({
      latitude: 35.1,
      longitude: 129.1,
      accuracyM: 5,
      altitudeM: null,
      time: 0,
    }),
  );
  await press('이 위치로 확정');
  expect(confirm.mock.calls[0][0].position).toEqual([129.14, 35.17]);
});

test('missing location support still allows map selection without fabricating a fix', async () => {
  await open(null);
  await press('현재 위치');
  expect(text()).toContain('이 기기에서는 현재 위치를 쓸 수 없어요.');
  expect(labelled('이 위치로 확정').props.disabled).toBe(true);
  await tap();
  await press('이 위치로 확정');
  expect(confirm).toHaveBeenCalledTimes(1);
});

// S15P31E105-818: the place search stops at the server's 100 (GET /places/search).
test('limits the place search to the server limit of 100', async () => {
  await open();
  expect(labelled('장소·주소 검색', 'onChangeText').props.maxLength).toBe(100);
});
