import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Animated,
  Image,
  Modal,
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
  DefaultAvatar,
  EmptyState,
  Icon,
  type IconName,
  useToast,
} from '../../components';
import { BackButton } from '../../components/BackButton';
import { appConfig } from '../../config';
import {
  useRepositories,
  useResource,
  type AppSettings,
  type LocationRecordingMode,
  type Repositories,
  type WatchConnection,
} from '../../data';
import {
  watchConnectionLabel,
  watchReadinessDetail,
} from '../../data/api/devices';
import { errorCode } from '../../data/errors';
import { setWatchHealthConsent } from '../../health/watchHealth';
import { navigateTo } from '../../navigation/navigateTo';
import { useSession } from '../../session/SessionProvider';
import { fontFamily, spacing, useTheme } from '../../theme';

export const locationLabels: Record<LocationRecordingMode, string> = {
  ALWAYS: '항상',
  RUNNING_ONLY: '러닝 중에만',
  OFF: '끔',
};

// The ink of the 8.x screens on the mist (runway-settings): navy text, a grey-blue for the second line.
export const settingsLook = {
  ink: '#02050E',
  sub: '#56646C',
  label: '#3A5A6C',
  band: 'rgba(24,46,61,0.08)',
} as const;

// The profile photo, or the default profile picture without one or when it does not load (S15P31E105-775).
// `nickname` stays so callers pass the same person.
export function ProfilePhoto({
  photo,
  size,
}: {
  nickname: string;
  photo: string | null;
  size: number;
}) {
  const { colors } = useTheme();
  const [failed, setFailed] = useState<string | null>(null);
  const shown = photo && photo !== failed ? photo : null;
  return (
    <View
      style={[
        styles.photo,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: colors.surfaceRaised,
        },
      ]}
    >
      {shown ? (
        <Image
          source={{ uri: shown }}
          style={StyleSheet.absoluteFill}
          onError={() => setFailed(shown)}
          accessibilityIgnoresInvertColors
        />
      ) : (
        // Inside the 2 border.
        <DefaultAvatar size={size - 4} />
      )}
    </View>
  );
}

// A full-width band with the section name (8.1 섹션 띠, 48 high).
function Band({ children }: { children: string }) {
  return (
    <View style={styles.band}>
      <AppText style={styles.bandText} accessibilityRole="header">
        {children}
      </AppText>
    </View>
  );
}

// One of the two tiles in a row: a 32 icon, the state in grey and the name. A switch tile turns on a
// tap; an off one draws a slash over its icon.
function Tile({
  icon,
  name,
  state,
  on,
  disabled,
  onPress,
}: {
  icon: IconName;
  name: string;
  state: string;
  // Set for a switch tile; left out for a tile that opens something.
  on?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const switchTile = on !== undefined;
  return (
    <Pressable
      accessibilityRole={switchTile ? 'switch' : 'button'}
      accessibilityLabel={name}
      accessibilityValue={{ text: state }}
      accessibilityState={
        switchTile
          ? { checked: on, disabled: !!disabled }
          : disabled
          ? { disabled: true }
          : undefined
      }
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        disabled && styles.leaving,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <View>
        <Icon
          name={icon}
          color={settingsLook.ink}
          size={32}
          strokeWidth={1.7}
        />
        {on === false ? <View style={styles.slash} /> : null}
      </View>
      <AppText style={styles.state}>{state}</AppText>
      <AppText style={styles.tileName} numberOfLines={1}>
        {name}
      </AppText>
    </Pressable>
  );
}

function Tiles({ children }: { children: React.ReactNode }) {
  return <View style={styles.tiles}>{children}</View>;
}

const loadAll = (repositories: Repositories) =>
  Promise.all([
    repositories.settings.get(),
    repositories.watch.getConnection(),
    repositories.consents.getHealth(),
  ]);

// 8.1 설정 (runway-settings): full-width bands with two tiles each. A switch tile saves at once (U20·U14)
// and rolls back on failure; 위치 기록 opens 8.1b. The profile card and the setting descriptions are
// left out as in the mockup (담당자 결정); 지도 확인 stays as a third 개발용 tile.
export function SettingsScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const toast = useToast();
  const session = useSession();
  const {
    settings: settingsApi,
    watch: watchApi,
    consents: consentsApi,
  } = useRepositories();
  const loaded = useResource(loadAll);
  const { reload } = loaded;
  // Coming back from 1.7 shows the watch connected again, and from 8.1b the location mode.
  useFocusEffect(useCallback(() => reload(), [reload]));
  useFocusEffect(
    useCallback(() => {
      const subscription = AppState.addEventListener('change', state => {
        if (state === 'active') reload();
      });
      return () => subscription.remove();
    }, [reload]),
  );
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [watch, setWatch] = useState<WatchConnection | null>(null);
  // HEALTH_DATA consent (W05). Withdrawing asks first in a sheet; saving blocks a second tap.
  const [health, setHealth] = useState<boolean | null>(null);
  const [askWithdraw, setAskWithdraw] = useState(false);
  const [savingHealth, setSavingHealth] = useState(false);
  // S15P31E105-638: one U20·U14 at a time so rapid taps cannot race the optimistic UI.
  const [savingSettings, setSavingSettings] = useState(false);
  const savingSettingsRef = useRef(false);
  // True while U03 runs (5 seconds at most), so 로그아웃 is not sent twice.
  const [leaving, setLeaving] = useState(false);
  const logOut = () => {
    setLeaving(true);
    void session.logOut();
  };
  const data = loaded.status === 'ready' ? loaded.data : null;
  useEffect(() => {
    if (data) {
      setSettings(data[0]);
      setWatch(data[1]);
      setHealth(data[2]);
    }
  }, [data]);

  // W04 saves the consent; the watch then gets the same value (DISAGREE also clears the
  // unuploaded heart-rate records on the phone and the watch, as sign-out does — 담당자 결정).
  // A 503 or a lost answer may still have applied it, so W05 says what the server holds now.
  const saveHealth = async (granted: boolean) => {
    setAskWithdraw(false);
    setSavingHealth(true);
    const applied = (value: boolean) => {
      setHealth(value);
      void setWatchHealthConsent(value ? 'AGREE' : 'DISAGREE');
    };
    try {
      const saved = await consentsApi.setHealth(granted);
      applied(saved);
      toast(
        saved
          ? '건강정보 수집에 동의했어요'
          : '건강정보 수집 동의를 철회했어요',
      );
    } catch {
      let now: boolean | null = null;
      try {
        now = await consentsApi.getHealth();
        applied(now);
      } catch {
        // The server could not be asked either; the tile keeps the last known value.
      }
      toast(
        now === granted
          ? granted
            ? '건강정보 수집에 동의했어요'
            : '건강정보 수집 동의를 철회했어요'
          : '저장하지 못했어요. 잠시 후 다시 시도해 주세요',
      );
    } finally {
      setSavingHealth(false);
    }
  };

  const change = async (next: Partial<AppSettings>) => {
    if (!settings || savingSettingsRef.current) {
      return;
    }
    savingSettingsRef.current = true;
    setSavingSettings(true);
    const before = settings;
    setSettings({
      ...settings,
      ...next,
      notifications: { ...settings.notifications, ...next.notifications },
    });
    try {
      setSettings(await settingsApi.update(next));
    } catch (error) {
      // PATCH landed but the untouched companion GET failed — keep the optimistic value.
      if (errorCode(error) === 'SAVE_UNCONFIRMED') {
        toast('저장했어요. 최신 설정을 불러오지 못했어요');
      } else {
        setSettings(before);
        toast('설정을 저장하지 못했어요. 잠시 후 다시 시도해 주세요');
      }
    } finally {
      savingSettingsRef.current = false;
      setSavingSettings(false);
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
  // S15P31E105-625: after W03, tap again to W01 when a Data Layer node is reachable.
  // No node → 1.7 (same as before). Samsung Wearable pairing/list picking stays out of scope.
  const reconnect = async () => {
    try {
      const next = await watchApi.reconnect();
      setWatch(next);
      if (next.status === 'connected') {
        toast(`${next.deviceName}을(를) 다시 등록했어요`);
        return;
      }
      navigateTo(navigation, 'WatchConnect');
    } catch {
      toast('다시 등록하지 못했어요. 잠시 후 다시 시도해 주세요');
    }
  };

  // S15P31E105-555: 로그아웃 (U03) and 회원탈퇴 need none of the settings, so a failed read still shows them.
  const failed = loaded.status === 'error' && !data;
  const accountLinks = (
    <View style={styles.links}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="로그아웃"
        accessibilityState={{ busy: leaving, disabled: leaving }}
        disabled={leaving}
        onPress={logOut}
        hitSlop={8}
        style={leaving && styles.leaving}
      >
        <AppText style={styles.logOut}>로그아웃</AppText>
      </Pressable>
      <View style={styles.bar} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="회원탈퇴"
        onPress={() => navigateTo(navigation, 'Withdraw')}
        hitSlop={8}
      >
        <AppText style={styles.withdraw}>회원탈퇴</AppText>
      </Pressable>
    </View>
  );
  const onOff = (on: boolean) => (on ? '켜기' : '끄기');
  // S15P31E105-612: the map data notices need none of the settings either, so they show on a failed read too.
  const about = (
    <>
      <Band>정보</Band>
      <Tiles>
        <Tile
          icon="note"
          name="데이터 라이선스"
          state="지도 데이터"
          onPress={() => navigateTo(navigation, 'DataLicense')}
        />
      </Tiles>
    </>
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="dark-content" />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop tail />
      </View>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <BackButton onPress={() => navigation.goBack()} />
        <AppText style={styles.title} accessibilityRole="header">
          설정
        </AppText>
      </View>
      {failed ? (
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        >
          <EmptyState
            icon="alert"
            title="설정을 불러오지 못했어요"
            actionLabel="다시 시도"
            onAction={reload}
          />
          {about}
          {accountLinks}
        </ScrollView>
      ) : !settings || !watch ? (
        <ActivityIndicator style={styles.loading} />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        >
          <Band>러닝 코칭</Band>
          <Tiles>
            <Tile
              icon="mic"
              name="코칭 음성 알림"
              state={onOff(settings.voiceCoachingEnabled)}
              on={settings.voiceCoachingEnabled}
              disabled={savingSettings}
              onPress={() =>
                change({ voiceCoachingEnabled: !settings.voiceCoachingEnabled })
              }
            />
            <Tile
              icon="pulse"
              name="BPM 리듬 가이드"
              state={onOff(settings.bpmGuideEnabled)}
              on={settings.bpmGuideEnabled}
              disabled={savingSettings}
              onPress={() =>
                change({ bpmGuideEnabled: !settings.bpmGuideEnabled })
              }
            />
          </Tiles>

          <Band>기기</Band>
          <Tiles>
            {/* Connected → W03 (실행 취소 = W01). Disconnected → W01 when a node is nearby, else 1.7. */}
            <Tile
              icon="smartwatch"
              name={watch.deviceName}
              state={[watchConnectionLabel(watch), watchReadinessDetail(watch)]
                .filter(Boolean)
                .join('\n')}
              onPress={() => {
                if (watch.status === 'connected') {
                  disconnect(watch);
                } else {
                  reconnect();
                }
              }}
            />
            {/* Giving consent saves at once; withdrawing asks first (W04·W05). */}
            {health !== null ? (
              <Tile
                icon="shieldCheck"
                name="건강정보 수집"
                state={health ? '동의함' : '철회함'}
                on={health}
                onPress={() => {
                  if (savingHealth) return;
                  if (health) setAskWithdraw(true);
                  else void saveHealth(true);
                }}
              />
            ) : null}
          </Tiles>

          {/* 계정 공개 범위 moved to 8.2 프로필 수정 (S15P31E105-775). */}
          <Band>위치</Band>
          <Tiles>
            <Tile
              icon="mapPin"
              name="위치 기록"
              state={locationLabels[settings.locationRecordingMode]}
              onPress={() => navigateTo(navigation, 'LocationSetting')}
            />
          </Tiles>

          <Band>알림</Band>
          <Tiles>
            <Tile
              icon="users"
              name="그룹런 알림"
              state={onOff(settings.notifications.groupRun)}
              on={settings.notifications.groupRun}
              disabled={savingSettings}
              onPress={() =>
                change({
                  notifications: {
                    ...settings.notifications,
                    groupRun: !settings.notifications.groupRun,
                  },
                })
              }
            />
            <Tile
              icon="community"
              name="커뮤니티 알림"
              state={onOff(settings.notifications.community)}
              on={settings.notifications.community}
              disabled={savingSettings}
              onPress={() =>
                change({
                  notifications: {
                    ...settings.notifications,
                    community: !settings.notifications.community,
                  },
                })
              }
            />
          </Tiles>

          {appConfig.developerMenu ? (
            <>
              <Band>개발용</Band>
              <Tiles>
                <Tile
                  icon="code"
                  name="공통 컴포넌트"
                  state="미리보기"
                  onPress={() => navigation.navigate('ComponentGallery')}
                />
                <Tile
                  icon="heartbeat"
                  name="건강 데이터"
                  state="PoC"
                  onPress={() => navigation.navigate('HealthPoc')}
                />
                <Tile
                  icon="route"
                  name="지도 확인"
                  state="PoC"
                  onPress={() => navigation.navigate('MapPoc')}
                />
              </Tiles>
            </>
          ) : null}

          {about}
          {accountLinks}
        </ScrollView>
      )}
      <WithdrawConsentSheet
        visible={askWithdraw}
        onCancel={() => setAskWithdraw(false)}
        onWithdraw={() => saveHealth(false)}
      />
    </View>
  );
}

// 건강정보 수집 철회 확인 in the 8.x look (담당자 결정): a mist sheet with its top corners rounded, the
// navy title and grey line of 8.4–8.6, and their foot buttons — 취소 in glass, 철회하기 in red.
function WithdrawConsentSheet({
  visible,
  onCancel,
  onWithdraw,
}: {
  visible: boolean;
  onCancel: () => void;
  onWithdraw: () => void;
}) {
  const insets = useSafeAreaInsets();
  const rise = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (visible) {
      rise.setValue(1);
      Animated.timing(rise, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start();
    }
  }, [rise, visible]);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      <View style={styles.sheetRoot}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="닫기"
          onPress={onCancel}
          style={[StyleSheet.absoluteFill, styles.scrim]}
        />
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              paddingBottom: insets.bottom + 16,
              transform: [
                {
                  translateY: rise.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 400],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={styles.handle} />
          {/* One line (담당자 요청): a narrow phone shrinks the 25 title rather than wrapping it. */}
          <AppText
            style={styles.sheetTitle}
            accessibilityRole="header"
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            건강정보 수집 동의를 철회할까요?
          </AppText>
          {/* Two lines broken after 중단되며 (담당자 요청); a narrow phone shrinks them to keep two. */}
          <AppText
            style={styles.sheetNote}
            numberOfLines={2}
            adjustsFontSizeToFit
          >
            {
              '동의 철회 시 건강정보 수집 및 컨디션 확인이 중단되며,\n아직 전송되지 않은 심박 기록은 삭제되고 기존 기록은 유지됩니다.'
            }
          </AppText>
          <View style={styles.sheetActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="취소"
              onPress={onCancel}
              style={({ pressed }) => [
                styles.sheetAction,
                styles.sheetCancel,
                pressed && styles.pressed,
              ]}
            >
              <AppText style={styles.sheetCancelText}>취소</AppText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="철회하기"
              onPress={onWithdraw}
              style={({ pressed }) => [
                styles.sheetAction,
                styles.sheetWithdraw,
                pressed && styles.pressed,
              ]}
            >
              <AppText style={styles.sheetWithdrawText}>철회하기</AppText>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loading: { marginTop: spacing.xxxl },
  // The 철회 sheet: the top of the mist (mistGradient) under a navy dim, with 8.4–8.6's type and buttons.
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  scrim: { backgroundColor: 'rgba(2,5,14,0.45)' },
  sheet: {
    backgroundColor: '#F5F7F9',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
  },
  handle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    marginTop: 10,
    marginBottom: 22,
    backgroundColor: 'rgba(24,46,61,0.16)',
  },
  sheetTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 25,
    lineHeight: 33,
    letterSpacing: -0.6,
    color: settingsLook.ink,
  },
  sheetNote: {
    marginTop: 8,
    // 15 rather than 8.4–8.6's 14 (담당자 요청).
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: -0.2,
    color: settingsLook.sub,
  },
  sheetActions: { flexDirection: 'row', gap: 10, marginTop: 28 },
  sheetAction: {
    flex: 1,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 8.5's glass 취소 and navy step-on button (WithdrawScreens).
  sheetCancel: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    backgroundColor: 'rgba(255,255,255,0.5)',
    boxShadow:
      '0 10px 30px rgba(9,17,26,0.08), inset 0 1px 0 rgba(255,255,255,0.7)',
  },
  // The red of 5.2's 기록 삭제 (RecordDetailScreen danger), as the withdrawal deletes records too (담당자 요청).
  sheetWithdraw: {
    backgroundColor: '#D44A4A',
    boxShadow: '0 10px 24px rgba(212,74,74,0.22)',
  },
  sheetCancelText: {
    fontFamily: fontFamily.bold,
    fontSize: 16.5,
    lineHeight: 22,
    color: settingsLook.ink,
  },
  sheetWithdrawText: {
    fontFamily: fontFamily.bold,
    fontSize: 16.5,
    lineHeight: 22,
    color: '#FFFFFF',
  },
  pressed: { opacity: 0.6 },
  // 뒤로 and the title on one line, the content from 92 down.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: 22,
    lineHeight: 30,
    letterSpacing: -0.5,
    color: settingsLook.ink,
  },
  photo: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 2,
  },
  band: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: settingsLook.band,
  },
  bandText: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: -0.2,
    color: settingsLook.label,
  },
  tiles: { flexDirection: 'row', flexWrap: 'wrap' },
  tile: {
    width: '50%',
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A slash from the top left to the bottom right of the 32 icon.
  slash: {
    position: 'absolute',
    left: 15,
    top: -3,
    width: 1.7,
    height: 38,
    borderRadius: 1,
    backgroundColor: settingsLook.ink,
    transform: [{ rotate: '-45deg' }],
  },
  state: {
    marginTop: 14,
    fontFamily: fontFamily.medium,
    fontSize: 13.5,
    lineHeight: 18,
    letterSpacing: -0.2,
    color: settingsLook.sub,
  },
  tileName: {
    marginTop: 3,
    fontFamily: fontFamily.bold,
    fontSize: 16.5,
    lineHeight: 22,
    letterSpacing: -0.3,
    color: settingsLook.ink,
  },
  links: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    paddingVertical: 36,
  },
  logOut: {
    fontFamily: fontFamily.bold,
    fontSize: 16.5,
    lineHeight: 24,
    letterSpacing: -0.2,
    color: settingsLook.ink,
  },
  withdraw: {
    fontFamily: fontFamily.bold,
    fontSize: 16.5,
    lineHeight: 24,
    letterSpacing: -0.2,
    color: settingsLook.sub,
  },
  leaving: { opacity: 0.5 },
  bar: { width: 1, height: 14, backgroundColor: 'rgba(2,5,14,0.25)' },
});
