import type { GroupRunLive } from '../data/types';
import { spokenPace } from '../screens/run/coachingVoice';

// 그룹런 공동 페이스 변경 음성 안내(S15P31E105-906). 워치 진동(groupStatus.ts createPaceChangeTracker, S15P31E105-604)과
// 같은 규칙으로 폰이 판단해 말한다. 워치가 없어도 동작한다.
// - 첫 유효값·값이 없거나 조회 오류(reset) 뒤 첫 값은 기준만 잡고 말하지 않는다. 그룹이 달리는 중일 때만 말한다.
// - 위험 사유: 늦춰질 때 G10 응답에 부담 알림(loadAlert, 심박이 부담인 멤버가 있음)이 같이 오면 사유를 함께 말한다.
// - 지금 말할 수 없으면(코칭·뒤처짐 문장을 읽는 중, 일시정지) 기다렸다가 다음 현황에서 말한다. 설정이 꺼지면 버린다.
// - 개인 코칭 음성과 같은 변화를 두 번 말하지 않는다: PaceVoiceLedger로 서로 직전에 말한 페이스를 본다.

// 같은 페이스로 보는 차이(초/km). 코칭 음성의 CHANGE_SEC(5)와 같다.
export const SAME_PACE_SEC = 5;
// 개인 코칭과 같은 변화를 중복으로 보는 시간(ms). 코칭 재안내 주기(2분)와 같다.
export const DUPLICATE_WINDOW_MS = 120_000;
// 말하지 못하고 기다린 안내가 이 시간이 지나면 지난 소식이라 버린다.
export const PENDING_EXPIRE_MS = 30_000;

type Source = 'group' | 'coaching';

// 두 음성이 마지막으로 말한 페이스를 기억해 같은 변화를 두 번 말하지 않게 한다.
export function createPaceVoiceLedger() {
  const last: Record<Source, { pace: number; at: number } | null> = {
    group: null,
    coaching: null,
  };
  return {
    record: (source: Source, paceSecPerKm: number, now: number = Date.now()) => {
      last[source] = { pace: paceSecPerKm, at: now };
    },
    // source가 말하려는 페이스를 다른 쪽이 최근에 이미 말했는지.
    echoes: (source: Source, paceSecPerKm: number, now: number = Date.now()) => {
      const other = last[source === 'group' ? 'coaching' : 'group'];
      return (
        !!other &&
        now - other.at <= DUPLICATE_WINDOW_MS &&
        Math.abs(other.pace - paceSecPerKm) < SAME_PACE_SEC
      );
    },
    reset: () => {
      last.group = null;
      last.coaching = null;
    },
  };
}
export type PaceVoiceLedger = ReturnType<typeof createPaceVoiceLedger>;

// "6분 50초 페이스" → "6분 50초". 읽기 규칙은 코칭 음성(spokenPace)을 그대로 쓴다.
// 뒤에 '로'를 붙이므로 받침이 있는 '분'으로 끝나면(정각) '으로'가 된다.
const paceWithParticle = (secPerKm: number) => {
  const text = spokenPace(secPerKm).replace(/ 페이스$/, '');
  return text.endsWith('분') ? `${text}으로` : `${text}로`;
};

export function groupPaceSentence(
  from: number,
  to: number,
  risk: boolean,
): string {
  const pace = paceWithParticle(to);
  if (to > from) {
    return risk
      ? `심박이 높아요. 공동 페이스를 ${pace} 늦출게요.`
      : `공동 페이스를 ${pace} 조정했어요.`;
  }
  return `공동 페이스를 ${pace} 올렸어요.`;
}

const validPace = (value: number | null) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null;

export type GroupPaceVoiceOutput = {
  // 음성 코칭 설정(voiceCoachingEnabled)이 켜져 있는지.
  enabled: () => boolean;
  // 내 운동이 달리는 중인지(일시정지면 말하지 않고 기다린다).
  running: () => boolean;
  // 지금 말해도 되는지(voiceIsQuiet). 다른 문장을 읽는 중이면 false.
  canSpeak: () => boolean;
  speak: (sentence: string) => void;
};

// G10 현황마다 next를 부른다. 조회 실패·재구독 때는 reset을 부른다.
export function createGroupPaceVoice(
  out: GroupPaceVoiceOutput,
  ledger?: PaceVoiceLedger,
  now: () => number = Date.now,
) {
  let last: number | null = null;
  // 말하려고 기다리는 변경: from은 마지막으로 알린(또는 기준으로 잡은) 페이스, to는 지금 공동 페이스.
  let pending: { from: number; to: number; at: number } | null = null;

  const next = (live: GroupRunLive) => {
    const pace = validPace(live.guidePaceSecPerKm);
    const from = last;
    last = pace;
    const running = live.status === 'RUNNING';
    if (pace === null || !running) {
      // 값이 없거나 대기·종료 중 바뀐 값은 기준만 갱신한다.
      pending = null;
      return;
    }
    if (from !== null && from !== pace) {
      // 아직 말하지 못한 변경이 있으면 처음 기준에서 지금까지의 순변화로 합친다.
      pending = { from: pending?.from ?? from, to: pace, at: pending?.at ?? now() };
      if (pending.from === pace) {
        pending = null;
      }
    }
    if (!pending) {
      return;
    }
    if (!out.enabled() || now() - pending.at > PENDING_EXPIRE_MS) {
      pending = null;
      return;
    }
    if (!out.running() || !out.canSpeak()) {
      return;
    }
    const { from: base, to } = pending;
    pending = null;
    if (ledger?.echoes('group', to, now())) {
      return;
    }
    out.speak(groupPaceSentence(base, to, to > base && !!live.loadAlert));
    ledger?.record('group', to, now());
  };

  const reset = () => {
    last = null;
    pending = null;
  };
  return { next, reset };
}
