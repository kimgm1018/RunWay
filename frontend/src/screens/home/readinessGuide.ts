import type { TodayCondition } from '../../data';
import { formatMonthDay } from '../../format';

// 2.1 준비도 카드 맨 위의 한 문장 (S15P31E105-615, 담당자 요청서). The card only says what its data already judged: R02
// has no readiness level or factor yet (readiness-formula.md 6절: 표시 등급·판단 요인은 정리 중), so with the server the
// sentence stays neutral, and a judgment shows only when the data carries one (the mock today, the server once it
// sends a level). No threshold is made up here. The records behind it are the report under it (ReadinessFlow).

export type ReadinessGuide = {
  title: string;
  description: string | null;
  // What to do with it, one short line.
  action: string | null;
  // Whether the sentence is the data's own judgment.
  judged: boolean;
};

export const neutralTitle = '오늘의 달리기를 준비해 보세요';
const neutralDescription = (isToday: boolean) =>
  `${isToday ? '오늘' : '최근'} 기록을 확인하고 달릴 강도를 정해 보세요.`;

// Why a state without a usable score is neutral, as the card said it before.
const stateNotes: Record<TodayCondition['readinessState'], string | null> = {
  ready: null,
  collecting: '데이터를 모으는 중이에요.',
  stale: '데이터가 오래됐어요.',
  permissionDenied: '건강 데이터 권한이 없어요.',
  watchDisconnected: '연결된 워치가 없어요.',
};

export function readinessGuide(
  today: TodayCondition,
  { isToday }: { isToday: boolean },
): ReadinessGuide {
  // R02 has no level yet; a summary 'grade · advice' made for today is the data's own judgment (the mock has one).
  const advice =
    today.readinessState === 'ready' && isToday
      ? today.readinessSummary?.split(' · ')[1]?.trim() || null
      : null;
  if (advice) {
    return {
      title: advice,
      description: null,
      action: today.aiAdvice,
      judged: true,
    };
  }
  const stale =
    today.readinessState === 'stale' && today.lastAssessedDate
      ? `마지막 평가가 ${formatMonthDay(today.lastAssessedDate)}이에요.`
      : null;
  return {
    title: neutralTitle,
    description:
      stale ?? stateNotes[today.readinessState] ?? neutralDescription(isToday),
    action: null,
    judged: false,
  };
}
