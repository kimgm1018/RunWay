import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import Svg, { Polyline } from 'react-native-svg';
import App from '../App';
import { RunMap } from '../src/components/RunMap';
import {
  createMockRepositories,
  DataError,
  type PhoneFix,
  type Repositories,
} from '../src/data';

// S15P31E105-696: 6.8 그룹런 만들기 takes a course from 3.1's recommendation (its finish time and start locked),
// picks a free run's distance and the finish time on rulers, and shows the goal pace. Synthetic values only.

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.setTimeout(60000);
// The phone's geocoder, with made-up answers (Android only; Jest has none).
jest.mock('../src/data/placeName', () => ({
  placeNameOf: jest.fn(async () => '테스트 광장'),
  placeAddressOf: jest.fn(async () => '부산광역시 수영구 테스트로 1'),
}));

type Screen = TestRenderer.ReactTestRenderer;

const here: PhoneFix = {
  latitude: 35.1551,
  longitude: 129.1301,
  accuracyM: 5,
  altitudeM: null,
  time: Date.UTC(2026, 10, 6, 1, 0, 0),
};

function repositories(): Repositories {
  return {
    ...createMockRepositories({ latencyMs: 0, tickMs: 20 }),
    phoneLocation: {
      start: async () => false,
      stop: async () => undefined,
      subscribe: () => () => undefined,
      requestPermission: async () => true,
      current: async () => here,
    },
  };
}

function lineOf(children: unknown): string {
  return [children]
    .flat(Infinity as 1)
    .map(child =>
      typeof child === 'string' || typeof child === 'number'
        ? String(child)
        : child && typeof child === 'object' && 'props' in child
        ? lineOf((child as { props: { children?: unknown } }).props.children)
        : '',
    )
    .join('');
}

const texts = (screen: Screen) =>
  screen.root
    .findAllByType(Text)
    .map(node => lineOf(node.props.children))
    .join(' ');

function all(screen: Screen, label: string, prop = 'onPress') {
  return screen.root.findAll(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props[prop] === 'function',
  );
}

function labelled(screen: Screen, label: string, prop = 'onPress') {
  const matches = all(screen, label, prop);
  if (matches.length === 0) {
    throw new Error(`No element labelled ${label}`);
  }
  return matches[matches.length - 1];
}

async function settle(ms = 20) {
  await act(() => new Promise<void>(resolve => setTimeout(resolve, ms)));
}

async function until(check: () => boolean, what: string, polls = 300) {
  for (let i = 0; i < polls; i++) {
    if (check()) {
      return;
    }
    await settle(50);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function press(screen: Screen, label: string) {
  await act(async () => {
    labelled(screen, label).props.onPress();
  });
  await settle();
  await settle();
}

// A ruler gives 6.8 its value once it rests (150ms), so each step waits past that.
async function step(screen: Screen, label: string, action: string) {
  await act(async () => {
    labelled(
      screen,
      label,
      'onAccessibilityAction',
    ).props.onAccessibilityAction({ nativeEvent: { actionName: action } });
  });
  await settle(200);
}

async function openCreate(repos: Repositories) {
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(<App repositories={repos} initialSignedIn />);
  });
  await settle();
  await press(screen!, '그룹');
  await settle();
  await press(screen!, '광안리 새벽 크루 그룹런 만들기');
  await until(() => texts(screen!).includes('민락수변공원 출발'), '6.8');
  return screen!;
}

// 6.8 → 코스 추천받기 → 3.1 → 3.1b → 이 코스로 정하기 → back on 6.8.
async function pickRecommended(screen: Screen) {
  await press(screen, '코스 변경');
  await press(screen, '코스 추천받기');
  await until(
    () => all(screen, '코스 추천 받기').some(node => !node.props.disabled),
    '3.1 코스 추천 받기',
  );
  await press(screen, '코스 추천 받기');
  await until(() => all(screen, '이 코스로 정하기').length > 2, '3.1b');
  // Each card has the button on its front and back; [2] is the second card, not today's plan course, which
  // 6.8 would show by default anyway.
  await act(async () => {
    all(screen, '이 코스로 정하기')[2].props.onPress();
  });
  await until(
    () => texts(screen).includes('코스 추천 조건으로 정했어요'),
    'back on 6.8',
  );
}

// The goal-time ruler sits under a view that takes no touches while a recommendation holds it.
const timeLocked = (screen: Screen) =>
  screen.root.findAll(
    node =>
      node.props.pointerEvents === 'none' &&
      node.findAll(child => child.props.accessibilityLabel === '목표 완주 시간')
        .length > 0,
  ).length > 0;

test('6.8 course preview uses the approved community outline', async () => {
  const screen = await openCreate(repositories());
  try {
    const thumbnail = screen.root
      .findAllByType(Svg)
      .find(node => node.props.width === 72 && node.props.height === 46);
    expect(thumbnail).toBeDefined();
    expect(
      thumbnail!.findAllByType(Polyline).map(node => node.props.stroke),
    ).toEqual(['#003A2C', '#00785A', '#B3FFEC', '#4DFFD2']);
  } finally {
    await act(async () => screen.unmount());
  }
});

test('6.8 takes a recommended course with its finish time locked, keeps the meeting place free, and 6.4 marks it', async () => {
  const repos = repositories();
  const save = jest.spyOn(repos.courses, 'save');
  const create = jest.spyOn(repos.groupRuns, 'create');
  const screen = await openCreate(repos);
  // The nearest place filled the meeting place before the course was picked.
  expect(texts(screen)).toContain('광안리해수욕장 입구');
  await pickRecommended(screen);

  expect(save).toHaveBeenCalledTimes(1);
  const storedId = await save.mock.results[0].value;
  // The course card names the picked course, not today's plan course (the defaults must not overwrite it).
  const plan = await repos.courses.getTodayPlan();
  const picked = (await repos.courses.getSaved()).find(
    item => item.id === storedId,
  );
  expect(storedId).not.toBe(plan?.courseId);
  expect(picked).toBeDefined();
  expect(texts(screen)).toContain(
    picked!.name.replace(/\s*\d+(\.\d+)?km$/, ''),
  );
  // 코스 고르기 reads the saved courses again, so the stored course is listed and ticked.
  await settle(50);
  await press(screen, '코스 변경');
  expect(
    screen.root.findAll(
      node =>
        node.props.accessibilityState?.selected === true &&
        typeof node.props.accessibilityLabel === 'string' &&
        node.props.accessibilityLabel.startsWith(`${picked!.name} · `),
    ).length,
  ).toBeGreaterThan(0);
  await act(async () => {
    screen.root
      .findAll(
        node =>
          node.props.accessibilityLabel === '닫기' &&
          typeof node.props.onPress === 'function',
      )
      .pop()!
      .props.onPress();
  });
  await settle();
  expect(timeLocked(screen)).toBe(true);
  // The meeting place need not be the course's start: it stays as set and can still change.
  expect(texts(screen)).toContain('광안리해수욕장 입구');
  expect(labelled(screen, '만나는 곳 변경').props.disabled).not.toBe(true);

  await press(screen, '그룹런 만들기');
  await until(() => create.mock.calls.length > 0, 'G01');
  expect(create.mock.calls[0][0]).toMatchObject({
    courseId: storedId,
    meetingPlaceName: '광안리해수욕장 입구',
  });
  expect(create.mock.calls[0][0].targetDurationSec).toBeGreaterThan(0);
  // 6.4 stands the meeting place over the course, named in its bubble.
  const meeting = create.mock.calls[0][0].meetingPosition;
  await until(
    () =>
      screen.root
        .findAllByType(RunMap)
        .some(
          map =>
            JSON.stringify(map.props.position) === JSON.stringify(meeting) &&
            map.props.placeLabel?.title === '광안리해수욕장 입구',
        ),
    '6.4 map with the meeting place',
  );
  await act(async () => screen.unmount());
});

test('6.8 fills an empty meeting place with the recommended start, named by the geocoder', async () => {
  const repos = repositories();
  // No nearby place, so the meeting place starts empty.
  jest.spyOn(repos.groupRuns, 'searchPlaces').mockResolvedValue([]);
  const create = jest.spyOn(repos.groupRuns, 'create');
  const screen = await openCreate(repos);
  expect(texts(screen)).toContain('만나는 곳 선택');
  await pickRecommended(screen);
  // The start was 현재 위치, which means nothing to the crew: the phone's name and address stand in.
  expect(texts(screen)).toContain('테스트 광장');
  expect(texts(screen)).toContain('부산광역시 수영구 테스트로 1');
  expect(texts(screen)).not.toContain('현재 위치');

  await press(screen, '그룹런 만들기');
  await until(() => create.mock.calls.length > 0, 'G01');
  expect(create.mock.calls[0][0]).toMatchObject({
    meetingPlaceName: '테스트 광장',
    meetingAddress: '부산광역시 수영구 테스트로 1',
    meetingPosition: [here.longitude, here.latitude],
  });
  await act(async () => screen.unmount());
});

test('6.8 frees the finish time once another saved course is picked', async () => {
  const screen = await openCreate(repositories());
  await pickRecommended(screen);
  expect(timeLocked(screen)).toBe(true);

  await press(screen, '코스 변경');
  const row = screen.root.findAll(
    node =>
      typeof node.props.accessibilityLabel === 'string' &&
      / · \d+\.\dkm$/.test(node.props.accessibilityLabel) &&
      typeof node.props.onPress === 'function',
  )[0];
  await act(async () => row.props.onPress());
  await settle();
  expect(timeLocked(screen)).toBe(false);
  expect(texts(screen)).not.toContain('코스 추천 조건으로 정했어요');
  await act(async () => screen.unmount());
});

test('6.9 names a point tapped on the map and gives its address from the geocoder', async () => {
  const repos = repositories();
  const create = jest.spyOn(repos.groupRuns, 'create');
  const screen = await openCreate(repos);
  await press(screen, '만나는 곳 변경');
  const tapped: [number, number] = [129.1186, 35.1532];
  await act(async () => {
    // RunMap's own tap: a [longitude, latitude] point.
    screen.root.findAllByType(RunMap).pop()!.props.onTapMap(tapped);
  });
  await until(
    () => texts(screen).includes('부산광역시 수영구 테스트로 1'),
    'geocoded address',
  );
  expect(texts(screen)).toContain('테스트 광장');
  expect(texts(screen)).not.toContain('지도에서 선택한 위치');

  await press(screen, '이 위치로 정하기');
  await press(screen, '확정');
  await press(screen, '그룹런 만들기');
  await until(() => create.mock.calls.length > 0, 'G01');
  expect(create.mock.calls[0][0]).toMatchObject({
    meetingPlaceName: '테스트 광장',
    meetingAddress: '부산광역시 수영구 테스트로 1',
    meetingPosition: tapped,
  });
  await act(async () => screen.unmount());
});

test('6.8 leaves a private course out of 코스 고르기 and explains a private course refusal', async () => {
  const repos = repositories();
  const pending = repos.courses.getSaved();
  await settle(50);
  const courses = await pending;
  const publicCourse = courses[0];
  const privateCourse = {
    ...courses[1],
    id: 'course-private',
    name: '자유 러닝 코스',
    myAlias: null,
    isPrivate: true,
  };
  jest
    .spyOn(repos.courses, 'getSaved')
    .mockResolvedValue([publicCourse, privateCourse]);
  // The server refuses a private course however it got picked (S15P31E105-552).
  jest
    .spyOn(repos.groupRuns, 'create')
    .mockRejectedValue(
      new DataError('COURSE_INACCESSIBLE', '사용할 수 없는 코스'),
    );
  const screen = await openCreate(repos);
  await press(screen, '코스 변경');
  const rows = screen.root
    .findAll(
      node =>
        typeof node.props.accessibilityLabel === 'string' &&
        / · \d+\.\dkm$/.test(node.props.accessibilityLabel) &&
        typeof node.props.onPress === 'function',
    )
    .map(node => node.props.accessibilityLabel as string);
  expect(rows.some(label => label.startsWith('자유 러닝 코스'))).toBe(false);
  expect(
    rows.some(label =>
      label.startsWith(publicCourse.myAlias ?? publicCourse.name),
    ),
  ).toBe(true);
  await act(async () => {
    screen.root
      .findAll(
        node =>
          node.props.accessibilityLabel === '닫기' &&
          typeof node.props.onPress === 'function',
      )
      .pop()!
      .props.onPress();
  });
  await settle();

  await press(screen, '그룹런 만들기');
  await until(
    () => texts(screen).includes('이 코스는 그룹런에 쓸 수 없어요'),
    'course refusal notice',
  );
  await act(async () => screen.unmount());
});

// Review A-1: today's plan course stands in by default, but not when it is a private (free run's) course.
test('6.8 does not take a private today plan course as its default course', async () => {
  const repos = repositories();
  const pending = Promise.all([
    repos.courses.getTodayPlan(),
    repos.courses.getSaved(),
  ]);
  await settle(50);
  const [plan, courses] = await pending;
  // Today's course is among my saved courses, as a private one made from a free run.
  jest.spyOn(repos.courses, 'getSaved').mockResolvedValue([
    ...courses,
    {
      ...courses[0],
      id: plan!.courseId,
      name: plan!.name,
      myAlias: null,
      isPrivate: true,
    },
  ]);
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(<App repositories={repos} initialSignedIn />);
  });
  await settle();
  await press(screen!, '그룹');
  await settle();
  await press(screen!, '광안리 새벽 크루 그룹런 만들기');
  await until(
    () => texts(screen!).includes('코스 선택'),
    '6.8 without a course',
  );
  expect(texts(screen!)).not.toContain(plan!.name);
  await act(async () => screen!.unmount());
});

test('6.8 saves what the ruler shows even when 그룹런 만들기 is pressed before the drag rests', async () => {
  const repos = repositories();
  const create = jest.spyOn(repos.groupRuns, 'create');
  const screen = await openCreate(repos);
  // No wait after the step: the 150ms settle has not passed when 그룹런 만들기 is pressed.
  await act(async () => {
    labelled(
      screen,
      '목표 완주 시간',
      'onAccessibilityAction',
    ).props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } });
  });
  await press(screen, '그룹런 만들기');
  await until(() => create.mock.calls.length > 0, 'G01');
  expect(create.mock.calls[0][0].targetDurationSec).toBe(41 * 60);
  await act(async () => screen.unmount());
});

test('6.8 picks a free run distance and finish time on rulers and sends them as a TIME goal', async () => {
  const repos = repositories();
  const create = jest.spyOn(repos.groupRuns, 'create');
  const screen = await openCreate(repos);
  await press(screen, '자유 러닝');
  // 5.0km → 5.5km, 40분 → 41분.
  await step(screen, '목표 거리', 'increment');
  await step(screen, '목표 완주 시간', 'increment');
  expect(texts(screen)).toContain('5.5km');
  // 41분 over 5.5km.
  expect(texts(screen)).toContain('7′27″/km');

  await press(screen, '그룹런 만들기');
  await until(() => create.mock.calls.length > 0, 'G01');
  expect(create.mock.calls[0][0]).toMatchObject({
    courseId: null,
    targetDistanceM: 5500,
    targetDurationSec: 41 * 60,
  });
  await act(async () => screen.unmount());
});

// S15P31E105-798 (TEAM QA T32): a start picked earlier that the clock has since passed is caught at the tap, with a
// notice, instead of being sent for the server to refuse.
test('6.8 does not send a start time that passed while the form was open', async () => {
  let current = new Date('2026-10-19T12:45:00+09:00');
  const repos: Repositories = {
    ...repositories(),
    clock: { now: () => current },
  };
  const create = jest.spyOn(repos.groupRuns, 'create');
  const screen = await openCreate(repos);
  // The picked Saturday (10.24) is gone by the next tap.
  current = new Date('2026-10-26T09:00:00+09:00');
  await press(screen, '그룹런 만들기');
  await settle(50);
  expect(create).not.toHaveBeenCalled();
  expect(texts(screen)).toContain('지난 시간이에요');
  await act(async () => screen.unmount());
});

test('6.8 tells the schedule was refused when the server rejects it', async () => {
  const repos = repositories();
  // The server's own message for a start outside the window (no details.fields), S15P31E105-779.
  jest
    .spyOn(repos.groupRuns, 'create')
    .mockRejectedValueOnce(
      new DataError(
        'VALIDATION_ERROR',
        '출발 시각은 지금 이후 13일 안, 05:00~22:00(한국 시간)이어야 합니다.',
        null,
        400,
        {},
      ),
    );
  const screen = await openCreate(repos);
  await press(screen, '그룹런 만들기');
  await settle(50);
  expect(texts(screen)).toContain('날짜·시간을 다시 골라 주세요');
  await act(async () => screen.unmount());
});

// S15P31E105-818: a 400 for the 장소 이름 must not say the date and time are the problem.
test('6.8 tells the 장소 이름 was refused, not that the date is unusable', async () => {
  const repos = repositories();
  jest
    .spyOn(repos.groupRuns, 'create')
    .mockRejectedValueOnce(
      new DataError('VALIDATION_ERROR', '요청 값이 유효하지 않습니다.', null, 400, {
        fields: [{ name: 'meetingPlaceName', reason: '크기가 0에서 200 사이여야 합니다' }],
      }),
    );
  const screen = await openCreate(repos);
  await press(screen, '그룹런 만들기');
  await settle(50);
  expect(texts(screen)).toContain('장소 이름을 확인해 주세요');
  expect(texts(screen)).not.toContain('지금은 쓸 수 없어요');
  await act(async () => screen.unmount());
});

// S15P31E105-818: the edit (G04) answers a 400 the same way, so 저장 does not blame the date and time either.
test('6.8 edit tells the 찾아오는 법 was refused, not that the date is unusable', async () => {
  const repos = repositories();
  const update = jest
    .spyOn(repos.groupRuns, 'update')
    .mockRejectedValueOnce(
      new DataError('VALIDATION_ERROR', '요청 값이 유효하지 않습니다.', null, 400, {
        fields: [{ name: 'description', reason: '크기가 0에서 10000 사이여야 합니다' }],
      }),
    );
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(<App repositories={repos} initialSignedIn />);
  });
  await settle();
  await press(screen!, '그룹');
  await press(screen!, '수요일 회복 조깅, 10.28 수 06:30');
  await press(screen!, '그룹런 수정');
  await until(
    () => all(screen!, '저장').some(node => !node.props.disabled),
    '6.8 edit form',
  );
  await press(screen!, '저장');
  await settle(50);
  expect(update).toHaveBeenCalledTimes(1);
  expect(texts(screen!)).toContain('찾아오는 법을 확인해 주세요');
  expect(texts(screen!)).not.toContain('지금은 쓸 수 없어요');
  await act(async () => screen.unmount());
});
