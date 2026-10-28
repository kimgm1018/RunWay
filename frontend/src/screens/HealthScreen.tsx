import React, { useEffect, useMemo, useState } from 'react';
import {
  AppState,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type {
  DeviceInfo,
  HealthMetric,
  HealthProvider,
  MetricResult,
} from '../health/types';
import { HealthController } from '../health/controller';
import { METRICS, METRIC_LABELS } from '../health/catalog';

const statusLabels = {
  idle: '조회 전',
  loading: '조회 중',
  ready: '수집됨',
  empty: '기록 없음',
  accessRequired: '권한 요청 필요',
  unavailable: '지원하지 않음',
  error: '조회 오류',
};
function date(value: string) {
  return new Date(value).toLocaleString('ko-KR');
}
function sleepTime(milliseconds: number) {
  const minutes = Math.round(milliseconds / 60000);
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
}
function valueText(result: MetricResult) {
  const value = result.summary.value;
  if (value === null) {
    if (result.metric === 'sleep' && result.summary.sleepScore !== undefined) {
      return `${result.summary.sleepScore}점`;
    }
    return '—';
  }
  if (result.metric === 'sleep') {
    return sleepTime(value);
  }
  return `${value.toLocaleString('ko-KR', { maximumFractionDigits: 1 })} ${
    result.summary.unit
  }`;
}
function Button({
  title,
  onPress,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, disabled && styles.disabled]}
    >
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
}
export function HealthScreen({ provider }: { provider: HealthProvider }) {
  const controller = useMemo(() => new HealthController(provider), [provider]);
  const [state, setState] = useState(controller.state);
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [selected, setSelected] = useState<HealthMetric | null>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let mounted = true;
    const unsubscribe = controller.subscribe(() => {
      if (mounted) {
        setState(controller.state);
      }
    });
    void controller.refresh();
    void provider
      .getDeviceInfo()
      .then(info => {
        if (mounted) {
          setDevice(info);
        }
      })
      .catch(() => {});
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener('change', next => {
      if (next !== 'active') {
        controller.invalidate();
      } else if (previous !== 'active') {
        void controller.refresh();
      }
      previous = next;
    });
    return () => {
      mounted = false;
      unsubscribe();
      subscription.remove();
      controller.invalidate();
    };
  }, [controller, provider]);
  const ios = provider.platform === 'ios';
  const details = selected ? state.results[selected] : null;
  const success = METRICS.filter(
    metric => state.results[metric].status === 'ready',
  ).length;
  const openSettings = async () => {
    controller.invalidate();
    try {
      await provider.openAccessSettings();
    } catch {
      setNotice(
        '설정을 열지 못했습니다. 휴대폰 설정에서 건강 데이터 접근을 확인해 주세요.',
      );
    }
  };
  const header = (
    <View>
      <Text style={styles.brand}>
        RUNWAY <Text style={styles.brandSmall}>HEALTH</Text>
      </Text>
      <Text style={styles.title}>내 몸의 기록을{'\n'}한눈에.</Text>
      <Text style={styles.body}>
        {ios
          ? 'Apple 건강에 저장된 기록을 불러옵니다.'
          : '삼성 헬스 기록을 먼저 읽고, 비어 있거나 미지원인 항목은 Health Connect에서 확인합니다.'}
      </Text>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>건강 데이터 연결</Text>
        <Text style={styles.heroNumber}>
          {success} <Text style={styles.heroUnit}>/ 7개 항목</Text>
        </Text>
        <Text style={styles.body}>
          {state.busy
            ? '기록을 확인하고 있어요.'
            : success
            ? '실제 기록을 확인했어요.'
            : '권한과 저장된 기록을 확인해 주세요.'}
        </Text>
      </View>
      <View style={styles.row}>
        {([1, 7] as const).map(days => (
          <Pressable
            key={days}
            accessibilityRole="button"
            accessibilityState={{ selected: state.days === days }}
            onPress={() => {
              void controller.refresh(days);
            }}
            style={[styles.period, state.days === days && styles.activePeriod]}
          >
            <Text style={state.days === days ? styles.activeText : styles.body}>
              {days === 1 ? '오늘' : '최근 7일'}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.small}>
        조회 기간 {date(state.window.start)} ~ {date(state.window.end)}
      </Text>
      {state.availability && state.availability !== 'available' && (
        <Text style={styles.warning}>
          {state.availability === 'updateRequired'
            ? 'Health Connect 설치 또는 업데이트가 필요합니다. 휴대폰 설정에서 확인해 주세요.'
            : '이 기기에서 건강 데이터 서비스를 사용할 수 없습니다.'}
        </Text>
      )}
      {!!(state.message || notice) && (
        <Text accessibilityRole="alert" style={styles.warning}>
          {state.message || notice}
        </Text>
      )}
      <View style={styles.row}>
        <Button
          title="읽기 권한 요청"
          disabled={state.busy || state.availability !== 'available'}
          onPress={() => {
            void controller.authorize();
          }}
        />
        <Button
          title="다시 조회"
          disabled={state.busy}
          onPress={() => {
            void controller.refresh();
          }}
        />
      </View>
      <Button
        title={ios ? '권한 설정 확인' : 'Health Connect 권한 설정'}
        onPress={() => {
          void openSettings();
        }}
      />
      {provider.openSamsungSettings && (
        <Button
          title="삼성 헬스 열기"
          onPress={() => {
            void provider.openSamsungSettings!().catch(() =>
              setNotice('삼성 헬스를 열지 못했습니다.'),
            );
          }}
        />
      )}
      <Text style={styles.section}>수집된 건강 기록</Text>
    </View>
  );
  if (details && selected) {
    return (
      <View style={styles.screen}>
        <FlatList
          data={[...details.records].sort(
            (a, b) => Date.parse(b.startTime) - Date.parse(a.startTime),
          )}
          keyExtractor={record =>
            record.aggregation ? `${record.startTime}:${record.id}` : record.id
          }
          contentContainerStyle={styles.container}
          ListHeaderComponent={
            <View>
              <Button title="← 요약으로" onPress={() => setSelected(null)} />
              <Text style={styles.title}>{METRIC_LABELS[selected]}</Text>
              <Text style={styles.heroNumber}>{valueText(details)}</Text>
              {selected === 'sleep' &&
                details.summary.value !== null &&
                details.summary.sleepScore !== undefined && (
                  <Text style={styles.source}>
                    최근 수면 점수 {details.summary.sleepScore}점
                  </Text>
                )}
              {details.stepStatistics && (
                <View>
                  <Text style={styles.body}>
                    기록 {details.stepStatistics.availableDays}/7일 · 확인된
                    날의 합계{' '}
                    {details.stepStatistics.total?.toLocaleString('ko-KR') ??
                      '—'}{' '}
                    걸음
                  </Text>
                  <Text style={styles.small}>
                    걸음수 기간: 오늘을 제외한 완료된 최근 7일
                  </Text>
                  {details.stepStatistics.days.map(day => (
                    <Text key={day.window.start} style={styles.body}>
                      {new Date(day.window.start).toLocaleDateString('ko-KR')} ·{' '}
                      {day.value === null
                        ? statusLabels[day.status]
                        : `${day.value.toLocaleString('ko-KR')} 걸음`}
                    </Text>
                  ))}
                </View>
              )}
              <Text style={styles.body}>
                {statusLabels[details.status]} · {details.summary.note}
              </Text>
              {details.readRoute && (
                <Text style={styles.source}>
                  {details.readRoute === 'samsungDirect'
                    ? '삼성 헬스 직접 조회'
                    : details.readRoute === 'healthConnect'
                    ? 'Health Connect 보완 조회'
                    : 'Apple 건강'}
                </Text>
              )}
              <Text style={styles.small}>
                조회 {date(details.window.start)} ~ {date(details.window.end)}
              </Text>
              <Text style={styles.small}>
                마지막 조회{' '}
                {details.readAt ? date(details.readAt) : '아직 없음'} · 원본{' '}
                {details.records.length}건
              </Text>
              {details.sourceMode === 'healthConnectOther' && (
                <Text style={styles.warning}>
                  삼성 헬스 기록이 없어 다른 Health Connect 출처를 사용했습니다.
                </Text>
              )}
              {selected === 'sleep' && (
                <Text style={styles.body}>
                  자정을 넘긴 수면은 원래 시각을 유지합니다. 삼성 제공 수면
                  시간을 우선 표시하고, 없을 때만 확인된 단계로 계산합니다.
                </Text>
              )}
            </View>
          }
          ListEmptyComponent={
            <Text style={styles.body}>
              {ios
                ? '읽기 허용 여부 또는 기록 유무를 앱에서 구분할 수 없습니다.'
                : '권한과 삼성 헬스 공유 상태를 확인해 주세요.'}
            </Text>
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.metricValue}>
                {item.metric === 'sleep' &&
                Number.isFinite(item.reportedSleepMs) &&
                item.reportedSleepMs! >= 0
                  ? sleepTime(item.reportedSleepMs!)
                  : item.value !== undefined
                  ? `${item.value.toLocaleString()} ${item.unit ?? ''}`
                  : item.details ?? '수면 기록'}
              </Text>
              {item.metric === 'sleep' &&
                Number.isInteger(item.sleepScore) &&
                item.sleepScore! >= 0 &&
                item.sleepScore! <= 100 && (
                  <Text style={styles.source}>
                    수면 점수 {item.sleepScore}점
                  </Text>
                )}
              <Text style={styles.body}>
                {item.aggregation ? '집계 기간 · ' : ''}
                {date(item.startTime)} ~ {date(item.endTime)}
              </Text>
              <Text style={styles.source}>{item.source.name}</Text>
              <Text selectable style={styles.small}>
                {item.source.id}
              </Text>
              {item.manuallyEntered && (
                <Text style={styles.small}>사용자 직접 입력 기록</Text>
              )}
              {item.method && (
                <Text style={styles.body}>
                  HRV · {item.method.toUpperCase()} (ms)
                </Text>
              )}
              {item.distanceKind && (
                <Text style={styles.small}>
                  {item.distanceKind === 'workout'
                    ? '운동 거리 · 기간 전체 이동거리 아님'
                    : item.distanceKind === 'walkingRunning'
                    ? '걷기/달리기 거리'
                    : '거리 구간'}
                </Text>
              )}
              {item.stages?.map((stage, index) => (
                <Text key={index} style={styles.small}>
                  {stage.stage} · {date(stage.startTime)} ~{' '}
                  {date(stage.endTime)}
                </Text>
              ))}
            </View>
          )}
        />
      </View>
    );
  }
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      {header}
      <View style={styles.grid}>
        {METRICS.map(metric => {
          const result = state.results[metric];
          const latest = [...result.records].sort(
            (a, b) => Date.parse(b.startTime) - Date.parse(a.startTime),
          )[0];
          return (
            <Pressable
              key={metric}
              accessibilityRole="button"
              accessibilityLabel={`${METRIC_LABELS[metric]}, ${valueText(
                result,
              )}, ${statusLabels[result.status]}, 상세 보기`}
              onPress={() => setSelected(metric)}
              style={[styles.card, styles.metricCard]}
            >
              <Text style={styles.body}>
                {metric === 'sleep' && state.days === 7
                  ? '하루 평균 수면'
                  : metric === 'steps' && state.days === 7
                  ? '하루 평균 걸음수'
                  : METRIC_LABELS[metric]}{' '}
                <Text style={styles.source}>↗</Text>
              </Text>
              <Text style={styles.metricValue}>{valueText(result)}</Text>
              {metric === 'sleep' &&
                result.summary.value !== null &&
                result.summary.sleepScore !== undefined && (
                  <Text style={styles.source}>
                    최근 수면 점수 {result.summary.sleepScore}점
                  </Text>
                )}
              <Text
                style={result.status === 'ready' ? styles.source : styles.small}
              >
                {statusLabels[result.status]}
              </Text>
              {metric === 'hrv' && (
                <Text style={styles.small}>{ios ? 'SDNN' : 'RMSSD'} · ms</Text>
              )}
              <Text style={styles.small}>{result.summary.note ?? ''}</Text>
              {metric === 'steps' && state.days === 7 && (
                <Text style={styles.small}>
                  걸음수 기간{' '}
                  {new Date(result.window.start).toLocaleDateString('ko-KR')} ~{' '}
                  {new Date(
                    Date.parse(result.window.end) - 1,
                  ).toLocaleDateString('ko-KR')}
                </Text>
              )}
              {result.readRoute && (
                <Text style={styles.source}>
                  {result.readRoute === 'samsungDirect'
                    ? '삼성 헬스 직접 조회'
                    : result.readRoute === 'healthConnect'
                    ? 'Health Connect 보완 조회'
                    : 'Apple 건강'}
                </Text>
              )}
              {latest && (
                <Text style={styles.small}>
                  {latest.source.name} ·{' '}
                  {latest.aggregation
                    ? '선택 기간 집계'
                    : date(latest.startTime)}
                </Text>
              )}
              {result.sourceMode === 'healthConnectOther' && (
                <Text style={styles.warning}>다른 출처 사용</Text>
              )}
            </Pressable>
          );
        })}
      </View>
      <View style={styles.card}>
        <Text style={styles.section}>데이터 이용 안내</Text>
        <Text style={styles.body}>
          {ios
            ? '• Apple 건강에 저장된 기록을 읽습니다.'
            : '• 삼성 헬스·Health Connect의 기록을 읽습니다.'}
        </Text>
        <Text style={styles.body}>• —는 확인 가능한 값이 없다는 뜻입니다.</Text>
        <Text style={styles.body}>• 건강 기록은 서버로 전송하지 않습니다.</Text>
        {ios && (
          <Text style={styles.small}>
            읽기 허용 여부는 앱에서 확인할 수 없습니다. 건강 앱에서 접근을
            확인하세요.
          </Text>
        )}
      </View>
      <View style={styles.card}>
        <Text style={styles.section}>자동 감지한 기기</Text>
        <Text style={styles.body}>
          {device
            ? `${device.manufacturer} ${device.model}\n${device.os} ${device.version}`
            : '기기 정보 확인 중'}
        </Text>
        <Text style={styles.small}>
          {ios
            ? 'Apple 건강 (HealthKit)'
            : '삼성 헬스 직접 조회 · Health Connect 보완'}
        </Text>
      </View>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0B0C10' },
  container: { padding: 22, paddingBottom: 40 },
  brand: {
    color: '#A7F6EC',
    fontSize: 23,
    fontWeight: '900',
    letterSpacing: 2,
    marginVertical: 14,
  },
  brandSmall: { fontSize: 12, color: '#A8ADC1' },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#FFF',
    marginVertical: 16,
    lineHeight: 44,
  },
  body: { color: '#D7D9E4', fontSize: 14, lineHeight: 23 },
  small: { color: '#A8ADC1', fontSize: 12, lineHeight: 20, marginTop: 6 },
  hero: {
    backgroundColor: '#2B2F3D',
    padding: 24,
    borderRadius: 24,
    marginVertical: 22,
  },
  eyebrow: { color: '#A7F6EC', fontSize: 13 },
  heroNumber: {
    fontSize: 44,
    color: '#A7F6EC',
    fontWeight: '800',
    marginVertical: 10,
  },
  heroUnit: { fontSize: 16, color: '#D7D9E4' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginVertical: 10 },
  period: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 24,
    backgroundColor: '#20232E',
  },
  activePeriod: { backgroundColor: '#A7F6EC' },
  activeText: {
    color: '#17202B',
    fontWeight: '700',
    fontSize: 14,
    lineHeight: 23,
  },
  button: {
    backgroundColor: '#A7F6EC',
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 14,
    alignSelf: 'flex-start',
  },
  buttonText: { color: '#17202B', fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.4 },
  section: {
    color: '#FFF',
    fontSize: 19,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 12,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: {
    padding: 18,
    borderRadius: 22,
    backgroundColor: '#2B2F3D',
    marginVertical: 6,
  },
  metricCard: { flexGrow: 1, flexBasis: '45%', minWidth: 140 },
  metricValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFF',
    marginVertical: 12,
  },
  source: { color: '#A7F6EC', fontSize: 13, lineHeight: 21 },
  warning: {
    color: '#FFD694',
    fontSize: 13,
    lineHeight: 22,
    marginVertical: 10,
  },
});
