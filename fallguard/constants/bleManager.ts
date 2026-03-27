/**
 * bleManager.ts
 *
 * Single shared BleManager instance for the entire app.
 * Import this everywhere instead of calling new BleManager()
 
 */

import { BleManager } from 'react-native-ble-plx'

export const bleManager = new BleManager()