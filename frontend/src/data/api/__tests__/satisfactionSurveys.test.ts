import { appConfig } from '../../../config';
import { surveysApi } from '../satisfactionSurveys';
import { tokenStore } from '../tokenStore';

// S15P31E105-813 AC-8: SV01 sends the answer with the member's Bearer token.
const fetchMock = jest.fn();

function respond(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

const created = {
  surveyId: 1,
  score: 4,
  comment: '좋아요',
  source: 'SETTINGS',
  submittedAt: '2026-11-14T00:00:00Z',
};

beforeEach(async () => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.save({ accessToken: 'access-1', refreshToken: 'refresh-1' });
});

test('SV01 posts score, trimmed comment and source', async () => {
  fetchMock.mockResolvedValue(respond(201, created));

  await surveysApi.submit({ score: 4, comment: '  좋아요 ', source: 'SETTINGS' });

  const [requested, init] = fetchMock.mock.calls[0];
  expect(requested).toBe(`${appConfig.apiBaseUrl}/satisfaction-surveys`);
  expect(init.method).toBe('POST');
  expect(init.headers.Authorization).toBe('Bearer access-1');
  expect(JSON.parse(init.body)).toEqual({
    score: 4,
    comment: '좋아요',
    source: 'SETTINGS',
  });
});

test('SV01 leaves a blank comment out', async () => {
  fetchMock.mockResolvedValue(respond(201, { ...created, comment: null }));

  await surveysApi.submit({ score: 5, comment: '   ', source: 'RUN_RESULT' });

  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
    score: 5,
    source: 'RUN_RESULT',
  });
});

test('SV01 rejects on a 400 so the screen keeps the answer', async () => {
  fetchMock.mockResolvedValue(
    respond(400, { code: 'VALIDATION_ERROR', message: 'x', details: {} }),
  );

  await expect(
    surveysApi.submit({ score: 3, source: 'SETTINGS' }),
  ).rejects.toBeDefined();
});
