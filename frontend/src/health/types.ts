export type HealthMetric =
  | 'sleep'
  | 'heartRate'
  | 'restingHeartRate'
  | 'hrv'
  | 'steps'
  | 'exercise'
  | 'distance';
export type ReadWindow = { start: string; end: string };
export type Source = { id: string; name: string };
export type SleepStage = {
  startTime: string;
  endTime: string;
  stage: 'asleep' | 'light' | 'deep' | 'rem' | 'awake' | 'inBed' | 'unknown';
};
export type HealthRecord = {
  id: string;
  metric: HealthMetric;
  startTime: string;
  endTime: string;
  source: Source;
  value?: number;
  unit?: string;
  method?: 'rmssd' | 'sdnn';
  distanceKind?: 'interval' | 'walkingRunning' | 'workout';
  details?: string;
  stages?: SleepStage[];
  reportedSleepMs?: number;
  sleepScore?: number;
  manuallyEntered?: boolean;
  aggregation?: 'period';
};
export type MetricStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'empty'
  | 'accessRequired'
  | 'unavailable'
  | 'error';
export type MetricResult = {
  metric: HealthMetric;
  status: MetricStatus;
  access: 'granted' | 'required' | 'unobservable' | 'unknown';
  records: HealthRecord[];
  summary: {
    value: number | null;
    unit: string;
    note?: string;
    sleepScore?: number;
  };
  window: ReadWindow;
  readAt: string | null;
  sourceMode:
    | 'samsungDirect'
    | 'samsung'
    | 'healthConnectOther'
    | 'healthKit'
    | 'none';
  readRoute?: 'samsungDirect' | 'healthConnect' | 'healthKit';
  fallbackFrom?: 'empty' | 'unavailable';
  stepStatistics?: {
    total: number | null;
    availableDays: number;
    days: { window: ReadWindow; status: MetricStatus; value: number | null }[];
  };
};
export type Availability = 'available' | 'unavailable' | 'updateRequired';
export type DeviceInfo = {
  os: string;
  manufacturer: string;
  model: string;
  version: string;
};
export type HealthProvider = {
  platform: 'android' | 'ios' | 'unsupported';
  checkAvailability(): Promise<Availability>;
  requestReadAccess(): Promise<void>;
  readMetric(metric: HealthMetric, window: ReadWindow): Promise<MetricResult>;
  openAccessSettings(): Promise<void>;
  getDeviceInfo(): Promise<DeviceInfo>;
  openSamsungSettings?(): Promise<void>;
};
