import type { ThemeId } from '../types/settings'

export interface EffectTheme {
  id: ThemeId
  label: string
  primary: number
  edge: number
  highlight: number
  core: number
  particle: number
  css: string
  glowStrength: number
}

export const EFFECT_THEMES: Record<ThemeId, EffectTheme> = {
  ember: { id: 'ember', label: '琥珀秘术', primary: 0xff8a20, edge: 0xc53d08, highlight: 0xfff2cb, core: 0xffc45a, particle: 0xffad45, css: '#ff9d36', glowStrength: 1.15 },
  aether: { id: 'aether', label: '蓝色空间', primary: 0x45bfff, edge: 0x1459d9, highlight: 0xe5f8ff, core: 0x75e5ff, particle: 0x62cfff, css: '#55c8ff', glowStrength: 1.1 },
  chaos: { id: 'chaos', label: '紫色混沌', primary: 0xc369ff, edge: 0x6820c7, highlight: 0xf7e7ff, core: 0xe598ff, particle: 0xc77dff, css: '#c97cff', glowStrength: 1.2 },
  verdant: { id: 'verdant', label: '绿色自然', primary: 0x5ddd82, edge: 0x157b44, highlight: 0xe8ffe9, core: 0xa0f4a6, particle: 0x76e794, css: '#65df88', glowStrength: 1 },
  inferno: { id: 'inferno', label: '红色火焰', primary: 0xff4e32, edge: 0xa90e14, highlight: 0xffe5cf, core: 0xff8b4a, particle: 0xff6040, css: '#ff5b3b', glowStrength: 1.25 },
}

export const THEME_LIST = Object.values(EFFECT_THEMES)
