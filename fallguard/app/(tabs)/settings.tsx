import React, { useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Alert, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { colors, radius } from '../../constants/theme'

function SectionLabel({ label }: { label: string }) {
  return <Text style={styles.sectionLabel}>{label}</Text>
}

function SettingsRow({
  icon, label, sub, onPress, danger,
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
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 14, paddingHorizontal: 16,
    backgroundColor: 'rgba(49,55,43,0.06)',
    borderRadius: radius.md, marginBottom: 8,
  },
  icon: { width: 36, height: 36, borderRadius: 11, backgroundColor: 'rgba(49,55,43,0.07)', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  iconDanger: { backgroundColor: 'rgba(244,67,54,0.08)' },
  label: { fontFamily: 'NunitoSans_700Bold', fontSize: 14, color: colors.ink },
  labelDanger: { color: '#F44336' },
  sub: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 11.5, color: colors.ink, opacity: 0.35, marginTop: 2 },
})

export default function SettingsScreen() {
  const insets = useSafeAreaInsets()
  const [serverIp, setServerIp] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    AsyncStorage.getItem('server_ip').then(ip => {
      if (ip) setServerIp(ip)
    })
  }, [])

  const handleSaveIp = async () => {
    const trimmed = serverIp.trim()
    if (!trimmed) {
      Alert.alert('Invalid IP', 'Please enter a valid server IP address.')
      return
    }
    await AsyncStorage.setItem('server_ip', trimmed)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleSignOut = () => {
    Alert.alert('Sign out', 'Reset onboarding and return to role selection?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out', style: 'destructive', onPress: async () => {
          await AsyncStorage.removeItem('onboarding_complete')
          await AsyncStorage.removeItem('user_role')
          router.replace('/role-select')
        }
      },
    ])
  }

  return (
    <View style={[styles.safe, { paddingTop: insets.top }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + 24 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title}>Settings</Text>

          <SectionLabel label="Server Connection" />
          <View style={styles.ipBox}>
            <View style={styles.ipRow}>
              <View style={styles.ipIconWrap}>
                <Ionicons name="wifi-outline" size={18} color={colors.ink} style={{ opacity: 0.7 }} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.ipLabel}>Server IP Address</Text>
                <TextInput
                  style={styles.ipInput}
                  value={serverIp}
                  onChangeText={setServerIp}
                  placeholder="e.g. 192.168.1.100"
                  placeholderTextColor="rgba(49,55,43,0.25)"
                  keyboardType="decimal-pad"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={handleSaveIp}
                />
              </View>
              <TouchableOpacity
                style={[styles.saveBtn, saved && styles.saveBtnDone]}
                onPress={handleSaveIp}
                activeOpacity={0.75}
              >
                <Text style={styles.saveBtnLabel}>{saved ? '✓' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.ipHint}>
              Enter the LAN IP of the machine running server.py. Everyone on the same WiFi network should use the same IP.
            </Text>
          </View>

          <SectionLabel label="App" />
          <SettingsRow icon="notifications-outline" label="Alert Notifications" sub="Fall events and device alerts" />
          <SettingsRow icon="information-circle-outline" label="About FallGuard" sub="Version 1.0" />

          <SectionLabel label="Account" />
          <SettingsRow icon="log-out-outline" label="Sign Out" danger onPress={handleSignOut} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { paddingHorizontal: 22, paddingTop: 32 },
  title: { fontFamily: 'NunitoSans_900Black', fontSize: 28, color: colors.ink, letterSpacing: -0.5, marginBottom: 28 },
  sectionLabel: {
    fontFamily: 'NunitoSans_800ExtraBold', fontSize: 10, letterSpacing: 2,
    textTransform: 'uppercase', color: colors.ink, opacity: 0.35, marginBottom: 10, marginTop: 8,
  },
  ipBox: {
    backgroundColor: 'rgba(49,55,43,0.06)', borderRadius: radius.md,
    padding: 14, marginBottom: 8, gap: 10,
  },
  ipRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  ipIconWrap: { width: 36, height: 36, borderRadius: 11, backgroundColor: 'rgba(49,55,43,0.07)', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  ipLabel: { fontFamily: 'NunitoSans_700Bold', fontSize: 13, color: colors.ink, marginBottom: 4 },
  ipInput: {
    fontFamily: 'NunitoSans_600SemiBold', fontSize: 14, color: colors.ink,
    borderBottomWidth: 1, borderBottomColor: 'rgba(49,55,43,0.15)',
    paddingVertical: 4,
  },
  ipHint: {
    fontFamily: 'NunitoSans_600SemiBold', fontSize: 11.5,
    color: colors.ink, opacity: 0.35, lineHeight: 17,
  },
  saveBtn: {
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: colors.ink, borderRadius: 10,
  },
  saveBtnDone: { backgroundColor: '#4CAF50' },
  saveBtnLabel: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 12, color: colors.bg },
})