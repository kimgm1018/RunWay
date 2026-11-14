// A short read of the plan's shape for 오늘의 전략, from the km paces against their mean.
export function strategyOf(paces: number[]) {
  const mean = paces.reduce((sum, value) => sum + value, 0) / paces.length;
  const first = paces[0];
  const last = paces[paces.length - 1];
  const parts = [
    first > mean + 3 ? '초반 안정' : first < mean - 3 ? '초반 빠르게' : null,
    last < mean - 3 ? '후반 가속' : last > mean + 3 ? '후반 여유' : null,
  ].filter((part): part is string => part !== null);
  return parts.length ? parts.join(' → ') : '고른 페이스';
}
