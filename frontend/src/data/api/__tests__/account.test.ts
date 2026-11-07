import { appConfig } from '../../../config';
import { DataError } from '../../errors';
import { createAccountApi } from '../account';
import { tokenStore } from '../tokenStore';

// 8.4–8.6 회원탈퇴 (U17·U18, users.md, S15P31E105-523). 합성 응답이며 실데이터가 아니다.

const fetchMock = jest.fn();

function respond(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

const account = createAccountApi();

beforeEach(async () => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.save({ accessToken: 'access-1', refreshToken: 'refresh-1' });
});

test('U17 reads what goes away, what is cancelled and what must be cleared first', async () => {
  fetchMock.mockResolvedValue(
    respond(200, {
      runningRecordCount: 12,
      postCount: 3,
      bookmarkedCourseCount: 5,
      connectedDevices: [
        { id: 101, deviceType: 'WATCH' },
        { id: 102, deviceType: 'PHONE' },
      ],
      ownedCrews: [{ crewId: 7, name: '민락 야경 러너스' }],
      ownedGroupRuns: [{ groupRunId: 9, title: '토요일 아침 5km', status: 'RECRUITING' }],
      scheduledGroupRuns: [{ groupRunId: 10, title: '수요일 회복 조깅', status: 'RECRUITING' }],
      blockers: [
        { code: 'CREW_OWNER', message: '크루장을 넘기거나 해산해 주세요', resourceIds: [7] },
      ],
    }),
  );

  await expect(account.getWithdrawalSummary()).resolves.toEqual({
    runningRecordCount: 12,
    postCount: 3,
    savedCourseCount: 5,
    connectedDevices: ['워치', '휴대폰'],
    ownedCrews: ['민락 야경 러너스'],
    ownedGroupRuns: ['토요일 아침 5km'],
    scheduledGroupRuns: ['수요일 회복 조깅'],
    blockers: [{ code: 'CREW_OWNER', message: '크루장을 넘기거나 해산해 주세요' }],
  });
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe(`${appConfig.apiBaseUrl}/users/me/withdrawal-summary`);
  expect(init.method).toBe('GET');
});

test('U18 sends the password with the agreement as DELETE /users/me', async () => {
  fetchMock.mockResolvedValue(respond(200, { withdrawnAt: '2026-11-07T00:00:00Z' }));

  await expect(account.withdraw('runway123')).resolves.toBeUndefined();
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe(`${appConfig.apiBaseUrl}/users/me`);
  expect(init.method).toBe('DELETE');
  expect(JSON.parse(init.body)).toEqual({ password: 'runway123', agreed: true });
});

test('a withdrawal that went through with the pictures still being cleaned up counts as done', async () => {
  fetchMock.mockResolvedValue(
    respond(503, {
      code: 'IMAGE_CLEANUP_PENDING',
      message: '',
      details: { withdrawalCompleted: true, withdrawnAt: '2026-11-07T00:00:00Z' },
    }),
  );
  await expect(account.withdraw('runway123')).resolves.toBeUndefined();
});

test.each([
  [401, 'INVALID_PASSWORD'],
  [409, 'WITHDRAWAL_CONFLICT'],
  [503, 'SERVICE_UNAVAILABLE'],
])('U18 %s %s reaches the screen as a failure and keeps the login', async (status, code) => {
  fetchMock.mockResolvedValue(respond(status, { code, message: '', details: {} }));

  const failure = await account.withdraw('runway123').catch(error => error);
  expect(failure).toBeInstanceOf(DataError);
  expect((failure as DataError).code).toBe(
    code === 'SERVICE_UNAVAILABLE' ? 'SERVER_ERROR' : code,
  );
  // A wrong password is not a token failure: the session stays for another try.
  expect(tokenStore.current()?.accessToken).toBe('access-1');
});
