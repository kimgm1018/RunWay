# RunWay 워치 UI — 개발 핸드오프 (Rajdhani 버전)

워치 앱 러닝 화면 UI를 구현할 때 기준으로 삼는 디자인 핸드오프예요. 확정 시안은 S15P31E105-519, 저장소 반영과 구현은 S15P31E105-613에서 진행했어요.

## 쓰는 법
1. `development-guide.md`를 읽고, 거기 적힌 순서대로 `spec/` 명세를 확인해요.
2. 저장소 공통 규칙(루트 `AGENTS.md`)과 요구사항·API 문서가 이 핸드오프보다 우선해요. 핸드오프의 '확인 필요' 항목은 실제 계약을 보고 정해요.
3. 화면 하나씩, 또는 부품(Theme → RimGauge → EdgeButton …)부터 차례로 구현해요.

## 들어 있는 것
| 경로 | 내용 |
| --- | --- |
| `development-guide.md` | 구현 지침(원본 파일명 `CLAUDE.md`, 저장소 규칙에 맞춰 이름 변경): 플랫폼 가정, 지킬 것, 부품·탐색·접근성, 완료 기준 |
| `spec/tokens.md` · `tokens.json` | 색·글꼴·글자 크기·부품 좌표 (454px = 227dp 기준) |
| `spec/flows.md` | 개인·그룹 페이지 연결, 규칙, 상태 전이표 |
| `spec/screens.md` · `screens.json` | 화면 53개 목록·설명·확인 필요 항목·테두리 게이지 값 |
| `spec/unconfirmed.md` | 확인 안 된 계약·정책, 디자인 잔여 문제, 접근성 메모 |
| `spec/requirements-brief.md` | 기능 수정 요구사항 원문 |
| `screens/*.png` | 화면만 잘라낸 원형 이미지 53장 (908×908, 2배, 바깥 투명) |
| `screens.html` | 케이스 목업 포함 전체 화면 갤러리 (브라우저로 열기) |
| `design-source/project/` | 디자인 캔버스 원본 (Rajdhani 페이지만). 디자인 도구에 다시 올릴 수 있어요 |

## 알아 둘 점
- 화면의 숫자는 모두 목업이에요.
- 서비스 저장소·API 문서와는 대조하지 못했어요. '확인 필요' 항목은 실제 계약을 보고 정해야 해요.
- Wear OS(Kotlin/Compose)는 요구사항 문서에 나온 코드 경로를 보고 한 가정이에요.
