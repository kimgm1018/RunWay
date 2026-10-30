# RunWay 인프라

단일 EC2에서 Docker Compose로 실행한다.
서버 배치 경로는 `/home/ubuntu/runway/infra`다.
**Git 변경만으로 서버 설정이 적용되지는 않는다.** 검증 후 변경한 설정만 서버에 반영한다.

## 파일 구성

| 경로 | 역할 |
| --- | --- |
| `compose.yaml`, `nginx/default.conf` | Nginx·HTTPS·백엔드/Jenkins 라우팅 |
| `jenkins/compose.yaml`, `jenkins/backend-agent/` | Jenkins 컨트롤러·Java 21 빌드 에이전트 |
| `jenkins/mobile-agent/` | Node·Java·Android 도구를 갖춘 모바일 빌드 에이전트 |
| `jenkins/watch-agent/` | Java 25·Android 도구를 갖춘 워치 빌드 에이전트 |
| `jenkins/Jenkinsfile.ci` | 변경 영역별 병렬 검사·GitLab 영역별 결과·Jenkins 세부 단계 표시 |
| `jenkins/Jenkinsfile.mobile-apk`, `jenkins/build-mobile-apk.sh` | master 테스트용 ARM64 APK 생성·보관과 공통 빌드 명령 |
| `jenkins/Jenkinsfile.watch-apk`, `jenkins/build-watch-apk.sh` | 제품 워치 앱 검사·APK 생성과 master 산출물 보관 |
| `jenkins/Jenkinsfile.mobile` | dev·master 대상 MR의 모바일 타입·린트·테스트 검사 |
| `jenkins/Jenkinsfile.backend` | dev·master 대상 MR의 임시 병합 검사·테스트·JAR 생성 |
| `jenkins/Jenkinsfile.backend-cd` | master 병합 후 검사·이미지 생성·자동 배포 |
| `db/compose.yaml` | PostgreSQL 17·PostGIS 3.6·영속 저장 |
| `redis/compose.yaml`, `redis/start-redis.sh` | Redis 실행·Secret 주입·영속 저장 |
| `backend/compose.yaml`, `backend/Dockerfile` | 백엔드 실행 설정·이미지 제작 |
| `backend/deploy.sh`, `backend/check.sh` | 배포 전후 기동 검사·실패 시 이전 이미지 복구 |
| `certbot/runway-cert-renew.*` | 인증서 갱신 스크립트·systemd service/timer |

## 실행 전 준비

- Docker·Compose, 도메인·HTTPS 인증서, 방화벽 22/80/443을 준비한다.
  DB는 외부에 공개하지 않으며 백엔드 18081·Jenkins 8080은 localhost에만 연결한다.
- 외부 볼륨 `runway_jenkins_home`, `runway_postgres_data`, `runway_redis_auth_data`와 Compose가 참조하는 네트워크를 준비한다.
  모바일은 `runway-ci_mobile_agent_work`, `runway-ci_mobile_android_sdk`, 워치는 `runway-ci_watch_agent_work`, `runway-ci_watch_android_sdk`도 `docker volume create <이름>`으로 준비한다. 기존 서버의 볼륨은 유지한다.
- DB 관리자·앱 비밀번호, Redis 비밀번호, JWT 키, Swagger 비밀번호 해시, Jenkins 에이전트 Secret을
  **Git 밖에서 준비**한다. 필요한 파일 경로는 각 Compose와 에이전트 스크립트를 확인한다.
  모바일·워치 접속 Secret은 `infra/jenkins/secrets/mobile-builder-secret`, `infra/jenkins/secrets/watch-builder-secret`에 각각 준비한다. 실행 UID 1000이 읽을 수 있게 권한 600을 사용한다.
- 백엔드 Secret 파일은 실행 UID 10001이 읽을 수 있어야 한다. 현재 기준은 디렉터리 700·파일 400이다.
  실제 비밀번호·키·해시·인증서 개인키·Jenkins 데이터는 커밋하지 않는다.
- Redis 설정 `backend/redis/redis.conf`·`entrypoint.sh`를 서버의 `~/runway/backend/redis/`에 배치한다.
  Redis Secret은 `~/runway/secrets/backend/redis-app-password`에 준비하며 위 백엔드 Secret 권한 기준을 따른다.
- 이미지 저장 폴더 `~/runway/data/images`를 UID/GID 10001·권한 700으로 준비한다.
  백엔드의 `/data/images`에 읽기·쓰기로 연결하며 실제 이미지 파일은 Git에서 제외한다.
- 삼성 Health SDK 1.1.0 AAR은 `~/runway/sdks/samsung-health/1.1.0/`에 준비한다.
  `/opt/samsung-health/`에 읽기 전용 연결하며 Gradle에 `-PsamsungHealthSdk=<AAR 경로>`로 전달한다.
- 새 DB에는 앱 역할 `runway_app`과 CONNECT·public 스키마 USAGE/CREATE 권한을 준비한다.
  앱 비밀번호 파일과 DB 역할의 실제 비밀번호를 일치시킨다.
- 백엔드 에이전트 이미지는 `docker build -t runway-backend-agent:java21 ~/runway/infra/jenkins/backend-agent`로 빌드한다.
  `group_add`는 호스트 Docker 소켓의 실제 GID와 맞춘다. 소켓 접근은 호스트 Docker 제어 권한이다.
- 모바일 이미지는 `docker build -t runway-mobile-agent:android ~/runway/infra/jenkins/mobile-agent`로 빌드한다.
  워치 이미지는 `docker build -t runway-watch-agent:android ~/runway/infra/jenkins/watch-agent`로 빌드한다.
  Android 공식 도구 다운로드·사용 전 약관을 확인하며 Dockerfile은 약관에 자동 동의하지 않는다.

## 적용 순서

1. DB와 Jenkins 컨트롤러를 준비하고 노드·Credentials·Job을 등록한 뒤 에이전트를 연결한다.
   모바일은 `docker compose -f ~/runway/infra/jenkins/compose.yaml up -d mobile-builder`로 시작한다.
   최초 SDK 약관 동의는 `docker compose -f ~/runway/infra/jenkins/compose.yaml exec mobile-builder runway-sdkmanager --licenses`로 수행한다.
   이후 같은 도구로 `platform-tools`, `platforms;android-36`, `build-tools;36.0.0`, `ndk;27.1.12297006`, `cmake;3.22.1`을 설치한다. 작업·SDK·Gradle 캐시는 볼륨으로 유지한다.
   워치는 `up -d watch-builder`로 시작하고 같은 방식으로 약관 확인 후 `platform-tools`, `platforms;android-37.0`, `build-tools;36.0.0`을 설치한다. SDK·작업·Gradle 캐시는 모바일과 분리한다.
2. `docker compose -f ~/runway/infra/redis/compose.yaml up -d --wait`로 Redis를 실행한다. `runway_redis` 내부 네트워크도 이때 생성된다.
3. Nginx·백엔드가 사용하는 `runway_service`, `runway-ci_default`, `runway-db_default` 네트워크를 준비한다.
   최초 인증서 발급은 HTTP 전용 설정으로 진행하고, 인증서·백엔드·Jenkins가 준비된 뒤 최종 HTTPS 설정을 적용한다.
4. 백엔드를 실행한다. **수동 Compose 실행에는 현재 이미지의 `BACKEND_IMAGE`를 명시**한다.
5. 변경한 Compose는 `docker compose -f <파일> config --quiet`, Nginx는 `nginx -t`로 검사한 뒤 적용한다.
6. 인증서 갱신 스크립트는 `/usr/local/sbin/`, service/timer는 `/etc/systemd/system/`에 설치하고 timer를 활성화한다. UTC 03시·15시에 최대 30분 지연하여 갱신 여부를 확인한다.

## Jenkins 설정

| 항목 | 기준                                                                                                                             |
| --- |--------------------------------------------------------------------------------------------------------------------------------|
| 접속 주소 | https://k15e105.p.ssafy.io/jenkins/                                                                                            |
| 빌드 노드 | `backend-builder`(라벨 `backend`)·`mobile-builder`(라벨 `mobile`), `watch-builder`(라벨 `watch`) 포함 각 executor 1 / Built-In Node executor 0                        |
| 모바일 도구 | Jenkins 접속 Java 21·앱 빌드 Java 17, Node 22·pnpm 11.28.9. 메모리 6GiB·CPU 2개 상한                                                      |
| 워치 도구 | Jenkins 접속 Java 21·Gradle Java 25, Gradle 9.6.0·AGP 9.4.1·SDK 37. 메모리 4GiB·CPU 1개 상한 |
| GitLab 연결 | `runway-gitlab`, 저장소 Credentials ID `runway-gitlab-repo`                                                                       |
| 백엔드 CI | `runway-backend-ci`, SCM `*/dev`, Script Path `infra/jenkins/Jenkinsfile.backend`                                              |
| 모바일 APK | `infra/jenkins/Jenkinsfile.mobile-apk` 준비 중. master Push 후 ARM64 디버그 APK를 생성하며 APK 보관 개수는 최근 빌드 5개를 기준으로 제한한다. 정식 출시용 서명·스토어 배포는 제외한다. |
| 통합 CI | `infra/jenkins/Jenkinsfile.ci`, backend/frontend/wear 변경 영역만 검사·빌드하고 공통 Jenkins 설정 변경·수동 실행은 세 영역 모두 검사한다. Job·Webhook 전환 전에는 기존 CI를 유지한다. |
| 워치 APK | `infra/jenkins/Jenkinsfile.watch-apk`. master Push 후 제품 `:app` 단위 테스트·Lint·debug APK 생성·보관. 실험용 `:demo`·기기 연결 테스트는 별도 |
| 기존 모바일 CI | `infra/jenkins/Jenkinsfile.mobile`은 단독 검사 초안이다. 신규 연결은 통합 CI를 사용한다. |
| CD | `runway-backend-cd`, SCM `*/dev`, Script Path `infra/jenkins/Jenkinsfile.backend-cd`                                           |
| 트리거 | CI는 dev·master 대상 MR 갱신, CD는 master Push만 사용                                                                                   |
| 권한 | 관리자와 조회 권한 분리. 익명 접근·자가 가입 제외                                                                                                  |

모바일은 MR·master 모두 팀 테스트용 ARM64 APK를 빌드하며 x86 에뮬레이터·32비트 기기는 대상에서 제외한다. Gradle 작업 결과 캐시는 전용 볼륨에 유지한다.
모바일 APK 빌드 소요 시간은 콘솔과 `build-time.txt`, 작업별 시간은 보관된 Gradle profile 보고서에서 확인한다.
모바일·제품 워치 debug APK는 모바일의 기존 테스트 서명 파일을 공유한다. 서명 파일 변경 시 통합 CI는 두 앱을 모두 검사한다.
워치도 검사·빌드 시간과 JUnit·Lint 보고서를 보관한다. 폰과 워치의 Data Layer 실기기 검증에는 applicationId와 서명 인증서가 모두 일치해야 한다. 설치·연결 검증은 APK 생성 성공과 구분한다.

Webhook 경로는 `/jenkins/project/<작업명>`이며 Job별 Secret token을 별도 등록한다.
Jenkins 계정·Credentials·Job 설정은 영속 볼륨에서 관리하며 이 저장소가 자동 생성하지 않는다.


Secret 관리 기준은 [공통 규칙](../docs/development/secret-environment-variables.md)을 따른다.

백엔드의 `BACKEND_AUTH_TRUSTED_PROXIES`는 Nginx·백엔드만 연결된 EC2 `runway_service`의 내부 대역(`172.18.0.0/16`)을 사용한다. 컨테이너 재생성으로 IP가 바뀌어도 같은 대역 안에서는 유지되며, 네트워크 자체를 새로 만들면 실제 subnet과 설정을 다시 맞춘다. 일반 사용자·전체 인터넷 대역을 신뢰하지 않으며 백엔드 직접 외부 접근은 차단한다.

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
- 저장 경로는 Nginx로 직접 공개하지 않는다. 이미지 조회 URL과 자동 백업은 별도 작업이다.
