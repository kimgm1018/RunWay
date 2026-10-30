# 백엔드 역할 분배

백엔드 3인의 담당 도메인과 도메인 간 경계를 정의한다. API 범위는
[API 명세](../design/api/README.md), 업무 범위와 완료 조건은 아래 연결한 Jira를 기준으로 한다.

> 합의일: 2026-10-30 · 관련 업무: [S15P31E105-283][283]
>
> 확인 근거: 283번 작업 대화에서 사용자가 제공한 분담표와 기존 Jira 담당 업무를 대조하고,
> API 분류에 따른 패키지 구성, 공통 기반 담당, 자동 코스 반영의 담당·연계 범위를 사용자와 확정했다.
> 완료된 업무와 앞으로 수행할 업무를 합친 역할이며, 담당 배정이 개별 API의 구현·배포 완료나
> 미정 정책의 확정을 뜻하지 않는다.

## 분배 원칙

- **도메인 수직 분할**: 담당자는 해당 기능의 Controller·Service·Repository·DTO와 관련 테스트를
  함께 맡는다. 계층별로 사람을 나누지 않으며, 계층 책임은 [백엔드 컨벤션](backend-convention.md)을 따른다.
- **API 분류와 패키지 연결**: API 명세의 도메인 구분을 패키지 기준으로 사용한다.
  기존 패키지 이름은 유지하고, 같은 패키지 안에서도 API별 담당이 다르면 아래 경계를 따른다.
- **공통 기반 재사용**: 공통 인증·오류 처리·DB 기반을 재사용한다. 공통 담당은 유지관리와
  변경 영향 확인을 맡으며, 모든 기능의 수정을 대신하거나 필수 승인자가 된다는 의미는 아니다.
- **공통 계약 변경**: API·DTO·오류 코드·DB 구조·연동 메시지 변경은 영향을 받는 담당자와
  범위를 확인하고 기존 기준 문서에 반영한다. Jira 업무별 worktree·브랜치와 리뷰·검증 절차는
  [공통 작업 규칙](../../AGENTS.md), [백엔드 작업 지침](../../backend/AGENTS.md)을 따른다.

## 담당

| 담당 | 이름 | 도메인 | 도메인 패키지 | 1차 MVP 범위 | Epic |
| --- | --- | --- | --- | --- | --- |
| BE-A | 김서현 | 인증·회원·계정·설정·동의 | `auth`, `user`, `device`의 동의 기능 | U01~U25, W04·W05 | [156][156] |
| BE-B | 강현 | 기기·데이터 연동·준비도·개인 러닝 제어·코칭 전달 | `device`의 기기·동기화 기능, `readiness`, `running`, `coaching` | W01~W03·W06·W07, R02, S01~S10, P07 | [156][156], 제어·코칭 연동은 [242][242] |
| BE-C | 김강민 | 코스·기록·통계·그룹런·크루·커뮤니티·이미지 | `course`, `runningrecord`, `grouprun`, `crew`, `community`, `image` | C01·C03·C07~C09, H01~H03·H06·H07, G01~G07·G09·G10·G12~G14·G16, M01~M11, CMT01~CMT13, F01 | [156][156] |

백엔드 기능은 사람별 Epic이 아니라 공통 [백엔드 기능 개발 Epic][156]에서 관리한다.
상세 설계는 [92번][92], 개발 절차·컨벤션은 [94번][94]을 참조한다.
워치 제어·코칭의 256·257번은 필요한 서버·폰 중계를 포함하여 [242번][242]에서 관리한다.

패키지는 `com.runway.backend.domain` 아래에 둔다. 내부 계층과 공통 코드 배치는
[백엔드 컨벤션 3장](backend-convention.md#3-패키지-구조)을 따른다.

- 기준 dev `6a80d2b`에 존재하는 패키지: `auth`, `user`, `device`, `course`,
  `runningrecord`, `grouprun`, `crew`, `community`, `image`.
- 신규 기능을 구현할 때 사용할 패키지: `readiness`, `running`, `coaching`.
  빈 패키지를 미리 생성하거나 이 문서만으로 기존 코드를 이동하지 않는다.
- `device`는 W01~W07의 기기·건강 데이터 영역이다. W04·W05의 동의 저장·철회·조회는
  BE-A, 나머지 기기 관리·W06 건강 데이터·W07 운동 배치 수신·저장은 BE-B가 맡는다.
- `running`은 세션 상태·제어·종료·삭제와 S10 SSE, `coaching`은 코칭 공급·유효성 판단과
  P07 BPM 연계를 맡는다. 명령 승인·실행 결과는 세션의 공통 제어 계약을 재사용한다.
- 담당 API에는 그 기능에 필요한 내부 자동 처리도 포함한다. 준비도 평가 연계, 종료 후 분석,
  그룹 집계, 코스 자동 반영을 공개 API 개수만으로 누락하지 않는다. M09는 명세의 선택 기능이다.

### 담당별 관련 업무

2026-10-30 Jira 조회 기준이다. 이후 상태와 상세 완료 조건은 각 Jira에서 확인한다.

| 담당 | 완료된 주요 업무 | 진행 중·예정 업무와 연계 |
| --- | --- | --- |
| BE-A | 인증 정책·공통 인증·로그인·실패 제한 [190][190]·[191][191]·[192][192]·[193][193], 가입 [222][222], 러닝 초기 설정 [223][223] | 갱신·로그아웃 [194][194], 프로필 [244][244], 환경·선호 [245][245], 공개 설정 [246][246], 앱 설정 [247][247], 탈퇴 [248][248], 러너·팔로우 [249][249], 건강정보 동의 [250][250] |
| BE-B | 기기 관리 [251][251], DB 무결성 [170][170], 온라인 연동 계약 [173][173], 통합 설계 [175][175] | 건강 동기화 [252][252], 배치 저장 [253][253], 준비도 [254][254], 세션 기본 관리 [255][255], 개인 제어 [256][256], SSE·BPM·더미 코칭 [257][257], 게시물 생성 경합 보완 [280][280] |
| BE-C | 크루 [183][183]·[184][184]·[185][185]·[231][231], 게시물·댓글·검색 [195][195]·[196][196]·[198][198], 코스 상세·북마크 [215][215], 이미지 [217][217], 기록·통계 [258][258]·[259][259], 그룹 모집·대기방 [260][260] | 커뮤니티 반응 [197][197], 코스 추천 [216][216], 그룹 진행·종료·결과 [261][261], 러닝 경로 자동 코스 반영(담당 합의 완료·구현 Jira 미연결) |

### 공통 기반 담당

| 공통 기반 | 담당 | 변경 책임과 기존 업무 |
| --- | --- | --- |
| 프로젝트·빌드·검증 기준 | BE-A | 초기 구성·컨벤션 [96][96], 계획·리뷰 절차 [91][91], 서식 검사 정리 [227][227]. 빌드·테스트 설정과 실행 안내의 정합성 관리 |
| 공통 인증·보안 | BE-A | [190][190]~[194][194]. `global.auth`·`global.security`의 사용자 식별·보안 처리와 `auth`의 인증 유스케이스 |
| 공통 오류 체계 | BE-A | BE-C가 만든 공통 예외·입력 검증 [172][172]를 기반으로 [275][275]에서 통일. 공개 오류 정의·응답은 `global.exception`, 오류 발생 조건은 각 도메인이 관리 |
| DB 기준 스키마·무결성 | BE-B | ERD·스키마 보완 [93][93]·[109][109]·[170][170], 연동 데이터 모델 [173][173]. 기능 담당과 기준 SQL·ERD·마이그레이션 정합성 확인 |
| 워치·폰·서버 연동 계약 | BE-B | [173][173]·[175][175]. 기기·배치·제어·ACK·상태 전달 계약과 구현 구간 간 정합성 관리 |
| 공간 데이터 공통 유틸 | BE-C | [214][214]. `global.geo`의 PostGIS·GeoJSON 변환과 공통 공간 처리 |

초기 Flyway 적용은 BE-A의 [174번][174] 수행 이력이다. 이후 마이그레이션은 각 기능 담당자가
작성하고 BE-B 및 관련 담당자와 번호·스키마를 조율한다. 적용된 이력 보존과 후속 버전 추가는
[DB 스키마 규칙](db-schema-convention.md#7-flyway-변경-적용과-복구)을 따른다.

실행 변수·CI·배포 설정의 기능별 요구는 해당 백엔드 담당이 설명하고 인프라 담당과 연결한다.
운영 Secret 주입·배포·백업·복구는 인프라 [138번][138]·[162번][162]의 범위이며,
공통 기반 담당 배정만으로 운영 변경 권한을 부여하지 않는다.

## 선행 작업과 착수 순서

다음은 전체 개발을 다시 시작하는 순서가 아니라 남은 기능의 선행 관계다.
완료된 기반은 재사용하고, 각 업무의 최신 계약과 실제 연동 상태를 확인한다.

1. **BE-A**: 공통 인증 [191][191]·가입 [222][222]·초기 설정 [223][223]을 기반으로
   갱신·로그아웃 [194][194], 동의 [250][250], 계정 기능을 연결한다.
   탈퇴 [248][248]는 토큰 처리·크루 이양/해산 [231][231]·기기 해제 [251][251]와 맞춘다.
2. **BE-B**: 기기 등록 [251][251]과 동의 계약을 기반으로 W06 [252][252]·W07 [253][253]을
   연결한다. 준비도 [254][254]는 건강 데이터와 AI 측 산식·인터페이스를 확인한다.
   세션 [255][255], 개인 제어 [256][256], SSE·BPM [257][257]은 [173번][173]의
   공통 상태·명령 계약을 사용하며 마지막 배치 저장 확인과 종료 확정을 연결한다.
3. **BE-C**: 기록·통계 [258][258]·[259][259]는 W07 저장과 개인 종료 확정을,
   그룹 진행 [261][261]은 모집·대기방 [260][260]과 BE-B의 개인 세션 제어를 연결한다.
   코스 추천 [216][216]은 공간 유틸 [214][214]·기존 코스 [215][215]를 재사용하고,
   자동 코스 반영은 종료 후 경로를 넘겨받는 지점을 BE-B와 연결한다.

## 도메인 간 경계 규칙

- **인증과 자원 권한**: BE-A가 공통 인증과 검증된 사용자 식별을 제공한다.
  각 도메인은 본인 소유권·역할·공개 범위·동의 등 업무 권한 검사와 테스트를 맡는다.
- **동의와 데이터 저장**: BE-A가 W04·W05를, BE-B가 W06·W07·코칭 경로를 맡는다.
  철회와 저장·새 코칭 발행의 경합은 [동의 업무][250]와 기존 명세의 검사·잠금 기준을 함께 따른다.
  동의 철회를 기존 기록 자동 삭제나 실제 운동 종료로 해석하지 않는다.
- **원본과 기록·분석**: BE-B는 `device`에서 W07의 배치 저장·ACK를,
  `running`에서 마지막 배치 확인·개인 종료 확정을 맡는다.
  BE-C는 `runningrecord`에서 종료 후 분석 결과 저장·조회·통계를 맡는다.
  원본 저장 성공·운동 종료·분석 완료는 서로 다른 상태이며 조회가 분석 실행을 대신하지 않는다.
- **그룹과 개인 세션**: BE-C는 그룹 모집·준비·그룹 시작/전체 종료·순위·결과를 맡고,
  BE-B는 참가자의 개인 세션·실행기기 제어·실제 결과 저장을 맡는다.
  [그룹 업무][261]와 [세션 명세](../design/api/sessions.md)의 상태·종료 기준을 공유한다.
- **SSE와 코칭**: BE-B가 `running`의 S10으로 세션·코칭·그룹 종료·분석 상태를 전달한다.
  BE-C는 그룹·분석 상태를 제공하고 전달 로직을 중복 구현하지 않는다.
  [257번][257]은 서버 더미 코칭→폰 중계→워치 표시와 수동 BPM 적용까지이며,
  실제 AI 추론·학습·개인화 품질 검증 완료를 뜻하지 않는다.
- **계정 공개와 소셜 조회**: BE-A가 공개 설정·팔로우를 관리하고 BE-C가
  크루·커뮤니티·통합 검색에서 확정된 공개 정책을 적용한다. 개인 원본 기록은 계정 공개와 구분한다.
- **회원탈퇴**: BE-A가 탈퇴 유스케이스를 맡고 BE-B의 기기 해제·BE-C의 크루 처리와 연결한다.
  기존 도메인 로직을 재사용하며, 데이터 보존·익명화·진행 중 운동의 처리 등 [248번][248]의
  미정 정책과 도메인 간 원자성은 해당 구현 전에 확인한다.
- **세션 삭제와 게시물**: BE-B의 S09와 BE-C의 기록·통계·게시물은 같은 삭제 기준을 따른다.
  [280번][280]은 BE-B가 `community`의 게시물 생성 경합을 보완하는 개별 배정이다.
  이 예외가 커뮤니티 전체의 담당 변경을 뜻하지 않는다.
- **자동 코스 반영**: BE-C가 `course`에서 러닝 경로의 공용 코스 반영을 맡고,
  BE-B가 종료·저장 확정 시점을 연결한다. [코스 명세](../design/api/courses.md)의 자동 반영과
  C07~C09 개인 북마크는 별개다. [216번][216]은 자동 반영을 제외하므로 별도 구현 업무 연결이 필요하다.
  유사 경로 중복·유효성·개인정보 처리 기준은 해당 업무에서 결정한다.
- **모바일·워치·AI·인프라**: 각 API 담당은 프론트엔드에 요청·응답·오류·상태를 인계한다.
  워치 측정·실행과 폰의 보관·중계는 [통합 설계](../design/watch-mobile-server-integration.md)를 따른다.
  BE-B의 [256][256]·[257][257]은 명시된 워치·폰·서버 연동을 포함한다.
  AI 모델·산식·학습은 AI 영역이며 BE-B는 준비도·코칭 호출/저장/전달,
  BE-C는 코스 추천의 서버 측 연계를 맡는다. AI 계약의 미정 부분을 임의 확정하지 않는다.
  운영 배포는 인프라 담당과 연결한다.

## 역할 변경과 갱신

담당·API 범위·패키지·공통 기반 책임이 바뀌면 관련 Jira와 영향받는 담당 범위를 확인하고
이 문서의 표와 경계를 함께 갱신한다. 합의 일자·확인 근거·관련 Jira를 남기고,
API 명세·ERD·컨벤션·공통/백엔드 작업 지침과의 충돌을 확인한다.
개별 구현의 진행 상태는 Jira에서 관리하며, 이 문서의 담당 배정만으로 완료 처리하지 않는다.

미정 정책은 해당 기준 문서와 Jira에서 결정 필요 사항으로 유지한다.
리뷰 편성과 승인·검증 절차는 기존 작업 지침을 따르며 이 문서로 새 필수 절차를 추가하지 않는다.


[283]: https://ssafy.atlassian.net/browse/S15P31E105-283
[156]: https://ssafy.atlassian.net/browse/S15P31E105-156
[242]: https://ssafy.atlassian.net/browse/S15P31E105-242
[92]: https://ssafy.atlassian.net/browse/S15P31E105-92
[94]: https://ssafy.atlassian.net/browse/S15P31E105-94
[190]: https://ssafy.atlassian.net/browse/S15P31E105-190
[191]: https://ssafy.atlassian.net/browse/S15P31E105-191
[192]: https://ssafy.atlassian.net/browse/S15P31E105-192
[193]: https://ssafy.atlassian.net/browse/S15P31E105-193
[222]: https://ssafy.atlassian.net/browse/S15P31E105-222
[223]: https://ssafy.atlassian.net/browse/S15P31E105-223
[194]: https://ssafy.atlassian.net/browse/S15P31E105-194
[244]: https://ssafy.atlassian.net/browse/S15P31E105-244
[245]: https://ssafy.atlassian.net/browse/S15P31E105-245
[246]: https://ssafy.atlassian.net/browse/S15P31E105-246
[247]: https://ssafy.atlassian.net/browse/S15P31E105-247
[248]: https://ssafy.atlassian.net/browse/S15P31E105-248
[249]: https://ssafy.atlassian.net/browse/S15P31E105-249
[250]: https://ssafy.atlassian.net/browse/S15P31E105-250
[251]: https://ssafy.atlassian.net/browse/S15P31E105-251
[170]: https://ssafy.atlassian.net/browse/S15P31E105-170
[173]: https://ssafy.atlassian.net/browse/S15P31E105-173
[175]: https://ssafy.atlassian.net/browse/S15P31E105-175
[252]: https://ssafy.atlassian.net/browse/S15P31E105-252
[253]: https://ssafy.atlassian.net/browse/S15P31E105-253
[254]: https://ssafy.atlassian.net/browse/S15P31E105-254
[255]: https://ssafy.atlassian.net/browse/S15P31E105-255
[256]: https://ssafy.atlassian.net/browse/S15P31E105-256
[257]: https://ssafy.atlassian.net/browse/S15P31E105-257
[280]: https://ssafy.atlassian.net/browse/S15P31E105-280
[183]: https://ssafy.atlassian.net/browse/S15P31E105-183
[184]: https://ssafy.atlassian.net/browse/S15P31E105-184
[185]: https://ssafy.atlassian.net/browse/S15P31E105-185
[231]: https://ssafy.atlassian.net/browse/S15P31E105-231
[195]: https://ssafy.atlassian.net/browse/S15P31E105-195
[196]: https://ssafy.atlassian.net/browse/S15P31E105-196
[198]: https://ssafy.atlassian.net/browse/S15P31E105-198
[215]: https://ssafy.atlassian.net/browse/S15P31E105-215
[217]: https://ssafy.atlassian.net/browse/S15P31E105-217
[258]: https://ssafy.atlassian.net/browse/S15P31E105-258
[259]: https://ssafy.atlassian.net/browse/S15P31E105-259
[260]: https://ssafy.atlassian.net/browse/S15P31E105-260
[197]: https://ssafy.atlassian.net/browse/S15P31E105-197
[216]: https://ssafy.atlassian.net/browse/S15P31E105-216
[261]: https://ssafy.atlassian.net/browse/S15P31E105-261
[96]: https://ssafy.atlassian.net/browse/S15P31E105-96
[91]: https://ssafy.atlassian.net/browse/S15P31E105-91
[227]: https://ssafy.atlassian.net/browse/S15P31E105-227
[172]: https://ssafy.atlassian.net/browse/S15P31E105-172
[275]: https://ssafy.atlassian.net/browse/S15P31E105-275
[93]: https://ssafy.atlassian.net/browse/S15P31E105-93
[109]: https://ssafy.atlassian.net/browse/S15P31E105-109
[214]: https://ssafy.atlassian.net/browse/S15P31E105-214
[174]: https://ssafy.atlassian.net/browse/S15P31E105-174
[138]: https://ssafy.atlassian.net/browse/S15P31E105-138
[162]: https://ssafy.atlassian.net/browse/S15P31E105-162
