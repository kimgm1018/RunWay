import type { ControlAction } from '../../data/types';
import type { ControlProblem } from './runControl';

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
    case 'saveUnconfirmed':
      return actions.includes('END')
        ? { text: '종료 저장을 확인하지 못했어요', recheck: true }
        : null;
    case 'error':
      return { text: '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요', recheck: false };
    default:
      return null;
  }
}
