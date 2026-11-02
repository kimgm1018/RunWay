import {
  createMockRepositories,
  type MockOptions,
} from '../mock/createMockRepositories';
import type { Repositories } from '../types';
import { checkLoginId, login, signUp } from './auth';
import { createCoursesApi } from './courses';
import { createCrewsApi } from './crews';
import { createWatchApi } from './devices';
import { getRunningProfile, saveRunningProfile } from './profile';
import { createRecordsApi } from './records';
import { createRegions } from './regions';

// Repositories backed by the server. Each API task swaps its mock here for the server version; the rest stay on mock data.
export function createApiRepositories(mockOptions?: MockOptions): Repositories {
  const mock = createMockRepositories(mockOptions);
  const { records, getMonthlySummary } = createRecordsApi();
  const regions = createRegions();
  const { crews, listMine: myCrews } = createCrewsApi({
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
    // Expected course times use my usual pace (U06); without a profile the courses fall back to 6′00″.
    courses: createCoursesApi({
      mock: mock.courses,
      usualPace: () =>
        getRunningProfile().then(
          profile => profile?.usualPaceSecPerKm ?? null,
          () => null,
        ),
      regions,
    }),
    watch: createWatchApi(mock.watch),
    crews,
    // 6.0 내 크루 comes from M10; group runs stay on mock data until G02 (-306), so only a run of one of my crews shows.
    groupRuns: {
      ...mock.groupRuns,
      listMine: async () => {
        const [runs, mine] = await Promise.all([
          mock.groupRuns.listMine(),
          myCrews(),
        ]);
        const ids = new Set(mine.map(crew => crew.id));
        return {
          ...runs,
          upcoming:
            runs.upcoming && ids.has(runs.upcoming.crewId)
              ? runs.upcoming
              : null,
          crews: mine.map(crew => ({
            crew,
            groupRuns:
              runs.crews.find(item => item.crew.id === crew.id)?.groupRuns ??
              [],
          })),
        };
      },
    },
    // Server records are dated by the real calendar, so 5.1·5.3 open on this month rather than the mock's pinned day.
    clock: { now: () => new Date() },
  };
}
