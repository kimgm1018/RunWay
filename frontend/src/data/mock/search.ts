import { DataError } from '../errors';
import type { Repositories, SearchPage } from '../types';
import * as fixtures from './fixtures';

type Respond = <T>(value: T) => Promise<T>;
type Fail = (error: DataError) => Promise<never>;

const pageSize = 20;
// The mock's guess at the server's minimum (README of runway-search: 두 글자 미만이면 QUERY_TOO_SHORT).
const minLength = 2;

// 7.5 검색 on mock data: the community runners by the handle the feed shows, and the crew directory.
// The cursor holds how far each list has been read, like the server's "u:…|c:…".
export function createSearchMock({
  respond,
  fail,
}: {
  respond: Respond;
  fail: Fail;
}): Repositories['search'] {
  const me = fixtures.communityUsers.me.userId;
  const runners = Object.values(fixtures.communityUsers)
    .filter(user => user.userId !== me)
    .map(user => ({
      userId: user.userId,
      nickname: user.handle,
      profileImageUrl: fixtures.runnerPhotos[user.userId] ?? null,
    }));
  const crews = fixtures.crewDirectory.map(crew => ({
    crewId: crew.id,
    name: crew.name,
  }));
  return {
    find: ({ query, type, cursor }) => {
      const words = query.trim().toLowerCase();
      if (words.length < minLength) {
        return fail(new DataError('QUERY_TOO_SHORT', '검색어가 너무 짧음'));
      }
      const [runnerFrom, crewFrom] = (cursor ?? '0|0').split('|').map(Number);
      const matching = <T>(
        list: T[],
        name: (item: T) => string,
        from: number,
      ) =>
        list
          .filter(item => name(item).toLowerCase().includes(words))
          .slice(from);
      const foundRunners =
        type === 'CREW' ? [] : matching(runners, r => r.nickname, runnerFrom);
      const foundCrews =
        type === 'RUNNER' ? [] : matching(crews, c => c.name, crewFrom);
      const page: SearchPage = {
        runners: foundRunners.slice(0, pageSize),
        crews: foundCrews.slice(0, pageSize),
        cursor:
          foundRunners.length > pageSize || foundCrews.length > pageSize
            ? `${runnerFrom + pageSize}|${crewFrom + pageSize}`
            : null,
      };
      return respond(page);
    },
  };
}
