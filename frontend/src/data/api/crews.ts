import type {
  CrewJoinPolicy,
  CrewListItem,
  CrewMember,
  MyCrew,
  PhotoFile,
  Repositories,
} from '../types';
import { apiRequest } from './http';
import { uploadImage } from './images';
import { listItems } from './listItems';
import type { Regions } from './regions';

// M01–M12 크루 (docs/design/api/crews.md). Crews keep a region code, shown by its CMT12 name. The capacity
// and the join policy (6.2m, 6.2a) are saved on the server with M12 (S15P31E105-570).

type MembershipStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'LEFT';

type CrewResponse = {
  id: number;
  name: string;
  description: string | null;
  ownerId: number;
  capacity: number;
  regionCode: string | null;
  joinPolicy: CrewJoinPolicy;
  memberCount: number;
  myMembershipStatus: MembershipStatus | null;
};

type MemberItem = {
  userId: number;
  nickname: string | null;
  isOwner: boolean;
};

type JoinRequestItem = {
  userId: number;
  status: MembershipStatus;
  requestedAt: string;
  nickname: string | null;
};

type MyCrewItem = {
  id: number;
  name: string;
  regionCode: string | null;
  myMembershipStatus: 'APPROVED' | 'PENDING';
  memberCount: number;
};

// A withdrawn account keeps its rows but loses its nickname.
const unknownNickname = '알 수 없음';
const noArea = '지역 미정';

const membershipOf = (status: MembershipStatus | null) =>
  status === 'APPROVED' ? 'MEMBER' : status === 'PENDING' ? 'PENDING' : null;

// Only server crews have numeric ids; mock ones still come from mock group runs.
const isServerId = (crewId: string) => /^\d+$/.test(crewId);

export function createCrewsApi({
  mock,
  regions,
}: {
  mock: Repositories['crews'];
  regions: Regions;
}) {
  let me: Promise<string> | null = null;
  // Crew photo uploads embed my user id; clear with myId so the next account does not reuse them.
  const photoKeys = new Map<string, Promise<string>>();

  // U04 gives my user id, to find me among the members and the leader.
  const myId = () => {
    me ??= apiRequest<{ id: number }>('/users/me')
      .then(({ id }) => String(id))
      .catch(error => {
        me = null;
        throw error;
      });
    return me;
  };

  // Logout and session expiry must drop the cached id before the next login (S15P31E105-638).
  const clearMyId = () => {
    me = null;
    photoKeys.clear();
  };

  // 6.3 대표 사진: F01 (purpose CREW) stores it under images/crew/{userId}/{imageId}.{ext}, and M03 takes that path
  // as imageKey (files.md F01, crews.md M03). A photo already uploaded is not sent again when M03 is retried.
  const crewPhotoKey = (photo: PhotoFile) => {
    let key = photoKeys.get(photo.uri);
    if (!key) {
      key = Promise.all([uploadImage(photo, 'CREW'), myId()]).then(
        ([{ imageId }, userId]) =>
          `images/crew/${userId}/${imageId}.${
            photo.type === 'image/png' ? 'png' : 'jpg'
          }`,
      );
      photoKeys.set(photo.uri, key);
      key.catch(() => photoKeys.delete(photo.uri));
    }
    return key;
  };

  const areaOf = async (regionCode: string | null) =>
    (await regions.name(regionCode)) ?? noArea;

  async function toListItem(crew: CrewResponse): Promise<CrewListItem> {
    const id = String(crew.id);
    return {
      id,
      name: crew.name,
      description: crew.description,
      area: await areaOf(crew.regionCode),
      capacity: crew.capacity,
      memberCount: crew.memberCount,
      myMembership: membershipOf(crew.myMembershipStatus),
    };
  }

  const listJoinRequests: Repositories['crews']['listJoinRequests'] =
    async crewId => {
      if (!isServerId(crewId)) {
        return mock.listJoinRequests(crewId);
      }
      const items = listItems(
        await apiRequest<{ items: JoinRequestItem[] }>(
          `/crews/${crewId}/join-requests`,
        ),
      );
      // M05 has only the nickname; level, pace and the first-crew mark are not shared.
      return items.map(item => ({
        userId: String(item.userId),
        nickname: item.nickname ?? unknownNickname,
        loginId: null,
        level: null,
        recent5kPaceSecPerKm: null,
        firstCrew: false,
        requestedAt: item.requestedAt,
      }));
    };

  const crews: Repositories['crews'] = {
    // M01 has no location filter, so 내 근처 lists the same crews.
    search: async ({ query }) => {
      const items = listItems(
        await apiRequest<{ items: CrewResponse[] }>('/crews', {
          query: { q: query.trim() || undefined },
        }),
      );
      return Promise.all(items.map(toListItem));
    },
    get: async crewId => {
      if (!isServerId(crewId)) {
        return mock.get(crewId);
      }
      const [crew, membersPage, myUserId] = await Promise.all([
        apiRequest<CrewResponse>(`/crews/${crewId}`),
        apiRequest<{ items: MemberItem[] }>(`/crews/${crewId}/members`),
        myId(),
      ]);
      const amOwner = String(crew.ownerId) === myUserId;
      const members: CrewMember[] = [...listItems(membersPage)]
        .sort((a, b) => Number(b.isOwner) - Number(a.isOwner))
        .map(member => ({
          userId: String(member.userId),
          nickname: member.nickname ?? unknownNickname,
          isOwner: member.isOwner,
          isMe: String(member.userId) === myUserId,
          // The server keeps no member pace yet.
          recentPaceSecPerKm: null,
        }));
      return {
        ...(await toListItem(crew)),
        joinPolicy: crew.joinPolicy,
        amOwner,
        members,
        pendingRequestCount: amOwner
          ? (await listJoinRequests(crewId)).length
          : null,
      };
    },
    // M04 waits for the leader, or makes me a member at once in a 바로 가입 crew.
    requestJoin: async crewId => {
      if (!isServerId(crewId)) {
        return mock.requestJoin(crewId);
      }
      const { status } = await apiRequest<{ status: MembershipStatus }>(
        `/crews/${crewId}/join-requests`,
        { method: 'POST' },
      );
      return membershipOf(status) ?? 'PENDING';
    },
    updateCapacity: async (crewId, capacity) => {
      if (!isServerId(crewId)) {
        return mock.updateCapacity(crewId, capacity);
      }
      // M12: the server checks the 1–200 range and the current member count (CREW_CAPACITY_BELOW_MEMBERS).
      await apiRequest(`/crews/${crewId}`, {
        method: 'PATCH',
        body: { capacity },
      });
    },
    setJoinPolicy: async (crewId, policy) => {
      if (!isServerId(crewId)) {
        return mock.setJoinPolicy(crewId, policy);
      }
      await apiRequest(`/crews/${crewId}`, {
        method: 'PATCH',
        body: { joinPolicy: policy },
      });
    },
    listJoinRequests,
    // M03 keeps the region the picked place is in; the place name itself is not stored.
    create: async draft => {
      const imageKey = draft.photo ? await crewPhotoKey(draft.photo) : null;
      const { id } = await apiRequest<{ id: number }>('/crews', {
        method: 'POST',
        body: {
          name: draft.name,
          description: draft.description,
          capacity: draft.capacity,
          regionCode: (await regions.codeOf(draft.address)) ?? undefined,
          joinPolicy: draft.joinPolicy,
          ...(imageKey ? { imageKey } : {}),
        },
      });
      return { id: String(id) };
    },
    leave: async (crewId, successorUserId) => {
      if (!isServerId(crewId)) return mock.leave(crewId, successorUserId);
      await apiRequest(`/crews/${crewId}/members/me`, {
        method: 'DELETE',
        body:
          successorUserId === undefined
            ? undefined
            : { successorUserId: Number(successorUserId) },
      });
    },
    dissolve: async crewId => {
      if (!isServerId(crewId)) return mock.dissolve(crewId);
      await apiRequest(`/crews/${crewId}`, { method: 'DELETE' });
    },
    removeMember: async (crewId, userId) => {
      if (!isServerId(crewId)) return mock.removeMember(crewId, userId);
      await apiRequest(
        `/crews/${crewId}/members/${encodeURIComponent(userId)}`,
        {
          method: 'DELETE',
        },
      );
    },
    decideJoinRequest: async (crewId, userId, approve) => {
      if (!isServerId(crewId)) {
        return mock.decideJoinRequest(crewId, userId, approve);
      }
      await apiRequest(`/crews/${crewId}/join-requests/${userId}`, {
        method: 'PATCH',
        body: { status: approve ? 'APPROVED' : 'REJECTED' },
      });
    },
  };

  // M10 내 크루 for 6.0: members first, then requests still waiting.
  const listMine = async (): Promise<MyCrew[]> => {
    const items = listItems(
      await apiRequest<{ items: MyCrewItem[] }>('/users/me/crews'),
    );
    const mine = await Promise.all(
      items.map(
        async (item): Promise<MyCrew> => ({
          id: String(item.id),
          name: item.name,
          area: await areaOf(item.regionCode),
          memberCount: item.memberCount,
          membership:
            item.myMembershipStatus === 'APPROVED' ? 'MEMBER' : 'PENDING',
        }),
      ),
    );
    return mine.sort(
      (a, b) =>
        Number(a.membership === 'PENDING') - Number(b.membership === 'PENDING'),
    );
  };

  return { crews, listMine, myId, clearMyId };
}
