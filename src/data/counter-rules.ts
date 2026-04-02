import type { MechanicTag } from './champion-tags';

export interface CounterRule {
  id: string;
  nameKo: string;
  victimTags: MechanicTag[];   // champions with these tags are countered
  counterTags: MechanicTag[];  // by champions with these tags
  advantage: number;           // 0.05 - 0.15
}

// Tag-based counter rules: champion-level matchup inference
export const counterRules: CounterRule[] = [
  // Sustain vs anti-heal
  {
    id: 'heal_vs_antiheal',
    nameKo: '힐 vs 회복 감소',
    victimTags: ['heal'],
    counterTags: ['anti_heal'],
    advantage: 0.15,
  },

  // Poke vs dive
  {
    id: 'poke_vs_dive',
    nameKo: '포크 vs 다이브',
    victimTags: ['poke_long'],
    counterTags: ['diving'],
    advantage: 0.12,
  },

  // Tanks vs shred
  {
    id: 'tank_vs_shred',
    nameKo: '탱커 vs 탱커 파쇄',
    victimTags: ['diving'],
    counterTags: ['tank_shred'],
    advantage: 0.12,
  },

  // Sustained DPS vs burst
  {
    id: 'sustained_vs_burst_dive',
    nameKo: '지속딜 vs 버스트 다이브',
    victimTags: ['dps_sustained'],
    counterTags: ['burst'],
    advantage: 0.08,
  },

  // Zone vs mobility
  {
    id: 'zone_vs_dash',
    nameKo: '지형 장악 vs 기동력',
    victimTags: ['zone_control'],
    counterTags: ['dash_reset'],
    advantage: 0.08,
  },

  // Shield vs sustained damage (shields are less effective vs DPS)
  {
    id: 'shield_vs_dps',
    nameKo: '실드 vs 지속 딜',
    victimTags: ['shield'],
    counterTags: ['dps_sustained'],
    advantage: 0.06,
  },

  // Stealth vs zone control (revealed by AoE/traps)
  {
    id: 'stealth_vs_zone',
    nameKo: '은신 vs 지역 장악',
    victimTags: ['stealth'],
    counterTags: ['zone_control'],
    advantage: 0.10,
  },

  // Invulnerable counters burst (negates the window)
  {
    id: 'burst_vs_invulnerable',
    nameKo: '버스트 vs 무적',
    victimTags: ['burst'],
    counterTags: ['invulnerable'],
    advantage: 0.10,
  },

  // Engage is countered by peeling (knockup/zone disrupts dives)
  {
    id: 'dive_vs_peel',
    nameKo: '다이브 vs 필',
    victimTags: ['diving'],
    counterTags: ['knockup'],
    advantage: 0.08,
  },

  // Pull/hook counters immobile poke
  {
    id: 'poke_vs_pull',
    nameKo: '포크 vs 끌어오기',
    victimTags: ['poke_long'],
    counterTags: ['pull'],
    advantage: 0.10,
  },

  // Terrain counters dashes somewhat (trap them)
  {
    id: 'dash_vs_terrain',
    nameKo: '기동력 vs 지형 생성',
    victimTags: ['dash_reset'],
    counterTags: ['terrain_create'],
    advantage: 0.06,
  },

  // Single target CC counters hypercarries
  {
    id: 'carry_vs_lockdown',
    nameKo: '캐리 vs 단일 CC',
    victimTags: ['dps_sustained'],
    counterTags: ['single_target_cc'],
    advantage: 0.08,
  },
];
