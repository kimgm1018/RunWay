// 입력칸 글자 수 상한(S15P31E105-818). RN `maxLength`와 서버 `@Size`는 모두 UTF-16 단위라 같은 숫자를 쓴다.
// 서버 값이 바뀌면 이 파일과 근거 문서(docs/design/api/)를 함께 고친다.

// G01·G04: CreateGroupRunRequest·PatchGroupRunRequest `meetingPlaceName @Size(max=200)`.
export const GROUP_RUN_PLACE_NAME_MAX = 200;
// G01·G04: `description @Size(max=10000)`. 앱의 '찾아오는 법'이 description으로 간다.
export const GROUP_RUN_NOTE_MAX = 10000;
// GET /places/search: 앞뒤 공백을 뺀 코드포인트 100 초과는 400(group-runs.md). UTF-16 100이면 코드포인트도 100 이하다.
export const PLACE_SEARCH_MAX = 100;
// U01 로그인: `[A-Za-z0-9]{4,16}`(LoginFieldValidator, users.md). 가입 화면과 같다.
export const LOGIN_ID_MAX = 16;
// 커뮤니티 통합 검색·크루 검색어: 서버는 앞뒤 공백을 뺀 뒤 50 코드포인트를 넘으면 400 VALIDATION_ERROR로 거절한다
// (S15P31E105-820 확정). RN maxLength는 UTF-16 단위라 코드포인트 50보다 항상 엄격해 서버 거절에 닿지 않는다.
export const SEARCH_QUERY_MAX = 50;
