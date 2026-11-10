import { DataError, errorCode } from '../errors';
import type { Repositories, SavedRunRecord } from '../types';
import { apiRequest } from './http';

// 4.5 러닝 결과 with the server (S15P31E105-529). A personal run is stored when its session completes (S06), and its
// record has the session's id (H01·H02, running-records.md), so saving is reading that record back: the result,
// 기록 보기, 기록 공유 and the records list then show the same server record. No record is made on the phone.

// H02 totals; the server leaves a value null until it has it.
type DetailResponse = {
  sessionId: number;
  actualDistanceM: number | null;
  movingDurationSec: number | null;
  averagePaceSecPerKm: number | null;
  averageHeartRate: number | null;
  averageCadence: number | null;
  goalAchieved: boolean | null;
};

const rounded = (value: number | null) =>
  value === null ? null : Math.round(value);

export const saveRunRecord: Repositories['run']['saveRecord'] =
  async record => {
    // A group run's result is the server's group result (6.7); it has no personal record to open here.
    if (!record.sessionId) {
      const none: SavedRunRecord = { recordId: null, server: null };
      return none;
    }
    try {
      const detail = await apiRequest<DetailResponse>(
        `/running-records/${encodeURIComponent(record.sessionId)}`,
      );
      const saved: SavedRunRecord = {
        recordId: String(detail.sessionId),
        server: {
          distanceM: detail.actualDistanceM,
          durationSec: detail.movingDurationSec,
          averagePaceSecPerKm: rounded(detail.averagePaceSecPerKm),
          averageHeartRate: rounded(detail.averageHeartRate),
          averageCadence: rounded(detail.averageCadence),
          goalAchieved: detail.goalAchieved,
        },
      };
      return saved;
    } catch (error) {
      // The session already completed, so the record is not lost: it is only not confirmed yet.
      throw new DataError(
        'SAVE_UNCONFIRMED',
        `기록 확인 실패: ${errorCode(error)}`,
      );
    }
  };
