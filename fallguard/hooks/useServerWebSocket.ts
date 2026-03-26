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

type ServerMessage =
  | { type: 'snapshot'; patients: Record<string, PatientState> }
  | { type: 'fall' | 'fall_likely'; patient_id: string; room: string }
  | { type: 'state_change' | 'heartbeat'; patient_id: string; room: string; rssi: number; state_index: number; state: string; location: string; profile?: PatientProfile }
  | { type: 'registered'; patient_id: string }

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
      if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null }
    }

    ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data)
        if (msg.type === 'snapshot') {
          setPatients(msg.patients)
        } else if (msg.type === 'fall' || msg.type === 'fall_likely') {
          const fallEvent: FallEvent = {
            type: msg.type, patient_id: msg.patient_id, room: msg.room, timestamp: new Date(),
          }
          setRecentFalls(prev => [fallEvent, ...prev].slice(0, 50))
          onFallRef.current?.(fallEvent)
        } else if (msg.type === 'state_change' || msg.type === 'heartbeat') {
          setPatients(prev => ({
            ...prev,
            [msg.patient_id]: {
              location: msg.location,
              state: msg.state,
              state_index: msg.state_index,
              rooms: { ...(prev[msg.patient_id]?.rooms ?? {}), [msg.room]: msg.rssi },
              profile: msg.profile ?? prev[msg.patient_id]?.profile,
            },
          }))
        } else if (msg.type === 'registered') {
          console.log('[WS] Registration confirmed for', msg.patient_id)
        }
      } catch (e) {
        console.warn('[WS] Failed to parse message:', event.data)
      }
    }

    ws.onerror = () => { setStatus('error') }

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

  return { patients, status, recentFalls, reconnect: connect, disconnect, sendRegistration }
}