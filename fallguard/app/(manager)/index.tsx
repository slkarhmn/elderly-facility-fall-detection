import React, { useState, useEffect, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Alert,
} from 'react-native'
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import * as Notifications from 'expo-notifications'
import { colors, radius } from '../../constants/theme'
import { MOCK_RESIDENTS, Resident } from '../../store/managerMockData'
import { useServerWebSocket, PatientState, FallEvent } from '../../hooks/useServerWebSocket'

const SERVER_IP = ''

// Notification setup 

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

async function setupNotifications() {
  await Notifications.setNotificationChannelAsync('fall-alerts', {
    name: 'Fall Alerts',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
  })
  await Notifications.requestPermissionsAsync()
}

async function fireManagerNotification(patientId: string, room: string, type: 'fall' | 'fall_likely') {
  const title = type === 'fall' ? '🚨 Fall Detected' : '⚠️ Fall Likely'
  const body = `${patientId.replace('_', ' ')} in ${room}`
  await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: true },
    trigger: null,
  })
}

function timeAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHrs = Math.floor(diffMins / 60)
  if (diffHrs < 24) return `${diffHrs}h ago`
  return `${Math.floor(diffHrs / 24)}d ago`
}

function activityColor(state: string): string {
  switch (state) {
    case 'walking': case 'upstairs': case 'downstairs': return '#4CAF50'
    case 'idle_standing': case 'idle_sitting': return '#2196F3'
    case 'stumbling': return '#FF9800'
    case 'fall': return '#F44336'
    default: return 'rgba(49,55,43,0.25)'
  }
}

function activityLabel(state: string): string {
  return state.replace('_', ' ')
}

function severityColor(severity: 'low' | 'medium' | 'high'): string {
  return severity === 'high' ? '#F44336' : severity === 'medium' ? '#FF5722' : '#FF9800'
}

// Battery Indicator 

function BatteryDot({ level, connected }: { level: number; connected: boolean }) {
  if (!connected) return <Ionicons name="wifi-outline" size={12} color="rgba(49,55,43,0.25)" />
  const color = level < 20 ? '#F44336' : level < 40 ? '#FF9800' : '#4CAF50'
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      <Ionicons name="battery-half-outline" size={13} color={color} />
      <Text style={{ fontFamily: 'NunitoSans_700Bold', fontSize: 10, color, opacity: 0.9 }}>{level}%</Text>
    </View>
  )
}

// Resident Card 

function ResidentCard({
  resident,
  liveState,
  onPress,
}: {
  resident: Resident
  liveState: PatientState | null
  onPress: () => void
}) {
  const hasAlert = liveState?.state === 'fall' || resident.fallEvents.some(f => !f.resolved)
  const unresolvedFalls = resident.fallEvents.filter(f => !f.resolved).length

  const displayState = liveState?.state ?? resident.currentActivity
  const displayLocation = liveState?.location ?? resident.room

  return (
    <TouchableOpacity
      style={[cardStyles.card, hasAlert && cardStyles.cardAlert]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <View style={cardStyles.topRow}>
        <View style={cardStyles.avatar}>
          <Text style={cardStyles.avatarText}>
            {resident.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[cardStyles.name, hasAlert && cardStyles.nameAlert]}>{resident.name}</Text>
          <Text style={[cardStyles.meta, hasAlert && cardStyles.metaAlert]}>
            {displayLocation} · Age {resident.age}
          </Text>
        </View>
        <View style={[cardStyles.activityBadge, { backgroundColor: activityColor(displayState) + '18' }]}>
          <View style={[cardStyles.activityDot, { backgroundColor: activityColor(displayState) }]} />
          <Text style={[cardStyles.activityText, { color: activityColor(displayState) }]}>
            {activityLabel(displayState)}
          </Text>
        </View>
      </View>

      <View style={cardStyles.bottomRow}>
        <BatteryDot level={resident.deviceBattery} connected={resident.deviceConnected} />
        <Text style={[cardStyles.lastSeen, hasAlert && cardStyles.lastSeenAlert]}>
          {liveState ? 'Live' : `Seen ${timeAgo(resident.lastSeen)}`}
        </Text>
        <View style={{ flex: 1 }} />
        {resident.fallEvents.length > 0 && (
          <View style={[cardStyles.fallBadge, unresolvedFalls > 0 && cardStyles.fallBadgeUnresolved]}>
            <Ionicons name="warning-outline" size={10} color={unresolvedFalls > 0 ? '#F44336' : colors.ink} />
            <Text style={[cardStyles.fallCount, unresolvedFalls > 0 && cardStyles.fallCountUnresolved]}>
              {resident.fallEvents.length} fall{resident.fallEvents.length !== 1 ? 's' : ''}
              {unresolvedFalls > 0 ? ` · ${unresolvedFalls} open` : ''}
            </Text>
          </View>
        )}
        <Ionicons name="chevron-forward" size={14} color={colors.ink} style={{ opacity: 0.2, marginLeft: 6 }} />
      </View>
    </TouchableOpacity>
  )
}

const cardStyles = StyleSheet.create({
  card: {
    padding: 16, borderRadius: radius.lg,
    backgroundColor: 'rgba(49,55,43,0.07)',
    marginBottom: 10, borderWidth: 1.5, borderColor: 'transparent', gap: 12,
  },
  cardAlert: { backgroundColor: 'rgba(244,67,54,0.05)', borderColor: 'rgba(244,67,54,0.2)' },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarText: { fontFamily: 'NunitoSans_900Black', fontSize: 14, color: colors.bg },
  name: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 15, color: colors.ink },
  nameAlert: { color: '#c0392b' },
  meta: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 12, color: colors.ink, opacity: 0.42, marginTop: 2 },
  metaAlert: { color: '#c0392b', opacity: 0.6 },
  activityBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 20, flexShrink: 0 },
  activityDot: { width: 6, height: 6, borderRadius: 3 },
  activityText: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 10, letterSpacing: 0.3, textTransform: 'capitalize' },
  bottomRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lastSeen: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 11.5, color: colors.ink, opacity: 0.35 },
  lastSeenAlert: { color: '#c0392b', opacity: 0.5 },
  fallBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: 'rgba(49,55,43,0.08)' },
  fallBadgeUnresolved: { backgroundColor: 'rgba(244,67,54,0.1)' },
  fallCount: { fontFamily: 'NunitoSans_700Bold', fontSize: 10.5, color: colors.ink, opacity: 0.5 },
  fallCountUnresolved: { color: '#F44336', opacity: 1 },
})

// Resident Detail Modal 

function ResidentDetailModal({
  resident,
  liveState,
  onClose,
}: {
  resident: Resident | null
  liveState: PatientState | null
  onClose: () => void
}) {
  if (!resident) return null
  const unresolvedFalls = resident.fallEvents.filter(f => !f.resolved)
  const displayState = liveState?.state ?? resident.currentActivity
  const displayLocation = liveState?.location ?? resident.room

  return (
    <Modal visible={!!resident} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['bottom']}>
        <View style={detailStyles.header}>
          <TouchableOpacity onPress={onClose} style={detailStyles.closeBtn}>
            <Ionicons name="chevron-down" size={22} color={colors.ink} />
          </TouchableOpacity>
          <Text style={detailStyles.headerTitle}>Resident Profile</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={detailStyles.scroll} showsVerticalScrollIndicator={false}>
          {/* Hero */}
          <View style={detailStyles.heroCard}>
            <View style={detailStyles.heroAvatar}>
              <Text style={detailStyles.heroAvatarText}>
                {resident.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
              </Text>
            </View>
            <Text style={detailStyles.heroName}>{resident.name}</Text>
            <Text style={detailStyles.heroMeta}>{displayLocation} · Age {resident.age} · {resident.facility}</Text>
            <View style={[detailStyles.activityPill, { backgroundColor: activityColor(displayState) + '20' }]}>
              <View style={[detailStyles.activityDot, { backgroundColor: activityColor(displayState) }]} />
              <Text style={[detailStyles.activityLabel, { color: activityColor(displayState) }]}>
                {activityLabel(displayState)}
              </Text>
            </View>
            {liveState && (
              <Text style={detailStyles.liveTag}>● LIVE</Text>
            )}
          </View>

          {unresolvedFalls.length > 0 && (
            <View style={detailStyles.alertBanner}>
              <Ionicons name="alert-circle" size={20} color="#F44336" />
              <View style={{ flex: 1 }}>
                <Text style={detailStyles.alertBannerTitle}>
                  {unresolvedFalls.length} unresolved fall event{unresolvedFalls.length > 1 ? 's' : ''}
                </Text>
                <Text style={detailStyles.alertBannerSub}>Requires staff attention</Text>
              </View>
            </View>
          )}

          {/* Stats */}
          <View style={detailStyles.statsRow}>
            <View style={detailStyles.statBox}>
              <Text style={detailStyles.statNum}>{resident.fallEvents.length}</Text>
              <Text style={detailStyles.statLabel}>Total Falls</Text>
            </View>
            <View style={detailStyles.statDivider} />
            <View style={detailStyles.statBox}>
              <Text style={detailStyles.statNum}>{resident.deviceBattery}%</Text>
              <Text style={detailStyles.statLabel}>Battery</Text>
            </View>
            <View style={detailStyles.statDivider} />
            <View style={detailStyles.statBox}>
              <Text style={detailStyles.statNum}>{resident.contacts.length}</Text>
              <Text style={detailStyles.statLabel}>Contacts</Text>
            </View>
          </View>

          {/* Device */}
          <View style={detailStyles.section}>
            <Text style={detailStyles.sectionLabel}>Device</Text>
            <View style={detailStyles.deviceRow}>
              <View style={[detailStyles.deviceIcon, { backgroundColor: resident.deviceConnected ? 'rgba(76,175,80,0.12)' : 'rgba(49,55,43,0.07)' }]}>
                <Ionicons name="bluetooth" size={18} color={resident.deviceConnected ? '#4CAF50' : 'rgba(49,55,43,0.3)'} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={detailStyles.deviceName}>{resident.deviceId}</Text>
                <Text style={detailStyles.deviceSub}>
                  {resident.deviceConnected ? `Connected · Last seen ${timeAgo(resident.lastSeen)}` : 'Disconnected'}
                </Text>
              </View>
              {resident.deviceBattery < 20 && (
                <View style={detailStyles.lowBatteryTag}>
                  <Text style={detailStyles.lowBatteryText}>LOW BATTERY</Text>
                </View>
              )}
            </View>
          </View>

          {/* Fall history */}
          <View style={detailStyles.section}>
            <Text style={detailStyles.sectionLabel}>Fall History</Text>
            {resident.fallEvents.length === 0 ? (
              <View style={detailStyles.emptyBox}>
                <Ionicons name="checkmark-circle-outline" size={24} color={colors.ink} style={{ opacity: 0.2 }} />
                <Text style={detailStyles.emptyText}>No fall events recorded</Text>
              </View>
            ) : (
              resident.fallEvents.map(event => (
                <View key={event.id} style={detailStyles.fallRow}>
                  <View style={[detailStyles.severityDot, { backgroundColor: severityColor(event.severity) }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={detailStyles.fallLocation}>{event.location}</Text>
                    <Text style={detailStyles.fallTime}>
                      {event.timestamp.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>
                  <View style={[detailStyles.resolvedTag, event.resolved && detailStyles.resolvedTagGreen]}>
                    <Text style={[detailStyles.resolvedText, event.resolved && detailStyles.resolvedTextGreen]}>
                      {event.resolved ? 'Resolved' : 'Open'}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </View>

          {/* Contacts */}
          <View style={detailStyles.section}>
            <Text style={detailStyles.sectionLabel}>Emergency Contacts</Text>
            {resident.contacts.map(contact => (
              <View key={contact.id} style={[detailStyles.contactRow, contact.isPrimary && detailStyles.contactRowPrimary]}>
                <View style={[detailStyles.contactIcon, contact.isPrimary && detailStyles.contactIconPrimary]}>
                  <Ionicons name={contact.isPrimary ? 'person' : 'medkit-outline'} size={16} color={contact.isPrimary ? colors.bg : colors.ink} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[detailStyles.contactName, contact.isPrimary && detailStyles.contactNameLight]}>{contact.name}</Text>
                  <Text style={[detailStyles.contactRel, contact.isPrimary && detailStyles.contactRelLight]}>
                    {contact.relation} · {contact.isPrimary ? 'Primary' : 'Secondary'}
                  </Text>
                  <Text style={[detailStyles.contactPhone, contact.isPrimary && detailStyles.contactPhoneLight]}>{contact.phone}</Text>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

const detailStyles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(49,55,43,0.07)' },
  closeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 16, color: colors.ink },
  scroll: { paddingHorizontal: 22, paddingTop: 22, paddingBottom: 32, gap: 18 },
  heroCard: { alignItems: 'center', padding: 24, backgroundColor: colors.ink, borderRadius: radius.xl, gap: 6 },
  heroAvatar: { width: 64, height: 64, borderRadius: 20, backgroundColor: 'rgba(251,247,236,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  heroAvatarText: { fontFamily: 'NunitoSans_900Black', fontSize: 22, color: colors.bg },
  heroName: { fontFamily: 'NunitoSans_900Black', fontSize: 22, color: colors.bg },
  heroMeta: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 12.5, color: colors.bg, opacity: 0.45, textAlign: 'center' },
  activityPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, marginTop: 6 },
  activityDot: { width: 7, height: 7, borderRadius: 4 },
  activityLabel: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 11, textTransform: 'capitalize' },
  liveTag: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 10, color: '#4CAF50', letterSpacing: 1, marginTop: 4 },
  alertBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: 'rgba(244,67,54,0.08)', borderRadius: radius.lg, borderWidth: 1, borderColor: 'rgba(244,67,54,0.2)' },
  alertBannerTitle: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 14, color: '#c0392b' },
  alertBannerSub: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 11.5, color: '#c0392b', opacity: 0.65, marginTop: 2 },
  statsRow: { flexDirection: 'row', backgroundColor: 'rgba(49,55,43,0.06)', borderRadius: radius.lg, padding: 18 },
  statBox: { flex: 1, alignItems: 'center' },
  statNum: { fontFamily: 'NunitoSans_900Black', fontSize: 24, color: colors.ink },
  statLabel: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 11, color: colors.ink, opacity: 0.38, marginTop: 2 },
  statDivider: { width: 1, backgroundColor: 'rgba(49,55,43,0.1)', marginHorizontal: 4 },
  section: { gap: 10 },
  sectionLabel: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: colors.ink, opacity: 0.38, marginBottom: 2 },
  deviceRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  deviceIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  deviceName: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 14, color: colors.ink },
  deviceSub: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 11.5, color: colors.ink, opacity: 0.38, marginTop: 2 },
  lowBatteryTag: { paddingHorizontal: 8, paddingVertical: 4, backgroundColor: 'rgba(244,67,54,0.1)', borderRadius: 6 },
  lowBatteryText: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 9, color: '#F44336', letterSpacing: 0.5 },
  emptyBox: { alignItems: 'center', gap: 6, paddingVertical: 20 },
  emptyText: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 13, color: colors.ink, opacity: 0.3 },
  fallRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: 'rgba(49,55,43,0.05)', borderRadius: radius.md },
  severityDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  fallLocation: { fontFamily: 'NunitoSans_700Bold', fontSize: 13.5, color: colors.ink },
  fallTime: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 11.5, color: colors.ink, opacity: 0.38, marginTop: 2 },
  resolvedTag: { paddingHorizontal: 9, paddingVertical: 4, backgroundColor: 'rgba(244,67,54,0.1)', borderRadius: 8 },
  resolvedTagGreen: { backgroundColor: 'rgba(76,175,80,0.12)' },
  resolvedText: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 10, color: '#F44336' },
  resolvedTextGreen: { color: '#4CAF50' },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: 'rgba(49,55,43,0.06)', borderRadius: radius.md },
  contactRowPrimary: { backgroundColor: colors.ink },
  contactIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: 'rgba(49,55,43,0.1)', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  contactIconPrimary: { backgroundColor: 'rgba(251,247,236,0.12)' },
  contactName: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 13.5, color: colors.ink },
  contactNameLight: { color: colors.bg },
  contactRel: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 11, color: colors.ink, opacity: 0.4, marginTop: 2 },
  contactRelLight: { color: colors.bg, opacity: 0.45 },
  contactPhone: { fontFamily: 'NunitoSans_700Bold', fontSize: 12, color: colors.ink, opacity: 0.45, marginTop: 2 },
  contactPhoneLight: { color: colors.bg, opacity: 0.5 },
})

// Main Screen 

export default function ManagerResidentsScreen() {
  const insets = useSafeAreaInsets()
  const [selectedResident, setSelectedResident] = useState<Resident | null>(null)
  const [serverIp, setServerIp] = useState(SERVER_IP)

  useEffect(() => {
    AsyncStorage.getItem('server_ip').then(ip => { if (ip) setServerIp(ip) })
    setupNotifications()
  }, [])

  const handleFall = useCallback(async (event: FallEvent) => {
    await fireManagerNotification(event.patient_id, event.room, event.type)
  }, [])

  const { patients, status } = useServerWebSocket({
    serverIp,
    onFall: handleFall,
  })

  const getLiveState = (resident: Resident): PatientState | null => {
    const keys = Object.keys(patients)
    if (keys.length === 0) return null
    const idx = MOCK_RESIDENTS.findIndex(r => r.id === resident.id)
    const key = keys[idx] ?? null
    return key ? patients[key] : null
  }

  const totalAlerts = MOCK_RESIDENTS.reduce((sum, r) =>
    sum + r.fallEvents.filter(f => !f.resolved).length, 0)

  const wsStatusColor = status === 'connected' ? '#4CAF50' : status === 'connecting' ? '#FF9800' : '#F44336'
  const wsStatusLabel = status === 'connected' ? 'Live' : status === 'connecting' ? 'Connecting…' : 'Offline'

  const handleSignOut = async () => {
    Alert.alert('Sign out', 'Sign out of manager mode?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out', style: 'destructive', onPress: async () => {
          await AsyncStorage.removeItem('user_role')
          router.replace('/role-select')
        }
      },
    ])
  }

  return (
    <View style={[styles.safe, { paddingTop: insets.top }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.greeting}>Sunrise Care Home</Text>
            <Text style={styles.title}>Residents</Text>
          </View>
          <View style={styles.headerRight}>
            <View style={[styles.wsChip, { backgroundColor: wsStatusColor + '18' }]}>
              <View style={[styles.wsDot, { backgroundColor: wsStatusColor }]} />
              <Text style={[styles.wsLabel, { color: wsStatusColor }]}>{wsStatusLabel}</Text>
            </View>
            <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
              <Ionicons name="log-out-outline" size={18} color={colors.ink} style={{ opacity: 0.45 }} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.summaryRow}>
          <View style={styles.summaryChip}>
            <Text style={styles.summaryNum}>{MOCK_RESIDENTS.length}</Text>
            <Text style={styles.summaryLabel}>Residents</Text>
          </View>
          <View style={styles.summaryChip}>
            <Text style={styles.summaryNum}>{MOCK_RESIDENTS.filter(r => r.deviceConnected).length}</Text>
            <Text style={styles.summaryLabel}>Online</Text>
          </View>
          <View style={[styles.summaryChip, totalAlerts > 0 && styles.summaryChipAlert]}>
            <Text style={[styles.summaryNum, totalAlerts > 0 && styles.summaryNumAlert]}>{totalAlerts}</Text>
            <Text style={[styles.summaryLabel, totalAlerts > 0 && styles.summaryLabelAlert]}>Open Alerts</Text>
          </View>
        </View>

        <Text style={styles.listLabel}>All Residents</Text>
        {MOCK_RESIDENTS.map(r => (
          <ResidentCard
            key={r.id}
            resident={r}
            liveState={getLiveState(r)}
            onPress={() => setSelectedResident(r)}
          />
        ))}
      </ScrollView>

      <ResidentDetailModal
        resident={selectedResident}
        liveState={selectedResident ? getLiveState(selectedResident) : null}
        onClose={() => setSelectedResident(null)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 22, paddingTop: 20 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, paddingTop: 12 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  greeting: { fontFamily: 'NunitoSans_700Bold', fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: colors.ink, opacity: 0.35, marginBottom: 3 },
  title: { fontFamily: 'NunitoSans_900Black', fontSize: 28, color: colors.ink, letterSpacing: -0.5 },
  wsChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 },
  wsDot: { width: 6, height: 6, borderRadius: 3 },
  wsLabel: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 10 },
  signOutBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(49,55,43,0.07)', alignItems: 'center', justifyContent: 'center' },
  summaryRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  summaryChip: { flex: 1, backgroundColor: 'rgba(49,55,43,0.07)', borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', gap: 2 },
  summaryChipAlert: { backgroundColor: 'rgba(244,67,54,0.08)', borderWidth: 1, borderColor: 'rgba(244,67,54,0.2)' },
  summaryNum: { fontFamily: 'NunitoSans_900Black', fontSize: 22, color: colors.ink },
  summaryNumAlert: { color: '#F44336' },
  summaryLabel: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 10, color: colors.ink, opacity: 0.38 },
  summaryLabelAlert: { color: '#F44336', opacity: 0.7 },
  listLabel: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: colors.ink, opacity: 0.35, marginBottom: 12 },
})