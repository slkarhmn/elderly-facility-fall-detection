
export const BLE_SERVICE_UUID         = '19B10000-E8F2-537E-4F6C-D104768A1214'
export const BLE_FALL_ALERT_UUID      = '19B10001-E8F2-537E-4F6C-D104768A1214' 
export const BLE_PREDICTION_UUID      = '19B10002-E8F2-537E-4F6C-D104768A1214' 
export const BLE_CONFIDENCE_UUID      = '19B10003-E8F2-537E-4F6C-D104768A1214'
export const BLE_MODE_COMMAND_UUID    = '19B10004-E8F2-537E-4F6C-D104768A1214' 


export const CMD_CALIBRATE = 99  
export const CMD_INFER     = 105 
export const CMD_RECORD    = 114 

export const DEVICE_NAME_PREFIX = 'PATIENT_'

export const STATE_LABELS: Record<number, string> = {
  0: 'walking',
  1: 'stumbling',
  2: 'idle_standing',
  3: 'idle_sitting',
  4: 'upstairs',
  5: 'downstairs',
  6: 'fall',
}

export const FALL_STATE_INDEX = 6