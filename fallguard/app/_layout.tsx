import { useEffect, useState } from 'react'
import { Stack, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useFonts } from 'expo-font'
import {
  NunitoSans_400Regular,
  NunitoSans_600SemiBold,
  NunitoSans_700Bold,
  NunitoSans_800ExtraBold,
  NunitoSans_900Black,
} from '@expo-google-fonts/nunito-sans'
import * as SplashScreen from 'expo-splash-screen'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { View } from 'react-native'

SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
  const router = useRouter()
  const [destination, setDestination] = useState<string | null>(null)

  const [fontsLoaded, fontError] = useFonts({
    NunitoSans_400Regular,
    NunitoSans_600SemiBold,
    NunitoSans_700Bold,
    NunitoSans_800ExtraBold,
    NunitoSans_900Black,
  })

  // Step 1 — load fonts + check AsyncStorage, store destination
  useEffect(() => {
    async function init() {
      if (!fontsLoaded && !fontError) return
      try {
        const done = await AsyncStorage.getItem('onboarding_complete')
        await SplashScreen.hideAsync()
        setDestination(done === 'true' ? '/(tabs)' : '/(onboarding)/profile')
      } catch {
        await SplashScreen.hideAsync()
        setDestination('/(onboarding)/profile')
      }
    }
    init()
  }, [fontsLoaded, fontError])

  // Step 2 — navigate only after Stack is mounted (destination is set)
  useEffect(() => {
    if (!destination) return
    router.replace(destination as any)
  }, [destination])

  // Show blank beige until ready
  if (!destination) {
    return <View style={{ flex: 1, backgroundColor: '#FBF7EC' }} />
  }

  return (
    <>
      <Stack screenOptions={{ headerShown: false }} />
      <StatusBar style="dark" backgroundColor="#FBF7EC" />
    </>
  )
}