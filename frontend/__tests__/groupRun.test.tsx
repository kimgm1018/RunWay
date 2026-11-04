import React from 'react';
import { Text, View } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { createMockRepositories, type MockScenario } from '../src/data';

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
  await settle();
}

async function type(screen: Screen, label: string, text: string) {
  await act(async () => {
    labelled(screen, label, 'onChangeText').props.onChangeText(text);
  });
  await settle();
  await settle();
}

// The group tab pager (a plain View in tests, see jest.setup.js).
function pager(screen: Screen) {
  return screen.root.find(
    node =>
      node.type === View && typeof node.props.onPageSelected === 'function',
  );
}

// A sideways swipe as the native pager reports it: the drag passes halfway, then the page settles.
async function swipeTo(screen: Screen, page: number) {
  const props = pager(screen).props;
  await act(async () => {
    // Between page 0 and 1 the offset is how far page 1 has come in.
    props.onPageScroll({
      nativeEvent: { position: 0, offset: page === 1 ? 0.7 : 0.3 },
    });
  });
  await act(async () => {
    props.onPageSelected({ nativeEvent: { position: page } });
  });
  await settle();
}

function selectedTab(screen: Screen) {
  const tabs = screen.root.findAll(
    node =>
      ['내 크루', '크루 모집'].includes(node.props.accessibilityLabel) &&
      node.props.accessibilityRole === 'tab' &&
      node.props.accessibilityState?.selected === true &&
      typeof node.props.onPress === 'function',
  );
  expect(tabs).toHaveLength(1);
  return tabs[0].props.accessibilityLabel;
}

// Opens 6.0 on the group tab. Run samples come every 20ms.
async function openGroup(scenario: MockScenario = 'default') {
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <App
        repositories={createMockRepositories({
          latencyMs: 0,
          tickMs: 20,
          scenario,
        })}
        initialSignedIn
      />,
    );
  });
  await settle();
  await press(screen!, '그룹');
  await settle();
  return screen!;
}

test('6.0 pins the next run, lists each crew and joins a run; 6.0b points to crew recruiting', async () => {
  const screen = await openGroup();
  let page = texts(screen);
  for (const text of [
    '내 크루',
    '크루 모집',
    '광안리 새벽 크루',
    '토요일 아침, 함께 5km',
    '10.24 토 07:00 · 광안리해수욕장 입구 · 편의점 앞',
    '수요일 회복 조깅',
    '10.28 수 06:30 · 민락수변공원 주차장 입구',
    '민락 야경 러너스',
    '승인 대기',
    '크루장이 승인하면 그룹런이 보여요',
  ]) {
    expect(page).toContain(text);
  }
  // The run pinned in '곧 출발' is not listed again, and the list leaves the course to 6.4.
  // 곧 출발 shows the crew, time and place; the run's title is only in its label.
  expect(page).toContain('13:00 · 광안리해수욕장 입구');
  expect(() =>
    labelled(screen, '월요일 점심, 함께 5km, 15분 뒤 출발'),
  ).not.toThrow();
  expect(page).not.toContain('월요일 점심, 함께 5km');
  expect(page).toContain('성윤님이 만듦');
  expect(page).toContain('내가 만듦');
  expect(page).not.toContain('코스 러닝 · 민락수변공원 출발 5.0km');
  // Crew heads show the name only; area and members are on 6.2.
  expect(page).not.toContain('광안리 · 멤버 18');
  // The second crew starts folded.
  expect(page).not.toContain('월요일 야경 7km');
  await press(screen, '민락 야경 러너스 펴기');
  expect(texts(screen)).toContain('월요일 야경 7km');
  await press(screen, '월요일 야경 7km 참가하기');
  page = texts(screen);
  expect(page).toContain('참가 10명');
  expect(() => labelled(screen, '월요일 야경 7km 참가 취소')).not.toThrow();

  // The round search button beside the tabs narrows my crews by name or area.
  await press(screen, '내 크루 검색 열기');
  await type(screen, '내 크루 검색', '민락');
  page = texts(screen);
  expect(page).toContain('민락 야경 러너스');
  expect(page).not.toContain('남천 회복 조깅 크루장이');
  expect(() => labelled(screen, '대기방 입장')).toThrow();
  await type(screen, '내 크루 검색', '없는 크루');
  expect(texts(screen)).toContain('찾는 크루가 없어요.');
  await press(screen, '검색 닫기');
  expect(texts(screen)).toContain('크루장이 승인하면 그룹런이 보여요');
  await act(async () => screen.unmount());

  const empty = await openGroup('noCrews');
  page = texts(empty);
  expect(page).toContain('혼자 달리던 길, 같이 달려 볼까요');
  expect(page).toContain('내 근처 크루 8곳이 모집 중');
  await press(empty, '크루 모집 보러 가기');
  expect(texts(empty)).toContain('광안리 새벽 크루 18/30명');
  await act(async () => empty.unmount());
});

test('6.1 lists every crew, open ones before full ones, and searches by name or area', async () => {
  const screen = await openGroup();
  await press(screen, '크루 모집');
  let page = texts(screen);
  expect(page).toContain('광안리 새벽 크루 18/30명');
  expect(page).toContain('해운대 선셋 런');
  expect(page.indexOf('남천 회복 조깅')).toBeLessThan(
    page.indexOf('정원 마감 수영강 하프 크루 200/200명'),
  );
  // 내 근처 is gone: the server has no location filter.
  expect(() => labelled(screen, '내 근처')).toThrow();

  // Search is a round button that opens into the field.
  expect(() => labelled(screen, '크루 검색')).toThrow();
  await press(screen, '크루 검색 열기');
  await type(screen, '크루 검색', '해운대');
  page = texts(screen);
  expect(page).toContain('해운대 선셋 런');
  expect(page).not.toContain('광안리 새벽 크루 18/30명');
  await type(screen, '크루 검색', '없는 크루');
  expect(texts(screen)).toContain('찾는 크루가 없어요.');
  // Closing the search clears it.
  await press(screen, '검색 닫기');
  expect(texts(screen)).toContain('광안리 새벽 크루 18/30명');
  await act(async () => screen.unmount());
});

test('6.0·6.1 sit side by side in one pager: swipes and tab taps switch pages and the tab follows', async () => {
  const screen = await openGroup();
  expect(selectedTab(screen)).toBe('내 크루');
  // Both pages are rendered, so the next one is already there under the finger.
  let page = texts(screen);
  expect(page).toContain('광안리 새벽 크루');
  expect(page).toContain('광안리 새벽 크루 18/30명');

  // Halfway through a swipe the tab already shows the page coming in.
  await act(async () => {
    pager(screen).props.onPageScroll({
      nativeEvent: { position: 0, offset: 0.6 },
    });
  });
  expect(selectedTab(screen)).toBe('크루 모집');
  await act(async () => {
    pager(screen).props.onPageScroll({
      nativeEvent: { position: 0, offset: 0.2 },
    });
  });
  expect(selectedTab(screen)).toBe('내 크루');

  await swipeTo(screen, 1);
  expect(selectedTab(screen)).toBe('크루 모집');
  await swipeTo(screen, 0);
  expect(selectedTab(screen)).toBe('내 크루');

  // Tabs move the pager too, and the pager stays the only group screen.
  await press(screen, '크루 모집');
  expect(selectedTab(screen)).toBe('크루 모집');
  await press(screen, '내 크루');
  expect(selectedTab(screen)).toBe('내 크루');
  expect(
    screen.root.findAll(
      node =>
        node.type === View && typeof node.props.onPageSelected === 'function',
    ),
  ).toHaveLength(1);
  await act(async () => screen.unmount());
});

test('links to 크루 모집 or 내 크루 open that page of the group tab, again after swiping away', async () => {
  const screen = await openGroup('noCrews');
  await press(screen, '크루 모집 보러 가기');
  expect(selectedTab(screen)).toBe('크루 모집');
  await swipeTo(screen, 0);
  expect(selectedTab(screen)).toBe('내 크루');
  await press(screen, '크루 모집 보러 가기');
  expect(selectedTab(screen)).toBe('크루 모집');

  await press(screen, '광안리 새벽 크루, 모집 중 18/30명');
  await press(screen, '가입 신청');
  await press(screen, '내 크루로');
  await settle(100);
  expect(selectedTab(screen)).toBe('내 크루');
  expect(texts(screen)).toContain('크루장이 승인하면 그룹런이 보여요');
  await act(async () => screen.unmount());
});

test('6.2 shows my crew, the leader view (6.2m) and a full crew that cannot take requests (6.2f·6.2x)', async () => {
  const screen = await openGroup();
  await press(screen, '크루 모집');
  await press(screen, '광안리 새벽 크루, 모집 중 18/30명');
  let page = texts(screen);
  expect(page).toContain('모집 중 18/30 · 승인제');
  expect(page).toContain('성윤');
  expect(page).not.toContain('민준 (나)');
  expect(() =>
    labelled(screen, '가입한 크루예요 · 내 크루에서 보기'),
  ).not.toThrow();
  await press(screen, '구성원 18명 모두 보기');
  page = texts(screen);
  expect(page).toContain('민준 (나)');
  expect(page).toContain('접기');

  await press(screen, '뒤로');
  await press(screen, '민락 야경 러너스, 모집 중 24/30명');
  expect(texts(screen)).toContain('가입 신청 2건');

  await press(screen, '뒤로');
  await press(screen, '수영강 하프 크루, 정원 마감 200/200명');
  expect(texts(screen)).toContain('정원 마감 200/200');
  await press(screen, '가입 신청 · 정원 마감');
  page = texts(screen);
  expect(page).toContain('정원이 가득 찼어요');
  await press(screen, '다른 크루 둘러보기');
  expect(texts(screen)).toContain('원하는 크루가 없나요?');
  await act(async () => screen.unmount());
});

test('6.2 sends a join request (6.2b) and 6.0 shows the crew as 승인 대기', async () => {
  const screen = await openGroup('noCrews');
  await press(screen, '크루 모집 보러 가기');
  await press(screen, '광안리 새벽 크루, 모집 중 18/30명');
  expect(texts(screen)).not.toContain('민준 (나)');
  await press(screen, '가입 신청');
  expect(texts(screen)).toContain('가입 신청을 보냈어요');
  await press(screen, '내 크루로');
  await settle(100);
  const page = texts(screen);
  expect(page).toContain('승인 대기');
  expect(page).toContain('크루장이 승인하면 그룹런이 보여요');
  await act(async () => screen.unmount());
});

test('6.2m saves the capacity and 6.2a approves a request and switches to 바로 가입', async () => {
  const screen = await openGroup();
  await press(screen, '크루 모집');
  await press(screen, '민락 야경 러너스, 모집 중 24/30명');
  expect(texts(screen)).toContain('크루장만 보여요');
  const save = () => labelled(screen, '저장');
  expect(save().props.disabled).toBe(true);
  // Below the 24 members is not allowed.
  await type(screen, '정원', '20');
  expect(save().props.disabled).toBe(true);
  await type(screen, '정원', '26');
  expect(save().props.disabled).toBe(false);
  await press(screen, '저장');
  await settle(50);
  expect(texts(screen)).toContain('모집 중 24/26 · 승인제');

  await press(screen, '가입 신청 2건');
  let page = texts(screen);
  expect(page).toContain('하린 · harin07');
  expect(page).toContain('중급 · 최근 5km 5′56″ · 3분 전 신청');
  expect(page).toContain('초급 · 첫 크루 · 10.17 신청');
  await press(screen, '하린 승인');
  await settle(50);
  page = texts(screen);
  expect(page).toContain('하린님이 크루 멤버가 됐어요');
  expect(page).toContain('1건');
  await press(screen, '바로 가입');
  await settle(50);

  await press(screen, '뒤로');
  await settle(50);
  page = texts(screen);
  expect(page).toContain('모집 중 25/26 · 바로 가입');
  expect(page).toContain('가입 신청 1건');
  await act(async () => screen.unmount());
});

test('6.4 shows a run and its creator cancels it through 6.4c and 6.4d to 6.4e', async () => {
  const screen = await openGroup();
  await press(screen, '토요일 아침, 함께 5km, 10.24 토 07:00');
  let page = texts(screen);
  for (const text of [
    '6명 참가',
    'D-5',
    '광안리 새벽 크루',
    '10.24 토 07:00',
    '광안리해수욕장 입구 · 편의점 앞',
    '부산 수영구 광안해변로 219',
    '민락수변공원 출발 5.0km',
    '페이스 6′00″',
    '크루 멤버 18명 중',
    '내 페이스와 잘 맞아요',
    '최근 5km 평균 5′56″ · 준비도 82',
    '대기방은 10.24 토 06:30에 열려요',
    '참가 취소',
  ]) {
    expect(page).toContain(text);
  }
  expect(page).not.toContain('내가 만든 그룹런');
  await press(screen, '참가 취소');
  expect(texts(screen)).toContain('5명 참가');
  await press(screen, '뒤로');

  await press(screen, '수요일 회복 조깅, 10.28 수 06:30');
  expect(texts(screen)).toContain('내가 만든 그룹런');
  await press(screen, '그룹런 취소');
  page = texts(screen);
  expect(page).toContain('참가자 3명과 크루 멤버에게 취소 알림이 가요.');
  expect(labelled(screen, '그룹런 취소하기').props.disabled).toBe(true);
  await press(screen, '날씨');
  await press(screen, '그룹런 취소하기');
  expect(texts(screen)).toContain('그룹런을 취소할까요?');
  await press(screen, '취소하기');
  await settle();
  page = texts(screen);
  expect(page).toContain('취소됨');
  expect(page).toContain('사유 · 날씨');
  expect(page).toContain('크루 멤버 18명에게 취소 알림을 보냈어요');
  await press(screen, '내 크루로');
  expect(texts(screen)).not.toContain('수요일 회복 조깅');
  await act(async () => screen.unmount());
});

test('6.8 makes a run with a place picked on 6.9', async () => {
  const screen = await openGroup();
  await press(screen, '광안리 새벽 크루 그룹런 만들기');
  await waitForText(screen, '민락수변공원 출발');
  let page = texts(screen);
  for (const text of [
    '그룹런 만들기',
    '민락수변공원 출발',
    '광안리해수욕장 입구',
    '10.24 토',
    '오전 07:00',
    '자동 산출',
  ]) {
    expect(page).toContain(text);
  }
  await press(screen, '만나는 곳 변경');
  await type(screen, '장소·주소 검색', '수영강');
  await press(screen, '수영강 APEC나루공원 입구');
  await press(screen, '이 위치로 정하기');
  expect(texts(screen)).toContain('위치 확정');
  await type(screen, '찾아오는 법 · 선택', '공원 입구 안내판 앞');
  await press(screen, '확정');
  expect(texts(screen)).toContain('수영강 APEC나루공원 입구');

  await press(screen, '자유 러닝');
  await press(screen, '50분');
  await press(screen, '그룹런 만들기');
  await settle();
  page = texts(screen);
  expect(page).toContain('토요일, 함께 50분');
  expect(page).toContain('자유 러닝 · 50분');
  expect(page).toContain('내가 만든 그룹런');
  await act(async () => screen.unmount());
});

test('6.5 → 6.6 → 6.6c → 6.7: ready, start together, see members and finish', async () => {
  const screen = await openGroup();
  await press(screen, '대기방 입장');
  let page = texts(screen);
  for (const text of [
    '출발 준비',
    '공동 페이스',
    'AI 제안 · 참가자 기록 기준',
    '참가 신청 5명 · 대기방 4명',
    '2명 준비 완료',
    '준비도 82',
  ]) {
    expect(page).toContain(text);
  }
  await press(screen, '준비 완료');
  expect(texts(screen)).toContain('3명 준비 완료');
  // The leader starts, then 3·2·1.
  await waitForText(screen, '그룹장이 출발했어요');
  expect(texts(screen)).toContain('그룹장이 출발했어요');
  await waitForText(screen, '내 페이스');
  // The guide-pace alert arrives with a later tracking sample.
  await waitForText(screen, '지금 안내 6′15″ · 출발 목표 6′00″');
  page = texts(screen);
  expect(page).toContain('내 페이스');
  expect(page).toContain('민락수변공원 출발 5.0km · 그룹런 4명');
  expect(page).toContain('그룹 범위 안이에요 · 선두–후미');
  // After the load alert (6.6b) the group follows a slower guide pace; the start goal stays.
  expect(page).toContain('지금 안내 6′15″ · 출발 목표 6′00″');

  await press(screen, '위치·간격');
  page = texts(screen);
  expect(page).toContain('앞에서부터 · 순위 아님');
  expect(page).toContain('선두');
  expect(page).toContain('후미');

  await press(screen, '일시정지');
  page = texts(screen);
  expect(page).toContain('그룹런 일시정지');
  expect(page).toContain(
    '일시정지·종료는 내 기록에만 적용돼요.\n다른 멤버는 계속 달려요.',
  );
  expect(page).not.toContain('그룹 전체 강제 종료');
  await act(async () => {
    labelled(screen, '종료', 'onLongPress').props.onLongPress();
  });
  await settle(100);
  page = texts(screen);
  expect(page).toContain('4명 중 2명 완주했어요');
  expect(page).toContain('함께 달린 거리');
  expect(page).toContain('성윤');
  expect(page).toContain('3.8km에서 중단');
  expect(page).toContain('이번 내 기록은 내 기록 › 그룹런 탭에 남아요');
  await press(screen, '완료');
  expect(texts(screen)).toContain('광안리 새벽 크루');
  await act(async () => screen.unmount());
});

test('6.3 makes a crew I lead, and 6.0 opens its own 6.2', async () => {
  const screen = await openGroup();
  await press(screen, '크루 모집');
  await press(screen, '크루 만들기');
  const create = () => labelled(screen, '크루 만들기');
  expect(create().props.disabled).toBe(true);
  await type(screen, '크루 이름', '광안리 주말 러너스');
  await type(screen, '지역 검색', '광안리');
  await press(screen, '광안리해수욕장 입구');
  await press(screen, '모집 인원 늘리기');
  expect(texts(screen)).toContain('21');
  expect(create().props.disabled).toBe(false);
  await press(screen, '크루 만들기');
  await settle(100);
  let page = texts(screen);
  expect(page).toContain('광안리 주말 러너스');

  await press(screen, '광안리 주말 러너스 크루 상세');
  page = texts(screen);
  expect(page).toContain('모집 중 1/21 · 승인제');
  expect(page).toContain('민준 (나)');
  expect(page).toContain('가입 신청 0건');
  await act(async () => screen.unmount());
});
