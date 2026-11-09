import { defineConfig } from 'vitest/config'

// Unit tests sit next to the code they test. DSP tests run in Node: src/dsp
// has no DOM or Web Audio dependency.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
})
