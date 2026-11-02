import type {
  CoursePlan,
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

type RecommendationItem = {
  id: number;
  regionCode: string | null;
  distanceM: number;
  environmentTags: EnvironmentType[];
  estimatedDurationSec: number;
};

const pageLimit = 50;
// C01 also needs a C03 per card for the route, so the list stays short.
const recommendLimit = 10;
// The pace for expected times when no running profile is saved, as in the mock (6′00″).
const defaultPaceSecPerKm = 360;
// Start and finish this close (m) make a loop.
const loopGapM = 100;

const environmentLabels: Record<EnvironmentType, string> = {
  PARK: '공원',
  RIVERSIDE: '강변',
  URBAN: '도심',
  BEACH: '해변',
  TRACK: '트랙',
};

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

  const recommend: Repositories['courses']['recommend'] = async search => {
    const [longitude, latitude] = search.origin.position;
    const [{ courses }, saved] = await Promise.all([
      apiRequest<{ courses: RecommendationItem[] }>(
        '/courses/recommendations',
        {
          method: 'POST',
          body: {
            latitude,
            longitude,
            targetDistanceM: search.targetDistanceM,
            goalInputType: search.goalInputType,
            targetDurationSec:
              search.goalInputType === 'TIME'
                ? search.targetDurationSec
                : undefined,
            targetPaceSecPerKm:
              search.goalInputType === 'PACE'
                ? search.targetPaceSecPerKm
                : undefined,
            environmentTypes: search.environmentTypes,
            limit: recommendLimit,
          },
        },
      ),
      bookmarks(),
    ]);
    const savedIds = new Set(saved.map(item => item.id));
    return Promise.all(
      courses.map(async (item): Promise<RecommendedCourse> => {
        const [course, name] = await Promise.all([
          detail(item.id),
          nameOf(item.id, item.regionCode, item.distanceM),
        ]);
        const route = course.route.coordinates;
        return {
          id: String(item.id),
          name,
          distanceM: item.distanceM,
          estimatedDurationSec: item.estimatedDurationSec,
          shapeKind: shapeKindOf(route),
          environmentLabels: item.environmentTags.map(
            tag => environmentLabels[tag],
          ),
          elevationGainM:
            course.elevationGainM === null
              ? null
              : Math.round(course.elevationGainM),
          elevationProfile: profileOf(course.elevationProfile),
          // C01 gives no reason; this is the rule it picks courses by.
          reason:
            course.description ??
            `목표 ${kmLabel(
              search.targetDistanceM,
            )}에 가까운 코스 중 출발점이 가까운 순서예요.`,
          route,
          saved: savedIds.has(item.id),
        };
      }),
    );
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
