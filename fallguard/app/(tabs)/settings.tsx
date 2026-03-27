import React, { useState, useEffect } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView, TextInput } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { colors, radius } from '../../constants/theme'

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
    <TouchableOpacity style={rowStyles.row} onPress={onPress} activeOpacity={onPress ? 0.7 : 1}>
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 16, backgroundColor: 'rgba(49,55,43,0.06)', borderRadius: radius.md, marginBottom: 8 },
  icon: { width: 36, height: 36, borderRadius: 11, backgroundColor: 'rgba(49,55,43,0.07)', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  iconDanger: { backgroundColor: 'rgba(244,67,54,0.08)' },
  label: { fontFamily: 'NunitoSans_700Bold', fontSize: 14, color: colors.ink },
  labelDanger: { color: '#F44336' },
  sub: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 11.5, color: colors.ink, opacity: 0.35, marginTop: 2 },
})

async function sendRegistrationToServer(payload: object, serverIp: string, port: string) {
  return new Promise<void>((resolve) => {
    if (!serverIp) { resolve(); return }
    try {
      const ws = new WebSocket(`ws://${serverIp}:${port}`)
      const timer = setTimeout(() => { ws.close(); resolve() }, 5000)
      ws.onopen = () => {
        ws.send(JSON.stringify(payload))
        clearTimeout(timer)
        setTimeout(() => { ws.close(); resolve() }, 800)
      }
      ws.onerror = () => { clearTimeout(timer); resolve() }
    } catch { resolve() }
  })
}

export default function ResidentSettingsScreen() {
  const insets = useSafeAreaInsets()
  const [serverIp, setServerIp] = useState('')
  const [serverPort, setServerPort] = useState('5001')
  const [saved, setSaved] = useState(false)
  const [reregistering, setReregistering] = useState(false)
  const [userData, setUserData] = useState<any>(null)

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem('server_ip'),
      AsyncStorage.getItem('server_port'),
      AsyncStorage.getItem('user_data'),
      AsyncStorage.getItem('registered_residents'),
    ]).then(([ip, port, ud, rr]) => {
      if (ip) setServerIp(ip)
      if (port) setServerPort(port)
      if (ud) setUserData(JSON.parse(ud))
    })
  }, [])

  const handleSave = async () => {
    const trimmedIp = serverIp.trim()
    const trimmedPort = serverPort.trim() || '5001'
    await Promise.all([
      AsyncStorage.setItem('server_ip', trimmedIp),
      AsyncStorage.setItem('server_port', trimmedPort),
    ])
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleReregister = async () => {
    const ip = serverIp.trim()
    if (!ip) {
      Alert.alert('No server IP', 'Enter a server IP address first.')
      return
    }
    setReregistering(true)
    try {
      const raw = await AsyncStorage.getItem('registered_residents')
      const residents = raw ? JSON.parse(raw) : []
      const resident = residents[residents.length - 1] // most recently registered
      if (!resident) {
        Alert.alert('No profile found', 'Complete onboarding first.')
        setReregistering(false)
        return
      }
      await sendRegistrationToServer({
        type: 'register',
        patient_id: resident.id,
        name: resident.name,
        age: resident.age,
        room: resident.room,
        facility: resident.facility,
        contacts: resident.contacts,
      }, ip, serverPort.trim() || '5001')
      Alert.alert('Done', `Profile sent to server at ${ip}`)
    } catch (e) {
      Alert.alert('Failed', 'Could not reach server. Check the IP and port.')
    }
    setReregistering(false)
  }

  const handleResetOnboarding = () => {
    Alert.alert('Reset onboarding', 'This will clear your profile and return to the start. Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset', style: 'destructive', onPress: async () => {
          await AsyncStorage.multiRemove(['onboarding_complete', 'user_data', 'registered_residents'])
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
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Settings</Text>

        {/* Profile summary */}
        {userData && (
          <>
            <Text style={styles.sectionLabel}>Your Profile</Text>
            <View style={styles.profileCard}>
              <View style={styles.profileAvatar}>
                <Text style={styles.profileAvatarText}>
                  {userData.name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase() ?? '?'}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.profileName}>{userData.name}</Text>
                <Text style={styles.profileMeta}>{userData.facility} · {userData.room}</Text>
              </View>
            </View>
          </>
        )}

        {/* Server connection */}
        <Text style={[styles.sectionLabel, { marginTop: 20 }]}>Server Connection</Text>
        <View style={styles.serverBox}>
          <Text style={styles.serverBoxHint}>Both phones and the laptop must be on the same WiFi network.</Text>

          <View style={styles.inputRow}>
            <Ionicons name="wifi-outline" size={16} color={colors.ink} style={{ opacity: 0.4 }} />
            <TextInput
              style={styles.textInput}
              value={serverIp}
              onChangeText={setServerIp}
              placeholder="Server IP  e.g. 192.168.1.100"
              placeholderTextColor="rgba(49,55,43,0.25)"
              keyboardType="decimal-pad"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
            />
          </View>

          <View style={styles.divider} />

          <View style={styles.inputRow}>
            <Ionicons name="git-network-outline" size={16} color={colors.ink} style={{ opacity: 0.4 }} />
            <TextInput
              style={styles.textInput}
              value={serverPort}
              onChangeText={setServerPort}
              placeholder="Port  e.g. 5001"
              placeholderTextColor="rgba(49,55,43,0.25)"
              keyboardType="number-pad"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={handleSave}
            />
          </View>

          <TouchableOpacity
            style={[styles.saveBtn, saved && styles.saveBtnDone]}
            onPress={handleSave}
            activeOpacity={0.75}
          >
            <Text style={styles.saveBtnLabel}>{saved ? '✓ Saved' : 'Save'}</Text>
          </TouchableOpacity>
        </View>

        {/* Re-register button */}
        <TouchableOpacity
          style={[styles.reregisterBtn, reregistering && { opacity: 0.5 }]}
          onPress={handleReregister}
          disabled={reregistering}
          activeOpacity={0.75}
        >
          <Ionicons name="cloud-upload-outline" size={16} color={colors.ink} style={{ opacity: 0.6 }} />
          <Text style={styles.reregisterLabel}>
            {reregistering ? 'Sending...' : 'Re-send profile to server'}
          </Text>
        </TouchableOpacity>
        <Text style={styles.reregisterHint}>Use this if you updated the server IP after onboarding.</Text>

        {/* App section */}
        <Text style={[styles.sectionLabel, { marginTop: 24 }]}>App</Text>
        <SettingsRow icon="notifications-outline" label="Alert Notifications" sub="Fall events and device alerts" onPress={() => {}} />
        <SettingsRow icon="information-circle-outline" label="About FallGuard" sub="Version 1.0" />

        {/* Danger zone */}
        <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Account</Text>
        <SettingsRow icon="refresh-outline" label="Reset Onboarding" sub="Clear profile and start over" danger onPress={handleResetOnboarding} />
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { paddingHorizontal: 22, paddingTop: 32 },
  title: { fontFamily: 'NunitoSans_900Black', fontSize: 28, color: colors.ink, letterSpacing: -0.5, marginBottom: 28 },
  sectionLabel: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: colors.ink, opacity: 0.35, marginBottom: 10 },
  profileCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, backgroundColor: colors.ink, borderRadius: radius.lg },
  profileAvatar: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(251,247,236,0.12)', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  profileAvatarText: { fontFamily: 'NunitoSans_900Black', fontSize: 15, color: colors.bg },
  profileName: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 15, color: colors.bg },
  profileMeta: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 12, color: colors.bg, opacity: 0.45, marginTop: 2 },
  serverBox: { backgroundColor: 'rgba(49,55,43,0.06)', borderRadius: radius.lg, padding: 14, gap: 0 },
  serverBoxHint: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 11.5, color: colors.ink, opacity: 0.4, marginBottom: 12, lineHeight: 17 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  textInput: { flex: 1, fontFamily: 'NunitoSans_600SemiBold', fontSize: 14, color: colors.ink, paddingVertical: 4 },
  divider: { height: 1, backgroundColor: 'rgba(49,55,43,0.08)', marginVertical: 8 },
  saveBtn: { marginTop: 12, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: colors.ink, borderRadius: 10, alignSelf: 'flex-end' },
  saveBtnDone: { backgroundColor: '#4CAF50' },
  saveBtnLabel: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 12, color: colors.bg },
  reregisterBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, padding: 14, backgroundColor: 'rgba(49,55,43,0.06)', borderRadius: radius.md },
  reregisterLabel: { fontFamily: 'NunitoSans_700Bold', fontSize: 14, color: colors.ink },
  reregisterHint: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 11, color: colors.ink, opacity: 0.3, marginTop: 6, marginLeft: 2 },
})