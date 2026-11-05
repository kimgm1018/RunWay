import type {
  CoursePlan,
  CourseRecommendations,
  EnvironmentType,
  RecommendedCourse,
  Repositories,
  SavedCourse,
} from '../types';
import { apiRequest } from './http';
import type { Regions } from './regions';

// C01·C03·C07·C08·C09 코스 (docs/design/api/courses.md). Public courses have no name: the spec names them by
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
  status: 'ACTIVE' | 'MERGED' | 'BLOCKED';
};

type BookmarkItem = {
  id: number;
  regionCode: string | null;
  status: string;
  myAlias: string | null;
  distanceM: number;
};

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
};

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

// The same 0–1 box as the mock thumbnails (y grows downward).
function shapeOf(route: [number, number][]): [number, number][] {
  if (route.length === 0) {
    return [];
  }
  const xs = route.map(point => point[0]);
  const ys = route.map(point => point[1]);
  const [minX, maxX, minY, maxY] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  const span = Math.max(maxX - minX, maxY - minY, 1e-6);
  return route.map(([x, y]) => [
    0.1 + ((x - minX) / span) * 0.8,
    0.9 - ((y - minY) / span) * 0.8,
  ]);
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
  // Saving a free run as a course (4.5F) and the 2.0 pace plan have no API yet.
  mock: Repositories['courses'];
  usualPace: () => Promise<number | null>;
  regions: Regions;
}) {
  // The course picked on 3.1b or 3.1c, for 2.0.
  let chosen: string | null = null;
  // C03 has no region, so names worked out for the 3.1b and 3.1c lists are kept for 2.0.
  const named = new Map<string, string>();

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
    return Promise.all(
      items.map(async (item): Promise<SavedCourse> => {
        const [course, name] = await Promise.all([
          detail(item.id, paceSecPerKm),
          nameOf(item.id, item.regionCode, item.distanceM),
        ]);
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
        };
      }),
    );
  };

  // C01 makes new routes; each card is shown from the answer itself (no C03, no saved flag) because the
  // routes are not stored yet. Choosing one to save and run is S15P31E105-371.
  const recommend: Repositories['courses']['recommend'] = async search => {
    const [longitude, latitude] = search.origin.position;
    const seed = search.seed ?? 1;
    const filters = Object.fromEntries(
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
          shape: 'loop',
          filters,
          seed,
        },
      },
    );
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
      return {
        id: `generated:${seed}:${item.index}`,
        name: `${kmLabel(item.distanceM)} 코스`,
        distanceM: item.distanceM,
        estimatedDurationSec: Math.round(
          (item.distanceM / 1000) * paceSecPerKm,
        ),
        shapeKind: shapeKindOf(route),
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

  // 2.0 keeps the mock's pace plan; a server course brings its own name, distance and route.
  const getTodayPlan: Repositories['courses']['getTodayPlan'] = async () => {
    const plan = await mock.getTodayPlan();
    if (!chosen || !isServerId(chosen)) {
      return plan;
    }
    const paceSecPerKm = await pace();
    const course = await detail(chosen, paceSecPerKm);
    const km = Math.ceil(course.distanceM / 1000);
    const result: CoursePlan = {
      ...plan,
      courseId: chosen,
      name:
        course.myAlias ??
        named.get(chosen) ??
        `${kmLabel(course.distanceM)} 코스`,
      distanceM: course.distanceM,
      route: course.route.coordinates,
      segmentPacesSecPerKm: Array.from(
        { length: km },
        (_, index) =>
          plan.segmentPacesSecPerKm[index % plan.segmentPacesSecPerKm.length],
      ),
      expectedDurationSec:
        course.estimatedDurationSec ??
        Math.round((course.distanceM / 1000) * paceSecPerKm),
    };
    return result;
  };

  const courses: Repositories['courses'] = {
    ...mock,
    getSaved,
    recommend,
    getTodayPlan,
    // C07 with no body keeps any alias already set.
    save: async courseId => {
      if (!isServerId(courseId)) {
        return mock.save(courseId);
      }
      await apiRequest(`/courses/${courseId}/bookmark`, { method: 'PUT' });
    },
    // C08 succeeds even when the course was not saved.
    unsave: async courseId => {
      if (!isServerId(courseId)) {
        return mock.unsave(courseId);
      }
      await apiRequest(`/courses/${courseId}/bookmark`, { method: 'DELETE' });
    },
    choose: async courseId => {
      chosen = courseId;
      await mock.choose(courseId);
    },
  };
  return courses;
}
