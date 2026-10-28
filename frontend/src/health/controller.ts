import type {
  Availability,
  HealthMetric,
  HealthProvider,
  MetricResult,
  ReadWindow,
} from './types';
import { emptyResult, METRICS } from './catalog';
import { makeReadWindow } from './time';
import { readWeeklySteps } from './weeklySteps';
type State = {
  days: 1 | 7;
  window: ReadWindow;
  results: Record<HealthMetric, MetricResult>;
  busy: boolean;
  availability: Availability | null;
  message: string;
};
function results(window: ReadWindow, status: MetricResult['status'] = 'idle') {
  return Object.fromEntries(
    METRICS.map(metric => [metric, emptyResult(metric, window, status)]),
  ) as State['results'];
}
export class HealthController {
  private generation = 0;
  private authorizing = false;
  private authorization: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  state: State;
  constructor(private provider: HealthProvider) {
    const window = makeReadWindow(1, new Date());
    this.state = {
      days: 1,
      window,
      results: results(window),
      busy: false,
      availability: null,
      message: '',
    };
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit() {
    this.listeners.forEach(listener => listener());
  }
  invalidate() {
    this.generation++;
    this.state = {
      ...this.state,
      busy: false,
      results: results(this.state.window),
    };
    this.emit();
  }
  async refresh(days: 1 | 7 = this.state.days) {
    const generation = ++this.generation;
    const window = makeReadWindow(days, new Date());
    this.state = {
      ...this.state,
      days,
      window,
      results: results(window, 'loading'),
      busy: true,
      message: '',
    };
    this.emit();
    try {
      if (this.authorization) {
        await this.authorization;
      }
      if (generation !== this.generation) {
        return;
      }
      const availability = await this.provider.checkAvailability();
      if (generation !== this.generation) {
        return;
      }
      this.state = { ...this.state, availability };
      if (availability !== 'available') {
        this.state = {
          ...this.state,
          results: results(window, 'unavailable'),
          busy: false,
        };
        this.emit();
        return;
      }
      await Promise.all(
        METRICS.map(async metric => {
          let result: MetricResult;
          try {
            result =
              metric === 'steps' && days === 7
                ? await readWeeklySteps(this.provider, new Date(window.end))
                : await this.provider.readMetric(metric, window);
          } catch {
            result = emptyResult(metric, window, 'error');
          }
          if (generation !== this.generation) {
            return;
          }
          this.state = {
            ...this.state,
            results: { ...this.state.results, [metric]: result },
          };
          this.emit();
        }),
      );
    } catch {
      if (generation === this.generation) {
        this.state = {
          ...this.state,
          results: results(window, 'error'),
          message: '연결 상태를 확인하지 못했습니다. 다시 시도해 주세요.',
        };
      }
    }
    if (generation === this.generation) {
      this.state = { ...this.state, busy: false };
      this.emit();
    }
  }
  async authorize() {
    if (this.authorizing) {
      return;
    }
    this.authorizing = true;
    this.invalidate();
    const generation = this.generation;
    this.state = { ...this.state, busy: true };
    this.emit();
    try {
      this.authorization = this.provider.requestReadAccess();
      await this.authorization;
      this.authorization = null;
      if (generation === this.generation) {
        await this.refresh();
      }
    } catch {
      if (generation === this.generation) {
        this.state = {
          ...this.state,
          busy: false,
          message: '권한 요청을 마치지 못했습니다. 설정을 확인해 주세요.',
        };
        this.emit();
      }
    } finally {
      this.authorizing = false;
      this.authorization = null;
      if (generation === this.generation) {
        this.state = { ...this.state, busy: false };
        this.emit();
      }
    }
  }
}
