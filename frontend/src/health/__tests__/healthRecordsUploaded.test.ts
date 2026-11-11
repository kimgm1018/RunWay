import { DataError } from '../../data/errors';
import { onHealthRecordsUploaded } from '../healthRecordsUploaded';
import type { SleepNative, SleepSyncResponse } from '../samsungSleep';
import type { ExerciseNative } from '../samsungExerciseLoad';
import { uploadSamsungHealthRecords } from '../useSamsungSleep';

// S15P31E105-675: 2.1 is told to read today's readiness again only when a W06 request of the run stored something
// new (accepted), never for duplicates only, rejections or a failed upload. Values are synthetic.

jest.mock('../../config', () => ({ appConfig: { dataSource: 'api' } }));

const mockApiRequest = jest.fn();
jest.mock('../../data/api/http', () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

// The run itself is covered by the sleep and exercise tests; here it sends one sleep and one exercise request.
jest.mock('../samsungExerciseLoad', () => ({
  ...jest.requireActual('../samsungExerciseLoad'),
  uploadSamsungHealth: async (
    sleep: { send: (body: unknown) => Promise<SleepSyncResponse> },
    exercise: { send: (body: unknown) => Promise<SleepSyncResponse> },
  ) => {
    await sleep.send({ records: [] });
    await exercise.send({ records: [] });
    return 'done';
  },
}));

const counts = (acceptedCount: number, duplicateCount = 0) => ({
  acceptedCount,
  duplicateCount,
  rejectedCount: 0,
  errors: [],
});

const fake = {} as SleepNative;
const fakeExercise = {} as ExerciseNative;

let told: jest.Mock;
let stop: () => void;
beforeEach(() => {
  mockApiRequest.mockReset();
  told = jest.fn();
  stop = onHealthRecordsUploaded(told);
});
afterEach(() => stop());

it('tells 2.1 once after a run in which a request stored a new record', async () => {
  mockApiRequest
    .mockResolvedValueOnce(counts(0, 1))
    .mockResolvedValueOnce(counts(2));

  await uploadSamsungHealthRecords(fake, fake, fakeExercise);

  expect(mockApiRequest).toHaveBeenCalledWith('/health-records/sync', {
    method: 'POST',
    body: { records: [] },
  });
  expect(told).toHaveBeenCalledTimes(1);
});

it('says nothing when the server only had the values already', async () => {
  mockApiRequest.mockResolvedValue(counts(0, 1));

  await uploadSamsungHealthRecords(fake, fake, fakeExercise);

  expect(told).not.toHaveBeenCalled();
});

it('says nothing when the upload fails', async () => {
  mockApiRequest.mockRejectedValue(new DataError('NETWORK_ERROR', '연결 없음'));

  await expect(
    uploadSamsungHealthRecords(fake, fake, fakeExercise),
  ).rejects.toBeInstanceOf(DataError);

  expect(told).not.toHaveBeenCalled();
});

it('still tells 2.1 when a later request of the run fails after one was stored', async () => {
  mockApiRequest
    .mockResolvedValueOnce(counts(1))
    .mockRejectedValueOnce(new DataError('NETWORK_ERROR', '연결 없음'));

  await expect(
    uploadSamsungHealthRecords(fake, fake, fakeExercise),
  ).rejects.toBeInstanceOf(DataError);

  expect(told).toHaveBeenCalledTimes(1);
});
