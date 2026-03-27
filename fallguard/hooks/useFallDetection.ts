import { useEffect, useRef, useState, useCallback } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

export type ActivityState =
  | 'walking'
  | 'stumbling'
  | 'idle_standing'
  | 'idle_sitting'
  | 'upstairs'
  | 'downstairs'
  | 'fall'
  | 'offline'
  | 'unknown'

export type FallDetectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error' | 'no_server'

export type FallDetectionState = {
  activity: ActivityState
  location: string | null
  status: FallDetectionStatus
  lastUpdated: Date | null
  fallDetected: boolean
}

const PATIENT_ID = 'PATIENT_01'
const RECONNECT_DELAY = 3000

export function useFallDetection() {
  const [state, setState] = useState<FallDetectionState>({
    activity: 'offline',
    location: null,
    status: 'disconnected',
    lastUpdated: null,
    fallDetected: false,
  })

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const serverIpRef = useRef<string>('')
  const serverPortRef = useRef<string>('5001')
  const mountedRef = useRef(true)

  const connect = useCallback(() => {
    const ip = serverIpRef.current
    if (!ip) {
      setState(prev => ({ ...prev, status: 'no_server' }))
      return
    }

    if (wsRef.current) wsRef.current.close()
    if (!mountedRef.current) return

    setState(prev => ({ ...prev, status: 'connecting' }))
    const ws = new WebSocket(`ws://${ip}:${serverPortRef.current}`)
    wsRef.current = ws

    ws.onopen = () => {
      if (!mountedRef.current) return
      setState(prev => ({ ...prev, status: 'connected' }))
      if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null }
    }

    ws.onmessage = (event) => {
      if (!mountedRef.current) return
      try {
        const msg = JSON.parse(event.data)

        if (msg.type === 'snapshot') {
          const myState = msg.patients?.[PATIENT_ID]
          if (myState) {
            setState(prev => ({
              ...prev,
              activity: myState.state ?? 'offline',
              location: myState.location ?? null,
              lastUpdated: new Date(),
              fallDetected: myState.state === 'fall',
            }))
          }

        } else if (
          (msg.type === 'state_change' || msg.type === 'heartbeat') &&
          msg.patient_id === PATIENT_ID
        ) {
          setState(prev => ({
            ...prev,
            activity: msg.state ?? 'unknown',
            location: msg.location ?? null,
            lastUpdated: new Date(),
            fallDetected: msg.state === 'fall',
          }))

        } else if (
          (msg.type === 'fall' || msg.type === 'fall_likely') &&
          msg.patient_id === PATIENT_ID
        ) {
          setState(prev => ({
            ...prev,
            activity: 'fall',
            fallDetected: true,
            lastUpdated: new Date(),
          }))
        }

      } catch (e) {
        console.warn('[FallDetection] Failed to parse message:', event.data)
      }
    }

    ws.onerror = () => {
      if (!mountedRef.current) return
      setState(prev => ({ ...prev, status: 'error' }))
    }

    ws.onclose = () => {
      if (!mountedRef.current) return
      setState(prev => ({ ...prev, status: 'disconnected', activity: 'offline' }))
      reconnectTimer.current = setTimeout(() => connect(), RECONNECT_DELAY)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true

    async function init() {
      const [ip, port] = await Promise.all([
        AsyncStorage.getItem('server_ip'),
        AsyncStorage.getItem('server_port'),
      ])
      serverIpRef.current = ip ?? ''
      serverPortRef.current = port ?? '5001'
      connect()
    }
    init()

    return () => {
      mountedRef.current = false
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  // Allow re-connecting after settings change
  const reconnect = useCallback(async () => {
    const [ip, port] = await Promise.all([
      AsyncStorage.getItem('server_ip'),
      AsyncStorage.getItem('server_port'),
    ])
    serverIpRef.current = ip ?? ''
    serverPortRef.current = port ?? '5001'
    connect()
  }, [connect])

  return { ...state, reconnect }
}