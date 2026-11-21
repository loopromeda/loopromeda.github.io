/** A stereo 32-bit float WAV of two sides */
export function wavFile(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number
): Buffer {
  const frames = left.length
  const data = frames * 2 * 4
  const file = Buffer.alloc(44 + data)
  file.write('RIFF', 0)
  file.writeUInt32LE(36 + data, 4)
  file.write('WAVE', 8)
  file.write('fmt ', 12)
  file.writeUInt32LE(16, 16)
  file.writeUInt16LE(3, 20) // IEEE float
  file.writeUInt16LE(2, 22)
  file.writeUInt32LE(sampleRate, 24)
  file.writeUInt32LE(sampleRate * 2 * 4, 28)
  file.writeUInt16LE(8, 32)
  file.writeUInt16LE(32, 34)
  file.write('data', 36)
  file.writeUInt32LE(data, 40)
  for (let i = 0; i < frames; i++) {
    file.writeFloatLE(left[i]!, 44 + i * 8)
    file.writeFloatLE(right[i]!, 48 + i * 8)
  }
  return file
}
