import { appConfig } from '../../config';
import { DataError, dataErrorCodes, type DataErrorCode } from '../errors';
import { tokenStore } from './tokenStore';

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  // Sent as JSON, or as multipart/form-data when it is a FormData (F01).
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  // U01 로그인·U15 가입·U16 아이디 확인 run without the access token (docs/design/api/README.md 인증 요청과 복구).
  auth?: boolean;
  timeoutMs?: number;
};

const defaultTimeoutMs = 15_000;

const unauthorizedListeners = new Set<() => void>();

// Called when the server rejects the access token; SessionProvider signs out. Returns the unsubscribe function.
export function onUnauthorized(listener: () => void) {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
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
  const {
    method = 'GET',
    body,
    query,
    auth = true,
    timeoutMs = defaultTimeoutMs,
  } = options;
  const form = body instanceof FormData;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined && !form) {
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
        body === undefined
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
    if (accessToken && error.code === 'UNAUTHORIZED') {
      unauthorizedListeners.forEach(listener => listener());
    }
    throw error;
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
