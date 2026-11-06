import type { MelonBridge } from './bridge';

// 멜론 실제 연동은 Android만 한다(S15P31E105-398). iOS는 기존 목업 멜론을 유지한다.
export function createMelonBridge(): MelonBridge | undefined {
  return undefined;
}
