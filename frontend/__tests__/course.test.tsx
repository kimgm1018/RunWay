import React from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { RunMap } from '../src/components/RunMap';
import { RouteLine } from '../src/screens/course/RouteLine';
import {
  createMockRepositories,
  DataError,
  type MockScenario,
  type PhoneFix,
  type Repositories,
} from '../src/data';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
// The first React Native render loads lazy host components on this Windows runner.
jest.setTimeout(30000);

type Screen = TestRenderer.ReactTestRenderer;

function texts(screen: Screen) {
  return screen.root
    .findAllByType(Text)
    .flatMap(node => [node.props.children].flat())
    .filter(child => typeof child === 'string' || typeof child === 'number')
    .join(' ');
}

// Stacks keep earlier screens mounted, so the newest match belongs to the top screen.
function labelled(screen: Screen, label: string, prop = 'onPress') {
  const matches = screen.root.findAll(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props[prop] === 'function',
  );
  if (matches.length === 0) {
    throw new Error(`No element labelled ${label}`);
  }
  return matches[matches.length - 1];
}

async function settle(ms = 20) {
  await act(() => new Promise<void>(resolve => setTimeout(resolve, ms)));
}

// Flush each timer-driven render before checking the next screen (S15P31E105-372).
async function waitForText(screen: Screen, text: string, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (!texts(screen).includes(text)) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${text}: ${texts(screen)}`);
    }
    await settle(50);
  }
}

async function press(screen: Screen, label: string) {
  await act(async () => {
    labelled(screen, label).props.onPress();
  });
  await settle();
}

async function type(screen: Screen, label: string, text: string) {
  await act(async () => {
    labelled(screen, label, 'onChangeText').props.onChangeText(text);
  });
  await settle();
}

// Types into 장소·주소 검색 and waits past the pause before searchPlaces is asked.
async function search(screen: Screen, text: string) {
  await type(screen, '장소·주소 검색', text);
  await settle(400);
}

async function adjust(screen: Screen, label: string, action: string) {
  await act(async () => {
    labelled(
      screen,
      label,
      'onAccessibilityAction',
    ).props.onAccessibilityAction({ nativeEvent: { actionName: action } });
  });
  await settle();
}

// A synthetic fix near 민락수변공원 (not a real person's location).
const here: PhoneFix = {
  latitude: 35.1551,
  longitude: 129.1301,
  accuracyM: 5,
  altitudeM: null,
  time: Date.UTC(2026, 10, 6, 1, 0, 0),
};

// The mock data has no phone location; 3.1 gets one that answers with `current`.
function withLocation(
  repositories: Repositories,
  current: () => Promise<PhoneFix> = async () => here,
): Repositories {
  return {
    ...repositories,
    phoneLocation: {
      start: async () => false,
      stop: async () => undefined,
      subscribe: () => () => undefined,
      requestPermission: async () => true,
      current,
    },
  };
}

// Signs in and opens 3.1 오늘의 러닝 from the run tab's map.
async function openTodayRun(
  scenario: MockScenario = 'default',
  repositories: Repositories = withLocation(
    createMockRepositories({ latencyMs: 0, scenario }),
  ),
) {
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <App repositories={repositories} initialSignedIn />,
    );
  });
  await settle();
  await press(screen!, '러닝');
  // The run map's 코스 설정 chip leads to 3.1 (S15P31E105-683).
  await press(screen!, '코스 설정');
  return screen!;
}

test('today’s run works out pace and finish time from the distance', async () => {
  const screen = await openTodayRun();
  let page = texts(screen);
  // Each condition is a card (운동 목표 sheet, 담당자 요청); the list shows the values.
  for (const text of [
    '코스 형태',
    '순환',
    '왕복',
    '편도',
    '환경 · 여러 개 선택',
    '현재 위치',
    '목표 완주 시간',
    '6′00″',
  ]) {
    expect(page).toContain(text);
  }
  await press(screen, '환경 설정');
  expect(labelled(screen, '공원').props.accessibilityState).toMatchObject({
    checked: false,
  });
  await press(screen, '코스 조건으로');
  // 3.1p: the pace goes in, the finish time comes out.
  await press(screen, '목표 설정');
  await press(screen, '페이스');
  page = texts(screen);
  expect(page).toContain('목표 페이스');
  // 페이스 is picked on a ruler now (S15P31E105-517).
  expect(
    labelled(screen, '목표 페이스', 'onAccessibilityAction').props
      .accessibilityValue.text,
  ).toBe('6′00″/km');
  expect(page).toContain('30:00');
  await press(screen, '코스 조건으로');
  await press(screen, '목표 거리 설정');
  await adjust(screen, '목표 거리', 'increment');
  expect(texts(screen)).toContain('5.5');
  await press(screen, '코스 조건으로');
  expect(texts(screen)).toContain('33:00');
  // Six 5-second steps down: 6′00″ → 5′30″.
  await press(screen, '목표 설정');
  for (let step = 0; step < 6; step += 1) {
    await adjust(screen, '목표 페이스', 'decrement');
  }
  expect(texts(screen)).toContain('30:15');
  await press(screen, '코스 조건으로');
  await press(screen, '환경 설정');
  await press(screen, '큰길 피하기');
  expect(
    labelled(screen, '큰길 피하기').props.accessibilityState,
  ).toMatchObject({
    checked: true,
  });
  await press(screen, '코스 조건으로');
  await press(screen, '기준 위치 현재 위치');
  await search(screen, '민락수변공원');
  await press(screen, '민락수변공원 주차장 입구, 부산 수영구 민락수변로 7');
  await press(screen, '이 위치로 확정');
  expect(() =>
    labelled(screen, '기준 위치 민락수변공원 주차장 입구'),
  ).not.toThrow();
  await act(async () => screen.unmount());
});

test('시작 시 요청한 GPS가 늦게 도착해도 지도에서 확정한 출발지를 덮지 않는다', async () => {
  let answer!: (fix: PhoneFix) => void;
  const repositories = withLocation(
    createMockRepositories({ latencyMs: 0 }),
    () =>
      new Promise(resolve => {
        answer = resolve;
      }),
  );
  const recommend = jest.spyOn(repositories.courses, 'recommend');
  const screen = await openTodayRun('default', repositories);
  await press(screen, '기준 위치 ');
  await act(async () =>
    screen.root
      .findAll(node => typeof node.props.onTapMap === 'function')
      .pop()!
      .props.onTapMap({ latitude: 35.152, longitude: 129.119 }),
  );
  await press(screen, '이 위치로 확정');
  await act(async () => answer(here));
  expect(() => labelled(screen, '기준 위치 지도에서 고른 위치')).not.toThrow();
  await press(screen, '코스 추천 받기');
  expect(recommend.mock.calls[0][0].origin.position).toEqual([129.119, 35.152]);
  await act(async () => screen.unmount());
});

test('장소 검색 결과가 없거나 검색이 실패하면 안내한다', async () => {
  const repositories = withLocation(createMockRepositories({ latencyMs: 0 }));
  const searchPlaces = jest.spyOn(repositories.groupRuns, 'searchPlaces');
  const screen = await openTodayRun('default', repositories);
  await press(screen, '기준 위치 현재 위치');

  await search(screen, '없는장소');
  expect(texts(screen)).toContain('검색 결과가 없어요.');

  searchPlaces.mockRejectedValueOnce(
    new DataError('NETWORK_ERROR', '연결 없음'),
  );
  await search(screen, '광안리');
  expect(texts(screen)).toContain('장소를 검색하지 못했어요.');
  // The origin stays as it was.
  expect(() => labelled(screen, '기준 위치 현재 위치')).not.toThrow();
  await act(async () => screen.unmount());
});

// S15P31E105-494: 현재 위치 is the phone's own fix, sent to C01 but never saved with the preferences.
test('현재 위치 좌표를 C01에 보내고 기본값 저장에는 좌표를 넣지 않는다', async () => {
  const repositories = withLocation(createMockRepositories({ latencyMs: 0 }));
  const recommend = jest.spyOn(repositories.courses, 'recommend');
  const save = jest.spyOn(repositories.courses, 'savePreferences');
  const screen = await openTodayRun('default', repositories);
  expect(() => labelled(screen, '기준 위치 현재 위치')).not.toThrow();

  await press(screen, '이 조건을 기본값으로 저장');
  expect(Object.keys(save.mock.calls[0][0]).sort()).toEqual([
    'filters',
    'shape',
  ]);

  await press(screen, '코스 추천 받기');
  expect(recommend.mock.calls[0][0].origin).toEqual({
    name: '현재 위치',
    position: [here.longitude, here.latitude],
  });
  await act(async () => screen.unmount());
});

test('위치 권한이 없으면 안내하고 고정 장소를 현재 위치로 쓰지 않는다', async () => {
  const screen = await openTodayRun(
    'default',
    withLocation(createMockRepositories({ latencyMs: 0 }), async () => {
      throw new DataError('LOCATION_PERMISSION_DENIED', '권한 없음');
    }),
  );
  expect(texts(screen)).toContain('위치 권한이 없어 현재 위치를 쓸 수 없어요.');
  expect(texts(screen)).toContain('기준 위치 설정하기');
  expect(labelled(screen, '코스 추천 받기').props.disabled).toBe(true);

  // A place found by search still works.
  await press(screen, '기준 위치 ');
  await search(screen, '광안리');
  await press(screen, '광안리해수욕장 입구, 부산 수영구 광안해변로 219');
  await press(screen, '이 위치로 확정');
  expect(texts(screen)).not.toContain(
    '위치 권한이 없어 현재 위치를 쓸 수 없어요.',
  );
  expect(labelled(screen, '코스 추천 받기').props.disabled).toBe(false);
  expect(texts(screen)).not.toContain('현재 위치를 찾는 중이에요');
  await act(async () => screen.unmount());
});

test('기준 위치를 지도에서 눌러 고르고, 취소하면 그대로 둔다', async () => {
  const screen = await openTodayRun(
    'default',
    withLocation(createMockRepositories({ latencyMs: 0 }), async () => {
      throw new DataError('LOCATION_PERMISSION_DENIED', '권한 없음');
    }),
  );
  // The top screen's map: 2.0C stays mounted under 3.1.
  const map = () =>
    screen.root.findAll(node => node.props.testID === 'naver-map').at(-1)!;
  const tap = async (latitude: number, longitude: number) => {
    await act(async () => {
      map().props.onTapMap({ latitude, longitude });
    });
    await settle();
  };
  // A tap on the conditions map only folds 코스 조건 down to its title (S15P31E105-683); its title opens it
  // again. Picking a place on the map is the picker's.
  await tap(35.1532, 129.1186);
  expect(() => labelled(screen, '코스 조건 펼치기')).not.toThrow();
  expect(texts(screen)).toContain('기준 위치 설정하기');
  await press(screen, '코스 조건 펼치기');
  expect(() => labelled(screen, '코스 조건 접기')).not.toThrow();

  await press(screen, '기준 위치 ');
  expect(texts(screen)).toContain('출발 위치 선택');
  expect(labelled(screen, '이 위치로 확정').props.disabled).toBe(true);
  await press(screen, '취소');
  expect(texts(screen)).toContain('기준 위치 설정하기');

  await press(screen, '기준 위치 ');
  // No place name off Android (and none in the test), so it keeps the plain label instead of numbers.
  await tap(35.1532, 129.1189);
  expect(texts(screen)).toContain('지도에서 고른 위치');
  expect(texts(screen)).not.toContain('35.15320, 129.11890');
  await press(screen, '이 위치로 확정');
  expect(() => labelled(screen, '기준 위치 지도에서 고른 위치')).not.toThrow();
  expect(labelled(screen, '코스 추천 받기').props.disabled).toBe(false);
  // Back on the conditions, a map tap folds them again rather than picking a place.
  await tap(35.16, 129.12);
  expect(() => labelled(screen, '코스 조건 펼치기')).not.toThrow();
  expect(() => labelled(screen, '기준 위치 지도에서 고른 위치')).not.toThrow();
  await act(async () => screen.unmount());
});

test('위치가 꺼져 있으면 안내하고 다시 찾기로 현재 위치를 쓴다', async () => {
  const current = jest
    .fn<Promise<PhoneFix>, []>()
    .mockRejectedValueOnce(new DataError('LOCATION_DISABLED', '위치 꺼짐'))
    .mockResolvedValue(here);
  const screen = await openTodayRun(
    'default',
    withLocation(createMockRepositories({ latencyMs: 0 }), current),
  );
  expect(texts(screen)).toContain('휴대폰 위치가 꺼져 있어요.');

  await press(screen, '현재 위치 다시 찾기');
  expect(texts(screen)).not.toContain('휴대폰 위치가 꺼져 있어요.');
  expect(() => labelled(screen, '기준 위치 현재 위치')).not.toThrow();
  expect(labelled(screen, '코스 추천 받기').props.disabled).toBe(false);
  await act(async () => screen.unmount());
});

test('폰 위치가 없는 기기는 현재 위치를 쓸 수 없다고 안내한다', async () => {
  const screen = await openTodayRun(
    'default',
    createMockRepositories({ latencyMs: 0 }),
  );
  expect(texts(screen)).toContain('이 기기에서는 현재 위치를 쓸 수 없어요.');
  expect(labelled(screen, '코스 추천 받기').props.disabled).toBe(true);
  await act(async () => screen.unmount());
});

test('코스 생성에 사용하지 않는 건강 반영 문구를 표시하지 않는다', async () => {
  const screen = await openTodayRun('newUser');
  expect(texts(screen)).not.toContain('함께 반영');
  expect(texts(screen)).not.toContain('준비도 미반영');
  expect(texts(screen)).not.toContain('운동 강도');
  await act(async () => screen.unmount());
});

test('recommended courses turn over to their detail and lead to the course run', async () => {
  const screen = await openTodayRun();
  await press(screen, '코스 추천 받기');
  let page = texts(screen);
  // The card puts the distance in its own pill, so the name loses its trailing 5.0km.
  expect(page).toContain('민락수변공원 출발');
  expect(page).toContain('5.0km');
  expect(page).toContain('목표 6′00″/km');
  expect(page).toContain('이 코스로 달리기');
  await press(screen, '민락수변공원 출발 5.0km, 코스 정보 보기');
  expect(() =>
    labelled(screen, '민락수변공원 출발 5.0km, 앞면 보기'),
  ).not.toThrow();
  page = texts(screen);
  for (const text of ['순환', '공원 · 하천변 · 평지', '추천 이유', '↑12']) {
    expect(page).toContain(text);
  }
  await press(screen, '내 코스에 저장');
  expect(() => labelled(screen, '저장 해제')).not.toThrow();
  // The first card (민락수변공원 출발) is the one turned over above.
  await act(async () => {
    screen.root
      .findAll(
        node =>
          node.props.accessibilityLabel === '이 코스로 달리기' &&
          typeof node.props.onPress === 'function',
      )[0]
      .props.onPress();
  });
  await waitForText(screen, '오늘의 전략');
  // The name already ends in its distance, so the course chip shows it once (S15P31E105-683).
  expect(texts(screen)).toContain('민락수변공원 출발 5.0km');
  expect(texts(screen)).not.toContain('민락수변공원 출발 5.0km · 5.0km');
  await act(async () => screen.unmount());
});

test('course cards hide the away-facing content through repeated turns', async () => {
  const screen = await openTodayRun();
  let animation: jest.SpyInstance | undefined;
  try {
    await press(screen, '코스 추천 받기');
    // Native-driver animations do not advance in Jest. Drive their value directly,
    // keeping the real card's opacity interpolation and touch/accessibility state.
    animation = jest
      .spyOn(Animated, 'timing')
      .mockImplementation((value, config) => ({
        start: () => {
          if (
            value instanceof Animated.Value &&
            typeof config.toValue === 'number'
          ) {
            value.setValue(config.toValue);
          }
        },
        stop: () => undefined,
        reset: () => undefined,
      }));
    const face = (side: 'front' | 'back', card = 0) =>
      screen.root
        .findAllByType(Animated.View)
        .filter(
          node =>
            StyleSheet.flatten(node.props.style)?.backfaceVisibility ===
            'hidden',
        )[card * 2 + (side === 'front' ? 0 : 1)];
    const opacity = (side: 'front' | 'back') => {
      const value = StyleSheet.flatten(face(side).props.style).opacity;
      return typeof value === 'object' ? value.__getValue() : value ?? 1;
    };
    const expectFace = (back: boolean) => {
      expect(opacity('front')).toBe(back ? 0 : 1);
      expect(opacity('back')).toBe(back ? 1 : 0);
      expect(face('front').props.pointerEvents).toBe(back ? 'none' : 'auto');
      expect(face('back').props.pointerEvents).toBe(back ? 'auto' : 'none');
      expect(face('front').props.accessibilityElementsHidden).toBe(back);
      expect(face('back').props.accessibilityElementsHidden).toBe(!back);
    };
    const frontMap = face('front').findByType(RunMap);
    const loadingMap = (card = 0) =>
      face('front', card).findAll(
        node =>
          typeof node.type === 'string' &&
          node.props.accessibilityLabel === '코스 지도 불러오는 중',
      );
    // Before the native camera is ready, a neutral loading cover replaces the
    // old mist/route illustration on every recommendation, including previews.
    expect(loadingMap()).toHaveLength(1);
    expect(screen.root.findAllByType(RouteLine)).toHaveLength(0);
    await act(async () => frontMap.props.onShown());
    expect(loadingMap()).toHaveLength(0);
    expectFace(false);
    for (let turn = 0; turn < 3; turn++) {
      await press(screen, '민락수변공원 출발 5.0km, 코스 정보 보기');
      // Keep the same map behind the turning front, rather than flashing a
      // different mist/route card and recreating the native map on return.
      expect(face('front').findByType(RunMap)).toBe(frontMap);
      expect(loadingMap()).toHaveLength(0);
      expectFace(true);
      await act(async () => {
        face('back')
          .findAll(
            node =>
              node.props.accessibilityLabel === '앞면으로 돌아가기' &&
              typeof node.props.onPress === 'function',
          )[0]
          .props.onPress();
      });
      expect(face('front').findByType(RunMap)).toBe(frontMap);
      expectFace(false);
    }
    const carousel = screen.root
      .findAll(
        node =>
          node.props.horizontal &&
          typeof node.props.onMomentumScrollEnd === 'function',
      )
      .at(-1)!;
    const width = StyleSheet.flatten(
      labelled(screen, '민락수변공원 출발 5.0km, 코스 정보 보기').props.style,
    ).width as number;
    await act(async () => {
      carousel.props.onMomentumScrollEnd({
        nativeEvent: { contentOffset: { x: width + 8 } },
      });
    });
    expect(face('front').findAllByType(RunMap)).toHaveLength(0);
    expect(loadingMap(1)).toHaveLength(1);
    const nextMap = face('front', 1).findByType(RunMap);
    await act(async () => nextMap.props.onShown());
    expect(loadingMap(1)).toHaveLength(0);
    await act(async () => {
      carousel.props.onMomentumScrollEnd({
        nativeEvent: { contentOffset: { x: 0 } },
      });
    });
    expect(loadingMap()).toHaveLength(1);
    expect(face('front').findByType(RunMap)).not.toBe(frontMap);
  } finally {
    await act(async () => screen.unmount());
    animation?.mockRestore();
  }
});

test('a recommended course with a goal of its own asks whether to keep the goal set on the map (S15P31E105-683)', async () => {
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <App
        repositories={withLocation(createMockRepositories({ latencyMs: 0 }))}
        initialSignedIn
      />,
    );
  });
  await settle();
  // 5km in 30분 on the map: 6′00″/km on a course.
  await press(screen!, '러닝');
  await press(screen!, '목표 설정');
  await press(screen!, '거리 목표 선택');
  await press(screen!, '시간 목표 선택');
  await press(screen!, '목표 설정 완료');
  await press(screen!, '코스 설정');
  await press(screen!, '코스 추천 받기');
  await act(async () => {
    screen!.root
      .findAll(
        node =>
          node.props.accessibilityLabel === '이 코스로 달리기' &&
          typeof node.props.onPress === 'function',
      )[0]
      .props.onPress();
  });
  // 3.1 asked for 30분, so the course brings that goal: the user picks which one to run with.
  await waitForText(screen!, '어떤 목표로 달릴까요?');
  expect(texts(screen!)).toContain('30분 달리기');
  expect(texts(screen!)).toContain('6′00″/km로 달리기');
  await press(screen!, '내가 정한 목표 유지');
  expect(texts(screen!)).not.toContain('어떤 목표로 달릴까요?');
  expect(labelled(screen!, '목표 설정').props.accessibilityHint).toBe(
    '6′00″/km로 달리기',
  );
  await act(async () => screen!.unmount());
});

test.each([
  ['noCourses', '조건에 맞는 코스를 찾지 못했어요.'],
  ['courseError', '코스를 추천받지 못했어요.'],
] as const)(
  'a %s answer keeps the user on 3.1 with the inputs',
  async (scenario, message) => {
    const screen = await openTodayRun(scenario);
    await press(screen, '코스 추천 받기');
    expect(texts(screen)).toContain(message);
    expect(texts(screen)).toContain('환경 · 여러 개 선택');
    expect(() => labelled(screen, '이 코스로 달리기')).toThrow();
    await act(async () => screen.unmount());
  },
);

test('saved courses show nicknames, undo an unsave and open the course run', async () => {
  const screen = await openTodayRun();
  await press(screen, '저장한 코스');
  let page = texts(screen);
  for (const text of [
    '광안대교 루프',
    '민락수변 왕복',
    '수영강 하천길',
    '이기대 갈맷길',
    // Too long for one line on the card, so it breaks at a space.
    'APEC\n나루공원 루프',
  ]) {
    expect(page).toContain(text);
  }
  await press(screen, '이기대 갈맷길 저장 해제');
  page = texts(screen);
  expect(page).not.toContain('이기대 갈맷길');
  expect(page).toContain('저장을 해제했어요');
  await press(screen, '되돌리기');
  expect(texts(screen)).toContain('이기대 갈맷길');
  await press(screen, '민락수변 왕복, 5.4km 33분');
  // The picked course in its chip beside the goal (S15P31E105-683).
  await waitForText(screen, '민락수변 왕복 · 5.4km');
  expect(texts(screen)).toContain('민락수변 왕복 · 5.4km');
  await act(async () => screen.unmount());
});

test('MERGED and BLOCKED saved courses are not started as a normal run', async () => {
  const repositories = withLocation(createMockRepositories({ latencyMs: 0 }));
  const saved = await repositories.courses.getSaved();
  repositories.courses.getSaved = async () => [
    {
      ...saved[0],
      id: 'merged-1',
      myAlias: '합쳐진 코스',
      status: 'MERGED',
      mergedIntoCourseId: '11',
    },
    {
      ...saved[0],
      id: 'blocked-1',
      myAlias: '막힌 코스',
      status: 'BLOCKED',
      mergedIntoCourseId: null,
    },
  ];
  const choose = jest.spyOn(repositories.courses, 'choose');
  const screen = await openTodayRun('default', repositories);
  await press(screen, '저장한 코스');

  await press(screen, '합쳐진 코스, 5.0km 30분');
  expect(texts(screen)).toContain(
    '이 코스는 다른 코스로 합쳐졌어요. 대표 코스를 다시 골라 주세요',
  );
  expect(choose).not.toHaveBeenCalled();

  await press(screen, '막힌 코스, 5.0km 30분');
  expect(texts(screen)).toContain(
    '이 코스는 사용할 수 없어요. 다른 코스를 골라 주세요',
  );
  expect(choose).not.toHaveBeenCalled();
  await act(async () => screen.unmount());
});
