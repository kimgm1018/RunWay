import EventSource from 'react-native-sse';
import { appConfig } from '../../config';
import type { SessionEventsStatus, SessionSnapshot } from '../types';
import { recoverUnauthorized as recoverWithRefresh } from './http';
import { sessionView, type ServerSession } from './sessionApi';
import { tokenStore } from './tokenStore';

// S10 활성 러닝 이벤트 구독(sessions.md S10, S15P31E105-257 D-5).
// - 라이브러리 자동 재접속은 끄고(pollingInterval 0) 여기서 다시 연결한다. 재접속은 최신 스냅샷부터 확인하며 Last-Event-ID를 쓰지 않는다.
// - 45초 동안 서버 메시지가 없으면 연결 오류로 보고 닫은 뒤 1·2·4…최대 30초 + jitter 뒤 다시 연결한다.
// - 토큰은 Authorization 헤더로만 보낸다. 토큰·스냅샷 내용·오류 본문은 로그에 남기지 않는다.
// - 서버는 접근 토큰 만료시각에 스트림을 정상 종료하지만 react-native-sse 1.2.1은 정상 종료를 알리지 않는다.
//   그래서 만료 조금 전에 토큰을 갱신해 미리 다시 연결한다. 만료시각을 모르거나 놓치면 45초 무응답 감시가 대신한다.

export const SESSION_EVENT_TYPES = [
  'SESSION_STATE',
  'COACHING_GUIDE',
  'SERVER_END',
  'ANALYSIS_STATUS',
] as const;

type SessionEventType = (typeof SESSION_EVENT_TYPES)[number];

type SourceEvent = { type: string; data?: string | null; xhrStatus?: number };

// 쓰는 기능만 묶은 EventSource 모양. 테스트는 가짜를 넣는다.
export type EventSourceLike = {
  addEventListener: (type: string, listener: (event: SourceEvent) => void) => void;
  removeAllEventListeners: () => void;
  close: () => void;
};

export type EventSourceFactory = (
  url: string,
  options: {
    headers: Record<string, string>;
    pollingInterval: number;
    timeout: number;
    timeoutBeforeConnection: number;
  },
) => EventSourceLike;

export type SessionEventsOptions = {
  sessionId: string;
  onSnapshot: (snapshot: SessionSnapshot) => void;
  onStatus?: (status: SessionEventsStatus) => void;
  createSource?: EventSourceFactory;
  accessToken?: () => string | undefined;
  // 401을 받았을 때 U02 갱신으로 복구한다. 실패하면 거부하며, 로그아웃 처리는 http 계층이 한다(S15P31E105-315).
  recoverUnauthorized?: () => Promise<void>;
  timers?: { silenceMs?: number; backoffBaseMs?: number; backoffMaxMs?: number; renewBeforeExpiryMs?: number };
  random?: () => number;
  now?: () => number;
};

export type SessionEvents = {
  status: () => SessionEventsStatus;
  stop: () => void;
};

const defaultSource: EventSourceFactory = (url, options) =>
  new EventSource<SessionEventType>(url, options) as unknown as EventSourceLike;

// 연결 전 HTTP 오류 중 다시 연결해도 결과가 같은 것(400·403·404). 401은 토큰 갱신 뒤 한 번 다시 연결한다.
const PERMANENT = [400, 403, 404];

// Hermes and Node provide atob, but React Native's type definitions leave it out.
const { atob } = globalThis as unknown as { atob?: (data: string) => string };

// 접근 토큰(JWT)의 exp(초)를 밀리초로 읽는다. 읽을 수 없으면 null. 서명은 확인하지 않으며 재연결 시점에만 쓴다.
export function tokenExpiresAtMs(token: string): number | null {
  const payload = token.split('.')[1];
  if (!payload || !atob) {
    return null;
  }
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const { exp } = JSON.parse(atob(padded)) as { exp?: unknown };
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

// int64 ID를 문자열 그대로 비교한다(앞자리 0 없는 양의 정수).
function compareIds(a: string, b: string) {
  if (a.length !== b.length) {
    return a.length - b.length;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

export function createSessionEvents(options: SessionEventsOptions): SessionEvents {
  const {
    sessionId,
    onSnapshot,
    onStatus,
    createSource = defaultSource,
    accessToken = () => tokenStore.current()?.accessToken,
    recoverUnauthorized = recoverWithRefresh,
    random = Math.random,
    now = Date.now,
  } = options;
  const silenceMs = options.timers?.silenceMs ?? 45_000;
  const backoffBaseMs = options.timers?.backoffBaseMs ?? 1000;
  const backoffMaxMs = options.timers?.backoffMaxMs ?? 30_000;
  // 휴대폰 시계가 서버보다 조금 늦어도 서버가 닫기 전에 다시 연결하도록 여유를 둔다.
  const renewBeforeExpiryMs = options.timers?.renewBeforeExpiryMs ?? 10_000;

  let status: SessionEventsStatus = 'connecting';
  let source: EventSourceLike | null = null;
  let stopped = false;
  let attempt = 0;
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let renewTimer: ReturnType<typeof setTimeout> | null = null;
  // 이 연결에서 아직 스냅샷을 받지 않았다. 첫 스냅샷에 reconnected=true를 붙인다.
  let fresh = true;
  let lastVersion = -1;
  let lastCoachingId: string | null = null;
  // 마지막 이벤트 수신 이후 이미 토큰 갱신으로 다시 연결했다. 갱신 직후에도 401이면 반복하지 않고 멈춘다.
  let refreshedSinceEvent = false;

  const setStatus = (next: SessionEventsStatus) => {
    if (status !== next) {
      status = next;
      onStatus?.(next);
    }
  };

  const clearSilence = () => {
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
  };

  const teardown = () => {
    clearSilence();
    if (renewTimer) {
      clearTimeout(renewTimer);
      renewTimer = null;
    }
    const current = source;
    source = null;
    if (current) {
      current.removeAllEventListeners();
      current.close();
    }
  };

  const scheduleReconnect = () => {
    if (stopped || retryTimer) {
      return;
    }
    const base = Math.min(backoffMaxMs, backoffBaseMs * 2 ** attempt);
    const jitter = Math.floor(random() * base * 0.2);
    attempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, Math.min(backoffMaxMs, base + jitter));
  };

  const fail = () => {
    teardown();
    setStatus('error');
    scheduleReconnect();
  };

  const armSilence = () => {
    clearSilence();
    silenceTimer = setTimeout(fail, silenceMs);
  };

  const halt = () => {
    stopped = true;
    teardown();
    setStatus('error');
  };

  // 오래된 stateVersion은 버린다. 같은 버전에서는 더 큰 coachingId의 코칭만 넘긴다(S10 처리 규칙).
  const accept = (data: string | null | undefined, event: string) => {
    if (!data) {
      return;
    }
    let raw: ServerSession;
    try {
      raw = JSON.parse(data) as ServerSession;
    } catch {
      return;
    }
    if (typeof raw?.stateVersion !== 'number' || typeof raw?.analysis?.status !== 'string') {
      return;
    }
    let view = sessionView(raw);
    if (view.stateVersion < lastVersion) {
      return;
    }
    if (view.stateVersion > lastVersion) {
      lastVersion = view.stateVersion;
      lastCoachingId = null;
    }
    const coaching = view.coaching ?? null;
    if (coaching) {
      if (lastCoachingId !== null && compareIds(coaching.coachingId, lastCoachingId) < 0) {
        view = { ...view, coaching: null };
      } else {
        lastCoachingId = coaching.coachingId;
      }
    }
    const reconnected = fresh;
    fresh = false;
    onSnapshot({ event, session: view, reconnected });
  };

  // 토큰 만료 전에 갱신한 토큰으로 다시 연결한다. 다른 요청이 이미 갱신했으면 그 토큰을 쓴다.
  // 갱신이 실패하면 http 계층이 로그아웃 처리를 하므로 401 복구와 같이 멈춘다.
  const renew = (usedToken: string) => {
    teardown();
    setStatus('connecting');
    const reconnect = () => {
      if (accessToken() === usedToken) {
        // 갱신해도 토큰이 그대로면 반복하지 않고 일반 재연결로 넘긴다.
        fail();
        return;
      }
      connect();
    };
    if (accessToken() !== usedToken) {
      reconnect();
      return;
    }
    recoverUnauthorized().then(reconnect, () => halt());
  };

  function connect() {
    if (stopped) {
      return;
    }
    const token = accessToken();
    if (!token || !/^[1-9]\d*$/.test(sessionId)) {
      halt();
      return;
    }
    fresh = true;
    setStatus('connecting');
    let opened: EventSourceLike;
    try {
      opened = createSource(`${appConfig.apiBaseUrl}/running-sessions/${sessionId}/events`, {
        headers: { Authorization: `Bearer ${token}` },
        // 라이브러리 자동 재접속·시간 초과는 끄고 위 감시로 대신한다.
        pollingInterval: 0,
        timeout: 0,
        timeoutBeforeConnection: 0,
      });
    } catch {
      fail();
      return;
    }
    source = opened;
    armSilence();
    const expiresAt = tokenExpiresAtMs(token);
    if (expiresAt !== null) {
      renewTimer = setTimeout(() => {
        renewTimer = null;
        if (source === opened && !stopped) {
          renew(token);
        }
      }, Math.max(0, expiresAt - now() - renewBeforeExpiryMs));
    }
    opened.addEventListener('open', () => {
      if (source === opened) {
        armSilence();
      }
    });
    SESSION_EVENT_TYPES.forEach(type =>
      opened.addEventListener(type, event => {
        if (source !== opened) {
          return;
        }
        armSilence();
        attempt = 0;
        refreshedSinceEvent = false;
        setStatus('connected');
        accept(event.data, type);
      }),
    );
    opened.addEventListener('error', event => {
      if (source !== opened) {
        return;
      }
      const httpStatus = event.xhrStatus ?? 0;
      if (httpStatus === 401) {
        // 서버는 토큰 만료시각에 스트림을 닫고, 그 뒤 재연결은 401이다. 다른 요청과 같은 U02 갱신 한 번으로 복구한다.
        if (refreshedSinceEvent) {
          halt();
          return;
        }
        refreshedSinceEvent = true;
        teardown();
        setStatus('connecting');
        recoverUnauthorized().then(
          () => connect(),
          () => halt(),
        );
        return;
      }
      if (PERMANENT.includes(httpStatus)) {
        halt();
        return;
      }
      fail();
    });
  }

  connect();

  return {
    status: () => status,
    stop: () => {
      stopped = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      teardown();
    },
  };
}
