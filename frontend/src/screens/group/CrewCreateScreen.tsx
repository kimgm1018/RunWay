import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AppText,
  Backdrop,
  Card,
  Icon,
  IconButton,
  Segmented,
  useToast,
} from '../../components';
import {
  useRepositories,
  type CrewJoinPolicy,
  type MeetingPlace,
} from '../../data';
import { navigateTo } from '../../navigation/navigateTo';
import {
  fontFamily,
  radius,
  spacing,
  ThemeProvider,
  typography,
  useTheme,
} from '../../theme';
import { FooterButton } from './GroupRunDetailScreen';
import { BottomFade, useGroupRunDraft } from './parts';

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

// A titled dark box with a note on the right: 필수, 검색해서 선택, 0 / 200 ….
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
    <Card variant="deep" style={styles.field}>
      <View style={styles.rowBetween}>
        <AppText variant="heading">{title}</AppText>
        {note ? (
          <AppText variant="caption" tone="textSecondary">
            {note}
          </AppText>
        ) : null}
      </View>
      {children}
    </Card>
  );
}

// The see-through box an entry sits in inside a dark field.
function InputBox({
  children,
  tall = false,
}: {
  children: React.ReactNode;
  tall?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.inputBox,
        tall && styles.inputBoxTall,
        { borderColor: colors.border, backgroundColor: colors.surfaceMuted },
      ]}
    >
      {children}
    </View>
  );
}

// 지역: type to search the places and pick one; the picked place shows with a pin.
function AreaPicker({
  area,
  onPick,
}: {
  area: string | null;
  onPick: (area: string | null) => void;
}) {
  const { colors } = useTheme();
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
        accessibilityLabel={`지역 ${area}, 다시 검색`}
        onPress={() => onPick(null)}
      >
        <InputBox>
          <Icon name="mapPin" color={colors.text} size={18} />
          <AppText variant="bodyStrong" style={styles.flex}>
            {area}
          </AppText>
          <Icon name="close" color={colors.textSecondary} size={16} />
        </InputBox>
      </Pressable>
    );
  }
  return (
    <View style={styles.picker}>
      <InputBox>
        <Icon name="search" color={colors.textTertiary} size={18} />
        <TextInput
          accessibilityLabel="지역 검색"
          placeholder="동네나 장소 이름으로 검색"
          placeholderTextColor={colors.textTertiary}
          selectionColor={colors.accent}
          value={query}
          onChangeText={search}
          style={[styles.input, { color: colors.text }]}
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
            onPick(place.name);
          }}
          style={styles.result}
        >
          <Icon name="mapPin" color={colors.textSecondary} size={16} />
          <View style={styles.flex}>
            <AppText variant="bodyStrong">{place.name}</AppText>
            <AppText variant="caption" tone="textSecondary">
              {place.address}
            </AppText>
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
  const { colors } = useTheme();
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
        { backgroundColor: colors.surfaceMuted },
        (pressed || disabled) && styles.dim,
      ]}
    >
      <Icon name={icon} color={colors.text} size={20} />
    </Pressable>
  );
}

// 6.3 크루 만들기: name and area are required; I lead the new crew and land on 6.0 내 크루.
export function CrewCreateScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { crews } = useRepositories();
  const toast = useToast();
  const { changed } = useGroupRunDraft();
  const [name, setName] = useState('');
  const [area, setArea] = useState<string | null>(null);
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
        area,
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
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colors.statusBar} />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop />
      </View>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <IconButton
            icon="back"
            accessibilityLabel="뒤로"
            onPress={() => navigation.goBack()}
          />
          <AppText style={styles.headerTitle} accessibilityRole="header">
            크루 만들기
          </AppText>
        </View>
      </SafeAreaView>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
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
            style={[styles.photo, { borderColor: colors.borderStrong }]}
          >
            <Icon name="camera" color={colors.text} size={22} />
            <AppText variant="body" tone="textSecondary">
              대표 사진 추가
            </AppText>
          </Pressable>
          <Field title="크루 이름" note="필수">
            <InputBox>
              <TextInput
                accessibilityLabel="크루 이름"
                placeholder="예: 광안리 주말 러너스"
                placeholderTextColor={colors.textTertiary}
                selectionColor={colors.accent}
                value={name}
                onChangeText={setName}
                maxLength={30}
                style={[styles.input, { color: colors.text }]}
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
                placeholderTextColor={colors.textTertiary}
                selectionColor={colors.accent}
                value={description}
                onChangeText={setDescription}
                maxLength={descriptionLimit}
                multiline
                textAlignVertical="top"
                style={[styles.input, styles.multiline, { color: colors.text }]}
              />
            </InputBox>
          </Field>
          <Field title="가입 방식" note="만든 뒤 크루 관리에서 바꿀 수 있어요">
            <Segmented
              options={policyOptions}
              value={joinPolicy}
              onChange={setJoinPolicy}
            />
            <AppText variant="caption" tone="textSecondary">
              {policyNotes[joinPolicy]}
            </AppText>
          </Field>
          <Card variant="deep" style={styles.capacityRow}>
            <AppText variant="heading" style={styles.flex}>
              모집 인원
            </AppText>
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
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
      <ThemeProvider tone="dark">
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <BottomFade />
          <FooterButton
            title="크루 만들기"
            primary
            disabled={!ready || busy}
            onPress={create}
          />
        </SafeAreaView>
      </ThemeProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingHorizontal: spacing.screen,
  },
  headerTitle: { fontFamily: fontFamily.medium, fontSize: 19, lineHeight: 26 },
  // Room under the last box for the floating button.
  content: { padding: spacing.screen, paddingBottom: 120, gap: spacing.lg },
  photo: {
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.card,
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  field: { gap: spacing.lg },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.xxl,
    borderRadius: 18,
    borderWidth: 1,
  },
  inputBoxTall: { minHeight: 84, alignItems: 'flex-start' },
  // No lineHeight: on Android it clips the top of a single-line input.
  input: {
    flex: 1,
    height: 50,
    padding: 0,
    fontFamily: typography.input.fontFamily,
    fontSize: typography.input.fontSize,
  },
  multiline: { height: 84, paddingVertical: spacing.xl },
  picker: { gap: spacing.xs },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  capacityRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  step: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dim: { opacity: 0.5 },
  capacity: {
    minWidth: 56,
    textAlign: 'center',
    fontFamily: fontFamily.regular,
    fontSize: 32,
    lineHeight: 40,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.screen,
    paddingBottom: spacing.xl,
  },
});
