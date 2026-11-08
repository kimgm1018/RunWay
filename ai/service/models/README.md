# 모델 파일

모델 weight와 평균 묶음은 Git에 넣지 않고 배포 때 Hugging Face에서 받는다. 네 파일은 비공개 저장소 `AnSeongYun/runway-hr-models`의 고정 revision `e44028f7a5cebbed1070094f8e2a081a03c1f523`에서 내려받는다.

| 역할 | Hugging Face 경로 | 설치 경로 | SHA-256 |
| --- | --- | --- | --- |
| AI03·AI04 HR 예측 GRU | `gru/gru_final.pt` | `ai/service/models/gru_final.pt` | `db59d414b8b88a6ac1140dd5bbce40475878d97a6436fb087141e25bdb3887fe` |
| AI04·AI05·AI06 ODE | `ode_v21_speedcal_b_lam1/selected_model.pt` → `ode_epoch_020.pt` | `ai/service/models/ode/ode_epoch_020.pt` | `737334a7d77a8481f0f22029cf24dd20310f6620766c65ca7f452083450dee3b` |
| ODE 정규화 통계 | `ode_v21_speedcal_b_lam1/summary_stats.json` → `ode_summary_stats.json` | `ai/service/models/ode/ode_summary_stats.json` | `9251e04e3dc50ecb66cbd48faa7c6882b80f16a51af0746669cd5f0545b4e066` |
| 신규 사용자 평균 계획 묶음 | `ode_v21_speedcal_b_lam1/population_bundle_v2train_median.json` | `ai/service/models/ode/population_bundle_v2train_median.json` | `bb15684840fbf39a35827c26d8d8c67e4d3b10ffaa3ff1b5d8b36c7ab606dcb6` |

`scripts/fetch_models.sh`(Linux) 또는 `scripts/fetch_models.ps1`(Windows)을 실행한다. 기본 HF 모드는 `HF_TOKEN`에 저장소 읽기 권한이 필요하다. 토큰은 환경변수나 Jenkins credential로 주입하고 명령줄 인자·파일·로그에 넣지 않는다. `RUNWAY_MODEL_HF_REPO`와 `RUNWAY_MODEL_HF_REVISION`으로 저장소와 revision을 바꿀 수 있으며, SHA 환경변수 기본값은 위 표의 값을 사용한다.

기존 로컬 복사 배포는 `ODEV21_SOURCE_MODE=local`로 선택한다. 이때 ODE checkpoint·통계·평균 묶음 경로를 각각 `ODEV21_SOURCE_CHECKPOINT`, `ODEV21_SOURCE_STATS`, `ODEV21_POPULATION_BUNDLE_SOURCE`로 지정한다. GRU는 예전 공개 주소에서 받고, `GRU_MODEL_URL`을 지정하면 그 주소를 사용한다. 직접 지정한 URL에는 Bearer 토큰을 보내지 않는다.

다운로더는 임시 파일의 SHA-256을 검사한 뒤 같은 디렉터리의 설치 경로로 이동한다. 현재 서비스는 평균 묶음 파일 자체와 `ODEV21_POPULATION_BUNDLE_SHA256` 값을 비교하며, 별도 `.sha256` 파일은 읽지 않는다. 실행 시 경로는 `infra/ai/compose.yaml`과 `infra/ai/.env.example`의 `/models/gru_final.pt`, `/models/ode/` 구성을 따른다. `ODEV21_CHECKPOINT_PATH`와 `ODEV21_SUMMARY_STATS_PATH`는 서비스가 읽는 경로를 별도로 바꾼다.

ODE checkpoint는 S15P31E105-402/406에서 base epoch 20을 속도 반응 손실(λ=1)로 V2 Train 전체 미세조정한 것이다(HF 폴더 `ODEV21_HF_DIR`, 이전 base는 `ode_v21_stage1_base`). 구조는 base와 같아 epoch 20 형식이며 summary feature 27개와 HR0 head가 없다. 이때 서비스는 Support 러닝 시작 HR 중앙값을 초기값으로 쓰며, Support가 없으면 85 bpm을 쓴다. 상세 ODE 출처와 코드 checksum은 [`SOURCES.json`](../app/models/ode/SOURCES.json)에 기록한다.

정책 표 [`../app/policy/data/margin_gru.json`](../app/policy/data/margin_gru.json)은 학습 checkpoint가 아니라 Git에 포함되는 prototype policy v0.3 기본 설정이다. GRU predictor 코드는 `ai/workspace/doyeon/gru/src/`에서 서비스 이미지에 복사하며 중복 vendoring하지 않는다.
