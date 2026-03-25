import { useCallback, useRef } from 'react'
import { useBLE, BLEState } from './useBLE'
import { useServerWebSocket, FallEvent, PatientState } from './useServerWebSocket'

type Options = {
  deviceId: string | null      
  patientId: string            
  serverIp: string             
  onFall: () => void           
}

export type FallDetectionState = {
  ble: BLEState

  serverState: PatientState | null
  wsStatus: 'connecting' | 'connected' | 'disconnected' | 'error'

  fallDetected: boolean

  activityLabel: string
  activityIndex: number

  room: string | null
}

export function useFallDetection({ deviceId, patientId, serverIp, onFall }: Options): FallDetectionState {
  const onFallRef = useRef(onFall)
  onFallRef.current = onFall

  const fallFiredRef = useRef(false)

  const handleBLEFall = useCallback(() => {
    if (fallFiredRef.current) return
    fallFiredRef.current = true
    onFallRef.current()
    setTimeout(() => { fallFiredRef.current = false }, 30_000)
  }, [])

  const handleWSFall = useCallback((event: FallEvent) => {
    if (event.patient_id !== patientId) return
    if (event.type !== 'fall') return
    if (fallFiredRef.current) return
    fallFiredRef.current = true
    onFallRef.current()
    setTimeout(() => { fallFiredRef.current = false }, 30_000)
  }, [patientId])

  const ble = useBLE({
    deviceId,
    onFallDetected: handleBLEFall,
    enabled: !!deviceId,
  })

  const { patients, status: wsStatus } = useServerWebSocket({
    serverIp,
    onFall: handleWSFall,
  })

  const serverState = patients[patientId] ?? null

  const bleActive = ble.status === 'connected' && ble.predictionIndex >= 0
  const activityIndex = bleActive ? ble.predictionIndex : (serverState?.state_index ?? -1)
  const activityLabel = bleActive ? ble.predictionLabel : (serverState?.state ?? 'unknown')

  const fallDetected = ble.fallAlert || serverState?.state_index === 6

  return {
    ble,
    serverState,
    wsStatus,
    fallDetected,
    activityLabel,
    activityIndex,
    room: serverState?.location ?? null,
  }
}