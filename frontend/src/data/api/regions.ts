import { apiRequest } from './http';

// CMT12 지역 목록, loaded once and shared: courses and crews keep only a region code.

type RegionItem = { regionCode: string; sidoName: string; sigunguName: string };

// The short sido names Korean addresses use, so ‘부산광역시 수영구’ fits a card as ‘부산 수영구’.
const shortSido: Record<string, string> = {
  강원특별자치도: '강원',
  경기도: '경기',
  경상남도: '경남',
  경상북도: '경북',
  대구광역시: '대구',
  대전광역시: '대전',
  부산광역시: '부산',
  서울특별시: '서울',
  세종특별자치시: '세종',
  울산광역시: '울산',
  인천광역시: '인천',
  전남광주통합특별시: '전남광주',
  전북특별자치도: '전북',
  제주특별자치도: '제주',
  충청남도: '충남',
  충청북도: '충북',
};

const sidoOf = (region: RegionItem) =>
  shortSido[region.sidoName] ?? region.sidoName;

export type Regions = ReturnType<typeof createRegions>;

export function createRegions() {
  let list: Promise<RegionItem[]> | null = null;

  // A failed load is tried again next time; until then places show without a region name.
  const load = () => {
    list ??= apiRequest<{ items: RegionItem[] }>('/regions')
      .then(({ items }) => items)
      .catch(() => {
        list = null;
        return [];
      });
    return list;
  };

  return {
    // 부산 수영구 (a sido-only region has no sigungu), or null for an unknown or missing code.
    name: async (regionCode: string | null) => {
      if (!regionCode) {
        return null;
      }
      const region = (await load()).find(
        item => item.regionCode === regionCode,
      );
      return region
        ? [sidoOf(region), region.sigunguName].filter(Boolean).join(' ')
        : null;
    },
    // The region of an address such as ‘부산 수영구 광안해변로 219’; the sido may be written short.
    codeOf: async (address: string | null) => {
      if (!address) {
        return null;
      }
      const [sido] = address.split(' ');
      const inAddress = (await load()).filter(
        item => item.sigunguName && address.includes(item.sigunguName),
      );
      const region =
        inAddress.find(
          item => sidoOf(item) === sido || item.sidoName.startsWith(sido),
        ) ?? (inAddress.length === 1 ? inAddress[0] : undefined);
      return region?.regionCode ?? null;
    },
  };
}
