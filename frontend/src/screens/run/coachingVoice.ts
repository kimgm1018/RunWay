// 러닝 중 코칭 음성 안내 문장(S15P31E105-579). 언제·어떤 문장을 읽을지는 AI04 담당이 정했다(2026-11-09).
// 문장을 바꿀 때는 AI04 담당과 맞춘다. 읽기 여부 중 명령 중복·설정·일시정지는 부르는 쪽(runControl)이 본다.

import type { CoachingLevel } from '../../data/types';

// 코칭 단계(ai-service.md "코칭 단계", 백엔드 S15P31E105-503). 없으면 OK로 본다.
export type { CoachingLevel };

export type VoiceGuide = {
  paceSecPerKm: number;
  level: CoachingLevel | null;
};

type PaceChange = 'SLOWER' | 'SAME' | 'FASTER';

// 직전 안내보다 이 값 이상 차이가 나야 느려짐·빨라짐으로 본다(초/km).
const CHANGE_SEC = 5;

function changeOf(next: number, previous: number): PaceChange {
  const diff = next - previous;
  if (diff >= CHANGE_SEC) {
    return 'SLOWER';
  }
  if (diff <= -CHANGE_SEC) {
    return 'FASTER';
  }
  return 'SAME';
}

// 정각이면 "6분 페이스", 아니면 "6분 30초 페이스".
export function spokenPace(secondsPerKm: number) {
  const rounded = Math.round(secondsPerKm);
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return seconds === 0
    ? `${minutes}분 페이스`
    : `${minutes}분 ${seconds}초 페이스`;
}

function valid(guide: VoiceGuide) {
  return Number.isFinite(guide.paceSecPerKm) && guide.paceSecPerKm > 0;
}

// 새 안내를 직전 안내와 비교해 읽을 문장을 돌려준다. 읽지 않으면 null.
// - 직전 안내가 없으면(출발 직후 첫 안내) 읽지 않는다.
// - 페이스·단계가 그대로인 유지 안내(백엔드 2분 재안내)는 DANGER일 때만 다시 읽는다.
export function coachingSentence(
  next: VoiceGuide,
  previous: VoiceGuide | null,
): string | null {
  if (!previous || !valid(next) || !valid(previous)) {
    return null;
  }
  const level = next.level ?? 'OK';
  const previousLevel = previous.level ?? 'OK';
  const change = changeOf(next.paceSecPerKm, previous.paceSecPerKm);
  if (change === 'SAME' && level === previousLevel && level !== 'DANGER') {
    return null;
  }
  const pace = spokenPace(next.paceSecPerKm);
  switch (level) {
    case 'DANGER':
      return `심박이 너무 높아요. ${pace}로 늦춰 주세요.`;
    case 'CAUTION':
      if (change === 'SLOWER') {
        return `심박이 오르고 있어요. ${pace}로 늦춰 주세요.`;
      }
      if (change === 'FASTER') {
        return `${pace}로 올려 주세요.`;
      }
      return `조금 빨라요. ${pace}로 맞춰 주세요.`;
    case 'OK':
      if (change === 'FASTER') {
        return `여유가 있어요. ${pace}로 올려도 좋아요.`;
      }
      if (change === 'SLOWER') {
        return `${pace}로 조절해 주세요.`;
      }
      return previousLevel === 'OK' ? null : '좋아요. 지금 페이스를 유지하세요.';
  }
}
