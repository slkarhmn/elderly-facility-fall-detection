import React, { useState, useEffect, useCallback } from 'react'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Alert, Linking } from 'react-native'
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import * as Notifications from 'expo-notifications'
import { colors, radius } from '../../constants/theme'
import { useServerWebSocket, PatientState, FallEvent } from '../../hooks/useServerWebSocket'
import { LocalResident } from '../(onboarding)/facility'
import { CollapsibleSection } from '../../components/ui/collapsible-section'

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

async function fireManagerNotification(patientId: string, room: string, type: 'fall' | 'fall_likely') {
  const title = type === 'fall' ? 'Fall Detected' : 'Fall Likely'
  const body = patientId.replace(/_/g, ' ') + ' in ' + room
  await Notifications.scheduleNotificationAsync({ content: { title, body, sound: true }, trigger: null })
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

function activityLabel(state: string): string { return state.replace(/_/g, ' ') }

// Merge a LocalResident into a PatientState shape for display
function localResidentToPatientState(r: LocalResident): PatientState {
  return {
    location: r.room,
    state: 'offline',
    state_index: null,
    rooms: {},
    profile: {
      name: r.name,
      room: r.room,
      facility: r.facility,
      contacts: r.contacts,
    },
  }
}

function PatientCard({ patientId, state, isLocal, onPress }: {
  patientId: string; state: PatientState; isLocal: boolean; onPress: () => void
}) {
  const isFall = state.state === 'fall'
  const color = activityColor(state.state)
  const displayName = state.profile?.name ?? patientId.replace(/_/g, ' ')
  const displayRoom = state.profile?.room ?? state.location ?? 'Location unknown'

  return (
    <TouchableOpacity style={[cardStyles.card, isFall && cardStyles.cardAlert]} onPress={onPress} activeOpacity={0.75}>
      <View style={cardStyles.topRow}>
        <View style={[cardStyles.avatar, isFall && cardStyles.avatarAlert]}>
          <Text style={cardStyles.avatarText}>
            {displayName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[cardStyles.name, isFall && cardStyles.nameAlert]}>{displayName}</Text>
          <Text style={[cardStyles.meta, isFall && cardStyles.metaAlert]}>{displayRoom}</Text>
        </View>
        <View style={[cardStyles.activityBadge, { backgroundColor: color + '18' }]}>
          <View style={[cardStyles.activityDot, { backgroundColor: color }]} />
          <Text style={[cardStyles.activityText, { color }]}>{activityLabel(state.state)}</Text>
        </View>
      </View>
      <View style={cardStyles.bottomRow}>
        {isLocal ? (
          <>
            <Ionicons name="cloud-offline-outline" size={11} color={colors.ink} style={{ opacity: 0.3 }} />
            <Text style={cardStyles.offlineText}>No live signal</Text>
          </>
        ) : (
          <>
            <View style={cardStyles.liveDot} />
            <Text style={cardStyles.liveText}>Live</Text>
          </>
        )}
        <View style={{ flex: 1 }} />
        {state.profile && (
          <Text style={cardStyles.profileTag}>Registered</Text>
        )}
        <Ionicons name="chevron-forward" size={14} color={colors.ink} style={{ opacity: 0.2, marginLeft: 6 }} />
      </View>
    </TouchableOpacity>
  )
}

const cardStyles = StyleSheet.create({
  card: { padding: 16, borderRadius: radius.lg, backgroundColor: 'rgba(49,55,43,0.07)', marginBottom: 10, borderWidth: 1.5, borderColor: 'transparent', gap: 12 },
  cardAlert: { backgroundColor: 'rgba(244,67,54,0.05)', borderColor: 'rgba(244,67,54,0.2)' },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarAlert: { backgroundColor: '#c0392b' },
  avatarText: { fontFamily: 'NunitoSans_900Black', fontSize: 14, color: colors.bg },
  name: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 15, color: colors.ink },
  nameAlert: { color: '#c0392b' },
  meta: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 12, color: colors.ink, opacity: 0.42, marginTop: 2 },
  metaAlert: { color: '#c0392b', opacity: 0.6 },
  activityBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 20, flexShrink: 0 },
  activityDot: { width: 6, height: 6, borderRadius: 3 },
  activityText: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 10, letterSpacing: 0.3, textTransform: 'capitalize' },
  bottomRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4CAF50' },
  liveText: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 11.5, color: '#4CAF50' },
  offlineText: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 11.5, color: colors.ink, opacity: 0.3 },
  profileTag: { fontFamily: 'NunitoSans_700Bold', fontSize: 10, color: colors.ink, opacity: 0.3, backgroundColor: 'rgba(49,55,43,0.08)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
})

function PatientDetailModal({ patientId, state, onClose }: {
  patientId: string; state: PatientState | null; onClose: () => void
}) {
  if (!patientId || !state) return null
  const displayName = state.profile?.name ?? patientId.replace(/_/g, ' ')
  const displayRoom = state.profile?.room ?? state.location ?? 'Unknown'
  const color = activityColor(state.state)
  const isFall = state.state === 'fall'

  return (
    <Modal visible={true} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['bottom']}>
        <View style={detailStyles.header}>
          <TouchableOpacity onPress={onClose} style={detailStyles.closeBtn}>
            <Ionicons name="chevron-down" size={22} color={colors.ink} />
          </TouchableOpacity>
          <Text style={detailStyles.headerTitle}>Resident Details</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={detailStyles.scroll} showsVerticalScrollIndicator={false}>
          {/* Hero */}
          <View style={[detailStyles.heroCard, isFall && detailStyles.heroCardFall]}>
            <View style={detailStyles.heroAvatar}>
              <Text style={detailStyles.heroAvatarText}>
                {displayName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
              </Text>
            </View>
            <Text style={detailStyles.heroName}>{displayName}</Text>
            <Text style={detailStyles.heroMeta}>
              {state.profile?.facility ?? 'Unknown facility'} · {displayRoom}
            </Text>
            <View style={[detailStyles.activityPill, { backgroundColor: color + '25' }]}>
              <View style={[detailStyles.activityDot, { backgroundColor: color }]} />
              <Text style={[detailStyles.activityLabel, { color }]}>{activityLabel(state.state)}</Text>
            </View>
            <Text style={detailStyles.liveTag}>● LIVE</Text>
          </View>

          {isFall && (
            <View style={detailStyles.alertBanner}>
              <Ionicons name="alert-circle" size={20} color="#F44336" />
              <View style={{ flex: 1 }}>
                <Text style={detailStyles.alertBannerTitle}>Fall detected!</Text>
                <Text style={detailStyles.alertBannerSub}>Requires immediate staff attention in {state.location ?? displayRoom}</Text>
              </View>
            </View>
          )}

          {/* Location */}
          <View style={detailStyles.section}>
            <Text style={detailStyles.sectionLabel}>Current Location</Text>
            <View style={detailStyles.locationBox}>
              <Ionicons name="location-outline" size={20} color={colors.ink} style={{ opacity: 0.5 }} />
              <Text style={detailStyles.locationText}>{state.location ?? displayRoom}</Text>
            </View>
          </View>

          {/* Room signal */}
          {Object.entries(state.rooms).length > 0 && (
            <View style={detailStyles.section}>
              <Text style={detailStyles.sectionLabel}>Signal Strength by Room</Text>
              {Object.entries(state.rooms)
                .sort(([, a], [, b]) => b - a)
                .map(([room, rssi]) => {
                  const isStrongest = room === state.location
                  const bars = rssi > -60 ? 3 : rssi > -75 ? 2 : 1
                  return (
                    <View key={room} style={[detailStyles.roomRow, isStrongest && detailStyles.roomRowActive]}>
                      <Ionicons name="business-outline" size={16} color={isStrongest ? colors.bg : colors.ink} style={{ opacity: isStrongest ? 1 : 0.5 }} />
                      <Text style={[detailStyles.roomName, isStrongest && detailStyles.roomNameActive]}>{room}</Text>
                      <View style={{ flex: 1 }} />
                      <Text style={[detailStyles.rssiText, isStrongest && detailStyles.rssiTextActive]}>
                        {'▮'.repeat(bars)}{'▯'.repeat(3 - bars)} {rssi} dBm
                      </Text>
                      {isStrongest && (
                        <View style={detailStyles.hereBadge}>
                          <Text style={detailStyles.hereText}>HERE</Text>
                        </View>
                      )}
                    </View>
                  )
                })}
            </View>
          )}

          {/* Emergency contacts */}
          {state.profile?.contacts && state.profile.contacts.length > 0 && (
            <View style={detailStyles.section}>
              <Text style={detailStyles.sectionLabel}>Emergency Contacts</Text>
              {state.profile.contacts.map((contact, i) => (
                <TouchableOpacity
                  key={i}
                  style={[detailStyles.contactRow, contact.isPrimary && detailStyles.contactRowPrimary]}
                  onPress={() => Linking.openURL('tel:' + contact.phone)}
                  activeOpacity={0.75}
                >
                  <View style={[detailStyles.contactIcon, contact.isPrimary && detailStyles.contactIconPrimary]}>
                    <Ionicons name={contact.isPrimary ? 'person' : 'medkit-outline'} size={16} color={contact.isPrimary ? colors.bg : colors.ink} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[detailStyles.contactName, contact.isPrimary && detailStyles.contactNameLight]}>{contact.name}</Text>
                    <Text style={[detailStyles.contactMeta, contact.isPrimary && detailStyles.contactMetaLight]}>
                      {contact.relation} · {contact.isPrimary ? 'Primary' : 'Secondary'}
                    </Text>
                    <Text style={[detailStyles.contactPhone, contact.isPrimary && detailStyles.contactPhoneLight]}>{contact.phone}</Text>
                  </View>
                  <Ionicons name="call-outline" size={16} color={contact.isPrimary ? colors.bg : colors.ink} style={{ opacity: 0.4 }} />
                </TouchableOpacity>
              ))}
            </View>
          )}

          {!state.profile && (
            <View style={detailStyles.unregisteredBox}>
              <Ionicons name="information-circle-outline" size={18} color={colors.ink} style={{ opacity: 0.3 }} />
              <Text style={detailStyles.unregisteredText}>This patient has not completed app registration. Only sensor data is available.</Text>
            </View>
          )}
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
  heroCard: { alignItems: 'center', padding: 28, backgroundColor: colors.ink, borderRadius: radius.xl, gap: 6 },
  heroCardFall: { backgroundColor: '#c0392b' },
  heroAvatar: { width: 64, height: 64, borderRadius: 20, backgroundColor: 'rgba(251,247,236,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
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
  section: { gap: 10 },
  sectionLabel: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: colors.ink, opacity: 0.38 },
  locationBox: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, backgroundColor: 'rgba(49,55,43,0.06)', borderRadius: radius.lg },
  locationText: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 18, color: colors.ink },
  roomRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, backgroundColor: 'rgba(49,55,43,0.05)', borderRadius: radius.md },
  roomRowActive: { backgroundColor: colors.ink },
  roomName: { fontFamily: 'NunitoSans_700Bold', fontSize: 14, color: colors.ink },
  roomNameActive: { color: colors.bg },
  rssiText: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 11, color: colors.ink, opacity: 0.4 },
  rssiTextActive: { color: colors.bg, opacity: 0.6 },
  hereBadge: { marginLeft: 6, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: 'rgba(76,175,80,0.2)', borderRadius: 6 },
  hereText: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 9, color: '#4CAF50', letterSpacing: 0.5 },
  emptyText: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 13, color: colors.ink, opacity: 0.3 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: 'rgba(49,55,43,0.06)', borderRadius: radius.lg },
  contactRowPrimary: { backgroundColor: colors.ink },
  contactIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: 'rgba(49,55,43,0.1)', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  contactIconPrimary: { backgroundColor: 'rgba(251,247,236,0.12)' },
  contactName: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 14, color: colors.ink },
  contactNameLight: { color: colors.bg },
  contactMeta: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 11.5, color: colors.ink, opacity: 0.4, marginTop: 2 },
  contactMetaLight: { color: colors.bg, opacity: 0.45 },
  contactPhone: { fontFamily: 'NunitoSans_700Bold', fontSize: 12, color: colors.ink, opacity: 0.45, marginTop: 2 },
  contactPhoneLight: { color: colors.bg, opacity: 0.5 },
  unregisteredBox: { flexDirection: 'row', gap: 10, padding: 14, backgroundColor: 'rgba(49,55,43,0.05)', borderRadius: radius.lg, alignItems: 'flex-start' },
  unregisteredText: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 13, color: colors.ink, opacity: 0.3, flex: 1, lineHeight: 19 },
})

function ManagerDashboard({ serverIp, serverPort }: { serverIp: string; serverPort: number }) {
  const insets = useSafeAreaInsets()
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null)
  const [localResidents, setLocalResidents] = useState<LocalResident[]>([])

  // Load locally registered residents from AsyncStorage
  useEffect(() => {
    async function loadLocal() {
      try {
        const raw = await AsyncStorage.getItem('registered_residents')
        if (raw) setLocalResidents(JSON.parse(raw))
      } catch (e) {
        console.warn('Failed to load local residents', e)
      }
    }
    loadLocal()
  }, [])

  const handleFall = useCallback(async (event: FallEvent) => {
    await fireManagerNotification(event.patient_id, event.room, event.type)
  }, [])

  const {
    patients,
    status,
    lastMessageType,
    lastMessageAt,
    lastSnapshotCount,
    lastError,
  } = useServerWebSocket({ serverIp, port: serverPort, onFall: handleFall })

  // Merge: live WebSocket patients take priority; local-only residents fill the gaps
  const mergedPatients: Record<string, { state: PatientState; isLocal: boolean }> = {}

  // First, add all live patients
  for (const [id, state] of Object.entries(patients)) {
    mergedPatients[id] = { state, isLocal: false }
  }

  // Then fill in locally registered residents that aren't live yet
  for (const resident of localResidents) {
    if (!mergedPatients[resident.id]) {
      mergedPatients[resident.id] = {
        state: localResidentToPatientState(resident),
        isLocal: true,
      }
    } else {
      // Live patient exists — enrich with local profile if server hasn't sent one
      const existing = mergedPatients[resident.id]
      if (!existing.state.profile) {
        mergedPatients[resident.id] = {
          ...existing,
          state: {
            ...existing.state,
            profile: {
              name: resident.name,
              room: resident.room,
              facility: resident.facility,
              contacts: resident.contacts,
            },
          },
        }
      }
    }
  }

  const patientEntries = Object.entries(mergedPatients)
  const liveCount = patientEntries.filter(([, { isLocal }]) => !isLocal).length
  const registeredCount = patientEntries.filter(([, { state }]) => !!state.profile).length
  const fallCount = patientEntries.filter(([, { state }]) => state.state === 'fall').length
  const wsStatusColor = status === 'connected' ? '#4CAF50' : status === 'connecting' ? '#FF9800' : '#F44336'
  const wsStatusLabel = status === 'connected' ? 'Live' : status === 'connecting' ? 'Connecting' : 'Offline'

  const formatMaybeTime = (d: Date | null) => {
    if (!d) return '—'
    try { return d.toLocaleTimeString() } catch { return String(d) }
  }

  const handleSignOut = async () => {
    Alert.alert('Sign out', 'Sign out of manager mode?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: async () => {
        await AsyncStorage.removeItem('user_role'); router.replace('/role-select')
      }},
    ])
  }

  const selectedEntry = selectedPatientId ? mergedPatients[selectedPatientId] ?? null : null

  return (
    <View style={[styles.safe, { paddingTop: insets.top }]}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.greeting}>Sunrise Care Home</Text>
            <Text style={styles.title}>Residents</Text>
          </View>
          <View style={styles.headerRight}>
            <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
              <Ionicons name="log-out-outline" size={18} color={colors.ink} style={{ opacity: 0.45 }} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.summaryRow}>
          <View style={styles.summaryChip}>
            <Text style={styles.summaryNum}>{patientEntries.length}</Text>
            <Text style={styles.summaryLabel}>Residents</Text>
          </View>
          <View style={styles.summaryChip}>
            <Text style={styles.summaryNum}>{liveCount}</Text>
            <Text style={styles.summaryLabel}>Live</Text>
          </View>
          <View style={[styles.summaryChip, fallCount > 0 && styles.summaryChipAlert]}>
            <Text style={[styles.summaryNum, fallCount > 0 && styles.summaryNumAlert]}>{fallCount}</Text>
            <Text style={[styles.summaryLabel, fallCount > 0 && styles.summaryLabelAlert]}>Falls</Text>
          </View>
        </View>

        <CollapsibleSection
          header={
            <View style={[styles.wsChip, { backgroundColor: wsStatusColor + '18' }]}>
              <View style={[styles.wsDot, { backgroundColor: wsStatusColor }]} />
              <Text style={[styles.wsLabel, { color: wsStatusColor }]}>{wsStatusLabel}</Text>
            </View>
          }
        >
          <View style={styles.diagCard}>
            <View style={styles.diagRow}>
              <Text style={styles.diagLabel}>WS</Text>
              <Text style={[styles.diagValue, { color: wsStatusColor }]}>{wsStatusLabel}</Text>
            </View>
            <Text style={styles.diagMono}>{serverIp}:{serverPort}</Text>
            <View style={styles.diagRow}>
              <Text style={styles.diagLabel}>Last</Text>
              <Text style={styles.diagValue}>{lastMessageType ?? '—'}</Text>
            </View>
            <Text style={styles.diagMono}>
              {formatMaybeTime(lastMessageAt)}{lastSnapshotCount != null ? ` · snapshot=${lastSnapshotCount}` : ''}
            </Text>
            {lastError ? <Text style={styles.diagError}>{lastError}</Text> : null}
          </View>
        </CollapsibleSection>

        {patientEntries.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="people-outline" size={40} color={colors.ink} style={{ opacity: 0.15 }} />
            <Text style={styles.emptyTitle}>No residents yet</Text>
            <Text style={styles.emptySub}>
              Residents will appear here once they complete the onboarding process on their device.
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.listLabel}>All Residents · {patientEntries.length}</Text>
            {patientEntries
              .sort(([, a], [, b]) => {
                if (a.state.state === 'fall') return -1
                if (b.state.state === 'fall') return 1
                if (a.state.state === 'stumbling') return -1
                if (b.state.state === 'stumbling') return 1
                if (!a.isLocal && b.isLocal) return -1
                if (a.isLocal && !b.isLocal) return 1
                return 0
              })
              .map(([patientId, { state, isLocal }]) => (
                <PatientCard
                  key={patientId}
                  patientId={patientId}
                  state={state}
                  isLocal={isLocal}
                  onPress={() => setSelectedPatientId(patientId)}
                />
              ))
            }
          </>
        )}
      </ScrollView>

      {selectedPatientId && selectedEntry && (
        <PatientDetailModal
          patientId={selectedPatientId}
          state={selectedEntry.state}
          onClose={() => setSelectedPatientId(null)}
        />
      )}
    </View>
  )
}

export default function ManagerResidentsScreen() {
  const [serverIp, setServerIp] = useState<string | null>(null)
  const [serverPort, setServerPort] = useState<number | null>(null)

  useEffect(() => {
    setupNotifications()
    Promise.all([
      AsyncStorage.getItem('server_ip'),
      AsyncStorage.getItem('server_port'),
    ]).then(([ip, port]) => {
      setServerIp(ip ?? '')
      setServerPort(port ? parseInt(port) : 5001)
    })
  }, [])

  if (serverIp === null || serverPort === null) return <View style={{ flex: 1, backgroundColor: colors.bg }} />

  return <ManagerDashboard serverIp={serverIp} serverPort={serverPort} />
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
  summaryChip: { flex: 1, backgroundColor: 'rgba(49,55,43,0.07)', borderRadius: radius.lg, paddingVertical: 14, alignItems: 'center', gap: 2 },
  summaryChipAlert: { backgroundColor: 'rgba(244,67,54,0.08)', borderWidth: 1, borderColor: 'rgba(244,67,54,0.2)' },
  summaryNum: { fontFamily: 'NunitoSans_900Black', fontSize: 22, color: colors.ink },
  summaryNumAlert: { color: '#F44336' },
  summaryLabel: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 10, color: colors.ink, opacity: 0.38 },
  summaryLabelAlert: { color: '#F44336', opacity: 0.7 },
  listLabel: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: colors.ink, opacity: 0.35, marginBottom: 12 },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { fontFamily: 'NunitoSans_900Black', fontSize: 18, color: colors.ink, opacity: 0.25 },
  emptySub: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 13, color: colors.ink, opacity: 0.2, textAlign: 'center', lineHeight: 20, maxWidth: 280 },
  diagCard: {
    backgroundColor: 'rgba(49,55,43,0.06)',
    borderRadius: radius.lg,
    padding: 14,
    marginBottom: 0,
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(49,55,43,0.08)',
  },
  diagRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  diagLabel: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: colors.ink, opacity: 0.35 },
  diagValue: { fontFamily: 'NunitoSans_900Black', fontSize: 12.5, color: colors.ink, opacity: 0.8 },
  diagMono: { fontFamily: 'NunitoSans_700Bold', fontSize: 12, color: colors.ink, opacity: 0.35 },
  diagError: { fontFamily: 'NunitoSans_700Bold', fontSize: 12, color: '#F44336', opacity: 0.9 },
})