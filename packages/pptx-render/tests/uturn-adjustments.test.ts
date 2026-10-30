import { describe, expect, it } from 'vitest'
import { presetPath } from '../src/preset-geometry'
describe('U-turn arrow adjustment guides', () => {
  const adjust = { adj1: 2000, adj2: 10000, adj3: 8000, adj4: 15000, adj5: 100000 }
  it('keeps a long straight bridge between the independently rounded corners', () => {
    const path = presetPath('uturnArrow', 1000, 200, adjust)!.path!
    expect(path).toContain('L 952 0')
    expect(path).toContain('L 980 200')
  })
  it('uses the head reach adjustment instead of always ending the head at the bottom edge', () => {
    const path = presetPath('uturnArrow', 1000, 200, { ...adjust, adj5: 60000 })!.path!
    expect(path).toContain('L 980 120')
    expect(path).not.toContain('NaN')
  })
})
