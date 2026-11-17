import type {
  GroupRunCancelReason,
  GroupRunDetail,
  GroupRunLive,
  GroupRunParticipant,
  GroupRunResult,
  GroupRunSummary,
  MyCrew,
  Repositories,
  WaitingRoom,
} from '../types';
import * as fixtures from './fixtures';
import type { GroupRunFixture } from './fixtures';

type Respond = <T>(value: T) => Promise<T>;

type Run = GroupRunFixture & {
  cancellation: GroupRunDetail['cancellation'];
  status: GroupRunSummary['status'];
};

// 6.x 그룹런 mock: joins, the waiting room, the live view and results kept in memory, like the server.
export function createGroupRunMock({
  respond,
  tickMs,
  myCrews,
  myRecord,
}: {
  respond: Respond;
  tickMs: number;
  // The crews I joined or asked to join, kept by the crew mock; none on 6.0b.
  myCrews: () => MyCrew[];
  // My saved record of a group run, for 6.7.
  myRecord: (
    groupRunId: string,
  ) => { durationSec: number; distanceM: number } | null;
}): Repositories['groupRuns'] {
  const me = fixtures.members.me;
  let runs: Run[] = fixtures.groupRuns.map(run => ({
    ...run,
    cancellation: null,
    status: 'SCHEDULED',
  }));
  const ready = new Map<string, boolean>(
    Object.entries(fixtures.waitingRoomReady),
  );
  let myReady = false;
  const starters = new Map<string, (startedAt: string) => void>();
  let startTimer: ReturnType<typeof setTimeout> | null = null;

  const crewOf = (crewId: string) =>
    fixtures.crewDirectory.find(crew => crew.id === crewId)!;
  const find = (groupRunId: string) => {
    const run = runs.find(item => item.id === groupRunId);
    if (!run) {
      throw new Error(`그룹런 없음: ${groupRunId}`);
    }
    return run;
  };
  const hostName = (run: Run) =>
    run.hostId === me.userId
      ? me.nickname
      : run.others.find(member => member.userId === run.hostId)?.nickname ??
        '크루장';

  const summary = (run: Run): GroupRunSummary => ({
    id: run.id,
    crewId: run.crewId,
    crewName: crewOf(run.crewId).name,
    title: run.title,
    hostId: run.hostId,
    hostNickname: hostName(run),
    isHost: run.hostId === me.userId,
    scheduledAt: run.scheduledAt,
    meetingPlaceName: run.meetingPlaceName,
    meetingAddress: run.meetingAddress,
    courseId: run.courseId,
    courseName: run.courseName,
    targetDistanceM: run.targetDistanceM,
    targetDurationSec: run.targetDurationSec,
    participantCount: run.others.length + (run.joined ? 1 : 0),
    joined: run.joined,
    status: run.status,
  });

  const participants = (run: Run): GroupRunParticipant[] => [
    ...run.others.map(member => ({
      ...member,
      isHost: member.userId === run.hostId,
      isMe: false,
      readyStatus: ready.get(member.userId)
        ? ('READY' as const)
        : ('WAITING' as const),
      readinessScore: null,
    })),
    ...(run.joined
      ? [
          {
            ...me,
            isHost: run.hostId === me.userId,
            isMe: true,
            readyStatus: myReady ? ('READY' as const) : ('WAITING' as const),
            readinessScore: fixtures.myFit.readinessScore,
          },
        ]
      : []),
  ];

  // Only the members who entered gr-today's room are in it (지우 applied but stayed out).
  const waitingRoom = (run: Run): WaitingRoom => {
    const applied = participants(run);
    const inRoom = applied.filter(
      member => member.isMe || ready.has(member.userId),
    );
    const readyCount = inRoom.filter(
      member => member.readyStatus === 'READY',
    ).length;
    return {
      groupRunId: run.id,
      goalPaceSecPerKm: run.goalPaceSecPerKm,
      recommendedPaceSecPerKm: run.goalPaceSecPerKm,
      comfortRange: [run.goalPaceSecPerKm - 20, run.goalPaceSecPerKm + 20],
      expectedDurationSec: run.targetDistanceM
        ? Math.round((run.targetDistanceM / 1000) * run.goalPaceSecPerKm)
        : run.targetDurationSec ?? 0,
      appliedCount: applied.length,
      participantCount: inRoom.length,
      readyCount,
      participants: inRoom,
    };
  };

  // The leader starts a few seconds after I am ready (6.5 → 6.6).
  const scheduleStart = (groupRunId: string) => {
    if (startTimer) {
      clearTimeout(startTimer);
      startTimer = null;
    }
    if (!myReady) {
      return;
    }
    startTimer = setTimeout(() => {
      startTimer = null;
      const run = runs.find(item => item.id === groupRunId);
      if (run) {
        run.status = 'RUNNING';
      }
      starters.get(groupRunId)?.(new Date().toISOString());
    }, tickMs * 3);
  };

  return {
    listMine: () => {
      const mine = myCrews();
      if (mine.length === 0) {
        return respond({
          upcoming: null,
          crews: [],
          nearbyRecruiting: fixtures.nearbyRecruiting,
        });
      }
      const member = new Set(
        mine.filter(crew => crew.membership === 'MEMBER').map(crew => crew.id),
      );
      const open = runs.filter(run => run.status !== 'CANCELLED');
      const upcoming = open.find(
        run => run.id === 'gr-today' && run.joined && member.has(run.crewId),
      );
      return respond({
        nearbyRecruiting: fixtures.nearbyRecruiting,
        upcoming: upcoming ? summary(upcoming) : null,
        crews: mine.map(crew => ({
          crew,
          groupRuns:
            crew.membership === 'MEMBER'
              ? open
                  .filter(run => run.crewId === crew.id)
                  .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
                  .map(summary)
              : [],
        })),
      });
    },
    get: groupRunId => {
      const run = find(groupRunId);
      return respond({
        ...summary(run),
        route: run.route,
        meetingPosition: run.meetingPosition,
        goalPaceSecPerKm: run.goalPaceSecPerKm,
        crewMemberCount: crewOf(run.crewId).memberCount,
        participants: participants(run),
        myFit: fixtures.myFit,
        cancellation: run.cancellation,
      });
    },
    join: groupRunId => {
      find(groupRunId).joined = true;
      return respond(undefined);
    },
    leave: groupRunId => {
      find(groupRunId).joined = false;
      return respond(undefined);
    },
    create: draft => {
      const id = `gr-new-${runs.length + 1}`;
      const date = new Date(draft.scheduledAt);
      const weekday = ['일', '월', '화', '수', '목', '금', '토'][
        new Date(date.getTime() + 9 * 3600 * 1000).getUTCDay()
      ];
      const recommended = fixtures.recommendedCourses.find(
        item => item.id === draft.courseId,
      );
      const mine = fixtures.savedCourses.find(
        item => item.id === draft.courseId,
      );
      const courseName =
        recommended?.name ?? mine?.myAlias ?? mine?.name ?? null;
      const km = draft.targetDistanceM
        ? `${Math.round(draft.targetDistanceM / 1000)}km`
        : `${Math.round((draft.targetDurationSec ?? 0) / 60)}분`;
      runs = [
        ...runs,
        {
          id,
          crewId: draft.crewId,
          // G01 needs a title; 6.8 has no title field, so it reads like the prototype's titles.
          title: `${weekday}요일, 함께 ${km}`,
          hostId: me.userId,
          scheduledAt: draft.scheduledAt,
          meetingPlaceName: draft.meetingPlaceName,
          meetingAddress: draft.meetingAddress,
          meetingPosition: draft.meetingPosition,
          courseId: draft.courseId,
          courseName,
          route: draft.courseId
            ? recommended?.route ?? fixtures.todayPlan.route
            : null,
          targetDistanceM: draft.targetDistanceM,
          targetDurationSec: draft.targetDurationSec,
          goalPaceSecPerKm: 360,
          others: [],
          joined: true,
          cancellation: null,
          status: 'SCHEDULED',
        },
      ];
      return respond({ id });
    },
    update: (groupRunId, draft) => {
      const run = find(groupRunId);
      Object.assign(run, {
        scheduledAt: draft.scheduledAt,
        meetingPlaceName: draft.meetingPlaceName,
        meetingAddress: draft.meetingAddress,
        meetingPosition: draft.meetingPosition,
        courseId: draft.courseId,
        courseName: draft.courseId
          ? fixtures.savedCourses.find(item => item.id === draft.courseId)
              ?.name ?? run.courseName
          : null,
        targetDistanceM: draft.targetDistanceM,
        targetDurationSec: draft.targetDurationSec,
      });
      return respond(undefined);
    },
    // S15P31E105-680: the mock has no shared pace card (G03 pace fields absent), so this only answers.
    updateGoal: (groupRunId, goal) => {
      const run = find(groupRunId);
      const durationSec =
        goal.input === 'TIME'
          ? goal.durationSec
          : Math.round((goal.paceSecPerKm * goal.distanceM) / 1000);
      Object.assign(run, {
        targetDistanceM: goal.distanceM,
        targetDurationSec: durationSec,
        goalPaceSecPerKm: Math.round((durationSec * 1000) / goal.distanceM),
      });
      return respond(undefined);
    },
    setPaceMode: groupRunId => {
      find(groupRunId);
      return respond(undefined);
    },
    cancel: (groupRunId, reason: GroupRunCancelReason, message) => {
      const run = find(groupRunId);
      run.status = 'CANCELLED';
      run.cancellation = {
        reason,
        // The mock keeps the note so 6.4e can show it.
        message: message?.trim() || null,
        byNickname: me.nickname,
        byRole: '그룹장',
      };
      return respond(undefined);
    },
    searchPlaces: query => {
      const text = query.trim();
      return respond(
        fixtures.meetingPlaces.filter(
          place =>
            !text || place.name.includes(text) || place.address.includes(text),
        ),
      );
    },
    getWaitingRoom: groupRunId => respond(waitingRoom(find(groupRunId))),
    setReady: (groupRunId, value) => {
      myReady = value;
      scheduleStart(groupRunId);
      return respond(waitingRoom(find(groupRunId)));
    },
    start: async groupRunId => {
      find(groupRunId).status = 'RUNNING';
      if (startTimer) {
        clearTimeout(startTimer);
        startTimer = null;
      }
      starters.get(groupRunId)?.(new Date().toISOString());
      return respond(undefined);
    },
    // 목업에는 서버 세션이 없다. 합류는 출발 확인으로 바로 이어진다.
    joinNow: async groupRunId => {
      myReady = true;
      starters.get(groupRunId)?.(new Date().toISOString());
      return respond({ sessionId: '' });
    },
    watchStart: (groupRunId, onStart) => {
      starters.set(groupRunId, onStart);
      return () => {
        starters.delete(groupRunId);
        if (startTimer) {
          clearTimeout(startTimer);
          startTimer = null;
        }
      };
    },
    watchLive: (groupRunId, onUpdate) => {
      const run = find(groupRunId);
      let tick = 0;
      const timer = setInterval(() => {
        tick += 1;
        // A member strains around 15 seconds in; the group then follows a slower guide pace.
        const alerting = tick >= 15 && tick < 22;
        const slowed = tick >= 15;
        const wobble = (index: number) =>
          Math.round(12 * Math.sin(tick / 9 + index));
        const others = fixtures.liveMembers.map((member, index) => ({
          userId: member.userId,
          nickname: member.nickname,
          isMe: false,
          isHost: member.userId === run.hostId,
          gapM: member.gapM + wobble(index),
          paceSecPerKm: member.paceSecPerKm + Math.round(wobble(index) / 3),
        }));
        const gaps = [0, ...others.map(member => member.gapM)];
        const spreadM = Math.max(...gaps) - Math.min(...gaps);
        const live: GroupRunLive = {
          members: [
            ...others,
            {
              userId: me.userId,
              nickname: me.nickname,
              isMe: true,
              isHost: me.userId === run.hostId,
              gapM: 0,
              paceSecPerKm: 0,
            },
          ],
          spreadM,
          inRange: spreadM <= 250,
          guidePaceSecPerKm: slowed
            ? run.goalPaceSecPerKm + 15
            : run.goalPaceSecPerKm,
          loadAlert: alerting
            ? { memberCount: 1, nextPaceSecPerKm: run.goalPaceSecPerKm + 15 }
            : null,
        };
        onUpdate(live);
      }, tickMs);
      return () => clearInterval(timer);
    },
    forceFinish: groupRunId => {
      find(groupRunId).status = 'COMPLETED';
      return respond(undefined);
    },
    getResult: groupRunId => {
      const run = find(groupRunId);
      const mine = myRecord(groupRunId);
      const target = run.targetDistanceM;
      const achieved = (distanceM: number) =>
        target === null ? null : distanceM >= target * 0.98;
      const rows: GroupRunResult['participants'] = [
        ...fixtures.groupResults.map(member => ({
          userId: member.userId,
          nickname: member.nickname,
          isMe: false,
          state: member.state,
          durationSec: member.durationSec,
          distanceM: member.distanceM,
          goalAchieved: achieved(member.distanceM),
        })),
        ...(mine
          ? [
              {
                userId: me.userId,
                nickname: me.nickname,
                isMe: true,
                state: 'FINISHED' as const,
                durationSec: mine.durationSec,
                distanceM: mine.distanceM,
                goalAchieved: achieved(mine.distanceM),
              },
            ]
          : []),
      ];
      const finished = rows.filter(row => row.goalAchieved);
      const paces = finished.map(
        row => row.durationSec! / (row.distanceM! / 1000),
      );
      return respond({
        groupRunId,
        title: run.title,
        status: 'COMPLETED',
        targetDistanceM: target,
        distanceM: target ?? Math.max(...rows.map(row => row.distanceM ?? 0)),
        averagePaceSecPerKm: Math.round(
          paces.reduce((sum, pace) => sum + pace, 0) /
            Math.max(paces.length, 1),
        ),
        maxGapM: 180,
        participants: rows,
      });
    },
  };
}
