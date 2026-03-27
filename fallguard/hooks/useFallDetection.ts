/**
 * useFallDetection
 *
 * Dual-source fall detection hook for the resident dashboard.
 *
 * Data priority:
 *   1. BLE (direct from Arduino) — lowest latency, most accurate
 *   2. WebSocket (from server.py via scanner.py) — fallback when BLE not connected
 *
 * Returns the shape the Dashboard in app/(tabs)/index.tsx expects:
 *   ble        — { status, confidence }
 *   wsStatus   — WebSocket connection status
 *   fallDetected
 *   activityLabel  — e.g. "walking"
 *   activityIndex  — 0-6, or -1 when no signal
 *   room       — best room string from server, or null
 *   bleReconnect   — call to retry BLE connection
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { bleManager } from '../constants/bleManager'
import { atob } from 'react-native-quick-base64'
import {
  BLE_SERVICE_UUID,
  BLE_PREDICTION_UUID,
  BLE_CONFIDENCE_UUID,
  BLE_FALL_ALERT_UUID,
  STATE_LABELS,
  FALL_STATE_INDEX,
} from '../constants/bleConstants'

export type BleStatus = 'disconnected' | 'connecting' | 'connected' | 'error'
export type WsStatus  = 'disconnected' | 'connecting' | 'connected' | 'error' | 'no_server'

type Options = {
  deviceId:  string | null
  patientId: string
  serverIp:  string
  onFall?:   () => void
}

type ReturnShape = {
  ble:           { status: BleStatus; confidence: number }
  wsStatus:      WsStatus
  fallDetected:  boolean
  activityLabel: string
  activityIndex: number
  room:          string | null
  bleReconnect:  () => void
}

const WS_RECONNECT_MS = 3000

export function useFallDetection({ deviceId, patientId, serverIp, onFall }: Options): ReturnShape {

  const [bleStatus,     setBleStatus]     = useState<BleStatus>('disconnected')
  const [bleActivity,   setBleActivity]   = useState<number>(-1)
  const [bleConfidence, setBleConfidence] = useState<number>(0)
  const [wsStatus,      setWsStatus]      = useState<WsStatus>('disconnected')
  const [wsActivity,    setWsActivity]    = useState<number>(-1)
  const [wsRoom,        setWsRoom]        = useState<string | null>(null)
  const [fallDetected,  setFallDetected]  = useState(false)

  const wsRef          = useRef<WebSocket | null>(null)
  const wsReconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef     = useRef(true)
  const onFallRef      = useRef(onFall)
  onFallRef.current    = onFall

  // BLE 

  const connectBle = useCallback(async () => {
    if (!deviceId) return
    setBleStatus('connecting')
    try {
      const connected = await bleManager.connectedDevices([BLE_SERVICE_UUID])
      let device = connected.find(d => d.id === deviceId)
      if (!device) {
        device = await bleManager.connectToDevice(deviceId, { autoConnect: true })
      }
      await device.discoverAllServicesAndCharacteristics()
      if (!mountedRef.current) return
      setBleStatus('connected')

      device.monitorCharacteristicForService(BLE_SERVICE_UUID, BLE_PREDICTION_UUID, (err, char) => {
        if (!mountedRef.current || err || !char?.value) return
        try {
          const idx = atob(char.value).charCodeAt(0)
          setBleActivity(idx)
          if (idx === FALL_STATE_INDEX) { setFallDetected(true); onFallRef.current?.() }
        } catch {}
      })

      device.monitorCharacteristicForService(BLE_SERVICE_UUID, BLE_CONFIDENCE_UUID, (err, char) => {
        if (!mountedRef.current || err || !char?.value) return
        try { setBleConfidence(atob(char.value).charCodeAt(0)) } catch {}
      })

      device.monitorCharacteristicForService(BLE_SERVICE_UUID, BLE_FALL_ALERT_UUID, (err, char) => {
        if (!mountedRef.current || err || !char?.value) return
        try {
          if (atob(char.value).charCodeAt(0) === 1) { setFallDetected(true); onFallRef.current?.() }
        } catch {}
      })

      device.onDisconnected(() => {
        if (!mountedRef.current) return
        setBleStatus('disconnected')
        setBleActivity(-1)
        setBleConfidence(0)
        setTimeout(() => { if (mountedRef.current) connectBle() }, 3000)
      })

    } catch {
      if (mountedRef.current) setBleStatus('error')
    }
  }, [deviceId])

  const bleReconnect = useCallback(() => { setBleStatus('disconnected'); connectBle() }, [connectBle])

  // WebSocket 

  const connectWs = useCallback((ip: string, port: string) => {
    if (!ip) { setWsStatus('no_server'); return }
    if (wsRef.current) wsRef.current.close()
    if (!mountedRef.current) return

    setWsStatus('connecting')
    const ws = new WebSocket(`ws://${ip}:${port}`)
    wsRef.current = ws

    ws.onopen = () => {
      if (!mountedRef.current) return
      setWsStatus('connected')
      if (wsReconnectRef.current) { clearTimeout(wsReconnectRef.current); wsReconnectRef.current = null }
    }

    ws.onmessage = (event) => {
      if (!mountedRef.current) return
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'snapshot') {
          const mine = msg.patients?.[patientId]
          if (mine) {
            const idx = mine.state_index ?? -1
            setWsActivity(idx)
            setWsRoom(mine.location ?? null)
            if (idx === FALL_STATE_INDEX) { setFallDetected(true); onFallRef.current?.() }
          }
        } else if ((msg.type === 'state_change' || msg.type === 'heartbeat') && msg.patient_id === patientId) {
          const idx = msg.state_index ?? -1
          setWsActivity(idx)
          setWsRoom(msg.location ?? null)
          if (idx === FALL_STATE_INDEX) { setFallDetected(true); onFallRef.current?.() }
        } else if ((msg.type === 'fall' || msg.type === 'fall_likely') && msg.patient_id === patientId) {
          setWsActivity(FALL_STATE_INDEX)
          setFallDetected(true)
          onFallRef.current?.()
        }
      } catch {}
    }

    ws.onerror = () => { if (mountedRef.current) setWsStatus('error') }
    ws.onclose = () => {
      if (!mountedRef.current) return
      setWsStatus('disconnected')
      wsReconnectRef.current = setTimeout(() => connectWs(ip, port), WS_RECONNECT_MS)
    }
  }, [patientId])

  // Init 

  useEffect(() => {
    mountedRef.current = true
    async function init() {
      const port = await AsyncStorage.getItem('server_port') ?? '5001'
      if (serverIp) connectWs(serverIp, port)
      if (deviceId) connectBle()
    }
    init()
    return () => {
      mountedRef.current = false
      if (wsReconnectRef.current) clearTimeout(wsReconnectRef.current)
      wsRef.current?.close()
    }
  }, [serverIp, deviceId])

  // Derive output 

  const activeIndex = bleStatus === 'connected' && bleActivity >= 0 ? bleActivity : wsActivity
  const activeLabel = activeIndex >= 0 ? (STATE_LABELS[activeIndex] ?? 'unknown') : 'offline'

  return {
    ble:          { status: bleStatus, confidence: bleConfidence },
    wsStatus,
    fallDetected,
    activityLabel: activeLabel,
    activityIndex: activeIndex,
    room:          wsRoom,
    bleReconnect,
  }
}