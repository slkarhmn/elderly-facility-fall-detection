
export type FallEvent = {
  id: string
  timestamp: Date
  severity: 'low' | 'medium' | 'high'
  location: string
  resolved: boolean
}

export type EmergencyContact = {
  id: string
  name: string
  relation: string
  phone: string
  isPrimary: boolean
}

export type Resident = {
  id: string
  name: string
  age: number
  room: string
  facility: string
  deviceId: string
  deviceConnected: boolean
  deviceBattery: number // 0-100
  lastSeen: Date
  fallEvents: FallEvent[]
  contacts: EmergencyContact[]
  currentActivity: 'resting' | 'walking' | 'offline' | 'alert'
}

const now = new Date()
const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000)
const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000)

export const MOCK_RESIDENTS: Resident[] = [
  {
    id: 'r1',
    name: 'Margaret Davies',
    age: 74,
    room: 'Room 12',
    facility: 'Sunrise Care Home',
    deviceId: 'FG-A3F2',
    deviceConnected: true,
    deviceBattery: 82,
    lastSeen: hoursAgo(0.3),
    currentActivity: 'walking',
    fallEvents: [
      {
        id: 'fe1',
        timestamp: daysAgo(2),
        severity: 'medium',
        location: 'Bathroom',
        resolved: true,
      },
      {
        id: 'fe2',
        timestamp: daysAgo(14),
        severity: 'low',
        location: 'Corridor B',
        resolved: true,
      },
    ],
    contacts: [
      { id: 'c1', name: 'Sarah Davies', relation: 'Daughter', phone: '+60 12-345 6789', isPrimary: true },
      { id: 'c2', name: 'Dr. Lim Wei', relation: 'GP', phone: '+60 3-8888 1234', isPrimary: false },
    ],
  },
  {
    id: 'r2',
    name: 'Robert Tan',
    age: 81,
    room: 'Room 7',
    facility: 'Sunrise Care Home',
    deviceId: 'FG-B1C9',
    deviceConnected: true,
    deviceBattery: 41,
    lastSeen: hoursAgo(1.2),
    currentActivity: 'resting',
    fallEvents: [],
    contacts: [
      { id: 'c3', name: 'James Tan', relation: 'Son', phone: '+60 16-555 0001', isPrimary: true },
    ],
  },
  {
    id: 'r3',
    name: 'Lily Ong',
    age: 68,
    room: 'Room 3A',
    facility: 'Sunrise Care Home',
    deviceId: 'FG-C7D1',
    deviceConnected: false,
    deviceBattery: 5,
    lastSeen: hoursAgo(6),
    currentActivity: 'offline',
    fallEvents: [
      {
        id: 'fe3',
        timestamp: hoursAgo(5),
        severity: 'high',
        location: 'Room 3A',
        resolved: false,
      },
    ],
    contacts: [
      { id: 'c4', name: 'Mei Ong', relation: 'Sister', phone: '+60 11-222 3344', isPrimary: true },
      { id: 'c5', name: 'Nurse Station', relation: 'On-call Nurse', phone: '+60 3-1234 5678', isPrimary: false },
    ],
  },
  {
    id: 'r4',
    name: 'Ahmad Razif',
    age: 77,
    room: 'Ward B',
    facility: 'Sunrise Care Home',
    deviceId: 'FG-D9E3',
    deviceConnected: true,
    deviceBattery: 94,
    lastSeen: hoursAgo(0.1),
    currentActivity: 'walking',
    fallEvents: [
      {
        id: 'fe4',
        timestamp: daysAgo(30),
        severity: 'low',
        location: 'Garden',
        resolved: true,
      },
    ],
    contacts: [
      { id: 'c6', name: 'Farah Razif', relation: 'Daughter', phone: '+60 17-888 9900', isPrimary: true },
    ],
  },
  {
    id: 'r5',
    name: 'Susan Pillai',
    age: 72,
    room: 'Room 9',
    facility: 'Sunrise Care Home',
    deviceId: 'FG-E2F8',
    deviceConnected: true,
    deviceBattery: 67,
    lastSeen: hoursAgo(2),
    currentActivity: 'resting',
    fallEvents: [],
    contacts: [
      { id: 'c7', name: 'Raj Pillai', relation: 'Husband', phone: '+60 12-111 2233', isPrimary: true },
      { id: 'c8', name: 'Dr. Priya Nair', relation: 'Specialist', phone: '+60 3-5555 6677', isPrimary: false },
    ],
  },
]
