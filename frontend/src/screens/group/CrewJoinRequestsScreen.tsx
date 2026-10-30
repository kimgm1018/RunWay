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
  Backdrop,
  Card,
  EmptyState,
  IconButton,
  Segmented,
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
import {
  fontFamily,
  k1,
  radius,
  spacing,
  ThemeProvider,
  useTheme,
} from '../../theme';
import { joinPolicyLabels } from './CrewDetailScreen';

const levelLabels: Record<SelfReportedLevel, string> = {
  BEGINNER: '초급',
  INTERMEDIATE: '중급',
  ADVANCED: '고급',
};

const policyOptions = (['APPROVAL', 'INSTANT'] as const).map(value => ({
  value,
  label: joinPolicyLabels[value],
}));

// 중급 · 최근 5km 5′56″ · 3분 전 신청, or 초급 · 첫 크루 · 10.17 신청.
function requestLine(request: CrewJoinRequest, now: Date) {
  const when = isSameDay(request.requestedAt, now)
    ? `${formatRelative(request.requestedAt, now)} 신청`
    : `${formatDotDate(request.requestedAt)} 신청`;
  return [
    levelLabels[request.level],
    request.recent5kPaceSecPerKm
      ? `최근 5km ${formatPace(request.recent5kPaceSecPerKm)}`
      : null,
    request.firstCrew ? '첫 크루' : null,
    when,
  ]
    .filter(Boolean)
    .join(' · ');
}

function RequestRow({
  request,
  first,
  canApprove,
  busy,
  onDecide,
}: {
  request: CrewJoinRequest;
  first: boolean;
  canApprove: boolean;
  busy: boolean;
  onDecide: (approve: boolean) => void;
}) {
  const { colors } = useTheme();
  const { clock } = useRepositories();
  return (
    <View
      style={[
        styles.row,
        !first && {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
        },
      ]}
    >
      <View style={[styles.initial, { backgroundColor: colors.surfaceMuted }]}>
        <AppText variant="bodyStrong">{request.nickname.slice(0, 1)}</AppText>
      </View>
      <View style={styles.flex}>
        <AppText variant="bodyStrong">{`${request.nickname} · ${request.loginId}`}</AppText>
        <AppText variant="caption" tone="textSecondary">
          {requestLine(request, clock.now())}
        </AppText>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${request.nickname} 거절`}
        disabled={busy}
        onPress={() => onDecide(false)}
        style={({ pressed }) => [
          styles.decide,
          { borderColor: colors.borderStrong },
          pressed && styles.pressed,
        ]}
      >
        <AppText variant="bodyStrong">거절</AppText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${request.nickname} 승인`}
        accessibilityState={{ disabled: !canApprove }}
        disabled={busy || !canApprove}
        onPress={() => onDecide(true)}
        style={({ pressed }) => [
          styles.decide,
          styles.approve,
          (pressed || !canApprove) && styles.pressed,
        ]}
      >
        <AppText variant="bodyStrong" style={{ color: k1.night }}>
          승인
        </AppText>
      </Pressable>
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
  const { colors } = useTheme();
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
      toast(
        errorCode(error) === 'CREW_CAPACITY_EXCEEDED'
          ? '정원이 가득 차서 승인할 수 없어요'
          : '처리하지 못했어요. 잠시 후 다시 시도해 주세요',
      );
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
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colors.statusBar} />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop />
      </View>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <IconButton
            icon="back"
            accessibilityLabel="뒤로"
            onPress={() => navigation.goBack()}
          />
          <AppText style={styles.headerTitle} accessibilityRole="header">
            가입 신청
          </AppText>
          <View
            style={[styles.ownerOnly, { borderColor: colors.borderStrong }]}
          >
            <AppText variant="captionStrong" tone="textSecondary">
              크루장만 보여요
            </AppText>
          </View>
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
            <AppText variant="body" tone="textSecondary">
              {'멤버 '}
              <AppText variant="bodyStrong">{crew.memberCount}</AppText>
              {` / ${crew.capacity}명 · ${joinPolicyLabels[crew.joinPolicy]}`}
            </AppText>
          </View>
          <Card variant="deep" style={styles.section}>
            <View style={styles.rowBetween}>
              <AppText variant="heading">가입 방식</AppText>
              <AppText variant="caption" tone="textSecondary">
                크루 상세·신청 화면에 같이 표시돼요
              </AppText>
            </View>
            <Segmented
              options={policyOptions}
              value={crew.joinPolicy}
              onChange={changePolicy}
            />
            <AppText variant="caption" tone="textSecondary">
              바로 가입으로 바꾸면 대기 중인 신청은 그대로 두고, 새 신청부터
              바로 멤버가 돼요.
            </AppText>
          </Card>
          <Card variant="deep" style={styles.section}>
            <View style={styles.rowBetween}>
              <AppText variant="heading">대기 중인 신청</AppText>
              <AppText variant="body" tone="textSecondary">
                {`${requests.length}건`}
              </AppText>
            </View>
            {requests.length === 0 ? (
              <AppText variant="body" tone="textSecondary" style={styles.none}>
                대기 중인 신청이 없어요
              </AppText>
            ) : (
              <View>
                {requests.map((request, index) => (
                  <RequestRow
                    key={request.userId}
                    request={request}
                    first={index === 0}
                    canApprove={canApprove}
                    busy={busy}
                    onDecide={approve => decide(request, approve)}
                  />
                ))}
              </View>
            )}
          </Card>
          <ThemeProvider tone="dark">
            <AppText variant="caption" tone="textSecondary" style={styles.note}>
              승인하면 신청자에게 알림이 가고 내 크루 목록에 크루와 그룹런이
              보여요. 거절하면 신청자에게 거절 알림이 가고, 다른 크루에 다시
              신청할 수 있어요. 정원이 차면 승인 버튼이 잠겨요.
            </AppText>
          </ThemeProvider>
        </ScrollView>
      )}
    </View>
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
    gap: spacing.xl,
    paddingHorizontal: spacing.screen,
  },
  headerTitle: {
    flex: 1,
    fontFamily: fontFamily.medium,
    fontSize: 19,
    lineHeight: 26,
  },
  ownerOnly: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  content: { padding: spacing.screen, gap: spacing.lg, paddingBottom: 48 },
  titleBlock: {
    gap: spacing.xs,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  title: { fontFamily: fontFamily.medium, fontSize: 28, lineHeight: 38 },
  section: { gap: spacing.md },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.xl,
  },
  initial: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  decide: {
    height: 38,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
  },
  approve: { backgroundColor: k1.ice, borderColor: k1.ice },
  pressed: { opacity: 0.5 },
  none: { paddingVertical: spacing.xl },
  note: { paddingHorizontal: spacing.xs, lineHeight: 20 },
});
