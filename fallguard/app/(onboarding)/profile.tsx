
import React, { useState } from 'react'
import { View, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { colors } from '../../constants/theme'
import { ProgressBar, StepTag, Headline, Subline, UnderlineInput, CTAButton } from '../../components/OnboardingUI'
import { useOnboardingStore } from '../../store/onboardingStore'

export default function StepProfile() {
  const insets = useSafeAreaInsets()
  const { setProfile } = useOnboardingStore()
  const [name, setName] = useState('')
  const [age, setAge] = useState('')

  const canContinue = name.trim().length > 0 && age.trim().length > 0

  const handleContinue = () => {
    if (!canContinue) return
    setProfile(name.trim(), age.trim())
    router.push('/(onboarding)/contacts')
  }

  return (
    <View style={[styles.safe, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.container}>
          <ProgressBar total={5} current={1} />
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
          >
            <StepTag current={1} total={5} />
            <Headline>{"Let's create\nyour profile."}</Headline>
            <Subline>This helps us keep you safe and personalise your experience.</Subline>

            <UnderlineInput
              label="Your Name"
              placeholder="e.g. Margaret Davies"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              returnKeyType="next"
            />
            <UnderlineInput
              label="Your Age"
              placeholder="e.g. 74"
              value={age}
              onChangeText={(t) => setAge(t.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              maxLength={3}
              hint="We use this to calibrate fall sensitivity"
              returnKeyType="done"
              onSubmitEditing={handleContinue}
            />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
      <CTAButton label="Continue" onPress={handleContinue} disabled={!canContinue} />
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { paddingHorizontal: 28, paddingTop: 24, paddingBottom: 24 },
})