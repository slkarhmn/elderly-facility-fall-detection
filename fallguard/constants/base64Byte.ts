const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function base64Index(char: string): number {
  return BASE64_ALPHABET.indexOf(char)
}

// BLE characteristics here are single-byte payloads encoded as base64.
export function decodeBase64Byte(input: string | null | undefined): number {
  if (!input || input.length < 2) return -1
  const a = base64Index(input[0])
  const b = base64Index(input[1])
  if (a < 0 || b < 0) return -1
  return ((a << 2) | (b >> 4)) & 0xff
}

export function encodeBase64Byte(value: number): string {
  const byte = value & 0xff
  const first = BASE64_ALPHABET[(byte >> 2) & 0x3f]
  const second = BASE64_ALPHABET[(byte & 0x03) << 4]
  return `${first}${second}==`
}
