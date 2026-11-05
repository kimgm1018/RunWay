import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Icon, useToast } from '../../components';
import {
  useRepositories,
  type CrewJoinPolicy,
  type MeetingPlace,
} from '../../data';
import { navigateTo } from '../../navigation/navigateTo';
import { fontFamily, spacing, ThemeProvider, typography } from '../../theme';
import { DarkSegmented } from './CrewJoinRequestsScreen';
import { DarkBackground, GroupCta, groupLook, SectionLabel } from './look';
import { useGroupRunDraft } from './parts';
import { BackButton } from '../../components/BackButton';
import { KeyboardLift } from '../../components/KeyboardLift';

// M03: 1–200 members; a new crew starts at 20.
const minCapacity = 1;
const maxCapacity = 200;
const defaultCapacity = 20;
const descriptionLimit = 200;

const policyOptions: { value: CrewJoinPolicy; label: string }[] = [
  { value: 'APPROVAL', label: '승인제 · 기본' },
  { value: 'INSTANT', label: '바로 가입' },
];

const policyNotes: Record<CrewJoinPolicy, string> = {
  APPROVAL: '승인제는 크루장이 신청을 확인한 뒤 멤버가 돼요.',
  INSTANT: '바로 가입은 신청하면 바로 멤버가 돼요.',
};

// A section with a line label and a note on the right: 필수, 검색해서 선택, 0 / 200 … (no card).
function Field({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.rowBetween}>
        <SectionLabel>{title}</SectionLabel>
        {note ? (
          <AppText style={styles.note} numberOfLines={1}>
            {note}
          </AppText>
        ) : null}
      </View>
      {children}
    </View>
  );
}

// The dark glass pill an entry sits in (--input-dark-*, as a plain fill).
function InputBox({
  children,
  tall = false,
}: {
  children: React.ReactNode;
  tall?: boolean;
}) {
  return (
    <View style={[styles.inputBox, tall && styles.inputBoxTall]}>
      {children}
    </View>
  );
}

// 지역: type to search the places and pick one; the picked place shows with a pin.
function AreaPicker({
  area,
  onPick,
}: {
  area: MeetingPlace | null;
  onPick: (area: MeetingPlace | null) => void;
}) {
  const { groupRuns } = useRepositories();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MeetingPlace[]>([]);
  const search = async (text: string) => {
    setQuery(text);
    if (!text.trim()) {
      setResults([]);
      return;
    }
    try {
      setResults((await groupRuns.searchPlaces(text)).slice(0, 4));
    } catch {
      setResults([]);
    }
  };
  if (area) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`지역 ${area.name}, 다시 검색`}
        onPress={() => onPick(null)}
      >
        <InputBox>
          <Icon name="mapPin" color={groupLook.onDark} size={18} />
          <AppText style={[styles.picked, styles.flex]}>{area.name}</AppText>
          <Icon name="close" color={groupLook.onDarkSub} size={16} />
        </InputBox>
      </Pressable>
    );
  }
  return (
    <View style={styles.picker}>
      <InputBox>
        <Icon name="search" color={groupLook.onDarkSub} size={16} />
        <TextInput
          accessibilityLabel="지역 검색"
          placeholder="동네나 장소 이름으로 검색"
          placeholderTextColor={groupLook.onDarkMuted}
          selectionColor={groupLook.onDark}
          value={query}
          onChangeText={search}
          style={styles.input}
        />
      </InputBox>
      {results.map(place => (
        <Pressable
          key={place.name}
          accessibilityRole="button"
          accessibilityLabel={place.name}
          onPress={() => {
            setQuery('');
            setResults([]);
            onPick(place);
          }}
          style={styles.result}
        >
          <Icon name="mapPin" color={groupLook.onDarkSub} size={16} />
          <View style={styles.flex}>
            <AppText style={styles.picked}>{place.name}</AppText>
            <AppText style={styles.sub}>{place.address}</AppText>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

function StepButton({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: 'minus' | 'plus';
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.step,
        disabled && styles.dim,
        pressed && styles.pressed,
      ]}
    >
      <Icon name={icon} color={groupLook.onDark} size={20} />
    </Pressable>
  );
}

// 6.3 크루 만들기: name and area are required; I lead the new crew and land on 6.0 내 크루.
export function CrewCreateScreen() {
  const navigation = useNavigation();
  const { crews } = useRepositories();
  const toast = useToast();
  const { changed } = useGroupRunDraft();
  const [name, setName] = useState('');
  const [area, setArea] = useState<MeetingPlace | null>(null);
  const [description, setDescription] = useState('');
  const [joinPolicy, setJoinPolicy] = useState<CrewJoinPolicy>('APPROVAL');
  const [capacity, setCapacity] = useState(defaultCapacity);
  const [busy, setBusy] = useState(false);
  const ready = name.trim().length > 0 && area !== null;

  const create = async () => {
    if (!ready || !area) {
      return;
    }
    setBusy(true);
    try {
      await crews.create({
        name: name.trim(),
        area: area.name,
        address: area.address,
        description: description.trim() || null,
        joinPolicy,
        capacity,
      });
      // 6.0 lists the new crew from now on.
      changed();
      toast('크루를 만들었어요');
      navigateTo(navigation, 'MyCrews');
    } catch {
      toast('크루를 만들지 못했어요. 잠시 후 다시 시도해 주세요');
      setBusy(false);
    }
  };

  return (
    // 6.0~6.3 sit on --bg-analysis-dark, so the whole screen takes the dark theme.
    <ThemeProvider tone="dark">
      <View style={[styles.root, { backgroundColor: groupLook.navy }]}>
        <StatusBar barStyle="light-content" />
        <DarkBackground id="crewCreateBackground" />
        <SafeAreaView edges={['top']}>
          <View style={styles.header}>
            <BackButton tone="dark" onPress={() => navigation.goBack()} />
            <AppText style={styles.headerTitle} accessibilityRole="header">
              크루 만들기
            </AppText>
          </View>
        </SafeAreaView>
        <KeyboardLift style={styles.flex}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}
          >
            {/* No photo upload yet (M03 imageId is not stored), so the box only says so. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="대표 사진 추가"
              onPress={() =>
                toast('대표 사진은 사진 업로드가 준비되면 추가할 수 있어요')
              }
              style={({ pressed }) => [
                styles.photo,
                pressed && styles.rowPressed,
              ]}
            >
              <Icon name="camera" color={groupLook.onDark} size={20} />
              <AppText style={styles.photoText}>대표 사진 추가</AppText>
            </Pressable>
            <Field title="크루 이름" note="필수">
              <InputBox>
                <TextInput
                  accessibilityLabel="크루 이름"
                  placeholder="예: 광안리 주말 러너스"
                  placeholderTextColor={groupLook.onDarkMuted}
                  selectionColor={groupLook.onDark}
                  value={name}
                  onChangeText={setName}
                  maxLength={30}
                  style={styles.input}
                />
              </InputBox>
            </Field>
            <Field title="지역" note="검색해서 선택">
              <AreaPicker area={area} onPick={setArea} />
            </Field>
            <Field
              title="소개"
              note={`${description.length} / ${descriptionLimit}`}
            >
              <InputBox tall>
                <TextInput
                  accessibilityLabel="소개"
                  placeholder="언제, 어디서, 어떤 페이스로 달리는지 적어 주세요"
                  placeholderTextColor={groupLook.onDarkMuted}
                  selectionColor={groupLook.onDark}
                  value={description}
                  onChangeText={setDescription}
                  maxLength={descriptionLimit}
                  multiline
                  textAlignVertical="top"
                  style={[styles.input, styles.multiline]}
                />
              </InputBox>
            </Field>
            <Field
              title="가입 방식"
              note="만든 뒤 크루 관리에서 바꿀 수 있어요"
            >
              <DarkSegmented
                options={policyOptions}
                value={joinPolicy}
                onChange={setJoinPolicy}
              />
              <AppText style={styles.sub}>{policyNotes[joinPolicy]}</AppText>
            </Field>
            <View style={styles.capacityRow}>
              <View style={styles.flex}>
                <SectionLabel style={styles.capacityLabel}>
                  모집 인원
                </SectionLabel>
              </View>
              <StepButton
                icon="minus"
                label="모집 인원 줄이기"
                disabled={capacity <= minCapacity}
                onPress={() => setCapacity(value => value - 1)}
              />
              <AppText
                style={styles.capacity}
                accessibilityLabel={`모집 인원 ${capacity}명`}
              >
                {capacity}
              </AppText>
              <StepButton
                icon="plus"
                label="모집 인원 늘리기"
                disabled={capacity >= maxCapacity}
                onPress={() => setCapacity(value => value + 1)}
              />
            </View>
          </ScrollView>
        </KeyboardLift>
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <GroupCta
            title="크루 만들기"
            icon="plus"
            disabled={!ready || busy}
            onPress={create}
          />
        </SafeAreaView>
      </View>
    </ThemeProvider>
  );
}

// --input-dark-*: the gradient's middle as a plain fill (an Svg stop loses rgba alpha on Android).
const inputDark = {
  backgroundColor: 'rgba(255,255,255,0.105)',
  boxShadow:
    'inset 0 1px 0 rgba(255,255,255,0.24), inset 0 -1px 0 rgba(0,0,0,0.28), 0 10px 26px rgba(0,0,0,0.35)',
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: 16,
  },
  headerTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 19,
    lineHeight: 26,
    letterSpacing: -0.4,
    color: groupLook.onDark,
  },
  // Room under the last section for the floating button.
  content: { paddingHorizontal: 16, paddingBottom: 120, gap: spacing.xl },
  // 6.3-PhotoUpload: a dark glass box, 96 high.
  photo: {
    height: 96,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: 24,
    ...inputDark,
  },
  photoText: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 17,
    color: groupLook.onDarkSub,
  },
  rowPressed: { transform: [{ scale: 0.985 }] },
  field: { gap: spacing.md },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  note: {
    flexShrink: 1,
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 16,
    color: groupLook.onDarkMuted,
  },
  sub: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: groupLook.onDarkSub,
  },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 18,
    borderRadius: 24,
    ...inputDark,
  },
  inputBoxTall: { minHeight: 88, borderRadius: 20, alignItems: 'flex-start' },
  // No lineHeight: on Android it clips the top of a single-line input.
  input: {
    flex: 1,
    height: 48,
    padding: 0,
    fontFamily: typography.input.fontFamily,
    fontSize: 15,
    color: groupLook.onDark,
  },
  multiline: { height: 88, paddingVertical: spacing.lg },
  picked: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: groupLook.onDark,
  },
  picker: { gap: spacing.xs },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  // 모집 인원: the line label, then −  20  + in dark glass circles.
  capacityRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  capacityLabel: { alignSelf: 'flex-start' },
  step: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.11)',
    boxShadow:
      'inset 0 1px 0 rgba(255,255,255,0.24), inset 0 -1px 0 rgba(0,0,0,0.28), 0 6px 16px rgba(0,0,0,0.3)',
  },
  dim: { opacity: 0.4 },
  pressed: { transform: [{ scale: 0.97 }] },
  capacity: {
    minWidth: 56,
    textAlign: 'center',
    fontFamily: fontFamily.numberRegular,
    fontSize: 34,
    lineHeight: 42,
    color: groupLook.onDark,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingBottom: spacing.xl,
  },
});
