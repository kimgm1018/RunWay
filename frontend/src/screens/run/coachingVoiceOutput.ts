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

// 새 문장은 읽고 있던 문장을 끊는다. 읽기 시작했으면(엔진 준비 중이면 준비 뒤 읽음) true.
export async function speakCoaching(text: string): Promise<boolean> {
  const voice = native();
  if (!voice || !text.trim()) {
    return false;
  }
  try {
    return (await voice.speak(text)) === true;
  } catch {
    return false;
  }
}

// 일시정지·종료 때 읽던 문장을 바로 멈춘다.
export function stopCoaching() {
  try {
    native()?.stop();
  } catch {
    // 멈추지 못해도 러닝은 그대로 이어진다.
  }
}
