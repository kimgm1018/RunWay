import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import {
  StackActions,
  useFocusEffect,
  useNavigation,
} from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AppText,
  Backdrop,
  EmptyState,
  Icon,
  type IconName,
  KeyboardLift,
  useToast,
} from '../../components';
import { BackButton } from '../../components/BackButton';
import {
  errorCode,
  useRepositories,
  useResource,
  type Repositories,
  type WithdrawalSummary,
} from '../../data';
import { navigateTo } from '../../navigation/navigateTo';
import { useSession } from '../../session/SessionProvider';
import { fontFamily, k1 } from '../../theme';
import { settingsLook } from './SettingsScreen';
import { isValidCurrentPassword } from '../onboarding/validation';

// The glass of the 8.4 · 8.5 cards and the 취소 button (runway-settings).
const glassFill = {
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.6)',
  backgroundColor: 'rgba(255,255,255,0.5)',
  boxShadow:
    '0 10px 30px rgba(9,17,26,0.08), inset 0 1px 0 rgba(255,255,255,0.7)',
} as const;

// The two buttons at the foot: 취소 in glass and the navy step on (다음 · 탈퇴하기).
function Actions({
  next,
  disabled,
  onCancel,
  onNext,
}: {
  next: string;
  disabled: boolean;
  onCancel: () => void;
  onNext: () => void;
}) {
  return (
    <View style={styles.actions}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="취소"
        onPress={onCancel}
        style={({ pressed }) => [
          styles.action,
          styles.cancel,
          pressed && styles.pressed,
        ]}
      >
        <AppText style={styles.cancelText}>취소</AppText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={next}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onNext}
        style={({ pressed }) => [
          styles.action,
          styles.next,
          disabled && styles.dim,
          pressed && styles.pressed,
        ]}
      >
        <AppText style={styles.nextText}>{next}</AppText>
      </Pressable>
    </View>
  );
}

// 회원탈퇴 1/2 · 2/2 on the mist: 뒤로 with a progress line (half, then full), the content and the two
// buttons at the foot, which the keyboard lifts.
function Frame({
  progress,
  centered = false,
  children,
  footer,
}: {
  progress: number;
  // 8.5 puts its title and field in the middle of the screen.
  centered?: boolean;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  const navigation = useNavigation();
  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop tail />
      </View>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <BackButton onPress={() => navigation.goBack()} />
          <View
            accessibilityRole="progressbar"
            accessibilityLabel="탈퇴 진행"
            accessibilityValue={{ min: 0, max: 2, now: progress * 2 }}
            style={styles.track}
          >
            <View style={[styles.fill, { width: `${progress * 100}%` }]} />
          </View>
        </View>
      </SafeAreaView>
      {/* The keyboard lifts the footer above it (S15P31E105-473). */}
      <KeyboardLift>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.content, centered && styles.centered]}
        >
          {children}
        </ScrollView>
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          {footer}
        </SafeAreaView>
      </KeyboardLift>
    </View>
  );
}

function Hero({
  title,
  description,
  centered = false,
}: {
  title: string;
  description: string;
  centered?: boolean;
}) {
  return (
    <View style={centered && styles.heroCentered}>
      <AppText style={styles.title} accessibilityRole="header">
        {title}
      </AppText>
      <AppText style={styles.description}>{description}</AppText>
    </View>
  );
}

// A glass card of 64 with an icon, a title and a grey line (8.4 지워지는 정보 · 크루장 안내).
function InfoCard({
  icon,
  title,
  detail,
  strong = false,
}: {
  icon: IconName;
  title: string;
  detail: string;
  strong?: boolean;
}) {
  return (
    <View style={[styles.card, styles.glass]}>
      <Icon
        name={icon}
        color={settingsLook.label}
        size={20}
        strokeWidth={1.8}
      />
      <View style={styles.flex}>
        <AppText style={strong ? styles.cardTitleStrong : styles.cardTitle}>
          {title}
        </AppText>
        <AppText style={styles.cardDetail}>{detail}</AppText>
      </View>
    </View>
  );
}

function losses(
  summary: WithdrawalSummary,
): { icon: IconName; title: string; detail: string }[] {
  return [
    {
      icon: 'trend',
      title: `러닝 기록 ${summary.runningRecordCount}회`,
      detail: '거리·페이스·심박·지도 경로',
    },
    {
      icon: 'note',
      title: `커뮤니티 게시물 ${summary.postCount}개`,
      detail: '사진·글·댓글·좋아요',
    },
    {
      icon: 'route',
      title: `저장한 코스 ${summary.savedCourseCount}개`,
      detail: '내가 만든 코스 포함',
    },
    ...summary.connectedDevices.map(device => ({
      icon: 'smartwatch' as const,
      title: '워치 연결',
      detail: `${device} 연결이 해제돼요`,
    })),
  ];
}

const loadSummary = (repositories: Repositories) =>
  repositories.account.getWithdrawalSummary();

// 8.4 회원탈퇴 확인 (U17, runway-settings): what goes away, what must be cleared first and the agreement U18
// needs. The step on is 다음 now (담당자 결정: 시안대로); 탈퇴하기 is 8.5's. While the server names anything to
// clear first (blockers: a crew I lead, a group run I host, a run in progress), 다음 stays off: U18 would refuse.
export function WithdrawScreen() {
  const navigation = useNavigation();
  const summary = useResource(loadSummary);
  const [agreed, setAgreed] = useState(false);
  // Coming back from 8.5 (the server found something to clear first) reads U17 again.
  const opened = useRef(false);
  const { reload } = summary;
  useFocusEffect(
    useCallback(() => {
      if (opened.current) {
        reload();
      }
      opened.current = true;
    }, [reload]),
  );
  const blocked =
    summary.status === 'ready' && summary.data.blockers.length > 0;
  return (
    <Frame
      progress={0.5}
      footer={
        <Actions
          next="다음"
          disabled={!agreed || summary.status !== 'ready' || blocked}
          onCancel={() => navigation.goBack()}
          onNext={() => navigateTo(navigation, 'WithdrawPassword')}
        />
      }
    >
      <Hero
        title="정말 탈퇴할까요?"
        description="탈퇴하면 아래 정보가 모두 지워지고 되돌릴 수 없어요."
      />
      {summary.status === 'error' ? (
        <EmptyState
          icon="alert"
          title="탈퇴 정보를 불러오지 못했어요"
          actionLabel="다시 시도"
          onAction={summary.reload}
        />
      ) : summary.status !== 'ready' ? (
        <ActivityIndicator style={styles.loading} />
      ) : (
        <View style={styles.cards}>
          {losses(summary.data).map(item => (
            <InfoCard key={item.title} {...item} />
          ))}
          {summary.data.ownedCrews.length ? (
            <InfoCard
              icon="crown"
              strong
              title="크루장인 크루가 있어요"
              detail={summary.data.ownedCrews.join(', ')}
            />
          ) : null}
          {summary.data.ownedGroupRuns.length ? (
            <InfoCard
              icon="users"
              strong
              title="내가 연 그룹런이 있어요"
              detail={summary.data.ownedGroupRuns.join(', ')}
            />
          ) : null}
          {summary.data.scheduledGroupRuns.length ? (
            <InfoCard
              icon="calendar"
              title={`참가 예정 그룹런 ${summary.data.scheduledGroupRuns.length}개`}
              detail={`${summary.data.scheduledGroupRuns.join(
                ', ',
              )} · 탈퇴하면 자동으로 참가가 취소돼요.`}
            />
          ) : null}
          {blocked ? (
            <InfoCard
              icon="alert"
              strong
              title="먼저 정리해야 탈퇴할 수 있어요"
              detail={summary.data.blockers
                .map(blocker => blocker.message)
                .join('\n')}
            />
          ) : null}
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel="탈퇴 동의"
            accessibilityState={{ checked: agreed }}
            onPress={() => setAgreed(value => !value)}
            style={({ pressed }) => [
              styles.card,
              styles.glass,
              pressed && styles.pressed,
            ]}
          >
            <View style={[styles.box, agreed && styles.boxOn]}>
              {agreed ? (
                <Icon
                  name="check"
                  color="#FFFFFF"
                  size={14}
                  strokeWidth={2.8}
                />
              ) : null}
            </View>
            <AppText style={styles.agreeText}>
              위 내용을 확인했고, 지워진 정보는 되돌릴 수 없다는 데 동의해요
            </AppText>
          </Pressable>
        </View>
      )}
    </Frame>
  );
}

// 8.5 비밀번호 확인 (U18): the password proves it is me; a wrong one stays on this screen.
export function WithdrawPasswordScreen() {
  const navigation = useNavigation();
  const toast = useToast();
  const { account } = useRepositories();
  const [password, setPassword] = useState('');
  const [wrong, setWrong] = useState(false);
  const [busy, setBusy] = useState(false);
  const withdraw = async () => {
    setBusy(true);
    try {
      await account.withdraw(password);
      navigation.dispatch(StackActions.replace('WithdrawDone'));
    } catch (error) {
      const code = errorCode(error);
      if (code === 'INVALID_PASSWORD' || code === 'VALIDATION_ERROR') {
        setWrong(true);
      } else if (code === 'WITHDRAWAL_CONFLICT') {
        // Something to clear came up since 8.4 (a crew, a group run, a run): 8.4 reads U17 again and says what.
        toast('탈퇴 전에 정리할 항목이 있어요. 내용을 다시 확인해 주세요');
        navigation.goBack();
      } else {
        toast('탈퇴하지 못했어요. 잠시 후 다시 시도해 주세요');
      }
      setBusy(false);
    }
  };
  return (
    <Frame
      progress={1}
      centered
      footer={
        <Actions
          next="탈퇴하기"
          // The server's format for a password already set (8–20 characters, no spaces), so an account whose password
          // predates the ASCII-only rule can still leave (S15P31E105-773 review A-1).
          disabled={!isValidCurrentPassword(password) || busy}
          onCancel={() => navigateTo(navigation, 'Settings')}
          onNext={withdraw}
        />
      }
    >
      <Hero
        centered
        title="비밀번호를 입력해 주세요"
        description="본인 확인 후 탈퇴가 진행돼요."
      />
      <View>
        <View
          style={[
            styles.field,
            styles.glass,
            wrong && { borderColor: k1.coral },
          ]}
        >
          <Icon
            name="padlock"
            color={settingsLook.label}
            size={20}
            strokeWidth={1.8}
          />
          <View style={styles.flex}>
            <AppText style={styles.fieldLabel}>비밀번호</AppText>
            <TextInput
              accessibilityLabel="비밀번호"
              placeholder="비밀번호 입력"
              placeholderTextColor="#8A8A8A"
              secureTextEntry
              value={password}
              onChangeText={text => {
                setPassword(text);
                setWrong(false);
              }}
              selectionColor={settingsLook.ink}
              style={styles.input}
            />
          </View>
        </View>
        {wrong ? (
          <AppText style={styles.error}>비밀번호가 맞지 않아요</AppText>
        ) : null}
      </View>
    </Frame>
  );
}

// 8.6 탈퇴 완료: the account is gone, so every way out (처음으로 or back) signs out to 1.1.
export function WithdrawDoneScreen() {
  const session = useSession();
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        session.signOut();
        return true;
      },
    );
    return () => subscription.remove();
  }, [session]);
  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop tail />
      </View>
      <View style={styles.done}>
        <View style={styles.doneMark}>
          <Icon name="check" color="#FFFFFF" size={24} strokeWidth={2.6} />
        </View>
        <AppText
          style={[styles.title, styles.doneTitle]}
          accessibilityRole="header"
        >
          탈퇴가 완료됐어요
        </AppText>
        <AppText style={styles.description}>
          그동안 함께 달려 주셔서 고마워요.
        </AppText>
      </View>
      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="처음으로"
          onPress={session.signOut}
          style={({ pressed }) => [
            styles.wide,
            styles.next,
            pressed && styles.pressed,
          ]}
        >
          <AppText style={styles.nextText}>처음으로</AppText>
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  loading: { marginTop: 48 },
  pressed: { opacity: 0.7 },
  dim: { opacity: 0.4 },
  glass: glassFill,
  // 뒤로, then the progress line in the rest of the row.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
    paddingTop: 8,
    paddingLeft: 16,
    paddingRight: 28,
  },
  track: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: 'rgba(24,46,61,0.12)',
  },
  fill: { height: 4, borderRadius: 2, backgroundColor: settingsLook.ink },
  content: { paddingHorizontal: 24, paddingTop: 28, paddingBottom: 24 },
  centered: { flexGrow: 1, justifyContent: 'center', gap: 28 },
  heroCentered: { alignItems: 'center' },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: 25,
    lineHeight: 33,
    letterSpacing: -0.6,
    color: settingsLook.ink,
  },
  description: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 21,
    letterSpacing: -0.2,
    color: settingsLook.sub,
  },
  cards: { gap: 10, marginTop: 24 },
  card: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
    paddingLeft: 18,
    paddingRight: 16,
    borderRadius: 18,
  },
  cardTitle: {
    fontFamily: fontFamily.medium,
    fontSize: 15.5,
    lineHeight: 20,
    letterSpacing: -0.3,
    color: settingsLook.ink,
  },
  cardTitleStrong: {
    fontFamily: fontFamily.bold,
    fontSize: 15.5,
    lineHeight: 20,
    letterSpacing: -0.3,
    color: settingsLook.ink,
  },
  cardDetail: {
    marginTop: 2,
    fontSize: 12.5,
    lineHeight: 18,
    letterSpacing: -0.2,
    color: settingsLook.sub,
  },
  box: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.8,
    borderColor: settingsLook.label,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  boxOn: {
    borderColor: settingsLook.ink,
    backgroundColor: settingsLook.ink,
  },
  agreeText: {
    flex: 1,
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: -0.3,
    color: settingsLook.ink,
  },
  field: {
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 18,
    borderRadius: 18,
  },
  fieldLabel: {
    fontFamily: fontFamily.medium,
    fontSize: 11.5,
    lineHeight: 15,
    color: settingsLook.label,
  },
  // Noto's tall glyphs need more than the 22 line, so the input keeps its own height without padding.
  input: {
    height: 26,
    padding: 0,
    includeFontPadding: false,
    textAlignVertical: 'center',
    fontFamily: fontFamily.medium,
    fontSize: 15.5,
    color: settingsLook.ink,
  },
  error: {
    marginTop: 6,
    marginLeft: 4,
    fontSize: 12.5,
    lineHeight: 17,
    color: k1.coralText,
  },
  footer: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 16 },
  actions: { flexDirection: 'row', gap: 10 },
  action: {
    flex: 1,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 처음으로 alone across the foot (flex: 1 would give it no height in the column).
  wide: {
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancel: glassFill,
  next: {
    backgroundColor: '#02050D',
    boxShadow: '0 10px 24px rgba(2,5,14,0.22)',
  },
  cancelText: {
    fontFamily: fontFamily.bold,
    fontSize: 16.5,
    lineHeight: 22,
    color: settingsLook.ink,
  },
  nextText: {
    fontFamily: fontFamily.bold,
    fontSize: 16.5,
    lineHeight: 22,
    color: '#FFFFFF',
  },
  done: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  doneMark: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: settingsLook.ink,
    boxShadow: '0 12px 28px rgba(2,5,14,0.22)',
  },
  doneTitle: { marginTop: 20 },
});
