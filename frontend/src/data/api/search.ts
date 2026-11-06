import type { Repositories, SearchType } from '../types';
import { apiRequest } from './http';

// CMT13 통합 검색 (docs/design/api/community.md). The server pages runners and crews with one
// opaque cursor (`page`) and leaves out the kind a typed search did not ask for.
type SearchResponse = {
  users?: { userId: number; nickname: string }[];
  crews?: { id: number; name: string }[];
  page?: string | null;
};

const serverType: Record<SearchType, 'USER' | 'CREW' | undefined> = {
  ALL: undefined,
  RUNNER: 'USER',
  CREW: 'CREW',
};

export const searchApi: Repositories['search'] = {
  find: async ({ query, type, cursor }) => {
    const response = await apiRequest<SearchResponse>('/search', {
      query: { q: query, type: serverType[type], cursor, limit: 20 },
    });
    return {
      runners: (response.users ?? []).map(user => ({
        userId: String(user.userId),
        nickname: user.nickname,
      })),
      crews: (response.crews ?? []).map(crew => ({
        crewId: String(crew.id),
        name: crew.name,
      })),
      cursor: response.page ?? null,
    };
  },
};
