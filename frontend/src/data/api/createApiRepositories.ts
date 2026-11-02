import {
  createMockRepositories,
  type MockOptions,
} from '../mock/createMockRepositories';
import type { Repositories } from '../types';
import { checkLoginId, login, signUp } from './auth';
import { createCoursesApi } from './courses';
import { createCrewsApi } from './crews';
import { createWatchApi } from './devices';
import { createGroupRunsApi } from './groupRuns';
import { getRunningProfile, saveRunningProfile } from './profile';
import { createRecordsApi } from './records';
import { createRegions } from './regions';

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
    auth: { ...mock.auth, login, checkLoginId, signUp },
    profile: { ...mock.profile, getRunningProfile, saveRunningProfile },
    // Only 2.1 러닝 분석 reads my runs; 오늘 컨디션 stays on mock data until its own API task.
    home: { ...mock.home, getMonthlySummary },
    records,
    // Without a profile the expected course times fall back to 6′00″.
    courses: createCoursesApi({ mock: mock.courses, usualPace, regions }),
    watch: createWatchApi(mock.watch),
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
