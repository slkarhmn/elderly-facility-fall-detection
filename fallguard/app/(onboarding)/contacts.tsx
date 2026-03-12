import React, { useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native'
import { router } from 'expo-router'
import { colors, radius, spacing } from '../../constants/theme'
import {
  ProgressBar,
  StepTag,
  Headline,
  Subline,
  UnderlineInput,
  CTAButton,
  BackButton,
} from '../../components/OnboardingUI'
import { useOnboardingStore, EmergencyContact } from '../../store/onboardingStore'
import { Ionicons } from '@expo/vector-icons'

// ─── Add Contact Modal ───────────────────────────────────────────────────────

function AddContactModal({
  visible,
  onClose,
  onSave,
  isPrimary,
}: {
  visible: boolean
  onClose: () => void
  onSave: (c: EmergencyContact) => void
  isPrimary: boolean
}) {
  const [name, setName] = useState('')
  const [relation, setRelation] = useState('')
  const [phone, setPhone] = useState('')

  const handleSave = () => {
    if (!name || !phone) {
      Alert.alert('Missing info', 'Please enter at least a name and phone number.')
      return
    }
    onSave({
      id: Date.now().toString(),
      name: name.trim(),
      relation: relation.trim(),
      phone: phone.trim(),
      isPrimary,
    })
    setName('')
    setRelation('')
    setPhone('')
    onClose()
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: colors.bg }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
          <View style={modalStyles.header}>
            <Text style={modalStyles.title}>
              {isPrimary ? 'Primary Contact' : 'Add Contact'}
            </Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={modalStyles.close}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={modalStyles.body}
            keyboardShouldPersistTaps="handled"
          >
            <UnderlineInput
              label="Full Name"
              placeholder="e.g. Sarah Davies"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
            />
            <UnderlineInput
              label="Relationship"
              placeholder="e.g. Daughter, Doctor, Nurse"
              value={relation}
              onChangeText={setRelation}
              autoCapitalize="words"
            />
            <UnderlineInput
              label="Phone Number"
              placeholder="e.g. +60 12-345 6789"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />
          </ScrollView>
          <View style={modalStyles.footer}>
            <TouchableOpacity style={modalStyles.saveBtn} onPress={handleSave}>
              <Text style={modalStyles.saveBtnLabel}>Save Contact</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const modalStyles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(49,55,43,0.07)',
  },
  title: {
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 18,
    color: colors.ink,
  },
  close: {
    fontSize: 16,
    color: colors.ink,
    opacity: 0.4,
    padding: 4,
  },
  body: {
    paddingHorizontal: 28,
    paddingTop: 28,
    paddingBottom: 40,
  },
  footer: {
    paddingHorizontal: 28,
    paddingBottom: 20,
  },
  saveBtn: {
    height: 56,
    backgroundColor: colors.ink,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnLabel: {
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 15,
    color: colors.bg,
  },
})

// ─── Contact Row ─────────────────────────────────────────────────────────────

function ContactRow({
  contact,
  onRemove,
}: {
  contact: EmergencyContact
  onRemove: () => void
}) {
  return (
    <View style={[rowStyles.row, contact.isPrimary && rowStyles.rowDark]}>
      <View style={[rowStyles.icon, contact.isPrimary && rowStyles.iconDark]}>
        <Ionicons
          name={contact.isPrimary ? 'person' : 'medkit-outline'}
          size={20}
          color={contact.isPrimary ? '#FBF7EC' : '#31372B'}
        />      
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[rowStyles.name, contact.isPrimary && rowStyles.textLight]}>
          {contact.name}
        </Text>
        <Text style={[rowStyles.rel, contact.isPrimary && rowStyles.relLight]}>
          {contact.relation || 'Contact'} · {contact.isPrimary ? 'Primary' : 'Secondary'}
        </Text>
        <Text style={[rowStyles.phone, contact.isPrimary && rowStyles.phoneLight]}>
          {contact.phone}
        </Text>
      </View>
      <TouchableOpacity onPress={onRemove} style={rowStyles.removeBtn}>
        <Text style={[rowStyles.removeTxt, contact.isPrimary && { color: colors.bg }]}>✕</Text>
      </TouchableOpacity>
    </View>
  )
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(49,55,43,0.08)',
    marginBottom: 10,
  },
  rowDark: { backgroundColor: colors.ink },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: 'rgba(49,55,43,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  iconDark: { backgroundColor: 'rgba(251,247,236,0.1)' },
  emoji: { fontSize: 19 },
  name: {
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 14,
    color: colors.ink,
  },
  textLight: { color: colors.bg },
  rel: {
    fontFamily: 'NunitoSans_600SemiBold',
    fontSize: 11.5,
    color: colors.ink,
    opacity: 0.42,
    marginTop: 2,
  },
  relLight: { color: colors.bg, opacity: 0.45 },
  phone: {
    fontFamily: 'NunitoSans_700Bold',
    fontSize: 12,
    color: colors.ink,
    opacity: 0.45,
    marginTop: 2,
  },
  phoneLight: { color: colors.bg, opacity: 0.45 },
  removeBtn: { padding: 6 },
  removeTxt: {
    fontSize: 13,
    color: colors.ink,
    opacity: 0.3,
  },
})

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function StepContacts() {
  const { contacts, addContact, removeContact } = useOnboardingStore()
  const [modalVisible, setModalVisible] = useState(false)
  const [addingPrimary, setAddingPrimary] = useState(false)

  const canContinue = contacts.length > 0

  const handleAddContact = (isPrimary: boolean) => {
    setAddingPrimary(isPrimary)
    setModalVisible(true)
  }

  const handleContinue = () => {
    router.push('/(onboarding)/sync')
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <ProgressBar total={5} current={2} />

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <BackButton onPress={() => router.back()} />

          <StepTag current={2} total={5} />
          <Headline>{"Emergency\ncontacts."}</Headline>
          <Subline>Who should we call if a fall is detected?</Subline>

          {/* Existing contacts */}
          {contacts.map((c) => (
            <ContactRow
              key={c.id}
              contact={c}
              onRemove={() => removeContact(c.id)}
            />
          ))}

          {/* Add buttons */}
          {contacts.filter((c) => c.isPrimary).length === 0 && (
            <TouchableOpacity
              style={styles.addBtn}
              onPress={() => handleAddContact(true)}
              activeOpacity={0.7}
            >
              <View style={styles.addPlus}>
                <Ionicons name="add" size={18} color="#31372B" />
              </View>
              <Text style={styles.addLabel}>Add primary contact</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => handleAddContact(false)}
            activeOpacity={0.7}
          >
            <View style={styles.addPlus}>
              <Text style={styles.addPlusText}>＋</Text>
            </View>
            <Text style={styles.addLabel}>Add another contact</Text>
          </TouchableOpacity>

          {/* Info note */}
          <View style={styles.infoBox}>
            <Ionicons name="information-circle-outline" size={18} color="#31372B" style={{ opacity: 0.45 }} />
            <Text style={styles.infoText}>
              Contacts will receive an SMS and a call when a fall event is confirmed by the sensor.
            </Text>
          </View>
        </ScrollView>

        <CTAButton
          label="Save Contacts"
          onPress={handleContinue}
          disabled={!canContinue}
        />
      </View>

      <AddContactModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onSave={addContact}
        isPrimary={addingPrimary}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: {
    paddingHorizontal: 28,
    paddingTop: 22,
    paddingBottom: 120,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 15,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(49,55,43,0.18)',
    marginBottom: 10,
  },
  addPlus: {
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: 'rgba(49,55,43,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPlusText: { fontSize: 15, color: colors.ink, opacity: 0.5 },
  addLabel: {
    fontFamily: 'NunitoSans_700Bold',
    fontSize: 13,
    color: colors.ink,
    opacity: 0.35,
  },
  infoBox: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    padding: 14,
    borderRadius: radius.md,
    backgroundColor: 'rgba(49,55,43,0.05)',
    marginTop: 8,
  },
  infoIcon: { fontSize: 15, flexShrink: 0, marginTop: 1 },
  infoText: {
    fontFamily: 'NunitoSans_600SemiBold',
    fontSize: 12,
    color: colors.ink,
    opacity: 0.45,
    lineHeight: 18,
    flex: 1,
  },
})
