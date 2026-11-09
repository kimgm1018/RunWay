import {
  createMockRepositories,
  type MockOptions,
} from '../mock/createMockRepositories';
import type { Repositories } from '../types';
import {
  checkLoginId,
  login,
  logout,
  requestPhoneCode,
  resetPassword,
  signUp,
  verifyPhoneCode,
} from './auth';
import { createCommunityApi } from './community';
import { createRunnersApi } from './runners';
import { saveRunRecord } from './runRecords';
import { consentsApi } from './consents';
import { createCoursesApi } from './courses';
import { createCrewsApi } from './crews';
import { createWatchApi } from './devices';
import { createGroupRunsApi } from './groupRuns';
import { notificationsApi } from './notifications';
import {
  changePhoto,
  getDetail,
  getMe,
  getRunningProfile,
  saveRunningProfile,
  updateBasic,
} from './profile';
import { createReadinessApi } from './readiness';
import { createRecordsApi } from './records';
import { createRegions } from './regions';
import { serverRequest } from './request';
import { searchApi } from './search';
import { settingsApi } from './settings';
import { uploadSyncBatch } from './syncBatches';
import { createApiSessionRepository } from './sessionApi';
import { createSessionEvents } from './sessionEvents';
import { createLinkedDevices } from './sessionDevices';
import { createNativeWatchSession } from '../../watch/watchSession';
import { createPhoneLocation } from '../../watch/phoneLocation';
import { createAccountApi } from './account';

// Repositories backed by the server. Each API task swaps its mock here for the server version; the rest stay on mock data.
export function createApiRepositories(mockOptions?: MockOptions): Repositories {
  const mock = createMockRepositories(mockOptions);
  const { records, getMonthlySummary } = createRecordsApi();
  const regions = createRegions();
  // My usual pace (U06) for course times and a group run's shared pace; null without a profile.
  const usualPace = () =>
    getRunningProfile().then(
      profile => profile?.usualPaceSecPerKm ?? null,
      () => null,
    );
  const {
    crews,
    listMine: myCrews,
    myId,
  } = createCrewsApi({
    mock: mock.crews,
    regions,
  });
  return {
    ...mock,
    // U28~U30 휴대전화 인증·비밀번호 재설정 (S15P31E105-560): no auth call stays on mock data.
    auth: {
      login,
      checkLoginId,
      requestPhoneCode,
      verifyPhoneCode,
      signUp,
      resetPassword,
      logout,
    },
    profile: {
      getMe,
      getDetail,
      updateBasic,
      changePhoto,
      getRunningProfile,
      saveRunningProfile,
    },
    // 2.1 러닝 분석 reads my runs; 오늘 컨디션 reads the readiness score and that day's health metrics from R02.
    home: {
      getMonthlySummary,
      getTodayCondition: createReadinessApi({ now: () => new Date() }),
    },
    records,
    // 8.1 건강정보 수집: W05 reads and W04 saves the HEALTH_DATA consent.
    consents: consentsApi,
    // 8.1 설정·8.1b 위치 기록: U19·U20 app settings and U13·U14 account visibility.
    settings: settingsApi,
    // 8.4–8.6 회원탈퇴: U17 사전 정보와 U18 탈퇴 (S15P31E105-523).
    account: createAccountApi(),
    // CMT01–CMT11 커뮤니티.
    community: createCommunityApi({ records }),
    // 7.4 러너 프로필 · 7.4b 내 프로필 (U21) and 팔로우 · 취소 (U22 · U23), S15P31E105-524.
    runners: createRunnersApi({ myId, records }),
    // 7.5 검색 (CMT13): runners and crews by name.
    search: searchApi,
    // 2.9 알림 (N01·N02): the inbox and its unread count; leaving the screen reads them all.
    notifications: notificationsApi,
    // Without a profile the expected course times fall back to 6′00″.
    courses: createCoursesApi({ mock: mock.courses, usualPace, regions }),
    watch: createWatchApi(mock.watch),
    // S15P31E105-256 러닝 세션 제어(S01~S08)와 워치 중계. 세션에 쓸 워치·폰 기기 ID는 W02로 읽고 폰이 없으면 W01로 연결한다.
    // W07 워치 batch 업로드(S15P31E105-311)는 본문 원문을 그대로 보낸다.
    // S10 구독(S15P31E105-257)은 러닝 중 서버 코칭·상태를 워치로 중계하는 데 쓴다.
    session: {
      ...createApiSessionRepository(serverRequest),
      uploadBatch: uploadSyncBatch,
      subscribeEvents: (sessionId, handlers) => createSessionEvents({ sessionId, ...handlers }).stop,
    },
    watchSession: {
      ...createNativeWatchSession(),
      getLinkedDevices: createLinkedDevices(serverRequest),
    },
    // 실제 모드의 화면 기록은 일시정지 제외 시계만 센다(S15P31E105-517). 거리·페이스·심박·케이던스·위치는 폰이 받은
    // 워치 batch(또는 인계 후 폰 GPS)의 실측값으로 채우고(runControl live), 목업 값이나 목업 길 안내는 만들지 않는다.
    run: {
      ...mock.run,
      startTracking: (from, route, onSample) =>
        mock.run.startTracking(from, route, tick =>
          onSample(
            {
              elapsedSec: tick.elapsedSec,
              distanceM: from.distanceM,
              paceSecPerKm: null,
              heartRate: null,
              cadence: null,
              position: null,
            },
            null,
          ),
        ),
      // 4.5 결과는 서버 세션의 기록(H02)을 확인해 쓰고, 폰에서 목업 기록을 만들지 않는다(S15P31E105-529).
      saveRecord: saveRunRecord,
    },
    // 폰 인계 뒤 폰 GPS 기록(S15P31E105-464).
    phoneLocation: createPhoneLocation(),
    crews,
    groupRuns: createGroupRunsApi({
      mock: mock.groupRuns,
      crews,
      myCrews,
      myId,
      usualPace,
    }),
    // Server records are dated by the real calendar, so 5.1·5.3 open on this month rather than the mock's pinned day.
    clock: { now: () => new Date() },
  };
}
