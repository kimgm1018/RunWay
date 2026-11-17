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
  DefaultAvatar,
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
  type CrewJoinRequest,
  type CrewMember,
  type Repositories,
} from '../../data';
import { formatPace } from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import type { RootStackParamList } from '../../navigation/types';
import { MissingTarget } from './MissingTarget';
import {
  fontFamily,
  radius,
  spacing,
  ThemeProvider,
  useTheme,
} from '../../theme';
import {
  GroupCta,
  groupLook,
  groupTone,
  NightBackground,
  NumText,
  Raised,
} from './look';
import { CrewPhoto, PhotoOr, useGroupRunDraft } from './parts';
import { CrewJoinRequestRow } from './CrewJoinRequestRow';
import { BackButton } from '../../components/BackButton';

// The rows 구성원 shows before 모두 보기.
const previewCount = 4;

// 6.2m: 정원 제한 off means the most a crew can hold (M03 allows 1–200).
const maxCapacity = 200;

export const joinPolicyLabels: Record<CrewJoinPolicy, string> = {
  APPROVAL: '승인제',
  INSTANT: '바로 가입',
};

// One card of the 시안 (S15P31E105-594 담당자 시안) in the home's navy tone (담당자 요청: 진한 네이비, 홈과 같은 톤): a
// faint white card on the navy page with its white title, the rows under it split by thin lines.
function Card({
  title,
  aside,
  children,
}: {
  title?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Raised tone="night" style={styles.card}>
      {title ? (
        <View style={styles.rowBetween}>
          <AppText style={styles.cardTitle} accessibilityRole="header">
            {title}
          </AppText>
          {aside}
        </View>
      ) : null}
      {children}
    </Raised>
  );
}

// 6.2m 크루 관리, only for the leader: 정원 제한, 정원 and how full the crew is as rows split by lines, the fill on a
// mint bar (S15P31E105-594 담당자 시안). The save stays the bottom button.
function ManageCard({
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
  const capacity = limited ? Number(capacityText) : maxCapacity;
  const ratio = invalid || !capacity ? 0 : Math.min(1, memberCount / capacity);
  return (
    <Card
      title="크루 관리"
      aside={
        // The 시안's outlined pill as a quiet fill with white text (담당자 결정).
        <View style={styles.ownerOnly}>
          <Icon name="crown" color={groupTone.text} size={13} />
          <AppText style={styles.ownerOnlyText}>크루장만 보여요</AppText>
        </View>
      }
    >
      <View>
        <View style={styles.manageRow}>
          <View style={styles.flex}>
            <AppText style={styles.rowTitle}>정원 제한</AppText>
            <NumText
              text={`끄면 기본 정원 ${maxCapacity}명이 적용돼요`}
              style={styles.caption}
            />
          </View>
          <Toggle
            label="정원 제한"
            value={limited}
            onChange={onLimited}
            // On is the 시안's mint track with a white knob (S15P31E105-594 담당자 요청: 민트).
            onColors={{ knob: '#FFFFFF', track: groupLook.mint }}
          />
        </View>
        {limited ? (
          <View style={[styles.manageRow, styles.rowLine]}>
            <AppText style={[styles.flex, styles.rowTitle]}>정원</AppText>
            <View
              style={[
                styles.capacityField,
                // The red pink rim flags a wrong capacity.
                invalid && styles.capacityInvalid,
              ]}
            >
              <TextInput
                accessibilityLabel="정원"
                value={capacityText}
                onChangeText={text => onCapacity(text.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                maxLength={3}
                selectionColor="transparent"
                cursorColor={groupTone.text}
                style={styles.capacityInput}
              />
              <AppText style={styles.caption}>명</AppText>
            </View>
          </View>
        ) : null}
        <View style={[styles.fill, styles.rowLine]}>
          <View style={styles.rowBetween}>
            <AppText style={styles.body}>현재 인원 / 정원</AppText>
            <NumText
              text={`${memberCount} / ${invalid ? '–' : capacity}명`}
              style={styles.rowTitle}
            />
          </View>
          <View style={styles.bar}>
            <View style={[styles.barFill, { width: `${ratio * 100}%` }]} />
          </View>
          <NumText
            text={`최대 ${maxCapacity}명까지 정할 수 있어요 · 현재 인원보다 적게는 못 줄여요`}
            style={[styles.caption, invalid && styles.captionInvalid]}
          />
        </View>
      </View>
    </Card>
  );
}

// 지역 · 인원 under the name as two pills with an icon (S15P31E105-594 담당자 시안); the icon stands for the word,
// which stays as the pill's label for screen readers.
function Fact({
  icon,
  label,
  value,
}: {
  icon: IconName;
  label: string;
  value: string;
}) {
  return (
    <View
      style={styles.fact}
      accessible
      accessibilityLabel={`${label} ${value}`}
    >
      <Icon name={icon} color={groupTone.sub} size={15} />
      <NumText text={value} style={styles.factText} />
    </View>
  );
}

// A member line with a thin line under it (S15P31E105-594 담당자 시안): the initial, the name, the 크루장 tag and
// the recent pace on the right.
function MemberRow({
  member,
  onRemove,
  disabled,
  last,
}: {
  member: CrewMember;
  onRemove?: () => void;
  disabled: boolean;
  last: boolean;
}) {
  return (
    <View style={[styles.memberRow, !last && styles.memberLine]}>
      <View style={styles.initial}>
        <PhotoOr
          photo={member.profileImageUrl}
          size={34}
          fallback={<DefaultAvatar size={34} />}
        />
      </View>
      <AppText style={styles.memberName}>
        {member.isMe ? `${member.nickname} (나)` : member.nickname}
      </AppText>
      {member.isOwner ? (
        <Raised tone="mintFlat" style={styles.ownerTag}>
          <AppText style={styles.ownerTagText}>크루장</AppText>
        </Raised>
      ) : null}
      <View style={styles.flex} />
      {member.recentPaceSecPerKm ? (
        <NumText
          text={`${formatPace(member.recentPaceSecPerKm)} /km`}
          style={styles.pace}
        />
      ) : null}
      {onRemove ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${member.nickname} 내보내기`}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onRemove}
          style={[styles.removeMember, disabled && styles.dim]}
        >
          {/* A small outlined button as in the 시안's 크루장 관리 rows, in red pink as a risky action. */}
          <View style={styles.removePill}>
            <AppText style={styles.removeText}>내보내기</AppText>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

type SheetButtonKind = 'primary' | 'secondary' | 'danger';

// The buttons of the confirm sheets (6.4's FooterButton shape): white with navy text for the main one like the
// home's big buttons, red pink for a risky one, a quiet fill otherwise. wide gives a long label more room beside a short 취소 · 닫기, as in the 시안.
function SheetButton({
  title,
  kind = 'secondary',
  wide = false,
  disabled = false,
  onPress,
}: {
  title: string;
  kind?: SheetButtonKind;
  wide?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const fill =
    kind === 'danger'
      ? {
          background: groupTone.danger,
          border: groupTone.danger,
          text: colors.onDanger,
        }
      : kind === 'primary'
      ? {
          background: groupTone.button,
          border: groupTone.button,
          text: groupTone.onButton,
        }
      : {
          background: groupTone.quiet,
          border: groupTone.quiet,
          text: groupTone.text,
        };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.sheetButton,
        wide && styles.sheetButtonWide,
        { backgroundColor: fill.background, borderColor: fill.border },
        (pressed || disabled) && styles.dim,
      ]}
    >
      <AppText variant="button" style={{ color: fill.text }}>
        {title}
      </AppText>
    </Pressable>
  );
}

// 6.2x 가입 신청 불가, 6.2b 가입 신청 완료 and the other confirms: an icon, a title, the count big in
// Archivo when there is one, and a line over the sheet's buttons, all centred as in the 시안 (S15P31E105-594).
function SheetBody({
  icon,
  danger = false,
  done = false,
  title,
  count,
  body,
  children,
}: {
  icon: IconName;
  // 가입 신청 완료 · 바로 가입 완료: the 시안's mint circle with a navy check.
  done?: boolean;
  // 내보내기 · 해산: the 시안's red pink warning.
  danger?: boolean;
  title: string;
  count?: string;
  body: string;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.sheet}>
      <View
        style={[
          styles.sheetIcon,
          {
            backgroundColor: done
              ? groupTone.accent
              : danger
              ? groupTone.dangerSoft
              : colors.surfaceMuted,
          },
        ]}
      >
        <Icon
          name={icon}
          color={
            done ? groupTone.onAccent : danger ? groupTone.danger : colors.text
          }
          size={22}
        />
      </View>
      <AppText style={styles.sheetTitle}>{title}</AppText>
      {count ? (
        <NumText
          text={count}
          style={[styles.sheetCount, { color: colors.textSecondary }]}
          numberStyle={styles.sheetCountNumber}
        />
      ) : null}
      <AppText variant="body" tone="textSecondary" style={styles.centred}>
        {body}
      </AppText>
      <View style={styles.sheetButtons}>{children}</View>
    </View>
  );
}

// 6.2m 가입 신청 N건: the 시안's card row with a chevron that opens 6.2a, only for the crew leader
// (S15P31E105-594). The 시안's 가입 방식 row is not on this screen, so the card has the one row.
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
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`가입 신청 ${count}건`}
      onPress={() => navigation.navigate('CrewJoinRequests', { crewId })}
    >
      <Raised tone="night" style={[styles.card, styles.requests]}>
        <View style={styles.flex}>
          {/* One line, so it still reads 가입 신청 N건 whole; the count's digits in Archivo. */}
          <AppText style={styles.rowTitle}>
            {'가입 신청 '}
            <AppText style={styles.mint}>
              <AppText style={styles.requestCount}>{count}</AppText>건
            </AppText>
          </AppText>
          <AppText style={styles.caption}>
            {`${joinPolicyLabels[policy]} · 신청자를 확인하고 승인·거절해요`}
          </AppText>
        </View>
        <Icon name="forward" color={groupTone.sub} size={18} />
      </Raised>
    </PressableScale>
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
  const route = useRoute<RouteProp<RootStackParamList, 'CrewDetail'>>();
  const crewId = route.params?.crewId;
  // Without an id the screen has nothing to show; no mock id stands in (S15P31E105-635).
  if (!crewId) {
    return <MissingTarget title="크루를 찾을 수 없어요" />;
  }
  return <CrewDetailContent crewId={crewId} />;
}

function CrewDetailContent({ crewId }: { crewId: string }) {
  const navigation = useNavigation();
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
    | 'cancelRequest'
    | 'ownerLeave'
    | 'remove'
    | 'dissolve'
    // S15P31E105-800 (TEAM QA T23): 크루 나가기 by a leader with no other member ends the crew.
    | 'soleLeave'
    | null
  >(null);
  const [busy, setBusy] = useState(false);
  // 6.2 for the leader: the requests waiting for a decision, shown here without opening 6.2a (S15P31E105-678).
  const [requests, setRequests] = useState<CrewJoinRequest[] | null>(null);
  const isOwner = crew?.amOwner === true;
  useEffect(() => {
    if (!isOwner) {
      setRequests(null);
      return undefined;
    }
    let active = true;
    crews
      .listJoinRequests(crewId)
      .then(list => {
        if (active) setRequests(list);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [crews, crewId, isOwner, loaded]);
  const [removeTarget, setRemoveTarget] = useState<CrewMember | null>(null);
  const removing = useRef(false);
  const membershipAction = useRef(false);
  // One 승인·거절·신청 취소 request at a time, also against a fast second tap before busy renders.
  const requestAction = useRef(false);
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

  const decideRequest = async (request: CrewJoinRequest, approve: boolean) => {
    if (busy || requestAction.current) return;
    requestAction.current = true;
    setBusy(true);
    try {
      await crews.decideJoinRequest(crewId, request.userId, approve);
      toast(
        approve
          ? `${request.nickname}님이 크루 멤버가 됐어요`
          : `${request.nickname}님의 신청을 거절했어요`,
      );
      reload();
    } catch (error) {
      const code = errorCode(error);
      toast(
        code === 'CREW_CAPACITY_EXCEEDED'
          ? '정원이 가득 차서 승인할 수 없어요'
          : code === 'NOT_PENDING'
          ? '이미 처리된 신청이에요'
          : '처리하지 못했어요. 잠시 후 다시 시도해 주세요',
      );
      if (code === 'NOT_PENDING') reload();
    } finally {
      requestAction.current = false;
      setBusy(false);
    }
  };

  // M13: I take my own 승인 대기 request back; the leader's 가입 신청 알림 goes with it.
  const cancelRequest = async (current: CrewDetail) => {
    if (busy || requestAction.current) return;
    requestAction.current = true;
    setBusy(true);
    try {
      await crews.cancelJoinRequest(current.id);
      changed();
      setSheet(null);
      toast('가입 신청을 취소했어요');
      reload();
    } catch (error) {
      const code = errorCode(error);
      setSheet(null);
      toast(
        code === 'NOT_PENDING'
          ? '이미 처리된 신청이에요'
          : code === 'CREW_NOT_FOUND'
          ? '크루를 찾을 수 없어요'
          : '가입 신청을 취소하지 못했어요. 잠시 후 다시 시도해 주세요',
      );
      if (code === 'NOT_PENDING' || code === 'CREW_NOT_FOUND') reload();
    } finally {
      requestAction.current = false;
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
      } else if (errorCode(error) === 'CREW_NOT_FOUND') {
        // M04 404: the crew was dissolved after this page opened (S15P31E105-774). The lists drop it.
        toast('이미 해산된 크루입니다');
        changed();
        if (navigation.canGoBack()) navigation.goBack();
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
        setSheet('soleLeave');
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
    } catch (error) {
      // M12 (S15P31E105-570): someone joined meanwhile, so the new capacity is under the member count.
      if (errorCode(error) === 'CREW_CAPACITY_BELOW_MEMBERS') {
        toast('현재 멤버 수보다 적게 정할 수 없어요');
        reload();
      } else {
        toast('정원을 저장하지 못했어요. 잠시 후 다시 시도해 주세요');
      }
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
        title: '승인 대기 중 · 신청 취소',
        primary: false,
        onPress: () => setSheet('cancelRequest'),
      }
    : full
    ? {
        title: '가입 신청 · 정원 마감',
        primary: false,
        onPress: () => setSheet('full'),
      }
    : {
        // S15P31E105-800 (TEAM QA T19): a request the leader turned down can be sent again.
        title: crew.myRejected ? '신청이 거절됐어요 · 다시 신청' : '가입 신청',
        icon: 'plus' as const,
        primary: true,
        onPress: () => requestJoin(crew),
      };

  return (
    // The 시안's cards (S15P31E105-594 담당자 시안) on the home's navy (담당자 요청: 진한 네이비, 홈과 같은 톤):
    // faint white cards with white text, white big buttons and mint only on the small marks.
    <ThemeProvider tone="dark">
      <View style={styles.root}>
        <NightBackground />
        <StatusBar barStyle="light-content" />
        <SafeAreaView edges={['top']}>
          <View style={styles.header}>
            <BackButton tone="dark" onPress={() => navigation.goBack()} />
            <AppText style={styles.headerTitle} accessibilityRole="header">
              크루 상세
            </AppText>
            <View style={styles.headerSpace} />
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
          <ActivityIndicator color={groupTone.text} style={styles.loading} />
        ) : (
          <ScrollView contentContainerStyle={styles.content}>
            {/* 6.2-CrewHero as the 시안's first card: the name, 지역 · 인원 as pills, and the status chip with the
                join policy beside it (mint while recruiting, K1 mint once full). */}
            <Card>
              {/* The crew photo left of the name when the crew has one (S15P31E105-636). */}
              <View style={styles.photoRow}>
                <CrewPhoto photo={crew.imageUrl} size={64} />
                <AppText
                  style={[styles.title, styles.flex]}
                  accessibilityRole="header"
                >
                  {crew.name}
                </AppText>
              </View>
              <View style={styles.facts}>
                <Fact icon="mapPin" label="지역" value={crew.area} />
                <Fact
                  icon="users"
                  label="인원"
                  value={`${crew.memberCount} / ${crew.capacity}명`}
                />
              </View>
              <View style={styles.statusRow}>
                {full ? (
                  <Raised tone="mint" style={styles.status}>
                    <AppText style={styles.statusText}>정원 마감</AppText>
                  </Raised>
                ) : (
                  <>
                    <Raised tone="mintFlat" style={styles.status}>
                      <AppText style={styles.statusText}>모집 중</AppText>
                    </Raised>
                    <AppText style={styles.body}>
                      {`· ${joinPolicyLabels[crew.joinPolicy]}`}
                    </AppText>
                  </>
                )}
              </View>
            </Card>
            {crew.amOwner ? (
              <>
                <RequestsLink
                  crewId={crew.id}
                  count={crew.pendingRequestCount ?? 0}
                  policy={crew.joinPolicy}
                />
                {requests && requests.length > 0 ? (
                  <View style={styles.requestList}>
                    {requests.map(request => (
                      <CrewJoinRequestRow
                        key={request.userId}
                        request={request}
                        canApprove={crew.memberCount < crew.capacity}
                        busy={busy}
                        onDecide={approve => decideRequest(request, approve)}
                      />
                    ))}
                  </View>
                ) : requests ? (
                  <AppText style={styles.caption}>
                    아직 대기 중인 신청이 없어요
                  </AppText>
                ) : null}
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
              <Card title="소개">
                <AppText style={styles.intro}>{crew.description}</AppText>
              </Card>
            ) : null}
            <Card
              title="구성원"
              aside={
                <NumText
                  text={`${crew.memberCount}명`}
                  style={styles.memberCount}
                />
              }
            >
              <View>
                {shown.map((member, index) => (
                  <MemberRow
                    key={member.userId}
                    member={member}
                    disabled={busy}
                    last={index === shown.length - 1}
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
                  style={[styles.more, styles.rowLine]}
                >
                  {/* A centred link with a chevron under a line, as in the 시안. */}
                  <NumText
                    text={
                      allMembers
                        ? '접기'
                        : `구성원 ${crew.memberCount}명 모두 보기`
                    }
                    style={styles.moreText}
                  />
                  <Icon
                    name={allMembers ? 'chevronDown' : 'forward'}
                    color={groupTone.accent}
                    size={16}
                  />
                </Pressable>
              ) : null}
            </Card>
            {/* 크루 나가기 · 크루 해산 as quiet buttons with red pink text, side by side when the leader has both as in
                the 시안 (S15P31E105-594). */}
            {crew.myMembership === 'MEMBER' || crew.amOwner ? (
              <View style={styles.exits}>
                {crew.myMembership === 'MEMBER' ? (
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel="크루 나가기"
                    accessibilityState={{ disabled: busy }}
                    disabled={busy}
                    onPress={() => {
                      setSuccessorId(null);
                      setSheet(
                        crew.amOwner
                          ? successors.length
                            ? 'ownerLeave'
                            : 'soleLeave'
                          : 'leave',
                      );
                    }}
                    style={[styles.exit, busy && styles.dim]}
                  >
                    <AppText style={styles.exitText}>크루 나가기</AppText>
                  </PressableScale>
                ) : null}
                {crew.amOwner ? (
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel="크루 해산"
                    accessibilityState={{ disabled: busy }}
                    disabled={busy}
                    onPress={() => setSheet('dissolve')}
                    style={[styles.exit, busy && styles.dim]}
                  >
                    <AppText style={styles.exitText}>크루 해산</AppText>
                  </PressableScale>
                ) : null}
              </View>
            ) : null}
          </ScrollView>
        )}
        {footer ? (
          <SafeAreaView edges={['bottom']} style={styles.footer}>
            <GroupCta
              title={footer.title}
              icon={'icon' in footer ? footer.icon : undefined}
              primary={footer.primary}
              navy
              disabled={busy || ('disabled' in footer && footer.disabled)}
              onPress={footer.onPress}
            />
          </SafeAreaView>
        ) : null}
        {/* The confirm sheets in the navy tone with white text, centred as in the 시안. */}
        <ThemeProvider tone="dark">
          <BottomSheet
            visible={sheet !== null}
            background={sheetNavy}
            onClose={() => {
              if (!busy) setSheet(null);
            }}
          >
            {crew && sheet === 'remove' && removeTarget ? (
              <SheetBody
                icon="alert"
                danger
                title="이 멤버를 크루에서 내보낼까요?"
                body={`${removeTarget.nickname}님을 크루에서 내보냅니다.`}
              >
                <SheetButton
                  title="취소"
                  disabled={busy}
                  onPress={() => setSheet(null)}
                />
                <SheetButton
                  title="내보내기"
                  kind="danger"
                  disabled={busy}
                  onPress={removeMember}
                />
              </SheetBody>
            ) : crew && sheet === 'full' ? (
              <SheetBody
                icon="group"
                title="정원이 가득 찼어요"
                count={`${crew.memberCount} / ${crew.capacity}명`}
                body={`‘${crew.name}’는 지금 가입 신청을 받을 수 없어요. 자리가 나면 다시 신청할 수 있어요.`}
              >
                <SheetButton title="닫기" onPress={() => setSheet(null)} />
                <SheetButton
                  title="다른 크루 둘러보기"
                  kind="primary"
                  wide
                  onPress={() => {
                    setSheet(null);
                    navigateTo(navigation, 'CrewRecruit');
                  }}
                />
              </SheetBody>
            ) : crew && sheet === 'sent' ? (
              <SheetBody
                icon="check"
                done
                title="가입 신청을 보냈어요"
                body="크루장이 승인하면 내 크루에서 그룹런을 볼 수 있어요. 승인 전에는 ‘승인 대기’로 보여요."
              >
                <SheetButton
                  title="내 크루로"
                  kind="primary"
                  onPress={toMyCrews}
                />
              </SheetBody>
            ) : crew && sheet === 'joined' ? (
              <SheetBody
                icon="check"
                done
                title="크루에 가입했어요"
                body={`‘${crew.name}’는 바로 가입 크루예요. 이제 내 크루에서 그룹런을 볼 수 있어요.`}
              >
                <SheetButton
                  title="내 크루로"
                  kind="primary"
                  onPress={toMyCrews}
                />
              </SheetBody>
            ) : crew && sheet === 'cancelRequest' ? (
              <SheetBody
                icon="alert"
                title="가입 신청을 취소할까요?"
                body={`‘${crew.name}’에 보낸 가입 신청을 취소해요. 다시 가입하려면 신청을 새로 보내야 해요.`}
              >
                <SheetButton
                  title="닫기"
                  disabled={busy}
                  onPress={() => setSheet(null)}
                />
                <SheetButton
                  title="신청 취소"
                  kind="primary"
                  disabled={busy}
                  onPress={() => cancelRequest(crew)}
                />
              </SheetBody>
            ) : crew && sheet === 'leave' ? (
              <SheetBody
                icon="alert"
                title="크루에서 나갈까요?"
                body={`‘${crew.name}’의 그룹런과 구성원 목록에서 빠져요. 다시 함께하려면 가입 신청을 새로 보내야 해요.`}
              >
                <SheetButton
                  title="취소"
                  disabled={busy}
                  onPress={() => setSheet(null)}
                />
                <SheetButton
                  title="나가기"
                  kind="primary"
                  disabled={busy}
                  onPress={() => leave(crew)}
                />
              </SheetBody>
            ) : crew && sheet === 'ownerLeave' ? (
              <View style={styles.sheet}>
                <AppText style={styles.sheetTitle}>
                  크루장을 넘기고 나갈까요?
                </AppText>
                <AppText
                  variant="body"
                  tone="textSecondary"
                  style={styles.centred}
                >
                  새 크루장을 선택해 주세요. 확인하면 크루장을 넘긴 뒤 탈퇴해요.
                </AppText>
                {/* The candidates as radio rows split by lines in an outlined box (시안 6번). */}
                <SuccessorList
                  successors={successors}
                  successorId={successorId}
                  busy={busy}
                  onPick={setSuccessorId}
                />
                <View style={styles.sheetButtons}>
                  <SheetButton
                    title="취소"
                    disabled={busy}
                    onPress={() => setSheet(null)}
                  />
                  <SheetButton
                    title="크루장 넘기고 나가기"
                    kind="primary"
                    wide
                    disabled={busy || !successorId}
                    onPress={() => {
                      if (successorId) void leave(crew, successorId);
                    }}
                  />
                </View>
              </View>
            ) : crew && (sheet === 'dissolve' || sheet === 'soleLeave') ? (
              <SheetBody
                icon="alert"
                danger
                title={
                  sheet === 'soleLeave'
                    ? '멤버가 없어 나가면 크루가 해산돼요'
                    : '크루를 해산할까요?'
                }
                body={
                  sheet === 'soleLeave'
                    ? `‘${crew.name}’에 다른 멤버가 없어 크루장이 나가면 크루가 해산되고, 크루 목록에서 더 이상 보이지 않아요.`
                    : `‘${crew.name}’의 모든 구성원이 크루에서 나가며, 크루 목록에서 더 이상 보이지 않아요.`
                }
              >
                <SheetButton
                  title="취소"
                  disabled={busy}
                  onPress={() => setSheet(null)}
                />
                <SheetButton
                  title="해산"
                  kind="danger"
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

// 크루장 넘기고 나가기's candidates: a radio a row; the picked one has a navy rim on the soft grey fill and a navy
// radio, navy being what is chosen (담당자 결정).
function SuccessorList({
  successors,
  successorId,
  busy,
  onPick,
}: {
  successors: CrewMember[];
  successorId: string | null;
  busy: boolean;
  onPick: (userId: string) => void;
}) {
  return (
    <ScrollView style={styles.successors}>
      {successors.map((member, index) => {
        const picked = successorId === member.userId;
        return (
          <Pressable
            key={member.userId}
            accessibilityRole="button"
            accessibilityLabel={`${member.nickname} 후임 선택`}
            accessibilityState={{ selected: picked, disabled: busy }}
            disabled={busy}
            onPress={() => onPick(member.userId)}
            style={[
              styles.successor,
              // A side colour beats the picked rim, so the picked row gets no divider.
              index > 0 && !picked && styles.successorLine,
              picked && styles.successorPicked,
            ]}
          >
            <View style={[styles.radio, picked && styles.radioOn]}>
              {picked ? <View style={styles.radioDot} /> : null}
            </View>
            <AppText style={[styles.memberName, picked && styles.onButton]}>
              {member.nickname}
            </AppText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// The sheets' deep navy, a step lighter than the page so they stand off it.
const sheetNavy = groupTone.sheet;

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  dim: { opacity: 0.5 },
  loading: { marginTop: spacing.xxxl },
  header: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing.screen,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fontFamily.bold,
    fontSize: 19,
    lineHeight: 26,
    color: groupTone.text,
  },
  // As wide as 뒤로, so the title sits in the middle.
  headerSpace: { width: 44 },
  // 12 between the cards; room at the foot for the floating button.
  content: {
    flexGrow: 1,
    gap: 12,
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.xs,
    paddingBottom: 176,
  },
  // The 시안's card.
  card: { borderRadius: 20, padding: 18, gap: 14 },
  cardTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 18,
    lineHeight: 24,
    color: groupTone.text,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  // The thin line between a card's rows.
  rowLine: { borderTopWidth: 1, borderTopColor: groupTone.line },
  rowTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    lineHeight: 22,
    color: groupTone.text,
  },
  body: {
    fontFamily: fontFamily.regular,
    fontSize: 15,
    lineHeight: 21,
    color: groupTone.sub,
  },
  caption: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: groupTone.sub,
  },
  captionInvalid: { color: groupTone.danger },
  // 6.2-CrewHero.
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: 26,
    lineHeight: 33,
    letterSpacing: -0.5,
    color: groupTone.text,
  },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    backgroundColor: groupTone.inner,
  },
  factText: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 20,
    color: groupTone.text,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // The status chip: navy text on mint.
  status: {
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 8,
    justifyContent: 'center',
  },
  statusText: {
    fontFamily: fontFamily.bold,
    fontSize: 13.5,
    lineHeight: 18,
    color: groupLook.onMint,
  },
  requests: { flexDirection: 'row', alignItems: 'center' },
  requestList: { gap: 10 },
  // The 시안's mint 'N건' and 모두 보기: small mint marks read on the navy.
  mint: { color: groupTone.accent },
  // AppText sets its own colour, so the digits name the mint again.
  requestCount: {
    fontFamily: fontFamily.numberBold,
    fontSize: 18,
    color: groupTone.accent,
  },
  intro: {
    fontFamily: fontFamily.regular,
    fontSize: 16,
    lineHeight: 24,
    color: 'rgba(255,255,255,0.85)',
  },
  memberCount: {
    fontFamily: fontFamily.regular,
    fontSize: 14,
    lineHeight: 19,
    color: groupTone.sub,
  },
  memberRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  memberLine: { borderBottomWidth: 1, borderBottomColor: groupTone.line },
  initial: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  memberName: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    lineHeight: 22,
    color: groupTone.text,
  },
  ownerTag: {
    height: 22,
    paddingHorizontal: 8,
    borderRadius: 11,
    justifyContent: 'center',
  },
  ownerTagText: {
    fontFamily: fontFamily.bold,
    fontSize: 12,
    lineHeight: 16,
    color: groupLook.onMint,
  },
  pace: {
    fontFamily: fontFamily.regular,
    fontSize: 15,
    lineHeight: 20,
    color: groupTone.sub,
  },
  removeMember: { minHeight: 44, justifyContent: 'center' },
  removePill: {
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: groupTone.danger,
    justifyContent: 'center',
  },
  removeText: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 17,
    color: groupTone.danger,
  },
  more: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 44,
    // Right under the last row, without the card's 14 gap, as the 시안's line + link.
    marginTop: -14,
  },
  moreText: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: groupTone.accent,
  },
  // 크루 나가기 · 해산: red pink text on the quiet fill (위험한 동작은 워치의 붉은 핑크), side by side.
  exits: { flexDirection: 'row', gap: 10, paddingTop: 4 },
  exit: {
    flex: 1,
    height: 52,
    borderRadius: 16,
    backgroundColor: groupTone.quiet,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exitText: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    lineHeight: 21,
    color: groupTone.danger,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.screen,
    paddingBottom: spacing.xl,
  },
  // 6.2m 크루 관리.
  ownerOnly: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 26,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: groupTone.quiet,
  },
  ownerOnlyText: {
    fontFamily: fontFamily.medium,
    fontSize: 12.5,
    lineHeight: 17,
    color: groupTone.text,
  },
  manageRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingVertical: 8,
  },
  fill: { gap: 8, paddingTop: 12 },
  capacityField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    height: 42,
    minWidth: 104,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: groupTone.inner,
  },
  capacityInvalid: { borderWidth: 1.5, borderColor: groupTone.danger },
  capacityInput: {
    flex: 1,
    height: 42,
    padding: 0,
    includeFontPadding: false,
    textAlignVertical: 'center',
    textAlign: 'right',
    fontFamily: fontFamily.numberSemiBold,
    fontSize: 22,
    lineHeight: 28,
    color: groupTone.text,
  },
  // The 시안's mint bar on the soft grey.
  bar: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: groupTone.inner,
  },
  barFill: { height: 6, borderRadius: 3, backgroundColor: groupLook.mint },
  // The sheets, centred as in the 시안.
  sheet: { gap: spacing.xl, alignItems: 'center' },
  sheetIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetTitle: {
    fontFamily: fontFamily.medium,
    fontSize: 22,
    lineHeight: 30,
    textAlign: 'center',
  },
  sheetCount: { fontFamily: fontFamily.medium, fontSize: 22, lineHeight: 32 },
  // The big count of 정원 마감 in Archivo Bold, as the 시안's 30 / 30명.
  sheetCountNumber: { fontFamily: fontFamily.numberBold, fontSize: 30 },
  centred: { textAlign: 'center' },
  sheetButtons: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: spacing.md,
  },
  // 6.4's FooterButton shape.
  sheetButton: {
    flex: 1,
    minHeight: 54,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  sheetButtonWide: { flex: 1.7 },
  successors: {
    alignSelf: 'stretch',
    maxHeight: 240,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: groupTone.line,
  },
  successor: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: 13,
  },
  successorLine: { borderTopColor: groupTone.line },
  // The picked row white with navy on it, as a picked tab (담당자 결정).
  successorPicked: {
    borderColor: groupTone.button,
    backgroundColor: groupTone.button,
  },
  onButton: { color: groupTone.onButton },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: groupTone.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: groupTone.onButton },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: groupTone.onButton,
  },
});
