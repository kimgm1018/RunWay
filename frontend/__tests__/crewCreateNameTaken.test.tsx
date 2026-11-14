import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { ToastProvider } from '../src/components';
import {
  DataProvider,
  createMockRepositories,
  type MeetingPlace,
} from '../src/data';
import { CrewCreateScreen } from '../src/screens/group/CrewCreateScreen';
import { GroupRunDraftProvider } from '../src/screens/group/parts';

// S15P31E105-829: 6.3 크루 만들기 tells a crew name that M03 refused (409 CREW_NAME_DUPLICATED) under the name field,
// keeps what was typed, locks 크루 만들기 for that same name, and lets go once the name is changed. The mock
// repository applies the same rule as the server, so no server is needed. Synthetic values only.

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
// No navigator: the tap lock then only releases with time, and a refused name never navigates anyway.
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({}),
  NavigationContext: require('react').createContext(undefined),
}));
jest.setTimeout(30000);

const TAKEN = '광안리 새벽 크루'; // An active crew in the mock directory.
const NOTE = '이미 사용 중인 크루 이름이에요';
const place: MeetingPlace = {
  name: '테스트 광장',
  address: '부산광역시 수영구 테스트로 1',
  position: [129.118, 35.153],
  distanceM: null,
};

let screen: TestRenderer.ReactTestRenderer;
let created: jest.SpyInstance;

const wait = (ms: number) =>
  act(() => new Promise<void>(resolve => setTimeout(resolve, ms)));

beforeEach(async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  repositories.groupRuns.searchPlaces = jest.fn().mockResolvedValue([place]);
  created = jest.spyOn(repositories.crews, 'create');
  await act(async () => {
    screen = TestRenderer.create(
      <DataProvider repositories={repositories}>
        <ToastProvider>
          <GroupRunDraftProvider>
            <CrewCreateScreen />
          </GroupRunDraftProvider>
        </ToastProvider>
      </DataProvider>,
    );
  });
});

afterEach(async () => {
  await act(async () => screen.unmount());
});

const labelled = (label: string) =>
  screen.root.findAll(node => node.props.accessibilityLabel === label);
const input = (label: string) =>
  labelled(label).filter(
    node => typeof node.props.onChangeText === 'function',
  )[0];
const button = (label: string) =>
  labelled(label).filter(node => typeof node.props.onPress === 'function')[0];
const texts = () =>
  screen.root
    .findAllByType(Text)
    .map(node => [node.props.children].flat(Infinity as 1).join(''))
    .join('\n');

async function typeName(value: string) {
  await act(async () => input('크루 이름').props.onChangeText(value));
}

async function pickArea() {
  await act(async () => input('지역 검색').props.onChangeText('광장'));
  await wait(350);
  await act(async () => button(place.name).props.onPress());
}

const lockedCta = () => button('크루 만들기').props.disabled === true;

async function submit() {
  await act(async () => button('크루 만들기').props.onPress());
  await wait(50);
}

test('a taken crew name is told under the field, kept, locked, and released when changed', async () => {
  await typeName(` ${TAKEN} `);
  await pickArea();
  expect(lockedCta()).toBe(false);
  expect(texts()).not.toContain(NOTE);

  await submit();

  // The mock refused it: the note shows, the input stays as typed, and the same name cannot be sent again.
  expect(created).toHaveBeenCalledTimes(1);
  expect(texts()).toContain(NOTE);
  expect(input('크루 이름').props.value).toBe(` ${TAKEN} `);
  expect(lockedCta()).toBe(true);
  // Only outer spaces differ: still the same name.
  await typeName(`${TAKEN}  `);
  expect(texts()).toContain(NOTE);
  expect(lockedCta()).toBe(true);

  // Another name clears the note and unlocks the button.
  await typeName(`${TAKEN} 2`);
  expect(texts()).not.toContain(NOTE);
  expect(lockedCta()).toBe(false);
});
