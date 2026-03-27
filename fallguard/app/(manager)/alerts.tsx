import React, { useState, useEffect, useCallback } from 'react'
import { View, Text, StyleSheet, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Ionicons } from '@expo/vector-icons'
import { colors, radius } from '../../constants/theme'
import { useServerWebSocket, FallEvent } from '../../hooks/useServerWebSocket'

type FallWithName = FallEvent & { residentName: string }

function timeAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHrs = Math.floor(diffMins / 60)
  if (diffHrs < 24) return `${diffHrs}h ago`
  return `${Math.floor(diffHrs / 24)}d ago`
}

function severityColor(type: FallEvent['type']) {
  return type === 'fall' ? '#F44336' : '#FF9800'
}

function severityLabel(type: FallEvent['type']) {
  return type === 'fall' ? 'Fall' : 'Fall Likely'
}

function AlertCard({ event }: { event: FallWithName }) {
  const color = severityColor(event.type)
  return (
    <View style={[alertCardStyles.card, { borderLeftColor: color }]}>
      <View style={alertCardStyles.topRow}>
        <View style={[alertCardStyles.iconWrap, { backgroundColor: color + '15' }]}>
          <Ionicons name="alert-circle" size={18} color={color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={alertCardStyles.name}>{event.residentName}</Text>
          <Text style={alertCardStyles.room}>{event.room}</Text>
        </View>
        <View style={[alertCardStyles.badge, { backgroundColor: color + '15' }]}>
          <Text style={[alertCardStyles.badgeLabel, { color }]}>{severityLabel(event.type)}</Text>
        </View>
      </View>
      <Text style={alertCardStyles.time}>{timeAgo(event.timestamp)}</Text>
    </View>
  )
}

const alertCardStyles = StyleSheet.create({
  card: { padding: 14, borderRadius: radius.lg, backgroundColor: 'rgba(49,55,43,0.05)', marginBottom: 10, borderLeftWidth: 3, gap: 8 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  name: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 14, color: colors.ink },
  room: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 12, color: colors.ink, opacity: 0.45, marginTop: 1 },
  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, flexShrink: 0 },
  badgeLabel: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 10 },
  time: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 11.5, color: colors.ink, opacity: 0.3, marginLeft: 48 },
})

function AlertsContent({ serverIp, serverPort }: { serverIp: string; serverPort: number }) {
  const insets = useSafeAreaInsets()
  const { patients, recentFalls, status } = useServerWebSocket({ serverIp, port: serverPort })

  // Enrich fall events with resident names from patient profiles
  const enrichedFalls: FallWithName[] = recentFalls.map(fall => {
    const profile = patients[fall.patient_id]?.profile
    const residentName = profile?.name ?? fall.patient_id.replace(/_/g, ' ')
    return { ...fall, residentName }
  })

  const wsStatusColor = status === 'connected' ? '#4CAF50' : status === 'connecting' ? '#FF9800' : '#F44336'
  const wsStatusLabel = status === 'connected' ? 'Live' : status === 'connecting' ? 'Connecting…' : 'Offline'

  return (
    <View style={[styles.safe, { paddingTop: insets.top }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <Text style={styles.title}>Alerts</Text>
          <View style={[styles.wsChip, { backgroundColor: wsStatusColor + '18' }]}>
            <View style={[styles.wsDot, { backgroundColor: wsStatusColor }]} />
            <Text style={[styles.wsLabel, { color: wsStatusColor }]}>{wsStatusLabel}</Text>
          </View>
        </View>

        {enrichedFalls.length === 0 ? (
          <View style={styles.allClearBox}>
            <Ionicons name="shield-checkmark" size={36} color={colors.ink} style={{ opacity: 0.15 }} />
            <Text style={styles.allClearTitle}>All clear</Text>
            <Text style={styles.allClearSub}>
              {status === 'connected'
                ? 'No fall events detected during this session'
                : 'Connect to server to receive live fall alerts'}
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.sectionLabel}>This Session · {enrichedFalls.length}</Text>
            {enrichedFalls.map((fall, i) => (
              <AlertCard key={`${fall.patient_id}-${fall.timestamp.getTime()}-${i}`} event={fall} />
            ))}
          </>
        )}
      </ScrollView>
    </View>
  )
}

export default function ManagerAlertsScreen() {
  const [serverIp, setServerIp] = useState<string | null>(null)
  const [serverPort, setServerPort] = useState<number | null>(null)

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem('server_ip'),
      AsyncStorage.getItem('server_port'),
    ]).then(([ip, port]) => {
      setServerIp(ip ?? '')
      setServerPort(port ? parseInt(port) : 5001)
    })
  }, [])

  if (serverIp === null || serverPort === null) {
    return <View style={{ flex: 1, backgroundColor: colors.bg }} />
  }

  return <AlertsContent serverIp={serverIp} serverPort={serverPort} />
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 22, paddingTop: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, paddingTop: 12 },
  title: { fontFamily: 'NunitoSans_900Black', fontSize: 28, color: colors.ink, letterSpacing: -0.5 },
  wsChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 },
  wsDot: { width: 6, height: 6, borderRadius: 3 },
  wsLabel: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 10 },
  sectionLabel: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 10, letterSpacing: 2.5, textTransform: 'uppercase', color: colors.ink, opacity: 0.35, marginBottom: 14 },
  allClearBox: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  allClearTitle: { fontFamily: 'NunitoSans_900Black', fontSize: 20, color: colors.ink, opacity: 0.22 },
  allClearSub: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 13, color: colors.ink, opacity: 0.2, textAlign: 'center', lineHeight: 20, maxWidth: 260 },
})