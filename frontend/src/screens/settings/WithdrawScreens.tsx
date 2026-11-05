import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { StackActions, useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AppText,
  Backdrop,
  Card,
  EmptyState,
  Icon,
  KeyboardLift,
  TextField,
  useToast,
} from '../../components';
import {
  errorCode,
  useRepositories,
  useResource,
  type Repositories,
  type WithdrawalSummary,
} from '../../data';
import { navigateTo } from '../../navigation/navigateTo';
import { useSession } from '../../session/SessionProvider';
import {
  fontFamily,
  k1,
  palette,
  radius,
  spacing,
  useTheme,
} from '../../theme';
import { GlowButton } from '../course/TodayRunScreen';
import { FooterButton } from '../group/GroupRunDetailScreen';
import { BackButton } from '../../components/BackButton';

// 회원탈퇴 1/2 · 2/2 over the K1 background, with 취소 · 탈퇴하기 on the black lower part.
function Frame({
  step,
  title,
  description,
  children,
  footer,
}: {
  step: string;
  title: string;
  description: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  const navigation = useNavigation();
  const { colors } = useTheme();
  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colors.statusBar} />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop />
      </View>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <BackButton onPress={() => navigation.goBack()} />
          <AppText style={styles.headerTitle} accessibilityRole="header">
            회원탈퇴
          </AppText>
          <AppText variant="caption" tone="textSecondary">
            {step}
          </AppText>
        </View>
      </SafeAreaView>
      {/* The keyboard lifts the footer above it (S15P31E105-473). */}
      <KeyboardLift>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
          <AppText style={styles.title}>{title}</AppText>
          <AppText variant="body" tone="textSecondary">
            {description}
          </AppText>
          {children}
        </ScrollView>
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          {footer}
        </SafeAreaView>
      </KeyboardLift>
    </View>
  );
}

function LossRow({
  title,
  detail,
  first,
}: {
  title: string;
  detail: string;
  first: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.loss,
        !first && {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
        },
      ]}
    >
      <View style={styles.lossMark}>
        <Icon name="close" color={k1.coral} size={14} />
      </View>
      <View style={styles.flex}>
        <AppText style={styles.lossTitle}>{title}</AppText>
        <AppText variant="caption" tone="textSecondary">
          {detail}
        </AppText>
      </View>
    </View>
  );
}

function losses(summary: WithdrawalSummary) {
  return [
    {
      title: `러닝 기록 ${summary.runningRecordCount}회`,
      detail: '거리·페이스·심박·지도 경로',
    },
    {
      title: `커뮤니티 게시물 ${summary.postCount}개`,
      detail: '사진·글·댓글·좋아요',
    },
    {
      title: `저장한 코스 ${summary.savedCourseCount}개`,
      detail: '내가 만든 코스 포함',
    },
    ...summary.connectedDevices.map(device => ({
      title: '워치 연결',
      detail: `${device} 연결이 해제돼요`,
    })),
  ];
}

const loadSummary = (repositories: Repositories) =>
  repositories.account.getWithdrawalSummary();

// 8.4 회원탈퇴 확인 (U17): what goes away, the crews I lead and the agreement U18 needs.
export function WithdrawScreen() {
  const navigation = useNavigation();
  const summary = useResource(loadSummary);
  const [agreed, setAgreed] = useState(false);
  return (
    <Frame
      step="1/2"
      title="정말 탈퇴할까요?"
      description="탈퇴하면 아래 정보가 모두 지워지고 되돌릴 수 없어요."
      footer={
        <>
          <FooterButton title="취소" onPress={() => navigation.goBack()} />
          <FooterButton
            title="탈퇴하기"
            danger
            disabled={!agreed || summary.status !== 'ready'}
            onPress={() => navigateTo(navigation, 'WithdrawPassword')}
          />
        </>
      }
    >
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
        <>
          <Card style={styles.list}>
            {losses(summary.data).map((item, index) => (
              <LossRow key={item.title} {...item} first={index === 0} />
            ))}
          </Card>
          {summary.data.ownedCrews.length ? (
            <View style={styles.warning}>
              <Icon name="alert" color={k1.coral} size={18} />
              <View style={styles.flex}>
                <AppText variant="bodyStrong" style={{ color: k1.coralText }}>
                  크루장인 크루가 있어요
                </AppText>
                <AppText variant="body">
                  {`${summary.data.ownedCrews.join(
                    ', ',
                  )} · 탈퇴하면 가장 오래된 멤버에게 크루장이 넘어가요.`}
                </AppText>
              </View>
            </View>
          ) : null}
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel="탈퇴 동의"
            accessibilityState={{ checked: agreed }}
            onPress={() => setAgreed(value => !value)}
            style={styles.agree}
          >
            <View style={[styles.box, agreed && styles.boxOn]}>
              {agreed ? (
                <Icon name="check" color={k1.ice} size={16} strokeWidth={2.6} />
              ) : null}
            </View>
            <AppText variant="body" style={styles.flex}>
              위 내용을 확인했고, 지워진 정보는 되돌릴 수 없다는 데 동의해요
            </AppText>
          </Pressable>
        </>
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
      if (errorCode(error) === 'INVALID_PASSWORD') {
        setWrong(true);
      } else {
        toast('탈퇴하지 못했어요. 잠시 후 다시 시도해 주세요');
      }
      setBusy(false);
    }
  };
  return (
    <Frame
      step="2/2"
      title="비밀번호를 입력해 주세요"
      description="본인 확인 후 탈퇴가 진행돼요."
      footer={
        <>
          <FooterButton
            title="취소"
            onPress={() => navigateTo(navigation, 'Settings')}
          />
          <FooterButton
            title="탈퇴하기"
            danger
            disabled={!password || busy}
            onPress={withdraw}
          />
        </>
      }
    >
      <View style={styles.field}>
        <TextField
          label="비밀번호"
          placeholder="비밀번호 입력"
          secureTextEntry
          value={password}
          onChangeText={text => {
            setPassword(text);
            setWrong(false);
          }}
          status={wrong ? 'error' : 'default'}
          helper={wrong ? '비밀번호가 맞지 않아요' : undefined}
        />
      </View>
    </Frame>
  );
}

// 8.6 탈퇴 완료: the account is gone, so every way out (처음으로 or back) signs out to 1.1.
export function WithdrawDoneScreen() {
  const session = useSession();
  const { colors } = useTheme();
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
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colors.statusBar} />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop />
      </View>
      <View style={styles.done}>
        <View style={styles.doneMark}>
          <Icon
            name="check"
            color={palette.white}
            size={32}
            strokeWidth={2.4}
          />
        </View>
        <AppText style={styles.doneTitle} accessibilityRole="header">
          탈퇴가 완료됐어요
        </AppText>
        <AppText variant="body" tone="textSecondary">
          그동안 함께 달려 주셔서 고마워요.
        </AppText>
      </View>
      <SafeAreaView edges={['bottom']} style={styles.doneFooter}>
        <GlowButton title="처음으로" icon="forward" onPress={session.signOut} />
      </SafeAreaView>
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
    fontFamily: fontFamily.bold,
    fontSize: 19,
    lineHeight: 26,
  },
  // Room under the last box for the floating buttons.
  content: { padding: spacing.screen, paddingBottom: 120, gap: spacing.md },
  title: { fontFamily: fontFamily.bold, fontSize: 26, lineHeight: 36 },
  list: { gap: 0, paddingVertical: spacing.xs, marginTop: spacing.md },
  loss: {
    flexDirection: 'row',
    gap: spacing.xl,
    paddingVertical: spacing.xl,
  },
  lossMark: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(226,135,111,0.16)',
  },
  lossTitle: { fontFamily: fontFamily.medium, fontSize: 16, lineHeight: 23 },
  warning: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: 'rgba(226,135,111,0.6)',
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  agree: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.lg,
    paddingTop: spacing.md,
  },
  box: {
    width: 26,
    height: 26,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: k1.night,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: k1.night },
  field: { marginTop: spacing.lg },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.screen,
    paddingBottom: spacing.xl,
  },
  done: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingBottom: 80,
  },
  doneMark: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: k1.night,
    marginBottom: spacing.md,
  },
  doneTitle: { fontFamily: fontFamily.bold, fontSize: 26, lineHeight: 36 },
  doneFooter: { paddingHorizontal: spacing.screen, paddingBottom: spacing.xl },
});
