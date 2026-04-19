import type { MechanicTag } from './champion-tags';

export const TAG_LABELS: Partial<Record<MechanicTag, string>> = {
  knockup: '넉업',
  pull: '끌어오기',
  aoe_cc: 'AoE CC',
  single_target_cc: '단일 CC',
  shield: '쉴드',
  heal: '힐',
  speed_buff: '이속 버프',
  attack_steroid: '공격 버프',
  zone_control: '구역 장악',
  poke_long: '롱 포크',
  poke_mid: '미드 포크',
  burst: '버스트',
  dps_sustained: '지속 딜',
  execute: '처형',
  revive: '부활',
  invulnerable: '무적',
  terrain_create: '지형 생성',
  anti_heal: '치유 감소',
  tank_shred: '탱커 파쇄',
  diving: '다이브',
  dash_reset: '리셋 대쉬',
  stealth: '은신',
};

export const TAG_COLORS: Partial<Record<MechanicTag, string>> = {
  heal: 'bg-green-800/60 text-green-300',
  shield: 'bg-cyan-800/60 text-cyan-300',
  anti_heal: 'bg-red-800/60 text-red-300',
  knockup: 'bg-yellow-800/60 text-yellow-300',
  aoe_cc: 'bg-yellow-800/60 text-yellow-300',
  pull: 'bg-yellow-800/60 text-yellow-300',
  single_target_cc: 'bg-yellow-800/60 text-yellow-300',
  burst: 'bg-orange-800/60 text-orange-300',
  dps_sustained: 'bg-orange-800/60 text-orange-300',
  tank_shred: 'bg-red-800/60 text-red-300',
  revive: 'bg-emerald-800/60 text-emerald-300',
  invulnerable: 'bg-emerald-800/60 text-emerald-300',
};

export function getTagLabel(tag: MechanicTag): string {
  return TAG_LABELS[tag] ?? tag;
}

export function getTagColor(tag: MechanicTag): string {
  return TAG_COLORS[tag] ?? 'bg-lol-blue text-lol-gold-light/60';
}
