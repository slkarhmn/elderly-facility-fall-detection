import { useEffect, useRef, useState, useCallback } from 'react'

export type EmergencyContact = {
  id: string
  name: string
  relation: string
  phone: string
  isPrimary: boolean
}

export type PatientProfile = {
  name: string
  age?: string
  room: string
  facility: string
  contacts: EmergencyContact[]
}

export type PatientState = {
  location: string | null
  state: string
  state_index: number | null
  rooms: Record<string, number>
  profile?: PatientProfile
}

export type FallEvent = {
  type: 'fall' | 'fall_likely'
  patient_id: string
  room: string
  timestamp: Date
}

/** Server sends flat `name` / `contacts` from the registry; app UI uses nested `profile`. */
function profileFromServerPayload(
  raw: Record<string, unknown>,
  prev?: PatientState,
  locationHint?: string | null,
): PatientProfile | undefined {
  if (raw.profile && typeof raw.profile === 'object') return raw.profile as PatientProfile
  const name = raw.name as string | undefined
  const contacts = (raw.contacts as PatientProfile['contacts']) ?? []
  const hasMeaningfulRegistry =
    (name != null && name !== 'Unknown') || contacts.length > 0
  if (!hasMeaningfulRegistry) return prev?.profile
  return {
    name: name ?? prev?.profile?.name ?? 'Unknown',
    room: String(raw.room ?? locationHint ?? prev?.profile?.room ?? ''),
    facility: String(raw.facility ?? prev?.profile?.facility ?? ''),
    contacts: contacts.length ? contacts : (prev?.profile?.contacts ?? []),
  }
}

function rowToPatientState(raw: Record<string, unknown>): PatientState {
  const location = (raw.location as string | null | undefined) ?? null
  return {
    location,
    state: String(raw.state ?? 'unknown'),
    state_index: typeof raw.state_index === 'number' ? raw.state_index : null,
    rooms: (raw.rooms as Record<string, number>) ?? {},
    profile: profileFromServerPayload(raw, undefined, location),
  }
}

type ServerMessage =
  | { type: 'snapshot'; patients: Record<string, unknown> }
  | { type: 'fall' | 'fall_likely'; patient_id: string; room: string; profile?: PatientProfile; name?: string; contacts?: EmergencyContact[] }
  | { type: 'state_change' | 'heartbeat'; patient_id: string; room: string; rssi: number; state_index: number; state: string; location: string; profile?: PatientProfile; name?: string; contacts?: EmergencyContact[] }
  | { type: 'registered'; patient_id: string }
  | { type: 'profile_update'; patient_id: string; profile: PatientProfile }

type RegistrationPayload = {
  patient_id: string
  name: string
  room: string
  facility: string
  contacts: EmergencyContact[]
}

type Options = {
  serverIp: string
  port?: number
  onFall?: (event: FallEvent) => void
}

export type WSStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

export function useServerWebSocket({ serverIp, port = 5001, onFall }: Options) {
  const [patients, setPatients] = useState<Record<string, PatientState>>({})
  const [status, setStatus] = useState<WSStatus>('disconnected')
  const [recentFalls, setRecentFalls] = useState<FallEvent[]>([])
  const [lastMessageType, setLastMessageType] = useState<string | null>(null)
  const [lastMessageAt, setLastMessageAt] = useState<Date | null>(null)
  const [lastSnapshotCount, setLastSnapshotCount] = useState<number | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onFallRef = useRef(onFall)
  onFallRef.current = onFall

  const connect = useCallback(() => {
    if (!serverIp) { setStatus('disconnected'); return }
    if (wsRef.current) wsRef.current.close()

    setStatus('connecting')
    const ws = new WebSocket(`ws://${serverIp}:${port}`)
    wsRef.current = ws

    ws.onopen = () => {
      setStatus('connected')
      setLastError(null)
      if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null }
    }

    ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data)
        setLastMessageType(msg.type)
        setLastMessageAt(new Date())

        if (msg.type === 'snapshot') {
          const next: Record<string, PatientState> = {}
          for (const [id, row] of Object.entries(msg.patients)) {
            next[id] = rowToPatientState(row as Record<string, unknown>)
          }
          setLastSnapshotCount(Object.keys(msg.patients).length)
          setPatients(next)

        } else if (msg.type === 'fall' || msg.type === 'fall_likely') {
          const fallEvent: FallEvent = {
            type: msg.type, patient_id: msg.patient_id, room: msg.room, timestamp: new Date(),
          }
          setRecentFalls(prev => [fallEvent, ...prev].slice(0, 50))
          onFallRef.current?.(fallEvent)

        } else if (msg.type === 'state_change' || msg.type === 'heartbeat') {
          setPatients(prev => {
            const prior = prev[msg.patient_id]
            const flat = msg as Record<string, unknown>
            const profile =
              msg.profile ??
              profileFromServerPayload(flat, prior, msg.location) ??
              prior?.profile
            return {
              ...prev,
              [msg.patient_id]: {
                location: msg.location,
                state: msg.state,
                state_index: msg.state_index,
                rooms: { ...(prior?.rooms ?? {}), [msg.room]: msg.rssi },
                profile,
              },
            }
          })

        } else if (msg.type === 'profile_update') {
          setPatients(prev => ({
            ...prev,
            [msg.patient_id]: {
              location: prev[msg.patient_id]?.location ?? msg.profile.room,
              state: prev[msg.patient_id]?.state ?? 'offline',
              state_index: prev[msg.patient_id]?.state_index ?? null,
              rooms: prev[msg.patient_id]?.rooms ?? {},
              profile: msg.profile,
            },
          }))

        } else if (msg.type === 'registered') {
          console.log('[WS] Registration confirmed for', msg.patient_id)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setLastError('Failed to parse WS message: ' + message)
        console.warn('[WS] Failed to parse message:', event.data)
      }
    }

    ws.onerror = () => {
      setLastError('WebSocket error')
      setStatus('error')
    }

    ws.onclose = () => {
      setStatus('disconnected')
      if (!serverIp) return
      reconnectTimer.current = setTimeout(() => connect(), 3000)
    }
  }, [serverIp, port])

  useEffect(() => {
    connect()
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  const sendRegistration = useCallback((payload: RegistrationPayload) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[WS] Cannot register — WebSocket not connected')
      return
    }
    ws.send(JSON.stringify({ type: 'register', ...payload }))
    console.log('[WS] Registration sent for', payload.patient_id)
  }, [])

  const disconnect = useCallback(() => {
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    wsRef.current?.close()
    setStatus('disconnected')
  }, [])

  return {
    patients,
    status,
    recentFalls,
    lastMessageType,
    lastMessageAt,
    lastSnapshotCount,
    lastError,
    reconnect: connect,
    disconnect,
    sendRegistration,
  }
}