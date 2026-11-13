import type { GroupRunLive } from '../data';
import { GROUP_GAP_ALERT_M, GROUP_GAP_REARM_MARGIN_M } from './groupStatus';

// 그룹런 뒤처짐 음성 안내(S15P31E105-735). 워치 진동·문구(S15P31E105-629)와 같은 50 m 기준, 20 m 아래로 내려와야
// 다시 울리는 규칙으로 폰에서 판단해 말한다. 워치가 없어도 동작한다.
// - 후미보다 앞선 모든 러너(그룹장 포함, S15P31E105-771): 선두–후미 간격이 기준을 넘는 순간 '{이름}님이 뒤처졌어요'.
// - 뒤처진 본인: 내가 후미(가장 낮은 순위)이고 선두와의 거리가 기준을 넘는 순간.
// 워치 진동·문구는 지금처럼 그룹장 워치에만 간다(groupStatus.ts createGapAlertTracker).
// 첫 유효값은 기준만 잡고 말하지 않는다(이미 벌어진 채로 들어와도 조용히). 거리를 모르는 현황은 상태를 바꾸지 않는다.

// 후미보다 앞선 러너: 후미의 이름을 알면 이름과 함께, 모르면(동순위 여럿·닉네임 없음) 이름 없이.
export const groupGapVoiceAhead = (name: string | null) =>
  name
    ? `${name}님이 50미터 이상 뒤처졌어요.`
    : '뒤처진 러너가 50미터 이상 떨어졌어요.';
// 기준이 선두–후미 거리라 '선두와'라고 말한다(S15P31E105-771).
export const GROUP_GAP_VOICE_BEHIND =
  '선두와 50미터 이상 떨어졌어요. 조금만 속도를 올려 볼까요?';

type Role = 'ahead' | 'behind';

// api/groupRuns.ts가 닉네임을 모를 때 넣는 값. 이 값은 이름으로 말하지 않는다.
const UNKNOWN_NICKNAME = '알 수 없음';

// 지금 가장 뒤에서 달리는 멤버의 닉네임(groupStatus.ts lastRunnerName과 같은 규칙). 순위가 없거나 동순위가
// 여럿이거나 나 자신이면 null.
function tailName(live: GroupRunLive): string | null {
  const ranked = live.members.filter(
    member =>
      member.stale !== true &&
      typeof member.rank === 'number' &&
      member.rank >= 1,
  );
  if (ranked.length === 0) {
    return null;
  }
  const lastRank = Math.max(...ranked.map(member => member.rank as number));
  const last = ranked.filter(member => member.rank === lastRank);
  const name =
    last.length === 1 && !last[0].isMe ? last[0].nickname.trim() : '';
  return name && name !== UNKNOWN_NICKNAME ? name : null;
}

// 내가 후미보다 앞(순위가 후미보다 높음)이면 선두–후미 간격, 내가 후미면 0(기준 아래 = 다시 울릴 수 있음).
// 간격이나 누구의 순위라도 모르면 null.
function aheadGap(live: GroupRunLive): number | null {
  const spread = validGap(live.spreadM);
  const me = live.members.find(member => member.isMe);
  const ranks = live.members.map(member => member.rank);
  if (
    spread === null ||
    !me ||
    typeof me.rank !== 'number' ||
    ranks.some(rank => typeof rank !== 'number')
  ) {
    return null;
  }
  const lastRank = Math.max(...(ranks as number[]));
  return live.members.length >= 2 && me.rank < lastRank ? spread : 0;
}

const validGap = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;

// 기준을 넘을 때 한 번, 기준-여유 아래로 내려와야 다시. 52 m 근처에서 흔들려도 다시 말하지 않는다.
function createEdge(thresholdM: number, rearmMarginM: number) {
  let seen = false;
  let armed = false;
  let widened = false;
  const next = (gap: number) => {
    let isNew = false;
    if (!seen) {
      seen = true;
      armed = gap <= thresholdM;
    } else if (armed && gap > thresholdM) {
      armed = false;
      widened = true;
      isNew = true;
    } else if (!armed && gap < thresholdM - rearmMarginM) {
      armed = true;
      widened = false;
    }
    return { isNew, widened };
  };
  const reset = () => {
    seen = false;
    armed = false;
    widened = false;
  };
  return { next, reset };
}

// 내가 후미일 때 선두와의 거리. 지연·순위 없는 멤버가 있으면(선두–후미 간격이 없으면) 모른다(null).
// 내가 후미가 아니면 0(기준 아래 = 다시 울릴 수 있음).
function behindGap(live: GroupRunLive): number | null {
  if (validGap(live.spreadM) === null) {
    return null;
  }
  const me = live.members.find(member => member.isMe);
  const ranks = live.members.map(member => member.rank);
  if (
    !me ||
    typeof me.rank !== 'number' ||
    ranks.some(rank => typeof rank !== 'number')
  ) {
    return null;
  }
  const lastRank = Math.max(...(ranks as number[]));
  if (live.members.length < 2 || me.rank !== lastRank || me.rank === 1) {
    return 0;
  }
  // gapM은 그 멤버의 진행 거리 − 내 진행 거리. 가장 큰 값이 선두와의 거리다.
  const gaps = live.members.map(member => validGap(member.gapM));
  if (gaps.some(gap => gap === null)) {
    return null;
  }
  return Math.max(...(gaps as number[]));
}

export type GroupGapVoiceOutput = {
  // 음성 코칭 설정(voiceCoachingEnabled)이 켜져 있는지.
  enabled: () => boolean;
  // 내 운동이 달리는 중인지(일시정지면 말하지 않고 기다린다).
  running: () => boolean;
  // 지금 말해도 되는지. 코칭 문장을 읽는 중이면 false: 그룹 안내가 코칭을 끊지 않고 다음 현황에서 다시 본다.
  canSpeak: () => boolean;
  speak: (sentence: string) => void;
};

// G10 현황마다 next를 부른다. 알릴 일이 생겼는데 지금 말할 수 없으면(코칭 중·일시정지) 기다렸다가, 여전히
// 벌어져 있는 동안 다음 현황에서 말한다. 간격이 다시 좁혀지면 말하지 않고 버린다. 설정이 꺼져 있으면 버린다.
export function createGroupGapVoice(
  out: GroupGapVoiceOutput,
  thresholdM: number = GROUP_GAP_ALERT_M,
  rearmMarginM: number = GROUP_GAP_REARM_MARGIN_M,
) {
  const edges: Record<Role, ReturnType<typeof createEdge>> = {
    ahead: createEdge(thresholdM, rearmMarginM),
    behind: createEdge(thresholdM, rearmMarginM),
  };
  const pending: Record<Role, boolean> = { ahead: false, behind: false };

  const next = (live: GroupRunLive) => {
    const groupRunning = live.status === undefined || live.status === 'RUNNING';
    const gaps: Record<Role, number | null> = {
      ahead: aheadGap(live),
      behind: behindGap(live),
    };
    (['ahead', 'behind'] as Role[]).forEach(role => {
      const gap = gaps[role];
      if (gap === null) {
        return;
      }
      const { isNew, widened } = edges[role].next(gap);
      if (isNew && groupRunning) {
        pending[role] = true;
      }
      if (!widened || !groupRunning) {
        pending[role] = false;
      }
    });
    if (!out.enabled()) {
      pending.ahead = false;
      pending.behind = false;
      return;
    }
    // 둘 다 기다리면(순위가 바뀐 직후) 본인 안내가 먼저다(내 속도를 올리는 게 답이다).
    const role: Role | null = pending.behind
      ? 'behind'
      : pending.ahead
      ? 'ahead'
      : null;
    if (!role || !out.running() || !out.canSpeak()) {
      return;
    }
    pending[role] = false;
    if (role === 'behind') {
      pending.ahead = false;
    }
    out.speak(
      role === 'behind'
        ? GROUP_GAP_VOICE_BEHIND
        : groupGapVoiceAhead(tailName(live)),
    );
  };

  // 조회 실패·재구독: 기준을 비우고 기다리던 안내도 버린다. 다음 값은 조용히 기준만 잡는다.
  const reset = () => {
    edges.ahead.reset();
    edges.behind.reset();
    pending.ahead = false;
    pending.behind = false;
  };
  return { next, reset };
}
