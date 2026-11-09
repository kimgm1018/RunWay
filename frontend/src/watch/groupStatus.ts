import type { GroupRunLive, WatchGroupStatus } from '../data/types';

// G10 현황 → 워치 GROUP_STATUS(9.3, S15P31E105-420). 순위·격차·공동 페이스는 서버 값을 옮기기만 하고 계산하지 않는다.
// 선두–후미 거리는 폰 그룹 화면과 같은 값(spreadM)을 보내 두 기기의 표시를 맞춘다.
// 순위가 없거나 지연된(stale) 내 항목은 standing을 비워 보내고, 워치가 마지막 값을 지연으로 표시한다.
// 취소된 그룹은 세션 취소(STATE_RESULT)로 알리므로 보내지 않는다(null).
export function watchGroupStatus(
  groupRunId: string,
  live: GroupRunLive,
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
  };
}
