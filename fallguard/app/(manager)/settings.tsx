
import React from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { colors, radius } from '../../constants/theme'

function SettingsRow({
  icon,
  label,
  sub,
  onPress,
  danger,
}: {
  icon: keyof typeof Ionicons.glyphMap
  label: string
  sub?: string
  onPress?: () => void
  danger?: boolean
}) {
  return (
    <TouchableOpacity
      style={rowStyles.row}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
    >
      <View style={[rowStyles.icon, danger && rowStyles.iconDanger]}>
        <Ionicons name={icon} size={18} color={danger ? '#F44336' : colors.ink} style={{ opacity: danger ? 1 : 0.7 }} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[rowStyles.label, danger && rowStyles.labelDanger]}>{label}</Text>
        {sub && <Text style={rowStyles.sub}>{sub}</Text>}
      </View>
      {onPress && <Ionicons name="chevron-forward" size={14} color={colors.ink} style={{ opacity: 0.2 }} />}
    </TouchableOpacity>
  )
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(49,55,43,0.06)',
    borderRadius: radius.md,
    marginBottom: 8,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: 'rgba(49,55,43,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  iconDanger: { backgroundColor: 'rgba(244,67,54,0.08)' },
  label: { fontFamily: 'NunitoSans_700Bold', fontSize: 14, color: colors.ink },
  labelDanger: { color: '#F44336' },
  sub: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 11.5, color: colors.ink, opacity: 0.35, marginTop: 2 },
})

export default function ManagerSettingsScreen() {
  const insets = useSafeAreaInsets()

  const handleSignOut = () => {
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
        contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Settings</Text>

        <Text style={styles.sectionLabel}>Facility</Text>
        <SettingsRow icon="business-outline" label="Sunrise Care Home" sub="Bandar Utama, Selangor" />
        <SettingsRow icon="person-outline" label="Manager Account" sub="Passcode-protected access" />

        <Text style={[styles.sectionLabel, { marginTop: 20 }]}>App</Text>
        <SettingsRow icon="notifications-outline" label="Alert Notifications" sub="Fall events and device alerts" onPress={() => {}} />
        <SettingsRow icon="information-circle-outline" label="About FallGuard" sub="Version 1.0" />

        <Text style={[styles.sectionLabel, { marginTop: 20 }]}>Account</Text>
        <SettingsRow icon="log-out-outline" label="Sign Out" danger onPress={handleSignOut} />
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { paddingHorizontal: 22, paddingTop: 32, paddingBottom: 0 },
  title: { fontFamily: 'NunitoSans_900Black', fontSize: 28, color: colors.ink, letterSpacing: -0.5, marginBottom: 28 },
  sectionLabel: {
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 10,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: colors.ink,
    opacity: 0.35,
    marginBottom: 10,
  },
})
