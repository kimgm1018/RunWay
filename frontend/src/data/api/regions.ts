import { apiRequest } from './http';
import { listItems } from './listItems';

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

// Older names a phone's geocoder may still give for a sido the CMT12 list now calls otherwise.
const formerSido: Record<string, string> = {
  광주광역시: '전남광주통합특별시',
  전라남도: '전남광주통합특별시',
  전라북도: '전북특별자치도',
  강원도: '강원특별자치도',
  제주도: '제주특별자치도',
};

// Whether the first word of an address names this sido: its full name, its short name or an older name.
const namesSido = (region: RegionItem, word: string) =>
  region.sidoName === word ||
  sidoOf(region) === word ||
  formerSido[word] === region.sidoName;

// 7.1 지역 고르기 (S15P31E105-687): a sido with its 시·군·구, in the CMT12 order. The sido's own code is its row
// without a sigungu.
export type RegionProvince = {
  code: string;
  name: string;
  areas: { code: string; name: string }[];
};

const provincesOf = (items: RegionItem[]): RegionProvince[] => {
  const bySido = new Map<string, RegionProvince>();
  for (const item of items) {
    let province = bySido.get(item.sidoName);
    if (!province) {
      province = { code: '', name: sidoOf(item), areas: [] };
      bySido.set(item.sidoName, province);
    }
    if (item.sigunguName) {
      province.areas.push({ code: item.regionCode, name: item.sigunguName });
    } else {
      province.code = item.regionCode;
    }
  }
  // A sido the list has no row of its own for cannot be picked as a whole.
  return [...bySido.values()].filter(province => province.code);
};

export type Regions = ReturnType<typeof createRegions>;

export function createRegions() {
  let list: Promise<RegionItem[]> | null = null;

  // A failed load is tried again next time; until then places show without a region name.
  // Missing/null items must stay [] — otherwise crew/course mapping throws and looks like a
  // failed list load (same empty-list rule as S15P31E105-588).
  const load = () => {
    list ??= apiRequest<{ items?: RegionItem[] | null }>('/regions')
      .then(body => listItems(body))
      .catch(() => {
        list = null;
        return [];
      });
    return list;
  };

  return {
    // Every sido and its 시·군·구 (7.1 지역 고르기); a failed load gives none.
    provinces: async () => provincesOf(await load()),
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
    // The region of a full address from the phone's geocoder, word by word: ‘부산광역시 해운대구 우동 …’ is 해운대구,
    // ‘경기도 수원시 장안구 …’ is 수원시 장안구, and a sido whose 시·군·구 is not in the list is the sido itself. null when
    // the sido is not known (S15P31E105-687).
    codeAt: async (address: string | null) => {
      const words = (address ?? '')
        .split(/\s+/)
        .filter(word => word && word !== '대한민국');
      if (!words.length) {
        return null;
      }
      const inSido = (await load()).filter(item => namesSido(item, words[0]));
      const area = (name: string) =>
        inSido.find(item => item.sigunguName === name);
      const region =
        (words.length > 2 ? area(`${words[1]} ${words[2]}`) : undefined) ??
        (words.length > 1 ? area(words[1]) : undefined) ??
        inSido.find(item => !item.sigunguName);
      return region?.regionCode ?? null;
    },
  };
}
