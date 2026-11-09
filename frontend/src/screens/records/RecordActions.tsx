import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Icon, useToast, type IconName } from '../../components';
import { DataError, useRepositories, type RunRecordDetail } from '../../data';
import { recordsChanged } from '../../data/recordsChanged';
import { fontFamily } from '../../theme';
import { glassCard, recordsLook } from './look';

// 내 코스에 저장 · 기록 공유 · 기록 삭제 under the run on 2.1 기록 상세 (S15P31E105-564, 담당자 결정: 5.2 화면을
// 없애고 기능은 홈으로). The delete asks first in a card in the middle of the dimmed screen, with S09's own
// wording (S15P31E105-394).

const danger = '#D44A4A';

// S09 failures keep the run on screen with a toast (sessions.md S09 오류 응답).
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

// 삭제 확인: S09's wording on a glass card over the dimmed screen.
function DeleteConfirm({
  visible,
  onClose,
  onDelete,
}: {
  visible: boolean;
  onClose: () => void;
  onDelete: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    try {
      await onDelete();
    } finally {
      setBusy(false);
      onClose();
    }
  };
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="닫기"
        onPress={onClose}
        style={[styles.scrim, styles.scrimDim]}
      />
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
              onPress={onClose}
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
    </Modal>
  );
}

// The two buttons under the run: glass 내 코스에 저장, navy 기록 공유.
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

export function RecordActions({ record }: { record: RunRecordDetail }) {
  const navigation = useNavigation();
  const { courses, records } = useRepositories();
  const toast = useToast();
  const [myCourseId, setMyCourseId] = useState<string | null>(
    record.myCourseId ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    setMyCourseId(record.myCourseId ?? null);
  }, [record]);

  const toggleSaved = async () => {
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

  // On success the day reads its runs again without this one.
  const deleteRecord = async () => {
    try {
      await records.remove(record.id);
      recordsChanged();
      toast('기록을 삭제했어요');
    } catch (error) {
      toast(deleteFailure(error));
    }
  };

  return (
    <View>
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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="기록 삭제"
        hitSlop={6}
        onPress={() => setConfirming(true)}
        style={({ pressed }) => [styles.remove, pressed && styles.dim]}
      >
        <Icon
          name="trash"
          color={recordsLook.onCardSub}
          size={14}
          strokeWidth={2}
        />
        <AppText style={styles.removeText}>기록 삭제</AppText>
      </Pressable>
      <DeleteConfirm
        visible={confirming}
        onClose={() => setConfirming(false)}
        onDelete={deleteRecord}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Where the tab bar sits on 5.1 and 5.3, as high as it (담당자 결정).
  actions: { marginTop: 24, flexDirection: 'row', gap: 8 },
  action: {
    flex: 1,
    height: 52,
    borderRadius: 20,
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
  remove: {
    alignSelf: 'center',
    marginTop: 14,
    paddingVertical: 6,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  removeText: {
    fontFamily: fontFamily.medium,
    fontSize: 13.5,
    lineHeight: 18,
    color: recordsLook.onCardSub,
  },
});
