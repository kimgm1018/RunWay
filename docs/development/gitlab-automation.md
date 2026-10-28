# 자연어 요청으로 GitLab MR 작업하기

사용자가 “이번 변경으로 MR 만들어줘”, “MR 본문에 검증 결과 반영해줘”라고 요청하면 AI가 요청 범위와 실제 변경 내용을 확인해 초안을 작성한다. 로컬 도구는 팀 템플릿, Jira 연결, 담당자와 옵션을 채워 API로 생성·수정하고 결과를 재조회한다. 사용자가 JSON이나 명령어를 직접 작성할 필요는 없다. Python 3.11 이상, 표준 라이브러리만 사용한다.

## 작업 흐름

1. `AGENTS.md`, `docs/development/git-convention.md`, `.gitlab/merge_request_templates/Default.md`와 관련 Jira 업무를 확인한다. 사용자의 요청 범위를 우선한다.
2. 사용자가 MR 생성을 요청한 경우 실제 커밋·차이·검증 결과를 확인해 변경 목적을 설명하는 제목과 본문을 작성한다. 커밋·Push가 필요하지만 아직 요청되지 않았다면 먼저 로컬 작업과 검증을 마치고 필요한 다음 동작만 확인한다.
3. AI가 `.gitlab-local/drafts/`에 초안을 작성한다. 제목은 요청의 목적을, 본문은 실제 변경과 검증 결과를 담는다. 실행하지 않은 검증을 통과했다고 쓰거나 체크하지 않는다. 여러 영역을 바꾸면 제목 scope를 생략하고 본문에 변경 영역을 적는다.
4. 읽기 전용 미리보기로 제목·본문·브랜치·담당자·옵션을 확인한다. 사용자가 이미 MR 생성을 요청했고 초안이 그 범위 안이면 별도 승인을 반복해서 묻지 않는다. 범위 밖 변경이나 부족한 정보만 확인한다.
5. 해당 미리보기의 해시를 실행 인자로 전달해 생성·수정한다. 해시는 초안과 원격 상태의 변경을 확인하는 수단이며 사람의 동의 자체를 증명하지 않는다.
6. 반환된 MR 링크와 필드 검증 결과를 알리고, 지원되는 환경에서는 생성한 MR을 현재 채팅에 첨부한다. 커밋·Push·병합은 이 도구가 수행하지 않는다. Jira도 자동으로 완료 처리하지 않는다.

자연어 해석과 변경 내용의 의미 판단은 AI가 담당한다. 스크립트는 별도의 AI 서비스나 API Key를 요구하지 않는다. 템플릿과 옵션 검사는 요청한 MR을 정확히 만드는 보조 절차이다.

## 인증정보

기존 `.env.example`의 GitLab 설정 이름을 사용한다. 실제 값의 입력·수정은 사용자가 로컬에서 수행한다. AI는 `.env` 및 실제 인증정보가 있는 `.env.*`를 직접 읽지 않는다. 도구만 내부적으로 사용하며 연결 상태·설정 누락 이름·처리 결과만 확인한다. 토큰 발급 가이드는 이 문서에 포함하지 않는다.

`.gitlab-local/`의 초안·실행 기록은 Git에서 제외한다. HTTP 인증 헤더와 오류 응답 본문은 출력하지 않는다. MR 변경 조회에서 `.env`와 실제 `.env.*` 파일의 diff는 출력하지 않는다. 인증정보 없는 `.env.example`은 예외이다.

## 읽기 전용 조회

```powershell
python scripts/gitlab/manage_mr.py --check
python scripts/gitlab/manage_mr.py --list
python scripts/gitlab/manage_mr.py --detail 5
```

`--check`는 현재 사용자와 프로젝트 접근을 확인한다. `--list`는 열린 MR을 조회한다. `--detail`은 본문·변경 내용·충돌 상태·파이프라인을 조회한다. 충돌 상태가 `checking` 등 확인 중이거나 파이프라인이 없으면 통과로 해석하지 않는다. 대규모 변경의 diff는 GitLab 서버 제한으로 일부 생략될 수 있으므로 `collapsed`, `too_large` 등의 상태를 확인한다.

## 초안과 미리보기

다음은 AI가 작성하는 입력 형식 예시이다. 실제 제목·작업 내용·검증 결과로 바꾸어 사용한다.

```json
{
  "source_branch": "feat/S15P31E105-29-gitlab-mr-automation",
  "summary": "자연어 요청에 맞춘 GitLab MR 생성·수정 지원",
  "changes": [
    "GitLab MR 조회·생성·수정과 결과 검증을 추가한다.",
    "변경 영역: scripts/gitlab, docs, .gitignore"
  ],
  "tests": ["[x] 모의 API를 사용한 생성·수정·오류 복구 테스트 통과"],
  "notes": ["실제 MR 생성·수정 검증 여부를 별도로 기록한다."]
}
```

- `source_branch`: 생략하면 현재 로컬 브랜치. 원격에 존재하는 Jira 작업 브랜치여야 한다.
- `jira_key`: 생략하면 브랜치에서 추출한다.
- `type`: 생략하면 브랜치 type. 팀에서 정한 type만 사용한다.
- `scope`: 선택 항목. 실제 변경 영역이 하나이고 팀 scope와 맞는 경우만 지정한다. 공통 도구나 여러 영역 변경에는 생략한다.
- `summary`: 제목에서 Jira Key와 type을 제외한 변경 목적.
- `changes`, `tests`, `notes`: 각각 본문 작업 내용·검증·참고 항목. 생성 시 `changes`는 필수이다. 검증 결과가 입력되지 않으면 템플릿의 미체크 목록을 유지한다.
- `draft`: 선택 항목. `true`이면 Draft MR을 생성한다.
- `iid`: 기존 MR을 수정할 때 지정한다. 생략한 본문 섹션은 유지하며 추가 섹션도 보존한다. 생성과 달리 기존 제목에서 summary를 가져올 수 있다.

```powershell
python scripts/gitlab/manage_mr.py --input .gitlab-local/drafts/mr.json
```

도구는 `dev` 대상, 현재 GitLab 사용자 담당자, squash, source branch 삭제 옵션을 적용한다. 같은 source·target의 열린 MR이 있으면 기존 링크를 반환한다. 수정 요청이 있는 경우만 해당 `iid`로 수정 초안을 만든다. 새 MR은 실제 원격 변경이 있고 최신 `dev`가 반영된 작업 브랜치로 생성한다. 수정 미리보기 역시 현재 브랜치 상태를 검사한다.

## 실행 및 결과 검증

사용자의 MR 생성·수정 요청 범위에서 AI가 미리보기의 `approval_sha256`를 그대로 사용한다.

```powershell
python scripts/gitlab/manage_mr.py --input .gitlab-local/drafts/mr.json --apply --approved-sha256 <미리보기의_해시>
python scripts/gitlab/manage_mr.py --verify <MR_IID>
```

초안, 템플릿, source·target SHA, 기존 MR 내용이 달라지면 새 미리보기가 필요하다. 해시는 GitLab의 원자적 조건부 쓰기를 대체하지 않는다. 미리보기 후 다른 작성자가 수정했거나 브랜치가 이동한 경우 변경 내용을 다시 확인한다.

생성·수정 후 제목·본문·브랜치·담당자·squash·source branch 삭제 옵션·head SHA를 재조회해 검증한다. 종료 코드 `0`은 조회 또는 검증 성공, `1`은 오류, `2`는 MR은 존재하지만 필드 검증 불일치를 의미한다. 미리보기와 기존 MR 재사용도 `0`이므로 생성 여부는 `gitlab_changed`로 구분한다.

## 통신 중단 및 복구

- 변경 요청 직전에 사이트·프로젝트·브랜치별 실행 기록을 남기고 같은 작업을 동시에 실행하지 않는다.
- 생성 성공 후 검증이 실패해도 기록의 `iid`를 사용하며 새 MR을 만들지 않는다. `--verify`로 해당 MR을 재검증한다.
- 생성 요청이 타임아웃되면 생성됐는지 불확실하다. `--list`로 동일 브랜치의 MR을 먼저 확인하고 존재하면 `--detail`로 확인한다. 제목·초안을 바꿔 재생성을 시도하지 않는다.
- 관리자는 확인된 실제 MR의 `iid`를 해당 로컬 기록에 보완하고 `--verify`를 실행할 수 있다. 예상 필드·SHA는 임의로 고치지 않는다.
- MR이 생성되지 않았음이 확인된 경우에만 관리자가 해당 기록을 보관 후 해제한다. 중단된 `.lock`도 다른 실행이 없는지 확인한 후 해당 파일만 해제한다. 실행 기록 전체를 삭제하지 않는다.
- 수정 결과 불일치는 최신 MR을 조회하고 실패 항목만 검토한다. 타인의 변경을 덮어쓰도록 예상 기록을 조작하지 않는다.

## 검증

```powershell
python -m unittest discover -s scripts/gitlab/tests -v
python -m unittest discover -s scripts/jira/tests -v
```

모의 테스트는 팀 필드 구성, 생성·수정·재조회, 기존 MR 재사용, 미리보기 후 변경, 중복·동시 실행, 결과 불확실 기록, 오류 비노출과 비공개 파일 diff 제외를 확인한다. 실환경 변경 검증은 사용자가 요청한 MR 작업에서 별도로 확인한다.

2026-10-15: 새 도구로 연결·목록·상세·diff·충돌 상태·파이프라인 조회를 확인한 뒤, 사용자 요청에 따라 별도 검증 브랜치로 Draft MR !7을 생성했다. 제목·본문·본인 담당자·dev 대상·squash·source branch 삭제 옵션을 재조회해 검증했고, 같은 MR의 제목·본문 수정 후 재조회도 통과했다. GitLab이 본문 끝 줄바꿈을 제거하는 동작을 반영해 검증 로직과 회귀 테스트를 보완했다. 모의 테스트는 25개, 기존 Jira 회귀 테스트는 39개 통과했다. 사용자가 결과를 확인하고 검증 MR을 직접 닫았으며 병합하지 않았다. 닫힌 이후 검증 브랜치에 추가한 보완 커밋은 해당 MR의 diff SHA에 반영되지 않아 최종 스냅샷 SHA 검증은 불일치로 남았다. 최종 코드의 검증은 실제 작업 MR에서 별도로 수행한다. 이전 일회성 API 검증과 구분한다.

참고: [GitLab MR API](https://docs.gitlab.com/api/merge_requests/), [Repository compare API](https://docs.gitlab.com/api/repositories/#compare-branches-tags-or-commits).
