import type {
  CourseShape,
  EnvironmentType,
  RecommendationFilters,
  RecommendationPreferences,
} from './types';

export const courseShapeOptions: { value: CourseShape; label: string }[] = [
  { value: 'loop', label: '순환' },
  { value: 'out_and_back', label: '왕복' },
  { value: 'point_to_point', label: '편도' },
];
export const courseFilterOptions: {
  key: keyof RecommendationFilters;
  label: string;
}[] = [
  { key: 'river', label: '강변' },
  { key: 'beach', label: '해변' },
  { key: 'park', label: '공원' },
  { key: 'trail', label: '트레일' },
  { key: 'pedestrian', label: '보행로' },
  { key: 'flat', label: '평지 위주' },
  { key: 'avoid_major_road', label: '큰길 피하기' },
  { key: 'avoid_steps', label: '계단 피하기' },
  { key: 'avoid_tunnel', label: '터널 피하기' },
];
export function defaultCoursePreferences(): RecommendationPreferences {
  return {
    shape: 'loop',
    filters: {
      river: false,
      beach: false,
      park: false,
      trail: false,
      pedestrian: false,
      flat: false,
      avoid_major_road: false,
      avoid_steps: false,
      avoid_tunnel: false,
    },
  };
}
// U12는 9개 조건 전체를 교체한다. 좌표나 기타 추천 입력이 섞이지 않도록 명시적으로 복사한다.
export function copyCoursePreferences(
  value: RecommendationPreferences,
): RecommendationPreferences {
  const filters = defaultCoursePreferences().filters;
  for (const { key } of courseFilterOptions) filters[key] = value.filters[key];
  return { shape: value.shape, filters };
}
// 이전 화면·목업의 환경 태그 표현과 호환하되, 실제 추천 입력은 9개 filters를 사용한다.
export function legacyEnvironmentTypes(
  filters: RecommendationFilters,
): EnvironmentType[] {
  return [
    ...(filters.park ? ['PARK' as const] : []),
    ...(filters.river ? ['RIVERSIDE' as const] : []),
    ...(filters.beach ? ['BEACH' as const] : []),
  ];
}
