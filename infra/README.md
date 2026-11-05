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
| `jenkins/ai-agent/`, `jenkins/check-ai.sh` | AI 전용 에이전트·Python 테스트·이미지 빌드 검사 |
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
| `ai/Dockerfile`, `ai/compose.yaml` | FastAPI·GRU/ODE CPU 추론 이미지·내부 네트워크 실행 |
| `ai/deploy.sh`, `ai/check.sh`, `jenkins/Jenkinsfile.ai-cd` | AI 이미지·모델 교체, 상태 확인·복구와 master 배포 흐름 |
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
  `AI_DB_URL_FILE`로 파일 경로만 전달한다. 계정은 CONNECT·USAGE·courses SELECT만 먼저 받고,
  배포 시 `grant-readonly.sh`가 먼저 running_sessions SELECT(AI09 속도 보정 v_ref, 기다리지 않음)를 주고, V10 완료 후 user_hr_personalization SELECT를 추가한다. user_gru_personalization과 미래 테이블 전체 권한은 제외한다.
  변수·기능 기본값은 [예시](ai/.env.example), API·모델 계약은 [AI 서비스 안내](../ai/service/README.md)를 따른다.

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
4. 백엔드를 실행한다. **수동 Compose 실행에는 현재 이미지의 `BACKEND_IMAGE`를 명시**한다.
5. AI를 실행할 때는 준비한 변수를 환경변수 또는 `--env-file <설정 파일>`로 전달하고
   `docker compose -f ~/runway/infra/ai/compose.yaml up -d --wait`를 실행한다.
   GRU·ODE 모델 로드까지 완료되어야 정상으로 판단한다. CPU 1개·메모리 1GiB 제한에서 실제 사용량을 확인한다.
   외부 포트 없이 `runway-ai_default`와 DB 내부 네트워크에 연결하며, 백엔드 호출 연결은 후속 적용한다.
6. 인증서 갱신 스크립트는 `/usr/local/sbin/`, service/timer는 `/etc/systemd/system/`에 설치하고 timer를 활성화한다. UTC 03시·15시에 최대 30분 지연하여 갱신 여부를 확인한다.

## Jenkins 설정

| 항목 | 기준 |
| --- | --- |
| 접속 주소 | https://k15e105.p.ssafy.io/jenkins/ |
| 빌드 노드 | `backend-builder`(`backend`)·`mobile-builder`(`mobile`)·`watch-builder`(`watch`)·`ai-builder`(`ai`), 각 executor 1 / Built-In Node executor 0 |
| 에이전트 접속 | 작업 경로 `/home/jenkins/agent`, 컨트롤러에 접속하는 방식·라벨이 일치하는 작업만 실행 |
| 모바일 도구 | Jenkins 접속 Java 21·앱 빌드 Java 17, Node 22·pnpm 11.28.9. 메모리 6GiB·CPU 2개 상한 |
| 워치 도구 | Jenkins 접속 Java 21·Gradle Java 25, Gradle 9.6.0·AGP 9.4.1·SDK 37. 메모리 4GiB·CPU 1개 상한 |
| AI 도구 | Java 21·Docker CLI 에이전트에서 Python 3.12·CPU PyTorch 검사 컨테이너 실행. 에이전트 512MiB·CPU 1개, 검사 컨테이너 1GiB·CPU 1개 상한 |
| GitLab 연결 | `runway-gitlab`, 저장소 Credentials ID `runway-gitlab-repo` |
| 통합 MR CI | `runway-ci`, SCM `*/dev`, `infra/jenkins/Jenkinsfile.ci`. dev·master 대상 MR의 변경 영역만 검사하며 공통 Jenkins 설정 변경·수동 실행은 네 영역 모두 검사. 모바일 테스트 파일만 바뀐 MR은 타입·린트·전체 Jest를 유지하고 APK만 생략 |
| 모바일 APK | `runway-mobile-apk`, `infra/jenkins/Jenkinsfile.mobile-apk`. master Push 후 ARM64 디버그 APK 생성·보관, 산출물은 최근 5개 빌드 기준으로 제한. 정식 출시 서명·스토어 배포 제외 |
| 워치 APK | `runway-watch-apk`, `infra/jenkins/Jenkinsfile.watch-apk`. master Push 후 제품 `:app` 단위 테스트·Lint·debug APK 생성·보관. 실험용 `:demo`·기기 연결 테스트는 별도 |
| 백엔드 CD | `runway-backend-cd`, SCM `*/dev`, `infra/jenkins/Jenkinsfile.backend-cd`. master Push 배포 |
| AI CD | `infra/jenkins/Jenkinsfile.ai-cd`. master 전용. `AI_MODELS_ROOT`·`AI_DB_URL_FILE`을 지정한다. 모델 준비 → V10/읽기 권한 → 사전 로드 → 교체/검사 순서이며, 실패 시 이전 이미지·모델·공개 설정을 복구. `DEPLOY=false`, `PREPARE_MODELS=true`는 운영 교체 없이 모델만 준비 |
| 기존 단독 CI | `Jenkinsfile.backend`·`Jenkinsfile.mobile`은 기존 단독 검사 파일이며 신규 MR 검사는 통합 CI 사용 |
| 권한 | 관리자와 조회 권한 분리. 익명 접근·자가 가입 제외 |

### 빌드·검증 결과

| 영역 | 검사·보관 기준 |
| --- | --- |
| 백엔드 | 배포 전후·복구 후 이미지 ID, 내부 readiness `200/UP`와 업무 HTTP 응답 검사. 상태 API는 루프백 8082에만 제공 |
| 모바일 | 앱·의존성·설정 변경 MR, 공통 CI 변경·수동 검사와 master에서 ARM64 APK 빌드. `frontend/`의 `__tests__/` 아래 `.test.*`·`.spec.*` JS/TS 파일만 바뀐 MR은 APK 생략. x86 에뮬레이터·32비트 기기 제외, Gradle 캐시는 전용 볼륨 유지. 소요 시간은 콘솔·`build-time.txt`·Gradle profile 보고서에서 확인 |
| 워치 | 검사·빌드 시간과 JUnit·Lint·Gradle profile 보고서 보관 |
| AI | MR CI는 모델 없는 API·배포 회귀 테스트를 수행하고 실제 모델 테스트 생략 여부를 JUnit에 기록. 실제 모델 로드·예측은 별도로 검증 |

모바일 CI의 Jest 변환 캐시는 `/home/jenkins/agent/.cache/jest`에 둔다. 기존 `mobile_agent_work` 영속 볼륨에 포함되며,
체크아웃 작업 폴더 삭제 후에도 유지된다. 캐시를 사용해도 타입·린트·전체 Jest는 매번 실행한다.
알 수 없는 프론트엔드 경로·fixture·Jest 설정 변경은 APK도 빌드하며, master APK 작업은 항상 APK를 생성한다.

AI 배포는 `.env` 자동 로딩을 사용하지 않는다. Jenkins가 전달한 값과 검증된 모델 설정만 사용하며,
HF 토큰은 다운로드 단계에만 주입한다. DB Secret은 컨테이너 시작 시 파일에서 읽고 복구 기록에 저장하지 않는다.
GRU 개인화·ODE preview/forecast는 기본 OFF다. AI09를 검증할 때는 `PERSONAL_PLAN_EXPERIMENTAL_ENABLED=true`와 유효한 코스를 준비한다.
`bash infra/ai/verify-isolated.sh <실행 이미지> <공개 모델 설정 파일> <PostGIS 이미지>`는 합성 코스 DB·기동 API·실패 롤백을 별도 환경에서 검증하고 정리한다.
짧은 요청의 메모리 측정은 장거리·동시 부하 성능 보장과 구분한다.

모바일·워치 debug APK는 같은 테스트 서명을 사용하며 서명 변경 시 두 앱을 모두 검사한다.
Data Layer 실기기 검증에는 applicationId·서명 인증서가 모두 일치해야 한다. APK 생성 성공과 설치·연결 성공은 구분한다.

### 백엔드 배포 상태 검사

최초 readiness 전환 때만 Jenkins 백엔드 노드/작업의 `BACKEND_LEGACY_HEALTH_IMAGE_ID`에 기존 컨테이너의 정확한
`sha256:...` 이미지 ID를 지정할 수 있다. 이 이미지의 배포 전·복구 검사에만 기존 시작 로그·404 확인을 허용한다.
새 배포는 항상 readiness를 검사하며, 첫 성공 후 이 설정을 제거한다. 미설정·ID 불일치 시 기존 검사로 우회하지 않는다.
검사 이미지 `python:3.12-alpine`은 기존 서비스를 교체하기 전에 준비한다. 이미지 롤백은 DB 마이그레이션을 되돌리지 않는다.

### GitLab 연결·인증

- Webhook 경로는 `/jenkins/project/<작업명>`이며 Job별 Secret token을 별도 등록한다.
- Jenkins 계정·Credentials·Job 설정은 영속 볼륨에서 관리하며 이 저장소가 자동 생성하지 않는다.

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
