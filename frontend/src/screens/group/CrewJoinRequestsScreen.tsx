import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AppText,
  EmptyState,
  PressableScale,
  useToast,
} from '../../components';
import {
  errorCode,
  useRepositories,
  useResource,
  type CrewDetail,
  type CrewJoinPolicy,
  type CrewJoinRequest,
  type Repositories,
  type SelfReportedLevel,
} from '../../data';
import {
  formatDotDate,
  formatPace,
  formatRelative,
  isSameDay,
} from '../../format';
import type { RootStackParamList } from '../../navigation/types';
import { fontFamily, spacing, ThemeProvider } from '../../theme';
import { joinPolicyLabels } from './CrewDetailScreen';
import {
  MistBackground,
  groupLook,
  insetTrackLight,
  Raised,
  SectionLabel,
} from './look';
import { BackButton } from '../../components/BackButton';

const levelLabels: Record<SelfReportedLevel, string> = {
  BEGINNER: '초급',
  INTERMEDIATE: '중급',
  ADVANCED: '고급',
};

const policyOptions = (['APPROVAL', 'INSTANT'] as const).map(value => ({
  value,
  label: joinPolicyLabels[value],
}));

// 가입 방식 on the dark screens (6.2a-JoinModeCard, 6.3): the picked option a raised white pill on a
// pressed-in track, like the 6.0 · 6.1 tabs. Same roles and labels as Segmented.
export function DarkSegmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View accessibilityRole="radiogroup" style={styles.segments}>
      {options.map(option => {
        const selected = option.value === value;
        const label = (
          <AppText
            style={[styles.segmentText, selected && styles.segmentTextOn]}
          >
            {option.label}
          </AppText>
        );
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={styles.segment}
          >
            {selected ? (
              <Raised tone="navy" style={styles.segmentOn}>
                {label}
              </Raised>
            ) : (
              label
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

// 중급 · 최근 5km 5′56″ · 3분 전 신청, or 초급 · 첫 크루 · 10.17 신청.
function requestLine(request: CrewJoinRequest, now: Date) {
  const when = isSameDay(request.requestedAt, now)
    ? `${formatRelative(request.requestedAt, now)} 신청`
    : `${formatDotDate(request.requestedAt)} 신청`;
  return [
    request.level ? levelLabels[request.level] : null,
    request.recent5kPaceSecPerKm
      ? `최근 5km ${formatPace(request.recent5kPaceSecPerKm)}`
      : null,
    request.firstCrew ? '첫 크루' : null,
    when,
  ]
    .filter(Boolean)
    .join(' · ');
}

// One request without dividers (6.2a-PendingRequests): 거절 dark glass, 승인 raised white.
function RequestRow({
  request,
  canApprove,
  busy,
  onDecide,
}: {
  request: CrewJoinRequest;
  canApprove: boolean;
  busy: boolean;
  onDecide: (approve: boolean) => void;
}) {
  const { clock } = useRepositories();
  return (
    <View style={styles.row}>
      <View style={styles.initial}>
        <AppText style={styles.initialText}>
          {request.nickname.slice(0, 1)}
        </AppText>
      </View>
      <View style={styles.flex}>
        <AppText style={styles.name}>
          {request.loginId
            ? `${request.nickname} · ${request.loginId}`
            : request.nickname}
        </AppText>
        <AppText style={styles.sub}>
          {requestLine(request, clock.now())}
        </AppText>
      </View>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`${request.nickname} 거절`}
        disabled={busy}
        onPress={() => onDecide(false)}
      >
        <Raised tone="navy" style={styles.decide}>
          <AppText style={styles.decideTextLight}>거절</AppText>
        </Raised>
      </PressableScale>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`${request.nickname} 승인`}
        accessibilityState={{ disabled: !canApprove }}
        disabled={busy || !canApprove}
        onPress={() => onDecide(true)}
        style={[!canApprove && styles.locked]}
      >
        <Raised tone="white" style={styles.decide}>
          <AppText style={styles.decideTextDark}>승인</AppText>
        </Raised>
      </PressableScale>
    </View>
  );
}

const loadCrew = (repositories: Repositories, crewId: string) =>
  repositories.crews.get(crewId);
const loadRequests = (repositories: Repositories, crewId: string) =>
  repositories.crews.listJoinRequests(crewId);

// 6.2a 가입 신청 관리 (crew leader only): 가입 방식 and the requests waiting for a decision.
// Approving is locked once the crew is full (M06).
export function CrewJoinRequestsScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'CrewJoinRequests'>>();
  const crewId = route.params?.crewId ?? 'crew-minrak-night';
  const { crews } = useRepositories();
  const toast = useToast();
  const crewResource = useResource(
    useCallback(
      (repositories: Repositories) => loadCrew(repositories, crewId),
      [crewId],
    ),
  );
  const requestResource = useResource(
    useCallback(
      (repositories: Repositories) => loadRequests(repositories, crewId),
      [crewId],
    ),
  );
  // The last loaded data stays while a decision reloads it.
  const [crew, setCrew] = useState<CrewDetail | null>(null);
  const [requests, setRequests] = useState<CrewJoinRequest[] | null>(null);
  const loadedCrew = crewResource.status === 'ready' ? crewResource.data : null;
  const loadedRequests =
    requestResource.status === 'ready' ? requestResource.data : null;
  useEffect(() => {
    if (loadedCrew) {
      setCrew(loadedCrew);
    }
  }, [loadedCrew]);
  useEffect(() => {
    if (loadedRequests) {
      setRequests(loadedRequests);
    }
  }, [loadedRequests]);
  const [busy, setBusy] = useState(false);

  const reloadAll = () => {
    crewResource.reload();
    requestResource.reload();
  };
  const decide = async (request: CrewJoinRequest, approve: boolean) => {
    setBusy(true);
    try {
      await crews.decideJoinRequest(crewId, request.userId, approve);
      toast(
        approve
          ? `${request.nickname}님이 크루 멤버가 됐어요`
          : `${request.nickname}님의 신청을 거절했어요`,
      );
      reloadAll();
    } catch (error) {
      const code = errorCode(error);
      toast(
        code === 'CREW_CAPACITY_EXCEEDED'
          ? '정원이 가득 차서 승인할 수 없어요'
          : code === 'NOT_PENDING'
          ? '이미 처리된 신청이에요'
          : '처리하지 못했어요. 잠시 후 다시 시도해 주세요',
      );
      if (code === 'NOT_PENDING') {
        reloadAll();
      }
    } finally {
      setBusy(false);
    }
  };
  const changePolicy = async (policy: CrewJoinPolicy) => {
    if (!crew || policy === crew.joinPolicy) {
      return;
    }
    setCrew({ ...crew, joinPolicy: policy });
    try {
      await crews.setJoinPolicy(crewId, policy);
    } catch {
      setCrew(crew);
      toast('가입 방식을 바꾸지 못했어요. 잠시 후 다시 시도해 주세요');
    }
  };

  const failed =
    crewResource.status === 'error' || requestResource.status === 'error';
  const canApprove = crew ? crew.memberCount < crew.capacity : false;

  return (
    // 6.0~6.3 sit on --bg-analysis-dark, so the whole screen takes the dark theme.
    // On the mist like the rest of 6.0~6.3 (S15P31E105-483).
    <ThemeProvider tone="light">
      <View style={styles.root}>
        <StatusBar barStyle="dark-content" />
        <MistBackground />
        <SafeAreaView edges={['top']}>
          <View style={styles.header}>
            <BackButton tone="light" onPress={() => navigation.goBack()} />
            <AppText style={styles.headerTitle} accessibilityRole="header">
              가입 신청
            </AppText>
            <Raised tone="navy" style={styles.ownerOnly}>
              <AppText style={styles.ownerOnlyText}>크루장만 보여요</AppText>
            </Raised>
          </View>
        </SafeAreaView>
        {failed ? (
          <EmptyState
            icon="alert"
            title="가입 신청을 불러오지 못했어요"
            actionLabel="다시 시도"
            onAction={reloadAll}
          />
        ) : !crew || !requests ? (
          <ActivityIndicator style={styles.loading} />
        ) : (
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.titleBlock}>
              <AppText style={styles.title}>{crew.name}</AppText>
              <AppText style={styles.summary}>
                {'멤버 '}
                <AppText style={styles.summaryStrong}>
                  {crew.memberCount}
                </AppText>
                {` / ${crew.capacity}명 · ${joinPolicyLabels[crew.joinPolicy]}`}
              </AppText>
            </View>
            <View style={styles.section}>
              <View style={styles.rowBetween}>
                <SectionLabel tone="mist">가입 방식</SectionLabel>
                <AppText style={styles.note} numberOfLines={1}>
                  크루 상세·신청 화면에 같이 표시돼요
                </AppText>
              </View>
              <DarkSegmented
                options={policyOptions}
                value={crew.joinPolicy}
                onChange={changePolicy}
              />
              <AppText style={styles.sub}>
                바로 가입으로 바꾸면 대기 중인 신청은 그대로 두고, 새 신청부터
                바로 멤버가 돼요.
              </AppText>
            </View>
            <View style={styles.section}>
              <View style={styles.rowBetween}>
                <SectionLabel tone="mist">대기 중인 신청</SectionLabel>
                <AppText style={styles.count}>{`${requests.length}건`}</AppText>
              </View>
              {requests.length === 0 ? (
                <AppText style={[styles.sub, styles.none]}>
                  대기 중인 신청이 없어요
                </AppText>
              ) : (
                <View>
                  {requests.map(request => (
                    <RequestRow
                      key={request.userId}
                      request={request}
                      canApprove={canApprove}
                      busy={busy}
                      onDecide={approve => decide(request, approve)}
                    />
                  ))}
                </View>
              )}
            </View>
            <AppText style={[styles.sub, styles.approvalNote]}>
              승인하면 신청자에게 알림이 가고 내 크루 목록에 크루와 그룹런이
              보여요. 거절하면 신청자에게 거절 알림이 가고, 다른 크루에 다시
              신청할 수 있어요. 정원이 차면 승인 버튼이 잠겨요.
            </AppText>
          </ScrollView>
        )}
      </View>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  loading: { marginTop: spacing.xxxl },
  header: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: 16,
  },
  headerTitle: {
    flex: 1,
    fontFamily: fontFamily.bold,
    fontSize: 19,
    lineHeight: 26,
    letterSpacing: -0.4,
    color: groupLook.onLight,
  },
  ownerOnly: {
    height: 26,
    paddingHorizontal: 11,
    borderRadius: 13,
    justifyContent: 'center',
  },
  ownerOnlyText: {
    fontFamily: fontFamily.bold,
    fontSize: 12,
    lineHeight: 16,
    color: groupLook.onDark,
  },
  content: { paddingHorizontal: 16, paddingBottom: 48 },
  // 6.2a-CrewHero: the crew name and its member line.
  titleBlock: { gap: spacing.xs, marginTop: spacing.xl },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: 30,
    lineHeight: 38,
    letterSpacing: -0.6,
    color: groupLook.onLight,
  },
  summary: {
    fontFamily: fontFamily.regular,
    fontSize: 15,
    lineHeight: 21,
    color: groupLook.onLightSub,
  },
  summaryStrong: { fontFamily: fontFamily.bold, color: groupLook.onLight },
  section: { gap: spacing.md, marginTop: spacing.xxl },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  note: {
    flexShrink: 1,
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 16,
    color: groupLook.onLightMuted,
  },
  count: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 17,
    color: groupLook.onLightSub,
  },
  sub: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 19,
    color: groupLook.onLightSub,
  },
  // 가입 방식 switch: 44 high on a pressed-in track (6.2a-JoinModeCard).
  segments: {
    flexDirection: 'row',
    height: 44,
    padding: 4,
    gap: 4,
    borderRadius: 22,
    backgroundColor: groupLook.lightButton,
    boxShadow: insetTrackLight,
  },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  segmentOn: {
    alignSelf: 'stretch',
    flex: 1,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentText: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: groupLook.onLightSub,
  },
  segmentTextOn: { color: groupLook.onDark },
  // 6.2a-PendingRequests rows.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: spacing.lg,
  },
  initial: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: groupLook.lightFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialText: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: groupLook.onLight,
  },
  name: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    lineHeight: 21,
    color: groupLook.onLight,
  },
  decide: {
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 19,
    justifyContent: 'center',
  },
  decideTextLight: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 19,
    color: groupLook.onDark,
  },
  decideTextDark: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 19,
    color: groupLook.navy,
  },
  locked: { opacity: 0.5 },
  none: { paddingVertical: spacing.xl },
  // 6.2a-ApprovalNote.
  approvalNote: { marginTop: spacing.xxl, paddingHorizontal: spacing.xs },
});
