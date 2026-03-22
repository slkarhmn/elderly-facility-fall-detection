
import React, { useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { router } from 'expo-router'
import { colors, radius } from '../constants/theme'
import { Ionicons } from '@expo/vector-icons'

const MANAGER_PASSCODE = '1234'

//  Passcode Modal 

function ManagerPasscodeModal({
  visible,
  onClose,
  onSuccess,
}: {
  visible: boolean
  onClose: () => void
  onSuccess: () => void
}) {
  const insets = useSafeAreaInsets()
  const [code, setCode] = useState('')
  const [shake, setShake] = useState(false)

  const handleSubmit = () => {
    if (code === MANAGER_PASSCODE) {
      setCode('')
      onSuccess()
    } else {
      setShake(true)
      setTimeout(() => setShake(false), 600)
      setCode('')
      Alert.alert('Incorrect passcode', 'Please try again or contact your administrator.')
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: colors.bg }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={[{ flex: 1, backgroundColor: colors.bg }, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          {/* Header */}
          <View style={modalStyles.header}>
            <TouchableOpacity onPress={onClose} style={modalStyles.closeBtn}>
              <Ionicons name="chevron-down" size={22} color={colors.ink} />
            </TouchableOpacity>
            <Text style={modalStyles.title}>Manager Access</Text>
            <View style={{ width: 32 }} />
          </View>

          {/* Body */}
          <View style={modalStyles.body}>
            <View style={modalStyles.lockIcon}>
              <Ionicons name="lock-closed" size={30} color={colors.bg} />
            </View>
            <Text style={modalStyles.prompt}>Enter your facility passcode</Text>
            <Text style={modalStyles.sub}>
              Contact your care facility administrator if you don't have a passcode.
            </Text>

            <TextInput
              style={[modalStyles.codeInput, shake && modalStyles.codeInputError]}
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              maxLength={6}
              secureTextEntry
              placeholder="······"
              placeholderTextColor="rgba(49,55,43,0.2)"
              autoFocus
              onSubmitEditing={handleSubmit}
            />

            <TouchableOpacity
              style={[modalStyles.confirmBtn, !code && modalStyles.confirmBtnDisabled]}
              onPress={handleSubmit}
              disabled={!code}
              activeOpacity={0.8}
            >
              <Text style={modalStyles.confirmLabel}>Confirm</Text>
            </TouchableOpacity>

            <Text style={modalStyles.hint}>Demo passcode: 1234</Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const modalStyles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(49,55,43,0.07)',
  },
  closeBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 17, color: colors.ink },
  body: { flex: 1, paddingHorizontal: 32, paddingTop: 48, alignItems: 'center' },
  lockIcon: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  prompt: {
    fontFamily: 'NunitoSans_900Black',
    fontSize: 22,
    color: colors.ink,
    textAlign: 'center',
    marginBottom: 8,
  },
  sub: {
    fontFamily: 'NunitoSans_600SemiBold',
    fontSize: 13,
    color: colors.ink,
    opacity: 0.4,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 36,
    maxWidth: 260,
  },
  codeInput: {
    width: '100%',
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(49,55,43,0.07)',
    textAlign: 'center',
    fontFamily: 'NunitoSans_900Black',
    fontSize: 28,
    color: colors.ink,
    letterSpacing: 8,
    marginBottom: 16,
  },
  codeInputError: { backgroundColor: 'rgba(200,50,50,0.08)' },
  confirmBtn: {
    width: '100%',
    height: 56,
    backgroundColor: colors.ink,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  confirmBtnDisabled: { opacity: 0.35 },
  confirmLabel: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 15, color: colors.bg },
  hint: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 12, color: colors.ink, opacity: 0.28, marginTop: 8 },
})

// ─── Role Card ────────────────────────────────────────────────────────────────

function RoleCard({
  icon,
  title,
  description,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap
  title: string
  description: string
  onPress: () => void
}) {
  return (
    <TouchableOpacity style={cardStyles.card} onPress={onPress} activeOpacity={0.75}>
      <View style={cardStyles.iconWrap}>
        <Ionicons name={icon} size={26} color={colors.bg} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={cardStyles.title}>{title}</Text>
        <Text style={cardStyles.desc}>{description}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.ink} style={{ opacity: 0.25 }} />
    </TouchableOpacity>
  )
}

const cardStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 18,
    borderRadius: radius.xl,
    backgroundColor: 'rgba(49,55,43,0.07)',
    marginBottom: 12,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  title: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 16, color: colors.ink, marginBottom: 3 },
  desc: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 12.5, color: colors.ink, opacity: 0.4, lineHeight: 18 },
})

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function RoleSelectScreen() {
  const insets = useSafeAreaInsets()
  const [passcodeVisible, setPasscodeVisible] = useState(false)

  const handleResidentPress = () => {
    router.replace('/(onboarding)/profile')
  }

  const handleManagerSuccess = async () => {
    setPasscodeVisible(false)
    await AsyncStorage.setItem('user_role', 'manager')
    router.replace('/(manager)')
  }

  return (
    <View style={[
      styles.safe,
      { paddingTop: insets.top, paddingBottom: insets.bottom + 16 },
    ]}>
      <View style={styles.container}>
        {/* Logo */}
        <View style={styles.logoWrap}>
          <View style={styles.logoIcon}>
            <Ionicons name="shield-checkmark" size={32} color={colors.bg} />
          </View>
          <Text style={styles.appName}>FallGuard</Text>
          <Text style={styles.appTagline}>Care-connected fall detection</Text>
        </View>

        <Text style={styles.sectionLabel}>Who are you?</Text>

        <RoleCard
          icon="person-outline"
          title="I'm a Resident"
          description="Set up your personal fall detection profile and connect your sensor."
          onPress={handleResidentPress}
        />
        <RoleCard
          icon="business-outline"
          title="I'm a Facility Manager"
          description="Monitor all residents, view fall history, and manage care contacts."
          onPress={() => setPasscodeVisible(true)}
        />

        <Text style={styles.footer}>
          FallGuard v1.0 · For care facilities in partnership with your provider
        </Text>
      </View>

      <ManagerPasscodeModal
        visible={passcodeVisible}
        onClose={() => setPasscodeVisible(false)}
        onSuccess={handleManagerSuccess}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, paddingHorizontal: 28, justifyContent: 'center' },
  logoWrap: { alignItems: 'center', marginBottom: 52 },
  logoIcon: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  appName: { fontFamily: 'NunitoSans_900Black', fontSize: 30, color: colors.ink, letterSpacing: -0.5 },
  appTagline: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 13, color: colors.ink, opacity: 0.35, marginTop: 4 },
  sectionLabel: {
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 10,
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    color: colors.ink,
    opacity: 0.35,
    marginBottom: 14,
  },
  footer: {
    fontFamily: 'NunitoSans_600SemiBold',
    fontSize: 11,
    color: colors.ink,
    opacity: 0.22,
    textAlign: 'center',
    marginTop: 40,
    lineHeight: 18,
  },
})
