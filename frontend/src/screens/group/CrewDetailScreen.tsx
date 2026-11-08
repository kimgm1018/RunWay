import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  BottomSheet,
  EmptyState,
  Icon,
  type IconName,
  PressableScale,
  Toggle,
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
import {
  MistBackground,
  GroupCta,
  groupLook,
  Raised,
  SectionLabel,
} from './look';
import { useGroupRunDraft } from './parts';
import { BackButton } from '../../components/BackButton';

// The rows 구성원 shows before 모두 보기.
const previewCount = 4;

// 6.2m: 정원 제한 off means the most a crew can hold (M03 allows 1–200).
const maxCapacity = 200;

export const joinPolicyLabels: Record<CrewJoinPolicy, string> = {
  APPROVAL: '승인제',
  INSTANT: '바로 가입',
};

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
        <SectionLabel tone="mist">크루 관리</SectionLabel>
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
// A section on the dark screen, no card (runway-group-handoff).
function ManageCard(props: React.ComponentProps<typeof ManageBody>) {
  return (
    <View style={styles.section}>
      <ManageBody {...props} />
    </View>
  );
}

// 지역 · 인원 under the title: two columns, each with a line on its left (6.2-InfoStats).
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
    <View style={[styles.flex, styles.fact]}>
      <AppText style={styles.factLabel}>{label}</AppText>
      <View style={styles.factLine}>
        <AppText style={styles.factValue}>{value}</AppText>
        {unit ? <AppText style={styles.factUnit}>{unit}</AppText> : null}
      </View>
    </View>
  );
}

// A member line without dividers (6.2-MembersCard).
function MemberRow({
  member,
  onRemove,
  disabled,
}: {
  member: CrewMember;
  onRemove?: () => void;
  disabled: boolean;
}) {
  return (
    <View style={styles.memberRow}>
      <View style={styles.initial}>
        <AppText style={styles.initialText}>
          {member.nickname.slice(0, 1)}
        </AppText>
      </View>
      <AppText style={styles.memberName}>
        {member.isMe ? `${member.nickname} (나)` : member.nickname}
      </AppText>
      {member.isOwner ? (
        <Raised tone="navy" style={styles.ownerTag}>
          <AppText style={styles.ownerTagText}>크루장</AppText>
        </Raised>
      ) : null}
      <View style={styles.flex} />
      {member.recentPaceSecPerKm ? (
        <AppText style={styles.pace}>
          {formatPace(member.recentPaceSecPerKm)}
          <AppText style={styles.paceUnit}>/km</AppText>
        </AppText>
      ) : null}
      {onRemove ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${member.nickname} 내보내기`}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onRemove}
          style={styles.removeMember}
        >
          <AppText variant="captionStrong" tone="danger">
            내보내기
          </AppText>
        </Pressable>
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
    <ThemeProvider tone="light">
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`가입 신청 ${count}건`}
        onPress={() => navigation.navigate('CrewJoinRequests', { crewId })}
        style={styles.requests}
      >
        <View style={styles.flex}>
          <AppText variant="heading">{`가입 신청 ${count}건`}</AppText>
          <AppText variant="caption" tone="textSecondary">
            {`${joinPolicyLabels[policy]} · 신청자를 확인하고 승인·거절해요`}
          </AppText>
        </View>
        <View style={styles.round}>
          <Icon name="forward" color={groupLook.onLight} size={16} />
        </View>
      </PressableScale>
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
  const [sheet, setSheet] = useState<
    | 'full'
    | 'sent'
    | 'joined'
    | 'leave'
    | 'ownerLeave'
    | 'remove'
    | 'dissolve'
    | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<CrewMember | null>(null);
  const removing = useRef(false);
  const membershipAction = useRef(false);
  const [successorId, setSuccessorId] = useState<string | null>(null);
  const successors =
    crew?.members.filter(member => !member.isMe && !member.isOwner) ?? [];
  const removeMember = async () => {
    if (
      busy ||
      removing.current ||
      !crew?.amOwner ||
      !removeTarget ||
      removeTarget.isMe ||
      removeTarget.isOwner
    )
      return;
    const target = removeTarget;
    removing.current = true;
    setBusy(true);
    try {
      await crews.removeMember(crew.id, target.userId);
      // 요청이 성공한 뒤에만 목록과 인원을 변경한다. 실패 시 기존 목록을 유지한다.
      setCrew(current =>
        current
          ? {
              ...current,
              members: current.members.filter(
                member => member.userId !== target.userId,
              ),
              memberCount: Math.max(0, current.memberCount - 1),
            }
          : current,
      );
      changed();
      setSheet(null);
      setRemoveTarget(null);
      toast(`${target.nickname}님을 크루에서 내보냈어요`);
    } catch (error) {
      const messages = {
        NOT_ADMIN: '크루장만 멤버를 내보낼 수 있어요',
        CANNOT_REMOVE_OWNER: '크루장은 내보낼 수 없어요',
        MEMBER_NOT_FOUND: '이미 크루에서 나간 멤버예요',
      };
      const code = errorCode(error);
      toast(
        code in messages
          ? messages[code as keyof typeof messages]
          : '멤버를 내보내지 못했어요. 잠시 후 다시 시도해 주세요',
      );
    } finally {
      removing.current = false;
      setBusy(false);
    }
  };

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
      } else if (errorCode(error) === 'ALREADY_MEMBER_OR_PENDING') {
        // Asked from another device already: show where it stands.
        toast('이미 가입했거나 승인을 기다리는 크루예요');
        reload();
      } else {
        toast('가입 신청을 보내지 못했어요. 잠시 후 다시 시도해 주세요');
      }
    } finally {
      setBusy(false);
    }
  };
  // M08: 후임을 선택한 경우에만 크루장 권한을 이양하고 탈퇴한다.
  const leave = async (current: CrewDetail, successorUserId?: string) => {
    if (
      busy ||
      membershipAction.current ||
      (current.amOwner && !successorUserId)
    )
      return;
    membershipAction.current = true;
    setBusy(true);
    try {
      await crews.leave(current.id, successorUserId);
      setSheet(null);
      changed();
      toast(`‘${current.name}’에서 나왔어요`);
      navigateTo(navigation, 'MyCrews');
    } catch (error) {
      if (errorCode(error) === 'OWNER_CANNOT_LEAVE') {
        setSheet('dissolve');
        toast('후임을 지정해 탈퇴하거나 크루 해산을 확인해 주세요');
      } else if (errorCode(error) === 'INVALID_SUCCESSOR') {
        toast('후임으로 지정할 수 없는 멤버예요. 다른 멤버를 선택해 주세요');
      } else {
        toast('크루에서 나가지 못했어요. 잠시 후 다시 시도해 주세요');
      }
    } finally {
      membershipAction.current = false;
      setBusy(false);
    }
  };
  const dissolve = async (current: CrewDetail) => {
    if (busy || membershipAction.current || !current.amOwner) return;
    membershipAction.current = true;
    setBusy(true);
    try {
      await crews.dissolve(current.id);
      setSheet(null);
      changed();
      toast(`‘${current.name}’를 해산했어요`);
      navigateTo(navigation, 'MyCrews');
    } catch (error) {
      const code = errorCode(error);
      toast(
        code === 'NOT_ADMIN'
          ? '크루장만 해산할 수 있어요'
          : code === 'CREW_NOT_FOUND'
          ? '크루를 찾지 못했어요'
          : '크루를 해산하지 못했어요. 잠시 후 다시 시도해 주세요',
      );
    } finally {
      membershipAction.current = false;
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
        icon: 'check' as const,
        primary: true,
        disabled: invalid || draftCapacity === crew.capacity,
        onPress: () => save(crew),
      }
    : crew.myMembership === 'MEMBER'
    ? {
        title: '가입한 크루예요 · 내 크루에서 보기',
        icon: 'arrowRight' as const,
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
    : {
        title: '가입 신청',
        icon: 'plus' as const,
        primary: true,
        onPress: () => requestJoin(crew),
      };

  return (
    // 6.0~6.3 sit on the mist like the group tab (S15P31E105-483), so the whole screen takes the light theme.
    <ThemeProvider tone="light">
      <View style={styles.root}>
        <StatusBar barStyle="dark-content" />
        <MistBackground />
        <SafeAreaView edges={['top']}>
          <View style={styles.header}>
            <BackButton tone="light" onPress={() => navigation.goBack()} />
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
            <Raised tone={full ? 'navy' : 'white'} style={styles.status}>
              <AppText style={full ? styles.statusTextFull : styles.statusText}>
                {full
                  ? `정원 마감 ${crew.memberCount}/${crew.capacity}`
                  : `모집 중 ${crew.memberCount}/${crew.capacity} · ${
                      joinPolicyLabels[crew.joinPolicy]
                    }`}
              </AppText>
            </Raised>
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
              <View style={styles.section}>
                <SectionLabel tone="mist">소개</SectionLabel>
                <AppText style={styles.intro}>{crew.description}</AppText>
              </View>
            ) : null}
            <View style={styles.section}>
              <View style={styles.rowBetween}>
                <SectionLabel tone="mist">구성원</SectionLabel>
                <AppText style={styles.memberCount}>
                  {`${crew.memberCount}명`}
                </AppText>
              </View>
              <View>
                {shown.map(member => (
                  <MemberRow
                    key={member.userId}
                    member={member}
                    disabled={busy}
                    onRemove={
                      crew.amOwner && !member.isOwner && !member.isMe
                        ? () => {
                            setRemoveTarget(member);
                            setSheet('remove');
                          }
                        : undefined
                    }
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
                  <AppText style={[styles.moreText, styles.underline]}>
                    {allMembers
                      ? '접기'
                      : `구성원 ${crew.memberCount}명 모두 보기`}
                  </AppText>
                </Pressable>
              ) : null}
            </View>
            {crew.myMembership === 'MEMBER' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="크루 나가기"
                disabled={busy}
                onPress={() => {
                  setSuccessorId(null);
                  setSheet(
                    crew.amOwner
                      ? successors.length
                        ? 'ownerLeave'
                        : 'dissolve'
                      : 'leave',
                  );
                }}
                style={styles.leave}
              >
                <AppText variant="body" tone="danger" style={styles.underline}>
                  크루 나가기
                </AppText>
              </Pressable>
            ) : null}
            {crew.amOwner ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="크루 해산"
                disabled={busy}
                onPress={() => setSheet('dissolve')}
                style={styles.leave}
              >
                <AppText variant="body" tone="danger" style={styles.underline}>
                  크루 해산
                </AppText>
              </Pressable>
            ) : null}
          </ScrollView>
        )}
        {footer ? (
          <SafeAreaView edges={['bottom']} style={styles.footer}>
            <GroupCta
              title={footer.title}
              icon={'icon' in footer ? footer.icon : undefined}
              primary={footer.primary}
              onMist
              disabled={busy || ('disabled' in footer && footer.disabled)}
              onPress={footer.onPress}
            />
          </SafeAreaView>
        ) : null}
        <ThemeProvider tone="dark">
          <BottomSheet
            visible={sheet !== null}
            onClose={() => {
              if (!busy) setSheet(null);
            }}
          >
            {crew && sheet === 'remove' && removeTarget ? (
              <SheetBody
                icon="alert"
                title="이 멤버를 크루에서 내보낼까요?"
                body={`${removeTarget.nickname}님을 크루에서 내보냅니다.`}
              >
                <FooterButton
                  title="취소"
                  disabled={busy}
                  onPress={() => setSheet(null)}
                />
                <FooterButton
                  title="내보내기"
                  danger
                  disabled={busy}
                  onPress={removeMember}
                />
              </SheetBody>
            ) : crew && sheet === 'full' ? (
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
            ) : crew && sheet === 'leave' ? (
              <SheetBody
                icon="alert"
                title="크루에서 나갈까요?"
                body={`‘${crew.name}’의 그룹런과 구성원 목록에서 빠져요. 다시 함께하려면 가입 신청을 새로 보내야 해요.`}
              >
                <FooterButton
                  title="취소"
                  disabled={busy}
                  onPress={() => setSheet(null)}
                />
                <FooterButton
                  title="나가기"
                  disabled={busy}
                  primary
                  onPress={() => leave(crew)}
                />
              </SheetBody>
            ) : crew && sheet === 'ownerLeave' ? (
              <>
                <AppText style={styles.sheetTitle}>
                  크루장을 넘기고 나갈까요?
                </AppText>
                <AppText variant="body" tone="textSecondary">
                  새 크루장을 선택해 주세요. 확인하면 크루장을 넘긴 뒤 탈퇴해요.
                </AppText>
                <ScrollView style={styles.successors}>
                  {successors.map(member => (
                    <Pressable
                      key={member.userId}
                      accessibilityRole="button"
                      accessibilityLabel={`${member.nickname} 후임 선택`}
                      accessibilityState={{
                        selected: successorId === member.userId,
                        disabled: busy,
                      }}
                      disabled={busy}
                      onPress={() => setSuccessorId(member.userId)}
                      style={styles.memberRow}
                    >
                      <AppText style={styles.memberName}>
                        {member.nickname}
                      </AppText>
                      {successorId === member.userId ? (
                        <Icon name="check" size={18} color={groupLook.onDark} />
                      ) : null}
                    </Pressable>
                  ))}
                </ScrollView>
                <View style={styles.sheetButtons}>
                  <FooterButton
                    title="취소"
                    disabled={busy}
                    onPress={() => setSheet(null)}
                  />
                  <FooterButton
                    title="크루장 넘기고 나가기"
                    primary
                    disabled={busy || !successorId}
                    onPress={() => {
                      if (successorId) void leave(crew, successorId);
                    }}
                  />
                </View>
              </>
            ) : crew && sheet === 'dissolve' ? (
              <SheetBody
                icon="alert"
                title="크루를 해산할까요?"
                body={`‘${crew.name}’의 모든 구성원이 크루에서 나가며, 크루 목록에서 더 이상 보이지 않아요.`}
              >
                <FooterButton
                  title="취소"
                  disabled={busy}
                  onPress={() => setSheet(null)}
                />
                <FooterButton
                  title="해산"
                  danger
                  disabled={busy}
                  onPress={() => dissolve(crew)}
                />
              </SheetBody>
            ) : null}
          </BottomSheet>
        </ThemeProvider>
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
    paddingHorizontal: spacing.screen,
  },
  // Room under the last card for the floating button.
  content: { padding: spacing.screen, paddingBottom: 120, gap: spacing.lg },
  // 6.2-CrewHero: the status chip and the name.
  status: {
    alignSelf: 'flex-start',
    height: 26,
    paddingHorizontal: 12,
    borderRadius: 13,
    justifyContent: 'center',
  },
  statusText: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 17,
    color: groupLook.navy,
  },
  statusTextFull: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 17,
    color: 'rgba(255,255,255,0.85)',
  },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: 30,
    lineHeight: 38,
    letterSpacing: -0.6,
    color: groupLook.onLight,
  },
  // 6.2-InfoStats: two columns, a white line on the left of each.
  facts: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.xs },
  fact: {
    borderLeftWidth: 1.5,
    borderLeftColor: groupLook.onLight,
    paddingLeft: 10,
    gap: 2,
  },
  factLabel: {
    fontFamily: fontFamily.regular,
    fontSize: 12.5,
    lineHeight: 16,
    color: groupLook.onLightSub,
  },
  factLine: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  factValue: {
    fontFamily: fontFamily.regular,
    fontSize: 26,
    lineHeight: 34,
    color: groupLook.onLight,
  },
  factUnit: {
    fontFamily: fontFamily.regular,
    fontSize: 14,
    lineHeight: 19,
    color: groupLook.onLightSub,
  },
  requests: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingVertical: spacing.md,
  },
  // DESIGN.md 2-1: a pressed box shrinks to 96%.
  round: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: groupLook.lightButton,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { gap: spacing.md, marginTop: spacing.xl },
  intro: {
    fontFamily: fontFamily.regular,
    fontSize: 15,
    lineHeight: 22,
    color: 'rgba(2,5,14,0.8)',
  },
  memberCount: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 17,
    color: groupLook.onLightSub,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // 6.2-MembersCard rows: 34 initial, name, 크루장 chip, recent pace on the right.
  successors: { maxHeight: 240 },
  removeMember: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  memberRow: {
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  initial: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: groupLook.lightFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialText: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 18,
    color: groupLook.onLight,
  },
  memberName: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: groupLook.onLight,
  },
  ownerTag: {
    height: 22,
    paddingHorizontal: 9,
    borderRadius: 11,
    justifyContent: 'center',
  },
  ownerTagText: {
    fontFamily: fontFamily.bold,
    fontSize: 12,
    lineHeight: 16,
    color: groupLook.onDark,
  },
  pace: {
    fontFamily: fontFamily.numberBold,
    fontSize: 18,
    lineHeight: 24,
    color: groupLook.onLight,
  },
  paceUnit: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 13,
    color: groupLook.onLightMuted,
  },
  more: { alignSelf: 'flex-start', paddingVertical: spacing.xs },
  moreText: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: groupLook.onLight,
  },
  leave: { alignSelf: 'center', paddingVertical: spacing.md },
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
  // Groups inside 크루 관리 are set apart by space only (runway-group-handoff: no dividers).
  lined: {
    paddingTop: spacing.md,
    gap: spacing.md,
  },
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
