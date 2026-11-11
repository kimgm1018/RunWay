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
}): {
  repository: Repositories['crews'];
  mine: () => MyCrew[];
  owned: () => string[];
} {
  const me = fixtures.members.me.userId;
  let directory: CrewState[] = fixtures.crewDirectory.map(crew => ({
    ...crew,
    myMembership: noCrews ? null : crew.myMembership,
    joinPolicy: 'APPROVAL',
  }));
  const requests = new Map(Object.entries(fixtures.crewJoinRequests));
  // 해산한 크루는 기록을 남기되 검색·내 크루에서 제외한다.
  const inactive = new Set<string>();
  // Members who joined while the app runs, shown by name in 6.2 구성원.
  const joined = new Map<string, Person[]>();
  // 구성원을 한 번 생성해 보관한다. 내보낸 가상 멤버가 재조회 때 다시 생기지 않게 한다.
  const rosters = new Map<string, CrewMember[]>();
  const rosterOf = (crew: CrewState) => {
    if (!rosters.has(crew.id))
      rosters.set(crew.id, membersOf(crew, joined.get(crew.id) ?? []));
    return rosters.get(crew.id)!;
  };
  const update = (crewId: string, change: Partial<CrewState>) => {
    directory = directory.map(item =>
      item.id === crewId ? { ...item, ...change } : item,
    );
  };
  const addMember = (crewId: string, person: Person) => {
    const crew = find(crewId);
    const roster = rosterOf(crew);
    rosters.set(crewId, [
      ...roster,
      {
        ...person,
        isOwner: roster.length === 0,
        isMe: person.userId === me,
        recentPaceSecPerKm: 330 + ((roster.length * 37) % 90),
      },
    ]);
    update(crewId, { memberCount: crew.memberCount + 1 });
    joined.set(crewId, [...(joined.get(crewId) ?? []), person]);
  };
  const full = () =>
    fail(new DataError('CREW_CAPACITY_EXCEEDED', '크루 정원이 가득 찼어요'));
  const find = (crewId: string) => {
    const crew = directory.find(item => item.id === crewId);
    if (!crew || inactive.has(crewId)) {
      throw new DataError('CREW_NOT_FOUND', '크루를 찾지 못했어요');
    }
    return crew;
  };

  const repository: Repositories['crews'] = {
    search: ({ query, nearby }) => {
      const words = query.trim();
      const found = directory
        .filter(crew => !inactive.has(crew.id))
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
      const members = rosterOf(crew);
      const amOwner = members[0]?.userId === me;
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
    cancelJoinRequest: crewId => {
      const crew = find(crewId);
      if (crew.myMembership !== 'PENDING') {
        return fail(
          new DataError('NOT_PENDING', '대기 중인 가입 신청이 없어요'),
        );
      }
      update(crewId, { myMembership: null });
      return respond(undefined);
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
    leave: (crewId, successorUserId) => {
      const crew = find(crewId);
      const members = rosterOf(crew);
      const own = members.find(member => member.isMe);
      if (!own)
        return fail(new DataError('MEMBER_NOT_FOUND', '크루 멤버가 아니에요'));
      if (own.isOwner) {
        if (members.length < 2 || successorUserId === undefined)
          return fail(
            new DataError(
              'OWNER_CANNOT_LEAVE',
              '후임 지정 또는 해산이 필요해요',
            ),
          );
        const successor = members.find(
          member => member.userId === successorUserId && !member.isMe,
        );
        if (!successor)
          return fail(
            new DataError(
              'INVALID_SUCCESSOR',
              '다른 크루 멤버를 선택해 주세요',
            ),
          );
        rosters.set(
          crewId,
          members
            .map(member => ({
              ...member,
              isOwner: member.userId === successorUserId,
            }))
            .sort((a, b) => Number(b.isOwner) - Number(a.isOwner)),
        );
      } else if (successorUserId !== undefined) {
        return fail(
          new DataError(
            'VALIDATION_ERROR',
            '일반 멤버는 후임을 지정할 수 없어요',
          ),
        );
      }
      rosters.set(
        crewId,
        rosterOf(crew).filter(person => person.userId !== me),
      );
      update(crewId, {
        myMembership: null,
        memberCount: Math.max(0, crew.memberCount - 1),
      });
      joined.set(
        crewId,
        (joined.get(crewId) ?? []).filter(person => person.userId !== me),
      );
      return respond(undefined);
    },
    dissolve: crewId => {
      const crew = directory.find(item => item.id === crewId);
      if (!crew)
        return fail(new DataError('CREW_NOT_FOUND', '크루를 찾지 못했어요'));
      if (!rosterOf(crew).some(member => member.isMe && member.isOwner))
        return fail(new DataError('NOT_ADMIN', '크루장만 해산할 수 있어요'));
      if (inactive.has(crewId)) return respond(undefined);
      inactive.add(crewId);
      requests.set(crewId, []);
      update(crewId, { myMembership: null, memberCount: 0 });
      return respond(undefined);
    },
    removeMember: (crewId, userId) => {
      const crew = find(crewId);
      const members = rosterOf(crew);
      if (!members.some(member => member.isMe && member.isOwner))
        return fail(
          new DataError('NOT_ADMIN', '크루장만 멤버를 내보낼 수 있어요'),
        );
      const target = members.find(member => member.userId === userId);
      if (!target)
        return fail(
          new DataError('MEMBER_NOT_FOUND', '크루 멤버를 찾지 못했어요'),
        );
      if (target.isOwner)
        return fail(
          new DataError('CANNOT_REMOVE_OWNER', '크루장은 내보낼 수 없어요'),
        );
      rosters.set(
        crewId,
        members.filter(member => member.userId !== userId),
      );
      joined.set(
        crewId,
        (joined.get(crewId) ?? []).filter(member => member.userId !== userId),
      );
      update(crewId, { memberCount: Math.max(0, crew.memberCount - 1) });
      return respond(undefined);
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
    // 8.4: the crews I lead.
    owned: () =>
      directory
        .filter(
          crew => !inactive.has(crew.id) && rosterOf(crew)[0]?.userId === me,
        )
        .map(crew => crew.name),
    mine: () =>
      directory.flatMap(crew =>
        crew.myMembership && !inactive.has(crew.id)
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
