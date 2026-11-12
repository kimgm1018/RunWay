import type { GroupRunLive } from '../data';
import { GROUP_GAP_ALERT_M, GROUP_GAP_REARM_MARGIN_M } from './groupStatus';

// 그룹런 뒤처짐 음성 안내(S15P31E105-735). 워치 진동·문구(S15P31E105-629)와 같은 50 m 기준, 20 m 아래로 내려와야
// 다시 울리는 규칙으로 폰에서 판단해 말한다. 워치가 없어도 동작한다.
// - 그룹장: 선두–후미 간격이 기준을 넘는 순간.
// - 뒤처진 본인: 내가 후미(가장 낮은 순위)이고 선두와의 거리가 기준을 넘는 순간.
// 첫 유효값은 기준만 잡고 말하지 않는다(이미 벌어진 채로 들어와도 조용히). 거리를 모르는 현황은 상태를 바꾸지 않는다.

export const GROUP_GAP_VOICE_HOST =
  '뒤에 멀어진 러너가 있어요. 잠시 속도를 늦춰 주세요.';
export const GROUP_GAP_VOICE_BEHIND =
  '그룹과 50미터 떨어졌어요. 조금만 속도를 올려 볼까요?';

type Role = 'host' | 'behind';

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
    host: createEdge(thresholdM, rearmMarginM),
    behind: createEdge(thresholdM, rearmMarginM),
  };
  const pending: Record<Role, boolean> = { host: false, behind: false };
  const sentence: Record<Role, string> = {
    host: GROUP_GAP_VOICE_HOST,
    behind: GROUP_GAP_VOICE_BEHIND,
  };

  const next = (live: GroupRunLive) => {
    const groupRunning = live.status === undefined || live.status === 'RUNNING';
    const host = live.members.some(
      member => member.isMe && member.isHost === true,
    );
    const gaps: Record<Role, number | null> = {
      host: host ? validGap(live.spreadM) : null,
      behind: behindGap(live),
    };
    (['host', 'behind'] as Role[]).forEach(role => {
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
      pending.host = false;
      pending.behind = false;
      return;
    }
    // 그룹장이 후미이기도 하면 본인 안내가 먼저다(내 속도를 올리는 게 답이다).
    const role: Role | null = pending.behind
      ? 'behind'
      : pending.host
      ? 'host'
      : null;
    if (!role || !out.running() || !out.canSpeak()) {
      return;
    }
    pending[role] = false;
    if (role === 'behind') {
      pending.host = false;
    }
    out.speak(sentence[role]);
  };

  // 조회 실패·재구독: 기준을 비우고 기다리던 안내도 버린다. 다음 값은 조용히 기준만 잡는다.
  const reset = () => {
    edges.host.reset();
    edges.behind.reset();
    pending.host = false;
    pending.behind = false;
  };
  return { next, reset };
}
