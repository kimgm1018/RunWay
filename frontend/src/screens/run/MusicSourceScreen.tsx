import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { AppText, Icon, ScreenHeader, useToast } from '../../components';
import {
  useRepositories,
  type MusicService,
  type MusicServiceStatus,
  type MusicSource,
  type MusicState,
} from '../../data';
import { fontFamily, k1, spacing, ThemeProvider, useTheme } from '../../theme';
import { MusicSheet } from './musicParts';
import { K1Badge, ServiceMark } from './parts';

const statusLabels: Record<MusicServiceStatus, string> = {
  CONNECTED: '연결됨',
  LOGIN_REQUIRED: '로그인 필요',
  PERMISSION_REQUIRED: '권한 필요',
  INSTALL_REQUIRED: '앱 설치 필요',
};

// The button that fixes each unconnected status (2.8 로그인, 2.8b 허용·설치).
const fixLabels: Record<Exclude<MusicServiceStatus, 'CONNECTED'>, string> = {
  LOGIN_REQUIRED: '로그인',
  PERMISSION_REQUIRED: '허용',
  INSTALL_REQUIRED: '설치',
};

const services: { service: MusicService; name: string }[] = [
  { service: 'MELON', name: '멜론' },
  { service: 'SPOTIFY', name: 'Spotify' },
];

function SourceRowContent({
  label,
  selected,
  icon,
  detail,
  action,
}: {
  label: string;
  selected: boolean;
  icon: React.ReactNode;
  detail: React.ReactNode;
  action?: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <>
      {icon}
      <View style={styles.flex}>
        <AppText variant="bodyStrong" style={styles.medium}>
          {label}
        </AppText>
        {detail}
      </View>
      {action}
      {selected ? <Icon name="check" color={colors.text} size={20} /> : null}
    </>
  );
}

// The picked row is a white card; the others are black rows with a faint rim (DESIGN.md 2-6 어두운 줄).
function SourceRow({
  label,
  selected,
  onPress,
  disabled,
  icon,
  detail,
  action,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled: boolean;
  icon: React.ReactNode;
  detail: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.row, selected ? styles.picked : styles.dark]}
    >
      <ThemeProvider tone={selected ? 'light' : 'dark'}>
        <SourceRowContent
          label={label}
          selected={selected}
          icon={icon}
          detail={detail}
          action={action}
        />
      </ThemeProvider>
    </Pressable>
  );
}

// Status chip: grey on the white row, white with coral text when something needs fixing.
function StatusChip({ status }: { status: MusicServiceStatus }) {
  const { colors } = useTheme();
  const connected = status === 'CONNECTED';
  return (
    <View
      style={[
        styles.status,
        connected ? { backgroundColor: colors.surfaceMuted } : styles.statusFix,
      ]}
    >
      <AppText
        variant="label"
        style={connected ? undefined : styles.statusFixText}
      >
        {statusLabels[status]}
      </AppText>
    </View>
  );
}

// 2.8 음원 선택 and 2.8b 설치·권한 필요. The pick stays for later runs.
export function MusicSourceScreen() {
  const navigation = useNavigation();
  const { music } = useRepositories();
  const toast = useToast();
  const [state, setState] = useState<MusicState | null>(null);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      music.getState().then(
        next => active && setState(next),
        () => active && toast('음원 정보를 불러오지 못했어요'),
      );
      return () => {
        active = false;
      };
    }, [music, toast]),
  );
  const choose = async (source: MusicSource) => {
    setState(await music.selectSource(source));
  };
  const fix = async (service: MusicService) => {
    setState(await music.resolveService(service));
  };

  return (
    <MusicSheet stacked>
      <ScreenHeader symbol title="음원" onBack={navigation.goBack} />
      {!state ? (
        <ActivityIndicator style={styles.loading} />
      ) : (
        <View style={styles.list}>
          {services.map(({ service, name }) => {
            const status = state.services[service];
            const connected = status === 'CONNECTED';
            return (
              <SourceRow
                key={service}
                label={name}
                selected={state.source === service}
                disabled={!connected}
                onPress={() => choose(service)}
                icon={
                  <K1Badge diameter={44}>
                    <ServiceMark service={service} size={26} mono />
                  </K1Badge>
                }
                detail={<StatusChip status={status} />}
                action={
                  connected ? null : (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${name} ${fixLabels[status]}`}
                      onPress={() => fix(service)}
                      style={styles.fix}
                    >
                      <AppText variant="captionStrong" style={styles.fixText}>
                        {fixLabels[status]}
                      </AppText>
                    </Pressable>
                  )
                }
              />
            );
          })}
          <SourceRow
            label="음악 없음"
            selected={state.source === 'NONE'}
            disabled={false}
            onPress={() => choose('NONE')}
            icon={
              <K1Badge diameter={44}>
                <Icon name="musicOff" color={k1.ice} size={18} />
              </K1Badge>
            }
            detail={
              <AppText variant="label" tone="textSecondary">
                러닝 중 플레이어를 숨겨요
              </AppText>
            }
          />
        </View>
      )}
      <AppText variant="label" tone="textSecondary" style={styles.note}>
        고른 음원은 다음 러닝에도 그대로 써요
      </AppText>
    </MusicSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: spacing.xs },
  medium: { fontFamily: fontFamily.medium },
  loading: { padding: spacing.xxxl },
  list: {
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    padding: 16,
    borderRadius: 24,
    borderWidth: 1,
  },
  picked: { backgroundColor: '#FFFFFF', borderColor: 'transparent' },
  dark: { backgroundColor: k1.night, borderColor: 'rgba(232,238,244,0.18)' },
  status: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: 2,
    borderRadius: 999,
  },
  statusFix: { backgroundColor: '#FFFFFF' },
  statusFixText: { color: k1.coralText },
  fix: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
  },
  fixText: { color: k1.night },
  // Right under the list, so it stays on the light part of the card.
  note: { textAlign: 'center', paddingVertical: spacing.xl },
});
