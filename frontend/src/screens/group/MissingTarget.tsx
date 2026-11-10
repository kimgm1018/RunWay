import React from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EmptyState } from '../../components';
import { BackButton } from '../../components/BackButton';
import { navigateTo } from '../../navigation/navigateTo';
import { spacing, ThemeProvider } from '../../theme';
import { MistBackground } from './look';

// A group screen opened without the crew or group run it shows. It used to fall back to a mock id, which the
// server cannot answer and the mock answers with a demo item; now it says so and goes back (S15P31E105-635).
export function MissingTarget({ title }: { title: string }) {
  const navigation = useNavigation();
  const back = () =>
    navigation.canGoBack()
      ? navigation.goBack()
      : navigateTo(navigation, 'MyCrews');
  return (
    <ThemeProvider tone="light">
      <View style={styles.root}>
        <StatusBar barStyle="dark-content" />
        <MistBackground />
        <SafeAreaView edges={['top']} style={styles.root}>
          <View style={styles.header}>
            <BackButton tone="light" onPress={back} />
          </View>
          <EmptyState
            icon="alert"
            title={title}
            description="목록에서 다시 선택해 주세요."
            actionLabel="돌아가기"
            onAction={back}
          />
        </SafeAreaView>
      </View>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
});
