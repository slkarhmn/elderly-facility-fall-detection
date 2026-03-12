import React, { useState, useEffect, useRef } from 'react'
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Animated,
  ScrollView,
  ActivityIndicator,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { colors, radius } from '../../constants/theme'
import {
  ProgressBar,
  StepTag,
  Headline,
  Subline,
  CTAButton,
  BackButton,
} from '../../components/OnboardingUI'
import { useOnboardingStore } from '../../store/onboardingStore'

type ScanState = 'idle' | 'scanning' | 'found' | 'connected' | 'error'

const MOCK_DEVICES = [
  { id: 'FG-A3F2', name: 'FallGuard #A3F2', rssi: -52 },
  { id: 'FG-B1C9', name: 'FallGuard #B1C9', rssi: -68 },
]

// ─── Pulse Ring ───────────────────────────────────────────────────────────────

function PulseRing({ scanning }: { scanning: boolean }) {
  const ring1 = useRef(new Animated.Value(0)).current
  const ring2 = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (scanning) {
      const pulse = (anim: Animated.Value, delay: number) =>
        Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.timing(anim, { toValue: 1, duration: 1400, useNativeDriver: true }),
            Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: true }),
          ])
        ).start()
      pulse(ring1, 0)
      pulse(ring2, 500)
    } else {
      ring1.stopAnimation()
      ring2.stopAnimation()
      ring1.setValue(0)
      ring2.setValue(0)
    }
  }, [scanning])

  return (
    <View style={pulseStyles.wrap}>
      <Animated.View style={[pulseStyles.ring, {
        opacity: ring1.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.18, 0.06, 0] }),
        transform: [{ scale: ring1.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] }) }],
      }]} />
      <Animated.View style={[pulseStyles.ring, {
        opacity: ring2.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.14, 0.04, 0] }),
        transform: [{ scale: ring2.interpolate({ inputRange: [0, 1], outputRange: [1, 2.8] }) }],
      }]} />
      <View style={pulseStyles.centre}>
        <Ionicons name="radio-outline" size={34} color="#FBF7EC" />
      </View>
    </View>
  )
}

const pulseStyles = StyleSheet.create({
  wrap: {
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 32,
  },
  ring: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.ink,
  },
  centre: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 6,
  },
})

// ─── Device Row ───────────────────────────────────────────────────────────────

function DeviceRow({
  device,
  selected,
  onSelect,
}: {
  device: { id: string; name: string; rssi: number }
  selected: boolean
  onSelect: () => void
}) {
  const signalBars = device.rssi > -60 ? 3 : device.rssi > -70 ? 2 : 1

  return (
    <TouchableOpacity
      style={[deviceStyles.row, selected && deviceStyles.rowSelected]}
      onPress={onSelect}
      activeOpacity={0.75}
    >
      <View style={[deviceStyles.iconWrap, selected && deviceStyles.iconSelected]}>
        <Ionicons name="bluetooth" size={20} color={selected ? '#FBF7EC' : '#31372B'} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[deviceStyles.name, selected && deviceStyles.nameSelected]}>
          {device.name}
        </Text>
        <Text style={[deviceStyles.id, selected && deviceStyles.idSelected]}>
          ID: {device.id} · Signal: {'▮'.repeat(signalBars)}{'▯'.repeat(3 - signalBars)}
        </Text>
      </View>
      <View style={[deviceStyles.radio, selected && deviceStyles.radioSelected]}>
        {selected && <View style={deviceStyles.radioDot} />}
      </View>
    </TouchableOpacity>
  )
}

const deviceStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(49,55,43,0.07)',
    marginBottom: 10,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  rowSelected: { backgroundColor: colors.ink, borderColor: colors.ink },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: 'rgba(49,55,43,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconSelected: { backgroundColor: 'rgba(251,247,236,0.1)' },
  name: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 14, color: colors.ink },
  nameSelected: { color: colors.bg },
  id: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 11, color: colors.ink, opacity: 0.42, marginTop: 2 },
  idSelected: { color: colors.bg, opacity: 0.45 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'rgba(49,55,43,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { borderColor: colors.bg },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.bg },
})

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function StepSync() {
  const { setArduinoConnected } = useOnboardingStore()
  const [scanState, setScanState] = useState<ScanState>('idle')
  const [devices, setDevices] = useState<typeof MOCK_DEVICES>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)

  const canContinue = scanState === 'connected'

  const startScan = () => {
    setScanState('scanning')
    setDevices([])
    setSelectedId(null)
    setTimeout(() => {
      setDevices(MOCK_DEVICES)
      setScanState('found')
    }, 2000)
  }

  const connectToDevice = (deviceId: string) => {
    setConnecting(true)
    setSelectedId(deviceId)
    setTimeout(() => {
      setConnecting(false)
      setScanState('connected')
      setArduinoConnected(deviceId)
    }, 1500)
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <ProgressBar total={5} current={3} />

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <BackButton onPress={() => router.back()} />
          <StepTag current={3} total={5} />
          <Headline>{'Sync your\nArduino.'}</Headline>
          <Subline>
            Make sure your FallGuard sensor is powered on and within 1 metre of your phone.
          </Subline>

          <PulseRing scanning={scanState === 'scanning'} />

          {scanState === 'idle' && (
            <TouchableOpacity style={styles.scanBtn} onPress={startScan} activeOpacity={0.8}>
              <Text style={styles.scanBtnLabel}>Start Scanning</Text>
            </TouchableOpacity>
          )}

          {scanState === 'scanning' && (
            <View style={styles.scanningRow}>
              <ActivityIndicator color={colors.ink} size="small" />
              <Text style={styles.scanningText}>Searching for nearby devices…</Text>
            </View>
          )}

          {(scanState === 'found' || scanState === 'connected') && (
            <>
              <Text style={styles.devicesLabel}>Nearby Devices</Text>
              {devices.map((d) => (
                <DeviceRow
                  key={d.id}
                  device={d}
                  selected={selectedId === d.id}
                  onSelect={() => !connecting && connectToDevice(d.id)}
                />
              ))}
              {connecting && (
                <View style={styles.connectingRow}>
                  <ActivityIndicator color={colors.ink} size="small" />
                  <Text style={styles.connectingText}>Connecting…</Text>
                </View>
              )}
              {scanState === 'connected' && (
                <View style={styles.successBox}>
                  <Ionicons name="checkmark-circle" size={22} color={colors.ink} />
                  <View>
                    <Text style={styles.successTitle}>Device connected!</Text>
                    <Text style={styles.successSub}>
                      FallGuard #{selectedId?.split('-')[1]} is ready.
                    </Text>
                  </View>
                </View>
              )}
              <TouchableOpacity style={styles.rescanBtn} onPress={startScan} activeOpacity={0.6}>
                <Text style={styles.rescanLabel}>Scan again</Text>
              </TouchableOpacity>
            </>
          )}

          {scanState === 'error' && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>
                Couldn't find any devices. Make sure Bluetooth is on and your sensor is nearby.
              </Text>
              <TouchableOpacity style={styles.scanBtn} onPress={startScan}>
                <Text style={styles.scanBtnLabel}>Try Again</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.tipsBox}>
            <Text style={styles.tipsTitle}>Tips</Text>
            <Text style={styles.tipItem}>• Turn on your Arduino sensor before scanning</Text>
            <Text style={styles.tipItem}>• Keep Bluetooth enabled on your phone</Text>
            <Text style={styles.tipItem}>• Stay within 1 metre of the sensor</Text>
          </View>
        </ScrollView>
      </View>

      {/* OUTSIDE container — won't move with keyboard */}
      <CTAButton
        label="Continue"
        onPress={() => router.push('/(onboarding)/calibrate')}
        disabled={!canContinue}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { paddingHorizontal: 28, paddingTop: 22, paddingBottom: 24 },
  scanBtn: {
    alignSelf: 'center',
    paddingHorizontal: 28,
    paddingVertical: 14,
    backgroundColor: colors.ink,
    borderRadius: 14,
    marginBottom: 20,
  },
  scanBtnLabel: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 14, color: colors.bg },
  scanningRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 20 },
  scanningText: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 13, color: colors.ink, opacity: 0.5 },
  devicesLabel: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: colors.ink, opacity: 0.38, marginBottom: 10 },
  connectingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, paddingHorizontal: 4 },
  connectingText: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 13, color: colors.ink, opacity: 0.5 },
  successBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    backgroundColor: 'rgba(49,55,43,0.07)',
    borderRadius: radius.lg,
    marginBottom: 10,
  },
  successTitle: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 14, color: colors.ink },
  successSub: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 12, color: colors.ink, opacity: 0.45, marginTop: 2 },
  rescanBtn: { alignSelf: 'flex-start', marginBottom: 20 },
  rescanLabel: { fontFamily: 'NunitoSans_700Bold', fontSize: 13, color: colors.ink, opacity: 0.35, textDecorationLine: 'underline' },
  errorBox: { gap: 14, marginBottom: 20 },
  errorText: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 13, color: colors.ink, opacity: 0.5, lineHeight: 20 },
  tipsBox: { padding: 16, backgroundColor: 'rgba(49,55,43,0.05)', borderRadius: radius.md, gap: 6, marginTop: 8 },
  tipsTitle: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 11, color: colors.ink, opacity: 0.45, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 },
  tipItem: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 12.5, color: colors.ink, opacity: 0.45, lineHeight: 20 },
})