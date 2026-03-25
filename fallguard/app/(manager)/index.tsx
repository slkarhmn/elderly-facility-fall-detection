import React, { useState, useEffect, useCallback } from 'react'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Alert } from 'react-native'
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import * as Notifications from 'expo-notifications'
import { colors, radius } from '../../constants/theme'
import { useServerWebSocket, PatientState, FallEvent } from '../../hooks/useServerWebSocket'

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

function activityLabel(state: string): string {
  return state.replace(/_/g, ' ')
}

function PatientCard({ patientId, state, onPress }: {
  patientId: string; state: PatientState; onPress: () => void
}) {
  const isFall = state.state === 'fall'
  const color = activityColor(state.state)
  const displayName = patientId.replace(/_/g, ' ')

  return (
    <TouchableOpacity
      style={[cardStyles.card, isFall && cardStyles.cardAlert]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <View style={cardStyles.topRow}>
        <View style={[cardStyles.avatar, isFall && cardStyles.avatarAlert]}>
          <Ionicons name="person" size={20} color={colors.bg} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[cardStyles.name, isFall && cardStyles.nameAlert]}>{displayName}</Text>
          <Text style={[cardStyles.meta, isFall && cardStyles.metaAlert]}>
            {state.location ?? 'Location unknown'}
          </Text>
        </View>
        <View style={[cardStyles.activityBadge, { backgroundColor: color + '18' }]}>
          <View style={[cardStyles.activityDot, { backgroundColor: color }]} />
          <Text style={[cardStyles.activityText, { color }]}>{activityLabel(state.state)}</Text>
        </View>
      </View>

      <View style={cardStyles.bottomRow}>
        <View style={cardStyles.liveDot} />
        <Text style={cardStyles.liveText}>Live</Text>
        <View style={{ flex: 1 }} />
        {Object.keys(state.rooms).length > 1 && (
          <Text style={cardStyles.roomCount}>{Object.keys(state.rooms).length} rooms</Text>
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
  roomCount: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 11, color: colors.ink, opacity: 0.35 },
})

function PatientDetailModal({ patientId, state, onClose }: {
  patientId: string; state: PatientState | null; onClose: () => void
}) {
  if (!patientId || !state) return null
  const displayName = patientId.replace(/_/g, ' ')
  const color = activityColor(state.state)
  const isFall = state.state === 'fall'

  return (
    <Modal visible={true} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['bottom']}>
        <View style={detailStyles.header}>
          <TouchableOpacity onPress={onClose} style={detailStyles.closeBtn}>
            <Ionicons name="chevron-down" size={22} color={colors.ink} />
          </TouchableOpacity>
          <Text style={detailStyles.headerTitle}>Patient Status</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={detailStyles.scroll} showsVerticalScrollIndicator={false}>
          <View style={[detailStyles.heroCard, isFall && detailStyles.heroCardFall]}>
            <View style={detailStyles.heroAvatar}>
              <Ionicons name="person" size={28} color={colors.bg} />
            </View>
            <Text style={detailStyles.heroName}>{displayName}</Text>
            <Text style={detailStyles.heroId}>{patientId}</Text>
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
                <Text style={detailStyles.alertBannerSub}>Requires immediate staff attention</Text>
              </View>
            </View>
          )}

          <View style={detailStyles.section}>
            <Text style={detailStyles.sectionLabel}>Current Location</Text>
            <View style={detailStyles.locationBox}>
              <Ionicons name="location-outline" size={20} color={colors.ink} style={{ opacity: 0.5 }} />
              <Text style={detailStyles.locationText}>{state.location ?? 'Unknown'}</Text>
            </View>
          </View>

          <View style={detailStyles.section}>
            <Text style={detailStyles.sectionLabel}>Signal Strength by Room</Text>
            {Object.entries(state.rooms).length === 0 ? (
              <Text style={detailStyles.emptyText}>No room data available</Text>
            ) : (
              Object.entries(state.rooms)
                .sort(([, a], [, b]) => b - a)
                .map(([room, rssi]) => {
                  const isStrongest = room === state.location
                  const bars = rssi > -60 ? 3 : rssi > -75 ? 2 : 1
                  return (
                    <View key={room} style={[detailStyles.roomRow, isStrongest && detailStyles.roomRowActive]}>
                      <Ionicons
                        name="business-outline"
                        size={16}
                        color={isStrongest ? colors.bg : colors.ink}
                        style={{ opacity: isStrongest ? 1 : 0.5 }}
                      />
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
                })
            )}
          </View>

          <View style={detailStyles.section}>
            <Text style={detailStyles.sectionLabel}>Current Activity</Text>
            <View style={[detailStyles.activityBox, { borderLeftColor: color }]}>
              <Text style={[detailStyles.activityBig, { color }]}>{activityLabel(state.state)}</Text>
              <Text style={detailStyles.activitySub}>Reported by scanner in {state.location ?? 'unknown room'}</Text>
            </View>
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
  heroCard: { alignItems: 'center', padding: 28, backgroundColor: colors.ink, borderRadius: radius.xl, gap: 6 },
  heroCardFall: { backgroundColor: '#c0392b' },
  heroAvatar: { width: 64, height: 64, borderRadius: 20, backgroundColor: 'rgba(251,247,236,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  heroName: { fontFamily: 'NunitoSans_900Black', fontSize: 22, color: colors.bg },
  heroId: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 12, color: colors.bg, opacity: 0.4, letterSpacing: 1 },
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
  activityBox: { padding: 16, backgroundColor: 'rgba(49,55,43,0.05)', borderRadius: radius.lg, borderLeftWidth: 4 },
  activityBig: { fontFamily: 'NunitoSans_900Black', fontSize: 22, textTransform: 'capitalize' },
  activitySub: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 12, color: colors.ink, opacity: 0.4, marginTop: 4 },
  emptyText: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 13, color: colors.ink, opacity: 0.3 },
})

function ManagerDashboard({ serverIp }: { serverIp: string }) {
  const insets = useSafeAreaInsets()
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null)

  const handleFall = useCallback(async (event: FallEvent) => {
    await fireManagerNotification(event.patient_id, event.room, event.type)
  }, [])

  const { patients, status } = useServerWebSocket({ serverIp, onFall: handleFall })

  const patientEntries = Object.entries(patients)
  const fallCount = patientEntries.filter(([, s]) => s.state === 'fall').length

  const wsStatusColor = status === 'connected' ? '#4CAF50' : status === 'connecting' ? '#FF9800' : '#F44336'
  const wsStatusLabel = status === 'connected' ? 'Live' : status === 'connecting' ? 'Connecting' : 'Offline'

  const handleSignOut = async () => {
    Alert.alert('Sign out', 'Sign out of manager mode?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: async () => {
        await AsyncStorage.removeItem('user_role'); router.replace('/role-select')
      }},
    ])
  }

  const selectedState = selectedPatientId ? patients[selectedPatientId] ?? null : null

  return (
    <View style={[styles.safe, { paddingTop: insets.top }]}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
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
            <Text style={styles.summaryNum}>{patientEntries.length}</Text>
            <Text style={styles.summaryLabel}>Patients</Text>
          </View>
          <View style={styles.summaryChip}>
            <Text style={styles.summaryNum}>{patientEntries.filter(([, s]) => s.state !== 'unknown').length}</Text>
            <Text style={styles.summaryLabel}>Active</Text>
          </View>
          <View style={[styles.summaryChip, fallCount > 0 && styles.summaryChipAlert]}>
            <Text style={[styles.summaryNum, fallCount > 0 && styles.summaryNumAlert]}>{fallCount}</Text>
            <Text style={[styles.summaryLabel, fallCount > 0 && styles.summaryLabelAlert]}>Falls</Text>
          </View>
        </View>

        {status !== 'connected' && patientEntries.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="wifi-outline" size={40} color={colors.ink} style={{ opacity: 0.15 }} />
            <Text style={styles.emptyTitle}>No patients detected</Text>
            <Text style={styles.emptySub}>
              {status === 'connecting' ? 'Connecting to server...' : 'Enter server IP in Settings and ensure server.py is running'}
            </Text>
          </View>
        ) : patientEntries.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="people-outline" size={40} color={colors.ink} style={{ opacity: 0.15 }} />
            <Text style={styles.emptyTitle}>Waiting for patients</Text>
            <Text style={styles.emptySub}>Connected to server. No patient data yet — ensure client.py is running in each room.</Text>
          </View>
        ) : (
          <>
            <Text style={styles.listLabel}>Active Patients</Text>
            {patientEntries
              .sort(([, a], [, b]) => {
                if (a.state === 'fall') return -1
                if (b.state === 'fall') return 1
                if (a.state === 'stumbling') return -1
                if (b.state === 'stumbling') return 1
                return 0
              })
              .map(([patientId, state]) => (
                <PatientCard
                  key={patientId}
                  patientId={patientId}
                  state={state}
                  onPress={() => setSelectedPatientId(patientId)}
                />
              ))
            }
          </>
        )}
      </ScrollView>

      {selectedPatientId && selectedState && (
        <PatientDetailModal
          patientId={selectedPatientId}
          state={selectedState}
          onClose={() => setSelectedPatientId(null)}
        />
      )}
    </View>
  )
}

export default function ManagerResidentsScreen() {
  const [serverIp, setServerIp] = useState<string | null>(null)

  useEffect(() => {
    setupNotifications()
    AsyncStorage.getItem('server_ip').then(ip => setServerIp(ip ?? ''))
  }, [])

  if (serverIp === null) return <View style={{ flex: 1, backgroundColor: colors.bg }} />

  return <ManagerDashboard serverIp={serverIp} />
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
})