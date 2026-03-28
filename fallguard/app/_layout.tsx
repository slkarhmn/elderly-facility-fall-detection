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
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { atob, btoa, base64ToArrayBuffer, base64FromArrayBuffer } from 'react-native-quick-base64'

const g = globalThis as any
if (typeof g.atob !== 'function') g.atob = atob
if (typeof g.btoa !== 'function') g.btoa = btoa
if (typeof g.base64ToArrayBuffer !== 'function') g.base64ToArrayBuffer = base64ToArrayBuffer
if (typeof g.base64FromArrayBuffer !== 'function') g.base64FromArrayBuffer = base64FromArrayBuffer

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

  useEffect(() => {
    async function init() {
      if (!fontsLoaded && !fontError) return
      try {
        const onboardingDone = await AsyncStorage.getItem('onboarding_complete')
        const role = await AsyncStorage.getItem('user_role')
        await SplashScreen.hideAsync()

        if (role === 'manager') {
          setDestination('/(manager)')
        } else if (onboardingDone === 'true') {
          setDestination('/(tabs)')
        } else {
          // Show role selection before onboarding
          setDestination('/role-select')
        }
      } catch {
        await SplashScreen.hideAsync()
        setDestination('/role-select')
      }
    }
    init()
  }, [fontsLoaded, fontError])

  useEffect(() => {
    if (!destination) return
    router.replace(destination as any)
  }, [destination])

  if (!destination) {
    return <View style={{ flex: 1, backgroundColor: '#FBF7EC' }} />
  }

  return (
    <>
      <SafeAreaProvider>
      <Stack screenOptions={{ headerShown: false }} />
      <StatusBar style="dark" backgroundColor="#FBF7EC" />
      </SafeAreaProvider>
    </>
  )
}
