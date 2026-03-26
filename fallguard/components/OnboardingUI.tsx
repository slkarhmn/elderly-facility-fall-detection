import React, { useEffect, useRef } from 'react'
import {
  View, Text, TextInput, TouchableOpacity,
  Animated, StyleSheet, TextInputProps,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, spacing } from '../constants/theme'
import { useSafeAreaInsets } from 'react-native-safe-area-context'


export function ProgressBar({ total, current }: { total: number; current: number }) {
  const insets = useSafeAreaInsets()
  
  return (
    <View style={[styles.progressRow, { paddingTop: insets.top + 36 }]}>
      {Array.from({ length: total }).map((_, i) => (
        <View key={i} style={[
          styles.progressSegment,
          i < current - 1 && styles.progressDone,
          i === current - 1 && styles.progressActive,
        ]} />
      ))}
    </View>
  )
}

export function StepTag({ current, total }: { current: number; total: number }) {
  return <Text style={styles.stepTag}>Step {current} of {total}</Text>
}

export function Headline({ children }: { children: React.ReactNode }) {
  return <Text style={styles.headline}>{children}</Text>
}

export function Subline({ children }: { children: React.ReactNode }) {
  return <Text style={styles.subline}>{children}</Text>
}

export function UnderlineInput({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  const lineAnim = useRef(new Animated.Value(0)).current

  const handleFocus = () => {
    Animated.timing(lineAnim, { toValue: 1, duration: 350, useNativeDriver: false }).start()
    props.onFocus?.({} as any)
  }
  const handleBlur = () => {
    Animated.timing(lineAnim, { toValue: 0, duration: 250, useNativeDriver: false }).start()
    props.onBlur?.({} as any)
  }

  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldInner}>
        <TextInput
          style={styles.fieldInput}
          placeholderTextColor="rgba(49,55,43,0.28)"
          onFocus={handleFocus}
          onBlur={handleBlur}
          {...props}
        />
        <View style={styles.fieldLine} />
        <Animated.View style={[styles.fieldLineActive, {
          width: lineAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
        }]} />
      </View>
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  )
}


export function CTAButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const insets = useSafeAreaInsets()
  const scale = useRef(new Animated.Value(1)).current
  const pressIn = () => Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start()
  const pressOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 50 }).start()

  return (
    <Animated.View style={[
      styles.ctaWrap,
      {
        transform: [{ scale }],
        opacity: disabled ? 0.45 : 1,
        paddingBottom: insets.bottom > 0 ? insets.bottom : 20,
      }
    ]}>
      <TouchableOpacity
        onPress={onPress} onPressIn={pressIn} onPressOut={pressOut}
        disabled={disabled} activeOpacity={1} style={styles.ctaBtn}
      >
        <Text style={styles.ctaLabel}>{label}</Text>
        <View style={styles.ctaArrow}>
          <Ionicons name="arrow-forward" size={16} color="#FBF7EC" />
        </View>
      </TouchableOpacity>
    </Animated.View>
  )
}

export function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.backBtn} onPress={onPress} activeOpacity={0.6}>
      <Ionicons name="arrow-back" size={16} color="#31372B" style={{ opacity: 0.38 }} />
      <Text style={styles.backLabel}>Back</Text>
    </TouchableOpacity>
  )
}

export function Divider() {
  return <View style={styles.divider} />
}

const styles = StyleSheet.create({
  progressRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 28, paddingTop: 10 },
  progressSegment: { flex: 1, height: 3, borderRadius: 2, backgroundColor: '#31372B', opacity: 0.12 },
  progressDone: { opacity: 0.35 },
  progressActive: { opacity: 1 },
  stepTag: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 10.5, letterSpacing: 2.5, textTransform: 'uppercase', color: '#31372B', opacity: 0.32, marginBottom: 14 },
  headline: { fontFamily: 'NunitoSans_900Black', fontSize: 30, color: '#31372B', lineHeight: 34, letterSpacing: -0.5, marginBottom: 10 },
  subline: { fontFamily: 'NunitoSans_400Regular', fontSize: 14, color: '#31372B', opacity: 0.5, lineHeight: 22, marginBottom: 36 },
  fieldWrap: { marginBottom: 28 },
  fieldLabel: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: '#31372B', opacity: 0.38, marginBottom: 10 },
  fieldInner: { paddingBottom: 12 },
  fieldInput: { fontFamily: 'NunitoSans_700Bold', fontSize: 20, color: '#31372B', padding: 0, letterSpacing: -0.2 },
  fieldLine: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 1.5, backgroundColor: '#31372B', opacity: 0.15, borderRadius: 1 },
  fieldLineActive: { position: 'absolute', bottom: 0, left: 0, height: 1.5, backgroundColor: '#31372B', borderRadius: 1 },
  fieldHint: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 11, color: '#31372B', opacity: 0.3, marginTop: 6 },
    ctaWrap: {
    marginHorizontal: 28,
    marginTop: 16,
    // NO elevation, NO shadow
    },
ctaBtn: {
  height: 58,
  backgroundColor: colors.ink,
  borderRadius: 18,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingHorizontal: 22,
  // NO shadow props at all
},
  ctaLabel: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 15, color: '#FBF7EC', letterSpacing: 0.2 },
  ctaArrow: { width: 34, height: 34, borderRadius: 11, backgroundColor: 'rgba(251,247,236,0.12)', alignItems: 'center', justifyContent: 'center' },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 28, alignSelf: 'flex-start' },
  backLabel: { fontFamily: 'NunitoSans_700Bold', fontSize: 13, color: '#31372B', opacity: 0.38 },
  divider: { height: 1, backgroundColor: '#31372B', opacity: 0.07, marginVertical: spacing.sm },
})