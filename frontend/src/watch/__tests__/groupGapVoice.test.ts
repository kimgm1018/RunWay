import type { GroupRunLive } from '../../data/types';
import {
  createGroupGapVoice,
  GROUP_GAP_VOICE_BEHIND,
  groupGapVoiceAhead,
} from '../groupGapVoice';

// S15P31E105-771: 그룹장뿐 아니라 후미보다 앞선 모든 러너가 후미의 이름으로 듣는다. 이 파일의 후미 닉네임은 'tail'.
const GROUP_GAP_VOICE_HOST = groupGapVoiceAhead('tail');

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

test('the runner at the tail hears the catch-up line; a runner in the middle hears the tail by name', () => {
  const tail = setup();
  tail.voice.next(live(30, { me: 'tail', host: 'lead' }));
  tail.voice.next(live(55, { me: 'tail', host: 'lead' }));
  expect(tail.spoken).toEqual([GROUP_GAP_VOICE_BEHIND]);

  // S15P31E105-771: 가운데 러너도 후미보다 앞서 있으니 후미의 이름으로 듣는다(전에는 아무것도 듣지 않았다).
  const mid = setup();
  mid.voice.next(live(30, { me: 'mid', host: 'lead' }));
  mid.voice.next(live(80, { me: 'mid', host: 'lead' }));
  expect(mid.spoken).toEqual([groupGapVoiceAhead('tail')]);
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

// S15P31E105-771: 4명 그룹. 선두·2위·3위(그룹장 아님)가 모두 후미 이름으로 한 번씩, 다시 20 m 아래로 내려와 넘을 때만 다시.
function four(
  spread: number,
  me: number,
  over: Partial<Member>[] = [],
): GroupRunLive {
  const progress = [spread, spread * 0.7, spread * 0.3, 0];
  const members: Member[] = progress.map((value, index) => ({
    userId: String(index + 1),
    nickname: ['지우', '민수', '서연', '하준'][index],
    isMe: index + 1 === me,
    isHost: index === 3,
    gapM: value - progress[me - 1],
    paceSecPerKm: 360,
    rank: index + 1,
    stale: false,
    ...over[index],
  }));
  return {
    members,
    spreadM: spread,
    inRange: null,
    guidePaceSecPerKm: 360,
    loadAlert: null,
    status: 'RUNNING',
  };
}

test('every runner ahead of the tail hears the tail by name; the tail (even as host) hears the catch-up line', () => {
  [1, 2, 3].forEach(me => {
    const { voice, spoken } = setup();
    voice.next(four(30, me));
    voice.next(four(55, me));
    voice.next(four(60, me));
    expect(spoken).toEqual(['하준님이 50미터 이상 뒤처졌어요.']);
  });
  const tail = setup();
  tail.voice.next(four(30, 4));
  tail.voice.next(four(55, 4));
  expect(tail.spoken).toEqual([GROUP_GAP_VOICE_BEHIND]);
  expect(GROUP_GAP_VOICE_BEHIND).toContain('선두와 50미터');
});

test('a tail tied with another or without a known name is spoken without a name', () => {
  const tied = setup();
  const tie = [{}, {}, { rank: 4 }, {}];
  tied.voice.next(four(30, 1, tie));
  tied.voice.next(four(55, 1, tie));
  expect(tied.spoken).toEqual([groupGapVoiceAhead(null)]);

  const unknown = setup();
  const noName = [{}, {}, {}, { nickname: '알 수 없음' }];
  unknown.voice.next(four(30, 2, noName));
  unknown.voice.next(four(55, 2, noName));
  expect(unknown.spoken).toEqual(['뒤처진 러너가 50미터 이상 떨어졌어요.']);
});

test('a runner ahead hears again only after the gap closes under 20 m and widens again', () => {
  const { voice, spoken } = setup();
  voice.next(four(30, 2));
  voice.next(four(55, 2));
  voice.next(four(45, 2));
  voice.next(four(58, 2));
  expect(spoken).toHaveLength(1);
  voice.next(four(15, 2));
  voice.next(four(52, 2));
  expect(spoken).toEqual([
    '하준님이 50미터 이상 뒤처졌어요.',
    '하준님이 50미터 이상 뒤처졌어요.',
  ]);
});

test('unknown ranks say nothing and keep the state', () => {
  const { voice, spoken } = setup();
  voice.next(four(30, 1));
  voice.next(four(55, 1, [{}, { rank: null }, {}, {}]));
  expect(spoken).toEqual([]);
  voice.next(four(56, 1));
  expect(spoken).toEqual(['하준님이 50미터 이상 뒤처졌어요.']);
});
