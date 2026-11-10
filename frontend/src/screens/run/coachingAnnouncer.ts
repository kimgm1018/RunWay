import type { CoachingGuide } from '../../data/types';
import { coachingSentence, type VoiceGuide } from './coachingVoice';

// 러닝 중 코칭 음성 안내를 언제 읽을지 정한다(S15P31E105-579). 문장은 coachingVoice, 소리는 coachingVoiceOutput이 맡는다.
// - 워치가 적용한 코칭(폰으로 기록 중이면 새로 받은 코칭)마다 applied를 부른다.
// - 같은 명령(commandId)은 한 번만 다룬다(재전송 무시).
// - 음성 설정이 켜져 있고 러닝 중일 때만 읽는다. 일시정지·종료되면 읽던 문장을 멈춘다.
// - 읽지 않은 코칭도 다음 비교의 직전 안내가 된다(첫 안내·설정 꺼짐·일시정지 포함).

export type CoachingVoiceOut = {
  // 음성 설정 '코칭 음성 알림'(voiceCoachingEnabled).
  enabled: () => boolean;
  speak: (sentence: string) => void;
  stop: () => void;
};

export type CoachingAnnouncer = {
  applied: (guide: CoachingGuide) => void;
  setRunning: (running: boolean) => void;
  reset: () => void;
};

export function createCoachingAnnouncer(out: CoachingVoiceOut): CoachingAnnouncer {
  let previous: VoiceGuide | null = null;
  let running = false;
  const handled = new Set<string>();

  return {
    applied(guide) {
      if (handled.has(guide.commandId)) {
        return;
      }
      handled.add(guide.commandId);
      const next: VoiceGuide = {
        paceSecPerKm: guide.recommendedPaceSecPerKm,
        level: guide.coachingLevel ?? null,
      };
      const sentence = coachingSentence(next, previous);
      previous = next;
      if (sentence && running && out.enabled()) {
        out.speak(sentence);
      }
    },
    setRunning(value) {
      if (running && !value) {
        out.stop();
      }
      running = value;
    },
    reset() {
      if (running) {
        out.stop();
      }
      previous = null;
      running = false;
      handled.clear();
    },
  };
}
