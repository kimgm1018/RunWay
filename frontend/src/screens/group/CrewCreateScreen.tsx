import React, { useEffect, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Icon, PressableScale, useToast } from '../../components';
import {
  errorCode,
  useRepositories,
  type CrewJoinPolicy,
  type MeetingPlace,
  type PhotoFile,
} from '../../data';
import { navigateTo } from '../../navigation/navigateTo';
import { fontFamily, spacing, ThemeProvider, typography } from '../../theme';
import { PolicySegmented } from './CrewJoinRequestsScreen';
import { GroupCta, groupTone, NightBackground, NumText } from './look';
import { BottomFade, useGroupRunDraft } from './parts';
import { BackButton } from '../../components/BackButton';
import { KeyboardLift } from '../../components/KeyboardLift';
import { photoFailure, pickPhoto } from '../photoPicker';

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

// A section on the navy page as in the S15P31E105-594 담당자 시안: a plain white label 8 over its field, one after
// another without bands; the note on the right (필수, 검색해서 선택 …) stays from before.
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
    <View style={styles.section}>
      <View style={styles.rowBetween}>
        <AppText style={styles.label} accessibilityRole="header">
          {title}
        </AppText>
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

// The field an entry sits in: a faint white panel on the navy page (S15P31E105-594 담당자 시안).
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

// 지역: type to search the places and pick one; the picked place shows in a field with the mockup's ⌄.
// While searching, the field and its results sit together in one panel, as in the mockup's 지역 검색 상태.
export function AreaPicker({
  area,
  onPick,
}: {
  area: MeetingPlace | null;
  onPick: (area: MeetingPlace | null) => void;
}) {
  const { groupRuns } = useRepositories();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MeetingPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setResults([]);
    setFailed(false);
    setSearching(Boolean(query.trim()) && !area);
    if (!query.trim() || area) return;
    const timer = setTimeout(() => {
      groupRuns.searchPlaces(query).then(
        found => {
          if (!active) return;
          setResults(found.slice(0, 4));
          setSearching(false);
        },
        () => {
          if (!active) return;
          setFailed(true);
          setSearching(false);
        },
      );
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [groupRuns, query, area, attempt]);
  if (area) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`지역 ${area.name}, 다시 검색`}
        onPress={() => onPick(null)}
      >
        <InputBox>
          <AppText style={[styles.picked, styles.flex]}>{area.name}</AppText>
          <Icon name="chevronDown" color={groupTone.sub} size={18} />
        </InputBox>
      </Pressable>
    );
  }
  const open = Boolean(query.trim());
  return (
    <View style={[styles.picker, open && styles.pickerOpen]}>
      <View style={[styles.inputBox, open && styles.searchBox]}>
        <Icon name="search" color={groupTone.sub} size={16} />
        <TextInput
          accessibilityLabel="지역 검색"
          placeholder="동네나 장소 이름으로 검색"
          placeholderTextColor={groupTone.muted}
          selectionColor={groupTone.accent}
          value={query}
          onChangeText={text => {
            setQuery(text);
            setResults([]);
            setFailed(false);
            setSearching(Boolean(text.trim()));
          }}
          style={styles.input}
        />
      </View>
      {searching ? (
        <AppText style={styles.pickerNote}>검색 중이에요</AppText>
      ) : null}
      {failed ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="지역 검색 다시 시도"
          onPress={() => setAttempt(value => value + 1)}
        >
          <AppText style={styles.pickerNote}>
            검색하지 못했어요. 눌러서 다시 시도해 주세요
          </AppText>
        </Pressable>
      ) : !searching && query.trim() && results.length === 0 ? (
        <AppText style={styles.pickerNote}>찾는 장소가 없어요</AppText>
      ) : null}
      {results.map((place, index) => (
        <Pressable
          key={`${place.name}:${place.address}:${place.position.join(',')}`}
          accessibilityRole="button"
          accessibilityLabel={place.name}
          onPress={() => {
            setQuery('');
            setResults([]);
            onPick(place);
          }}
          style={[styles.result, index > 0 && styles.resultLine]}
        >
          <Icon name="mapPin" color={groupTone.sub} size={18} />
          <View style={styles.flex}>
            <AppText style={styles.picked}>{place.name}</AppText>
            <NumText text={place.address} style={styles.cardSub} />
          </View>
        </Pressable>
      ))}
    </View>
  );
}

// − and + inside the 모집 인원 field: plain white marks, 44 to tap (S15P31E105-594 담당자 시안).
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
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={[styles.step, disabled && styles.dim]}
    >
      <Icon name={icon} color={groupTone.text} size={20} />
    </PressableScale>
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
  // 대표 사진 (F01 CREW → M03 imageKey): optional, sent with 크루 만들기.
  const [photo, setPhoto] = useState<PhotoFile | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = name.trim().length > 0 && area !== null;

  const choosePhoto = async () => {
    const picked = await pickPhoto('crew');
    if (picked.kind === 'refused') {
      toast(picked.message);
    } else if (picked.kind === 'picked') {
      setPhoto(picked.photo);
    }
  };

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
        photo,
      });
      // 6.0 lists the new crew from now on.
      changed();
      toast('크루를 만들었어요');
      navigateTo(navigation, 'MyCrews');
    } catch (error) {
      // What was typed stays; a photo problem says to pick another one.
      toast(
        photoFailure(error) ??
          (errorCode(error) === 'RESOURCE_NOT_OWNED'
            ? '이 사진은 쓸 수 없어요. 사진을 다시 골라 주세요'
            : '크루를 만들지 못했어요. 잠시 후 다시 시도해 주세요'),
      );
      setBusy(false);
    }
  };

  return (
    // The home's navy page with faint white panels (담당자 결정: 진한 네이비), laid out as the S15P31E105-594 담당자 시안.
    <ThemeProvider tone="dark">
      <View style={styles.root}>
        <StatusBar barStyle="light-content" />
        <NightBackground />
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
            {/* 대표 사진: the mockup's centred tile; the picked photo fills it, tapping it picks another,
                × takes it out. */}
            <View style={styles.photoBlock}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={
                  photo ? '대표 사진 바꾸기' : '대표 사진 추가'
                }
                disabled={busy}
                onPress={choosePhoto}
                style={styles.photo}
              >
                {photo ? (
                  <Image
                    source={{ uri: photo.uri }}
                    style={StyleSheet.absoluteFill}
                    resizeMode="cover"
                    accessibilityIgnoresInvertColors
                  />
                ) : (
                  <>
                    <Icon name="camera" color={groupTone.text} size={24} />
                    <AppText style={styles.photoText}>대표 사진 추가</AppText>
                  </>
                )}
              </PressableScale>
              {photo ? (
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel="대표 사진 빼기"
                  disabled={busy}
                  onPress={() => setPhoto(null)}
                  hitSlop={8}
                  style={styles.photoRemove}
                >
                  <Icon name="close" color={groupTone.text} size={14} />
                </PressableScale>
              ) : null}
            </View>
            <Field title="크루 이름" note="필수">
              <InputBox>
                <TextInput
                  accessibilityLabel="크루 이름"
                  placeholder="예: 광안리 주말 러너스"
                  placeholderTextColor={groupTone.muted}
                  selectionColor={groupTone.accent}
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
            <Field title="소개">
              <InputBox tall>
                <TextInput
                  accessibilityLabel="소개"
                  placeholder="언제, 어디서, 어떤 페이스로 달리는지 적어 주세요"
                  placeholderTextColor={groupTone.muted}
                  selectionColor={groupTone.accent}
                  value={description}
                  onChangeText={setDescription}
                  maxLength={descriptionLimit}
                  multiline
                  textAlignVertical="top"
                  style={[styles.input, styles.multiline]}
                />
                {/* The count sits in the field's bottom right, where the mockup has 최대 200자. */}
                <NumText
                  text={`${description.length} / ${descriptionLimit}`}
                  style={styles.counter}
                />
              </InputBox>
            </Field>
            <Field
              title="가입 방식"
              note="만든 뒤 크루 관리에서 바꿀 수 있어요"
            >
              <PolicySegmented
                options={policyOptions}
                value={joinPolicy}
                onChange={setJoinPolicy}
              />
              <AppText style={styles.sub}>{policyNotes[joinPolicy]}</AppText>
            </Field>
            {/* 모집 인원: the mockup's one field with − and + at its ends and the count in the middle. */}
            <Field title="모집 인원">
              <View style={[styles.inputBox, styles.capacityBox]}>
                <StepButton
                  icon="minus"
                  label="모집 인원 줄이기"
                  disabled={capacity <= minCapacity}
                  onPress={() => setCapacity(value => value - 1)}
                />
                <View
                  style={styles.flex}
                  accessible
                  accessibilityLabel={`모집 인원 ${capacity}명`}
                >
                  <NumText
                    text={`${capacity}명`}
                    style={styles.capacity}
                    numberStyle={styles.capacityNumber}
                  />
                </View>
                <StepButton
                  icon="plus"
                  label="모집 인원 늘리기"
                  disabled={capacity >= maxCapacity}
                  onPress={() => setCapacity(value => value + 1)}
                />
              </View>
            </Field>
          </ScrollView>
        </KeyboardLift>
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <BottomFade />
          <GroupCta
            navy
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

// A field on the navy page (S15P31E105-594 담당자 시안, home tone): a faint white panel with a faint white rim.
const field = {
  borderRadius: 12,
  borderWidth: 1,
  borderColor: groupTone.cardLine,
  backgroundColor: groupTone.card,
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
    color: groupTone.text,
  },
  // Room under the last section for the floating button.
  content: { paddingHorizontal: 20, paddingBottom: 120, gap: 18 },
  photoBlock: {
    alignSelf: 'center',
    marginTop: spacing.md,
    marginBottom: 6,
  },
  // 6.3-PhotoUpload: a centred panel, the picked photo filling it.
  photo: {
    width: 150,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    overflow: 'hidden',
    ...field,
    borderRadius: 14,
  },
  photoRemove: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(2,5,14,0.55)',
  },
  photoText: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 17,
    color: groupTone.sub,
  },
  section: { gap: 8 },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  label: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: groupTone.text,
  },
  note: {
    flexShrink: 1,
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 16,
    color: groupTone.muted,
  },
  sub: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: groupTone.sub,
  },
  cardSub: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: groupTone.sub,
  },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 16,
    ...field,
  },
  inputBoxTall: {
    minHeight: 96,
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 0,
    paddingBottom: 10,
  },
  // No lineHeight: on Android it clips the top of a single-line input.
  input: {
    flex: 1,
    height: 48,
    padding: 0,
    fontFamily: typography.input.fontFamily,
    fontSize: 15,
    color: groupTone.text,
  },
  multiline: { flex: 0, height: 70, paddingTop: spacing.lg },
  counter: {
    alignSelf: 'flex-end',
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 16,
    color: groupTone.muted,
  },
  picked: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: groupTone.text,
  },
  // The search state: one panel holding a lighter field and the results under it.
  picker: { gap: spacing.xs },
  pickerOpen: { padding: 8, ...field },
  searchBox: { backgroundColor: groupTone.inner },
  pickerNote: {
    paddingHorizontal: 10,
    paddingVertical: spacing.sm,
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: groupTone.sub,
  },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: 10,
  },
  resultLine: { borderTopWidth: 1, borderTopColor: groupTone.line },
  capacityBox: { paddingHorizontal: 4, minHeight: 52 },
  step: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dim: { opacity: 0.4 },
  capacity: {
    textAlign: 'center',
    fontFamily: fontFamily.bold,
    fontSize: 18,
    lineHeight: 24,
    color: groupTone.text,
  },
  capacityNumber: { fontSize: 22 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
});
