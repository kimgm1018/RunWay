import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { AppText, Icon, IconButton, useToast } from '../../components';
import {
  useRepositories,
  type MusicService,
  type MusicServiceStatus,
  type MusicSource,
  type MusicState,
} from '../../data';
import { radius, spacing, useTheme } from '../../theme';
import { MusicSheet } from './musicParts';
import { ServiceMark } from './parts';

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
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.row,
        {
          backgroundColor: selected ? colors.surfaceMuted : colors.surface,
          borderColor: selected ? colors.accent : colors.border,
        },
      ]}
    >
      {icon}
      <View style={styles.flex}>
        <AppText variant="bodyStrong">{label}</AppText>
        {detail}
      </View>
      {action}
      {selected ? (
        <Icon name="check" color={colors.accentText} size={18} />
      ) : null}
    </Pressable>
  );
}

// 2.8 음원 선택 and 2.8b 설치·권한 필요. The pick stays for later runs.
export function MusicSourceScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
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
      <View style={styles.header}>
        <IconButton
          icon="back"
          accessibilityLabel="뒤로"
          onPress={navigation.goBack}
        />
        <AppText variant="heading" accessibilityRole="header">
          음원
        </AppText>
      </View>
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
                icon={<ServiceMark service={service} size={32} />}
                detail={
                  <View
                    style={[
                      styles.status,
                      {
                        backgroundColor: connected
                          ? colors.accentSoft
                          : colors.dangerSurface,
                      },
                    ]}
                  >
                    <AppText
                      variant="labelStrong"
                      tone={connected ? 'text' : 'danger'}
                    >
                      {statusLabels[status]}
                    </AppText>
                  </View>
                }
                action={
                  connected ? null : (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${name} ${fixLabels[status]}`}
                      onPress={() => fix(service)}
                      style={[
                        styles.fix,
                        { backgroundColor: colors.surfaceMuted },
                      ]}
                    >
                      <AppText variant="captionStrong">
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
              <View
                style={[styles.none, { backgroundColor: colors.surfaceMuted }]}
              >
                <Icon name="musicOff" color={colors.textSecondary} size={16} />
              </View>
            }
            detail={
              <AppText variant="label" tone="textTertiary">
                러닝 중 플레이어를 숨겨요
              </AppText>
            }
          />
        </View>
      )}
      <AppText variant="label" tone="textTertiary" style={styles.note}>
        고른 음원은 다음 러닝에도 그대로 써요
      </AppText>
    </MusicSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: spacing.xs },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
  loading: { padding: spacing.xxxl },
  list: { paddingHorizontal: spacing.xl, gap: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    padding: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  status: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xxs,
    borderRadius: radius.xs,
  },
  fix: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  none: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: {
    textAlign: 'center',
    marginTop: 'auto',
    paddingVertical: spacing.xl,
  },
});
