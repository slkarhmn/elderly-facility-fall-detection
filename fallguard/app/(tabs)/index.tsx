import React, { useEffect, useRef, useState, useCallback } from 'react'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, Animated } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import * as Notifications from 'expo-notifications'
import { colors, radius } from '../../constants/theme'
import { useOnboardingStore } from '../../store/onboardingStore'
import { useFallDetection } from '../../hooks/useFallDetection'

const AUTO_CALL_SECONDS = 30

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true, shouldPlaySound: true,
    shouldSetBadge: true, shouldShowBanner: true, shouldShowList: true,
  }),
})

async function setupNotifications() {
  await Notifications.setNotificationChannelAsync('fall-alerts', {
    name: 'Fall Alerts', importance: Notifications.AndroidImportance.MAX,
    sound: 'default', vibrationPattern: [0, 250, 250, 250],
  })
  await Notifications.requestPermissionsAsync()
}

async function fireNotification(title: string, body: string) {
  await Notifications.scheduleNotificationAsync({ content: { title, body, sound: true }, trigger: null })
}

function ActivityBadge({ state }: { state: string }) {
  const colorMap: Record<string, string> = {
    walking: '#4CAF50', upstairs: '#4CAF50', downstairs: '#4CAF50',
    stumbling: '#FF9800', idle_standing: '#2196F3', idle_sitting: '#2196F3',
    fall: '#F44336', unknown: 'rgba(49,55,43,0.25)',
  }
  const color = colorMap[state] ?? colorMap.unknown
  return (
    <View style={[badgeStyles.wrap, { backgroundColor: color + '18' }]}>
      <View style={[badgeStyles.dot, { backgroundColor: color }]} />
      <Text style={[badgeStyles.label, { color }]}>{state.replace(/_/g, ' ')}</Text>
    </View>
  )
}

const badgeStyles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  label: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 11, textTransform: 'capitalize' },
})

function StatusChip({ color, label }: { color: string; label: string }) {
  return (
    <View style={[chipStyles.wrap, { backgroundColor: color + '18' }]}>
      <View style={[chipStyles.dot, { backgroundColor: color }]} />
      <Text style={[chipStyles.label, { color }]}>{label}</Text>
    </View>
  )
}

const chipStyles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 10 },
})

function FallAlertOverlay({ visible, contactName, contactPhone, onDismiss }: {
  visible: boolean; contactName: string | null; contactPhone: string | null; onDismiss: () => void
}) {
  const [countdown, setCountdown] = useState(AUTO_CALL_SECONDS)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pulseAnim = useRef(new Animated.Value(1)).current

  useEffect(() => {
    if (!visible) {
      setCountdown(AUTO_CALL_SECONDS)
      if (intervalRef.current) clearInterval(intervalRef.current)
      pulseAnim.stopAnimation(); pulseAnim.setValue(1); return
    }
    Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1.06, duration: 600, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
    ])).start()
    setCountdown(AUTO_CALL_SECONDS)
    intervalRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(intervalRef.current!)
          if (contactPhone) Linking.openURL('tel:' + contactPhone)
          onDismiss(); return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [visible])

  if (!visible) return null

  return (
    <View style={overlayStyles.backdrop}>
      <Animated.View style={[overlayStyles.card, { transform: [{ scale: pulseAnim }] }]}>
        <View style={overlayStyles.iconWrap}><Ionicons name="warning" size={36} color="#F44336" /></View>
        <Text style={overlayStyles.title}>Fall Detected!</Text>
        <Text style={overlayStyles.sub}>{contactName ? 'Calling ' + contactName + ' in ' + countdown + 's' : 'Auto-calling in ' + countdown + 's'}</Text>
        <Text style={overlayStyles.sub2}>Tap below if you are okay</Text>
        {contactPhone && (
          <TouchableOpacity style={overlayStyles.callNowBtn} onPress={() => {
            if (intervalRef.current) clearInterval(intervalRef.current)
            Linking.openURL('tel:' + contactPhone); onDismiss()
          }}>
            <Ionicons name="call" size={18} color={colors.bg} />
            <Text style={overlayStyles.callNowLabel}>Call Now</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={overlayStyles.dismissBtn} onPress={() => {
          if (intervalRef.current) clearInterval(intervalRef.current); onDismiss()
        }}>
          <Text style={overlayStyles.dismissLabel}>I am okay - Do not call</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  )
}

const overlayStyles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 28 },
  card: { width: '100%', backgroundColor: colors.bg, borderRadius: radius.xl, padding: 28, alignItems: 'center', gap: 8 },
  iconWrap: { width: 72, height: 72, borderRadius: 22, backgroundColor: 'rgba(244,67,54,0.1)', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  title: { fontFamily: 'NunitoSans_900Black', fontSize: 26, color: '#c0392b', letterSpacing: -0.5 },
  sub: { fontFamily: 'NunitoSans_700Bold', fontSize: 15, color: colors.ink, textAlign: 'center' },
  sub2: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 13, color: colors.ink, opacity: 0.45, marginBottom: 8 },
  callNowBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, width: '100%', height: 54, backgroundColor: '#F44336', borderRadius: radius.lg, justifyContent: 'center', marginTop: 4 },
  callNowLabel: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 15, color: colors.bg },
  dismissBtn: { width: '100%', height: 54, backgroundColor: 'rgba(49,55,43,0.07)', borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  dismissLabel: { fontFamily: 'NunitoSans_700Bold', fontSize: 14, color: colors.ink },
})

function Dashboard({ serverIp }: { serverIp: string }) {
  const { name, contacts, arduinoDeviceId } = useOnboardingStore()
  const [showFallAlert, setShowFallAlert] = useState(false)
  const primaryContact = contacts.find(c => c.isPrimary) ?? null
  const patientId = 'PATIENT_01'

  const handleFall = useCallback(async () => {
    setShowFallAlert(true)
    await fireNotification('Fall Detected', 'A fall has been detected. Emergency contacts will be called in ' + AUTO_CALL_SECONDS + 's.')
  }, [])

  const { ble, wsStatus, fallDetected, activityLabel, activityIndex, room, bleReconnect } = useFallDetection({
    deviceId: arduinoDeviceId, patientId, serverIp, onFall: handleFall,
  })

  const bleColor = ble.status === 'connected' ? '#4CAF50' : ble.status === 'connecting' ? '#FF9800' : '#F44336'
  const bleLabel = ble.status === 'connected' ? 'Sensor' : ble.status === 'connecting' ? 'Connecting' : 'No Sensor'
  const wsColor = wsStatus === 'connected' ? '#4CAF50' : wsStatus === 'connecting' ? '#FF9800' : '#F44336'
  const wsLabel = wsStatus === 'connected' ? 'Network' : wsStatus === 'connecting' ? 'Connecting' : 'Offline'
  const dataSource = ble.status === 'connected' ? 'ble' : wsStatus === 'connected' ? 'ws' : 'none'

  // Sensor button label changes based on BLE state
  const sensorBtnLabel =
    ble.status === 'connecting' ? 'Connecting...' :
    ble.status === 'connected'  ? 'Re-send infer command' :
    'Reconnect Sensor'

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        <View style={styles.headerRow}>
          <View>
            <Text style={styles.greeting}>Good day,</Text>
            <Text style={styles.name}>{name || 'Resident'}</Text>
          </View>
          <View style={styles.headerChips}>
            <StatusChip color={bleColor} label={bleLabel} />
            <StatusChip color={wsColor} label={wsLabel} />
          </View>
        </View>

        <View style={[styles.statusCard, fallDetected && styles.statusCardFall]}>
          <Text style={styles.cardLabel}>Current Status</Text>
          <View style={styles.cardRow}>
            <Text style={styles.cardBig}>{activityIndex >= 0 ? activityLabel.replace(/_/g, ' ') : 'No signal'}</Text>
            {activityIndex >= 0 && <ActivityBadge state={activityLabel} />}
          </View>
          {room && (
            <View style={styles.locationRow}>
              <Ionicons name="location-outline" size={14} color={colors.bg} style={{ opacity: 0.5 }} />
              <Text style={styles.locationText}>{room}</Text>
            </View>
          )}
          {ble.status === 'connected' && ble.confidence > 0 && (
            <Text style={styles.confidenceText}>Confidence: {ble.confidence}%</Text>
          )}
          {activityIndex < 0 && (
            <Text style={styles.cardSub}>
              {ble.error
                ? `Sensor read error: ${ble.error}`
                : ble.waitingForInference
                  ? 'Sensor connected, but no inference output yet (prediction is still 255).'
                  : dataSource === 'none'
                    ? 'No sensor or network connection'
                    : 'Waiting for data...'}
            </Text>
          )}

          {/* ── Sensor button: always visible when an Arduino was paired ── */}
          {!!arduinoDeviceId && (
            <TouchableOpacity
              style={[styles.reconnectBtn, ble.status === 'connecting' && { opacity: 0.6 }]}
              onPress={bleReconnect}
              activeOpacity={0.75}
              disabled={ble.status === 'connecting'}
            >
              <Ionicons name="bluetooth-outline" size={13} color={colors.bg} />
              <Text style={styles.reconnectLabel}>{sensorBtnLabel}</Text>
            </TouchableOpacity>
          )}
        </View>

        {fallDetected && (
          <View style={styles.fallWarning}>
            <Ionicons name="alert-circle" size={20} color="#F44336" />
            <Text style={styles.fallWarningText}>Fall detected - emergency contacts have been notified.</Text>
          </View>
        )}

        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statNum}>{contacts.length}</Text>
            <Text style={styles.statLabel}>Contacts</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Text style={styles.statNum}>{arduinoDeviceId ? 'ON' : 'OFF'}</Text>
            <Text style={styles.statLabel}>Sensor</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Text style={styles.statNum}>{room ?? '-'}</Text>
            <Text style={styles.statLabel}>Room</Text>
          </View>
        </View>

        {contacts.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Emergency Contacts</Text>
            {contacts.map(c => (
              <TouchableOpacity key={c.id} style={[styles.contactRow, c.isPrimary && styles.contactRowPrimary]}
                onPress={() => Linking.openURL('tel:' + c.phone)} activeOpacity={0.75}>
                <View style={[styles.contactIcon, c.isPrimary && styles.contactIconPrimary]}>
                  <Ionicons name={c.isPrimary ? 'person' : 'medkit-outline'} size={16} color={c.isPrimary ? colors.bg : colors.ink} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.contactName, c.isPrimary && styles.contactLight]}>{c.name}</Text>
                  <Text style={[styles.contactRel, c.isPrimary && styles.contactLightSub]}>{c.relation} - {c.isPrimary ? 'Primary' : 'Secondary'}</Text>
                </View>
                <Ionicons name="call-outline" size={16} color={c.isPrimary ? colors.bg : colors.ink} style={{ opacity: 0.4 }} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {__DEV__ && (
          <TouchableOpacity onPress={async () => {
            await AsyncStorage.removeItem('onboarding_complete')
            await AsyncStorage.removeItem('user_role')
            router.replace('/role-select')
          }} style={styles.devReset}>
            <Text style={styles.devResetText}>Reset Onboarding (Dev Only)</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <FallAlertOverlay
        visible={showFallAlert}
        contactName={primaryContact?.name ?? null}
        contactPhone={primaryContact?.phone ?? null}
        onDismiss={() => setShowFallAlert(false)}
      />
    </SafeAreaView>
  )
}

export default function HomeScreen() {
  const [serverIp, setServerIp] = useState<string | null>(null)

  useEffect(() => {
    setupNotifications()
    AsyncStorage.getItem('server_ip').then(ip => setServerIp(ip ?? ''))
  }, [])

  if (serverIp === null) return <View style={{ flex: 1, backgroundColor: colors.bg }} />

  return <Dashboard serverIp={serverIp} />
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 32 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, paddingTop: 8 },
  headerChips: { flexDirection: 'column', alignItems: 'flex-end', gap: 6 },
  greeting: { fontFamily: 'NunitoSans_700Bold', fontSize: 11, color: colors.ink, opacity: 0.35, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 3 },
  name: { fontFamily: 'NunitoSans_900Black', fontSize: 28, color: colors.ink, letterSpacing: -0.5 },
  statusCard: { backgroundColor: colors.ink, borderRadius: radius.xl, padding: 24, marginBottom: 16 },
  statusCardFall: { backgroundColor: '#c0392b' },
  cardLabel: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: colors.bg, opacity: 0.4, marginBottom: 8 },
  cardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  cardBig: { fontFamily: 'NunitoSans_900Black', fontSize: 28, color: colors.bg, textTransform: 'capitalize', flex: 1 },
  cardSub: { fontFamily: 'NunitoSans_400Regular', fontSize: 13, color: colors.bg, opacity: 0.45, marginTop: 8 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  locationText: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 12, color: colors.bg, opacity: 0.5 },
  confidenceText: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 11, color: colors.bg, opacity: 0.35, marginTop: 4 },
  reconnectBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 10, alignSelf: 'flex-start' },
  reconnectLabel: { fontFamily: 'NunitoSans_700Bold', fontSize: 12, color: colors.bg },
  fallWarning: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, backgroundColor: 'rgba(244,67,54,0.08)', borderRadius: radius.lg, borderWidth: 1, borderColor: 'rgba(244,67,54,0.2)', marginBottom: 16 },
  fallWarningText: { fontFamily: 'NunitoSans_700Bold', fontSize: 13, color: '#c0392b', flex: 1, lineHeight: 19 },
  statsRow: { flexDirection: 'row', backgroundColor: 'rgba(49,55,43,0.06)', borderRadius: radius.lg, padding: 18, marginBottom: 24 },
  statBox: { flex: 1, alignItems: 'center' },
  statNum: { fontFamily: 'NunitoSans_900Black', fontSize: 20, color: colors.ink },
  statLabel: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 10, color: colors.ink, opacity: 0.38, marginTop: 2 },
  statDivider: { width: 1, backgroundColor: 'rgba(49,55,43,0.1)' },
  section: { gap: 8, marginBottom: 24 },
  sectionLabel: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: colors.ink, opacity: 0.35, marginBottom: 4 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: 'rgba(49,55,43,0.06)', borderRadius: radius.lg },
  contactRowPrimary: { backgroundColor: colors.ink },
  contactIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: 'rgba(49,55,43,0.1)', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  contactIconPrimary: { backgroundColor: 'rgba(251,247,236,0.12)' },
  contactName: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 14, color: colors.ink },
  contactLight: { color: colors.bg },
  contactRel: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 11.5, color: colors.ink, opacity: 0.4, marginTop: 2 },
  contactLightSub: { color: colors.bg, opacity: 0.45 },
  devReset: { marginTop: 8, padding: 14, backgroundColor: 'rgba(49,55,43,0.07)', borderRadius: radius.lg },
  devResetText: { fontFamily: 'NunitoSans_700Bold', fontSize: 13, color: colors.ink, opacity: 0.35, textAlign: 'center' },
})