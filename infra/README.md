# RunWay 인프라

단일 EC2에서 Docker Compose로 실행한다.
서버 배치 경로는 `/home/ubuntu/runway/infra`다.
**Git 변경만으로 서버 설정이 적용되지는 않는다.** 검증 후 변경한 설정만 서버에 반영한다.

## 파일 구성

| 경로 | 역할 |
| --- | --- |
| `compose.yaml`, `nginx/default.conf` | Nginx·HTTPS·백엔드/Jenkins 라우팅, 루트 `/` 소개 랜딩(`../frontend/landing/`) 서빙 |
| `jenkins/compose.yaml`, `jenkins/backend-agent/` | Jenkins 컨트롤러·Java 21 빌드 에이전트 |
| `jenkins/mobile-agent/` | Node·Java·Android 도구를 갖춘 모바일 빌드 에이전트 |
| `jenkins/watch-agent/` | Java 25·Android 도구를 갖춘 워치 빌드 에이전트 |
| `jenkins/ai-agent/`, `jenkins/check-ai.sh` | AI 전용 에이전트·Python 테스트·이미지 빌드 검사 |
| `jenkins/Jenkinsfile.ci` | 변경 영역별 병렬 검사·GitLab 영역별 결과·Jenkins 세부 단계 표시 |
| `jenkins/Jenkinsfile.mobile-apk`, `jenkins/build-mobile-apk.sh`, `jenkins/check-mobile-static.sh` | master ARM64 debug·release APK 생성·보관과 공통 빌드·타입 검사·린트 명령 |
| `jenkins/Jenkinsfile.watch-apk`, `jenkins/build-watch-apk.sh`, `jenkins/update-git-reference.sh` | 제품 워치 앱 검사·APK 생성과 master 산출물 보관 |
| `jenkins/Jenkinsfile.mobile` | dev·master 대상 MR의 모바일 타입·린트·테스트 검사 |
| `jenkins/Jenkinsfile.backend` | dev·master 대상 MR의 임시 병합 검사·테스트·JAR 생성 |
| `jenkins/Jenkinsfile.backend-cd` | master 병합 후 검사·이미지 생성·자동 배포 |
| `db/compose.yaml` | PostgreSQL 17·PostGIS 3.6·영속 저장 |
| `redis/compose.yaml`, `redis/start-redis.sh` | Redis 실행·Secret 주입·영속 저장 |
| `backend/compose.yaml`, `backend/Dockerfile` | 백엔드 실행 설정·이미지 제작 |
| `backend/deploy.sh`, `backend/check.sh` | 배포 전후 기동 검사·실패 시 이전 이미지 복구 |
| `ai/Dockerfile`, `ai/compose.yaml` | FastAPI·GRU/ODE CPU 추론 이미지·내부 네트워크 실행 |
| `ai/deploy.sh`, `ai/check.sh`, `jenkins/Jenkinsfile.ai-cd` | AI 이미지·모델 교체, 상태 확인·복구와 master 배포 흐름 |
| `route/compose.yaml`, `../ai/route_service/Dockerfile` | Route 코스 생성 이미지·내부 네트워크 실행 |
| `route/prepare-data.sh`, `route/deploy.sh`, `jenkins/Jenkinsfile.route` | Route 데이터 준비·master 배포·상태 확인·복구 |
| `jenkins/check-route.sh` | Route MR의 Linux API 검사·JUnit 보고서·임시 자원 정리 |
| `certbot/runway-cert-renew.*` | 인증서 갱신 스크립트·systemd service/timer |
| `backup/` | DB·업로드 파일 암호화 백업, 보관 정책·격리 복원 검사 |

## 실행 전 준비

- Docker·Compose, 도메인·HTTPS 인증서, 방화벽 22/80/443을 준비한다.
  DB는 외부에 공개하지 않으며 백엔드 18081·Jenkins 8080은 localhost에만 연결한다.
- 외부 볼륨 `runway_jenkins_home`, `runway_postgres_data`, `runway_redis_auth_data`와 Compose가 참조하는 네트워크를 준비한다.
  모바일은 `runway-ci_mobile_agent_work`, `runway-ci_mobile_android_sdk`, 워치는 `runway-ci_watch_agent_work`, `runway-ci_watch_android_sdk`도 `docker volume create <이름>`으로 준비한다. 기존 서버의 볼륨은 유지한다.
- DB 관리자·앱 비밀번호, Redis 비밀번호, JWT 키, Swagger 비밀번호 해시, Jenkins 에이전트 Secret을
  **Git 밖에서 준비**한다. 필요한 파일 경로는 각 Compose와 에이전트 스크립트를 확인한다.
  에이전트 Secret은 `infra/jenkins/secrets/<노드명>-secret`에 두고 UID 1000·권한 600을 사용한다.
  자세한 기준은 [Secret 관리 공통 규칙](../docs/development/secret-environment-variables.md)을 따른다.
- 백엔드 Secret 파일은 실행 UID 10001이 읽을 수 있어야 한다. 현재 기준은 디렉터리 700·파일 400이다.
  실제 비밀번호·키·해시·인증서 개인키·Jenkins 데이터는 커밋하지 않는다.
- Redis 설정 `backend/redis/redis.conf`·`entrypoint.sh`를 서버의 `~/runway/backend/redis/`에 배치한다.
  Redis Secret은 `~/runway/secrets/backend/redis-app-password`에 준비하며 위 백엔드 Secret 권한 기준을 따른다.
- 이미지 저장 폴더 `~/runway/data/images`를 UID/GID 10001·권한 700으로 준비한다.
  백엔드의 `/data/images`에 읽기·쓰기로 연결하며 실제 이미지 파일은 Git에서 제외한다.
- 삼성 Health SDK 1.1.0 AAR은 `~/runway/sdks/samsung-health/1.1.0/`에 준비한다.
  `/opt/samsung-health/`에 읽기 전용 연결하며 Gradle에 `-PsamsungHealthSdk=<AAR 경로>`로 전달한다.
- AI 에이전트는 `docker build -t runway-ai-agent:docker ~/runway/infra/jenkins/ai-agent`로 빌드한다.
  작업 볼륨 `runway-ci_ai_agent_work`와 배포 폴더 `~/runway/infra/ai`를 먼저 준비한다.
  배포 폴더는 에이전트에 읽기 전용으로 연결하고, Docker 소켓 GID는 실제 호스트 값에 맞춘다.
- 새 DB에는 앱 역할 `runway_app`과 CONNECT·public 스키마 USAGE/CREATE 권한을 준비한다.
  앱 비밀번호 파일과 DB 역할의 실제 비밀번호를 일치시킨다.
- 백엔드 에이전트 이미지는 `docker build -t runway-backend-agent:java21 ~/runway/infra/jenkins/backend-agent`로 빌드한다.
  `group_add`는 호스트 Docker 소켓의 실제 GID와 맞춘다. 소켓 접근은 호스트 Docker 제어 권한이다.
- 모바일 이미지는 `docker build -t runway-mobile-agent:android ~/runway/infra/jenkins/mobile-agent`로 빌드한다.
  워치 이미지는 `docker build -t runway-watch-agent:android ~/runway/infra/jenkins/watch-agent`로 빌드한다.
  Android 공식 도구 다운로드·사용 전 약관을 확인하며 Dockerfile은 약관에 자동 동의하지 않는다.
- AI 이미지는 저장소 루트에서 `docker build -f infra/ai/Dockerfile -t runway-ai:<버전> .`로 빌드한다.
  Python 3.12·CPU PyTorch를 사용하며, 모델 파일은 이미지에 포함하지 않는다.
- AI 모델은 `ai/models.json`의 고정 HF revision·SHA로 4개를 준비한다. `AI_MODELS_ROOT`를 UID 10001 소유로 먼저 만들고,
  Jenkins Secret text `runway-hf-read-token`을 등록한다. 모델은 버전별 읽기 전용 폴더에 두며 이미지·Git에 넣지 않는다.
- AI DB 계정은 EC2에서 `sudo python3 <prepare_db.py 경로> --container <DB 컨테이너> --secret-file <Secret 경로>`로 준비한다.
  `AI_DB_URL_FILE`로 파일 경로만 전달한다. 계정은 CONNECT·USAGE·courses SELECT만 먼저 받는다. 변수·기능 기본값은 [예시](ai/.env.example), API·모델 계약은 [AI 서비스 안내](../ai/service/README.md)를 따른다.
- Route는 기존 AI 에이전트와 `runway-hf-read-token`을 사용한다. EC2에
  `sudo install -d -o 10001 -g 10001 -m 750 /home/ubuntu/runway/data/route-bundles`로 데이터 폴더를 준비한다.
  고정 HF revision의 `route_data_v2/`를 받아 `DATA_MANIFEST.md`의 크기·SHA 검증 후 이미지 빌드 context로 전달한다.
  토큰은 다운로드 단계에만 주입하고, 데이터 묶음은 Git·Jenkins 산출물에 포함하지 않는다.

## 적용 순서

각 단계의 설정은 적용 전에 검사한다. Compose는 `docker compose -f <파일> config --quiet`, Nginx는 `nginx -t`를 사용한다.

1. DB와 Jenkins 컨트롤러를 준비하고 노드·Credentials·Job을 등록한 뒤 에이전트를 연결한다.
   모바일은 `docker compose -f ~/runway/infra/jenkins/compose.yaml up -d mobile-builder`로 시작한다.
   최초 SDK 약관 동의는 `docker compose -f ~/runway/infra/jenkins/compose.yaml exec mobile-builder runway-sdkmanager --licenses`로 수행한다.
   이후 같은 도구로 `platform-tools`, `platforms;android-36`, `build-tools;36.0.0`, `ndk;27.1.12297006`, `cmake;3.22.1`을 설치한다. 작업·SDK·Gradle 캐시는 볼륨으로 유지한다.
   워치는 `up -d watch-builder`로 시작하고 같은 방식으로 약관 확인 후 `platform-tools`, `platforms;android-37.0`, `build-tools;36.0.0`을 설치한다. SDK·작업·Gradle 캐시는 모바일과 분리한다.
   AI는 Secret을 준비한 뒤 `docker compose -f ~/runway/infra/jenkins/compose.yaml up -d ai-builder`로 연결한다.
2. `docker compose -f ~/runway/infra/redis/compose.yaml up -d --wait`로 Redis를 실행한다. `runway_redis` 내부 네트워크도 이때 생성된다.
3. Nginx·백엔드가 사용하는 `runway_service`, `runway-ci_default`, `runway-db_default` 네트워크를 준비한다.
   최초 인증서 발급은 HTTP 전용 설정으로 진행하고, 인증서·백엔드·Jenkins가 준비된 뒤 최종 HTTPS 설정을 적용한다.
   백엔드의 `BACKEND_AUTH_TRUSTED_PROXIES`는 Nginx·백엔드 전용 `runway_service`의 실제 대역(현재 `172.18.0.0/16`)과 맞춘다.
   컨테이너 재생성에는 유지되지만 네트워크를 새로 만들면 다시 확인한다. 전체 인터넷을 신뢰하지 않으며 백엔드 직접 외부 접근은 차단한다.
4. AI를 실행할 때는 준비한 변수를 환경변수 또는 `--env-file <설정 파일>`로 전달하고
   `docker compose -f ~/runway/infra/ai/compose.yaml up -d --wait`를 실행한다.
   GRU·ODE 모델 로드까지 완료되어야 정상으로 판단한다. CPU 1개·메모리 1GiB 제한에서 실제 사용량을 확인한다.
   외부 포트 없이 `runway-ai_default`와 DB 내부 네트워크에 연결한다. 백엔드는 `runway-ai_default`에 함께 연결해
   `BACKEND_AI_BASE_URL=http://ai:8000`으로 실시간 코칭 AI04와 AI06 심박 개인화를 호출한다(S15P31E105-421·410). 백엔드 Compose가 이 외부 네트워크를
   참조하므로 AI Compose를 먼저 한 번 실행해 네트워크를 만든다.
5. Route CD로 이미지 빌드·엔진 예열을 확인한 뒤 배포한다. CPU 1개·메모리 1.5GiB·worker 1개로 실행하며,
   읽기 전용 파일시스템의 Numba 예열 캐시를 쓰기 가능한 `/tmp/numba_cache`로 복사한다.
   외부 포트 없이 `runway-route_default`에 연결한다. 백엔드 기동 전에 이 네트워크를 준비한다.
6. 백엔드를 실행한다. **수동 Compose 실행에는 현재 이미지의 `BACKEND_IMAGE`를 명시**한다.
   Route 연결은 `BACKEND_ROUTE_MODE=http`·`BACKEND_ROUTE_BASE_URL=http://route:8000`을 사용한다.
   C01 경사 계산 DEM은 Route 번들 v2의 검증된 파일을 읽기 전용으로 연결하므로 Route 데이터 준비 후 기동하며,
   기동 로그 `코스 DEM 준비 완료`를 확인한다. Route 데이터 revision 변경 시 마운트 경로·SHA를 함께 바꾼다(S15P31E105-568).
7. 인증서 갱신 스크립트는 `/usr/local/sbin/`, service/timer는 `/etc/systemd/system/`에 설치하고 timer를 활성화한다. UTC 03시·15시에 최대 30분 지연하여 갱신 여부를 확인한다.

## Jenkins 공통 설정

| 항목 | 기준 |
| --- | --- |
| 접속 주소 | https://k15e105.p.ssafy.io/jenkins/ |
| 빌드 노드 | `backend-builder`(`backend`)·`mobile-builder`(`mobile`)·`watch-builder`(`watch`)·`ai-builder`(`ai`), 각 executor 1 / Built-In Node executor 0 |
| 에이전트 접속 | 작업 경로 `/home/jenkins/agent`, 컨트롤러에 접속하는 방식·라벨이 일치하는 작업만 실행 |
| 모바일 도구 | Jenkins 접속 Java 21·앱 빌드 Java 17, Node 22·pnpm 11.28.9. 메모리 6GiB·CPU 2개 상한 |
| 워치 도구 | Jenkins 접속 Java 21·Gradle Java 25, Gradle 9.6.0·AGP 9.4.1·SDK 37. 메모리 4GiB·CPU 1개 상한 |
| AI·Route 도구 | Java 21·Docker CLI 에이전트에서 서비스별 Python 3.12 검사 컨테이너 실행. 에이전트 512MiB·CPU 1개, 검사는 CPU 1개·AI 1GiB·Route 1.5GiB 상한 |
| GitLab 연결 | `runway-gitlab`, 저장소 Credentials ID `runway-gitlab-repo` |
| 통합 MR CI | `runway-ci`, SCM `*/dev`, `infra/jenkins/Jenkinsfile.ci`. dev·master 대상 MR의 변경 영역만 검사. 공통 Jenkins 설정 변경·수동 실행은 백엔드·모바일·워치·AI·Route를 모두 검사 |
| 기존 단독 CI | `Jenkinsfile.backend`·`Jenkinsfile.mobile`은 기존 단독 검사 파일이며 신규 MR 검사는 통합 CI 사용 |
| 접근 권한 | 관리자와 조회 권한 분리. 익명 접근·자가 가입 제외 |

Webhook 경로는 `/jenkins/project/<작업명>`이며 Job별 Secret token을 별도 등록한다.
Jenkins 계정·Credentials·Job 설정은 영속 볼륨에서 관리하며 이 저장소가 자동 생성하지 않는다.
AI와 Route는 같은 노드를 사용하므로 executor 1에서는 두 검사가 차례로 실행된다.

**통합 CI 동시 실행(S15P31E105-667):** `runway-ci`는 `disableConcurrentBuilds`를 쓰지 않는다. MR마다 실행은 바로 시작하고,
`Prepare`는 먼저 비는 검사 노드(`backend || mobile || watch || ai`)에서, 영역 검사는 해당 영역 노드에서만 차례를 기다린다.
노드마다 executor가 1개라 같은 노드의 작업 폴더·Jest·타입 검사·Gradle 캐시를 두 실행이 동시에 쓰지 않는다.
영역 실행 시간은 노드를 받은 뒤부터 60분, 전체 실행은 노드 대기를 포함해 180분으로 제한한다.
영역 노드를 받아 체크아웃한 MR ref가 고정한 커밋과 다르면(같은 MR에 새 커밋 Push) 이전 커밋 검사는
`MR에 새 커밋이 올라와 이전 커밋 검사를 중단합니다`로 실패 처리하고 노드를 넘긴다. 최신 커밋은 새 알림 실행이 검사하며
GitLab MR에는 최신 커밋의 상태만 표시된다. 기존처럼 직렬 실행으로 되돌리려면 `Jenkinsfile.ci`의 `options`에
`disableConcurrentBuilds()`를 다시 추가한다. 옵션 변경은 해당 `Jenkinsfile.ci`로 한 번 실행된 뒤 Job 설정에 반영된다.

## 서비스별 CI/CD

### 백엔드

- **MR 검사:** 백엔드 변경 시 통합 CI에서 검사·테스트·JAR 빌드를 수행한다.
  체크아웃은 `backend/`·`docs/design/db/`·`ai/service/tests/fixtures/`·`infra/jenkins/`만 풀고, Git 객체는 백엔드 에이전트 참조 저장소에서
  재사용한다. `backend/`와 함께 위 `docs/design/db/`·`ai/service/tests/fixtures/`만 바뀐 MR도 백엔드를 검사한다.
  `./gradlew --no-daemon --build-cache --init-script ../ci-no-test-cache.gradle clean build`는 컴파일 결과만 에이전트 Gradle 빌드 캐시
  (`~/.gradle/caches/build-cache-1`)에서 재사용한다. init script는 Jenkinsfile이 만들어 모든 Test 태스크의 캐시를 막으므로,
  검사하는 코드(master 대상 MR 등)의 `build.gradle`과 관계없이 DB 통합 테스트를 포함한 전체 테스트를 매번 실행한다.
  `~/.gradle`은 영속 볼륨이 아니라 에이전트 컨테이너를 다시 만들면 캐시가 비고 첫 실행만 전체 컴파일한다.
  캐시가 의심되면 백엔드 에이전트에서 해당 폴더를 지운다. 다음 실행은 캐시 없이 전체 컴파일하며 결과는 같다.
- **배포:** `runway-backend-cd`는 SCM `*/dev`의 `infra/jenkins/Jenkinsfile.backend-cd`를 사용하며 master Push로 배포한다.
  이미지 교체에 실패하면 이전 이미지로 복구한다.
- **결과·보관:** JUnit 결과와 JAR을 보관한다. 배포 전후·복구 후 이미지 ID, 내부 readiness `200/UP`와 업무 HTTP 응답을 확인한다.
  상태 API는 컨테이너 루프백 8082에만 제공한다.
- **설정·주의:** 새 배포는 항상 readiness로 검사한다. 이미지 롤백은 DB 마이그레이션을 되돌리지 않는다.
  검사 이미지 `python:3.12-alpine`은 기존 서비스 교체 전에 준비한다.
  장소 검색은 배포 전에 EC2의 `~/runway/secrets/backend/place-search.env`를 준비한다. 파일 소유자는 `10001:10001`, 권한은 `400`으로 설정한다.
  [백엔드 README](../backend/README.md)의 장소 검색 변수 5개를 줄마다 `이름=값` 형식으로 입력한다. 값에 따옴표는 붙이지 않는다.
  API HUB·Maps 키 4개를 모두 채운 뒤 `BACKEND_PLACE_SEARCH_ENABLED=true`로 켠다. 키 준비 전에는 `false`로 둔다.

최초 readiness 전환 때만 `BACKEND_LEGACY_HEALTH_IMAGE_ID`에 기존 컨테이너의 정확한 `sha256:...` 이미지 ID를 지정할 수 있다.
해당 이미지의 배포 전·복구 검사에만 기존 시작 로그·404 확인을 허용하며, 미설정·ID 불일치 시 우회하지 않는다.
첫 readiness 배포 성공 후에는 이 설정을 제거한다.

### 모바일

- **MR 검사:** 타입·린트·전체 Jest는 매번 실행한다. `frontend/`의 `App.tsx`·`index.js`·`src/`·`__tests__/` 아래 JS/TS 소스만
  바뀌면 APK 대신 Android 릴리스 JS 번들을 생성한다(`Mobile JS Bundle`). `__tests__/` 아래 `.test.*`·`.spec.*` 파일만 바뀌면
  APK·JS 번들을 모두 생략한다. 네이티브·의존성·빌드 설정·그 밖의 프론트엔드 경로 변경과 공통 설정 변경·수동 검사는 APK를 빌드한다.
  소개 랜딩 `frontend/landing/`은 앱 빌드와 무관해 모바일 검사 대상이 아니다. 랜딩만 바뀐 MR은 검사 대상 외 파일만 바뀐 MR과 같이
  대상 브랜치와 병합 가능한지만 확인하고, 앱 코드와 함께 바뀌면 앱 코드 기준으로 위 규칙을 따른다.
- **배포:** `runway-mobile-apk`는 `infra/jenkins/Jenkinsfile.mobile-apk`로 master Push마다 ARM64 debug·release APK를 생성·보관한다.
  랜딩 배포에는 팀 테스트 서명을 사용한다. 대상은 ARM64 안드로이드 폰이다.
- **결과·보관:** APK 산출물은 최근 5개 빌드 기준으로 제한한다. 빌드 시간은 콘솔·`build-time.txt`, 작업별 시간은 Gradle profile 보고서에서 확인한다.
  Jest 변환 캐시는 `mobile_agent_work` 볼륨의 `/home/jenkins/agent/.cache/jest`, Gradle 캐시는 전용 볼륨에 유지한다.
  Jest는 MR·master 작업 모두 에이전트 CPU 상한에 맞춘 워커 2개(`--maxWorkers=2`)로 전체 테스트를 실행한다.
  컨테이너는 호스트 CPU 수를 보므로 워커 수를 명시한다. 병렬 실행이 의심되면 `--runInBand`로 되돌려 같은 테스트를 직렬로 확인한다.
  체크아웃 폴더를 삭제해도 캐시는 유지되며 검사 자체를 생략하지 않는다.
- **타입 검사·린트 캐시:** MR·master 작업 모두 `infra/jenkins/check-mobile-static.sh`로 전체 타입 검사·린트를 실행하고
  바뀌지 않은 파일의 결과만 재사용한다. TypeScript 증분 정보와 ESLint 내용 기반 캐시는
  `/home/jenkins/agent/.cache/mobile-static/<키>/`에 둔다. 키는 `package.json`·`pnpm-lock.yaml`·`tsconfig.json`·
  `.eslintrc.js`·`.eslintignore`·`babel.config.js` 해시이며, ESLint가 감지하지 않는 플러그인·파서 버전 변경도 새 캐시로 검사한다.
  7일 넘게 쓰지 않은 이전 키는 다음 실행에서 정리한다. 콘솔의 `타입 검사 소요 시간`·`린트 소요 시간`으로 효과를 확인한다.
  결과가 의심되면 모바일 에이전트에서 `rm -rf /home/jenkins/agent/.cache/mobile-static`으로 지운다.
  다음 실행은 캐시 없이 전체 검사하며 결과는 같다.
- **설정·주의:** `frontend/android/`·`package.json`·`pnpm-lock.yaml`·babel·metro·`react-native.config.js`·`app.json`·Jest 설정·`assets/`·
  알 수 없는 프론트엔드 경로가 함께 바뀌면 APK를 빌드한다. JS 번들은 네이티브 컴파일·Hermes 바이트코드 변환·APK 패키징을 검사하지 않으므로
  해당 오류는 APK를 생성하는 MR·수동 검사·master 작업에서 확인한다.

### 워치

- **MR 검사:** 제품 `wear/app`의 단위 테스트·Lint·debug APK를 검사한다. 실험용 `wear/demo`·기기 연결 테스트는 별도다.
- **배포:** `runway-watch-apk`는 `infra/jenkins/Jenkinsfile.watch-apk`로 master Push 후 제품 워치 debug·release APK를 생성·보관한다.
- **결과·보관:** JUnit·Lint·Gradle profile과 단계별 시간(`build-time-<단계>.txt`)을 보관한다.
  SDK·작업·Gradle 캐시는 모바일과 분리한다.
- **설정·주의:** 테스트·Lint·APK는 같은 Gradle 데몬을 재사용하고 성공·실패와 관계없이 마지막에 `--stage stop`으로 종료한다.
  Kotlin도 같은 데몬 안에서 컴파일하며, 정리 단계가 실행되지 못하면 데몬은 10분 유휴 후 종료한다.
  체크아웃은 `wear/`·`infra/jenkins/`·공통 debug 서명만 받고 작업 폴더는 매번 비운다.

### Git 참조 저장소(워치·통합 CI 준비·백엔드)

참조 저장소는 각 에이전트 작업 볼륨의 `/home/jenkins/agent/caches/runway-git-reference.git`이며 에이전트끼리 공유하지 않는다.
워치 검사는 `watch_agent_work`, 백엔드 검사는 `backend_agent_work` 볼륨의 참조 저장소를 쓴다.
준비(Prepare) 단계는 먼저 비는 검사 노드(`backend || mobile || watch || ai`)에서 실행되므로 그 노드 볼륨의 참조 저장소를 쓴다.
노드마다 executor가 1개라 한 노드의 참조 저장소를 두 실행이 동시에 갱신하지 않는다.
`update-git-reference.sh`가 체크아웃 직후 갱신해 다음 실행은 새 Git 객체만 받는다. 이 스크립트가 없는 오래된 MR 코드는 갱신만 건너뛴다.
참조 체크아웃이 실패하면(중단·시간 초과 제외) 참조 저장소 이름을 바꾼 뒤 지우고 참조 없이 한 번 더 체크아웃한다.
준비 단계는 변경 파일 확인·병합 검사를 위해 전체를 풀고, 백엔드 검사는 "백엔드" 절의 경로만 푼다.
참조 저장소는 자동 gc를 끄고 객체를 추가만 하므로 계속 커진다. 크기가 문제되면 진행 중인 CI가 없을 때 폴더를 지운다.
다음 실행이 원격에서 전체를 받아 다시 만든다.

### AI

- **MR 검사:** 모델 없는 API·배포 회귀 테스트와 이미지 빌드를 검사한다. 실제 모델 테스트의 생략 여부는 JUnit에 기록한다.
- **배포:** `infra/jenkins/Jenkinsfile.ai-cd`는 master 전용이다. 모델 준비 → DB 읽기 권한 확인 → 사전 로드 → 교체·검사 순서로 실행하며,
  실패하면 이전 이미지·모델·공개 설정으로 복구한다. `DEPLOY=false`, `PREPARE_MODELS=true`는 운영 교체 없이 모델만 준비한다.
- **결과·보관:** JUnit 보고서·이미지 정보를 보관한다. 실제 모델 로드·예측은 MR CI와 구분해 검증한다.
  `bash infra/ai/verify-isolated.sh <실행 이미지> <공개 모델 설정 파일> <PostGIS 이미지>`로 합성 코스 DB·기동 API·실패 롤백을 격리 검증한다.
- **설정·주의:** `AI_MODELS_ROOT`·`AI_DB_URL_FILE`을 지정한다. 배포 스크립트는 `.env`를 자동으로 읽지 않고 Jenkins가 전달한 값과
  검증된 모델 설정을 사용한다. HF 토큰은 다운로드 단계에만 주입하고, DB Secret은 시작 시 파일에서 읽으며 복구 기록에 저장하지 않는다.

GRU 개인화·ODE preview/forecast는 기본 OFF다. AI09 검증에는 `PERSONAL_PLAN_EXPERIMENTAL_ENABLED=true`와 유효한 코스가 필요하다.
짧은 요청의 메모리 측정은 장거리·동시 부하 성능 보장과 구분한다.

### Route

- **MR 검사:** `ai/route_service/`·`infra/route/` 변경 시 `route-ci`를 실행한다. 운영 Dockerfile의 `test` target으로 Python·런타임 의존성을
  공유해 데이터 없는 API·오류 처리·합성 회귀 테스트를 수행한다. HF 토큰·실제 데이터·운영 DB는 사용하지 않는다.
- **배포:** `runway-route-cd`는 `infra/jenkins/Jenkinsfile.route`, SCM `*/master`를 사용한다. 웹훅은 master Push만 허용하며,
  자동 배포는 체크아웃이 master인지도 검사한다. 수동 실행은 `DEPLOY` 선택을 따르고 최초에는 `DEPLOY=false`로 빌드·예열을 확인한다.
- **결과·보관:** JUnit 보고서를 보관하고 데이터가 필요한 엔진 테스트는 생략으로 기록한다. CD는 준비 상태·샘플 코스 생성을 검사하며
  실패 시 이전 이미지로 복구한다. 첫 배포 실패는 실패한 새 컨테이너만 정리한다.
- **설정·주의:** 저장소 루트에서 `ROUTE_CI_TAG=<실행별 소문자 태그> sh infra/jenkins/check-route.sh`로 MR 검사를 재현한다.
  임시 컨테이너·이미지는 실행별로 정리한다. 운영 준비 상태는 `GET /internal/v1/ready`, 코스 생성은 `POST /internal/v1/routes/recommendations`다.
  요청 계약은 [Route API](../ai/route_service/API.md)를 따른다.

### 소개 랜딩

- **경로:** `https://k15e105.p.ssafy.io/`(정확히 루트만)에서 `frontend/landing/index.html`을 제공한다. 이미지·파비콘은 HTML에 내장되어 있다.
  `/api/v1`·`/jenkins`·`/grafana`·인증서 갱신 경로는 기존 라우팅을 유지한다.
- **서버 배치:** EC2의 `~/runway/frontend/landing/`을 Nginx `/usr/share/nginx/landing`에 읽기 전용 디렉터리로 연결한다.
  응답은 `Cache-Control: no-cache`라 브라우저가 매번 ETag로 재검증하며, 파일 교체 후 Nginx 재시작 없이 반영된다.
- **상태 검사:** 루트가 랜딩으로 바뀌어 blackbox 검사는 `/backend-probe`를 사용한다. Nginx가 이 경로를 백엔드 루트로 전달해 기존과 같은 공개 404(`NOT_FOUND`)를 확인한다.
- **자동 갱신:** `runway-landing-cd`는 `master` Push에서 `frontend/landing/index.html`이 바뀐 경우에만 배포한다.
  EC2에서 파일을 교체한 뒤 공개 응답이 새 HTML과 같은지 확인하고, 실패하면 이전 파일을 복구한다.
- **Jenkins 연결:** Pipeline Job의 스크립트 경로는 `infra/jenkins/Jenkinsfile.landing-cd`다.
  작업 브랜치에서 `DEPLOY`를 끈 채 수동 실행해 검증한 뒤, SCM 브랜치와 GitLab Push 필터를 `master`로 지정하고 Job의 Webhook 토큰을 GitLab에 등록한다.
  운영 HTML이 준비된 뒤 `DEPLOY`를 켜서 수동 실행하면 `master`의 HTML을 즉시 반영할 수 있다.
- **최초 배치·수동 복구:** Jenkins 연결 전이나 수동 복구가 필요할 때는 `master` 체크아웃의 저장소 루트에서 아래를 실행한다. 임시 파일로 올린 뒤 같은 폴더 안에서 교체해 요청 중 불완전한 파일이 보이지 않게 한다.

```bash
scp -i <SSH 키> frontend/landing/index.html ubuntu@k15e105.p.ssafy.io:runway/frontend/landing/.index.html.new
ssh -i <SSH 키> ubuntu@k15e105.p.ssafy.io 'mv runway/frontend/landing/.index.html.new runway/frontend/landing/index.html'
sha256sum frontend/landing/index.html
curl -s https://k15e105.p.ssafy.io/ | sha256sum
```

두 해시가 같으면 반영된 것이다. 최초 적용 시에는 `mkdir -p ~/runway/frontend/landing`로 폴더를 만들고 파일을 올린 뒤,
`nginx -t` 확인 후 `docker compose -f ~/runway/infra/compose.yaml up -d nginx`로 볼륨을 연결한다.

### 랜딩 폰·워치 APK 갱신

master APK 작업은 팀용 debug APK를 기존 파일명으로 Jenkins에 먼저 보관한다. 공개용 release APK는 폰 `artifacts/runway.apk`, 워치 `artifacts/runway-watch.apk`로 추가 보관하며 랜딩에 복사하는 대상이다. 두 빌드 유형은 같은 팀 테스트 서명을 사용하고, 버전 코드는 각 작업의 Jenkins 빌드 번호를 사용한다.

EC2의 갱신 작업은 `runway-mobile-apk`와 `runway-watch-apk`의 마지막 성공 빌드를 확인한다. SHA-256이 일치한 APK만 각각 `/downloads/runway.apk`와 `/downloads/runway-watch.apk`에 반영한다. Jenkins 산출물 경로와 공개 다운로드 경로는 각각 인증·정적 파일 응답으로 제공한다.

APK 제공에 필요한 `nginx/default.conf`와 게시 서비스는 최초에 EC2에 직접 적용한다. 백엔드 CD는 API 경로 목록만 갱신하고, APK 작업은 Jenkins 보관까지만 한다.
EC2의 `~/runway`는 Git 체크아웃이 아닌 복사본이므로 아래 파일은 master 체크아웃에서 올려 적용한다.

최초 적용 시 master 체크아웃의 `infra/jenkins/publish-apks.py`·`runway-publish-apks.service`·`runway-publish-apks.timer`를 EC2의 임시 폴더(예: `~/.runway-apk-stage`)에 올리고 `~/runway`에서 아래를 실행한다. Jenkins 볼륨의 작업 이름과 경로가 다르면 서비스 설정의 읽기 경로도 함께 맞춘다.

```bash
ST=~/.runway-apk-stage
sudo install -d -m 0755 frontend/landing/downloads /usr/local/libexec
sudo install -m 0644 "$ST/publish-apks.py" /usr/local/libexec/runway-publish-apks.py
sudo install -m 0644 "$ST/runway-publish-apks.service" "$ST/runway-publish-apks.timer" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now runway-publish-apks.timer
sudo systemctl start runway-publish-apks.service
journalctl -u runway-publish-apks.service -n 5 --no-pager
```

운영 Nginx 설정은 서버에만 있는 설정이 사라지지 않도록 운영 파일과 master를 비교해 필요한 블록만 반영한다. `default.conf`는 단일 파일 bind mount이므로 `mv`로 교체하지 않고 백업 후 같은 파일에 덮어쓴다(`cat new > default.conf`). `docker exec runway-nginx-1 nginx -t`를 통과한 뒤 `nginx -s reload`하고, 실패하면 백업으로 되돌린다.

반영 후 아래로 확인한다. 두 APK는 200, `application/vnd.android.package-archive`, 각 파일명의 `attachment`여야 하며, 내려받은 SHA-256이 Jenkins 산출물의 `.sha256`과 같아야 한다.

```bash
curl -sI https://k15e105.p.ssafy.io/downloads/runway.apk
curl -s https://k15e105.p.ssafy.io/downloads/runway.apk | sha256sum
curl -sI https://k15e105.p.ssafy.io/downloads/runway-watch.apk
curl -s https://k15e105.p.ssafy.io/downloads/runway-watch.apk | sha256sum
```

폰과 워치의 APK를 각각 설치하고 기기 간 연결을 확인한다.

## 폰·워치 연결 검증

모바일·워치 debug APK는 같은 테스트 서명을 사용하며 서명 변경 시 통합 CI가 두 앱을 모두 검사한다.
Data Layer 실기기 검증에는 applicationId·서명 인증서가 모두 일치해야 한다.
APK 생성 성공과 실제 설치·연결 성공은 구분한다.

## Redis 연결

| 항목 | 구성 |
| --- | --- |
| 용도 | 로그인·Refresh Token 상태 저장 |
| 접속 | 백엔드 → `redis:6379`, 내부 네트워크 전용·외부 포트 미공개 |
| 데이터 유지 | AOF와 `runway_redis_auth_data` 볼륨 사용 |

인증·영속화·복구 기준은 [백엔드 Redis 안내](../backend/README.md#8-로그인과-redis)를 따른다.

## 이미지 저장

- `BACKEND_IMAGE_VOLUME_PATH=/data/images`로 지정하고 EC2의 `~/runway/data/images`를 연결한다. 컨테이너 교체 후에도 파일은 호스트 폴더에 남는다.
- Nginx의 백엔드 요청 경로는 전체 요청 크기를 `5m`로 제한한다. 백엔드도 전체 요청 5MB 제한을 사용하므로 multipart 부가 정보를 포함한 크기이며 파일만의 5MB 업로드를 보장하지 않는다.
- 저장 경로는 Nginx로 직접 공개하지 않는다. 이미지 조회 URL은 별도 작업이며 백업은 아래 기준을 따른다.

## 백업·복원

| 대상 | 주기·보관 | EC2 저장 위치 |
| --- | --- | --- |
| DB·업로드 이미지 | 매일 04:00 한국 시간, 성공본 7개 | `~/runway/backups/automatic/data/` |
| Jenkins 설정·플러그인 | 일요일 04:30 한국 시간, 암호화 성공본 4개 | `~/runway/backups/automatic/jenkins/` |

- Python 3.11 이상·GPG·Docker를 사용한다. `backup/`의 서버용 Python 파일은 `/usr/local/lib/runway-backup/`에,
  service/timer는 `/etc/systemd/system/`에 설치한다. `download_backups.py`는 PC용이다.
- root로 `prepare_key.py`를 최초 실행하고, 아래 복원 검증 후 `runway-data-backup.timer`·`runway-jenkins-backup.timer`를 활성화한다.
  암호화 키는 `/root/runway-backup-key`에 보관하며 기존 키를 덮어쓰지 않는다.
- ThinBackup 2.1.5: 경로 `/var/jenkins_home/runway-backup-staging`, 전체 일정 `30 19 * * 6`(현재 JVM은 UTC),
  CI 종료 대기·강제 Quiet mode `-1`·4개 보관. 플러그인·다음 빌드 번호를 포함하고 빌드 결과·APK·캐시는 제외한다.
- Jenkins 완료 백업은 5분마다 확인해 암호화한다. `master.key`는 `automatic/recovery/`에 분리하며 PC 보관 전 자동 삭제하지 않는다.
  백업 폴더는 실행 사용자만 접근하도록 권한 700을 유지한다.

**수동 백업·격리 복원 검사 — EC2에서 실행**

```bash
sudo systemctl start runway-data-backup.service
sudo systemctl start runway-jenkins-backup.service
sudo python3 /usr/local/lib/runway-backup/verify_restore.py --latest-dir /home/ubuntu/runway/backups/automatic/data --key-file /root/runway-backup-key
sudo python3 /usr/local/lib/runway-backup/verify_jenkins.py --key-file /root/runway-backup-key
```

복원 검사는 운영에 덮어쓰지 않고 임시 컨테이너에서 수행한다. 백업 당시 이미지가 로컬에 있어야 한다.
실패 시 기존 성공 백업은 유지되며 `systemctl status runway-{data,jenkins}-backup.service`로 결과를 확인한다.
DB 역할 비밀번호·앱 Secret은 별도 복구 대상이고, 실행 중 복사하는 DB·이미지는 동일 시점을 보장하지 않는다.

**PC 다운로드 — 저장소 루트에서 실행**

```powershell
python infra/backup/download_backups.py --identity "개인 SSH 키 파일 경로"
```

사용자 홈의 `RunWayBackups/`에 암호화 백업을, `RunWayRecovery/`에 복구 키를 분리해 보관하고 해시를 확인한다.
두 폴더는 Git·공유 채널에 올리지 않는다. 노트북이 꺼져 있어도 EC2 백업은 계속되며, 켠 뒤 같은 명령으로 내려받는다.

참고: [PostgreSQL 17](https://www.postgresql.org/docs/17/backup-dump.html) · [ThinBackup](https://plugins.jenkins.io/thinBackup/) ·
[Jenkins 백업 기준](https://www.jenkins.io/doc/book/system-administration/backing-up/) (2026-11-02 확인, GPG 2.4.4).

## 컨테이너 모니터링

EC2의 systemd 타이머가 Docker에서 컨테이너별 CPU·메모리와 Nginx·백엔드 로그를 읽는다. 지표는 Node Exporter가 읽는 `containers.prom`에 저장하고, 로그는 Nginx의 요청 방식·상태 코드와 백엔드의 경고 등급·로거 이름만 남긴다. Alloy는 가공된 로그 폴더만 읽어 Loki로 전달한다.

Compose 실행 전에 `collect-container-observability.py`를 `/usr/local/libexec/runway/`에, `runway-container-observability.{service,timer}`를 `/etc/systemd/system/`에 설치한다. `sudo systemctl daemon-reload` 후 `sudo systemctl start runway-container-observability.service`로 첫 수집을 확인하고 `sudo systemctl enable --now runway-container-observability.timer`로 예약한다. 새 서버에서는 `runway-monitoring_alloy_data` 볼륨의 데이터 디렉터리를 Alloy 실행 계정(UID/GID 473)이 쓸 수 있도록 준비한다.

API 경로 목록은 백엔드 통합 테스트가 실제 Spring MVC 등록 정보에서 `build/generated/monitoring/api-routes.json`으로 추출한다. CD는 이 파일로 Nginx 분류와 수집기 허용 목록을 함께 갱신하며, 배포 실패 시 이전 목록을 복구한다. 경로 문법을 지원하지 않으면 배포 전에 차단한다.

최초 적용 전 EC2에 `/var/lib/runway-monitoring/routes`를 준비하고, 검증한 목록으로 `route_catalog.py`의 `install` 동작을 실행해 초기 버전을 생성한다. Nginx에는 이 폴더만 `/etc/nginx/runway-routes`로 읽기 전용 연결한다. 이후 목록은 CD가 관리하며, 미등록 주소는 `unknown`으로 표시한다.
