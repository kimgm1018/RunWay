import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { appConfig } from '../../config';
import { useWatchDailyHrUpload } from '../useWatchDailyHrUpload';
import {
  resetWatchDailyHrUploadState,
  uploadWatchDailyHr,
} from '../watchDailyHrUpload';

jest.mock('../watchDailyHrUpload', () => ({
  uploadWatchDailyHr: jest.fn().mockResolvedValue('nothing'),
  resetWatchDailyHrUploadState: jest.fn(),
}));

function Probe({ signedIn }: { signedIn: boolean }) {
  useWatchDailyHrUpload(signedIn);
  return null;
}

const originalDataSource = appConfig.dataSource;

beforeEach(() => {
  jest.clearAllMocks();
  (appConfig as { dataSource: string }).dataSource = 'api';
});

afterAll(() => {
  (appConfig as { dataSource: string }).dataSource = originalDataSource;
});

test('signing out forgets the records skipped for the previous account', async () => {
  let screen!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    screen = TestRenderer.create(<Probe signedIn />);
  });
  expect(uploadWatchDailyHr).toHaveBeenCalledTimes(1);
  expect(resetWatchDailyHrUploadState).not.toHaveBeenCalled();

  await act(async () => screen.update(<Probe signedIn={false} />));
  expect(resetWatchDailyHrUploadState).toHaveBeenCalledTimes(1);

  await act(async () => screen.unmount());
});
