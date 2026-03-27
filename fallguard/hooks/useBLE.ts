import { useEffect, useRef, useCallback, useState } from 'react'
import { BleManager, Device, State } from 'react-native-ble-plx'
import { AppState, AppStateStatus } from 'react-native'
import { decodeBase64Byte } from '../constants/base64Byte'

const BLE_SERVICE_UUID    = '19B10000-E8F2-537E-4F6C-D104768A1214'
const BLE_FALL_ALERT_UUID = '19B10001-E8F2-537E-4F6C-D104768A1214'
const BLE_PREDICTION_UUID = '19B10002-E8F2-537E-4F6C-D104768A1214'
const BLE_CONFIDENCE_UUID = '19B10003-E8F2-537E-4F6C-D104768A1214'

const STATE_LABELS: Record<number, string> = {
  0: 'walking', 1: 'stumbling', 2: 'idle_standing',
  3: 'idle_sitting', 4: 'upstairs', 5: 'downstairs', 6: 'fall',
}

export type BLEStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export type BLEState = {
  status: BLEStatus
  fallAlert: boolean
  predictionIndex: number
  predictionLabel: string
  confidence: number
  reconnect: () => void
}

type Options = {
  deviceId: string | null
  onFallDetected: () => void
  enabled?: boolean
}

export function useBLE({ deviceId, onFallDetected, enabled = true }: Options): BLEState {
  const [status, setStatus] = useState<BLEStatus>('disconnected')
  const [fallAlert, setFallAlert] = useState(false)
  const [predictionIndex, setPredictionIndex] = useState(-1)
  const [confidence, setConfidence] = useState(0)

  const bleManagerRef = useRef<BleManager | null>(null)
  const deviceRef = useRef<Device | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  const onFallRef = useRef(onFallDetected)
  onFallRef.current = onFallDetected

  const decodeValue = (base64: string | null): number => {
    if (!base64) return -1
    return decodeBase64Byte(base64)
  }

  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current) return
    reconnectTimerRef.current = setTimeout(() => {
      if (mountedRef.current) connect()
    }, 5000)
  }, [])

  const subscribeToCharacteristics = useCallback((device: Device) => {
    device.monitorCharacteristicForService(BLE_SERVICE_UUID, BLE_FALL_ALERT_UUID, (error, characteristic) => {
      if (error || !characteristic?.value || !mountedRef.current) return
      const value = decodeValue(characteristic.value)
      setFallAlert(value === 1)
      if (value === 1) onFallRef.current()
    })
    device.monitorCharacteristicForService(BLE_SERVICE_UUID, BLE_PREDICTION_UUID, (error, characteristic) => {
      if (error || !characteristic?.value || !mountedRef.current) return
      setPredictionIndex(decodeValue(characteristic.value))
    })
    device.monitorCharacteristicForService(BLE_SERVICE_UUID, BLE_CONFIDENCE_UUID, (error, characteristic) => {
      if (error || !characteristic?.value || !mountedRef.current) return
      setConfidence(decodeValue(characteristic.value))
    })
  }, [])

  const connect = useCallback(async () => {
    const manager = bleManagerRef.current
    if (!manager || !deviceId || !mountedRef.current) return

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }

    setStatus('connecting')

    try {
      const bleState = await manager.state()
      if (bleState !== State.PoweredOn) { scheduleReconnect(); return }

      const connectedDevices = await manager.connectedDevices([BLE_SERVICE_UUID])
      const existing = connectedDevices.find(d => d.id === deviceId)
      const device = existing ?? await manager.connectToDevice(deviceId, { autoConnect: false, timeout: 10000 })

      await device.discoverAllServicesAndCharacteristics()
      if (!mountedRef.current) return

      deviceRef.current = device
      setStatus('connected')

      device.onDisconnected(() => {
        if (!mountedRef.current) return
        deviceRef.current = null
        setStatus('disconnected')
        setFallAlert(false)
        setPredictionIndex(-1)
        scheduleReconnect()
      })

      subscribeToCharacteristics(device)
    } catch {
      if (!mountedRef.current) return
      setStatus('error')
      scheduleReconnect()
    }
  }, [deviceId, scheduleReconnect, subscribeToCharacteristics])

  useEffect(() => {
    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState === 'active' && status === 'disconnected' && deviceId) connect()
    }
    const sub = AppState.addEventListener('change', handleAppState)
    return () => sub.remove()
  }, [status, deviceId, connect])

  useEffect(() => {
    mountedRef.current = true
    if (!enabled || !deviceId) return

    bleManagerRef.current = new BleManager()

    const sub = bleManagerRef.current.onStateChange((state) => {
      if (state === State.PoweredOn) { sub.remove(); connect() }
    }, true)

    return () => {
      mountedRef.current = false
      sub.remove()
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      bleManagerRef.current?.destroy()
      bleManagerRef.current = null
    }
  }, [deviceId, enabled])

  return {
    status,
    fallAlert,
    predictionIndex,
    predictionLabel: STATE_LABELS[predictionIndex] ?? 'unknown',
    confidence,
    reconnect: connect,
  }
}