
import { useEffect, useRef, useCallback, useState } from 'react'
import { Accelerometer } from 'expo-sensors'

// Tuning 

const SAMPLE_RATE        = 25          
const BUFFER_SECONDS     = 3
const BUFFER_SIZE        = BUFFER_SECONDS * SAMPLE_RATE  

const IMPACT_THRESHOLD_G              = 1.8

const STILLNESS_VARIANCE_THRESHOLD    = 0.04
const STILLNESS_TAIL_SAMPLES          = 10   

const MIN_SAMPLES                     = SAMPLE_RATE * 1  

// Types 

export type FallVerificationResult = 'confirmed' | 'likely_drop' | 'insufficient_data'
export type PhoneMotionLabel = 'still' | 'moving' | 'high_impact' | 'unknown'


function mag(x: number, y: number, z: number) {
  return Math.sqrt(x * x + y * y + z * z)
}

function variance(arr: number[]) {
  if (!arr.length) return 0
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length
  return arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length
}

function getOrderedTail(buf: number[], writePos: number): number[] {
  const ordered: number[] = []
  for (let i = 0; i < BUFFER_SIZE; i++) {
    ordered.push(buf[(writePos + i) % BUFFER_SIZE])
  }
  return ordered.slice(-STILLNESS_TAIL_SAMPLES)
}

// Hook 

export function usePhoneFallVerifier() {
  const bufRef      = useRef<number[]>(new Array(BUFFER_SIZE).fill(1.0))
  const writeRef    = useRef(0)
  const countRef    = useRef(0)
  const labelTimer  = useRef<ReturnType<typeof setInterval> | null>(null)

  const [phoneMotionLabel, setPhoneMotionLabel] = useState<PhoneMotionLabel>('unknown')

  useEffect(() => {
    Accelerometer.setUpdateInterval(Math.round(1000 / SAMPLE_RATE))

    const sub = Accelerometer.addListener(({ x, y, z }) => {
      bufRef.current[writeRef.current % BUFFER_SIZE] = mag(x, y, z)
      writeRef.current++
      countRef.current++
    })

    labelTimer.current = setInterval(() => {
      if (countRef.current < MIN_SAMPLES) { setPhoneMotionLabel('unknown'); return }
      const buf  = bufRef.current
      const peak = Math.max(...buf)
      const tail = getOrderedTail(buf, writeRef.current)
      const v    = variance(tail)
      if (peak > IMPACT_THRESHOLD_G)              setPhoneMotionLabel('high_impact')
      else if (v < STILLNESS_VARIANCE_THRESHOLD)  setPhoneMotionLabel('still')
      else                                        setPhoneMotionLabel('moving')
    }, 500)

    return () => {
      sub.remove()
      if (labelTimer.current) clearInterval(labelTimer.current)
    }
  }, [])


  const verify = useCallback((): FallVerificationResult => {
    if (countRef.current < MIN_SAMPLES) {
      console.warn('[PhoneFallVerifier] Not enough data — escalating for safety')
      return 'insufficient_data'
    }

    const buf  = bufRef.current
    const peak = Math.max(...buf)
    const tail = getOrderedTail(buf, writeRef.current)
    const v    = variance(tail)

    console.log(
      `[PhoneFallVerifier] peak=${peak.toFixed(3)}g  tailVariance=${v.toFixed(4)}  ` +
      `impact=${peak > IMPACT_THRESHOLD_G}  still=${v < STILLNESS_VARIANCE_THRESHOLD}`
    )

    if (peak > IMPACT_THRESHOLD_G && v < STILLNESS_VARIANCE_THRESHOLD) {
      return 'confirmed'
    }
    return 'likely_drop'
  }, [])

  return {
    /** Call when Arduino says fall. Returns verdict synchronously. */
    verify,
    /** Live motion label for debug display. Updates every 500 ms. */
    phoneMotionLabel,
  }
}