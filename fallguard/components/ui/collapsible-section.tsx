import React, { type PropsWithChildren, useState, type ReactNode } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { colors, radius } from '../../constants/theme'

export function CollapsibleSection({
  header,
  children,
  defaultOpen = false,
  contentStyle,
}: PropsWithChildren & {
  header: ReactNode
  defaultOpen?: boolean
  contentStyle?: StyleProp<ViewStyle>
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={styles.header}
        onPress={() => setOpen((v) => !v)}
        activeOpacity={0.8}
      >
        <View style={styles.headerLeft}>
          {typeof header === 'string' ? <Text style={styles.headerText}>{header}</Text> : header}
        </View>
        <Ionicons
          name={open ? 'chevron-up-outline' : 'chevron-down-outline'}
          size={18}
          color={colors.ink}
          style={{ opacity: 0.35 }}
        />
      </TouchableOpacity>

      {open && <View style={[styles.content, contentStyle]}>{children}</View>}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 18,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: 'rgba(49,55,43,0.06)',
    borderRadius: radius.lg,
  },
  headerLeft: {
    flex: 1,
  },
  headerText: {
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.ink,
    opacity: 0.5,
  },
  content: {
    marginTop: 10,
  },
})

