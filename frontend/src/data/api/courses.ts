import type {
  CoursePlan,
  CourseRecommendations,
  CourseStatus,
  EnvironmentType,
  RecommendedCourse,
  Repositories,
  SavedCourse,
} from '../types';
import { apiRequest } from './http';
import { DataError } from '../errors';
import { courseShapeOptions } from '../coursePreferences';
import { getCoursePreferences, saveCoursePreferences } from './preferences';
import type { Regions } from './regions';
import { shapeOfRoute } from '../../geo';
import { basemapOf } from './basemap';

// C01·C03·C07·C08·C09·C10 코스 (docs/design/api/courses.md). Public courses have no name: the spec names them by
// region (sido + sigungu + 코스), and my bookmark alias goes on top of that.

type LineString = { type: 'LineString'; coordinates: [number, number][] };

type DetailResponse = {
  id: number;
  myAlias: string | null;
  description: string | null;
  route: LineString;
  distanceM: number;
  elevationGainM: number | null;
  elevationProfile: unknown;
  environmentTags: EnvironmentType[];
  // Only with targetPaceSecPerKm.
  estimatedDurationSec?: number;
  status: CourseStatus;
  mergedIntoCourseId: number | null;
  // The map thumbnail `{ imageUrl, osmDataTimestamp }` (S15P31E105-612); null until the server has made it,
  // missing on an older server.
  basemap?: unknown;
  unmeasuredEdges?: number[] | null;
};

type BookmarkItem = {
  id: number;
  regionCode: string | null;
  status: string;
  mergedIntoCourseId?: number | null;
  myAlias: string | null;
  distanceM: number;
};

const courseStatuses: readonly CourseStatus[] = ['ACTIVE', 'MERGED', 'BLOCKED'];

const statusOf = (value: string | undefined): CourseStatus =>
  courseStatuses.includes(value as CourseStatus)
    ? (value as CourseStatus)
    : 'ACTIVE';

// C01 (courses.md 코스 생성 후속): routes made for this search, not stored courses. index is not a course id.
type GradeSegment = {
  startDistanceM: number;
  endDistanceM: number;
  gradePercent: number;
};

type GeneratedItem = {
  index: number;
  distanceM: number;
  route: LineString;
  elevationProfile: GradeSegment[];
  summary: string;
  reasons: string[];
  caveats: string[];
  // C10 signs the route, distance and grades with it; valid for 30 minutes after C01.
  candidateToken: string;
};

// What C10 needs to store a C01 route: the values exactly as C01 sent them.
type Candidate = Pick<
  GeneratedItem,
  'candidateToken' | 'route' | 'distanceM' | 'elevationProfile'
> & { name: string };

type RecommendationResponse = {
  courses: GeneratedItem[];
  notices: string[];
  nextSeed: number;
};

const pageLimit = 50;
// C01 seed range; a nextSeed past it means there is no more to ask for.
const maxSeed = 10_000_000;
// The 3.1 environments C01 can ask for. 도심 and 트랙 have no Route preference, so they are left out.
const filterOf: Partial<Record<EnvironmentType, string>> = {
  PARK: 'park',
  RIVERSIDE: 'river',
  BEACH: 'beach',
};
// The pace for expected times when no running profile is saved, as in the mock (6′00″).
const defaultPaceSecPerKm = 360;
// Start and finish this close (m) make a loop.
const loopGapM = 100;

// Only server courses have numeric ids; mock ones (a free run saved as a course) stay on the mock.
const isServerId = (courseId: string) => /^\d+$/.test(courseId);
// A C01 route on 3.1b, stored by C10 when it is picked or saved.
const isGeneratedId = (courseId: string) => courseId.startsWith('generated:');

// The same 0–1 box as the mock thumbnails (y grows downward, the course centred).
function shapeOf(route: [number, number][]): [number, number][] {
  return route.length === 0 ? [] : shapeOfRoute(route);
}

// Straight-line metres between two [longitude, latitude] points; close enough at course scale.
function gapM([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]) {
  const toRad = Math.PI / 180;
  const x = (lon2 - lon1) * toRad * Math.cos(((lat1 + lat2) / 2) * toRad);
  const y = (lat2 - lat1) * toRad;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

// The server keeps no course shape; a route ending where it started reads as a loop.
function shapeKindOf(route: [number, number][]) {
  return route.length > 1 && gapM(route[0], route[route.length - 1]) < loopGapM
    ? '순환'
    : '편도';
}

// elevation_profile has no fixed JSON shape yet; a list of heights becomes ten 0–100 levels, anything else none.
function profileOf(raw: unknown): number[] {
  const heights = Array.isArray(raw)
    ? raw.filter((value): value is number => typeof value === 'number')
    : [];
  if (heights.length < 2) {
    return [];
  }
  const [low, high] = [Math.min(...heights), Math.max(...heights)];
  return Array.from({ length: 10 }, (_, index) => {
    const height = heights[Math.round((index / 9) * (heights.length - 1))];
    return high > low ? Math.round(((height - low) / (high - low)) * 100) : 0;
  });
}

// C01 gives 100m grades; adding up rise × length gives the heights along the course, from 0 at the start.
function heightsOf(grades: GradeSegment[]): number[] {
  const heights = [0];
  for (const { startDistanceM, endDistanceM, gradePercent } of grades) {
    heights.push(
      heights[heights.length - 1] +
        (gradePercent / 100) * (endDistanceM - startDistanceM),
    );
  }
  return heights;
}

// Total climb: only the rises count.
function climbOf(heights: number[]): number {
  let climb = 0;
  for (let index = 1; index < heights.length; index++) {
    climb += Math.max(0, heights[index] - heights[index - 1]);
  }
  return climb;
}

const kmLabel = (distanceM: number) => `${(distanceM / 1000).toFixed(1)}km`;

export function createCoursesApi({
  mock,
  usualPace,
  regions,
}: {
  // Saving a free run as a course (4.5F) has no API yet and answers NOT_AVAILABLE.
  mock: Repositories['courses'];
  usualPace: () => Promise<number | null>;
  regions: Regions;
}) {
  // The course picked on 3.1b or 3.1c, for 2.0.
  let chosen: string | null = null;
  // C03 has no region, so names worked out for the 3.1b and 3.1c lists are kept for 2.0.
  const named = new Map<string, string>();
  // C01 routes by card id, and the course id C10 gave each one stored so far.
  const candidates = new Map<string, Candidate>();
  const stored = new Map<string, Promise<string>>();
  let recommendationSequence = 0;

  // C10 stores the picked route, or hands back the course with exactly the same points (reused). Asking again
  // for the same card reuses the answer; a failure lets the next tap ask again.
  function serverIdOf(courseId: string): Promise<string> {
    if (!isGeneratedId(courseId)) {
      return Promise.resolve(courseId);
    }
    const candidate = candidates.get(courseId);
    if (!candidate) {
      return Promise.reject(
        new DataError('COURSE_CANDIDATE_INVALID', '추천 후보 없음'),
      );
    }
    let answer = stored.get(courseId);
    if (!answer) {
      const { name, ...body } = candidate;
      answer = apiRequest<{ courseId: number; reused: boolean }>(
        '/courses/generated',
        { method: 'POST', body },
      ).then(({ courseId: id }) => {
        named.set(String(id), name);
        return String(id);
      });
      stored.set(courseId, answer);
      answer.catch(() => stored.delete(courseId));
    }
    return answer;
  }

  // Without a region name a course is named by its distance.
  async function nameOf(
    courseId: number,
    regionCode: string | null,
    distanceM: number,
  ) {
    const region = await regions.name(regionCode);
    const name = region ? `${region} 코스` : `${kmLabel(distanceM)} 코스`;
    named.set(String(courseId), name);
    return name;
  }

  const pace = async () => (await usualPace()) ?? defaultPaceSecPerKm;

  const detail = (courseId: string | number, paceSecPerKm?: number) =>
    apiRequest<DetailResponse>(`/courses/${courseId}`, {
      query: { targetPaceSecPerKm: paceSecPerKm },
    });

  // Every C09 page, newest bookmark first.
  async function bookmarks() {
    const items: BookmarkItem[] = [];
    let cursor: string | undefined;
    do {
      const page: { items: BookmarkItem[]; page?: string } = await apiRequest(
        '/users/me/bookmarked-courses',
        { query: { limit: pageLimit, cursor } },
      );
      items.push(...page.items);
      cursor = page.page;
    } while (cursor);
    return items;
  }

  const getSaved: Repositories['courses']['getSaved'] = async () => {
    const [items, paceSecPerKm] = await Promise.all([bookmarks(), pace()]);
    // One C03 failure must not drop the whole list (S15P31E105-638).
    const settled = await Promise.allSettled(
      items.map(async (item): Promise<SavedCourse> => {
        const bookmarkStatus = statusOf(item.status);
        const bookmarkMerged =
          item.mergedIntoCourseId == null
            ? null
            : String(item.mergedIntoCourseId);
        const [course, name] = await Promise.all([
          detail(item.id, paceSecPerKm),
          nameOf(item.id, item.regionCode, item.distanceM),
        ]);
        const status = statusOf(course.status ?? bookmarkStatus);
        const mergedIntoCourseId =
          course.mergedIntoCourseId == null
            ? bookmarkMerged
            : String(course.mergedIntoCourseId);
        return {
          id: String(item.id),
          name,
          myAlias: item.myAlias,
          distanceM: item.distanceM,
          expectedMinutes: Math.round(
            (course.estimatedDurationSec ??
              (item.distanceM / 1000) * paceSecPerKm) / 60,
          ),
          shape: shapeOf(course.route.coordinates),
          route: course.route.coordinates,
          unmeasuredEdges: course.unmeasuredEdges ?? [],
          status,
          mergedIntoCourseId,
          basemap: basemapOf(course.basemap),
        };
      }),
    );
    return settled.flatMap(result =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
  };

  // C01 makes new routes; each card is shown from the answer itself (no C03, no saved flag) because the
  // routes are not stored until one is picked or saved (C10).
  const recommend: Repositories['courses']['recommend'] = async search => {
    const [longitude, latitude] = search.origin.position;
    const seed = search.seed ?? 1;
    if (search.shape === 'point_to_point' && !search.destination)
      throw new DataError('VALIDATION_ERROR', '편도 도착지를 선택해 주세요');
    // U11·U12는 snake_case, C01은 camelCase 회피 키를 사용한다.
    const filters = search.filters
      ? {
          river: search.filters.river,
          beach: search.filters.beach,
          park: search.filters.park,
          trail: search.filters.trail,
          pedestrian: search.filters.pedestrian,
          flat: search.filters.flat,
          avoidMajorRoad: search.filters.avoid_major_road,
          avoidSteps: search.filters.avoid_steps,
          avoidTunnel: search.filters.avoid_tunnel,
        }
      : Object.fromEntries(
          search.environmentTypes.flatMap(type =>
            filterOf[type] ? [[filterOf[type], true]] : [],
          ),
        );
    const answer = await apiRequest<RecommendationResponse>(
      '/courses/recommendations',
      {
        method: 'POST',
        // The backend may take up to 20s to make the routes; the phone waits 30s (courses.md 시간 예산).
        timeoutMs: 30_000,
        body: {
          latitude,
          longitude,
          distanceKm: search.targetDistanceM / 1000,
          shape: search.shape ?? 'loop',
          ...(search.shape === 'point_to_point' && search.destination
            ? {
                endLongitude: search.destination.position[0],
                endLatitude: search.destination.position[1],
              }
            : {}),
          filters,
          seed,
        },
      },
    );
    // seed/index can repeat after a location change or a new search. Keep each
    // answer in its own namespace, including when requests finish out of order.
    const recommendationId = ++recommendationSequence;
    // The goal pace from 3.1, or my usual pace, for the expected time on each card.
    const paceSecPerKm =
      search.goalInputType === 'PACE' && search.targetPaceSecPerKm
        ? search.targetPaceSecPerKm
        : search.targetDurationSec
        ? search.targetDurationSec / (search.targetDistanceM / 1000)
        : await pace();
    const courses = answer.courses.map((item): RecommendedCourse => {
      const route = item.route.coordinates;
      const heights = heightsOf(item.elevationProfile);
      const id = `generated:${recommendationId}:${seed}:${item.index}`;
      const name = `${kmLabel(item.distanceM)} 코스`;
      candidates.set(id, {
        candidateToken: item.candidateToken,
        route: item.route,
        distanceM: item.distanceM,
        elevationProfile: item.elevationProfile,
        name,
      });
      return {
        id,
        name,
        distanceM: item.distanceM,
        estimatedDurationSec: Math.round(
          (item.distanceM / 1000) * paceSecPerKm,
        ),
        // 왕복도 시작·끝 좌표가 같으므로 선택한 형태가 있으면 그 의미를 사용한다.
        shapeKind:
          courseShapeOptions.find(option => option.value === search.shape)
            ?.label ?? shapeKindOf(route),
        // The preferences are weights, not what the route really passes, so no tags are claimed.
        environmentLabels: [],
        elevationGainM:
          item.elevationProfile.length > 0
            ? Math.round(climbOf(heights))
            : null,
        elevationProfile: profileOf(heights),
        // Route's own words, shown as plain text.
        reason: [
          item.summary,
          ...item.reasons.map(text => `· ${text}`),
          ...item.caveats.map(text => `주의: ${text}`),
        ].join('\n'),
        route,
        saved: false,
        generated: true,
      };
    });
    const result: CourseRecommendations = {
      courses,
      notices: answer.notices,
      nextSeed: answer.nextSeed <= maxSeed ? answer.nextSeed : null,
    };
    return result;
  };

  // 2.0 shows only what the server knows about the chosen course: its name, distance, route and expected time.
  // There is no pace plan API yet, so no mock strategy, caution or km paces stand in, and without a chosen server
  // course (nothing picked yet, or after a restart) there is no plan (S15P31E105-635).
  const getTodayPlan: Repositories['courses']['getTodayPlan'] = async () => {
    if (!chosen || !isServerId(chosen)) {
      return null;
    }
    const paceSecPerKm = await pace();
    const course = await detail(chosen, paceSecPerKm);
    const result: CoursePlan = {
      courseId: chosen,
      name:
        course.myAlias ??
        named.get(chosen) ??
        `${kmLabel(course.distanceM)} 코스`,
      distanceM: course.distanceM,
      route: course.route.coordinates,
      segmentPacesSecPerKm: [],
      strategy: null,
      targetPaceSecPerKm: null,
      expectedDurationSec:
        course.estimatedDurationSec ??
        Math.round((course.distanceM / 1000) * paceSecPerKm),
      caution: null,
    };
    return result;
  };

  const courses: Repositories['courses'] = {
    ...mock,
    getPreferences: getCoursePreferences,
    savePreferences: saveCoursePreferences,
    getSaved,
    recommend,
    getTodayPlan,
    // C07 with no body keeps any alias already set. A C01 route is stored by C10 first.
    save: async courseId => {
      const id = await serverIdOf(courseId);
      if (!isServerId(id)) {
        return mock.save(id);
      }
      await apiRequest(`/courses/${id}/bookmark`, { method: 'PUT' });
    },
    // C08 succeeds even when the course was not saved.
    unsave: async courseId => {
      const id = await serverIdOf(courseId);
      if (!isServerId(id)) {
        return mock.unsave(id);
      }
      await apiRequest(`/courses/${id}/bookmark`, { method: 'DELETE' });
    },
    // The server derives a private course from the completed session's stored GPS.
    saveFromRun: async recordId => {
      const response = await apiRequest<{ courseId: number }>(
        `/running-records/${recordId}/course`,
        { method: 'PUT' },
      );
      return { courseId: String(response.courseId) };
    },
    choose: async courseId => {
      const id = await serverIdOf(courseId);
      chosen = id;
      await mock.choose(id);
    },
  };
  return courses;
}
