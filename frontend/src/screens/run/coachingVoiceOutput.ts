import { NativeModules, Platform } from 'react-native';

// 코칭 음성 안내를 폰 내장 TTS로 읽는다(S15P31E105-579). Android의 CoachingVoice 모듈이 한국어로 읽고, 읽는 동안 음악
// 소리를 줄였다가 되돌린다. 모듈·엔진·한국어 음성이 없거나 실패해도 러닝을 막지 않고 false로 넘어간다.

type NativeCoachingVoice = {
  speak: (text: string) => Promise<boolean>;
  stop: () => void;
};

function native() {
  const module = NativeModules.CoachingVoice as NativeCoachingVoice | undefined;
  return Platform.OS === 'android' ? module : undefined;
}

// 마지막 문장을 다 읽을 것으로 보는 시각(ms). 엔진이 끝을 알려 주지 않아 글자 수로 어림한다(S15P31E105-735).
let busyUntil = 0;
const readMs = (text: string) => 800 + text.length * 200;

// 새 문장은 읽고 있던 문장을 끊는다. 읽기 시작했으면(엔진 준비 중이면 준비 뒤 읽음) true.
export async function speakCoaching(text: string): Promise<boolean> {
  const voice = native();
  if (!voice || !text.trim()) {
    return false;
  }
  busyUntil = Date.now() + readMs(text);
  try {
    return (await voice.speak(text)) === true;
  } catch {
    return false;
  }
}

// 그룹 안내(S15P31E105-735)는 코칭 문장을 끊지 않는다. 지금 읽고 있을 것으로 보이면 false: 부르는 쪽이 다음 기회에
// 다시 본다. 그룹 안내를 읽는 동안 코칭이 오면 코칭이 그룹 안내를 끊는다(코칭이 우선).
export function voiceIsQuiet(now: number = Date.now()) {
  return now >= busyUntil;
}

// 멈추면 다음 문장을 바로 읽을 수 있다.
function quiet() {
  busyUntil = 0;
}

// 일시정지·종료 때 읽던 문장을 바로 멈춘다.
export function stopCoaching() {
  quiet();
  try {
    native()?.stop();
  } catch {
    // 멈추지 못해도 러닝은 그대로 이어진다.
  }
}
