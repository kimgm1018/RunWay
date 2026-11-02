import {
  createMockRepositories,
  type MockOptions,
} from '../mock/createMockRepositories';
import type { Repositories } from '../types';
import { checkLoginId, login, signUp } from './auth';
import { createCoursesApi } from './courses';
import { createWatchApi } from './devices';
import { getRunningProfile, saveRunningProfile } from './profile';
import { createRecordsApi } from './records';

// Repositories backed by the server. Each API task swaps its mock here for the server version; the rest stay on mock data.
export function createApiRepositories(mockOptions?: MockOptions): Repositories {
  const mock = createMockRepositories(mockOptions);
  const { records, getMonthlySummary } = createRecordsApi();
  return {
    ...mock,
    // Phone verification has no API yet, so it stays on mock data.
    auth: { ...mock.auth, login, checkLoginId, signUp },
    profile: { ...mock.profile, getRunningProfile, saveRunningProfile },
    // Only 2.1 러닝 분석 reads my runs; 오늘 컨디션 stays on mock data until its own API task.
    home: { ...mock.home, getMonthlySummary },
    records,
    // Expected course times use my usual pace (U06); without a profile the courses fall back to 6′00″.
    courses: createCoursesApi({
      mock: mock.courses,
      usualPace: () =>
        getRunningProfile().then(
          profile => profile?.usualPaceSecPerKm ?? null,
          () => null,
        ),
    }),
    watch: createWatchApi(mock.watch),
    // Server records are dated by the real calendar, so 5.1·5.3 open on this month rather than the mock's pinned day.
    clock: { now: () => new Date() },
  };
}
