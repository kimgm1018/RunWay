import type { GroupRunLive } from '../../data/types';
import {
  createGroupGapVoice,
  GROUP_GAP_VOICE_BEHIND,
  GROUP_GAP_VOICE_HOST,
} from '../groupGapVoice';

// S15P31E105-735: 그룹런 뒤처짐 음성 안내. 그룹장은 선두–후미 50 m, 뒤처진 본인은 내가 후미이고 선두와 50 m를
// 넘는 순간 한 번 듣고, 20 m 아래로 내려와야 다시 듣는다.

type Member = GroupRunLive['members'][number];

// 선두(1)와 후미(3) 사이 간격 spread. me가 누구인지, 그룹장이 누구인지에 따라 나눈다.
function live(
  spread: number | null,
  { me, host }: { me: 'lead' | 'mid' | 'tail'; host: 'lead' | 'mid' | 'tail' },
  over: Partial<GroupRunLive> = {},
): GroupRunLive {
  const progress = { lead: spread ?? 0, mid: (spread ?? 0) / 2, tail: 0 };
  const mine = progress[me];
  const make = (who: 'lead' | 'mid' | 'tail', rank: number): Member => ({
    userId: who,
    nickname: who,
    isMe: who === me,
    isHost: who === host,
    gapM: spread === null ? null : progress[who] - mine,
    paceSecPerKm: 360,
    rank,
    stale: false,
  });
  return {
    members: [make('lead', 1), make('mid', 2), make('tail', 3)],
    spreadM: spread,
    inRange: null,
    guidePaceSecPerKm: 360,
    loadAlert: null,
    status: 'RUNNING',
    ...over,
  };
}

function setup(
  over: { enabled?: boolean; running?: boolean; quiet?: boolean } = {},
) {
  const state = { enabled: true, running: true, quiet: true, ...over };
  const spoken: string[] = [];
  const voice = createGroupGapVoice({
    enabled: () => state.enabled,
    running: () => state.running,
    canSpeak: () => state.quiet,
    speak: sentence => spoken.push(sentence),
  });
  return { voice, spoken, state };
}

test('the host hears once when the lead and the tail pass 50 m, and again only after closing under 20 m', () => {
  const { voice, spoken } = setup();
  const host = { me: 'lead', host: 'lead' } as const;
  voice.next(live(30, host));
  voice.next(live(55, host));
  voice.next(live(60, host));
  // 기준 근처에서 흔들려도(20 m 아래로 내려오지 않으면) 다시 말하지 않는다.
  voice.next(live(45, host));
  voice.next(live(52, host));
  expect(spoken).toEqual([GROUP_GAP_VOICE_HOST]);
  voice.next(live(15, host));
  voice.next(live(51, host));
  expect(spoken).toEqual([GROUP_GAP_VOICE_HOST, GROUP_GAP_VOICE_HOST]);
});

test('the runner at the tail hears the catch-up line; a runner in the middle hears nothing', () => {
  const tail = setup();
  tail.voice.next(live(30, { me: 'tail', host: 'lead' }));
  tail.voice.next(live(55, { me: 'tail', host: 'lead' }));
  expect(tail.spoken).toEqual([GROUP_GAP_VOICE_BEHIND]);

  const mid = setup();
  mid.voice.next(live(30, { me: 'mid', host: 'lead' }));
  mid.voice.next(live(80, { me: 'mid', host: 'lead' }));
  expect(mid.spoken).toEqual([]);
});

test('a host who is also at the tail hears only the catch-up line', () => {
  const { voice, spoken } = setup();
  voice.next(live(30, { me: 'tail', host: 'tail' }));
  voice.next(live(55, { me: 'tail', host: 'tail' }));
  voice.next(live(56, { me: 'tail', host: 'tail' }));
  expect(spoken).toEqual([GROUP_GAP_VOICE_BEHIND]);
});

test('the first value only sets the baseline: a gap already wide on arrival is not spoken', () => {
  const { voice, spoken } = setup();
  voice.next(live(70, { me: 'lead', host: 'lead' }));
  voice.next(live(75, { me: 'lead', host: 'lead' }));
  expect(spoken).toEqual([]);
});

test('voice coaching off: nothing is spoken, and turning it back on does not replay the old alert', () => {
  const { voice, spoken, state } = setup({ enabled: false });
  const host = { me: 'lead', host: 'lead' } as const;
  voice.next(live(30, host));
  voice.next(live(55, host));
  state.enabled = true;
  voice.next(live(56, host));
  expect(spoken).toEqual([]);
});

test('while coaching is being read the group line waits for the next update instead of cutting it', () => {
  const { voice, spoken, state } = setup({ quiet: false });
  const host = { me: 'lead', host: 'lead' } as const;
  voice.next(live(30, host));
  voice.next(live(55, host));
  expect(spoken).toEqual([]);
  state.quiet = true;
  voice.next(live(57, host));
  expect(spoken).toEqual([GROUP_GAP_VOICE_HOST]);
});

test('a waiting line is dropped if the gap closes first; paused runs wait too', () => {
  const { voice, spoken, state } = setup({ running: false });
  const host = { me: 'lead', host: 'lead' } as const;
  voice.next(live(30, host));
  voice.next(live(55, host));
  voice.next(live(10, host));
  state.running = true;
  voice.next(live(12, host));
  expect(spoken).toEqual([]);
});

test('works without a watch: only the G10 value is needed, and a stale gap changes nothing', () => {
  // 워치 전달(sendGroupStatus) 없이 G10 현황만으로 판단한다. 거리를 모르는 현황은 건너뛴다.
  const { voice, spoken } = setup();
  const host = { me: 'lead', host: 'lead' } as const;
  voice.next(live(30, host));
  voice.next(live(null, host));
  voice.next(live(55, host));
  expect(spoken).toEqual([GROUP_GAP_VOICE_HOST]);
});

test('a finished group run says nothing', () => {
  const { voice, spoken } = setup();
  const host = { me: 'lead', host: 'lead' } as const;
  voice.next(live(30, host, { status: 'COMPLETED' }));
  voice.next(live(55, host, { status: 'COMPLETED' }));
  expect(spoken).toEqual([]);
});

test('reset after a polling error starts over quietly', () => {
  const { voice, spoken } = setup();
  const host = { me: 'lead', host: 'lead' } as const;
  voice.next(live(30, host));
  voice.reset();
  voice.next(live(55, host));
  expect(spoken).toEqual([]);
});
