import React, { useState, useEffect, useRef } from 'react'
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Animated,
  Easing,
} from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import { router } from 'expo-router'
import { colors, radius, spacing } from '../../constants/theme'
import {
  ProgressBar,
  StepTag,
  Headline,
  Subline,
  CTAButton,
  BackButton,
} from '../../components/OnboardingUI'
import { Ionicons } from '@expo/vector-icons'

const TOTAL_SECONDS = 15
const CIRCUMFERENCE = 2 * Math.PI * 80 // r=80

// ─── Animated Ring ────────────────────────────────────────────────────────────

function TimerRing({
  progress,
  secondsLeft,
  running,
  done,
}: {
  progress: number // 0–1
  secondsLeft: number
  running: boolean
  done: boolean
}) {
  const pulseAnim = useRef(new Animated.Value(1)).current

  useEffect(() => {
    if (running) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.04,
            duration: 800,
            useNativeDriver: true,
            easing: Easing.inOut(Easing.ease),
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
            easing: Easing.inOut(Easing.ease),
          }),
        ])
      ).start()
    } else {
      pulseAnim.stopAnimation()
      pulseAnim.setValue(1)
    }
  }, [running])

  const strokeDashoffset = CIRCUMFERENCE * (1 - progress)

  return (
    <Animated.View
      style={[ringStyles.wrap, { transform: [{ scale: pulseAnim }] }]}
    >
      <Svg width={180} height={180} style={ringStyles.svg}>
        {/* Background track */}
        <Circle
          cx="90"
          cy="90"
          r="80"
          fill="none"
          stroke="rgba(49,55,43,0.08)"
          strokeWidth={7}
        />
        {/* Progress arc */}
        <Circle
          cx="90"
          cy="90"
          r="80"
          fill="none"
          stroke={done ? 'rgba(49,55,43,0.4)' : colors.ink}
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={strokeDashoffset}
          rotation="-90"
          origin="90, 90"
        />
      </Svg>
      <View style={ringStyles.inner}>
        {done ? (
          <>
            <Ionicons name="checkmark" size={40} color="#31372B" />
            <Text style={ringStyles.doneLabel}>Done!</Text>
          </>
        ) : (
          <>
            <Text style={ringStyles.num}>{secondsLeft}</Text>
            <Text style={ringStyles.label}>seconds</Text>
          </>
        )}
      </View>
    </Animated.View>
  )
}

const ringStyles = StyleSheet.create({
  wrap: {
    width: 180,
    height: 180,
    alignSelf: 'center',
    marginBottom: 32,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  svg: {
    position: 'absolute',
  },
  inner: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  num: {
    fontFamily: 'NunitoSans_900Black',
    fontSize: 52,
    color: colors.ink,
    letterSpacing: -2,
    lineHeight: 56,
  },
  label: {
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 10,
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    color: colors.ink,
    opacity: 0.35,
    marginTop: 4,
  },
  doneIcon: {
    fontSize: 40,
    color: colors.ink,
  },
  doneLabel: {
    fontFamily: 'NunitoSans_900Black',
    fontSize: 18,
    color: colors.ink,
    marginTop: 4,
  },
})

// ─── Step Item ────────────────────────────────────────────────────────────────

function StepItem({
  num,
  text,
  active,
}: {
  num: number
  text: string
  active?: boolean
}) {
  return (
    <View style={stepStyles.row}>
      <View style={[stepStyles.badge, active && stepStyles.badgeActive]}>
        <Text style={[stepStyles.badgeNum, active && stepStyles.badgeNumActive]}>
          {num}
        </Text>
      </View>
      <Text style={[stepStyles.text, active && stepStyles.textActive]}>{text}</Text>
    </View>
  )
}

const stepStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
  },
  badge: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: 'rgba(49,55,43,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  badgeActive: { backgroundColor: colors.ink },
  badgeNum: {
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 12,
    color: colors.ink,
    opacity: 0.5,
  },
  badgeNumActive: { color: colors.bg, opacity: 1 },
  text: {
    fontFamily: 'NunitoSans_600SemiBold',
    fontSize: 13.5,
    color: colors.ink,
    opacity: 0.5,
    lineHeight: 21,
    flex: 1,
  },
  textActive: { opacity: 0.8 },
})

// ─── Main Screen ─────────────────────────────────────────────────────────────

type CalibState = 'ready' | 'running' | 'done'

export default function StepCalibrate() {
  const [calibState, setCalibState] = useState<CalibState>('ready')
  const [secondsLeft, setSecondsLeft] = useState(TOTAL_SECONDS)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const progress =
    calibState === 'done'
      ? 1
      : calibState === 'running'
      ? (TOTAL_SECONDS - secondsLeft) / TOTAL_SECONDS
      : 0

  const startCalibration = () => {
    setCalibState('running')
    setSecondsLeft(TOTAL_SECONDS)

    intervalRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(intervalRef.current!)
          setCalibState('done')
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  const handleContinue = () => {
    router.push('/(onboarding)/facility')
  }

  const ctaLabel =
    calibState === 'ready'
      ? 'Start Walking'
      : calibState === 'running'
      ? 'Recording…'
      : 'All Done — Continue'

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <ProgressBar total={5} current={4} />

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <BackButton onPress={() => router.back()} />

          <StepTag current={4} total={5} />
          <Headline>{'Calibrate\nyour device.'}</Headline>
          <Subline>
            Attach the sensor to your wrist and walk naturally. We'll record your normal gait.
          </Subline>

          <TimerRing
            progress={progress}
            secondsLeft={secondsLeft}
            running={calibState === 'running'}
            done={calibState === 'done'}
          />

          <StepItem
            num={1}
            text="Attach the Arduino sensor to your wrist or belt clip."
            active={calibState === 'ready'}
          />
          <StepItem
            num={2}
            text="Tap Start Walking and walk at your normal pace for 15 seconds."
            active={calibState === 'running'}
          />
          <StepItem
            num={3}
            text="Stay still once the timer ends — calibration complete!"
            active={calibState === 'done'}
          />

          {calibState === 'done' && (
            <View style={styles.successBanner}>
              <Text style={styles.successText}>
                ✓ Gait data recorded successfully. Your sensor is calibrated.
              </Text>
            </View>
          )}
        </ScrollView>

        <CTAButton
          label={ctaLabel}
          onPress={calibState === 'ready' ? startCalibration : calibState === 'done' ? handleContinue : () => {}}
          disabled={calibState === 'running'}
        />
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: {
    paddingHorizontal: 28,
    paddingTop: 22,
    paddingBottom: 120,
  },
  successBanner: {
    marginTop: 12,
    padding: 14,
    backgroundColor: 'rgba(49,55,43,0.07)',
    borderRadius: radius.lg,
  },
  successText: {
    fontFamily: 'NunitoSans_700Bold',
    fontSize: 13,
    color: colors.ink,
    opacity: 0.65,
    lineHeight: 20,
  },
})
