import type { ControlAction } from '../../data/types';
import { canTakeOver, type ControlProblem, type RunControlState } from './runControl';

// 폰 인계(S08 TAKE_OVER_PHONE, S15P31E105-464) 안내. offer면 '폰으로 기록 계속' 버튼을 함께 보인다.
export function takeoverNotice(
  state: RunControlState | null,
): { text: string; offer: boolean } | null {
  if (!state) {
    return null;
  }
  if (state.pending?.action === 'TAKE_OVER') {
    return { text: '워치 기록을 저장하고 폰으로 옮기는 중', offer: false };
  }
  if (state.recordingMode === 'PHONE_FALLBACK') {
    if (state.status !== 'RUNNING' && state.status !== 'PAUSED') {
      return null;
    }
    return {
      text:
        state.phoneGps === 'off'
          ? '폰에서 기록 중이에요 · 위치 권한이 없어 경로는 남지 않아요'
          : '폰에서 기록 중이에요',
      offer: false,
    };
  }
  if (!canTakeOver(state)) {
    return null;
  }
  switch (state.problem?.kind) {
    case 'takeoverHeld':
      return { text: '워치에서 받은 기록을 아직 저장하지 못했어요. 잠시 후 다시 시도해 주세요', offer: true };
    case 'takeoverUnconfirmed':
      return { text: '폰으로 옮겼는지 확인하지 못했어요', offer: true };
    case 'takeoverFailed':
      return { text: '폰으로 옮기지 못했어요', offer: true };
    default:
      return state.watchLost
        ? { text: '워치 연결이 끊겼거나 측정이 멈췄어요', offer: true }
        : { text: '워치가 응답하지 않으면 폰으로 기록을 이어갈 수 있어요', offer: true };
  }
}

const verb: Record<ControlAction, string> = {
  START: '시작',
  PAUSE: '일시정지',
  RESUME: '재개',
  END: '종료',
};

// 진행·일시정지 화면의 제어 문제 안내. 실행 미확인은 성공·실패로 단정하지 않고 재확인을 고르게 한다.
// actions에 없는 작업의 문제는 다른 화면이 보여 준다.
export function controlNotice(
  problem: ControlProblem | null,
  actions: ControlAction[],
): { text: string; recheck: boolean } | null {
  if (!problem) {
    return null;
  }
  switch (problem.kind) {
    case 'unconfirmed':
      return actions.includes(problem.action)
        ? { text: `${verb[problem.action]} 여부를 확인할 수 없습니다`, recheck: true }
        : null;
    case 'rejected':
      return actions.includes(problem.action)
        ? { text: `워치가 ${verb[problem.action]}하지 못했어요`, recheck: false }
        : null;
    // 두 경우 모두 '다시 확인'은 같은 END를 워치에 다시 보내 보관한 결과와 남은 기록 저장을 다시 확인한다.
    case 'saveUnconfirmed':
      if (!actions.includes('END')) {
        return null;
      }
      return problem.reason === 'UPLOAD_PENDING'
        ? { text: '마지막 기록 저장을 확인하지 못했어요', recheck: true }
        : { text: '워치의 종료 결과를 받지 못했어요', recheck: true };
    case 'error':
      return { text: '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요', recheck: false };
    default:
      return null;
  }
}
