import React, { useState, useEffect, useRef } from 'react'
import { View, Text, StyleSheet, ScrollView, Animated, Easing, Alert } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Circle } from 'react-native-svg'
import { router } from 'expo-router'
import { colors, radius } from '../../constants/theme'
import { ProgressBar, StepTag, Headline, Subline, CTAButton, BackButton } from '../../components/OnboardingUI'
import { Ionicons } from '@expo/vector-icons'
import { useOnboardingStore } from '../../store/onboardingStore'
import { bleManager } from '../../constants/bleManager'
import { encodeBase64Byte } from '../../constants/base64Byte'

const BLE_SERVICE_UUID      = '19B10000-E8F2-537E-4F6C-D104768A1214'
const BLE_MODE_COMMAND_UUID = '19B10004-E8F2-537E-4F6C-D104768A1214'
const CMD_CALIBRATE         = 99 // ASCII 'c'

const TOTAL_SECONDS  = 20
const CIRCUMFERENCE  = 2 * Math.PI * 80

function TimerRing({ progress, secondsLeft, running, done }: {
  progress: number; secondsLeft: number; running: boolean; done: boolean
}) {
  const pulseAnim = useRef(new Animated.Value(1)).current

  useEffect(() => {
    if (running) {
      Animated.loop(Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.04, duration: 800, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        Animated.timing(pulseAnim, { toValue: 1,    duration: 800, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
      ])).start()
    } else {
      pulseAnim.stopAnimation(); pulseAnim.setValue(1)
    }
  }, [running])

  const strokeDashoffset = CIRCUMFERENCE * (1 - progress)

  return (
    <Animated.View style={[ringStyles.wrap, { transform: [{ scale: pulseAnim }] }]}>
      <Svg width={180} height={180} style={ringStyles.svg}>
        <Circle cx="90" cy="90" r="80" fill="none" stroke="rgba(49,55,43,0.08)" strokeWidth={7} />
        <Circle cx="90" cy="90" r="80" fill="none" stroke={done ? 'rgba(49,55,43,0.4)' : colors.ink}
          strokeWidth={7} strokeLinecap="round" strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={strokeDashoffset} rotation="-90" origin="90, 90" />
      </Svg>
      <View style={ringStyles.inner}>
        {done ? (
          <><Ionicons name="checkmark" size={40} color="#31372B" /><Text style={ringStyles.doneLabel}>Done!</Text></>
        ) : (
          <><Text style={ringStyles.num}>{secondsLeft}</Text><Text style={ringStyles.label}>seconds</Text></>
        )}
      </View>
    </Animated.View>
  )
}

const ringStyles = StyleSheet.create({
  wrap: { width: 180, height: 180, alignSelf: 'center', marginBottom: 32, position: 'relative', alignItems: 'center', justifyContent: 'center' },
  svg: { position: 'absolute' },
  inner: { alignItems: 'center', justifyContent: 'center' },
  num: { fontFamily: 'NunitoSans_900Black', fontSize: 52, color: colors.ink, letterSpacing: -2, lineHeight: 56 },
  label: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 10, letterSpacing: 2.5, textTransform: 'uppercase', color: colors.ink, opacity: 0.35, marginTop: 4 },
  doneLabel: { fontFamily: 'NunitoSans_900Black', fontSize: 18, color: colors.ink, marginTop: 4 },
})

function StepItem({ num, text, active }: { num: number; text: string; active?: boolean }) {
  return (
    <View style={stepStyles.row}>
      <View style={[stepStyles.badge, active && stepStyles.badgeActive]}>
        <Text style={[stepStyles.badgeNum, active && stepStyles.badgeNumActive]}>{num}</Text>
      </View>
      <Text style={[stepStyles.text, active && stepStyles.textActive]}>{text}</Text>
    </View>
  )
}

const stepStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 14 },
  badge: { width: 24, height: 24, borderRadius: 8, backgroundColor: 'rgba(49,55,43,0.08)', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 },
  badgeActive: { backgroundColor: colors.ink },
  badgeNum: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 12, color: colors.ink, opacity: 0.5 },
  badgeNumActive: { color: colors.bg, opacity: 1 },
  text: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 13.5, color: colors.ink, opacity: 0.5, lineHeight: 21, flex: 1 },
  textActive: { opacity: 0.8 },
})

type CalibState = 'ready' | 'sending' | 'running' | 'done' | 'error'

export default function StepCalibrate() {
  const insets = useSafeAreaInsets()
  const { arduinoDeviceId } = useOnboardingStore()
  const [calibState, setCalibState] = useState<CalibState>('ready')
  const [secondsLeft, setSecondsLeft] = useState(TOTAL_SECONDS)
  const [errorMsg, setErrorMsg] = useState('')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      // Only clear the countdown timer — never destroy the shared bleManager singleton
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  const progress = calibState === 'done' ? 1 : calibState === 'running' ? (TOTAL_SECONDS - secondsLeft) / TOTAL_SECONDS : 0

  const startCountdown = () => {
    setSecondsLeft(TOTAL_SECONDS)
    intervalRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) { clearInterval(intervalRef.current!); setCalibState('done'); return 0 }
        return prev - 1
      })
    }, 1000)
  }

  const startCalibration = async () => {
    if (!arduinoDeviceId) {
      setCalibState('running'); startCountdown(); return
    }
    setCalibState('sending'); setErrorMsg('')
    try {
      const devices = await bleManager.connectedDevices([BLE_SERVICE_UUID])
      const device = devices.find(d => d.id === arduinoDeviceId) ?? devices[0]
      if (!device) throw new Error('Device not connected. Go back and reconnect your sensor.')
      await device.discoverAllServicesAndCharacteristics()
      const cmdBase64 = encodeBase64Byte(CMD_CALIBRATE)
      await device.writeCharacteristicWithResponseForService(BLE_SERVICE_UUID, BLE_MODE_COMMAND_UUID, cmdBase64)
      setCalibState('running'); startCountdown()
    } catch (err: any) {
      setCalibState('error'); setErrorMsg(err?.message ?? 'Failed to send calibration command.')
    }
  }

  const ctaLabel = calibState === 'ready' ? 'Start Walking' : calibState === 'sending' ? 'Sending command…' : calibState === 'running' ? 'Recording…' : calibState === 'error' ? 'Try Again' : 'All Done — Continue'
  const ctaDisabled = calibState === 'sending' || calibState === 'running'

  const handleCTA = () => {
    if (calibState === 'ready' || calibState === 'error') startCalibration()
    else if (calibState === 'done') router.push('/(onboarding)/facility')
  }

  return (
    <View style={[styles.safe, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.container}>
        <ProgressBar total={5} current={4} />
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <BackButton onPress={() => router.back()} />
          <StepTag current={4} total={5} />
          <Headline>{'Calibrate\nyour device.'}</Headline>
          <Subline>Attach the sensor to your waist and walk naturally for 20 seconds. We'll record your normal gait.</Subline>

          <TimerRing progress={progress} secondsLeft={secondsLeft} running={calibState === 'running'} done={calibState === 'done'} />

          <StepItem num={1} text="Attach the Arduino sensor to your waist using the belt clip." active={calibState === 'ready' || calibState === 'sending'} />
          <StepItem num={2} text="Tap Start Walking — the app will send a calibration command to your sensor, then walk at your normal pace for 20 seconds." active={calibState === 'running'} />
          <StepItem num={3} text="Stay still once the timer ends — your sensor will automatically begin fall detection." active={calibState === 'done'} />

          {calibState === 'error' && (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle-outline" size={16} color="#c0392b" />
              <Text style={styles.errorText}>{errorMsg}</Text>
            </View>
          )}
          {calibState === 'done' && (
            <View style={styles.successBanner}>
              <Text style={styles.successText}>✓ Gait data recorded. Your sensor is now calibrated and monitoring for falls.</Text>
            </View>
          )}
        </ScrollView>

        <CTAButton label={ctaLabel} onPress={handleCTA} disabled={ctaDisabled} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: 28, paddingTop: 22, paddingBottom: 24 },
  successBanner: { marginTop: 12, padding: 14, backgroundColor: 'rgba(49,55,43,0.07)', borderRadius: radius.lg },
  successText: { fontFamily: 'NunitoSans_700Bold', fontSize: 13, color: colors.ink, opacity: 0.65, lineHeight: 20 },
  errorBanner: { marginTop: 12, padding: 14, backgroundColor: 'rgba(200,50,50,0.07)', borderRadius: radius.lg, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  errorText: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 13, color: '#c0392b', lineHeight: 20, flex: 1 },
})