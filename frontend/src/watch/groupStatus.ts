import type { GroupRunLive, WatchGroupStatus } from '../data/types';

// G10 현황 → 워치 GROUP_STATUS(9.3, S15P31E105-420). 순위·격차·공동 페이스는 서버 값을 옮기기만 하고 계산하지 않는다.
// 선두–후미 거리는 폰 그룹 화면과 같은 값(spreadM)을 보내 두 기기의 표시를 맞춘다.
// 순위가 없거나 지연된(stale) 내 항목은 standing을 비워 보내고, 워치가 마지막 값을 지연으로 표시한다.
// 취소된 그룹은 세션 취소(STATE_RESULT)로 알리므로 보내지 않는다(null).
export function watchGroupStatus(
  groupRunId: string,
  live: GroupRunLive,
  paceChanged: WatchGroupStatus['paceChanged'] = null,
  gapWidened: WatchGroupStatus['gapWidened'] = null,
): WatchGroupStatus | null {
  const phase =
    live.status === 'SCHEDULED'
      ? 'WAITING'
      : live.status === 'RUNNING'
      ? 'RUNNING'
      : live.status === 'COMPLETED'
      ? 'FINISHED'
      : null;
  if (!phase) {
    return null;
  }
  const me = live.members.find(member => member.isMe);
  const rankedCount = live.members.filter(
    member => member.stale !== true && typeof member.rank === 'number' && member.rank >= 1,
  ).length;
  const rank = me?.rank;
  const ranked =
    !!me && me.stale !== true && typeof rank === 'number' && Number.isInteger(rank) && rank >= 1;
  return {
    groupRunId,
    phase,
    guidePaceSecPerKm: live.guidePaceSecPerKm,
    standing: ranked
      ? {
          rank: rank as number,
          aheadCount: me.aheadCount ?? null,
          behindCount: me.behindCount ?? null,
          gapToAheadM: me.gapToAheadM ?? null,
          gapToBehindM: me.gapToBehindM ?? null,
        }
      : null,
    stale: !me || me.stale !== false,
    leaderToLastGapM: live.spreadM,
    updatedAt: live.updatedAt ?? null,
    rankedCount: rankedCount > 0 ? rankedCount : null,
    paceChanged,
    gapWidened,
  };
}

const validPace = (value: number | null) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null;

// 공동 페이스 변경 판단(GRP-006·WAT-005, S15P31E105-604). 한 번의 연속 G10 조회 동안만 쓴다.
// 직전 유효값과 정수로 비교해 달라졌을 때만 {from,to}를 낸다. 첫 수신·null→값·같은 값은 null이다.
// null·조회 오류(reset) 뒤에는 기준을 비워 다음 유효값을 조용히 반영한다. 조회를 새로 시작하면(앱 재진입) 새로 만들어
// 지난 변경을 다시 알리지 않는다. 그룹이 달리는 중일 때만 알리며, 대기 중 바뀐 값은 기준값만 갱신한다.
export function createPaceChangeTracker() {
  let last: number | null = null;
  const next = (live: GroupRunLive): WatchGroupStatus['paceChanged'] => {
    const pace = validPace(live.guidePaceSecPerKm);
    const from = last;
    last = pace;
    return pace !== null && from !== null && from !== pace && live.status === 'RUNNING'
      ? { from, to: pace }
      : null;
  };
  const reset = () => {
    last = null;
  };
  return { next, reset };
}

// 그룹 간격 벌어짐 알림(S15P31E105-629, 604와 같은 방식). 시연 때는 이 두 값만 바꾼다.
// 선두–후미 거리가 GROUP_GAP_ALERT_M을 넘는 순간 1회 알리고, GROUP_GAP_ALERT_M - GROUP_GAP_REARM_MARGIN_M 아래로
// 내려와야 다시 알릴 수 있다(히스테리시스: 기준 근처에서 흔들려도 다시 울리지 않는다).
export const GROUP_GAP_ALERT_M = 50;
export const GROUP_GAP_REARM_MARGIN_M = 30;

// api/groupRuns.ts가 닉네임을 모를 때 넣는 값. 이 값은 이름으로 보이지 않는다.
const UNKNOWN_NICKNAME = '알 수 없음';

const validGap = (value: number | null) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

// 지금 가장 뒤에서 달리는 멤버의 닉네임. 순위가 없거나 동순위가 여럿이거나 나 자신이면 null(일반 문구를 쓴다).
function lastRunnerName(live: GroupRunLive): string | null {
  const ranked = live.members.filter(
    member => member.stale !== true && typeof member.rank === 'number' && member.rank >= 1,
  );
  if (ranked.length === 0) {
    return null;
  }
  const lastRank = Math.max(...ranked.map(member => member.rank as number));
  const last = ranked.filter(member => member.rank === lastRank);
  const name = last.length === 1 && !last[0].isMe ? last[0].nickname.trim() : '';
  return name && name !== UNKNOWN_NICKNAME ? name : null;
}

// 선두–후미 간격 벌어짐 판단(S15P31E105-629). 한 번의 연속 G10 조회 동안만 쓴다(604 createPaceChangeTracker와 같은 규칙).
// - 첫 유효값은 기준만 잡는다. 이미 기준 위여도 알리지 않고, 내려왔다가 다시 넘을 때 알린다.
// - 이전 유효값이 기준 이하였고 이번 값이 기준을 넘으면 그 현황에만 isNew=true. 다시 내려오기(기준-여유 미만) 전까지는
//   매 현황에 isNew=false로 넣어 워치가 표시를 유지한다.
// - 거리가 없는(지연·순위 없는 멤버가 있는) 현황은 알리지 않고 상태도 바꾸지 않는다.
// - 조회 오류(reset)·재구독(앱 재진입)은 기준을 비워 다음 값을 조용히 반영한다.
// - 그룹이 달리는 중이고 내가 그룹장일 때만 내보낸다. 판단 상태는 그룹장 여부와 상관없이 같게 움직인다.
export function createGapAlertTracker(
  thresholdM: number = GROUP_GAP_ALERT_M,
  rearmMarginM: number = GROUP_GAP_REARM_MARGIN_M,
) {
  let seen = false;
  // armed: 다음에 기준을 넘으면 알린다. widened: 알린 뒤 아직 다시 내려오지 않았다(표시 유지).
  let armed = false;
  let widened = false;
  const next = (live: GroupRunLive): WatchGroupStatus['gapWidened'] => {
    const gap = validGap(live.spreadM);
    if (gap === null) {
      return null;
    }
    const running = live.status === 'RUNNING';
    let isNew = false;
    if (!seen) {
      seen = true;
      armed = gap <= thresholdM;
    } else if (armed && gap > thresholdM) {
      armed = false;
      widened = running;
      isNew = running;
    } else if (!armed && gap < thresholdM - rearmMarginM) {
      armed = true;
      widened = false;
    }
    const host = live.members.some(member => member.isMe && member.isHost === true);
    return widened && running && host
      ? { gapM: Math.round(gap), memberName: lastRunnerName(live), isNew }
      : null;
  };
  const reset = () => {
    seen = false;
    armed = false;
    widened = false;
  };
  return { next, reset };
}
