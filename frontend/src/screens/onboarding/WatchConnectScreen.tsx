import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  LinearGradient,
  Path,
  RadialGradient,
  Stop,
} from 'react-native-svg';
import { AppText, Button, Icon, Screen, type IconName } from '../../components';
import {
  useRepositories,
  useResource,
  type Repositories,
  type WatchConnection,
  type WatchLinkState,
} from '../../data';
import {
  neverHadWatch,
  watchConnectionLabel,
  watchReadinessDetail,
} from '../../data/api/devices';
import { navigateTo } from '../../navigation/navigateTo';
import { useSession } from '../../session/SessionProvider';
import {
  fontFamily,
  k1,
  palette,
  spacing,
  ThemeProvider,
  useTheme,
} from '../../theme';
import {
  GoButton,
  Logo,
  OnboardingHeader,
  onboardingLook,
  onboardingScreen,
  TextLink,
} from './parts';
import { useFinishOnboarding } from './SignUpDraft';

const permissions: {
  key: keyof WatchConnection['permissions'];
  title: string;
  icon: IconName;
  source: string;
}[] = [
  {
    key: 'heartRate',
    title: '심박수',
    icon: 'heartPulse',
    source: '워치 센서',
  },
  { key: 'location', title: '위치', icon: 'mapPin', source: '휴대폰 GPS' },
  { key: 'sleep', title: '수면', icon: 'moon', source: '삼성 헬스' },
  { key: 'activity', title: '활동량', icon: 'activity', source: '워치 활동' },
];

// 2×2 grid: 심박수 · 위치 on top, 수면 · 활동량 below.
const permissionRows = [permissions.slice(0, 2), permissions.slice(2)];

const stateLabels: Record<WatchLinkState, string> = {
  connected: '연결됨',
  denied: '권한 거부',
  disconnected: '연결 끊김',
  unknown: '미확인',
};

const loadConnection = (repositories: Repositories) =>
  repositories.watch.getConnection();

// Proportions of the prototype's 1.7: a 250px watch with a 226px face, standing on a 320×52 glowing base.
const faceRatio = 226 / 250;
const standWidthRatio = 320 / 250;
const standHeightRatio = 52 / 250;

// The watch on its base. Connected: teal face glow and a light base (1.7); otherwise gray face and coral base (1.8).
function WatchFace({
  connection,
  busy,
}: {
  connection: WatchConnection | null;
  busy: boolean;
}) {
  const { colors } = useTheme();
  const window = useWindowDimensions();
  const connected = connection?.status === 'connected';
  // No watch ever linked looks like waiting, not 1.8's coral 끊김 (TEAM QA T06, S15P31E105-784).
  const waiting = busy || !connection || neverHadWatch(connection);
  const tone = waiting ? palette.pale : connected ? k1.ice : k1.coral;
  // Near the prototype's 250/360 width, capped by height so the 2×2 cards below still fit.
  const watch = Math.min(window.width * 0.7, window.height * 0.3, 340);
  const half = watch / 2;
  const standWidth = watch * standWidthRatio;
  const standHeight = watch * standHeightRatio;
  const scale = watch / 250;
  return (
    <View>
      <View
        style={[
          styles.watchStage,
          { width: standWidth, height: watch + standHeight / 2 },
        ]}
      >
        <Svg width={standWidth} height={standHeight} style={styles.stand}>
          <Defs>
            <RadialGradient id="standGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={tone} stopOpacity={0.32} />
              <Stop offset="0.45" stopColor={tone} stopOpacity={0.14} />
              <Stop offset="0.75" stopColor={tone} stopOpacity={0.04} />
              <Stop offset="1" stopColor={tone} stopOpacity={0} />
            </RadialGradient>
            {/* The rim fades out at both ends like the prototype's mask. */}
            <LinearGradient id="standRim" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={tone} stopOpacity={0} />
              <Stop offset="0.22" stopColor={tone} stopOpacity={0.85} />
              <Stop offset="0.78" stopColor={tone} stopOpacity={0.85} />
              <Stop offset="1" stopColor={tone} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Ellipse
            cx={standWidth / 2}
            cy={standHeight / 2}
            rx={standWidth / 2}
            ry={standHeight / 2}
            fill="url(#standGlow)"
          />
          <Path
            d={`M 1 ${standHeight / 2} A ${standWidth / 2 - 1} ${
              standHeight / 2 - 1
            } 0 0 0 ${standWidth - 1} ${standHeight / 2}`}
            stroke="url(#standRim)"
            strokeWidth={1.5}
            fill="none"
          />
        </Svg>
        <View style={{ width: watch, height: watch }}>
          <Svg width={watch} height={watch}>
            <Defs>
              <LinearGradient id="bezel" x1="0.2" y1="0" x2="0.8" y2="1">
                <Stop offset="0" stopColor={palette.metalLight} />
                <Stop offset="0.5" stopColor={palette.metal} />
                <Stop offset="1" stopColor={palette.metalDark} />
              </LinearGradient>
              <RadialGradient id="face" cx="50%" cy="40%" r="62%">
                <Stop
                  offset="0"
                  stopColor={connected ? palette.faceGlow : palette.faceOff}
                />
                <Stop offset="0.72" stopColor={palette.black} />
              </RadialGradient>
            </Defs>
            <Circle cx={half} cy={half} r={half - 1} fill="url(#bezel)" />
            <Circle cx={half} cy={half} r={half * 0.955} fill={palette.night} />
            <Circle
              cx={half}
              cy={half}
              r={half * faceRatio}
              fill="url(#face)"
            />
          </Svg>
          {/* The face stays black on the light K1 top, so its text uses the dark tone. */}
          <ThemeProvider tone="dark">
            <View style={[StyleSheet.absoluteFill, styles.faceContent]}>
              {waiting ? (
                <>
                  <ActivityIndicator color={colors.accent} />
                  <AppText variant="captionStrong" tone="textSecondary">
                    워치를 찾는 중이에요
                  </AppText>
                </>
              ) : (
                <>
                  <Icon
                    name={connected ? 'check' : 'close'}
                    color={tone}
                    size={26 * scale}
                    strokeWidth={2.4}
                  />
                  <AppText
                    variant="captionStrong"
                    style={{
                      color: tone,
                      fontSize: 12 * scale,
                      lineHeight: 18 * scale,
                    }}
                  >
                    {connection
                      ? watchConnectionLabel(connection)
                      : '워치 없음'}
                  </AppText>
                </>
              )}
            </View>
          </ThemeProvider>
        </View>
      </View>
    </View>
  );
}

function Battery({ percent }: { percent: number | null }) {
  const { colors } = useTheme();
  // Three bars like the prototype's battery glyph; an unknown level shows an empty outline.
  const bars = percent === null ? 0 : Math.max(1, Math.ceil(percent / 34));
  return (
    <View style={styles.statusItem}>
      <View style={styles.batteryRow}>
        <View style={[styles.battery, { borderColor: colors.text }]}>
          {[0, 1, 2].map(index => (
            <View
              key={index}
              style={[
                styles.batteryBar,
                index < bars && { backgroundColor: colors.text },
              ]}
            />
          ))}
        </View>
        <View style={[styles.batteryNub, { backgroundColor: colors.text }]} />
      </View>
      <AppText variant="metricSmall">
        {percent === null ? '– –' : `${percent}%`}
      </AppText>
    </View>
  );
}

function PermissionCard({
  title,
  icon,
  state,
  source,
}: {
  title: string;
  icon: IconName;
  state: WatchLinkState;
  source: string;
}) {
  const { colors } = useTheme();
  const tint =
    state === 'connected'
      ? onboardingLook.ink
      : state === 'denied'
      ? colors.danger
      : colors.textDisabled;
  return (
    <View
      accessible
      accessibilityLabel={`${title} ${stateLabels[state]}`}
      style={styles.permission}
    >
      <AppText style={styles.permissionTitle}>{title}</AppText>
      <AppText variant="caption" tone="textSecondary">
        {source}
      </AppText>
      <AppText
        style={[
          styles.permissionState,
          state === 'denied' && { color: colors.danger },
        ]}
      >
        {stateLabels[state]}
      </AppText>
      <View style={styles.permissionIcon}>
        <Icon name={icon} color={tint} size={40} strokeWidth={1.5} />
      </View>
    </View>
  );
}

// 1.7 워치 연결 and its 1.8 끊김·권한 거부 state. Also opened from 8.1 설정, where finishing returns home.
export function WatchConnectScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { watch } = useRepositories();
  const session = useSession();
  const finishOnboarding = useFinishOnboarding();
  const loaded = useResource(useCallback(loadConnection, []));
  const { reload } = loaded;
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) firstFocus.current = false;
      else reload();
      const subscription = AppState.addEventListener('change', state => {
        if (state === 'active') reload();
      });
      return () => subscription.remove();
    }, [reload]),
  );
  const [connection, setConnection] = useState<WatchConnection | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (loaded.status === 'ready') {
      setConnection(loaded.data);
    }
  }, [loaded.status, loaded.data]);

  const finish = () =>
    session.signedIn ? navigateTo(navigation, 'Home') : finishOnboarding();
  const reconnect = async () => {
    setReconnecting(true);
    setFailed(false);
    try {
      setConnection(await watch.reconnect());
    } catch {
      setFailed(true);
    }
    setReconnecting(false);
  };

  const error = loaded.status === 'error' || failed;
  const busy = loaded.status === 'loading' || reconnecting;
  const connected = connection?.status === 'connected';
  const noWatch = connection ? neverHadWatch(connection) : false;
  const dotColor = connected
    ? colors.accent
    : noWatch
    ? colors.textDisabled
    : colors.danger;
  const detail = connection ? watchReadinessDetail(connection) : null;
  return (
    <Screen
      background={onboardingScreen.background}
      contentStyle={styles.content}
      header={
        <View style={styles.header}>
          <View style={styles.headerSide}>
            {session.signedIn ? (
              <OnboardingHeader onBack={navigation.goBack} />
            ) : null}
          </View>
          <Logo width={124} />
          <View style={styles.headerSide} />
        </View>
      }
    >
      <View style={styles.faceArea}>
        <WatchFace
          connection={error ? null : connection}
          busy={busy && !error}
        />
        {connection && !error ? (
          <View style={styles.status}>
            <View style={styles.statusItem}>
              {/* A soft halo stands in for the prototype's glowing dot. */}
              <View style={styles.dotWrap}>
                <View style={[styles.halo, { backgroundColor: dotColor }]} />
                <View style={[styles.dot, { backgroundColor: dotColor }]} />
              </View>
              <AppText
                variant="captionStrong"
                tone={
                  connected
                    ? 'accentText'
                    : noWatch
                    ? 'textSecondary'
                    : 'danger'
                }
              >
                {watchConnectionLabel(connection)}
              </AppText>
            </View>
            <Battery percent={connection.batteryPercent} />
          </View>
        ) : null}
        {detail ? (
          <AppText
            variant="caption"
            tone="textSecondary"
            style={styles.readinessDetail}
          >
            {detail}
            {connection?.readinessReasons?.some(
              reason =>
                reason === 'HEART_RATE_PERMISSION' ||
                reason === 'ACTIVITY_PERMISSION',
            )
              ? '\n워치의 RunWay 앱에서 건강정보 동의를 확인하고 ‘권한 허용’을 눌러 주세요.'
              : '\n워치에서 RunWay 앱을 열고 다시 확인해 주세요.'}
          </AppText>
        ) : null}
        {connection && !busy ? (
          <Button
            title="다시 확인"
            variant="text"
            size="small"
            onPress={reload}
          />
        ) : null}
      </View>
      {/* The cards and the slider reach the lower part of the mist background, which stays light. */}
      {/* Keep the cards in normal scroll flow; a missing-permission notice must not squeeze them into the footer. */}
      <View style={styles.cardsArea}>
        {error ? (
          <View style={styles.errorBox}>
            <AppText variant="caption" tone="danger">
              워치 상태를 확인하지 못했어요.
            </AppText>
            <Button
              title="다시 시도"
              variant="secondary"
              size="small"
              onPress={failed ? reconnect : loaded.reload}
            />
          </View>
        ) : connection ? (
          <View style={styles.permissions}>
            {permissionRows.map(row => (
              <View key={row[0].key} style={styles.permissionRow}>
                {row.map(item => (
                  <PermissionCard
                    key={item.key}
                    title={item.title}
                    icon={item.icon}
                    state={connection.permissions[item.key]}
                    source={item.source}
                  />
                ))}
              </View>
            ))}
          </View>
        ) : null}
      </View>
      {/* 다시 연결/나중에 연결하기가 고정 footer로 떠 있으면 아래 권한 카드 위에 겹쳐 보였다
          (QA 발견, S15P31E105-825). footer prop 대신 일반 콘텐츠로 두어 다른 내용과 함께 스크롤되게 한다. */}
      {connected && !busy ? (
        <View style={styles.footerArea}>
          <GoButton title="시작하기" onPress={finish} />
        </View>
      ) : !busy && (connection || error) ? (
        <View style={styles.footerArea}>
          {connection ? (
            <GoButton
              title={noWatch ? '워치 연결하기' : '다시 연결'}
              onPress={reconnect}
            />
          ) : null}
          <TextLink
            title="나중에 연결하기"
            onPress={finish}
            style={styles.later}
          />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSide: { width: 76 },
  content: { alignItems: 'stretch', gap: 0, paddingHorizontal: 24 },
  faceArea: { alignItems: 'center', paddingTop: spacing.xl },
  faceContent: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  watchStage: { alignItems: 'center' },
  // The base sits behind the bottom edge of the watch.
  stand: { position: 'absolute', bottom: 0 },
  status: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xxl,
    marginTop: spacing.xxl,
  },
  statusItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dotWrap: {
    width: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    opacity: 0.25,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  batteryRow: { flexDirection: 'row', alignItems: 'center' },
  battery: {
    flexDirection: 'row',
    gap: 1.5,
    width: 20,
    height: 11,
    borderRadius: 3,
    borderWidth: 1.2,
    padding: 1.5,
  },
  batteryBar: { flex: 1, borderRadius: 0.5 },
  batteryNub: { width: 1.5, height: 4, borderRadius: 1, marginLeft: 1 },
  cardsArea: { marginTop: spacing.lg },
  readinessDetail: { textAlign: 'center', marginTop: spacing.sm },
  // All four cards fit the width with the screen's side margins, instead of scrolling sideways.
  permissions: { gap: spacing.md },
  permissionRow: { flexDirection: 'row', gap: spacing.md },
  // Each glass card is 4:3 (width:height) and takes half the row (runway-onboarding-handoff 1.7).
  permission: {
    flex: 1,
    aspectRatio: 4 / 3,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: onboardingLook.glassRim,
    backgroundColor: onboardingLook.glass,
    boxShadow: onboardingLook.glassShadow,
    padding: 14,
    gap: 2,
  },
  permissionTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: onboardingLook.ink,
  },
  permissionState: {
    fontFamily: fontFamily.bold,
    fontSize: 12,
    lineHeight: 16,
    color: onboardingLook.label,
  },
  permissionIcon: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  errorBox: { alignItems: 'center', gap: spacing.md },
  footerArea: { gap: spacing.md, marginTop: spacing.xl },
  later: { alignSelf: 'center' },
});
