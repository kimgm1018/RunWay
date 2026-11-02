import { DataError } from '../errors';
import type {
  GroupRunDetail,
  GroupRunDraft,
  GroupRunParticipant,
  GroupRunSummary,
  MyCrew,
  Repositories,
  WaitingRoom,
} from '../types';
import { apiRequest } from './http';

// G01–G07·G16 그룹런 (docs/design/api/group-runs.md). Starting, the live view, cancelling and results have no API
// yet (S15P31E105-261), so a server run stops at the waiting room; the meeting place search stays on mock data.

type Point = { type: 'Point'; coordinates: [number, number] };

type ListItem = { id: number; status: GroupRunSummary['status'] };

type DetailResponse = {
  id: number;
  title: string;
  description: string | null;
  hostId: number;
  crewId: number;
  courseId: number | null;
  scheduledAt: string;
  meetingPosition: Point;
  participantCount: number;
  status: GroupRunSummary['status'];
  targetDistanceM: number | null;
  targetDurationSec: number | null;
  meetingPlaceName: string;
  meetingAddress: string | null;
  goalPaceSecPerKm: number | null;
};

type ParticipantItem = {
  userId: number;
  nickname: string | null;
  isHost: boolean;
  readyStatus: 'READY' | 'WAITING';
};

type CourseResponse = {
  myAlias: string | null;
  distanceM: number;
  route: { coordinates: [number, number][] };
};

const pageLimit = 50;
const kstOffsetMs = 9 * 3600 * 1000;
// The 6.0 pin: a run I joined that starts within a day, or is under way.
const upcomingWindowMs = 24 * 3600 * 1000;
// The comfortable spread around the shared pace on 6.5 (participant 편한 범위), as in the mock.
const comfortSpreadSec = 20;
const defaultPaceSecPerKm = 360;
const unknownNickname = '알 수 없음';

const isServerId = (id: string) => /^\d+$/.test(id);

const notYet = () =>
  Promise.reject(
    new DataError('UNKNOWN', '그룹런 시작 이후 기능은 준비 중이에요'),
  );

// G01 needs a title and 6.8 has none, so it reads like the prototype's: ‘토요일, 함께 5km’. A free run's
// minutes live only here, as the server keeps no goal without a distance.
function titleOf(draft: GroupRunDraft) {
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][
    new Date(Date.parse(draft.scheduledAt) + kstOffsetMs).getUTCDay()
  ];
  const goal = draft.targetDistanceM
    ? `${Math.round(draft.targetDistanceM / 1000)}km`
    : draft.targetDurationSec
    ? `${Math.round(draft.targetDurationSec / 60)}분`
    : '달려요';
  return `${weekday}요일, 함께 ${goal}`;
}

// The run's place, time and course for G01/G04. Goals are left out: the server wants a distance with every
// goal, so a free run's time cannot be kept and a course run reads its distance from the course.
const placeAndTime = (draft: Omit<GroupRunDraft, 'crewId'>) => ({
  courseId: draft.courseId === null ? null : Number(draft.courseId),
  scheduledAt: new Date(draft.scheduledAt).toISOString(),
  meetingPosition: { type: 'Point', coordinates: draft.meetingPosition },
  meetingPlaceName: draft.meetingPlaceName,
  meetingAddress: draft.meetingAddress,
  // 찾아오는 법 goes in the run's description.
  description: draft.meetingNote,
});

export function createGroupRunsApi({
  mock,
  crews,
  myCrews,
  myId,
  usualPace,
}: {
  mock: Repositories['groupRuns'];
  crews: Repositories['crews'];
  myCrews: () => Promise<MyCrew[]>;
  myId: () => Promise<string>;
  usualPace: () => Promise<number | null>;
}) {
  // 6.4 shows a course by my alias or its length; C03 has no name.
  async function courseOf(courseId: number | null) {
    if (courseId === null) {
      return null;
    }
    const course = await apiRequest<CourseResponse>(`/courses/${courseId}`);
    return {
      name: course.myAlias ?? `${(course.distanceM / 1000).toFixed(1)}km 코스`,
      distanceM: course.distanceM,
      route: course.route.coordinates,
    };
  }

  // G03 with G07: who is in, who leads and whether I joined.
  async function load(groupRunId: string) {
    const [run, { items }, me] = await Promise.all([
      apiRequest<DetailResponse>(`/group-runs/${groupRunId}`),
      apiRequest<{ items: ParticipantItem[] }>(
        `/group-runs/${groupRunId}/participants`,
      ),
      myId(),
    ]);
    const participants: GroupRunParticipant[] = [...items]
      .sort((a, b) => Number(b.isHost) - Number(a.isHost))
      .map(item => ({
        userId: String(item.userId),
        nickname: item.nickname ?? unknownNickname,
        isHost: item.isHost,
        isMe: String(item.userId) === me,
        readyStatus: item.readyStatus,
        // Other members' readiness is not shared, and mine has no server source yet.
        readinessScore: null,
      }));
    return { run, participants, me };
  }

  async function summaryOf(
    loaded: Awaited<ReturnType<typeof load>>,
    crewName: string,
    course: Awaited<ReturnType<typeof courseOf>>,
  ): Promise<GroupRunSummary> {
    const { run, participants, me } = loaded;
    return {
      id: String(run.id),
      crewId: String(run.crewId),
      crewName,
      title: run.title,
      hostId: String(run.hostId),
      hostNickname:
        participants.find(member => member.isHost)?.nickname ?? unknownNickname,
      isHost: String(run.hostId) === me,
      scheduledAt: run.scheduledAt,
      meetingPlaceName: run.meetingPlaceName,
      meetingAddress: run.meetingAddress ?? '',
      courseId: run.courseId === null ? null : String(run.courseId),
      courseName: course?.name ?? null,
      targetDistanceM: run.targetDistanceM ?? course?.distanceM ?? null,
      targetDurationSec: run.targetDurationSec,
      participantCount: run.participantCount,
      joined: participants.some(member => member.isMe),
      status: run.status,
    };
  }

  const goalPace = async (run: DetailResponse) =>
    run.goalPaceSecPerKm ?? (await usualPace()) ?? defaultPaceSecPerKm;

  async function waitingRoom(groupRunId: string): Promise<WaitingRoom> {
    const { run, participants } = await load(groupRunId);
    const [pace, course] = await Promise.all([
      goalPace(run),
      courseOf(run.courseId),
    ]);
    const distanceM = run.targetDistanceM ?? course?.distanceM ?? null;
    return {
      groupRunId,
      goalPaceSecPerKm: pace,
      comfortRange: [pace - comfortSpreadSec, pace + comfortSpreadSec],
      expectedDurationSec: distanceM
        ? Math.round((distanceM / 1000) * pace)
        : run.targetDurationSec ?? 0,
      appliedCount: participants.length,
      // The server keeps no 입장 state, so everyone who joined is in the room.
      participants,
    };
  }

  const groupRuns: Repositories['groupRuns'] = {
    ...mock,
    // 6.0: my crews (M10) with their open runs (G02), each filled from G03·G07.
    listMine: async () => {
      const mine = await myCrews();
      if (mine.length === 0) {
        const open = (await crews.search({ query: '', nearby: true })).filter(
          crew =>
            crew.myMembership === null && crew.memberCount < crew.capacity,
        );
        return {
          upcoming: null,
          crews: [],
          nearbyRecruiting: {
            count: open.length,
            areas: [...new Set(open.map(crew => crew.area))].slice(0, 3),
          },
        };
      }
      const names = new Map(mine.map(crew => [crew.id, crew.name]));
      const lists = await Promise.all(
        mine.map(async crew => {
          if (crew.membership !== 'MEMBER') {
            return { crew, groupRuns: [] };
          }
          const { items } = await apiRequest<{ items: ListItem[] }>(
            '/group-runs',
            { query: { crewId: crew.id, limit: pageLimit } },
          );
          const runs = await Promise.all(
            items
              .filter(
                item =>
                  item.status === 'SCHEDULED' || item.status === 'RUNNING',
              )
              .map(async item => {
                const loaded = await load(String(item.id));
                const course = await courseOf(loaded.run.courseId);
                return summaryOf(
                  loaded,
                  names.get(crew.id) ?? crew.name,
                  course,
                );
              }),
          );
          return {
            crew,
            groupRuns: runs.sort(
              (a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt),
            ),
          };
        }),
      );
      const now = Date.now();
      const upcoming =
        lists
          .flatMap(item => item.groupRuns)
          .filter(
            run =>
              run.joined &&
              (run.status === 'RUNNING' ||
                Date.parse(run.scheduledAt) - now <= upcomingWindowMs),
          )
          .sort(
            (a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt),
          )[0] ?? null;
      return {
        upcoming,
        crews: lists,
        nearbyRecruiting: { count: 0, areas: [] },
      };
    },
    get: async groupRunId => {
      if (!isServerId(groupRunId)) {
        return mock.get(groupRunId);
      }
      const loaded = await load(groupRunId);
      const [crew, course, pace] = await Promise.all([
        crews.get(String(loaded.run.crewId)),
        courseOf(loaded.run.courseId),
        goalPace(loaded.run),
      ]);
      const detail: GroupRunDetail = {
        ...(await summaryOf(loaded, crew.name, course)),
        route: course?.route ?? null,
        meetingPosition: loaded.run.meetingPosition.coordinates,
        goalPaceSecPerKm: pace,
        crewMemberCount: crew.memberCount,
        participants: loaded.participants,
        // My recent pace and readiness for 내 페이스와 잘 맞아요 have no server source yet.
        myFit: null,
        // G13 취소 has no API, so a server run is never shown as cancelled with a reason.
        cancellation: null,
      };
      return detail;
    },
    join: async groupRunId => {
      if (!isServerId(groupRunId)) {
        return mock.join(groupRunId);
      }
      await apiRequest(`/group-runs/${groupRunId}/join`, { method: 'POST' });
    },
    leave: async groupRunId => {
      if (!isServerId(groupRunId)) {
        return mock.leave(groupRunId);
      }
      await apiRequest(`/group-runs/${groupRunId}/participants/me`, {
        method: 'DELETE',
      });
    },
    create: async draft => {
      const { id } = await apiRequest<{ id: number }>('/group-runs', {
        method: 'POST',
        body: {
          ...placeAndTime(draft),
          crewId: Number(draft.crewId),
          title: titleOf(draft),
        },
      });
      return { id: String(id) };
    },
    update: async (groupRunId, draft) => {
      if (!isServerId(groupRunId)) {
        return mock.update(groupRunId, draft);
      }
      await apiRequest(`/group-runs/${groupRunId}`, {
        method: 'PATCH',
        // 6.8 does not show the saved 찾아오는 법, so an empty note leaves it as it is.
        body: {
          ...placeAndTime(draft),
          description: draft.meetingNote ?? undefined,
        },
      });
    },
    getWaitingRoom: groupRunId =>
      isServerId(groupRunId)
        ? waitingRoom(groupRunId)
        : mock.getWaitingRoom(groupRunId),
    // G16 records my readiness; the room is read again for everyone's.
    setReady: async (groupRunId, ready) => {
      if (!isServerId(groupRunId)) {
        return mock.setReady(groupRunId, ready);
      }
      await apiRequest(`/group-runs/${groupRunId}/participants/me/ready`, {
        method: 'POST',
        body: { ready },
      });
      return waitingRoom(groupRunId);
    },
    cancel: (groupRunId, reason) =>
      isServerId(groupRunId) ? notYet() : mock.cancel(groupRunId, reason),
    // No G09 start yet: a server run waits in the room until the start API lands.
    watchStart: (groupRunId, onStart) =>
      isServerId(groupRunId) ? () => {} : mock.watchStart(groupRunId, onStart),
    watchLive: (groupRunId, onUpdate) =>
      isServerId(groupRunId) ? () => {} : mock.watchLive(groupRunId, onUpdate),
    forceFinish: groupRunId =>
      isServerId(groupRunId) ? notYet() : mock.forceFinish(groupRunId),
    getResult: groupRunId =>
      isServerId(groupRunId) ? notYet() : mock.getResult(groupRunId),
  };
  return groupRuns;
}
