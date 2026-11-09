import React from 'react';
import { BackHandler, Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import {
  createMockRepositories,
  DataError,
  type MockScenario,
  type RunRecordDraft,
} from '../src/data';
import { formatDotDate, formatDuration } from '../src/format';
import { controlModeOf } from '../src/screens/run/RunProgressScreen';
import type { RunControlState } from '../src/screens/run/runControl';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
// The first React Native render loads lazy host components on this Windows runner.
jest.setTimeout(60000);

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

function textOf(screen: Screen, label: string) {
  const matches = screen.root.findAll(
    node => node.type === Text && node.props.accessibilityLabel === label,
  );
  return String(matches[matches.length - 1].props.children);
}

async function settle(ms = 20) {
  await act(() => new Promise<void>(resolve => setTimeout(resolve, ms)));
}

function shows(screen: Screen, label: string) {
  return (
    screen.root.findAll(
      node =>
        node.props.accessibilityLabel === label &&
        typeof node.props.onPress === 'function',
    ).length > 0
  );
}

// 홈 위젯에도 '러닝 시작'(러닝 방식 선택으로 이동)이 있으므로, 맨 위 화면의 시작 버튼이
// 설정을 받아 활성화된 뒤에 누른다. 코스 화면은 코스 계획을 불러온 뒤에 시작 버튼을 그린다.
function startReady(screen: Screen) {
  const matches = screen.root.findAll(
    node =>
      node.props.accessibilityLabel === '러닝 시작' &&
      typeof node.props.onPress === 'function',
  );
  return (
    matches.length > 0 &&
    matches[matches.length - 1].props.accessibilityState?.disabled === false
  );
}

// 앱 타이머가 낸 갱신은 act가 끝날 때 반영되므로 짧게 나눠 기다리며 조건을 확인한다.
// Poll count (not Date.now) so suite CPU load does not expire the wait early (S15P31E105-565).
async function settleUntil(
  screen: Screen,
  ready: () => boolean,
  what: string,
  maxPolls = 300,
) {
  for (let i = 0; i < maxPolls; i++) {
    if (ready()) {
      return;
    }
    await settle(50);
  }
  throw new Error(
    `${what} 화면이 ${maxPolls}회 대기 안에 열리지 않음: ${texts(screen)}`,
  );
}

async function press(screen: Screen, label: string) {
  await act(async () => {
    labelled(screen, label).props.onPress();
  });
  await settle();
}

async function hold(screen: Screen, label: string) {
  await act(async () => {
    labelled(screen, label, 'onLongPress').props.onLongPress();
  });
  await settle();
}

// Starts a run and waits out the 3·2·1 countdown. Each mock sample is one second of running,
// sent every 50ms here, so the run covers about 55m per real second.
async function startRun(
  kind: 'course' | 'free',
  scenario: MockScenario = 'default',
  repositories = createMockRepositories({
    latencyMs: 0,
    tickMs: 50,
    scenario,
  }),
) {
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <App repositories={repositories} initialSignedIn />,
    );
  });
  // 화면 이동과 mock 응답은 settle의 act가 끝날 때 반영되므로, 고정 시간 대신 누를 대상이 열릴 때까지
  // 기다린다. 부하가 큰 전체 jest 실행에서는 짧은 고정 대기 안에 다음 화면이 준비되지 않는다(S15P31E105-323).
  const open = async (label: string, what: string) => {
    await settleUntil(screen!, () => shows(screen!, label), what);
    await press(screen!, label);
  };
  if (kind === 'course') {
    // 러닝 → 2.0C 저장한 코스 → 3.1c, where a course sets up the run (S15P31E105-564).
    await open('러닝', '홈 탭');
    await open('코스 러닝', '러닝 방식 선택');
    await open('저장한 코스', '코스 러닝 시작');
    await open('광안대교 루프, 5.0km 30분', '저장한 코스 목록');
  } else {
    await open('러닝', '홈 탭');
    await open('자유 러닝', '러닝 방식 선택');
  }
  await settleUntil(screen!, () => startReady(screen!), '러닝 시작 버튼');
  await press(screen!, '러닝 시작');
  // 워치가 실제로 시작하고 서버가 확정한 뒤에 진행 화면으로 넘어간다(S15P31E105-256).
  // 카운트다운 뒤 확정까지는 mock 응답 타이머가 이어지는 비동기 흐름이고, 화면은 settle의 act가 끝날 때만
  // 갱신된다. 고정 시간 대기는 전체 jest 부하에서 확정이 늦으면 진행 화면 전이나 첫 샘플 전에 끝나므로
  // 진행 화면이 열릴 때까지 기다린다(S15P31E105-323).
  await settleUntil(screen!, () => shows(screen!, '일시정지'), '4.2 러닝 진행');
  // 진행 화면이 열릴 때 추적이 시작된다. 50ms 간격 샘플은 이 200ms 대기보다 먼저 도착한다.
  await settle(200);
  return screen!;
}

test('a course run shows live numbers and turn guidance, and no made-up rival gap', async () => {
  const screen = await startRun('course');
  const shown = texts(screen);
  for (const text of [
    '광안대교 루프 5.0km',
    '거리',
    '운동 시간',
    '남은 거리',
    '현재 페이스',
    '평균 페이스',
    // The heart rate stays even with a remaining distance (S15P31E105-517).
    '심박',
    '케이던스',
    // The summary names the goal; the 코칭 page says how the pace stands against it.
    '목표 6′00″',
    // One page per number, then 코칭 (S15P31E105-517).
    '페이스',
    '거리',
    '심박',
    '케이던스',
    '코칭',
    '평균 심박',
    '평균 케이던스',
    // No coaching came from the server, so the page says so instead of a made-up figure.
    '아직 받은 코칭이 없어요',
  ]) {
    expect(shown).toContain(text);
  }
  // 비교 기록을 고르지 않은 러닝은 경쟁 모드·기록 차이를 보이지 않는다(S15P31E105-422, 평균 근사 제거).
  expect(shown).not.toContain('광안대교 루프 5.0km · 경쟁 모드');
  expect(shown).not.toMatch(/(앞서는|뒤처지는) 중/);
  expect(shown).toMatch(/목표보다 \d+초 (빠름|느림)|목표 페이스/);
  expect(shown).toMatch(/앞 .+(직진|왼쪽|오른쪽)/);
  expect(textOf(screen, '현재 페이스')).toMatch(/^\d′\d\d″$/);
  await act(async () => screen.unmount());
});

test('pause stops the clock, 재개 carries on and a long press on 종료 shows the result', async () => {
  const screen = await startRun('course');
  await press(screen, '일시정지');
  expect(texts(screen)).toContain('종료는 1초 길게 눌러야 동작해요');
  const paused = textOf(screen, '운동 시간');
  await settle(300);
  expect(textOf(screen, '운동 시간')).toBe(paused);

  // Letting go early does nothing; finishing needs the hold.
  await act(async () => {
    labelled(screen, '종료', 'onPressIn').props.onPressIn();
    labelled(screen, '종료', 'onPressOut').props.onPressOut();
  });
  await settle();
  expect(texts(screen)).toContain('종료는 1초 길게 눌러야 동작해요');

  // Pausing stays on 4.2: the foot turns into 재개 · 종료 (S15P31E105-517).
  expect(texts(screen)).toContain('현재 페이스');
  await press(screen, '재개');
  await settle(300);
  expect(texts(screen)).not.toContain('종료는 1초 길게 눌러야 동작해요');
  await press(screen, '일시정지');
  const toSeconds = (value: string) =>
    value.split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
  expect(toSeconds(textOf(screen, '운동 시간'))).toBeGreaterThan(
    toSeconds(paused),
  );

  await hold(screen, '종료');
  await settle();
  const result = texts(screen);
  for (const text of [
    // Stopped well before 5km, so the course is not 완주 and no goal line shows.
    '평균 페이스 /km · 목표 6′00″',
    '시간',
    '거리',
    '평균 심박',
    '평균 케이던스',
  ]) {
    expect(result).toContain(text);
  }
  // A good save stays quiet; only a failed one is shown.
  expect(result).not.toContain('기록을 저장하지 못했어요');
  expect(result).not.toContain('달성');
  expect(textOf(screen, '평균 페이스')).toMatch(/^\d′\d\d″$/);

  // The course is already one of mine, so the button starts saved and toggles off and on.
  await press(screen, '내 코스에 저장됨');
  expect(texts(screen)).toContain('내 코스에서 뺐어요');
  await press(screen, '내 코스에 저장');
  expect(texts(screen)).toContain('내 코스에 저장했어요');

  await press(screen, '완료');
  expect(texts(screen)).toContain('오늘 준비도');
  await act(async () => screen.unmount());
});

test('a free run result can be saved as my course, and a failed save offers 다시 저장', async () => {
  const free = await startRun('free');
  expect(texts(free)).toContain('자유 러닝');
  expect(texts(free)).not.toContain('경쟁 모드');
  await press(free, '일시정지');
  await hold(free, '종료');
  await settle();
  expect(texts(free)).toContain('평균 페이스 /km');
  await press(free, '내 코스에 저장');
  expect(texts(free)).toContain('내 코스에 저장했어요');
  expect(texts(free)).toContain('내 코스에 저장됨');
  // 기록 보기 opens the run just saved in 2.1's detail, with its way back to 러닝 기록 (S15P31E105-574).
  await press(free, '기록 보기');
  await settle();
  expect(texts(free)).toContain('기록으로 돌아가기');
  await act(async () => free.unmount());

  const failed = await startRun('free', 'recordSaveFailed');
  await press(failed, '일시정지');
  await hold(failed, '종료');
  await settle();
  expect(texts(failed)).toContain('기록을 저장하지 못했어요');
  expect(labelled(failed, '기록 공유').props.disabled).toBe(true);
  await press(failed, '다시 저장');
  expect(texts(failed)).toContain('기록을 저장하지 못했어요');
  await act(async () => failed.unmount());
});

// S15P31E105-529: with the server the finished run is its session's record (H02). The result confirms it with the
// session id, shows the server's totals, and a record not read back yet is 확인 못 함 with 다시 확인.
test('the result uses the server record of the session, and an unconfirmed one offers 다시 확인', async () => {
  const repositories = createMockRepositories({ latencyMs: 0, tickMs: 50 });
  const drafts: RunRecordDraft[] = [];
  let confirmed = false;
  repositories.run.saveRecord = async draft => {
    drafts.push(draft);
    if (!confirmed) {
      throw new DataError('SAVE_UNCONFIRMED', '기록 확인 실패');
    }
    return {
      recordId: draft.sessionId,
      server: {
        distanceM: 4210,
        durationSec: 1500,
        averagePaceSecPerKm: 356,
        averageHeartRate: 151,
        averageCadence: null,
      },
    };
  };
  // No server API turns a free run into my course yet.
  repositories.courses.saveFromRun = () =>
    Promise.reject(
      new DataError('NOT_AVAILABLE', '자유 러닝 코스 저장 API 없음'),
    );
  const screen = await startRun('free', 'default', repositories);
  await press(screen, '일시정지');
  await hold(screen, '종료');
  await settleUntil(
    screen,
    () => texts(screen).includes('기록 저장을 확인하지 못했어요'),
    '기록 확인 실패',
  );
  expect(drafts[0].sessionId).toEqual(expect.any(String));
  expect(labelled(screen, '기록 공유').props.disabled).toBe(true);

  confirmed = true;
  await press(screen, '다시 확인');
  await settle();
  const page = texts(screen);
  expect(page).not.toContain('확인하지 못했어요');
  // The server's totals replace what the phone counted; a value it does not have keeps the phone's.
  expect(page).toContain('4.21');
  expect(page).toContain('151');
  expect(drafts[1].sessionId).toBe(drafts[0].sessionId);
  expect(labelled(screen, '기록 공유').props.disabled).toBe(false);

  await press(screen, '내 코스에 저장');
  expect(texts(screen)).toContain('자유 러닝 코스 저장은 준비 중이에요');
  expect(texts(screen)).not.toContain('내 코스에 저장됨');
  await act(async () => screen.unmount());
});

// S15P31E105-422: 코스 러닝 준비에서 이 코스의 내 기록 하나를 고르면 S01 comparisonSessionId로 보내고, 고르지 않으면 null이다.
async function courseStartGoal(pick: boolean) {
  const repositories = createMockRepositories({ latencyMs: 0, tickMs: 50 });
  const [first] = await repositories.records.getCourseRuns('any');
  const create = jest.spyOn(repositories.session, 'create');
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <App repositories={repositories} initialSignedIn />,
    );
  });
  const open = async (label: string, what: string) => {
    await settleUntil(screen!, () => shows(screen!, label), what);
    await press(screen!, label);
  };
  await open('러닝', '홈 탭');
  await open('코스 러닝', '러닝 방식 선택');
  await open('저장한 코스', '코스 러닝 시작');
  await open('광안대교 루프, 5.0km 30분', '저장한 코스 목록');
  const chip = `${formatDotDate(first.startedAt)} ${formatDuration(
    first.durationSec,
  )} 기록과 비교`;
  await settleUntil(screen!, () => shows(screen!, chip), '비교 기록 선택');
  expect(texts(screen!)).toContain('이 코스의 내 기록과 비교');
  if (pick) {
    await press(screen!, chip);
    expect(labelled(screen!, chip).props.accessibilityState).toEqual({
      selected: true,
    });
  }
  await settleUntil(screen!, () => startReady(screen!), '러닝 시작 버튼');
  await press(screen!, '러닝 시작');
  await settleUntil(screen!, () => create.mock.calls.length > 0, 'S01 요청');
  const goal = create.mock.calls[0][0].goal;
  await settleUntil(screen!, () => shows(screen!, '일시정지'), '4.2 러닝 진행');
  await settle(200);
  const progress = texts(screen!);
  await act(async () => screen!.unmount());
  return { goal, first, progress };
}

test('a picked earlier run on the course is sent as comparisonSessionId and 4.2 shows the server comparison state', async () => {
  const { goal, first, progress } = await courseStartGoal(true);
  expect(goal.comparisonSessionId).toBe(first.id);
  expect(goal.courseId).not.toBeNull();
  // 목업 세션은 서버처럼 WAITING을 돌려준다. 진행 화면은 평균 근사 대신 그 상태를 보인다.
  expect(progress).toContain('광안대교 루프 5.0km · 경쟁 모드');
  expect(progress).toContain('지난 기록과 비교 준비 중');
  expect(progress).not.toMatch(/(앞서는|뒤처지는) 중/);
});

test('without a pick the course run is created without a comparison', async () => {
  const { goal, progress } = await courseStartGoal(false);
  expect(goal.comparisonSessionId).toBeNull();
  expect(progress).not.toContain('경쟁 모드');
});

// S15P31E105-517: 4.3 is part of 4.2. The foot follows the confirmed state, and a request still waiting for
// the server or watch shows as 확인 중 instead of flipping the state on press.
test('the controls follow the confirmed state and the request still waiting', () => {
  const control = (
    pending: RunControlState['pending'],
    problem: RunControlState['problem'] = null,
  ) => ({ pending, problem } as RunControlState);
  expect(controlModeOf('running', null)).toBe('running');
  expect(controlModeOf('paused', null)).toBe('paused');
  expect(
    controlModeOf('running', control({ action: 'PAUSE', commandId: 'c1' })),
  ).toBe('pausing');
  expect(
    controlModeOf('paused', control({ action: 'RESUME', commandId: 'c2' })),
  ).toBe('resuming');
  expect(
    controlModeOf('paused', control({ action: 'END', commandId: 'c3' })),
  ).toBe('finishing');
  // A request that ended in a problem is not waiting; its notice says what happened.
  expect(
    controlModeOf(
      'running',
      control({ action: 'PAUSE', commandId: 'c1' }, {
        kind: 'unconfirmed',
        action: 'PAUSE',
      } as RunControlState['problem']),
    ),
  ).toBe('running');
});

test('지도 보기 keeps the same run, the back key pauses, and back while paused never resumes', async () => {
  // RN calls back listeners newest first until one handles it; the test does the same.
  const listeners: Array<() => boolean | null | undefined> = [];
  const spy = jest
    .spyOn(BackHandler, 'addEventListener')
    .mockImplementation((_event, handler) => {
      listeners.push(handler);
      return {
        remove: () => {
          const index = listeners.indexOf(handler);
          if (index >= 0) {
            listeners.splice(index, 1);
          }
        },
      };
    });
  const back = async () => {
    await act(async () => {
      for (const listener of [...listeners].reverse()) {
        if (listener()) {
          break;
        }
      }
    });
    await settle();
  };
  const toSeconds = (value: string) =>
    value.split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
  const screen = await startRun('free');
  try {
    await press(screen, '지도 보기');
    expect(shows(screen, '내 위치로 이동')).toBe(true);
    expect(shows(screen, '수치 보기')).toBe(true);
    const before = textOf(screen, '운동 시간');
    await settle(300);
    // The run goes on under the map: the same clock keeps counting.
    expect(toSeconds(textOf(screen, '운동 시간'))).toBeGreaterThan(
      toSeconds(before),
    );
    await press(screen, '수치 보기');
    expect(texts(screen)).toContain('현재 페이스');

    // Running, the back key asks to pause instead of leaving the run.
    await back();
    expect(texts(screen)).toContain('종료는 1초 길게 눌러야 동작해요');
    const paused = textOf(screen, '운동 시간');
    // Paused, the back key keeps it paused: 재개 is only by pressing 재개.
    await back();
    await settle(300);
    expect(texts(screen)).toContain('종료는 1초 길게 눌러야 동작해요');
    expect(textOf(screen, '운동 시간')).toBe(paused);
  } finally {
    spy.mockRestore();
    await act(async () => screen.unmount());
  }
});
