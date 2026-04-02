import type { MechanicTag } from './champion-tags';

export interface SynergyRule {
  id: string;
  nameKo: string;
  source: MechanicTag[];
  target: MechanicTag[];
  bonus: number;
  stackable: boolean;
}

// Tag-based synergy rules: ~20 rules covering hundreds of champion combinations
export const synergyRules: SynergyRule[] = [
  // CC + follow-up combos
  {
    id: 'knockup_followup',
    nameKo: '넉업 콤보',
    source: ['knockup'],
    target: ['dps_sustained'],  // Yasuo/Yone/ADCs benefit from knockup setup
    bonus: 0.12,
    stackable: false,
  },
  {
    id: 'aoe_cc_chain',
    nameKo: 'AoE CC 체인',
    source: ['aoe_cc'],
    target: ['aoe_cc'],
    bonus: 0.10,
    stackable: true,
  },
  {
    id: 'aoe_cc_burst',
    nameKo: 'CC + AoE 폭딜',
    source: ['aoe_cc'],
    target: ['burst'],
    bonus: 0.12,
    stackable: false,
  },
  {
    id: 'pull_burst',
    nameKo: '끌어오기 + 원콤',
    source: ['pull'],
    target: ['burst'],
    bonus: 0.14,
    stackable: false,
  },
  {
    id: 'lockdown_followup',
    nameKo: '단일 CC + 폭딜',
    source: ['single_target_cc'],
    target: ['burst'],
    bonus: 0.08,
    stackable: false,
  },

  // Enchanter + carry combos
  {
    id: 'enchanter_hypercarry',
    nameKo: '인챈터 + 하이퍼캐리',
    source: ['attack_steroid'],
    target: ['dps_sustained'],
    bonus: 0.15,
    stackable: false,
  },
  {
    id: 'shield_dps',
    nameKo: '실드 + 딜러 보호',
    source: ['shield'],
    target: ['dps_sustained'],
    bonus: 0.08,
    stackable: false,
  },
  {
    id: 'heal_frontline',
    nameKo: '힐 + 프론트라인',
    source: ['heal'],
    target: ['diving'],
    bonus: 0.10,
    stackable: false,
  },
  {
    id: 'speed_poke',
    nameKo: '이속 버프 + 카이팅',
    source: ['speed_buff'],
    target: ['poke_long'],
    bonus: 0.08,
    stackable: false,
  },
  {
    id: 'speed_engage',
    nameKo: '이속 버프 + 인게이지',
    source: ['speed_buff'],
    target: ['diving'],
    bonus: 0.08,
    stackable: false,
  },

  // Zone + poke combos
  {
    id: 'zone_poke',
    nameKo: '지형 장악 + 포크',
    source: ['zone_control'],
    target: ['poke_long'],
    bonus: 0.10,
    stackable: true,
  },
  {
    id: 'terrain_aoe_cc',
    nameKo: '지형 생성 + AoE CC',
    source: ['terrain_create'],
    target: ['aoe_cc'],
    bonus: 0.10,
    stackable: false,
  },

  // Dive team combos
  {
    id: 'dive_dive',
    nameKo: '다중 다이브',
    source: ['diving'],
    target: ['diving'],
    bonus: 0.08,
    stackable: true,
  },
  {
    id: 'engage_followup_burst',
    nameKo: '다이브 + 뒤따르는 버스트',
    source: ['diving'],
    target: ['burst'],
    bonus: 0.08,
    stackable: false,
  },

  // Safety net combos
  {
    id: 'double_safety',
    nameKo: '이중 안전장치',
    source: ['revive'],
    target: ['invulnerable'],
    bonus: 0.12,
    stackable: false,
  },
  {
    id: 'revive_carry',
    nameKo: '부활 + 캐리 보호',
    source: ['revive'],
    target: ['dps_sustained'],
    bonus: 0.10,
    stackable: false,
  },

  // Execute combo
  {
    id: 'cc_execute',
    nameKo: 'CC + 처형',
    source: ['aoe_cc'],
    target: ['execute'],
    bonus: 0.08,
    stackable: false,
  },

  // Sustained poke
  {
    id: 'double_poke',
    nameKo: '이중 포크',
    source: ['poke_long'],
    target: ['poke_long'],
    bonus: 0.10,
    stackable: true,
  },

  // Reset team
  {
    id: 'reset_team',
    nameKo: '리셋 팀파이트',
    source: ['dash_reset'],
    target: ['dash_reset'],
    bonus: 0.06,
    stackable: false,
  },
];

// Specific champion pair overrides that can't be captured by tags alone
export const synergyOverrides: [string, string, number, string][] = [
  ['Thresh', 'Kalista', 0.20, '쓰레쉬 + 칼리스타 궁 콤보'],
  ['Yasuo', 'Diana', 0.10, '다이아나 궁 모으기 + 야스오 궁'],
  ['Yone', 'Diana', 0.10, '다이아나 궁 모으기 + 요네 궁'],
  ['Nilah', 'Taric', 0.10, '닐라 + 타릭 근접 시너지'],
];
