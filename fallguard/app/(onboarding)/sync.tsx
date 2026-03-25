
import React, { useState, useEffect, useRef } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, Animated,
  ScrollView, ActivityIndicator, Platform, Alert,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BleManager, Device, State } from 'react-native-ble-plx'
import { PermissionsAndroid } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { colors, radius } from '../../constants/theme'
import { ProgressBar, StepTag, Headline, Subline, CTAButton, BackButton } from '../../components/OnboardingUI'
import { useOnboardingStore } from '../../store/onboardingStore'

const FALLGUARD_SERVICE_UUID = '19b10000-e8f2-537e-4f6c-d104768a1214'
const bleManager = new BleManager()

type ScanState = 'idle' | 'scanning' | 'found' | 'connected' | 'error'

interface ScannedDevice {
  id: string; name: string; rssi: number; rawDevice: Device
}

async function requestAndroidPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true
  const apiLevel = Platform.Version as number
  if (apiLevel >= 31) {
    const results = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    ])
    return (
      results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === 'granted' &&
      results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === 'granted'
    )
  } else {
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION)
    return result === 'granted'
  }
}

function PulseRing({ scanning }: { scanning: boolean }) {
  const ring1 = useRef(new Animated.Value(0)).current
  const ring2 = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (scanning) {
      const pulse = (anim: Animated.Value, delay: number) =>
        Animated.loop(Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, { toValue: 1, duration: 1400, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])).start()
      pulse(ring1, 0); pulse(ring2, 500)
    } else {
      ring1.stopAnimation(); ring2.stopAnimation()
      ring1.setValue(0); ring2.setValue(0)
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
  wrap: { width: 120, height: 120, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 32 },
  ring: { position: 'absolute', width: 120, height: 120, borderRadius: 60, backgroundColor: colors.ink },
  centre: { width: 80, height: 80, borderRadius: 24, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', shadowColor: colors.ink, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.2, shadowRadius: 16, elevation: 6 },
})

function DeviceRow({ device, selected, onSelect }: { device: ScannedDevice; selected: boolean; onSelect: () => void }) {
  const signalBars = device.rssi > -60 ? 3 : device.rssi > -70 ? 2 : 1
  return (
    <TouchableOpacity style={[deviceStyles.row, selected && deviceStyles.rowSelected]} onPress={onSelect} activeOpacity={0.75}>
      <View style={[deviceStyles.iconWrap, selected && deviceStyles.iconSelected]}>
        <Ionicons name="bluetooth" size={20} color={selected ? '#FBF7EC' : '#31372B'} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[deviceStyles.name, selected && deviceStyles.nameSelected]}>{device.name}</Text>
        <Text style={[deviceStyles.id, selected && deviceStyles.idSelected]}>
          {device.id.toUpperCase()} · Signal: {'▮'.repeat(signalBars)}{'▯'.repeat(3 - signalBars)}
        </Text>
      </View>
      <View style={[deviceStyles.radio, selected && deviceStyles.radioSelected]}>
        {selected && <View style={deviceStyles.radioDot} />}
      </View>
    </TouchableOpacity>
  )
}

const deviceStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: radius.lg, backgroundColor: 'rgba(49,55,43,0.07)', marginBottom: 10, borderWidth: 1.5, borderColor: 'transparent' },
  rowSelected: { backgroundColor: colors.ink, borderColor: colors.ink },
  iconWrap: { width: 40, height: 40, borderRadius: 13, backgroundColor: 'rgba(49,55,43,0.1)', alignItems: 'center', justifyContent: 'center' },
  iconSelected: { backgroundColor: 'rgba(251,247,236,0.1)' },
  name: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 14, color: colors.ink },
  nameSelected: { color: colors.bg },
  id: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 10, color: colors.ink, opacity: 0.42, marginTop: 2 },
  idSelected: { color: colors.bg, opacity: 0.45 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: 'rgba(49,55,43,0.25)', alignItems: 'center', justifyContent: 'center' },
  radioSelected: { borderColor: colors.bg },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.bg },
})

export default function StepSync() {
  const insets = useSafeAreaInsets()
  const { setArduinoConnected } = useOnboardingStore()
  const [scanState, setScanState] = useState<ScanState>('idle')
  const [devices, setDevices] = useState<ScannedDevice[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const discoveredRef = useRef<Map<string, ScannedDevice>>(new Map())
  const connectedDeviceRef = useRef<Device | null>(null)
  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const canContinue = scanState === 'connected'

  useEffect(() => {
    return () => {
      bleManager.stopDeviceScan()
      if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current)
    }
  }, [])

  const startScan = async () => {
    setErrorMsg(''); setScanState('scanning'); setDevices([]); setSelectedId(null)
    discoveredRef.current.clear()
    const hasPermission = await requestAndroidPermissions()
    if (!hasPermission) {
      setErrorMsg('Bluetooth permission denied. Please allow Bluetooth access in Settings.')
      setScanState('error'); return
    }
    const bleState = await bleManager.state()
    if (bleState !== State.PoweredOn) {
      const sub = bleManager.onStateChange((state) => {
        if (state === State.PoweredOn) { sub.remove(); beginScan() }
      }, true)
      return
    }
    beginScan()
  }

  const beginScan = () => {
    bleManager.startDeviceScan([FALLGUARD_SERVICE_UUID], { allowDuplicates: false }, (error, device) => {
      if (error) {
        bleManager.stopDeviceScan()
        if (error.errorCode === 601) { beginScanAllDevices(); return }
        setErrorMsg(error.message ?? 'Scan failed.'); setScanState('error'); return
      }
      if (!device) return
      handleDiscoveredDevice(device)
    })
    scanTimeoutRef.current = setTimeout(() => {
      bleManager.stopDeviceScan()
      setScanState((prev) => {
        if (prev === 'scanning') {
          setErrorMsg('No FallGuardNano found. Make sure the sensor is powered on and nearby.')
          return 'error'
        }
        return prev
      })
    }, 10_000)
  }

  const beginScanAllDevices = () => {
    bleManager.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
      if (error) { bleManager.stopDeviceScan(); setErrorMsg(error.message ?? 'Scan failed.'); setScanState('error'); return }
      if (!device) return
      const name = device.name ?? device.localName ?? ''
      if (!name.toLowerCase().includes('fallguard') && !name.toLowerCase().includes('patient')) return
      handleDiscoveredDevice(device)
    })
  }

  const handleDiscoveredDevice = (device: Device) => {
    const name = device.name ?? device.localName ?? 'FallGuardNano'
    const scanned: ScannedDevice = { id: device.id, name, rssi: device.rssi ?? -90, rawDevice: device }
    discoveredRef.current.set(device.id, scanned)
    setDevices(Array.from(discoveredRef.current.values()))
    setScanState('found')
  }

  const connectToDevice = async (scanned: ScannedDevice) => {
    bleManager.stopDeviceScan()
    if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current)
    setConnecting(true); setSelectedId(scanned.id); setErrorMsg('')
    try {
      const device = await bleManager.connectToDevice(scanned.id, { autoConnect: false, timeout: 10000 })
      await device.discoverAllServicesAndCharacteristics()
      connectedDeviceRef.current = device
      device.onDisconnected(() => {
        connectedDeviceRef.current = null
        setTimeout(() => {
          if (!connectedDeviceRef.current) {
            Alert.alert('Sensor Disconnected', 'FallGuardNano disconnected. Please reconnect.', [{ text: 'OK' }])
            setScanState('idle')
            setSelectedId(null)
          }
        }, 3000)
      })
      setConnecting(false); setScanState('connected'); setArduinoConnected(device.id)
    } catch (err: any) {
      setConnecting(false); setSelectedId(null)
      const msg = err?.message ?? 'Connection failed.'
      setErrorMsg(msg.includes('already') ? 'Already connected — tap the device to retry.' : msg)
    }
  }

  return (
    <View style={[styles.safe, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.container}>
        <ProgressBar total={5} current={3} />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <BackButton onPress={() => router.back()} />
          <StepTag current={3} total={5} />
          <Headline>{'Sync your\nArduino.'}</Headline>
          <Subline>Make sure your FallGuardNano is powered on and within 1 metre of your phone.</Subline>

          <PulseRing scanning={scanState === 'scanning'} />

          {scanState === 'idle' && (
            <TouchableOpacity style={styles.scanBtn} onPress={startScan} activeOpacity={0.8}>
              <Text style={styles.scanBtnLabel}>Start Scanning</Text>
            </TouchableOpacity>
          )}

          {scanState === 'scanning' && (
            <View style={styles.scanningRow}>
              <ActivityIndicator color={colors.ink} size="small" />
              <Text style={styles.scanningText}>Searching for FallGuardNano…</Text>
            </View>
          )}

          {(scanState === 'found' || scanState === 'connected') && (
            <>
              <Text style={styles.devicesLabel}>Nearby Devices</Text>
              {devices.map((d) => (
                <DeviceRow key={d.id} device={d} selected={selectedId === d.id} onSelect={() => !connecting && connectToDevice(d)} />
              ))}
              {connecting && (
                <View style={styles.connectingRow}>
                  <ActivityIndicator color={colors.ink} size="small" />
                  <Text style={styles.connectingText}>Connecting to FallGuardNano…</Text>
                </View>
              )}
              {!!errorMsg && <Text style={styles.inlineError}>{errorMsg}</Text>}
              {scanState === 'connected' && (
                <View style={styles.successBox}>
                  <Ionicons name="checkmark-circle" size={22} color={colors.ink} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.successTitle}>Device connected!</Text>
                    <Text style={styles.successSub}>{devices.find((d) => d.id === selectedId)?.name ?? 'FallGuardNano'} is ready.</Text>
                  </View>
                </View>
              )}
              <TouchableOpacity style={styles.rescanBtn} onPress={startScan} activeOpacity={0.6} disabled={connecting}>
                <Text style={styles.rescanLabel}>Scan again</Text>
              </TouchableOpacity>
            </>
          )}

          {scanState === 'error' && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{errorMsg || "Couldn't find FallGuardNano. Make sure Bluetooth is on and the sensor is nearby."}</Text>
              <TouchableOpacity style={styles.scanBtn} onPress={startScan}>
                <Text style={styles.scanBtnLabel}>Try Again</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.tipsBox}>
            <Text style={styles.tipsTitle}>Tips</Text>
            <Text style={styles.tipItem}>• Power on your Arduino Nano before scanning</Text>
            <Text style={styles.tipItem}>• Keep Bluetooth enabled on your phone</Text>
            <Text style={styles.tipItem}>• Stay within 1 metre of the sensor</Text>
            <Text style={styles.tipItem}>• The device should show as "FallGuardNano" or "PATIENT_01"</Text>
          </View>
        </ScrollView>
      </View>

      <CTAButton label="Continue" onPress={() => router.push('/(onboarding)/calibrate')} disabled={!canContinue} />
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { paddingHorizontal: 28, paddingTop: 22, paddingBottom: 24 },
  scanBtn: { alignSelf: 'center', paddingHorizontal: 28, paddingVertical: 14, backgroundColor: colors.ink, borderRadius: 14, marginBottom: 20 },
  scanBtnLabel: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 14, color: colors.bg },
  scanningRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 20 },
  scanningText: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 13, color: colors.ink, opacity: 0.5 },
  devicesLabel: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: colors.ink, opacity: 0.38, marginBottom: 10 },
  connectingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, paddingHorizontal: 4 },
  connectingText: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 13, color: colors.ink, opacity: 0.5 },
  successBox: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: 'rgba(49,55,43,0.07)', borderRadius: radius.lg, marginBottom: 10 },
  successTitle: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 14, color: colors.ink },
  successSub: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 12, color: colors.ink, opacity: 0.45, marginTop: 2 },
  rescanBtn: { alignSelf: 'flex-start', marginBottom: 20 },
  rescanLabel: { fontFamily: 'NunitoSans_700Bold', fontSize: 13, color: colors.ink, opacity: 0.35, textDecorationLine: 'underline' },
  inlineError: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 12.5, color: '#b33', opacity: 0.8, lineHeight: 18, marginBottom: 12 },
  errorBox: { gap: 14, marginBottom: 20 },
  errorText: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 13, color: colors.ink, opacity: 0.5, lineHeight: 20 },
  tipsBox: { padding: 16, backgroundColor: 'rgba(49,55,43,0.05)', borderRadius: radius.lg, gap: 6, marginTop: 8 },
  tipsTitle: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 11, color: colors.ink, opacity: 0.45, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 },
  tipItem: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 12.5, color: colors.ink, opacity: 0.45, lineHeight: 20 },
})