import { Linking, PermissionsAndroid, Platform } from 'react-native'

function normalizePhone(phone: string): string {
  return phone.trim()
}

export async function placeEmergencyCall(phone: string): Promise<'called' | 'dialer' | 'invalid'> {
  const normalized = normalizePhone(phone)
  if (!normalized) return 'invalid'

  // Android can place the call directly with ACTION_CALL when permission is granted.
  if (Platform.OS === 'android') {
    try {
      const hasPermission = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CALL_PHONE)
      const granted = hasPermission
        ? PermissionsAndroid.RESULTS.GRANTED
        : await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CALL_PHONE)

      if (granted === PermissionsAndroid.RESULTS.GRANTED) {
        await Linking.sendIntent('android.intent.action.CALL', [{ key: 'data', value: `tel:${normalized}` }])
        return 'called'
      }
    } catch (error) {
      console.warn('[CALL] Direct Android call failed, falling back to dialer:', error)
    }
  }

  try {
    await Linking.openURL(`tel:${normalized}`)
    return 'dialer'
  } catch (error) {
    console.warn('[CALL] Failed to open dialer:', error)
    return 'invalid'
  }
}
