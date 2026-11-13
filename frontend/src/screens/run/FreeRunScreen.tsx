import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { BackButton } from '../../components/BackButton';
import { useResource, type Repositories } from '../../data';
import { ThemeProvider } from '../../theme';
import { MapScreenFrame } from './MapScreenFrame';
import { RunMap } from '../../components/RunMap';
import { RunGoalSheet } from './goal/RunGoalSheet';
import { goalConfig, goalLabel } from './goal/runGoal';
import { useRunGoalDraft } from './goal/RunGoalDraft';
import { gpsLabels, PlaceCard, PlaceRetryCard, RunStartBar } from './parts';
import { navigateTo } from '../../navigation/navigateTo';

const loadPlace = (repositories: Repositories) =>
  repositories.run.getCurrentPlace();

// The map from where you are and the start row, without the tab bar (2.0F · 2.0C). Where I am stands in a bubble
// over me on the bright mint map (S15P31E105-683); the bottom card holds the chips and 설정 · 러닝 시작 · 음악.
function MapStart({ bottom }: { bottom: React.ReactNode }) {
  const navigation = useNavigation();
  const place = useResource(useCallback(loadPlace, []));
  return (
    // Day design whatever the hour: the map under it is the bright day map (S15P31E105-683).
    <ThemeProvider tone="light">
      <MapScreenFrame
        renderMap={logo => (
          <RunMap
            position={
              place.status === 'ready'
                ? place.data.position ?? undefined
                : undefined
            }
            placeLabel={
              place.status === 'ready'
                ? {
                    title: place.data.name,
                    sub: `현재 위치 · ${gpsLabels[place.data.gps]}`,
                  }
                : undefined
            }
            area={{ top: 0.4, bottom: 0.34 }}
            logo={logo}
            view="lean"
            look="mint"
            style={StyleSheet.absoluteFill}
          />
        )}
        top={
          <View style={styles.top}>
            {/* The mint map stays bright after sunset too, so the light button. */}
            <BackButton onPress={navigation.goBack} />
            <View style={styles.flex}>
              {/* Found, the place moves into the bubble over me on the map. */}
              {place.status === 'ready' ? (
                // A lookup that finished without a position (no permission, location off, no fix) is not "found":
                // it says so and a tap tries again (S15P31E105-798, TEAM QA T22).
                place.data.position ? null : (
                  <PlaceRetryCard onPress={place.reload} />
                )
              ) : place.status === 'error' ? (
                // A failed lookup stops saying it is still searching; a tap tries again.
                <PlaceRetryCard onPress={place.reload} />
              ) : (
                <PlaceCard name="현재 위치를 찾는 중이에요" gps="none" />
              )}
            </View>
          </View>
        }
        bottom={bottom}
      />
    </ThemeProvider>
  );
}

// 2.0F 자유 러닝 (S15P31E105-517): the chip opens 운동 목표 (목표 없음 · 거리 · 시간 · 페이서); a card's start button
// starts with that goal.
export function FreeRunScreen() {
  const navigation = useNavigation();
  // The run start map stays bright after sunset (S15P31E105-683), so its card keeps the day design too (담당자 요청).
  const night = false;
  // Shared with 2.0, so picking a course keeps it (S15P31E105-683).
  const { goal, setGoal } = useRunGoalDraft();
  const [choosing, setChoosing] = useState(false);

  return (
    <>
      <MapStart
        bottom={
          <RunStartBar
            night={night}
            goal={{ label: goalLabel(goal), onPress: () => setChoosing(true) }}
            // No course is a free run; 코스 설정 picks one on 3.1, which opens it on 2.0 (S15P31E105-683).
            course={{
              label: '코스 설정',
              picked: false,
              onPress: () => navigateTo(navigation, 'TodayRun'),
            }}
            config={{ mode: 'FREE', plan: null, ...goalConfig(goal) }}
          />
        }
      />
      <RunGoalSheet
        visible={choosing}
        onClose={() => setChoosing(false)}
        mode="FREE"
        goal={goal}
        onSet={next => {
          setGoal(next);
          setChoosing(false);
        }}
      />
    </>
  );
}

// 2.0C 코스 러닝 시작 (담당자 요청): 코스 러닝 opens on the same map as 2.0F. 코스 설정 takes the conditions to 3.1 코스
// 추천, and the picked course opens 2.0 with its plan; until then 러닝 시작 waits for a course.
export function CourseStartScreen() {
  const navigation = useNavigation();
  // The run start map stays bright after sunset (S15P31E105-683), so its card keeps the day design too (담당자 요청).
  const night = false;
  return (
    <MapStart
      bottom={
        <RunStartBar
          night={night}
          course={{
            label: '코스 설정',
            picked: false,
            onPress: () => navigateTo(navigation, 'TodayRun'),
          }}
          config={null}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
