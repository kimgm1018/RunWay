import { DataError } from '../errors';
import type {
  GroupPaceInfo,
  GroupPaceMode,
  GroupRunDetail,
  GroupRunDraft,
  GroupRunLive,
  GroupRunResult,
  GroupRunParticipant,
  GroupRunSummary,
  MyCrew,
  MyGroupRuns,
  Repositories,
  WaitingRoom,
} from '../types';
import { apiRequest } from './http';
import { imageAddress } from './images';
import { listItems } from './listItems';
import { searchPlaces } from './places';

// 그룹런 서버 API와 PLS01 장소 검색. 실제 기기 제어·결과 보고는 별도 연동에서 담당한다.

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
  groupGuidePaceSecPerKm?: number | null;
  comfortRange?: { fastSecPerKm: number; slowSecPerKm: number } | null;
  myFit?: GroupRunDetail['myFit'];
  cancellation?: GroupRunDetail['cancellation'];
  // S15P31E105-680. Absent while group pace is off.
  groupPaceMode?: GroupPaceMode | null;
  aiRecommendedPaceSecPerKm?: number | null;
  paceBasis?: { type: GroupPaceInfo['basis']; nickname: string | null } | null;
  paceCalculating?: boolean | null;
  slowerThanGoalCount?: number | null;
};

// G03 → 공동 페이스 카드. null while the server does not send the mode (feature off).
export function paceInfoOf(run: DetailResponse): GroupPaceInfo | null {
  if (!run.groupPaceMode) {
    return null;
  }
  return {
    mode: run.groupPaceMode,
    appliedSecPerKm: run.groupGuidePaceSecPerKm ?? null,
    aiSecPerKm: run.aiRecommendedPaceSecPerKm ?? null,
    goalSecPerKm: run.goalPaceSecPerKm ?? null,
    basis: run.paceBasis?.type ?? 'MEDIAN',
    basisNickname: run.paceBasis?.nickname ?? null,
    calculating: run.paceCalculating === true,
    slowerThanGoalCount: run.slowerThanGoalCount ?? null,
  };
}

type ParticipantItem = {
  userId: number;
  sessionId?: number | null;
  nickname: string | null;
  isHost: boolean;
  readyStatus: 'READY' | 'WAITING';
  readinessScore?: number | null;
  // F02 path of the participant's photo, null without one (S15P31E105-636).
  profileImageUrl?: string | null;
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
const defaultPaceSecPerKm = 360;
const unknownNickname = '알 수 없음';

const isServerId = (id: string) => /^\d+$/.test(id);

type LiveResponse = {
  status: GroupRunSummary['status'];
  groupGuidePaceSecPerKm: number | null;
  updatedAt?: string | null;
  loadAlert?: GroupRunLive['loadAlert'];
  participants: {
    userId: number;
    rank: number | null;
    aheadCount?: number | null;
    behindCount?: number | null;
    paceSecPerKm?: number | null;
    progressM: number | null;
    stale: boolean;
    gapToAheadM: number | null;
    gapToBehindM: number | null;
  }[];
};
type ResultsResponse = {
  distanceM?: number | null;
  averagePaceSecPerKm?: number | null;
  maxGapM?: number | null;
  targetDistanceM: number | null;
  analysis: { status: string };
  hasUnconfirmedStarts: boolean;
  participants: {
    userId: number;
    state: string | null;
    startResult: string | null;
    actualDistanceM: number | null;
    movingDurationSec: number | null;
    averagePaceSecPerKm: number | null;
    goalAchieved: boolean | null;
  }[];
};

// 이전 조회가 끝난 뒤 예약해 느린 응답·503에서도 요청이 겹치지 않게 한다.
function poll<T>(
  read: () => Promise<T>,
  deliver: (value: T) => boolean | void,
  onError?: (error: unknown) => void,
) {
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const update = async () => {
    let delay = 3000;
    try {
      const value = await read();
      if (active && deliver(value) === false) active = false;
    } catch (error) {
      if (active) onError?.(error);
      if (
        error instanceof DataError &&
        [401, 403, 404, 409].includes(error.status ?? 0)
      )
        active = false;
      delay = 10000;
    }
    if (active) timer = setTimeout(update, delay);
  };
  void update();
  return () => {
    active = false;
    if (timer) clearTimeout(timer);
  };
}

// G01 needs a title and 6.8 has none, so it reads like the prototype's: ‘토요일, 함께 5km’. A free run's
// minutes live only here, as the server keeps no goal without a distance (S15P31E105-637: update도 동일).
function titleOf(draft: Omit<GroupRunDraft, 'crewId'> | GroupRunDraft) {
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

// The run's goal for G01/G04. The server wants a distance with every goal, so only a course run sends one:
// TIME with the course distance sent explicitly, as G04 would otherwise keep the old goal's distance.
// A free run sends none; G04 rejects null goal fields, so a run made free keeps its saved goal.
function goalOf(draft: Omit<GroupRunDraft, 'crewId'>) {
  const distanceM = Math.round(draft.targetDistanceM ?? 0);
  const durationSec = Math.round(draft.targetDurationSec ?? 0);
  return draft.courseId !== null && distanceM > 0 && durationSec > 0
    ? {
        goalInputType: 'TIME' as const,
        targetDistanceM: distanceM,
        targetDurationSec: durationSec,
      }
    : {};
}

// The run's place, time, course and goal for G01/G04.
const placeAndTime = (draft: Omit<GroupRunDraft, 'crewId'>) => ({
  courseId: draft.courseId === null ? null : Number(draft.courseId),
  scheduledAt: new Date(draft.scheduledAt).toISOString(),
  meetingPosition: { type: 'Point', coordinates: draft.meetingPosition },
  meetingPlaceName: draft.meetingPlaceName,
  meetingAddress: draft.meetingAddress,
  // 찾아오는 법 goes in the run's description.
  description: draft.meetingNote,
  ...goalOf(draft),
});

// G07 본인 항목의 세션 ID(내 그룹런 기록). 없으면 null.
function mySessionIdOf(loaded: { items: ParticipantItem[]; me: string }) {
  const sessionId = loaded.items.find(item => String(item.userId) === loaded.me)?.sessionId;
  return sessionId == null ? null : String(sessionId);
}

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
    const [run, roster, me] = await Promise.all([
      apiRequest<DetailResponse>(`/group-runs/${groupRunId}`),
      apiRequest<{
        items: ParticipantItem[];
        participantCount?: number;
        readyCount?: number;
      }>(`/group-runs/${groupRunId}/participants`),
      myId(),
    ]);
    const items = roster.items;
    const participants: GroupRunParticipant[] = [...items]
      .sort((a, b) => Number(b.isHost) - Number(a.isHost))
      .map(item => ({
        userId: String(item.userId),
        nickname: item.nickname ?? unknownNickname,
        isHost: item.isHost,
        isMe: String(item.userId) === me,
        readyStatus: item.readyStatus,
        // 준비도는 기존 화면에서 본인 값만 표시한다.
        readinessScore: item.readinessScore ?? null,
        profileImageUrl: imageAddress(item.profileImageUrl),
      }));
    const participantCount = roster.participantCount ?? items.length;
    const readyCount =
      roster.readyCount ??
      participants.filter(member => member.readyStatus === 'READY').length;
    return { run, participants, me, items, participantCount, readyCount };
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
    const { run, participants, participantCount, readyCount, items, me } =
      await load(groupRunId);
    const mine = items.find(item => String(item.userId) === me);
    const [pace, course] = await Promise.all([
      goalPace(run),
      courseOf(run.courseId),
    ]);
    const distanceM = run.targetDistanceM ?? course?.distanceM ?? null;
    return {
      groupRunId,
      goalPaceSecPerKm: pace,
      recommendedPaceSecPerKm: run.groupGuidePaceSecPerKm ?? null,
      comfortRange: run.comfortRange
        ? [run.comfortRange.fastSecPerKm, run.comfortRange.slowSecPerKm]
        : null,
      expectedDurationSec: distanceM
        ? Math.round((distanceM / 1000) * pace)
        : run.targetDurationSec ?? 0,
      // presence 없음: 참가 신청·대기방 인원 모두 G07 participantCount.
      appliedCount: participantCount,
      participantCount,
      readyCount,
      participants,
      // G16이 만든 내 READY 세션. 워치 준비와 그룹 출발 중계에 쓴다(S15P31E105-420).
      mySessionId:
        mine?.readyStatus === 'READY' && mine.sessionId != null
          ? String(mine.sessionId)
          : null,
    };
  }

  const groupRuns: Repositories['groupRuns'] = {
    ...mock,
    searchPlaces,
    // 6.0: my crews (M10) with their open runs (G02), each filled from G03·G07.
    listMine: async () => {
      const mine = await myCrews();
      if (mine.length === 0) {
        // 6.0b empty guidance must still open when I have no crews. Nearby recruiting
        // is only a hint — a failed /crews search must not look like a load error
        // (S15P31E105-571 with S15P31E105-588 empty-list behavior).
        let nearbyRecruiting: MyGroupRuns['nearbyRecruiting'] = {
          count: 0,
          areas: [],
        };
        try {
          const open = (
            await crews.search({ query: '', nearby: true })
          ).filter(
            crew =>
              crew.myMembership === null && crew.memberCount < crew.capacity,
          );
          nearbyRecruiting = {
            count: open.length,
            areas: [...new Set(open.map(crew => crew.area))].slice(0, 3),
          };
        } catch {
          // Keep zeros; NoCrews still shows the existing empty copy.
        }
        return {
          upcoming: null,
          crews: [],
          nearbyRecruiting,
        };
      }
      const names = new Map(mine.map(crew => [crew.id, crew.name]));
      // One crew or run detail failing must not blank the whole 6.0 tab
      // (S15P31E105-637). G02 pages follow nextCursor until exhausted.
      const crewOutcomes = await Promise.allSettled(
        mine.map(async crew => {
          if (crew.membership !== 'MEMBER') {
            return { crew, groupRuns: [] as GroupRunSummary[] };
          }
          const items: ListItem[] = [];
          let cursor: string | undefined;
          do {
            const page = await apiRequest<{
              items?: ListItem[] | null;
              nextCursor?: string | null;
            }>('/group-runs', {
              query: { crewId: crew.id, limit: pageLimit, cursor },
            });
            items.push(...listItems(page));
            cursor = page.nextCursor ?? undefined;
          } while (cursor);
          const runOutcomes = await Promise.allSettled(
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
          const runs = runOutcomes
            .flatMap(result =>
              result.status === 'fulfilled' ? [result.value] : [],
            )
            .sort(
              (a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt),
            );
          return { crew, groupRuns: runs };
        }),
      );
      const lists = mine.map((crew, index) => {
        const outcome = crewOutcomes[index];
        return outcome.status === 'fulfilled'
          ? outcome.value
          : { crew, groupRuns: [] };
      });
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
        myFit: loaded.run.myFit ?? null,
        cancellation: loaded.run.cancellation ?? null,
        pace: paceInfoOf(loaded.run),
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
        // Free-run minutes are title-only (no duration goal without distance); refresh title on edit.
        body: {
          ...placeAndTime(draft),
          title: titleOf(draft),
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
    start: async groupRunId => {
      if (!isServerId(groupRunId)) return mock.start(groupRunId);
      // G09는 본문을 허용하지 않는다. 응답의 PENDING을 실제 출발로 간주하지 않는다.
      await apiRequest(`/group-runs/${groupRunId}/start`, { method: 'POST' });
    },
    setPaceMode: async (groupRunId, mode) => {
      if (!isServerId(groupRunId)) {
        return mock.setPaceMode?.(groupRunId, mode);
      }
      await apiRequest(`/group-runs/${groupRunId}/pace-mode`, {
        method: 'PUT',
        body: { paceMode: mode },
      });
    },
    cancel: async (groupRunId, reason, message) => {
      if (!isServerId(groupRunId))
        return mock.cancel(groupRunId, reason, message);
      // A blank note is left out, so the server sends its default notification text.
      const cancelMessage = message?.trim();
      await apiRequest(`/group-runs/${groupRunId}/cancel`, {
        method: 'POST',
        body: cancelMessage
          ? { cancelReason: reason, cancelMessage }
          : { cancelReason: reason },
      });
    },
    watchStart: (groupRunId, onStart, onError, onParticipants) => {
      if (!isServerId(groupRunId))
        return mock.watchStart(groupRunId, onStart, onError, onParticipants);
      return poll(
        async () => {
          const loaded = await load(groupRunId);
          const own = loaded.items.find(
            item => String(item.userId) === loaded.me,
          );
          // Keep CANCELLED and COMPLETED copy separate: callers used to show one mixed 409 line.
          if (loaded.run.status === 'CANCELLED') {
            throw new DataError(
              'INVALID_GROUP_STATE',
              '그룹런이 취소되었어요. 상세에서 확인해 주세요.',
              null,
              409,
            );
          }
          if (loaded.run.status === 'COMPLETED') {
            throw new DataError(
              'INVALID_GROUP_STATE',
              '그룹런이 종료되었어요. 상세에서 확인해 주세요.',
              null,
              409,
            );
          }
          const session =
            loaded.run.status === 'RUNNING' &&
            own?.readyStatus === 'READY' &&
            own.sessionId != null
              ? await apiRequest<{ state: string; startedAt: string | null }>(
                  `/running-sessions/${own.sessionId}`,
                )
              : null;
          return { loaded, session };
        },
        ({ loaded, session }) => {
          onParticipants?.(
            loaded.participants,
            loaded.run.groupGuidePaceSecPerKm ?? null,
            loaded.run.comfortRange
              ? [
                  loaded.run.comfortRange.fastSecPerKm,
                  loaded.run.comfortRange.slowSecPerKm,
                ]
              : null,
            {
              participantCount: loaded.participantCount,
              readyCount: loaded.readyCount,
            },
          );
          if (
            session?.startedAt &&
            ['RUNNING', 'PAUSED'].includes(session.state)
          ) {
            onStart(session.startedAt);
            return false;
          }
        },
        onError,
      );
    },
    watchLive: (groupRunId, onUpdate, onError) => {
      if (!isServerId(groupRunId))
        return mock.watchLive(groupRunId, onUpdate, onError);
      return poll(
        async () => {
          const [value, loaded] = await Promise.all([
            apiRequest<LiveResponse>(`/group-runs/${groupRunId}/live`),
            load(groupRunId),
          ]);
          const own = value.participants.find(
            item => String(item.userId) === loaded.me,
          );
          const usable = (item: LiveResponse['participants'][number]) =>
            !item.stale &&
            item.rank != null &&
            item.progressM != null &&
            Number.isFinite(item.progressM);
          const positions = value.participants
            .filter(usable)
            .map(item => item.progressM!);
          const live: GroupRunLive = {
            members: value.participants.map(item => ({
              userId: String(item.userId),
              nickname:
                loaded.participants.find(
                  member => member.userId === String(item.userId),
                )?.nickname ?? unknownNickname,
              // 그룹장 폰만 간격 벌어짐 알림을 보낸다(S15P31E105-629).
              isHost:
                loaded.participants.find(
                  member => member.userId === String(item.userId),
                )?.isHost === true,
              isMe: String(item.userId) === loaded.me,
              gapM:
                own && usable(own) && usable(item)
                  ? Math.round(item.progressM! - own.progressM!)
                  : null,
              paceSecPerKm: item.stale ? null : item.paceSecPerKm ?? null,
              rank: item.rank,
              stale: item.stale,
              gapToAheadM: item.gapToAheadM,
              gapToBehindM: item.gapToBehindM,
              aheadCount: item.aheadCount ?? null,
              behindCount: item.behindCount ?? null,
            })),
            updatedAt: value.updatedAt ?? null,
            spreadM:
              positions.length >= 2 &&
              positions.length === value.participants.length
                ? Math.round(Math.max(...positions) - Math.min(...positions))
                : null,
            inRange: null,
            guidePaceSecPerKm: value.groupGuidePaceSecPerKm,
            loadAlert: value.loadAlert ?? null,
            status: value.status,
            locationsAvailable: false,
          };
          return live;
        },
        value => {
          onUpdate(value);
          return !['COMPLETED', 'CANCELLED'].includes(value.status!);
        },
        onError,
      );
    },
    forceFinish: async groupRunId => {
      if (!isServerId(groupRunId)) return mock.forceFinish(groupRunId);
      await apiRequest(`/group-runs/${groupRunId}/force-finish`, {
        method: 'POST',
        body: {},
      });
    },
    getResult: async groupRunId => {
      if (!isServerId(groupRunId)) return mock.getResult(groupRunId);
      const [result, loaded] = await Promise.all([
        apiRequest<ResultsResponse>(`/group-runs/${groupRunId}/results`),
        load(groupRunId),
      ]);
      const rows: GroupRunResult['participants'] = result.participants.map(
        item => ({
          userId: String(item.userId),
          nickname:
            loaded.participants.find(
              member => member.userId === String(item.userId),
            )?.nickname ?? unknownNickname,
          isMe: String(item.userId) === loaded.me,
          state: ['RUNNING', 'PAUSED'].includes(item.state ?? '')
            ? 'RUNNING'
            : item.state === 'COMPLETED'
            ? 'FINISHED'
            : ['INTERRUPTED', 'CANCELLED'].includes(item.state ?? '')
            ? 'STOPPED'
            : ['PENDING', 'UNKNOWN'].includes(item.startResult ?? '')
            ? 'UNCONFIRMED'
            : 'NOT_STARTED',
          durationSec: item.movingDurationSec,
          distanceM: item.actualDistanceM,
          goalAchieved: item.goalAchieved,
        }),
      );
      return {
        groupRunId,
        title: loaded.run.title,
        status: loaded.run.status,
        targetDistanceM: result.targetDistanceM,
        // 서버 집계를 그대로 사용하며, 미제공 값은 임의로 계산하지 않는다.
        distanceM: result.distanceM ?? null,
        averagePaceSecPerKm: result.averagePaceSecPerKm ?? null,
        maxGapM: result.maxGapM ?? null,
        analysisStatus: result.analysis.status,
        hasUnconfirmedStarts: result.hasUnconfirmedStarts,
        // 공유는 내 기록을 지정해 연다. 최근 기록으로 짐작하면 다른 기록이 붙거나 불러오지 못한다.
        mySessionId: mySessionIdOf(loaded),
        participants: rows,
      };
    },
  };
  return groupRuns;
}
