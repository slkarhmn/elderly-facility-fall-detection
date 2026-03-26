import { View, Text, StyleSheet, SafeAreaView } from 'react-native'

export default function SettingsScreen() {
  return (
    <SafeAreaView style={s.safe}>
      <View style={s.c}>
        <Text style={s.t}>Settings</Text>
        <Text style={s.sub}>App preferences and device info.</Text>
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FBF7EC' },
  c: { flex: 1, padding: 28, justifyContent: 'center', alignItems: 'center' },
  t: { fontFamily: 'NunitoSans_900Black', fontSize: 28, color: '#31372B', marginBottom: 8 },
  sub: { fontFamily: 'NunitoSans_400Regular', fontSize: 14, color: '#31372B', opacity: 0.45, textAlign: 'center' },
})