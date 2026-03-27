import { useEffect, useRef, useState, useCallback } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { bleManager } from '../constants/bleManager'
import { decodeBase64Byte, encodeBase64Byte } from '../constants/base64Byte'
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
  ble:           { status: BleStatus; confidence: number; error: string | null; waitingForInference: boolean }
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
  const [bleError,      setBleError]      = useState<string | null>(null)
  const [sawPrediction255, setSawPrediction255] = useState<boolean>(false)
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
          const idx = decodeBase64Byte(predChar.value)
          if (idx !== 255) {
            setBleActivity(idx)
            setSawPrediction255(false)
            if (idx === FALL_STATE_INDEX) { setFallDetected(true); onFallRef.current?.() }
          } else {
            setSawPrediction255(true)
          }
        }

        const confChar = await device.readCharacteristicForService(BLE_SERVICE_UUID, BLE_CONFIDENCE_UUID)
        console.log('[POLL] raw confChar value:', confChar?.value)

        if (confChar?.value) {
          setBleConfidence(decodeBase64Byte(confChar.value))
          setBleError(null)
        }
      } catch (err: any) {
        const message = err?.message ?? 'Failed to read BLE characteristics.'
        setBleError(message)
        console.warn('[BLE poll] read failed:', message)
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
    setBleError(null)
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
        const cmdBase64 = encodeBase64Byte(CMD_INFER)
        await device.writeCharacteristicWithResponseForService(BLE_SERVICE_UUID, BLE_MODE_COMMAND_UUID, cmdBase64)
      } catch (err: any) {
        const message = err?.message ?? 'Failed to send infer command.'
        setBleError(message)
        console.warn('[BLE] infer command failed:', message)
      }

      setBleStatus('connected')
      console.log('[BLE] status set to connected, starting polling')

      device.monitorCharacteristicForService(BLE_SERVICE_UUID, BLE_PREDICTION_UUID, (err: any, char: any) => {
        if (!mountedRef.current) return
        if (err) {
          const message = err?.message ?? 'Prediction monitor failed.'
          setBleError(message)
          console.warn('[BLE monitor] prediction failed:', message)
          return
        }
        if (!char?.value) return
        try {
          const idx = decodeBase64Byte(char.value)
          if (idx !== 255) {
            setBleActivity(idx)
            setSawPrediction255(false)
            if (idx === FALL_STATE_INDEX) { setFallDetected(true); onFallRef.current?.() }
          } else {
            setSawPrediction255(true)
          }
        } catch (decodeErr: any) {
          const message = decodeErr?.message ?? 'Prediction decode failed.'
          setBleError(message)
          console.warn('[BLE monitor] prediction decode failed:', message)
        }
      })

      device.monitorCharacteristicForService(BLE_SERVICE_UUID, BLE_CONFIDENCE_UUID, (err: any, char: any) => {
        if (!mountedRef.current) return
        if (err) {
          const message = err?.message ?? 'Confidence monitor failed.'
          setBleError(message)
          console.warn('[BLE monitor] confidence failed:', message)
          return
        }
        if (!char?.value) return
        try {
          setBleConfidence(decodeBase64Byte(char.value))
        } catch (decodeErr: any) {
          const message = decodeErr?.message ?? 'Confidence decode failed.'
          setBleError(message)
          console.warn('[BLE monitor] confidence decode failed:', message)
        }
      })

      device.monitorCharacteristicForService(BLE_SERVICE_UUID, BLE_FALL_ALERT_UUID, (err: any, char: any) => {
        if (!mountedRef.current) return
        if (err) {
          const message = err?.message ?? 'Fall alert monitor failed.'
          setBleError(message)
          console.warn('[BLE monitor] fall alert failed:', message)
          return
        }
        if (!char?.value) return
        try {
          if (decodeBase64Byte(char.value) === 1) { setFallDetected(true); onFallRef.current?.() }
        } catch (decodeErr: any) {
          const message = decodeErr?.message ?? 'Fall alert decode failed.'
          setBleError(message)
          console.warn('[BLE monitor] fall alert decode failed:', message)
        }
      })

      startPolling(device)

      device.onDisconnected(() => {
        console.log('[BLE] device disconnected')
        if (!mountedRef.current) return
        setBleStatus('disconnected')
        setBleActivity(-1)
        setBleConfidence(0)
        setSawPrediction255(false)
        deviceRef.current = null
        stopPolling()
        setTimeout(() => { if (mountedRef.current) connectBle() }, 3000)
      })

    } catch {
      if (mountedRef.current) {
        setBleStatus('error')
        setBleError('Failed to connect to sensor.')
      }
    }
  }, [deviceId, startPolling, stopPolling])

  const bleReconnect = useCallback(() => {
    console.log('[BLE] bleReconnect tapped')
    stopPolling()
    setBleStatus('disconnected')
    setBleError(null)
    setSawPrediction255(false)
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
    ble:           {
      status: bleStatus,
      confidence: bleConfidence,
      error: bleError,
      waitingForInference: bleStatus === 'connected' && bleActivity < 0 && sawPrediction255,
    },
    wsStatus,
    fallDetected,
    activityLabel: activeLabel,
    activityIndex: activeIndex,
    room:          wsRoom,
    bleReconnect,
  }
}