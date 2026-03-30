import type { AramRole } from './aram-champion-meta';

export interface CompArchetype {
  id: string;
  name: string;
  nameKo: string;
  description: string;
  slots3: RoleSlot[];  // 3v3 slots
  slots4: RoleSlot[];  // 3v4 slots (4-player team)
  strengths: string[];
  weaknesses: string[];
}

export interface RoleSlot {
  label: string;
  roles: AramRole[];       // acceptable roles for this slot
  preferredRoles: AramRole[]; // ideal roles
}

export const compArchetypes: CompArchetype[] = [
  {
    id: 'poke',
    name: 'Poke',
    nameKo: '포크',
    description: '원거리에서 지속적으로 체력을 깎아 전투 전 유리한 상태를 만드는 조합',
    slots3: [
      { label: '메인 포커', roles: ['poke'], preferredRoles: ['poke'] },
      { label: '서브 포커/딜러', roles: ['poke', 'dps'], preferredRoles: ['poke'] },
      { label: '프론트/필', roles: ['tank', 'engage', 'utility'], preferredRoles: ['tank'] },
    ],
    slots4: [
      { label: '메인 포커', roles: ['poke'], preferredRoles: ['poke'] },
      { label: '서브 포커', roles: ['poke', 'dps'], preferredRoles: ['poke'] },
      { label: '프론트/필', roles: ['tank', 'engage', 'utility'], preferredRoles: ['tank'] },
      { label: '유틸/서브딜러', roles: ['utility', 'dps', 'sustain'], preferredRoles: ['utility'] },
    ],
    strengths: ['초반 화력', '시즈 능력', '안전한 딜링'],
    weaknesses: ['인게이지에 취약', '올 AP 위험', '근접전 약함'],
  },
  {
    id: 'engage',
    name: 'Engage',
    nameKo: '인게이지',
    description: '강력한 진입기로 전투를 주도하고 상대를 제압하는 조합',
    slots3: [
      { label: '메인 이니시', roles: ['engage'], preferredRoles: ['engage'] },
      { label: '딜러', roles: ['dps', 'poke'], preferredRoles: ['dps'] },
      { label: '서브 이니시/유틸', roles: ['engage', 'utility', 'tank'], preferredRoles: ['utility'] },
    ],
    slots4: [
      { label: '메인 이니시', roles: ['engage'], preferredRoles: ['engage'] },
      { label: '메인 딜러', roles: ['dps', 'poke'], preferredRoles: ['dps'] },
      { label: '서브 이니시/탱크', roles: ['engage', 'tank'], preferredRoles: ['engage'] },
      { label: '유틸/서브딜러', roles: ['utility', 'dps', 'sustain'], preferredRoles: ['utility'] },
    ],
    strengths: ['전투 주도권', '포크조합 카운터', '높은 CC'],
    weaknesses: ['서스테인에 약함', '실패시 리스크 큼', '포킹에 밀림'],
  },
  {
    id: 'sustain',
    name: 'Sustain',
    nameKo: '서스테인',
    description: '힐과 실드로 지속 전투력을 유지하며 후반 스케일링으로 승리하는 조합',
    slots3: [
      { label: '탱크/프론트', roles: ['tank', 'engage'], preferredRoles: ['tank'] },
      { label: '서스테인/유틸', roles: ['sustain', 'utility'], preferredRoles: ['utility'] },
      { label: '딜러', roles: ['dps', 'poke'], preferredRoles: ['dps'] },
    ],
    slots4: [
      { label: '탱크/프론트', roles: ['tank', 'engage'], preferredRoles: ['tank'] },
      { label: '서스테인/유틸', roles: ['sustain', 'utility'], preferredRoles: ['utility'] },
      { label: '메인 딜러', roles: ['dps', 'poke'], preferredRoles: ['dps'] },
      { label: '서브 딜러/유틸', roles: ['dps', 'utility', 'sustain'], preferredRoles: ['dps'] },
    ],
    strengths: ['후반 강함', '인게이지 대응', '팀 지속력'],
    weaknesses: ['포크에 밀림', '초반 약함', '화력 부족'],
  },
  {
    id: 'balanced',
    name: 'Balanced',
    nameKo: '밸런스',
    description: '각 역할을 균형있게 배치하여 상황 대응력을 극대화하는 조합',
    slots3: [
      { label: '포크/딜러', roles: ['poke', 'dps'], preferredRoles: ['poke', 'dps'] },
      { label: '탱크/인게이지', roles: ['tank', 'engage'], preferredRoles: ['tank', 'engage'] },
      { label: '유틸/서스테인', roles: ['utility', 'sustain', 'dps'], preferredRoles: ['utility'] },
    ],
    slots4: [
      { label: '포크/딜러', roles: ['poke', 'dps'], preferredRoles: ['poke', 'dps'] },
      { label: '탱크/인게이지', roles: ['tank', 'engage'], preferredRoles: ['tank', 'engage'] },
      { label: '유틸/서스테인', roles: ['utility', 'sustain'], preferredRoles: ['utility'] },
      { label: '서브 딜러', roles: ['dps', 'poke', 'sustain'], preferredRoles: ['dps'] },
    ],
    strengths: ['유연한 대응', '뚜렷한 약점 없음', 'AD/AP 밸런스'],
    weaknesses: ['특출난 강점 없음', '운영 의존적'],
  },
];

// Synergy pairs: [champion1, champion2, bonus_score, description]
export const synergyPairs: [string, string, number, string][] = [
  ['Malphite', 'Yasuo', 0.3, '말파 궁 + 야스오 궁 콤보'],
  ['Malphite', 'Yone', 0.25, '말파 궁 + 요네 궁 콤보'],
  ['Orianna', 'Malphite', 0.25, '오리아나 볼 + 말파 이니시'],
  ['Orianna', 'Wukong', 0.25, '오리아나 볼 + 오공 이니시'],
  ['Yasuo', 'Diana', 0.2, '다이아나 궁 + 야스오 궁'],
  ['Lulu', 'KogMaw', 0.25, '룰루 버프 + 코그모 딜'],
  ['Lulu', 'Jinx', 0.2, '룰루 버프 + 징크스 딜'],
  ['Amumu', 'Brand', 0.2, '아무무 궁 + 브랜드 궁 AoE'],
  ['Sona', 'Seraphine', 0.25, '소나 + 세라핀 더블 유틸'],
  ['Leona', 'MissFortune', 0.2, '레오나 CC + 미포 궁'],
  ['Thresh', 'Kalista', 0.2, '쓰레쉬 + 칼리스타 궁 콤보'],
  ['Jarvan IV', 'Brand', 0.2, '자르반 궁 + 브랜드 궁'],
  ['Galio', 'Camille', 0.15, '갈리오 궁 + 카밀 궁'],
  ['Zilean', 'Kayle', 0.15, '질리언 부활 + 카일 궁 이중 안전장치'],
];

// Counter matrix: comp archetype vs comp archetype advantage
export const counterMatrix: Record<string, Record<string, number>> = {
  poke: { engage: -0.15, sustain: 0.15, balanced: 0.05, poke: 0 },
  engage: { poke: 0.15, sustain: -0.15, balanced: 0.05, engage: 0 },
  sustain: { engage: 0.15, poke: -0.15, balanced: -0.05, sustain: 0 },
  balanced: { poke: -0.05, engage: -0.05, sustain: 0.05, balanced: 0 },
};
