# Route (이전 위치)

Route 추천 엔진과 서비스는 [`ai/route_service/`](../../../route_service/)로 옮겼다(Jira S15P31E105-381).

- 서비스 실행·구조: [ai/route_service/README.md](../../../route_service/README.md)
- 백엔드 연동 API: [ai/route_service/API.md](../../../route_service/API.md)
- 기술 가이드·개발 이력: [ROUTE_TECHNICAL_GUIDE.md](../../../route_service/ROUTE_TECHNICAL_GUIDE.md), [ROUTE_DEVELOPMENT_HISTORY.md](../../../route_service/ROUTE_DEVELOPMENT_HISTORY.md)
- 엔진 코드 `runway_routing/`, `analysis/`, 도구 `tools/`, 위 두 문서는 `git mv`로 옮겨 이력이 이어진다.
  `ROUTE_BACKEND_README.md`는 `ai/route_service/README.md`에 합쳤고, 데모(`route_demo/`)는 서비스로 대체되어 지웠다.
