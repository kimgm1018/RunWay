import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import {
  AppText,
  EmptyState,
  Icon,
  useToast,
  type IconName,
} from '../../components';
import {
  DataError,
  useRepositories,
  useResource,
  type Repositories,
} from '../../data';
import { recordsChanged } from '../../data/recordsChanged';
import { navigateTo } from '../../navigation/navigateTo';
import type { RootStackParamList } from '../../navigation/types';
import { fontFamily, spacing } from '../../theme';
import {
  glassCard,
  recordsLook,
  RecordsBackdrop,
  RoundGlassButton,
  ScreenTitle,
} from './look';
import { RecordView } from './RecordView';

const danger = '#D44A4A';

// S09 failures stay on 5.2 with a toast (sessions.md S09 오류 응답).
function deleteFailure(error: unknown) {
  const code = error instanceof DataError ? error.code : null;
  const status = error instanceof DataError ? error.status : null;
  if (status === 403) {
    return '내 기록만 삭제할 수 있어요';
  }
  if (code === 'SESSION_NOT_FOUND' || status === 404) {
    return '이미 삭제된 기록이에요';
  }
  if (code === 'INVALID_STATE' || status === 409) {
    return '기록을 정리하는 중이라 지금은 삭제할 수 없어요. 잠시 후 다시 시도해 주세요';
  }
  return '기록을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요';
}

// 5.2 기록 메뉴 and its 삭제 확인 (S15P31E105-394) as the records glass cards (담당자 결정): ⋮ opens a small glass
// card under it, 기록 삭제 opens a glass card in the middle of the dimmed screen, with S09's own wording.
function RecordMenu({
  visible,
  top,
  onClose,
  onDelete,
}: {
  visible: boolean;
  // Where the menu card sits: just under the ⋮ button.
  top: number;
  onClose: () => void;
  onDelete: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const close = () => {
    setConfirming(false);
    onClose();
  };
  const remove = async () => {
    setBusy(true);
    try {
      await onDelete();
    } finally {
      setBusy(false);
      close();
    }
  };
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={close}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="닫기"
        onPress={close}
        style={[styles.scrim, confirming && styles.scrimDim]}
      />
      {confirming ? (
        <View style={styles.center} pointerEvents="box-none">
          <View accessibilityViewIsModal style={[glassCard, styles.confirm]}>
            <View style={styles.confirmIcon}>
              <Icon name="trash" color={danger} size={22} strokeWidth={2} />
            </View>
            <AppText accessibilityRole="header" style={styles.confirmTitle}>
              이 운동 기록을 삭제할까요?
            </AppText>
            <AppText style={styles.confirmNote}>
              이 기록을 공유한 게시물도 함께 삭제됩니다.
            </AppText>
            <View style={styles.confirmButtons}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="취소"
                onPress={close}
                style={({ pressed }) => [
                  styles.confirmButton,
                  styles.cancel,
                  pressed && styles.dim,
                ]}
              >
                <AppText style={styles.cancelText}>취소</AppText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="삭제"
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                onPress={remove}
                style={({ pressed }) => [
                  styles.confirmButton,
                  styles.delete,
                  (pressed || busy) && styles.dim,
                ]}
              >
                <AppText style={styles.deleteText}>삭제</AppText>
              </Pressable>
            </View>
          </View>
        </View>
      ) : (
        <View style={[glassCard, styles.menu, { top }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="기록 삭제"
            onPress={() => setConfirming(true)}
            style={({ pressed }) => [styles.menuRow, pressed && styles.dim]}
          >
            <Icon name="trash" color={danger} size={18} strokeWidth={2} />
            <AppText style={styles.menuText}>기록 삭제</AppText>
          </Pressable>
        </View>
      )}
    </Modal>
  );
}

// The two 58-high buttons at the foot: glass 내 코스에 저장, navy 기록 공유.
function ActionButton({
  title,
  icon,
  onPress,
  primary = false,
  selected = false,
  disabled = false,
}: {
  title: string;
  icon: IconName;
  onPress: () => void;
  primary?: boolean;
  selected?: boolean;
  disabled?: boolean;
}) {
  const color = primary ? '#FFFFFF' : recordsLook.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        primary ? styles.actionPrimary : glassCard,
        (pressed || disabled) && styles.dim,
      ]}
    >
      <Icon
        name={selected ? 'check' : icon}
        color={color}
        size={18}
        strokeWidth={1.9}
      />
      <AppText style={[styles.actionText, { color }]}>{title}</AppText>
    </Pressable>
  );
}

// 5.2 기록 상세 (runway-records): one run's figures and split graph on the mist, with 내 코스에 저장 and 기록
// 공유 at the foot. The ⋮ menu keeps 기록 삭제 (담당자 결정).
export function RecordDetailScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'RecordDetail'>>();
  const recordId = route.params?.recordId;
  const { courses, records } = useRepositories();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const [menu, setMenu] = useState(false);
  const detail = useResource(
    useCallback(
      async (repositories: Repositories) => {
        // Opened without a run (an old link): show the newest one.
        const id =
          recordId ??
          (await repositories.records.getRecent('recent', 1))[0]?.id;
        return repositories.records.getDetail(id);
      },
      [recordId],
    ),
  );
  const [myCourseId, setMyCourseId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const record = detail.status === 'ready' ? detail.data : null;
  useEffect(() => {
    setMyCourseId(record?.myCourseId ?? null);
  }, [record]);

  const close = () =>
    navigation.canGoBack()
      ? navigation.goBack()
      : navigateTo(navigation, 'Records');

  // On success 5.1 and 2.1 read again without this run, and 5.2 closes.
  const deleteRecord = async () => {
    if (!record) {
      return;
    }
    try {
      await records.remove(record.id);
      recordsChanged();
      toast('기록을 삭제했어요');
      close();
    } catch (error) {
      toast(deleteFailure(error));
    }
  };

  const toggleSaved = async () => {
    if (!record) {
      return;
    }
    setBusy(true);
    try {
      if (myCourseId) {
        await courses.unsave(myCourseId);
        setMyCourseId(null);
        toast('내 코스에서 뺐어요');
      } else {
        const saved = record.courseId
          ? (await courses.save(record.courseId), record.courseId)
          : (
              await courses.saveFromRun({
                recordId: record.id,
                route: record.route ?? [],
                distanceM: record.distanceM,
                durationSec: record.durationSec,
              })
            ).courseId;
        setMyCourseId(saved);
        toast('내 코스에 저장했어요');
      }
    } catch {
      toast('내 코스를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <RecordsBackdrop />
      <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
        <View style={styles.head}>
          <ScreenTitle
            title="기록 상세"
            onBack={close}
            right={
              record ? (
                <RoundGlassButton
                  icon="moreVertical"
                  label="기록 메뉴"
                  onPress={() => setMenu(true)}
                />
              ) : undefined
            }
          />
        </View>
        {!record ? (
          detail.status === 'error' ? (
            <EmptyState
              icon="alert"
              title="기록을 불러오지 못했어요"
              actionLabel="다시 시도"
              onAction={detail.reload}
            />
          ) : (
            <ActivityIndicator style={styles.loading} />
          )
        ) : (
          <>
            <ScrollView
              style={styles.flex}
              contentContainerStyle={styles.scroll}
              showsVerticalScrollIndicator={false}
            >
              <RecordView record={record} chartHeight={400} />
            </ScrollView>
            <View style={styles.actions}>
              <ActionButton
                title={myCourseId ? '내 코스에 저장됨' : '내 코스에 저장'}
                icon="bookmark"
                selected={myCourseId !== null}
                // A run without location has no path to save as a course.
                disabled={busy || (!record.route && !myCourseId)}
                onPress={toggleSaved}
              />
              <ActionButton
                primary
                title="기록 공유"
                icon="share"
                onPress={() =>
                  navigation.navigate('PostWrite', { recordId: record.id })
                }
              />
            </View>
          </>
        )}
      </SafeAreaView>
      <RecordMenu
        visible={menu}
        // The title row is 52 high from 10 under the safe area; the card starts just under the ⋮ button.
        top={insets.top + 10 + 52}
        onClose={() => setMenu(false)}
        onDelete={deleteRecord}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#D7E1E7' },
  flex: { flex: 1 },
  head: { paddingHorizontal: recordsLook.side, paddingTop: 10 },
  loading: { marginTop: spacing.xxxl },
  scroll: {
    paddingHorizontal: recordsLook.side,
    paddingTop: 12,
    paddingBottom: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: recordsLook.side,
    paddingTop: 4,
    paddingBottom: 18,
  },
  action: {
    flex: 1,
    height: 58,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  actionPrimary: { backgroundColor: '#02050D' },
  actionText: {
    fontFamily: fontFamily.bold,
    fontSize: 15.5,
    lineHeight: 20,
    letterSpacing: -0.3,
  },
  dim: { opacity: 0.55 },
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  scrimDim: { backgroundColor: 'rgba(9,17,26,0.32)' },
  // ⋮ 메뉴: a small glass card under the button.
  menu: {
    position: 'absolute',
    right: recordsLook.side,
    minWidth: 160,
    borderRadius: 18,
    padding: 6,
    // Solid, so the tabs under it do not show through.
    backgroundColor: '#F6F8FA',
  },
  menuRow: {
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  menuText: {
    fontFamily: fontFamily.bold,
    fontSize: 14.5,
    lineHeight: 20,
    letterSpacing: -0.3,
    color: danger,
  },
  // 삭제 확인: a glass card in the middle of the dimmed screen.
  center: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'center',
    paddingHorizontal: recordsLook.side,
  },
  confirm: {
    borderRadius: 26,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 18,
    alignItems: 'center',
    backgroundColor: '#F6F8FA',
  },
  confirmIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(212,74,74,0.12)',
  },
  confirmTitle: {
    marginTop: 14,
    textAlign: 'center',
    fontFamily: fontFamily.bold,
    fontSize: 18,
    lineHeight: 25,
    letterSpacing: -0.4,
    color: recordsLook.ink,
  },
  confirmNote: {
    marginTop: 6,
    textAlign: 'center',
    fontFamily: fontFamily.regular,
    fontSize: 13.5,
    lineHeight: 20,
    letterSpacing: -0.3,
    color: recordsLook.sub,
  },
  confirmButtons: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: 8,
    marginTop: 22,
  },
  confirmButton: {
    flex: 1,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancel: {
    borderWidth: 1,
    borderColor: recordsLook.glassRim,
    backgroundColor: 'rgba(2,5,14,0.06)',
  },
  cancelText: {
    fontFamily: fontFamily.bold,
    fontSize: 15.5,
    lineHeight: 20,
    color: recordsLook.ink,
  },
  delete: { backgroundColor: danger },
  deleteText: {
    fontFamily: fontFamily.bold,
    fontSize: 15.5,
    lineHeight: 20,
    color: '#FFFFFF',
  },
});
