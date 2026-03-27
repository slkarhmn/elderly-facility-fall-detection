import React, { useState } from 'react'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, KeyboardAvoidingView, Platform, TouchableWithoutFeedback, Keyboard } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { colors, radius } from '../../constants/theme'
import { ProgressBar, StepTag, Headline, Subline, UnderlineInput, CTAButton, BackButton } from '../../components/OnboardingUI'
import { useOnboardingStore } from '../../store/onboardingStore'
import { Ionicons } from '@expo/vector-icons'

const FACILITIES = [
  { id: 'sunrise',   name: 'Sunrise Care Home',    location: 'Bandar Utama, Selangor' },
  { id: 'greenview', name: 'Greenview Residence',   location: 'Petaling Jaya, Selangor' },
  { id: 'harmony',   name: 'Harmony Senior Living', location: 'Shah Alam, Selangor' },
  { id: 'meadows',   name: 'The Meadows',           location: 'Subang Jaya, Selangor' },
]

// Shape stored in AsyncStorage under 'registered_residents'
export type LocalResident = {
  id: string          // e.g. "PATIENT_01"
  name: string
  age: string
  room: string
  facility: string
  arduinoId: string | null
  registeredAt: string // ISO date string
  contacts: {
    name: string
    phone: string
    relation: string
    isPrimary: boolean
  }[]
}

function FacilityOption({ facility, selected, onSelect }: { facility: typeof FACILITIES[0]; selected: boolean; onSelect: () => void }) {
  return (
    <TouchableOpacity style={[optStyles.pill, selected && optStyles.pillSelected]} onPress={onSelect} activeOpacity={0.75}>
      <View style={[optStyles.icon, selected && optStyles.iconSelected]}>
        <Ionicons name="business-outline" size={20} color={selected ? '#FBF7EC' : '#31372B'} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[optStyles.name, selected && optStyles.nameSelected]}>{facility.name}</Text>
        <Text style={[optStyles.loc, selected && optStyles.locSelected]}>{facility.location}</Text>
      </View>
      <View style={[optStyles.radio, selected && optStyles.radioSelected]}>
        {selected && <View style={optStyles.radioDot} />}
      </View>
    </TouchableOpacity>
  )
}

const optStyles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: radius.lg, backgroundColor: 'rgba(49,55,43,0.07)', marginBottom: 10, borderWidth: 1.5, borderColor: 'transparent' },
  pillSelected: { backgroundColor: colors.ink, borderColor: colors.ink },
  icon: { width: 42, height: 42, borderRadius: 14, backgroundColor: 'rgba(49,55,43,0.1)', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  iconSelected: { backgroundColor: 'rgba(251,247,236,0.1)' },
  name: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 14, color: colors.ink },
  nameSelected: { color: colors.bg },
  loc: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 11.5, color: colors.ink, opacity: 0.42, marginTop: 2 },
  locSelected: { color: colors.bg, opacity: 0.45 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: 'rgba(49,55,43,0.25)', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  radioSelected: { borderColor: colors.bg },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.bg },
})

async function saveResidentLocally(resident: LocalResident) {
  try {
    const raw = await AsyncStorage.getItem('registered_residents')
    const existing: LocalResident[] = raw ? JSON.parse(raw) : []
    // Replace if same id already exists, otherwise append
    const updated = existing.filter(r => r.id !== resident.id)
    updated.push(resident)
    await AsyncStorage.setItem('registered_residents', JSON.stringify(updated))
  } catch (e) {
    console.warn('Failed to save resident locally', e)
  }
}

async function sendRegistrationToServer(payload: object, serverIp: string, port: string) {
  return new Promise<void>((resolve) => {
    if (!serverIp) { resolve(); return }
    try {
      const ws = new WebSocket(`ws://${serverIp}:${port}`)
      const timer = setTimeout(() => { ws.close(); resolve() }, 5000)
      ws.onopen = () => {
        ws.send(JSON.stringify(payload))
        clearTimeout(timer)
        setTimeout(() => { ws.close(); resolve() }, 500)
      }
      ws.onerror = () => { clearTimeout(timer); resolve() }
    } catch { resolve() }
  })
}

export default function StepFacility() {
  const insets = useSafeAreaInsets()
  const { name, age, setFacility, contacts, arduinoDeviceId } = useOnboardingStore()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [room, setRoom] = useState('')
  const [loading, setLoading] = useState(false)

  const selectedFacility = FACILITIES.find((f) => f.id === selectedId)
  const canContinue = !!selectedFacility && room.trim().length > 0

  const handleComplete = async () => {
    if (!selectedFacility || !room.trim()) return
    setLoading(true)
    setFacility(selectedFacility.name, selectedFacility.location, room.trim())

    try {
      await AsyncStorage.setItem('onboarding_complete', 'true')
      await AsyncStorage.setItem('user_data', JSON.stringify({
        name, facility: selectedFacility.name, room: room.trim(),
        arduinoId: arduinoDeviceId, contactCount: contacts.length,
      }))

      const patientId = 'PATIENT_01' // matches Arduino DEVICE_NAME

      // ── Save resident locally so manager can see them without a server ──
      const localResident: LocalResident = {
        id: patientId,
        name,
        age,
        room: room.trim(),
        facility: selectedFacility.name,
        arduinoId: arduinoDeviceId,
        registeredAt: new Date().toISOString(),
        contacts: contacts.map(c => ({
          name: c.name,
          phone: c.phone,
          relation: c.relation,
          isPrimary: c.isPrimary,
        })),
      }
      await saveResidentLocally(localResident)

      // ── Also try to register with server over WebSocket ──
      const serverIp = await AsyncStorage.getItem('server_ip') ?? ''
      const serverPort = await AsyncStorage.getItem('server_port') ?? '5001'

      if (serverIp) {
        await sendRegistrationToServer({
          type: 'register',
          patient_id: patientId,
          name,
          age,
          room: room.trim(),
          facility: selectedFacility.name,
          contacts: localResident.contacts,
        }, serverIp, serverPort)
      }
    } catch (e) {
      console.warn('Onboarding completion error', e)
    }

    setLoading(false)
    router.replace('/(tabs)')
  }

  return (
    <View style={[styles.safe, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.container}>
            <ProgressBar total={5} current={5} />
            <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <BackButton onPress={() => router.back()} />
              <StepTag current={5} total={5} />
              <Headline>{'Where are\nyou staying?'}</Headline>
              <Subline>Choose your care facility and enter your room number so staff can find you quickly.</Subline>

              {FACILITIES.map((f) => (
                <FacilityOption key={f.id} facility={f} selected={selectedId === f.id} onSelect={() => setSelectedId(f.id)} />
              ))}

              <View style={{ height: 20 }} />

              <UnderlineInput
                label="Room Number" placeholder="e.g. Room 13" value={room} onChangeText={setRoom}
                autoCapitalize="characters" returnKeyType="done" onSubmitEditing={handleComplete}
                hint="e.g. Room 13, Ward B, Unit 4A"
              />

              {canContinue && (
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryTitle}>All set, {name}! 🎉</Text>
                  <Text style={styles.summarySub}>{selectedFacility?.name} · {room}</Text>
                  <Text style={styles.summarySub2}>{contacts.length} emergency contact{contacts.length !== 1 ? 's' : ''} · Device synced</Text>
                </View>
              )}
            </ScrollView>

            <CTAButton label={loading ? 'Setting up...' : 'Finish Setup'} onPress={handleComplete} disabled={!canContinue || loading} />
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: 28, paddingTop: 22, paddingBottom: 120 },
  summaryCard: { padding: 18, backgroundColor: colors.ink, borderRadius: radius.lg, marginTop: 8, gap: 4 },
  summaryTitle: { fontFamily: 'NunitoSans_900Black', fontSize: 17, color: colors.bg, marginBottom: 4 },
  summarySub: { fontFamily: 'NunitoSans_700Bold', fontSize: 13, color: colors.bg, opacity: 0.65 },
  summarySub2: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 12, color: colors.bg, opacity: 0.4 },
})