import { serverRequest } from '../request';
import { apiRequest } from '../http';

jest.mock('../http', () => ({ apiRequest: jest.fn(async () => ({})) }));

// S15P31E105-533: 세션 저장소가 준 요청별 상한(S01 50초)을 공통 요청 함수에 넘긴다.
test('serverRequest passes the per-request timeout through to apiRequest', async () => {
  await serverRequest('POST', '/running-sessions', { a: 1 }, { timeoutMs: 50_000 });
  await serverRequest('GET', '/running-sessions/1');
  expect(apiRequest).toHaveBeenNthCalledWith(1, '/running-sessions', {
    method: 'POST',
    body: { a: 1 },
    timeoutMs: 50_000,
  });
  expect(apiRequest).toHaveBeenNthCalledWith(2, '/running-sessions/1', {
    method: 'GET',
    body: undefined,
    timeoutMs: undefined,
  });
});
