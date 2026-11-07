# 418 로컬 통합 QA — 진행 요약 (2026-11-07)

AI 주도 API 실행. **불통과만** 사람 재현·스크린샷. 상세는 Suite별 보고서.  
후속 분류(실기기 / FE / BE / AI): [418-follow-up-triage.md](./418-follow-up-triage.md)

| Suite | 보고서 | 종합 | 불통과 | Blocked·비고 |
| --- | --- | --- | --- | --- |
| S01 | [S01-auth-profile-settings.md](./S01-auth-profile-settings.md) | Partial | TC-S01-08 페이스 수정 | TC-S01-07 Blocked(앱 강제종료) |
| TS-FEAS | [TS-FEAS-precheck.md](./TS-FEAS-precheck.md) | Partial | — | 04 헬스 Blocked |
| S02 | [S02-watch-health.md](./S02-watch-health.md) | Partial | — | 06·08 헬스 Blocked, 07 Partial |
| S03 | [S03-course.md](./S03-course.md) | Partial | — | 01~03 Route ready 실패 |
| S04 | [S04-personal-run.md](./S04-personal-run.md) | Partial | — | 01 코스/Route · 08 W-A 충전; session 14/15 |
| S05 | [S05-crew.md](./S05-crew.md) | Partial | TC-S05-08 빈검색 500 | — |
| S06 | [S06-group-run.md](./S06-group-run.md) | Partial | — | 22 워치 UI; groupRunId=11 |
| S07 | [S07-community.md](./S07-community.md) | Partial | — | 01·02 통과(session 14/15→post) |
| S08 | [S08-music.md](./S08-music.md) | Partial | — | 01·02 실앱 Blocked · 03 통과 |
| S09 | [S09-security.md](./S09-security.md) | Partial | — | 03 Partial · 04 IME Blocked |

## 사람 재현 우선순위

1. **TC-S01-08** — 기본 목표·평소 페이스 수정 — `images/s01/qatest_S01_change_mypace.png`
2. **TC-S05-08** — 크루 빈 검색 500 — `images/s05/`
3. **Route 엔진 복구** 후 TC-S03-01~03 · TC-S04-01
4. **갤럭시+삼성헬스** — TC-S02-06·07·08
5. **W-A 충전 후** — TC-S04-08 인계 · TC-S06-22 워치 순위
6. (선택) Spotify Premium / 멜론 실기기 — S08-01·02 · 에뮬 한글 IME — S09-04

## 기기

- W-A `RFAY31E5QKM` — 충전 중(실물 워치 TC 보류)
- W-B `RFAXB285QAE` · 에뮬 `emulator-5554`
