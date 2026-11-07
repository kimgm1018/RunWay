import { DataError } from '../errors';
import type { Repositories, WithdrawalSummary } from '../types';
import { apiRequest } from './http';

// 8.4–8.6 회원탈퇴 (U17·U18, docs/design/api/users.md, S15P31E105-523).

type SummaryResponse = {
  runningRecordCount: number;
  postCount: number;
  bookmarkedCourseCount: number;
  connectedDevices: { id: number; deviceType: 'WATCH' | 'PHONE' }[];
  ownedCrews: { crewId: number; name: string }[];
  ownedGroupRuns: { groupRunId: number; title: string; status: string }[];
  scheduledGroupRuns: { groupRunId: number; title: string; status: string }[];
  blockers: { code: string; message: string; resourceIds: number[] }[];
};

const deviceLabel = (type: string) => (type === 'PHONE' ? '휴대폰' : '워치');

export function toWithdrawalSummary(r: SummaryResponse): WithdrawalSummary {
  return {
    runningRecordCount: r.runningRecordCount,
    postCount: r.postCount,
    // A bookmark only; the shared course itself is not deleted (users.md U17).
    savedCourseCount: r.bookmarkedCourseCount,
    connectedDevices: r.connectedDevices.map(device =>
      deviceLabel(device.deviceType),
    ),
    ownedCrews: r.ownedCrews.map(crew => crew.name),
    ownedGroupRuns: r.ownedGroupRuns.map(run => run.title),
    scheduledGroupRuns: r.scheduledGroupRuns.map(run => run.title),
    blockers: r.blockers.map(({ code, message }) => ({ code, message })),
  };
}

export function createAccountApi(): Repositories['account'] {
  return {
    getWithdrawalSummary: () =>
      apiRequest<SummaryResponse>('/users/me/withdrawal-summary').then(
        toWithdrawalSummary,
      ),
    // agreed is the 8.4 checkbox: 8.5 is reached only after it, so it always goes as true.
    withdraw: async password => {
      try {
        await apiRequest('/users/me', {
          method: 'DELETE',
          body: { password, agreed: true },
        });
      } catch (error) {
        // The account is already gone; only the picture cleanup is left to the server's own retry.
        if (
          error instanceof DataError &&
          error.code === 'IMAGE_CLEANUP_PENDING' &&
          error.details?.withdrawalCompleted === true
        ) {
          return;
        }
        throw error;
      }
    },
  };
}
