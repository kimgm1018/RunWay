import { apiRequest } from '../../../data/api/http';
import { tokenStore } from '../../../data/api/tokenStore';
import { DataError } from '../../../data/errors';
import { postFailure } from '../PostWriteScreen';

// S15P31E105-803: CMT01 400 INVALID_REGION은 같은 요청을 다시 보내도 같은 결과라 '잠시 후 다시 시도'가 아니라 무엇이 안 됐는지와
// 쓴 글이 남아 있음을 알린다. 글을 잃게 하는 '앱을 다시 열어' 안내는 하지 않는다(리뷰 A-2). 다른 오류 문구는 그대로다(리뷰 B-6).

const fetchMock = jest.fn();

beforeEach(async () => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.clear();
});

async function failureOf(status: number, body: unknown) {
  fetchMock.mockResolvedValue({
    ok: false,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  });
  try {
    await apiRequest('/posts', { method: 'POST', body: { sessionId: 1 } });
  } catch (error) {
    expect(error).toBeInstanceOf(DataError);
    return error;
  }
  throw new Error('expected the request to fail');
}

test('서버의 400 INVALID_REGION은 지역 확인 실패와 글이 남아 있음을 알린다', async () => {
  const error = await failureOf(400, {
    code: 'INVALID_REGION',
    message: '존재하지 않는 지역 코드입니다.',
  });
  expect((error as DataError).code).toBe('INVALID_REGION');
  const message = postFailure(error, '게시');
  expect(message).toBe(
    '이 기록의 지역을 확인하지 못해 게시하지 못했어요. 쓴 글은 그대로 있어요',
  );
  expect(message).not.toContain('잠시 후');
  expect(message).not.toContain('다시 열');
});

test('다른 오류 문구는 그대로다', async () => {
  const internal = await failureOf(500, {
    code: 'INTERNAL_ERROR',
    message: '서버 오류가 발생했습니다.',
  });
  expect(postFailure(internal, '게시')).toBe(
    '게시하지 못했어요. 잠시 후 다시 시도해 주세요',
  );
  expect(postFailure(internal, '저장')).toBe(
    '저장하지 못했어요. 잠시 후 다시 시도해 주세요',
  );
  const validation = await failureOf(400, {
    code: 'VALIDATION_ERROR',
    message: '요청 값이 유효하지 않습니다.',
  });
  expect(postFailure(validation, '게시')).toBe('글 내용을 확인해 주세요');
  const invalidPost = await failureOf(422, {
    code: 'INVALID_POST',
    message: '공유할 수 있는 완료 러닝 기록이 아닙니다.',
  });
  expect(postFailure(invalidPost, '게시')).toBe(
    '삭제됐거나 완료되지 않은 기록은 공유할 수 없어요',
  );
});
