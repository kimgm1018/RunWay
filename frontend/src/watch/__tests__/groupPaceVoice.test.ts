import type { GroupRunLive } from '../../data/types';
import {
  createGroupPaceVoice,
  createPaceVoiceLedger,
  DUPLICATE_WINDOW_MS,
  groupPaceSentence,
  PENDING_EXPIRE_MS,
} from '../groupPaceVoice';

// S15P31E105-906: 그룹런 공동 페이스가 바뀌면 폰이 음성으로 알린다. 첫 값·오류 뒤 첫 값·음성 꺼짐은 말하지 않는다.

const live = (
  pace: number | null,
  over: Partial<GroupRunLive> = {},
): GroupRunLive => ({
  members: [],
  spreadM: null,
  inRange: null,
  guidePaceSecPerKm: pace,
  loadAlert: null,
  status: 'RUNNING',
  ...over,
});

function setup(
  over: { enabled?: boolean; running?: boolean; quiet?: boolean } = {},
) {
  const state = {
    enabled: true,
    running: true,
    quiet: true,
    clock: 1_000_000,
    ...over,
  };
  const spoken: string[] = [];
  const ledger = createPaceVoiceLedger();
  const voice = createGroupPaceVoice(
    {
      enabled: () => state.enabled,
      running: () => state.running,
      canSpeak: () => state.quiet,
      speak: sentence => spoken.push(sentence),
    },
    ledger,
    () => state.clock,
  );
  return { voice, spoken, state, ledger };
}

test('says the new pace when the shared pace gets faster', () => {
  const { voice, spoken } = setup();
  voice.next(live(420));
  voice.next(live(410));
  expect(spoken).toEqual(['공동 페이스를 6분 50초로 올렸어요.']);
});

test('says it was adjusted when the pace slows without a risk reason', () => {
  const { voice, spoken } = setup();
  voice.next(live(410));
  voice.next(live(440));
  expect(spoken).toEqual(['공동 페이스를 7분 20초로 조정했어요.']);
});

test('gives the heart-rate reason when the pace slows and the server reports a load alert', () => {
  const { voice, spoken } = setup();
  voice.next(live(410));
  voice.next(
    live(440, { loadAlert: { memberCount: 1, nextPaceSecPerKm: 440 } }),
  );
  expect(spoken).toEqual(['심박이 높아요. 공동 페이스를 7분 20초로 늦출게요.']);
});

test('a load alert alone never turns a faster pace into the risk line', () => {
  expect(groupPaceSentence(440, 410, true)).toBe(
    '공동 페이스를 6분 50초로 올렸어요.',
  );
  // 정각은 "분"만 읽는다.
  expect(groupPaceSentence(410, 420, false)).toBe(
    '공동 페이스를 7분으로 조정했어요.',
  );
});

test('stays quiet for the first value, an unchanged pace and a null value', () => {
  const { voice, spoken } = setup();
  voice.next(live(420));
  voice.next(live(420));
  voice.next(live(null));
  expect(spoken).toEqual([]);
});

test('the first value after a fetch error is not spoken, the next change is', () => {
  const { voice, spoken } = setup();
  voice.next(live(420));
  voice.reset();
  voice.next(live(400));
  expect(spoken).toEqual([]);
  voice.next(live(390));
  expect(spoken).toEqual(['공동 페이스를 6분 30초로 올렸어요.']);
});

test('a pace changed while the group waits or after it ends only moves the baseline', () => {
  const { voice, spoken } = setup();
  voice.next(live(420, { status: 'SCHEDULED' }));
  voice.next(live(400, { status: 'SCHEDULED' }));
  voice.next(live(400));
  voice.next(live(380, { status: 'COMPLETED' }));
  expect(spoken).toEqual([]);
});

test('says nothing when the voice setting is off and drops what was waiting', () => {
  const { voice, spoken, state } = setup({ enabled: false });
  voice.next(live(420));
  voice.next(live(400));
  state.enabled = true;
  voice.next(live(400));
  expect(spoken).toEqual([]);
});

test('waits while paused or another sentence is being read, then says only the latest pace once', () => {
  const { voice, spoken, state } = setup({ running: false });
  voice.next(live(420));
  voice.next(live(400));
  expect(spoken).toEqual([]);
  state.running = true;
  state.quiet = false;
  voice.next(live(390));
  expect(spoken).toEqual([]);
  state.quiet = true;
  voice.next(live(390));
  // 420 → 390 순변화 한 번.
  expect(spoken).toEqual(['공동 페이스를 6분 30초로 올렸어요.']);
  voice.next(live(390));
  expect(spoken).toHaveLength(1);
});

test('a change that returns to its starting pace while waiting is not spoken', () => {
  const { voice, spoken, state } = setup({ quiet: false });
  voice.next(live(420));
  voice.next(live(400));
  voice.next(live(420));
  state.quiet = true;
  voice.next(live(420));
  expect(spoken).toEqual([]);
});

test('a change that waited too long is dropped as old news', () => {
  const { voice, spoken, state } = setup({ quiet: false });
  voice.next(live(420));
  voice.next(live(400));
  state.clock += PENDING_EXPIRE_MS + 1;
  state.quiet = true;
  voice.next(live(400));
  expect(spoken).toEqual([]);
});

test('does not repeat what the personal coaching voice just said about the same pace', () => {
  const { voice, spoken, state, ledger } = setup();
  voice.next(live(420));
  // 개인 코칭이 방금 6분 50초 안팎을 읽었다.
  ledger.record('coaching', 412, state.clock - 10_000);
  voice.next(live(410));
  expect(spoken).toEqual([]);
  // 다른 페이스로 바뀌면 다시 말한다. 코칭과 거리가 멀면 중복이 아니다.
  voice.next(live(380));
  expect(spoken).toEqual(['공동 페이스를 6분 20초로 올렸어요.']);
});

test('the personal coaching reading is the duplicate once the group voice spoke, and not after the window', () => {
  const { voice, state, ledger } = setup();
  voice.next(live(420));
  voice.next(live(410));
  expect(ledger.echoes('coaching', 412, state.clock)).toBe(true);
  expect(ledger.echoes('coaching', 390, state.clock)).toBe(false);
  expect(
    ledger.echoes('coaching', 412, state.clock + DUPLICATE_WINDOW_MS + 1),
  ).toBe(false);
});
