import { HealthController } from '../controller';
import { emptyResult } from '../catalog';
import type { MetricResult, HealthProvider } from '../types';
const provider: HealthProvider = {
  platform: 'unsupported',
  checkAvailability: async () => 'unavailable',
  requestReadAccess: async () => {},
  readMetric: async (metric, window) => emptyResult(metric, window),
  openAccessSettings: async () => {},
  getDeviceInfo: async () => ({
    os: 'test',
    manufacturer: '',
    model: '',
    version: '',
  }),
};
test('late response cannot overwrite a newer period or invalidated data', async () => {
  const pending: ((r: MetricResult) => void)[] = [];
  const controller = new HealthController({
    ...provider,
    checkAvailability: async () => 'available',
    readMetric: (metric, window) =>
      new Promise(resolve =>
        pending.push(r => resolve({ ...r, metric, window })),
      ),
  });
  const old = controller.refresh(1);
  await Promise.resolve();
  const latest = controller.refresh(7);
  await Promise.resolve();
  pending.slice(7).forEach(resolve =>
    resolve({
      ...emptyResult('steps', controller.state.window),
      status: 'ready',
      summary: { value: 7, unit: '걸음' },
    }),
  );
  await latest;
  pending.slice(0, 7).forEach(resolve =>
    resolve({
      ...emptyResult('steps', controller.state.window),
      status: 'ready',
      summary: { value: 1, unit: '걸음' },
    }),
  );
  await old;
  expect(controller.state.results.steps.summary.value).toBe(7);
  controller.invalidate();
  expect(controller.state.results.steps.summary.value).toBeNull();
});
test('one metric rejection does not hide other successful metrics', async () => {
  const controller = new HealthController({
    ...provider,
    checkAvailability: async () => 'available',
    readMetric: async (metric, window) => {
      if (metric === 'hrv') {
        throw new Error('query');
      }
      return { ...emptyResult(metric, window), status: 'ready' };
    },
  });
  await controller.refresh(1);
  expect(controller.state.results.hrv.status).toBe('error');
  expect(controller.state.results.steps.status).toBe('ready');
});
test('permission requests cannot overlap and failures clear old data', async () => {
  let finish: () => void = () => {};
  const request = jest.fn(
    () =>
      new Promise<void>(resolve => {
        finish = resolve;
      }),
  );
  const controller = new HealthController({
    ...provider,
    requestReadAccess: request,
  });
  const first = controller.authorize();
  await controller.authorize();
  expect(request).toHaveBeenCalledTimes(1);
  finish();
  await first;
  expect(controller.state.busy).toBe(false);
});
test.each([false, true])(
  'invalidated permission completion/failure cannot restart queries (%s)',
  async fail => {
    let finish: () => void = () => {};
    const read = jest.fn(async (metric, window) => emptyResult(metric, window));
    const controller = new HealthController({
      ...provider,
      checkAvailability: async () => 'available',
      readMetric: read,
      requestReadAccess: () =>
        new Promise<void>((resolve, reject) => {
          finish = () => (fail ? reject(new Error('denied')) : resolve());
        }),
    });
    const request = controller.authorize();
    controller.invalidate();
    finish();
    await request;
    expect(read).not.toHaveBeenCalled();
    expect(controller.state.message).toBe('');
    expect(controller.state.results.steps.status).toBe('idle');
  },
);
test('foreground refresh waits for pending authorization and runs only once', async () => {
  let finish: () => void = () => {};
  let authorized = false;
  const read = jest.fn(async (metric, window) => {
    expect(authorized).toBe(true);
    return emptyResult(metric, window, 'ready');
  });
  const controller = new HealthController({
    ...provider,
    checkAvailability: async () => 'available',
    readMetric: read,
    requestReadAccess: () =>
      new Promise<void>(resolve => {
        finish = () => {
          authorized = true;
          resolve();
        };
      }),
  });
  const request = controller.authorize();
  controller.invalidate();
  const foreground = controller.refresh();
  await Promise.resolve();
  expect(read).not.toHaveBeenCalled();
  finish();
  await Promise.all([request, foreground]);
  expect(read).toHaveBeenCalledTimes(7);
  expect(controller.state.results.steps.status).toBe('ready');
});
