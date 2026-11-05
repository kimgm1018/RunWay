import { useEffect, useState } from 'react';
import { useRepositories } from '../../data';
import type { RecordComparison } from '../../data/types';
import { formatDotDate, formatKm } from '../../format';

// 4.2·4.5 기록 비교 한 줄(S15P31E105-422). 서버가 계산한 S02 comparison만 옮기며 앱에서 다시 계산하지 않는다.
// 워치 9.6과 같이 초 단위로 버려서 보여 준다.
export type ComparisonLine = {
  // "10.20 기록보다". 비교 기록을 볼 수 없으면 날짜 없이 쓴다.
  label: string;
  text: string;
};

function amount(seconds: number) {
  return seconds < 60
    ? `${seconds}초`
    : `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
}

// 비교 기록을 고르지 않은 러닝은 null(비교 표시 없음).
export function comparisonLine(
  comparison: RecordComparison | null | undefined,
): ComparisonLine | null {
  if (!comparison) {
    return null;
  }
  const target = comparison.targetStartedAt
    ? `${formatDotDate(comparison.targetStartedAt)} 기록`
    : '지난 기록';
  const label = `${target}보다`;
  const waiting = { label: `${target}과`, text: '비교 준비 중' };
  switch (comparison.status) {
    case 'AVAILABLE': {
      const { currentElapsedSec, pastElapsedSec } = comparison;
      if (currentElapsedSec === null || pastElapsedSec === null) {
        return waiting;
      }
      const gap = pastElapsedSec - currentElapsedSec;
      return {
        label,
        text:
          gap > 0
            ? `${amount(gap)} 앞서는 중`
            : gap < 0
            ? `${amount(-gap)} 뒤처지는 중`
            : '같은 속도',
      };
    }
    case 'WAITING':
      return waiting;
    case 'NO_RECORD':
      return { label: '비교 기록은', text: '거리 기록이 없어요' };
    case 'UNAVAILABLE':
      return { label: '비교 기록을', text: '볼 수 없어 멈췄어요' };
    default:
      return null;
  }
}

// 4.5 결과: 비교한 지점과 그 지점 도달 시간 차이. AVAILABLE이 아니면 null.
export function comparisonResult(
  comparison: RecordComparison | null | undefined,
): string | null {
  if (
    !comparison ||
    comparison.status !== 'AVAILABLE' ||
    comparison.distanceM === null ||
    comparison.currentElapsedSec === null ||
    comparison.pastElapsedSec === null
  ) {
    return null;
  }
  const at = `${formatKm(comparison.distanceM, 1)}km 지점에서`;
  const date = comparison.targetStartedAt
    ? `${formatDotDate(comparison.targetStartedAt)} 기록보다`
    : '지난 기록보다';
  const gap = comparison.pastElapsedSec - comparison.currentElapsedSec;
  return gap === 0
    ? `${at} ${date.replace('보다', '과')} 같았어요`
    : `${at} ${date} ${amount(Math.abs(gap))} ${
        gap > 0 ? '빨랐어요' : '느렸어요'
      }`;
}

// 4.5: 종료 뒤에는 S10이 닫혀 마지막 batch의 비교가 오지 않으므로 결과 화면에서 S02를 한 번 다시 읽는다.
// 읽기 전이나 실패하면 러닝 중 마지막 값을 쓴다. 비교 기록을 고르지 않았으면 읽지 않는다.
export function useFinalComparison(
  sessionId: string | null,
  live: RecordComparison | null,
): RecordComparison | null {
  const { session } = useRepositories();
  const compared = live !== null && sessionId !== null;
  const [latest, setLatest] = useState<{
    sessionId: string;
    comparison: RecordComparison | null;
  } | null>(null);
  useEffect(() => {
    if (!compared || sessionId === null) {
      return;
    }
    let active = true;
    session.get(sessionId).then(
      view =>
        active &&
        setLatest({ sessionId, comparison: view.comparison ?? null }),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [compared, sessionId, session]);
  return latest && latest.sessionId === sessionId ? latest.comparison : live;
}
