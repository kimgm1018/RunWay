import { DataError } from '../errors';
import type {
  CrewJoinPolicy,
  CrewListItem,
  CrewMember,
  MyCrew,
  Repositories,
} from '../types';
import * as fixtures from './fixtures';
import type { CrewFixture } from './fixtures';

type Respond = <T>(value: T) => Promise<T>;
type Fail = (error: DataError) => Promise<never>;

// The 6.1 내 근처 radius (M01 radiusM, 3km on screen).
const nearbyKm = 3;

type CrewState = CrewFixture & { joinPolicy: CrewJoinPolicy };

const toListItem = ({
  distanceKm: _distanceKm,
  joinPolicy: _joinPolicy,
  ...crew
}: CrewState): CrewListItem => crew;

type Person = { userId: string; nickname: string };

// The 6.2m capacity limit; 정원 제한 off means this many (M03 allows 1–200).
const maxCapacity = 200;

// 6.2 구성원: the named roster and those who joined since, then filler members up to memberCount.
// Paces spread 5′30″–6′59″. I am on the roster only while I am a member (6.0b knows no crew).
function membersOf(crew: CrewFixture, joined: Person[]): CrewMember[] {
  const named = [...(fixtures.crewRoster[crew.id] ?? []), ...joined].filter(
    member =>
      crew.myMembership === 'MEMBER' ||
      member.userId !== fixtures.members.me.userId,
  );
  const filler = Array.from(
    { length: Math.max(0, crew.memberCount - named.length) },
    (_, index) => ({
      userId: `${crew.id}-member-${index}`,
      nickname:
        fixtures.crewNicknames[index % fixtures.crewNicknames.length] +
        (index >= fixtures.crewNicknames.length
          ? String(Math.floor(index / fixtures.crewNicknames.length) + 1)
          : ''),
    }),
  );
  return [...named, ...filler].map((member, index) => ({
    ...member,
    isOwner: index === 0,
    isMe: member.userId === fixtures.members.me.userId,
    recentPaceSecPerKm: 330 + ((index * 37) % 90),
  }));
}

// 6.1–6.3 크루 mock: join requests are kept in memory, and 6.0 reads my crews from here.
export function createCrewMock({
  respond,
  fail,
  noCrews,
}: {
  respond: Respond;
  fail: Fail;
  // 6.0b 가입한 크루 없음: no crew knows me yet.
  noCrews: boolean;
}): { repository: Repositories['crews']; mine: () => MyCrew[] } {
  const me = fixtures.members.me.userId;
  let directory: CrewState[] = fixtures.crewDirectory.map(crew => ({
    ...crew,
    myMembership: noCrews ? null : crew.myMembership,
    joinPolicy: 'APPROVAL',
  }));
  const requests = new Map(Object.entries(fixtures.crewJoinRequests));
  // Members who joined while the app runs, shown by name in 6.2 구성원.
  const joined = new Map<string, Person[]>();
  const update = (crewId: string, change: Partial<CrewState>) => {
    directory = directory.map(item =>
      item.id === crewId ? { ...item, ...change } : item,
    );
  };
  const addMember = (crewId: string, person: Person) => {
    const crew = find(crewId);
    update(crewId, { memberCount: crew.memberCount + 1 });
    joined.set(crewId, [...(joined.get(crewId) ?? []), person]);
  };
  const full = () =>
    fail(new DataError('CREW_CAPACITY_EXCEEDED', '크루 정원이 가득 찼어요'));
  const find = (crewId: string) => {
    const crew = directory.find(item => item.id === crewId);
    if (!crew) {
      throw new Error(`크루 없음: ${crewId}`);
    }
    return crew;
  };

  const repository: Repositories['crews'] = {
    search: ({ query, nearby }) => {
      const words = query.trim();
      const found = directory
        .filter(crew => !nearby || crew.distanceKm <= nearbyKm)
        .filter(
          crew =>
            !words || crew.name.includes(words) || crew.area.includes(words),
        )
        // M01: crews with room come first, full ones after; nearer first within each.
        .sort(
          (a, b) =>
            Number(a.memberCount >= a.capacity) -
              Number(b.memberCount >= b.capacity) ||
            a.distanceKm - b.distanceKm,
        )
        .map(toListItem);
      return respond(found);
    },
    get: crewId => {
      const crew = find(crewId);
      const members = membersOf(crew, joined.get(crewId) ?? []);
      const amOwner = members[0].userId === me;
      return respond({
        ...toListItem(crew),
        joinPolicy: crew.joinPolicy,
        amOwner,
        members,
        pendingRequestCount: amOwner ? requests.get(crewId)?.length ?? 0 : null,
      });
    },
    requestJoin: crewId => {
      const crew = find(crewId);
      if (crew.memberCount >= crew.capacity) {
        return full();
      }
      if (crew.joinPolicy === 'INSTANT') {
        addMember(crewId, fixtures.members.me);
        update(crewId, { myMembership: 'MEMBER' });
        return respond('MEMBER');
      }
      update(crewId, { myMembership: 'PENDING' });
      return respond('PENDING');
    },
    updateCapacity: (crewId, capacity) => {
      const crew = find(crewId);
      if (capacity < crew.memberCount || capacity > maxCapacity) {
        return fail(
          new DataError('UNKNOWN', '정원은 현재 인원부터 200명까지예요'),
        );
      }
      update(crewId, { capacity });
      return respond(undefined);
    },
    setJoinPolicy: (crewId, joinPolicy) => {
      update(crewId, { joinPolicy });
      return respond(undefined);
    },
    listJoinRequests: crewId => respond(requests.get(crewId) ?? []),
    create: draft => {
      const id = `crew-new-${directory.length + 1}`;
      directory = [
        ...directory,
        {
          id,
          name: draft.name,
          description: draft.description,
          area: draft.area,
          capacity: draft.capacity,
          memberCount: 0,
          myMembership: 'MEMBER',
          distanceKm: 0,
          joinPolicy: draft.joinPolicy,
        },
      ];
      addMember(id, fixtures.members.me);
      return respond({ id });
    },
    decideJoinRequest: (crewId, userId, approve) => {
      const crew = find(crewId);
      const request = (requests.get(crewId) ?? []).find(
        item => item.userId === userId,
      );
      if (!request) {
        return fail(new DataError('UNKNOWN', '이미 처리한 신청이에요'));
      }
      if (approve && crew.memberCount >= crew.capacity) {
        return full();
      }
      requests.set(
        crewId,
        (requests.get(crewId) ?? []).filter(item => item.userId !== userId),
      );
      if (approve) {
        addMember(crewId, request);
      }
      return respond(undefined);
    },
  };

  return {
    repository,
    mine: () =>
      directory.flatMap(crew =>
        crew.myMembership
          ? [
              {
                id: crew.id,
                name: crew.name,
                area: crew.area,
                memberCount: crew.memberCount,
                membership: crew.myMembership,
              },
            ]
          : [],
      ),
  };
}
