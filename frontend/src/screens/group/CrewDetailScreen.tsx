import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AppText,
  Backdrop,
  BottomSheet,
  Card,
  EmptyState,
  Icon,
  IconButton,
  type IconName,
  useToast,
} from '../../components';
import {
  errorCode,
  useRepositories,
  useResource,
  type CrewDetail,
  type CrewJoinPolicy,
  type CrewMember,
  type Repositories,
} from '../../data';
import { formatPace } from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import type { RootStackParamList } from '../../navigation/types';
import {
  fontFamily,
  k1,
  radius,
  spacing,
  ThemeProvider,
  useTheme,
} from '../../theme';
import { FooterButton } from './GroupRunDetailScreen';
import { BottomFade, useGroupRunDraft } from './parts';

// The rows 구성원 shows before 모두 보기.
const previewCount = 4;

// 6.2m: 정원 제한 off means the most a crew can hold (M03 allows 1–200).
const maxCapacity = 200;

export const joinPolicyLabels: Record<CrewJoinPolicy, string> = {
  APPROVAL: '승인제',
  INSTANT: '바로 가입',
};

// 6.2m 정원 제한: an ice track with a dark knob when on.
function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      hitSlop={8}
      style={[styles.track, value ? styles.trackOn : styles.trackOff]}
    >
      <View style={[styles.knob, value ? styles.knobOn : styles.knobOff]} />
    </Pressable>
  );
}

function ManageBody({
  memberCount,
  limited,
  capacityText,
  invalid,
  onLimited,
  onCapacity,
}: {
  memberCount: number;
  limited: boolean;
  capacityText: string;
  invalid: boolean;
  onLimited: (value: boolean) => void;
  onCapacity: (text: string) => void;
}) {
  const { colors } = useTheme();
  const capacity = limited ? Number(capacityText) : maxCapacity;
  const ratio = invalid || !capacity ? 0 : Math.min(1, memberCount / capacity);
  return (
    <>
      <View style={styles.rowBetween}>
        <AppText variant="heading">크루 관리</AppText>
        <View style={[styles.ownerOnly, { borderColor: colors.borderStrong }]}>
          <AppText variant="captionStrong" tone="textSecondary">
            크루장만 보여요
          </AppText>
        </View>
      </View>
      <View style={styles.manageRow}>
        <View style={styles.flex}>
          <AppText variant="bodyStrong">정원 제한</AppText>
          <AppText variant="caption" tone="textSecondary">
            {`끄면 기본 정원 ${maxCapacity}명이 적용돼요`}
          </AppText>
        </View>
        <Toggle label="정원 제한" value={limited} onChange={onLimited} />
      </View>
      {limited ? (
        <View
          style={[
            styles.manageRow,
            styles.lined,
            { borderColor: colors.border },
          ]}
        >
          <AppText variant="bodyStrong" style={styles.flex}>
            정원
          </AppText>
          <View
            style={[
              styles.capacityField,
              { borderColor: invalid ? k1.coral : colors.text },
            ]}
          >
            <TextInput
              accessibilityLabel="정원"
              value={capacityText}
              onChangeText={text => onCapacity(text.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              maxLength={3}
              selectionColor={colors.accent}
              style={[styles.capacityInput, { color: colors.text }]}
            />
            <AppText variant="caption" tone="textSecondary">
              명
            </AppText>
          </View>
        </View>
      ) : null}
      <View style={[styles.lined, { borderColor: colors.border }]}>
        <View style={styles.rowBetween}>
          <AppText variant="body" tone="textSecondary">
            현재 인원 / 정원
          </AppText>
          <AppText variant="bodyStrong">
            {`${memberCount} / ${invalid ? '–' : capacity}명`}
          </AppText>
        </View>
        <View style={[styles.bar, { backgroundColor: colors.surfaceMuted }]}>
          <View
            style={[
              styles.barFill,
              { width: `${ratio * 100}%`, backgroundColor: colors.text },
            ]}
          />
        </View>
        <AppText
          variant="caption"
          style={{ color: invalid ? k1.coral : colors.textSecondary }}
        >
          {`최대 ${maxCapacity}명까지 정할 수 있어요 · 현재 인원보다 적게는 못 줄여요`}
        </AppText>
      </View>
    </>
  );
}

// 6.2m 크루 관리, only for the leader: 정원 제한 and 정원 with a bar of how full the crew is.
// The body reads the theme inside the dark card, so its lines and text turn light.
function ManageCard(props: React.ComponentProps<typeof ManageBody>) {
  return (
    <Card variant="deep" style={styles.section}>
      <ManageBody {...props} />
    </Card>
  );
}

// 지역 · 인원 boxes under the title.
function Fact({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <Card variant="deep" style={[styles.flex, styles.fact]}>
      <AppText variant="caption" tone="textSecondary">
        {label}
      </AppText>
      <View style={styles.factLine}>
        <AppText style={styles.factValue}>{value}</AppText>
        {unit ? (
          <AppText variant="caption" tone="textSecondary">
            {unit}
          </AppText>
        ) : null}
      </View>
    </Card>
  );
}

function MemberRow({ member, first }: { member: CrewMember; first: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.memberRow,
        !first && {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
        },
      ]}
    >
      <View style={[styles.initial, { backgroundColor: colors.surfaceMuted }]}>
        <AppText variant="bodyStrong">{member.nickname.slice(0, 1)}</AppText>
      </View>
      <AppText variant="bodyStrong">
        {member.isMe ? `${member.nickname} (나)` : member.nickname}
      </AppText>
      {member.isOwner ? (
        <View
          style={[styles.ownerTag, { backgroundColor: colors.surfaceMuted }]}
        >
          <AppText variant="captionStrong">크루장</AppText>
        </View>
      ) : null}
      <View style={styles.flex} />
      {member.recentPaceSecPerKm ? (
        <AppText style={styles.pace}>
          {formatPace(member.recentPaceSecPerKm)}
          <AppText variant="caption" tone="textSecondary">
            /km
          </AppText>
        </AppText>
      ) : null}
    </View>
  );
}

// 6.2x 가입 신청 불가 and 6.2b 가입 신청 완료: an icon, a title and a line over the sheet's buttons.
function SheetBody({
  icon,
  title,
  count,
  body,
  children,
}: {
  icon: IconName;
  title: string;
  count?: string;
  body: string;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.sheet}>
      <View
        style={[styles.sheetIcon, { backgroundColor: colors.surfaceMuted }]}
      >
        <Icon name={icon} color={colors.text} size={22} />
      </View>
      <AppText style={styles.sheetTitle}>
        {title}
        {count ? (
          <AppText variant="body" tone="textSecondary">
            {count}
          </AppText>
        ) : null}
      </AppText>
      <AppText variant="body" tone="textSecondary">
        {body}
      </AppText>
      <View style={styles.sheetButtons}>{children}</View>
    </View>
  );
}

// 6.2m 가입 신청 N건: a near-black box that opens 6.2a, only for the crew leader.
function RequestsLink({
  crewId,
  count,
  policy,
}: {
  crewId: string;
  count: number;
  policy: CrewJoinPolicy;
}) {
  const navigation = useNavigation();
  return (
    <ThemeProvider tone="dark">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`가입 신청 ${count}건`}
        onPress={() => navigation.navigate('CrewJoinRequests', { crewId })}
        style={({ pressed }) => [styles.requests, pressed && styles.pressed]}
      >
        <View style={styles.flex}>
          <AppText variant="heading">{`가입 신청 ${count}건`}</AppText>
          <AppText variant="caption" tone="textSecondary">
            {`${joinPolicyLabels[policy]} · 신청자를 확인하고 승인·거절해요`}
          </AppText>
        </View>
        <View style={styles.round}>
          <Icon name="forward" color={k1.ice} size={16} />
        </View>
      </Pressable>
    </ThemeProvider>
  );
}

const loadCrew = (
  repositories: Repositories,
  crewId: string,
  _version: number,
) => repositories.crews.get(crewId);

// 6.2 크루 상세. The bottom button follows my place in the crew: 가입 신청 (→ 6.2b),
// 정원 마감 (6.2f → 6.2x), 승인 대기 or 가입한 크루 (→ 6.0). The leader sees the requests and
// 크루 관리 instead, and saves the capacity with the bottom button (6.2m).
export function CrewDetailScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'CrewDetail'>>();
  const crewId = route.params?.crewId ?? 'crew-gwangalli';
  const { colors } = useTheme();
  const { crews } = useRepositories();
  const toast = useToast();
  const { changed } = useGroupRunDraft();
  const [version, setVersion] = useState(0);
  const detail = useResource(
    useCallback(
      (repositories: Repositories) => loadCrew(repositories, crewId, version),
      [crewId, version],
    ),
  );
  const { reload } = detail;
  // Coming back from 6.2a shows the new member count and requests.
  useFocusEffect(useCallback(() => reload(), [reload]));
  // The last loaded crew stays while it reloads, so the screen does not flash a spinner.
  const [crew, setCrew] = useState<CrewDetail | null>(null);
  const [limited, setLimited] = useState(true);
  const [capacityText, setCapacityText] = useState('');
  const loaded = detail.status === 'ready' ? detail.data : null;
  useEffect(() => {
    if (loaded) {
      setCrew(loaded);
      setLimited(loaded.capacity < maxCapacity);
      setCapacityText(String(loaded.capacity));
    }
  }, [loaded]);
  const [allMembers, setAllMembers] = useState(false);
  const [sheet, setSheet] = useState<'full' | 'sent' | 'joined' | null>(null);
  const [busy, setBusy] = useState(false);

  const requestJoin = async (current: CrewDetail) => {
    setBusy(true);
    try {
      const membership = await crews.requestJoin(current.id);
      // 6.0 shows the crew from now on, as 승인 대기 until the leader approves.
      changed();
      setSheet(membership === 'MEMBER' ? 'joined' : 'sent');
      reload();
    } catch (error) {
      if (errorCode(error) === 'CREW_CAPACITY_EXCEEDED') {
        setSheet('full');
      } else {
        toast('가입 신청을 보내지 못했어요. 잠시 후 다시 시도해 주세요');
      }
    } finally {
      setBusy(false);
    }
  };
  const toMyCrews = () => {
    setSheet(null);
    navigateTo(navigation, 'MyCrews');
  };

  const full = crew ? crew.memberCount >= crew.capacity : false;
  const draftCapacity = limited ? Number(capacityText) : maxCapacity;
  const invalid =
    !!crew &&
    (!Number.isInteger(draftCapacity) ||
      draftCapacity < Math.max(1, crew.memberCount) ||
      draftCapacity > maxCapacity);
  const save = async (current: CrewDetail) => {
    setBusy(true);
    try {
      await crews.updateCapacity(current.id, draftCapacity);
      toast('정원을 저장했어요');
      reload();
    } catch {
      toast('정원을 저장하지 못했어요. 잠시 후 다시 시도해 주세요');
    } finally {
      setBusy(false);
    }
  };
  const shown = crew
    ? allMembers
      ? crew.members
      : crew.members.slice(0, previewCount)
    : [];

  const footer = !crew
    ? null
    : crew.amOwner
    ? {
        title: '저장',
        primary: true,
        disabled: invalid || draftCapacity === crew.capacity,
        onPress: () => save(crew),
      }
    : crew.myMembership === 'MEMBER'
    ? {
        title: '가입한 크루예요 · 내 크루에서 보기',
        primary: true,
        onPress: toMyCrews,
      }
    : crew.myMembership === 'PENDING'
    ? {
        title: '승인 대기 중 · 내 크루에서 보기',
        primary: false,
        onPress: toMyCrews,
      }
    : full
    ? {
        title: '가입 신청 · 정원 마감',
        primary: false,
        onPress: () => setSheet('full'),
      }
    : { title: '가입 신청', primary: true, onPress: () => requestJoin(crew) };

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
        </View>
      </SafeAreaView>
      {detail.status === 'error' ? (
        <EmptyState
          icon="alert"
          title="크루를 불러오지 못했어요"
          actionLabel="다시 시도"
          onAction={() => setVersion(value => value + 1)}
        />
      ) : !crew || crew.id !== crewId ? (
        <ActivityIndicator style={styles.loading} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View
            style={[
              styles.status,
              {
                backgroundColor: full ? colors.surfaceMuted : colors.accent,
              },
            ]}
          >
            <AppText
              variant="captionStrong"
              style={{ color: full ? colors.text : colors.onAccent }}
            >
              {full
                ? `정원 마감 ${crew.memberCount}/${crew.capacity}`
                : `모집 중 ${crew.memberCount}/${crew.capacity} · ${
                    joinPolicyLabels[crew.joinPolicy]
                  }`}
            </AppText>
          </View>
          <AppText style={styles.title} accessibilityRole="header">
            {crew.name}
          </AppText>
          <View style={styles.facts}>
            <Fact label="지역" value={crew.area} />
            <Fact
              label="인원"
              value={String(crew.memberCount)}
              unit={`/ ${crew.capacity}명`}
            />
          </View>
          {crew.amOwner ? (
            <>
              <RequestsLink
                crewId={crew.id}
                count={crew.pendingRequestCount ?? 0}
                policy={crew.joinPolicy}
              />
              <ManageCard
                memberCount={crew.memberCount}
                limited={limited}
                capacityText={capacityText}
                invalid={invalid}
                onLimited={setLimited}
                onCapacity={setCapacityText}
              />
            </>
          ) : null}
          {crew.description ? (
            <Card variant="deep" style={styles.section}>
              <AppText variant="heading">소개</AppText>
              <AppText variant="body">{crew.description}</AppText>
            </Card>
          ) : null}
          <Card variant="deep" style={styles.section}>
            <View style={styles.rowBetween}>
              <AppText variant="heading">구성원</AppText>
              <AppText variant="body" tone="textSecondary">
                {`${crew.memberCount}명`}
              </AppText>
            </View>
            <View>
              {shown.map((member, index) => (
                <MemberRow
                  key={member.userId}
                  member={member}
                  first={index === 0}
                />
              ))}
            </View>
            {crew.members.length > previewCount ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  allMembers
                    ? '구성원 접기'
                    : `구성원 ${crew.memberCount}명 모두 보기`
                }
                onPress={() => setAllMembers(value => !value)}
                style={styles.more}
              >
                <AppText variant="bodyStrong" style={styles.underline}>
                  {allMembers
                    ? '접기'
                    : `구성원 ${crew.memberCount}명 모두 보기`}
                </AppText>
              </Pressable>
            ) : null}
          </Card>
        </ScrollView>
      )}
      {footer ? (
        <ThemeProvider tone="dark">
          <SafeAreaView edges={['bottom']} style={styles.footer}>
            <BottomFade />
            <FooterButton
              title={footer.title}
              primary={footer.primary}
              disabled={busy || ('disabled' in footer && footer.disabled)}
              onPress={footer.onPress}
            />
          </SafeAreaView>
        </ThemeProvider>
      ) : null}
      <ThemeProvider tone="dark">
        <BottomSheet visible={sheet !== null} onClose={() => setSheet(null)}>
          {crew && sheet === 'full' ? (
            <SheetBody
              icon="group"
              title="정원이 가득 찼어요"
              count={` (${crew.memberCount} / ${crew.capacity}명)`}
              body={`‘${crew.name}’는 지금 가입 신청을 받을 수 없어요. 자리가 나면 다시 신청할 수 있어요.`}
            >
              <FooterButton title="닫기" onPress={() => setSheet(null)} />
              <FooterButton
                title="다른 크루 둘러보기"
                primary
                onPress={() => {
                  setSheet(null);
                  navigateTo(navigation, 'CrewRecruit');
                }}
              />
            </SheetBody>
          ) : crew && sheet === 'sent' ? (
            <SheetBody
              icon="check"
              title="가입 신청을 보냈어요"
              body="크루장이 승인하면 내 크루에서 그룹런을 볼 수 있어요. 승인 전에는 ‘승인 대기’로 보여요."
            >
              <FooterButton title="내 크루로" primary onPress={toMyCrews} />
            </SheetBody>
          ) : crew && sheet === 'joined' ? (
            <SheetBody
              icon="check"
              title="크루에 가입했어요"
              body={`‘${crew.name}’는 바로 가입 크루예요. 이제 내 크루에서 그룹런을 볼 수 있어요.`}
            >
              <FooterButton title="내 크루로" primary onPress={toMyCrews} />
            </SheetBody>
          ) : null}
        </BottomSheet>
      </ThemeProvider>
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
    paddingHorizontal: spacing.screen,
  },
  // Room under the last card for the floating button.
  content: { padding: spacing.screen, paddingBottom: 120, gap: spacing.lg },
  status: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  title: { fontFamily: fontFamily.medium, fontSize: 28, lineHeight: 38 },
  facts: { flexDirection: 'row', gap: spacing.lg },
  fact: { gap: spacing.xs },
  factLine: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  factValue: { fontFamily: fontFamily.regular, fontSize: 22, lineHeight: 30 },
  requests: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: k1.night,
  },
  // DESIGN.md 2-1: a pressed box shrinks to 96%.
  pressed: { transform: [{ scale: 0.96 }] },
  round: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { gap: spacing.md },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.lg,
  },
  initial: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ownerTag: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xxs,
    borderRadius: radius.pill,
  },
  pace: { fontFamily: fontFamily.medium, fontSize: 16, lineHeight: 22 },
  more: { alignSelf: 'flex-start', paddingVertical: spacing.xs },
  underline: { textDecorationLine: 'underline' },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.screen,
    paddingBottom: spacing.xl,
  },
  sheet: { gap: spacing.xl },
  ownerOnly: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  manageRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  lined: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.xl,
    gap: spacing.md,
  },
  track: {
    width: 52,
    height: 30,
    borderRadius: 15,
    padding: 3,
    justifyContent: 'center',
  },
  trackOn: { backgroundColor: k1.ice },
  trackOff: { backgroundColor: 'rgba(255,255,255,0.18)' },
  knob: { width: 24, height: 24, borderRadius: 12 },
  knobOn: { alignSelf: 'flex-end', backgroundColor: k1.night },
  knobOff: { alignSelf: 'flex-start', backgroundColor: k1.ice },
  capacityField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    height: 44,
    minWidth: 104,
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.pill,
    borderWidth: 1.5,
  },
  capacityInput: {
    flex: 1,
    height: 44,
    padding: 0,
    includeFontPadding: false,
    textAlignVertical: 'center',
    textAlign: 'right',
    fontFamily: fontFamily.regular,
    fontSize: 22,
  },
  bar: { height: 4, borderRadius: 2, overflow: 'hidden' },
  barFill: { height: 4, borderRadius: 2 },
  sheetIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetTitle: { fontFamily: fontFamily.medium, fontSize: 22, lineHeight: 30 },
  sheetButtons: { flexDirection: 'row', gap: spacing.md },
});
