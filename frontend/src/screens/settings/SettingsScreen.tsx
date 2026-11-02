import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AppText,
  Backdrop,
  Button,
  Card,
  EmptyState,
  Icon,
  IconButton,
  Segmented,
  Toggle,
  useToast,
} from '../../components';
import { appConfig } from '../../config';
import {
  useRepositories,
  useResource,
  type AppSettings,
  type LocationRecordingMode,
  type Repositories,
  type WatchConnection,
} from '../../data';
import { formatClockTime } from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import { useSession } from '../../session/SessionProvider';
import {
  fontFamily,
  k1,
  radius,
  spacing,
  ThemeProvider,
  useTheme,
} from '../../theme';

const visibilityOptions: { value: 'PUBLIC' | 'PRIVATE'; label: string }[] = [
  { value: 'PUBLIC', label: '공개 계정' },
  { value: 'PRIVATE', label: '비공개 계정' },
];

const locationOptions: { value: LocationRecordingMode; label: string }[] = [
  { value: 'ALWAYS', label: '항상' },
  { value: 'RUNNING_ONLY', label: '러닝 중에만' },
  { value: 'OFF', label: '끔' },
];

// The profile photo, or the first letter of the nickname without one.
export function ProfilePhoto({
  nickname,
  photo,
  size,
}: {
  nickname: string;
  photo: string | null;
  size: number;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.photo,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: k1.deep,
          borderColor: colors.surfaceRaised,
        },
      ]}
    >
      {photo ? (
        <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} />
      ) : (
        <AppText style={{ color: k1.ice, fontSize: size * 0.38 }}>
          {nickname.slice(0, 1)}
        </AppText>
      )}
    </View>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <AppText variant="labelStrong" tone="textSecondary" style={styles.section}>
      {children}
    </AppText>
  );
}

function Row({
  title,
  detail,
  detailTone,
  first = false,
  children,
}: {
  title: string;
  detail: React.ReactNode;
  detailTone?: 'danger';
  first?: boolean;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
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
      <View style={styles.flex}>
        <AppText style={styles.rowTitle}>{title}</AppText>
        {typeof detail === 'string' ? (
          <AppText
            variant="caption"
            style={{
              color:
                detailTone === 'danger' ? k1.coralText : colors.textSecondary,
            }}
          >
            {detail}
          </AppText>
        ) : (
          detail
        )}
      </View>
      {children}
    </View>
  );
}

function SmallButton({
  title,
  solid = false,
  onPress,
}: {
  title: string;
  solid?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [
        styles.small,
        solid
          ? { backgroundColor: colors.accent, borderColor: colors.accent }
          : { borderColor: colors.borderStrong },
        pressed && styles.pressed,
      ]}
    >
      <AppText
        variant={solid ? 'bodyStrong' : 'body'}
        style={{ color: solid ? colors.onAccent : colors.textSecondary }}
      >
        {title}
      </AppText>
    </Pressable>
  );
}

// 8.1: Galaxy Watch7 · 연결됨 · 06:42 동기화; 8.3: a coral dot and 연결 해제됨 · 마지막 동기화.
function WatchLine({ watch }: { watch: WatchConnection }) {
  const synced = watch.lastSyncedAt
    ? formatClockTime(watch.lastSyncedAt)
    : null;
  if (watch.status === 'connected') {
    return (
      <AppText variant="caption" tone="textSecondary">
        {synced ? `연결됨 · ${synced} 동기화` : '연결됨'}
      </AppText>
    );
  }
  return (
    <View style={styles.watchLine}>
      <View style={[styles.dot, { backgroundColor: k1.coral }]} />
      <AppText variant="caption" style={{ color: k1.coralText }}>
        {synced ? `연결 해제됨 · 마지막 동기화 ${synced}` : '연결 해제됨'}
      </AppText>
    </View>
  );
}

const loadAll = (repositories: Repositories) =>
  Promise.all([
    repositories.profile.getMe(),
    repositories.runners.getProfile(null),
    repositories.settings.get(),
    repositories.watch.getConnection(),
  ]);

// 8.1 설정 (8.3 after 연결 해제). Each switch saves at once (U20·U14) and rolls back on failure.
export function SettingsScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const toast = useToast();
  const session = useSession();
  const { settings: settingsApi, watch: watchApi } = useRepositories();
  const loaded = useResource(loadAll);
  const { reload } = loaded;
  // Coming back from 1.7 shows the watch connected again.
  useFocusEffect(useCallback(() => reload(), [reload]));
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [watch, setWatch] = useState<WatchConnection | null>(null);
  const data = loaded.status === 'ready' ? loaded.data : null;
  useEffect(() => {
    if (data) {
      setSettings(data[2]);
      setWatch(data[3]);
    }
  }, [data]);

  const change = async (next: Partial<AppSettings>) => {
    if (!settings) {
      return;
    }
    const before = settings;
    setSettings({
      ...settings,
      ...next,
      notifications: { ...settings.notifications, ...next.notifications },
    });
    try {
      setSettings(await settingsApi.update(next));
    } catch {
      setSettings(before);
      toast('설정을 저장하지 못했어요. 잠시 후 다시 시도해 주세요');
    }
  };
  const disconnect = async (current: WatchConnection) => {
    try {
      setWatch(await watchApi.disconnect());
      toast(`${current.deviceName} 연결을 해제했어요`, {
        actionLabel: '실행 취소',
        onAction: async () => {
          try {
            setWatch(await watchApi.reconnect());
          } catch {
            toast('다시 연결하지 못했어요. 연결 버튼으로 다시 시도해 주세요');
          }
        },
      });
    } catch {
      toast('연결을 해제하지 못했어요. 잠시 후 다시 시도해 주세요');
    }
  };

  if (loaded.status === 'error' && !data) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <EmptyState
          icon="alert"
          title="설정을 불러오지 못했어요"
          actionLabel="다시 시도"
          onAction={reload}
        />
      </View>
    );
  }
  const [me, profile] = data ?? [null, null];

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colors.statusBar} />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop tail />
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + spacing.md,
            paddingBottom: insets.bottom + spacing.xxxl,
          },
        ]}
      >
        <View style={styles.header}>
          <AppText style={styles.title} accessibilityRole="header">
            설정
          </AppText>
          <IconButton
            icon="close"
            accessibilityLabel="닫기"
            onPress={() => navigation.goBack()}
          />
        </View>
        {!me || !profile || !settings || !watch ? (
          <ActivityIndicator style={styles.loading} />
        ) : (
          <>
            <Card
              onPress={() => navigateTo(navigation, 'MyProfile')}
              accessibilityLabel="내 프로필 보기"
              style={styles.profile}
            >
              <ProfilePhoto
                nickname={me.nickname}
                photo={me.profileImageUrl}
                size={56}
              />
              <View style={styles.flex}>
                <AppText style={styles.name}>{me.nickname}</AppText>
                <AppText variant="caption" tone="textSecondary">
                  {`${profile.handle} · 내 프로필 보기`}
                </AppText>
              </View>
              <Icon name="forward" color={colors.textTertiary} size={16} />
            </Card>

            <SectionLabel>러닝 코칭</SectionLabel>
            <Card style={styles.card}>
              <Row
                first
                title="코칭 음성 알림"
                detail="페이스·심박 이탈 시 음성으로 알려요"
              >
                <Toggle
                  label="코칭 음성 알림"
                  value={settings.voiceCoachingEnabled}
                  onChange={value => change({ voiceCoachingEnabled: value })}
                />
              </Row>
              <Row
                title="BPM 리듬 가이드"
                detail="목표 케이던스에 맞춰 비트를 들려줘요"
              >
                <Toggle
                  label="BPM 리듬 가이드"
                  value={settings.bpmGuideEnabled}
                  onChange={value => change({ bpmGuideEnabled: value })}
                />
              </Row>
            </Card>

            <SectionLabel>기기</SectionLabel>
            <Card style={styles.card}>
              <Row
                first
                title={watch.deviceName}
                detail={<WatchLine watch={watch} />}
              >
                {watch.status === 'connected' ? (
                  <SmallButton
                    title="연결 해제"
                    onPress={() => disconnect(watch)}
                  />
                ) : (
                  <SmallButton
                    title="연결"
                    solid
                    onPress={() => navigateTo(navigation, 'WatchConnect')}
                  />
                )}
              </Row>
              <Row title="Health Connect" detail="수면·안정 심박·활동량">
                <SmallButton
                  title="권한 관리"
                  onPress={() =>
                    toast(
                      '권한은 Health Connect 앱의 앱 권한에서 바꿀 수 있어요',
                    )
                  }
                />
              </Row>
            </Card>

            <SectionLabel>계정 공개 범위</SectionLabel>
            <Segmented
              options={visibilityOptions}
              value={settings.isPrivate ? 'PRIVATE' : 'PUBLIC'}
              onChange={value => change({ isPrivate: value === 'PRIVATE' })}
            />

            <SectionLabel>위치 기록</SectionLabel>
            <Segmented
              options={locationOptions}
              value={settings.locationRecordingMode}
              onChange={value => change({ locationRecordingMode: value })}
            />

            <SectionLabel>알림</SectionLabel>
            <Card style={styles.card}>
              <Row
                first
                title="그룹런"
                detail="시작 임박·그룹런 취소·크루 가입 결과"
              >
                <Toggle
                  label="그룹런 알림"
                  value={settings.notifications.groupRun}
                  onChange={value =>
                    change({
                      notifications: {
                        ...settings.notifications,
                        groupRun: value,
                      },
                    })
                  }
                />
              </Row>
              <Row title="커뮤니티" detail="댓글·팔로우 요청">
                <Toggle
                  label="커뮤니티 알림"
                  value={settings.notifications.community}
                  onChange={value =>
                    change({
                      notifications: {
                        ...settings.notifications,
                        community: value,
                      },
                    })
                  }
                />
              </Row>
            </Card>

            {/* 로그아웃 · 회원탈퇴 sit on the black lower part. */}
            <ThemeProvider tone="dark">
              <View style={styles.links}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="로그아웃"
                  onPress={session.signOut}
                  hitSlop={8}
                >
                  <AppText variant="bodyStrong">로그아웃</AppText>
                </Pressable>
                <View style={[styles.bar, { backgroundColor: k1.mid }]} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="회원탈퇴"
                  onPress={() => navigateTo(navigation, 'Withdraw')}
                  hitSlop={8}
                >
                  <AppText variant="bodyStrong">회원탈퇴</AppText>
                </Pressable>
              </View>
              {appConfig.developerMenu ? (
                <Card variant="deep" style={styles.card}>
                  <AppText variant="bodyStrong">개발용</AppText>
                  <Button
                    title="공통 컴포넌트 미리보기"
                    variant="secondary"
                    size="medium"
                    onPress={() => navigation.navigate('ComponentGallery')}
                  />
                  <Button
                    title="건강 데이터 PoC"
                    variant="secondary"
                    size="medium"
                    onPress={() => navigation.navigate('HealthPoc')}
                  />
                </Card>
              ) : null}
            </ThemeProvider>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  loading: { marginTop: spacing.xxxl },
  pressed: { opacity: 0.7 },
  content: { paddingHorizontal: spacing.screen, gap: spacing.md },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  title: { fontFamily: fontFamily.bold, fontSize: 28, lineHeight: 38 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  photo: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 2,
  },
  name: { fontFamily: fontFamily.bold, fontSize: 17, lineHeight: 24 },
  section: {
    marginTop: spacing.lg,
    marginLeft: spacing.xs,
    letterSpacing: 1.5,
  },
  card: { gap: 0, paddingVertical: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingVertical: spacing.xl,
  },
  rowTitle: { fontFamily: fontFamily.medium, fontSize: 16, lineHeight: 23 },
  watchLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 6, height: 6, borderRadius: 3 },
  small: {
    height: 36,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
  },
  links: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  bar: { width: 1, height: 14 },
});
