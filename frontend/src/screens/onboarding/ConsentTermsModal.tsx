import React from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Button, IconButton } from '../../components';
import { spacing, useTheme } from '../../theme';
import type { ConsentDocument } from './consentTerms';

export function ConsentTermsModal({
  document,
  onClose,
}: {
  document: ConsentDocument;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Modal
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaProvider>
        <SafeAreaView
          accessibilityViewIsModal
          style={[styles.fill, { backgroundColor: colors.background }]}
        >
          <View style={styles.header}>
            <AppText
              variant="bodyStrong"
              style={styles.fill}
              accessibilityRole="header"
            >
              {document.title}
            </AppText>
            <IconButton
              icon="close"
              accessibilityLabel="약관 닫기"
              onPress={onClose}
            />
          </View>
          <ScrollView
            style={styles.fill}
            contentContainerStyle={styles.content}
            accessibilityLabel={`${document.title} 전문`}
          >
            <AppText variant="caption" tone="textSecondary">
              개발용 약관 초안 · 법률 검토 전
            </AppText>
            <AppText variant="bodyStrong">
              {document.required ? '필수 동의' : '선택 동의'}
            </AppText>
            {document.sections.map(section => (
              <View key={section.title} style={styles.section}>
                <AppText variant="bodyStrong" accessibilityRole="header">
                  {section.title}
                </AppText>
                {section.paragraphs.map(paragraph => (
                  <AppText key={paragraph}>{paragraph}</AppText>
                ))}
              </View>
            ))}
            <AppText variant="caption" tone="textSecondary">
              {document.title} 전문 끝
            </AppText>
          </ScrollView>
          <View style={styles.footer}>
            <Button title="확인" variant="secondary" onPress={onClose} />
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.md,
  },
  content: { padding: spacing.screen, gap: spacing.xxl },
  section: { gap: spacing.md },
  footer: { padding: spacing.screen },
});
