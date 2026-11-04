import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { AppText, Icon, useToast, type IconName } from '../../components';
import {
  spotifyFailureMessage,
  useRepositories,
  type MusicService,
  type MusicServiceStatus,
  type MusicSource,
  type MusicState,
} from '../../data';
import { fontFamily } from '../../theme';
import { MusicOverlay } from './musicParts';

// The button that fixes each unconnected service (2.8 로그인, 2.8b 허용·설치).
const fixLabels: Record<Exclude<MusicServiceStatus, 'CONNECTED'>, string> = {
  LOGIN_REQUIRED: '로그인',
  PERMISSION_REQUIRED: '허용',
  INSTALL_REQUIRED: '설치',
};

const rows: { source: MusicSource; name: string; icon: IconName }[] = [
  { source: 'MELON', name: '멜론', icon: 'music' },
  { source: 'SPOTIFY', name: 'Spotify', icon: 'music' },
  // 음악 없음 hides the player during the run.
  { source: 'NONE', name: '음악 없음', icon: 'musicOff' },
];

const ink = '#1B1E22';

// The 2.8 핸드오프 glass: white fading to blue grey at 160°, behind a white rim.
// It takes the measured size: an Svg sized in percent falls back to 300×150 on Android.
function Glass({ width, height }: { width: number; height: number }) {
  return (
    <Svg style={StyleSheet.absoluteFill} width={width} height={height}>
      <Defs>
        <LinearGradient
          id="sourceGlass"
          x1="0.33"
          y1="0.03"
          x2="0.67"
          y2="0.97"
        >
          <Stop offset={0} stopColor="#F0F4F8" stopOpacity={0.72} />
          <Stop offset={0.55} stopColor="#D6E0E9" stopOpacity={0.5} />
          <Stop offset={1} stopColor="#C4D0DC" stopOpacity={0.42} />
        </LinearGradient>
      </Defs>
      <Rect width={width} height={height} fill="url(#sourceGlass)" />
    </Svg>
  );
}

function Toggle({ on }: { on: boolean }) {
  return (
    <View style={[styles.track, on && styles.trackOn]}>
      <View style={[styles.knob, on && styles.knobOn]} />
    </View>
  );
}

// The ✓ under the card: 설정 완료 saves the pick and goes back to 2.7 (runway-music-handoff).
function ConfirmButton({
  busy,
  onPress,
}: {
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="설정 완료"
      accessibilityState={{ busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [styles.confirm, pressed && styles.pressed]}
    >
      <Icon name="check" color="#FFFFFF" size={22} strokeWidth={2.6} />
    </Pressable>
  );
}

// 2.8 음원 선택 and 2.8b 설치·권한 필요, as a small card in the middle. One pick at a time; pressing the
// picked row again clears it (back to 2.7a 미연결). The pick is saved only by ✓; tapping outside or going
// back leaves the source as it was.
export function MusicSourceScreen() {
  const { music } = useRepositories();
  const toast = useToast();
  const navigation = useNavigation();
  const [state, setState] = useState<MusicState | null>(null);
  // The row turned on here, not saved yet; undefined until the state first loads.
  const [picked, setPicked] = useState<MusicSource | null | undefined>(
    undefined,
  );
  const [saving, setSaving] = useState(false);
  const [box, setBox] = useState<{ width: number; height: number } | null>(
    null,
  );
  const measure = (event: LayoutChangeEvent) =>
    setBox(event.nativeEvent.layout);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      music.getState().then(
        next => {
          if (active) {
            setState(next);
            setPicked(current =>
              current === undefined ? next.source : current,
            );
          }
        },
        () => active && toast('음원 정보를 불러오지 못했어요'),
      );
      return () => {
        active = false;
      };
    }, [music, toast]),
  );
  const say = (message: string | null) => message && toast(message);
  const choose = (source: MusicSource) =>
    setPicked(current => (current === source ? null : source));
  const confirm = async () => {
    if (!state || picked === undefined) {
      return;
    }
    setSaving(true);
    try {
      if (picked !== state.source) {
        await music.selectSource(picked);
      }
      navigation.goBack();
    } catch (error) {
      say(spotifyFailureMessage(error, '음원을 바꾸지 못했어요'));
      setSaving(false);
    }
  };
  // Spotify 로그인 opens Spotify's sign-in page and comes back here.
  const fix = async (service: MusicService) => {
    try {
      setState(await music.resolveService(service));
    } catch (error) {
      say(spotifyFailureMessage(error, '연결하지 못했어요'));
    }
  };

  return (
    <MusicOverlay dark={false}>
      <View style={styles.card} onLayout={measure}>
        {box ? <Glass {...box} /> : null}
        <View style={styles.head}>
          <AppText accessibilityRole="header" style={styles.heading}>
            음원
          </AppText>
        </View>
        {!state ? (
          <ActivityIndicator style={styles.loading} color={ink} />
        ) : (
          <View accessibilityRole="radiogroup" style={styles.list}>
            {rows.map(row => {
              const status =
                row.source === 'NONE'
                  ? 'CONNECTED'
                  : state.services[row.source];
              const ready = status === 'CONNECTED';
              const on = picked === row.source;
              return (
                <Pressable
                  key={row.source}
                  accessibilityRole="radio"
                  accessibilityLabel={row.name}
                  accessibilityState={{ checked: on, disabled: !ready }}
                  disabled={!ready}
                  onPress={() => choose(row.source)}
                  style={styles.row}
                >
                  <View style={[styles.icon, on && styles.iconOn]}>
                    <Icon
                      name={row.icon}
                      color={on ? '#FFFFFF' : ink}
                      size={19}
                      strokeWidth={1.9}
                    />
                  </View>
                  <AppText style={styles.name}>{row.name}</AppText>
                  {ready ? (
                    <Toggle on={on} />
                  ) : (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${row.name} ${
                        fixLabels[status as keyof typeof fixLabels]
                      }`}
                      onPress={() => fix(row.source as MusicService)}
                      style={styles.fix}
                    >
                      <AppText style={styles.fixText}>
                        {fixLabels[status as keyof typeof fixLabels]}
                      </AppText>
                    </Pressable>
                  )}
                </Pressable>
              );
            })}
          </View>
        )}
      </View>
      {state ? <ConfirmButton busy={saving} onPress={confirm} /> : null}
    </MusicOverlay>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 20,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
    overflow: 'hidden',
    boxShadow: '0 12px 40px rgba(30,45,60,0.12)',
  },
  head: { height: 36, justifyContent: 'center' },
  heading: {
    fontFamily: fontFamily.bold,
    fontSize: 22,
    lineHeight: 26,
    letterSpacing: -0.5,
    color: '#02050E',
  },
  loading: { marginVertical: 60 },
  list: { gap: 14, marginTop: 18 },
  row: {
    height: 48,
    paddingHorizontal: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.75)',
  },
  iconOn: { backgroundColor: ink },
  name: {
    flex: 1,
    fontFamily: fontFamily.bold,
    fontSize: 17,
    lineHeight: 21,
    letterSpacing: -0.4,
    color: '#02050E',
  },
  track: {
    width: 58,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(27,30,34,0.2)',
  },
  trackOn: { backgroundColor: ink },
  knob: {
    position: 'absolute',
    top: 3,
    left: 3,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
  },
  knobOn: { left: 27 },
  fix: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
  },
  fixText: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 17,
    color: '#02050E',
  },
  confirm: {
    alignSelf: 'center',
    marginTop: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#02050E',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 10px 24px rgba(2,5,14,0.22)',
  },
  pressed: {
    transform: [{ scale: 0.94 }],
    boxShadow: '0 4px 12px rgba(2,5,14,0.22)',
  },
});
