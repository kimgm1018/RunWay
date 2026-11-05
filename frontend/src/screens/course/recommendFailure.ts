import { DataError } from '../../data';

// What 3.1 says when C01 fails, by details.reason (courses.md 실패와 시간 예산). The conditions stay as entered.
export type RecommendNotice = { title: string; detail: string };

const byReason: Record<string, RecommendNotice> = {
  OUT_OF_AREA: {
    title: '출발 위치가 서비스 지역 밖이에요.',
    detail: '부산 안에서 출발 위치를 골라 주세요.',
  },
  OUT_OF_APP_RANGE: {
    title: '출발과 도착 위치가 너무 멀어요.',
    detail: '도착 위치를 출발 위치 가까이로 바꿔 보세요.',
  },
  ROUTE_NOT_READY: {
    title: '코스 추천을 준비하고 있어요.',
    detail: '입력한 조건은 그대로 두었어요. 잠시 후 다시 시도해 주세요.',
  },
  GRADE_NOT_READY: {
    title: '코스 추천을 준비하고 있어요.',
    detail: '입력한 조건은 그대로 두었어요. 잠시 후 다시 시도해 주세요.',
  },
  NO_ROAD_NEARBY: {
    title: '근처에서 달릴 수 있는 길을 찾지 못했어요.',
    detail: '출발 위치를 길 가까이로 옮겨 다시 추천받아 보세요.',
  },
  DESTINATION_TOO_FAR: {
    title: '이 거리로는 도착 위치까지 갈 수 없어요.',
    detail: '거리를 늘리거나 도착 위치를 바꿔 보세요.',
  },
  NO_ROUTE: {
    title: '조건에 맞는 코스를 찾지 못했어요.',
    detail: '거리나 환경을 바꿔 다시 추천받아 보세요.',
  },
  ROUTE_BUSY: {
    title: '지금 코스 추천 요청이 많아요.',
    detail: '입력한 조건은 그대로 두었어요. 잠시 후 다시 시도해 주세요.',
  },
  GENERATION_TIMEOUT: {
    title: '코스를 만드는 데 시간이 너무 걸렸어요.',
    detail: '입력한 조건은 그대로 두었어요. 잠시 후 다시 시도해 주세요.',
  },
  ROUTE_TIMEOUT: {
    title: '코스를 만드는 데 시간이 너무 걸렸어요.',
    detail: '입력한 조건은 그대로 두었어요. 잠시 후 다시 시도해 주세요.',
  },
};

const fallback: RecommendNotice = {
  title: '코스를 추천받지 못했어요.',
  detail: '입력한 조건은 그대로 두었어요. 잠시 후 다시 시도해 주세요.',
};

export function recommendFailureNotice(error: unknown): RecommendNotice {
  const reason = error instanceof DataError ? error.details?.reason : undefined;
  return (typeof reason === 'string' && byReason[reason]) || fallback;
}
