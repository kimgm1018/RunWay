import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { AppText, EmptyState, Icon, useToast } from '../../components';
import {
  errorCode,
  useRepositories,
  useResource,
  type CrewDetail,
  type CrewJoinPolicy,
  type CrewJoinRequest,
  type Repositories,
} from '../../data';
import type { RootStackParamList } from '../../navigation/types';
import { MissingTarget } from './MissingTarget';
import { fontFamily, spacing, ThemeProvider } from '../../theme';
import { joinPolicyLabels } from './CrewDetailScreen';
import { groupTone, NightBackground, NumText } from './look';
import { CrewJoinRequestRow } from './CrewJoinRequestRow';
import { BackButton } from '../../components/BackButton';

const policyOptions = (['APPROVAL', 'INSTANT'] as const).map(value => ({
  value,
  label: joinPolicyLabels[value],
}));

// 가입 방식 (6.2a, 6.3) on the navy page (S15P31E105-594 담당자 시안, home tone): a quiet faint white track with the
// picked option filled white with navy text. Same roles and labels as Segmented.
export function PolicySegmented<T extends string>({
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
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={[styles.segment, selected && styles.segmentOn]}
          >
            <AppText
              style={[styles.segmentText, selected && styles.segmentTextOn]}
            >
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
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
  const route = useRoute<RouteProp<RootStackParamList, 'CrewJoinRequests'>>();
  const crewId = route.params?.crewId;
  // Without an id the screen has nothing to show; no mock id stands in (S15P31E105-635).
  if (!crewId) {
    return <MissingTarget title="크루를 찾을 수 없어요" />;
  }
  return <CrewJoinRequestsContent crewId={crewId} />;
}

function CrewJoinRequestsContent({ crewId }: { crewId: string }) {
  const navigation = useNavigation();
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
  // M12 (S15P31E105-570): one change at a time, so a fast second tap cannot leave the screen
  // showing a value the server did not keep.
  const policySaving = useRef(false);
  const changePolicy = async (policy: CrewJoinPolicy) => {
    if (!crew || policy === crew.joinPolicy || policySaving.current) {
      return;
    }
    policySaving.current = true;
    setCrew({ ...crew, joinPolicy: policy });
    try {
      await crews.setJoinPolicy(crewId, policy);
    } catch (error) {
      setCrew(crew);
      const code = errorCode(error);
      if (code === 'NOT_ADMIN' || code === 'CREW_NOT_FOUND') {
        toast('가입 방식을 바꿀 수 없는 크루예요');
        reloadAll();
      } else {
        toast('가입 방식을 바꾸지 못했어요. 잠시 후 다시 시도해 주세요');
      }
    } finally {
      policySaving.current = false;
    }
  };

  const failed =
    crewResource.status === 'error' || requestResource.status === 'error';
  const canApprove = crew ? crew.memberCount < crew.capacity : false;

  return (
    // The home's navy page with faint white panels (담당자 결정: 진한 네이비), laid out as the S15P31E105-594 담당자 시안.
    <ThemeProvider tone="dark">
      <View style={styles.root}>
        <StatusBar barStyle="light-content" />
        <NightBackground />
        <SafeAreaView edges={['top']}>
          <View style={styles.header}>
            <BackButton tone="dark" onPress={() => navigation.goBack()} />
            <AppText style={styles.headerTitle} accessibilityRole="header">
              가입 신청
            </AppText>
            <View style={styles.ownerOnly}>
              <AppText style={styles.ownerOnlyText}>크루장만 보여요</AppText>
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
          <ActivityIndicator color={groupTone.sub} style={styles.loading} />
        ) : (
          <ScrollView contentContainerStyle={styles.content}>
            {/* 6.2a-CrewHero as a panel. The mockup's crew photo is left out: the crew data has none. */}
            <View style={[styles.card, styles.heroCard]}>
              <AppText style={styles.title}>{crew.name}</AppText>
              <NumText
                text={`멤버 ${crew.memberCount} / ${crew.capacity}명 · ${
                  joinPolicyLabels[crew.joinPolicy]
                }`}
                style={styles.summary}
                numberStyle={styles.summaryStrong}
              />
            </View>
            <View style={styles.section}>
              <View style={styles.rowBetween}>
                <AppText style={styles.label} accessibilityRole="header">
                  가입 방식
                </AppText>
                <AppText style={styles.note} numberOfLines={1}>
                  크루 상세·신청 화면에 같이 표시돼요
                </AppText>
              </View>
              <PolicySegmented
                options={policyOptions}
                value={crew.joinPolicy}
                onChange={changePolicy}
              />
              <AppText style={styles.sub}>
                바로 가입으로 바꾸면 대기 중인 신청은 그대로 두고, 새 신청부터
                바로 멤버가 돼요.
              </AppText>
            </View>
            {/* The mockup's thin line between 가입 방식 and the requests. */}
            <View style={styles.divider} />
            <View style={styles.section}>
              {/* 대기 중인 신청 3건 as one big line, as in the mockup. */}
              <View style={styles.requestsHead}>
                <AppText
                  style={styles.requestsTitle}
                  accessibilityRole="header"
                >
                  대기 중인 신청
                </AppText>
                <NumText
                  text={`${requests.length}건`}
                  style={styles.requestsTitle}
                />
              </View>
              {requests.length === 0 ? (
                <View style={styles.card}>
                  <AppText style={styles.cardSub}>
                    아직 대기 중인 신청이 없어요
                  </AppText>
                </View>
              ) : (
                requests.map(request => (
                  <CrewJoinRequestRow
                    key={request.userId}
                    request={request}
                    canApprove={canApprove}
                    busy={busy}
                    onDecide={approve => decide(request, approve)}
                  />
                ))
              )}
            </View>
            {/* 6.2a-ApprovalNote with the mockup's round info mark. */}
            <View style={styles.approvalNote}>
              <Icon name="alert" color={groupTone.sub} size={16} />
              <AppText style={[styles.sub, styles.flex]}>
                승인하면 신청자에게 알림이 가고 내 크루 목록에 크루와 그룹런이
                보여요. 거절하면 신청자에게 거절 알림이 가고, 다른 크루에 다시
                신청할 수 있어요. 정원이 차면 승인 버튼이 잠겨요.
              </AppText>
            </View>
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
    color: groupTone.text,
  },
  ownerOnly: {
    height: 26,
    paddingHorizontal: 11,
    borderRadius: 13,
    justifyContent: 'center',
    backgroundColor: groupTone.quiet,
  },
  ownerOnlyText: {
    fontFamily: fontFamily.bold,
    fontSize: 12,
    lineHeight: 16,
    color: groupTone.text,
  },
  content: { paddingHorizontal: 20, paddingBottom: 48, gap: 18 },
  // A faint white panel with a faint white rim on the navy page.
  card: {
    gap: 10,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: groupTone.cardLine,
    backgroundColor: groupTone.card,
  },
  // 6.2a-CrewHero.
  heroCard: { gap: spacing.xs, marginTop: spacing.sm },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: 22,
    lineHeight: 29,
    letterSpacing: -0.4,
    color: groupTone.text,
  },
  summary: {
    fontFamily: fontFamily.regular,
    fontSize: 15,
    lineHeight: 21,
    color: groupTone.sub,
  },
  summaryStrong: { color: groupTone.text },
  section: { gap: 10 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: groupTone.line,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  label: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: groupTone.text,
  },
  note: {
    flexShrink: 1,
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 16,
    color: groupTone.muted,
  },
  sub: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 19,
    color: groupTone.sub,
  },
  // 가입 방식 switch: a quiet track, the picked half white.
  segments: {
    flexDirection: 'row',
    height: 46,
    padding: 3,
    gap: 3,
    borderRadius: 12,
    backgroundColor: groupTone.quiet,
  },
  segment: {
    flex: 1,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentOn: { backgroundColor: groupTone.button },
  segmentText: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: groupTone.sub,
  },
  segmentTextOn: { color: groupTone.onButton },
  requestsHead: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  requestsTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 20,
    lineHeight: 27,
    letterSpacing: -0.4,
    color: groupTone.text,
  },
  cardSub: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 19,
    color: groupTone.sub,
  },
  // 6.2a-ApprovalNote.
  approvalNote: { flexDirection: 'row', gap: 8, paddingHorizontal: 4 },
});
