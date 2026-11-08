import type { Repositories } from '../data/types';

// 워치 세션 중계가 없는 플랫폼(iOS 등). 워치가 없으므로 개인 러닝 시작은 "워치를 연결해 주세요"가 된다(D-10).
export function createNativeWatchSession(): Repositories['watchSession'] {
  return {
    getLinkedDevices: async () => null,
    prepare: async (_sessionId, { stateVersion }) => ({
      stateVersion,
      ready: false,
      reasonCode: 'WATCH_UNAVAILABLE',
    }),
    sendCommand: async () => undefined,
    sendBpmCommand: async () => undefined,
    sendCoachingGuide: async () => undefined,
    sendReceived: async () => undefined,
    sendServerState: async () => undefined,
    sendError: async () => undefined,
    commitBatch: async () => undefined,
    failBatch: async () => undefined,
    subscribe: () => () => undefined,
    setRunActive: async () => undefined,
    getActiveSessionId: async () => null,
  };
}
