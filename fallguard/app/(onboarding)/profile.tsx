import React, { useState } from 'react'
import {
  View,
  StyleSheet,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native'
import { router } from 'expo-router'
import { colors } from '../../constants/theme'
import {
  ProgressBar,
  StepTag,
  Headline,
  Subline,
  UnderlineInput,
  CTAButton,
} from '../../components/OnboardingUI'
import { useOnboardingStore } from '../../store/onboardingStore'

export default function StepProfile() {
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
    <SafeAreaView style={styles.safe}>
      {/* KeyboardAvoidingView only wraps the scroll content */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View style={styles.container}>
          <View style={styles.progressWrap}>
            <ProgressBar total={5} current={1} />
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
          >
            <StepTag current={1} total={5} />
            <Headline>{"Let's create\nyour profile."}</Headline>
            <Subline>
              This helps us keep you safe and personalise your experience.
            </Subline>

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

      {/* CTAButton is OUTSIDE KeyboardAvoidingView — won't move with keyboard */}
      <CTAButton
        label="Continue"
        onPress={handleContinue}
        disabled={!canContinue}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: {
    flex: 1,
    backgroundColor: colors.bg, // ← fixes the white bleed
  },
  scrollContent: {
    paddingHorizontal: 28,
    paddingTop: 28,
    paddingBottom: 24,
  },
  bottomFade: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 120,
    backgroundColor: colors.bg, // solid bg behind button area
    // soft top edge so content fades into it
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    opacity: 0.92,
  },

})