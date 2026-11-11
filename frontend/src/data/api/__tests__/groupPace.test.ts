import { changeLabel } from '../../../screens/group/GroupPaceCard';
import type { GroupPaceInfo, GroupRunParticipant } from '../../types';
import { paceInfoOf } from '../groupRuns';

// S15P31E105-680 공동 페이스 카드: G03 fields to the card, and the 방금 바뀜 label.

const detail = {
  id: 61,
  title: 't',
  description: null,
  hostId: 1,
  crewId: 2,
  courseId: null,
  scheduledAt: '2026-11-12T00:00:00Z',
  meetingPosition: { type: 'Point' as const, coordinates: [127, 37] as [number, number] },
  participantCount: 2,
  status: 'SCHEDULED' as const,
  targetDistanceM: 5000,
  targetDurationSec: 1800,
  meetingPlaceName: 'p',
  meetingAddress: null,
  goalPaceSecPerKm: 360,
  groupGuidePaceSecPerKm: 380,
};

const member = (userId: string, nickname: string): GroupRunParticipant => ({
  userId,
  nickname,
  isHost: false,
  isMe: false,
  readyStatus: 'WAITING',
  readinessScore: null,
});

it('maps the pace fields and stays null while the server leaves them out', () => {
  expect(paceInfoOf(detail)).toBeNull();
  expect(
    paceInfoOf({
      ...detail,
      groupPaceMode: 'TOGETHER',
      aiRecommendedPaceSecPerKm: 380,
      paceBasis: { type: 'MEMBER', nickname: '민수' },
      paceCalculating: false,
      slowerThanGoalCount: 1,
    }),
  ).toEqual({
    mode: 'TOGETHER',
    appliedSecPerKm: 380,
    aiSecPerKm: 380,
    goalSecPerKm: 360,
    basis: 'MEMBER',
    basisNickname: '민수',
    calculating: false,
    slowerThanGoalCount: 1,
  });
  expect(
    paceInfoOf({ ...detail, groupPaceMode: 'GOAL', paceCalculating: true })
      ?.calculating,
  ).toBe(true);
});

it('names who joined or left, else the mode or the goal', () => {
  const pace: GroupPaceInfo = {
    mode: 'TOGETHER',
    appliedSecPerKm: 370,
    aiSecPerKm: 370,
    goalSecPerKm: 360,
    basis: 'MEMBER',
    basisNickname: '지우',
    calculating: false,
    slowerThanGoalCount: 1,
  };
  const before = { pace, participants: [member('1', '지우')] };
  expect(
    changeLabel(before, {
      pace,
      participants: [member('1', '지우'), member('2', '민수')],
    }),
  ).toBe('민수 참가');
  expect(changeLabel(before, { pace, participants: [] })).toBe('지우 나감');
  expect(
    changeLabel(before, {
      pace: { ...pace, mode: 'GOAL' },
      participants: before.participants,
    }),
  ).toBe('목표 페이스로 변경');
});
