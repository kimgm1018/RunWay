import {
  createMockRepositories,
  type MockOptions,
} from '../mock/createMockRepositories';
import type { Repositories } from '../types';
import { checkLoginId, login, logout, signUp } from './auth';
import { createCommunityApi } from './community';
import { createCoursesApi } from './courses';
import { createCrewsApi } from './crews';
import { createWatchApi } from './devices';
import { createGroupRunsApi } from './groupRuns';
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
import { uploadSyncBatch } from './syncBatches';
import { createApiSessionRepository } from './sessionApi';
import { createLinkedDevices } from './sessionDevices';
import { createNativeWatchSession } from '../../watch/watchSession';

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
    // Phone verification has no API yet, so it stays on mock data.
    auth: { ...mock.auth, login, checkLoginId, signUp, logout },
    profile: {
      getMe,
      getDetail,
      updateBasic,
      changePhoto,
      getRunningProfile,
      saveRunningProfile,
    },
    // 2.1 러닝 분석 reads my runs; 오늘 컨디션 takes its readiness from R02 and the rest from mock data.
    home: {
      getMonthlySummary,
      getTodayCondition: createReadinessApi({
        base: mock.home.getTodayCondition,
        now: () => new Date(),
      }),
    },
    records,
    // CMT01–CMT11. Runner profiles and follows (U21–U23) have no API yet and stay on mock data.
    community: createCommunityApi({ records }),
    // Without a profile the expected course times fall back to 6′00″.
    courses: createCoursesApi({ mock: mock.courses, usualPace, regions }),
    watch: createWatchApi(mock.watch),
    // S15P31E105-256 러닝 세션 제어(S01~S08)와 워치 중계. 세션에 쓸 워치·폰 기기 ID는 W02로 읽고 폰이 없으면 W01로 연결한다.
    // W07 워치 batch 업로드(S15P31E105-311)는 본문 원문을 그대로 보낸다.
    session: { ...createApiSessionRepository(serverRequest), uploadBatch: uploadSyncBatch },
    watchSession: {
      ...createNativeWatchSession(),
      getLinkedDevices: createLinkedDevices(serverRequest),
    },
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
