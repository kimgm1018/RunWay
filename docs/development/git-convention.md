# Git 컨벤션

> **현재 운영 기준**
>
> `master` + 단일 `dev` + Jira 작업 단위 Short-lived Branch 구조로 운영한다.
>
> Merge method는 **Merge commit**을 사용한다.
>
> 작업 브랜치는 `dev`에 수시로 통합하고, 매주 수요일 QA 및 통합 테스트를 거쳐 안정화된 `dev`를 `master`에 병합한다.

## 1. 브랜치 전략

### 브랜치 역할

- `master` : 배포·시연 가능한 안정 버전
- `dev` : 팀 개발 내용이 지속적으로 합쳐지는 통합 브랜치이자 Default Branch
- 작업 브랜치 : Jira Task/Story 단위의 실제 개발 브랜치
  - Task와 Story는 **각각 별도 worktree 하나, 브랜치 하나, MR 하나**를 가진다. (Jira 이슈 1개 = worktree 1개 = 브랜치 1개 = MR 1개)
  - 다른 Jira 업무는 같은 worktree에서 개발하지 않는다. 같은 업무를 재개할 때만 해당 worktree와 브랜치를 재사용한다. 기본 체크아웃에서 브랜치만 바꾸어 작업하지 않는다. 세부 확인·분리 절차는 루트 `AGENTS.md`를 따른다.
- `master`, `dev` 직접 Push 금지 → Merge Request를 통해서만 병합
- FE/BE/AI 등 영역별 `dev-fe`, `dev-be` 같은 장기 브랜치는 만들지 않는다.

```
master
  ↑  매주 수요일 QA 후 안정 버전 병합
  │
dev
  ↑        ↑        ↑
feat/*    fix/*    refactor/*
```

### 통합 주기

- 작업 브랜치 → `dev` : 작업 완료 시 수시로 MR 생성 및 병합
- `dev` → `master` : **매주 수요일** 정기 통합, 팀장(Maintainer)이 진행
  - ⚠️ 팀장은 병합 전 MR의 **Squash 옵션이 해제되어 있는지 반드시 확인**한다.
    `dev`와 `master`의 공통 이력을 유지하고 이후 통합을 쉽게 하기 위해 Squash하지 않는다.
- 수요일이라도 빌드·테스트가 실패하거나 시연 가능한 상태가 아니면 `master` 병합은 보류한다.

## 2. 브랜치 네이밍

**형식**

```
<type>/<JIRA-KEY>-<description>
```

**Type**

- `feat` : 새로운 기능
- `fix` : 버그 수정
- `refactor` : 기능 변경 없는 리팩터링
- `test` : 테스트 코드
- `docs` : 문서 수정
- `chore` : 기타 설정 및 작업
- `ci` : CI/CD 설정 변경

**예시**

```
feat/<JIRA-KEY>-new-feature
```

> Jira-GitLab 작업 추적을 위해 **브랜치명에는 Jira Issue Key를 포함**한다.

## 3. 커밋 컨벤션

[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) 형식을 기반으로 작성한다.

**형식**

```
<type>(<scope>): <내용>
```

- `type`은 2번 브랜치 네이밍의 **Type**과 동일하다.

**초기 Scope**

- `fe` : `frontend/`
- `be` : `backend/`
- `ai` : `ai/`
- `infra` : `infra/` 및 인프라 설정
- `docs` : `docs/`, `exec/` 및 문서
- `wear` : `wear/` (워치 앱)

개발 과정에서 서비스 경계나 디렉터리 구조가 바뀌면 Scope도 팀 합의에 따라 유동적으로 추가·변경한다.

**예시**

```
feat(fe): 상세 화면 구현
```

- 커밋 메시지에는 Jira Issue Key를 필수로 넣지 않는다.
- Scope는 담당자 역할이 아니라 **실제로 변경한 코드/모듈 영역**을 기준으로 작성한다.
- Scope가 불필요한 경우 생략할 수 있다.
- 여러 영역을 함께 변경하는 커밋은 Scope를 생략한다. 예: `feat: 러닝 기록 저장 및 조회 구현`.

## 4. Merge Request 규칙

### 작업 브랜치 → dev

**MR 제목 형식**

```
[<JIRA-KEY>] <type>(<scope>): <내용>
```

**예시**

```
[<JIRA-KEY>] feat(be): 상세 조회 API 구현
```

- MR 제목에는 **Jira Issue Key를 반드시 포함**한다.
- 여러 영역을 함께 변경하는 MR은 제목에서 Scope를 생략하고, 변경 영역을 MR 본문에 적는다. 예: `[<JIRA-KEY>] feat: 러닝 기록 저장 및 조회 구현`.
- 하나의 MR은 가능한 한 하나의 Jira Task/Story 또는 하나의 명확한 변경 목적을 가진다.
- 큰 MR보다 리뷰 가능한 작은 단위의 MR을 우선한다.
- Squash Commit Message Template은 `%{title}`을 사용해 MR 제목과 Jira Issue Key가 최종 Squash Commit에도 남도록 했다.

### dev → master

- 여러 Jira Task를 한 번에 안정 버전으로 승격하는 통합 MR이므로 특정 Jira Issue Key를 제목에 강제하지 않는다.

**예시**

```
[Sprint 3] dev → master
```

### MR 본문 템플릿

작업 MR에는 Jira 자동 완료를 위해 Closing Keyword를 사용한다.
`.gitlab/merge_request_templates/Default.md`에 등록되어 있어 MR 생성 시 자동으로 채워진다.

```markdown
## 관련 이슈
Closes <JIRA-KEY>

## 작업 내용
- [작업 내용]

## 테스트
- [ ] 로컬 실행 확인
- [ ] 관련 테스트 통과
- [ ] MR 변경 내용과 검증 결과를 한 번 더 확인하고 병합 가능 여부 판단

## 참고
- [리뷰 시 확인할 사항]
```

- FE 변경 등 화면 확인이 필요한 경우 스크린샷을 첨부한다.
- `dev → master` 통합 MR에는 개별 Jira Task의 `Closes`를 넣지 않는다.

## 5. 코드 리뷰 규칙

- 다른 팀원의 승인은 필수가 아니다. 필요한 경우에만 다른 팀원에게 리뷰를 요청한다.
- 작성자는 MR의 변경 내용과 검증 결과를 한 번 더 확인하고, 병합해도 괜찮다고 판단하면 직접 병합할 수 있다.
- CI가 구성된 이후에는 CI가 실패한 상태에서 Merge하지 않는다.
- 공통 구조나 여러 영역에 영향을 주는 변경은 영향 범위를 확인하고, 필요한 경우 관련 담당자에게 리뷰를 요청한다.
- 리뷰가 어려울 정도로 MR이 커지기 전에 Jira Task/MR을 분리한다.

## 6. Merge 규칙

### 공통

- 프로젝트 Merge method는 **Merge commit**을 사용한다.
- `master`, `dev`에는 직접 Push하지 않는다.

### 작업 브랜치 → dev

- 작업 완료 후 MR을 생성한다.
- MR 전 최신 `dev` 내용을 작업 브랜치에 반영해 충돌 여부를 먼저 확인한다.
- 작성자가 MR의 변경 내용과 검증 결과를 다시 확인한 뒤 `dev`에 병합한다. 다른 팀원의 리뷰는 필요한 경우에 요청한다.
- **Squash Merge를 사용한다.**
  - 프로젝트 전체 설정을 `Encourage`로 두어 MR 병합 시 Squash가 기본으로 체크된다.
- Merge 후 Source Branch는 삭제한다.
  - GitLab에 `Delete source branch` 기본 체크가 설정되어 있으므로, MR 병합 시 체크를 해제하지 않으면 자동으로 삭제된다.
- Source Branch가 삭제되어도 MR 기록은 유지되므로 Jira-GitLab 작업 이력은 계속 추적할 수 있다.
- `Closes <JIRA-KEY>`와 Jira Transition 설정을 통해 `dev` 병합 시 해당 Jira Task를 Done으로 전환한다.

### dev → master

- 매주 수요일 QA 및 통합 테스트 후 안정화된 버전을 MR로 `master`에 병합한다.
- **Squash Merge를 사용하지 않는다.**
  - MR 병합 전 Squash 옵션이 해제되어 있는지 직접 확인한다.
- `master`는 언제든 시연·배포 가능한 상태를 유지한다.

## 7. 모노레포 운영 원칙

초기 최상위 디렉터리는 아래 구조로 시작한다.

```
backend/
frontend/
ai/
infra/
docs/
exec/
```

- 위 구조는 초기 기준이며, **개발하면서 실제 서비스 경계와 필요에 따라 팀 합의로 유동적으로 변경**할 수 있다.
- 모든 개발 결과는 단일 `dev`에서 지속적으로 통합한다.
- Git Scope도 실제 모듈 구조를 기준으로 사용하고 구조 변경 시 함께 조정한다.
- 공통 설정 파일과 여러 영역에 영향을 주는 변경은 작업 전 팀에 공유한다.

## 8. 충돌 최소화 원칙

- 작업 브랜치는 가능한 한 **1~2일 단위의 짧은 브랜치**로 유지한다.
- 작업 시작 전 `dev`를 최신화한다.
- MR 생성 전 최신 `dev`를 다시 반영한다.
- FE/BE 등 독립적으로 변경 가능한 영역은 Jira 작업 자체를 분리한다.
- API 명세, DB Schema처럼 여러 영역에 영향을 주는 사항은 구현 전에 합의한다.
- 공통 파일 변경은 사전 공유하고, 필요하면 Jira Task 자체를 분리한다.

```
docker-compose.yml
.gitlab-ci.yml
.env.example
.gitattributes
공통 설정 파일
DB migration / Schema
공통 API 계약
공용 컴포넌트
```

## 9. Jira → GitLab 개발 흐름

```
① Jira Task/Story 생성 및 FE/BE 등 작업 영역 분리
      ↓
② dev 최신화
      ↓
③ Jira 업무 전용 worktree와 Jira Key 포함 작업 브랜치 생성
      ↓
④ 개발 및 Commit
      ↓
⑤ 최신 dev 반영 및 충돌 확인
      ↓
⑥ Jira Key 포함 MR 생성 → dev
      ↓
⑦ 작성자 검증 및 필요 시 팀원 리뷰
      ↓
⑧ Squash Merge + Source Branch 삭제
      ↓
⑨ Jira Done 자동 전환
      ↓
⑩ 매주 수요일 QA 및 dev 통합 테스트
      ↓
⑪ 안정화된 dev → master Merge commit
```

> CI Runner 및 Pipeline이 구성되면 MR 단계에 자동 빌드·테스트를 추가하고, 성공한 Pipeline을 Merge 조건으로 사용한다.
