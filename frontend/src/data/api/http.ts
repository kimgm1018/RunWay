import { appConfig } from '../../config';
import { DataError, dataErrorCodes, type DataErrorCode } from '../errors';
import { tokenStore } from './tokenStore';

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  // Sent as JSON, or as multipart/form-data when it is a FormData (F01).
  body?: unknown;
  // A JSON text sent as it is, e.g. a W07 batch whose bytes were hashed on the watch (S15P31E105-311).
  jsonText?: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  // U01 로그인·U15 가입·U16 아이디 확인 run without the access token (docs/design/api/README.md 인증 요청과 복구).
  auth?: boolean;
  timeoutMs?: number;
};

const defaultTimeoutMs = 15_000;

const unauthorizedListeners = new Set<() => void>();

// Called after authentication recovery fails; SessionProvider opens login without withdrawing consent.
export function onUnauthorized(listener: () => void) {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

const sessionError = () =>
  new DataError('UNAUTHORIZED', '다시 로그인해 주세요.', null, 401);

function expire(session: number) {
  if (tokenStore.session() !== session || !tokenStore.current()) return;
  void tokenStore.clear().catch(() => {});
  unauthorizedListeners.forEach(listener => listener());
}

let refreshing: { session: number; promise: Promise<void> } | null = null;

function refresh(session: number): Promise<void> {
  if (refreshing?.session === session) return refreshing.promise;
  const old = tokenStore.current();
  if (!old || tokenStore.session() !== session)
    return Promise.reject(sessionError());
  const entry = {
    session,
    promise: (async () => {
      try {
        // U02 is never itself refreshed or retried, even on 503 or a lost response.
        const next = await apiRequest<{
          accessToken: string;
          refreshToken: string;
          expiresInSec: number;
          refreshExpiresAt: string;
        }>('/auth/refresh', {
          method: 'POST',
          auth: false,
          body: { refreshToken: old.refreshToken },
        });
        if (
          !next ||
          typeof next.accessToken !== 'string' ||
          !next.accessToken.trim() ||
          typeof next.refreshToken !== 'string' ||
          !next.refreshToken.trim() ||
          !Number.isInteger(next.expiresInSec) ||
          next.expiresInSec < 1 ||
          next.expiresInSec > 600 ||
          typeof next.refreshExpiresAt !== 'string' ||
          !Number.isFinite(Date.parse(next.refreshExpiresAt))
        ) {
          throw sessionError();
        }
        const stored = await tokenStore.rotate(session, {
          ...old,
          accessToken: next.accessToken,
          refreshToken: next.refreshToken,
          refreshExpiresAt: next.refreshExpiresAt,
        });
        if (!stored) throw sessionError();
      } catch {
        expire(session);
        throw sessionError();
      }
    })().finally(() => {
      if (refreshing === entry) refreshing = null;
    }),
  };
  refreshing = entry;
  return entry.promise;
}

function queryString(query: RequestOptions['query']) {
  const pairs = Object.entries(query ?? {}).filter(
    (pair): pair is [string, string | number | boolean] =>
      pair[1] !== undefined && pair[1] !== null,
  );
  if (pairs.length === 0) {
    return '';
  }
  return (
    '?' +
    pairs
      .map(
        ([key, value]) =>
          `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
      )
      .join('&')
  );
}

function isKnownCode(code: unknown): code is DataErrorCode {
  return (
    typeof code === 'string' &&
    (dataErrorCodes as readonly string[]).includes(code)
  );
}

// Turns a failed response into a DataError. The body follows the common {code, message, details} shape.
async function toDataError(response: Response) {
  let body: {
    code?: unknown;
    message?: unknown;
    details?: { failedCount?: unknown } & Record<string, unknown>;
  } | null = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const message =
    typeof body?.message === 'string'
      ? body.message
      : '요청을 처리하지 못했어요.';
  const failedCount =
    typeof body?.details?.failedCount === 'number'
      ? body.details.failedCount
      : null;
  let code: DataErrorCode;
  if (isKnownCode(body?.code)) {
    code = body.code;
  } else if (response.status === 401) {
    code = 'UNAUTHORIZED';
  } else if (response.status >= 500) {
    code = 'SERVER_ERROR';
  } else {
    code = 'UNKNOWN';
  }
  // details는 화면이 복구에 쓴다(예: 409 ACTIVE_SESSION_EXISTS의 sessionId, sessions.md S01).
  const details =
    body?.details && typeof body.details === 'object' ? body.details : null;
  return new DataError(code, message, failedCount, response.status, details);
}

// Every server call goes through here: base URL, JSON, the Bearer token and a timeout.
export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  return request<T>(path, options, tokenStore.session(), false);
}

async function request<T>(
  path: string,
  options: RequestOptions,
  session: number,
  replayed: boolean,
): Promise<T> {
  const {
    method = 'GET',
    body,
    jsonText,
    query,
    auth = true,
    timeoutMs = defaultTimeoutMs,
  } = options;
  if (auth && tokenStore.session() !== session) throw sessionError();
  const form = body instanceof FormData;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if ((body !== undefined && !form) || jsonText !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const accessToken = auth ? tokenStore.current()?.accessToken : undefined;
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(appConfig.apiBaseUrl + path + queryString(query), {
      method,
      headers,
      body:
        jsonText !== undefined
          ? jsonText
          : body === undefined
          ? undefined
          : form
          ? (body as FormData)
          : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    // A POST that timed out may still have been saved; callers check the result before retrying (README 오류 분류와 재시도 기준).
    throw new DataError(
      'NETWORK_ERROR',
      '서버에 연결하지 못했어요. 네트워크 연결을 확인해 주세요.',
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const error = await toDataError(response);
    // Only a token failure (UNAUTHORIZED, or a 401 code the app cannot read) is refreshed or expires the session.
    // Other 401 codes such as U18 INVALID_PASSWORD reach the caller with the session kept.
    if (
      auth &&
      accessToken &&
      error.status === 401 &&
      error.code === 'UNAUTHORIZED'
    ) {
      if (tokenStore.session() !== session) throw sessionError();
      if (replayed) {
        expire(session);
        throw sessionError();
      }
      // A delayed 401 for the previous access token reuses the completed rotation.
      if (
        refreshing?.session === session ||
        tokenStore.current()?.accessToken === accessToken
      ) {
        await refresh(session);
      }
      return request<T>(path, options, session, true);
    }
    throw error;
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
