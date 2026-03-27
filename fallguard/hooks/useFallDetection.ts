import { useEffect, useRef, useState, useCallback } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { bleManager } from '../constants/bleManager'
import { atob } from 'react-native-quick-base64'
import {
  BLE_SERVICE_UUID,
  BLE_PREDICTION_UUID,
  BLE_CONFIDENCE_UUID,
  BLE_FALL_ALERT_UUID,
  BLE_MODE_COMMAND_UUID,
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

const CMD_INFER       = 105
const POLL_INTERVAL   = 2000
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
  const pollRef        = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef     = useRef(true)
  const deviceRef      = useRef<any>(null)
  const onFallRef      = useRef(onFall)
  onFallRef.current    = onFall

  const startPolling = useCallback((device: any) => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      if (!mountedRef.current || !device) return
      try {
        const predChar = await device.readCharacteristicForService(BLE_SERVICE_UUID, BLE_PREDICTION_UUID)
        console.log('[POLL] raw predChar value:', predChar?.value)
        console.log('[POLL] decoded idx:', predChar?.value ? atob(predChar.value).charCodeAt(0) : 'null')

        if (predChar?.value) {
          const idx = atob(predChar.value).charCodeAt(0)
          if (idx !== 255) {
            setBleActivity(idx)
            if (idx === FALL_STATE_INDEX) { setFallDetected(true); onFallRef.current?.() }
          }
        }

        const confChar = await device.readCharacteristicForService(BLE_SERVICE_UUID, BLE_CONFIDENCE_UUID)
        console.log('[POLL] raw confChar value:', confChar?.value)

        if (confChar?.value) {
          setBleConfidence(atob(confChar.value).charCodeAt(0))
        }
      } catch (e) {
        console.log('[POLL] read error:', e)
      }
    }, POLL_INTERVAL)
  }, [])

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  const connectBle = useCallback(async () => {
    if (!deviceId) return
    console.log('[BLE] connectBle called, deviceId:', deviceId)
    setBleStatus('connecting')
    try {
      const connected = await bleManager.connectedDevices([BLE_SERVICE_UUID])
      console.log('[BLE] already connected devices:', connected.map((d: any) => d.id))
      let device = connected.find((d: any) => d.id === deviceId)
      if (!device) {
        console.log('[BLE] not found in connected, calling connectToDevice')
        device = await bleManager.connectToDevice(deviceId, { autoConnect: true })
      }
      await device.discoverAllServicesAndCharacteristics()
      if (!mountedRef.current) return

      deviceRef.current = device

      try {
        const cmdBase64 = btoa(String.fromCharCode(CMD_INFER))
        await device.writeCharacteristicWithResponseForService(BLE_SERVICE_UUID, BLE_MODE_COMMAND_UUID, cmdBase64)
        console.log('[BLE] CMD_INFER sent successfully')
      } catch (e) {
        console.log('[BLE] CMD_INFER rejected:', e)
      }

      setBleStatus('connected')
      console.log('[BLE] status set to connected, starting polling')

      device.monitorCharacteristicForService(BLE_SERVICE_UUID, BLE_PREDICTION_UUID, (err: any, char: any) => {
        if (err) { console.log('[BLE] prediction monitor error:', err); return }
        if (!mountedRef.current || !char?.value) return
        try {
          const idx = atob(char.value).charCodeAt(0)
          console.log('[BLE] prediction notify fired, idx:', idx)
          if (idx !== 255) {
            setBleActivity(idx)
            if (idx === FALL_STATE_INDEX) { setFallDetected(true); onFallRef.current?.() }
          }
        } catch (e) {
          console.log('[BLE] prediction decode error:', e)
        }
      })

      device.monitorCharacteristicForService(BLE_SERVICE_UUID, BLE_CONFIDENCE_UUID, (err: any, char: any) => {
        if (!mountedRef.current || err || !char?.value) return
        try { setBleConfidence(atob(char.value).charCodeAt(0)) } catch {}
      })

      device.monitorCharacteristicForService(BLE_SERVICE_UUID, BLE_FALL_ALERT_UUID, (err: any, char: any) => {
        if (!mountedRef.current || err || !char?.value) return
        try {
          if (atob(char.value).charCodeAt(0) === 1) { setFallDetected(true); onFallRef.current?.() }
        } catch {}
      })

      startPolling(device)

      device.onDisconnected(() => {
        console.log('[BLE] device disconnected')
        if (!mountedRef.current) return
        setBleStatus('disconnected')
        setBleActivity(-1)
        setBleConfidence(0)
        deviceRef.current = null
        stopPolling()
        setTimeout(() => { if (mountedRef.current) connectBle() }, 3000)
      })

    } catch (e) {
      console.log('[BLE] connectBle error:', e)
      if (mountedRef.current) setBleStatus('error')
    }
  }, [deviceId, startPolling, stopPolling])

  const bleReconnect = useCallback(() => {
    console.log('[BLE] bleReconnect tapped')
    stopPolling()
    setBleStatus('disconnected')
    connectBle()
  }, [connectBle, stopPolling])

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
      stopPolling()
      if (wsReconnectRef.current) clearTimeout(wsReconnectRef.current)
      wsRef.current?.close()
    }
  }, [serverIp, deviceId])

  const activeIndex = bleStatus === 'connected' && bleActivity >= 0 ? bleActivity : wsActivity
  const activeLabel = activeIndex >= 0 ? (STATE_LABELS[activeIndex] ?? 'unknown') : 'offline'

  return {
    ble:           { status: bleStatus, confidence: bleConfidence },
    wsStatus,
    fallDetected,
    activityLabel: activeLabel,
    activityIndex: activeIndex,
    room:          wsRoom,
    bleReconnect,
  }
}