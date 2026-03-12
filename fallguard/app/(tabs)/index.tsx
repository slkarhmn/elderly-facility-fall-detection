import { View, Text, StyleSheet, SafeAreaView, TouchableOpacity } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { router } from 'expo-router'

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.name}>Welcome</Text>
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Last Activity</Text>
          <Text style={styles.cardBig}>No activity yet</Text>
          <Text style={styles.cardSub}>Start walking to record data</Text>
        </View>
      </View>

      <TouchableOpacity
        onPress={async () => {
          await AsyncStorage.removeItem('onboarding_complete')
          router.replace('/(onboarding)/profile')
        }}
        style={{ marginTop: 20, padding: 14, backgroundColor: '#31372B', borderRadius: 12 }}
      >
        <Text style={{ color: '#FBF7EC', fontFamily: 'NunitoSans_700Bold', textAlign: 'center' }}>
          Reset Onboarding (Dev Only)
        </Text>
      </TouchableOpacity>

    </SafeAreaView>
    
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FBF7EC' },
  container: { flex: 1, padding: 34, paddingTop:60 },
  greeting: { fontFamily: 'NunitoSans_700Bold', fontSize: 12, color: '#31372B', opacity: 0.4, letterSpacing: 1, textTransform: 'uppercase', marginTop: 8 },
  name: { fontFamily: 'NunitoSans_900Black', fontSize: 26, color: '#31372B', marginBottom: 28 },
  card: { backgroundColor: '#31372B', borderRadius: 24, padding: 24 },
  cardLabel: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: '#FBF7EC', opacity: 0.4, marginBottom: 8 },
  cardBig: { fontFamily: 'NunitoSans_900Black', fontSize: 28, color: '#FBF7EC' },
  cardSub: { fontFamily: 'NunitoSans_400Regular', fontSize: 13, color: '#FBF7EC', opacity: 0.45, marginTop: 6 },
})