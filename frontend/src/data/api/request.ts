import { apiRequest } from './http';

// 세션 저장소가 쓰는 요청 함수. 실제로는 공통 요청 기반(S15P31E105-299)의 apiRequest를 쓰고, 테스트에서는 가짜를 주입한다.
// 인증 헤더·타임아웃·오류 변환(DataError)은 apiRequest가 맡는다. path는 /api/v1 아래 경로다.
export type ApiRequest = <T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  path: string,
  body?: unknown,
) => Promise<T>;

export const serverRequest: ApiRequest = (method, path, body) =>
  apiRequest(path, { method, body });
