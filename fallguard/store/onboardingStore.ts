import { create } from 'zustand'

export interface EmergencyContact {
  id: string
  name: string
  relation: string
  phone: string
  isPrimary: boolean
}

interface OnboardingStore {
  // Step 1 — Profile
  name: string
  age: string
  // Step 2 — Emergency Contacts
  contacts: EmergencyContact[]
  // Step 3 — Arduino Sync
  arduinoConnected: boolean
  arduinoDeviceId: string | null
  // Step 5 — Facility
  facilityName: string
  facilityLocation: string
  roomNumber: string

  // Actions
  setProfile: (name: string, age: string) => void
  addContact: (contact: EmergencyContact) => void
  removeContact: (id: string) => void
  setArduinoConnected: (id: string) => void
  setFacility: (name: string, location: string, room: string) => void
}

export const useOnboardingStore = create<OnboardingStore>((set) => ({
  name: '',
  age: '',
  contacts: [],
  arduinoConnected: false,
  arduinoDeviceId: null,
  facilityName: '',
  facilityLocation: '',
  roomNumber: '',

  setProfile: (name, age) => set({ name, age }),

  addContact: (contact) =>
    set((state) => ({ contacts: [...state.contacts, contact] })),

  removeContact: (id) =>
    set((state) => ({ contacts: state.contacts.filter((c) => c.id !== id) })),

  setArduinoConnected: (id) =>
    set({ arduinoConnected: true, arduinoDeviceId: id }),

  setFacility: (name, location, room) =>
    set({ facilityName: name, facilityLocation: location, roomNumber: room }),
}))