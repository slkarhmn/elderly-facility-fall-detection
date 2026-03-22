
import React from 'react'
import { View, Text, StyleSheet, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { colors, radius } from '../../constants/theme'
import { MOCK_RESIDENTS, FallEvent, Resident } from '../../store/managerMockData'

type FallWithResident = FallEvent & { residentName: string; room: string }

function severityColor(s: FallEvent['severity']) {
  return s === 'high' ? '#F44336' : s === 'medium' ? '#FF5722' : '#FF9800'
}
function severityLabel(s: FallEvent['severity']) {
  return s === 'high' ? 'High' : s === 'medium' ? 'Medium' : 'Low'
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

export default function ManagerAlertsScreen() {
  const insets = useSafeAreaInsets()

  const allFalls: FallWithResident[] = MOCK_RESIDENTS.flatMap((r) =>
    r.fallEvents.map((f) => ({ ...f, residentName: r.name, room: r.room }))
  ).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

  const unresolvedFalls = allFalls.filter(f => !f.resolved)
  const resolvedFalls = allFalls.filter(f => f.resolved)

  return (
    <View style={[styles.safe, { paddingTop: insets.top }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <Text style={styles.title}>Alerts</Text>
        </View>

        {unresolvedFalls.length === 0 ? (
          <View style={styles.allClearBox}>
            <Ionicons name="shield-checkmark" size={36} color={colors.ink} style={{ opacity: 0.15 }} />
            <Text style={styles.allClearTitle}>All clear</Text>
            <Text style={styles.allClearSub}>No unresolved fall events at this time</Text>
          </View>
        ) : (
          <>
            <Text style={styles.sectionLabel}>Needs Attention · {unresolvedFalls.length}</Text>
            {unresolvedFalls.map((fall) => (
              <View key={fall.id} style={[styles.fallCard, styles.fallCardOpen]}>
                <View style={[styles.severityBar, { backgroundColor: severityColor(fall.severity) }]} />
                <View style={styles.fallContent}>
                  <View style={styles.fallTopRow}>
                    <Text style={styles.fallResident}>{fall.residentName}</Text>
                    <View style={[styles.severityTag, { backgroundColor: severityColor(fall.severity) + '18' }]}>
                      <Text style={[styles.severityText, { color: severityColor(fall.severity) }]}>
                        {severityLabel(fall.severity)}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.fallLocation}>
                    <Ionicons name="location-outline" size={12} /> {fall.location} · {fall.room}
                  </Text>
                  <Text style={styles.fallTime}>{timeAgo(fall.timestamp)}</Text>
                </View>
              </View>
            ))}
          </>
        )}

        {resolvedFalls.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, { marginTop: 24 }]}>
              Recent · Resolved
            </Text>
            {resolvedFalls.map((fall) => (
              <View key={fall.id} style={[styles.fallCard, styles.fallCardResolved]}>
                <View style={styles.fallContent}>
                  <View style={styles.fallTopRow}>
                    <Text style={[styles.fallResident, styles.fallResidentResolved]}>
                      {fall.residentName}
                    </Text>
                    <View style={styles.resolvedTag}>
                      <Ionicons name="checkmark" size={10} color="#4CAF50" />
                      <Text style={styles.resolvedText}>Resolved</Text>
                    </View>
                  </View>
                  <Text style={[styles.fallLocation, { opacity: 0.35 }]}>
                    {fall.location} · {fall.room}
                  </Text>
                  <Text style={[styles.fallTime, { opacity: 0.28 }]}>{timeAgo(fall.timestamp)}</Text>
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 22, paddingTop: 20, paddingBottom: 0 },
  headerRow: { marginBottom: 24, paddingTop: 12 },
  title: { fontFamily: 'NunitoSans_900Black', fontSize: 28, color: colors.ink, letterSpacing: -0.5 },
  sectionLabel: {
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 10,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: colors.ink,
    opacity: 0.35,
    marginBottom: 10,
  },
  allClearBox: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: 8,
  },
  allClearTitle: { fontFamily: 'NunitoSans_900Black', fontSize: 20, color: colors.ink, opacity: 0.25 },
  allClearSub: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 13, color: colors.ink, opacity: 0.2, textAlign: 'center' },
  fallCard: {
    flexDirection: 'row',
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: 10,
  },
  fallCardOpen: { backgroundColor: 'rgba(244,67,54,0.05)', borderWidth: 1, borderColor: 'rgba(244,67,54,0.15)' },
  fallCardResolved: { backgroundColor: 'rgba(49,55,43,0.05)' },
  severityBar: { width: 4, borderRadius: 4, margin: 10, marginRight: 0 },
  fallContent: { flex: 1, padding: 14 },
  fallTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  fallResident: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 14.5, color: colors.ink },
  fallResidentResolved: { opacity: 0.45 },
  fallLocation: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 12, color: colors.ink, opacity: 0.45, marginBottom: 2 },
  fallTime: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 11.5, color: colors.ink, opacity: 0.3 },
  severityTag: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  severityText: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 10 },
  resolvedTag: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: 'rgba(76,175,80,0.12)', borderRadius: 8 },
  resolvedText: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 10, color: '#4CAF50' },
})
