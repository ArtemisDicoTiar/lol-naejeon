import type { Champion } from '@/lib/db';

export type ActiveSlot =
  | { type: 'ban'; team: 1 | 2; index: number }
  | { type: 'pick'; playerId: number }
  | null;

export const SKIP_BAN = '__SKIP__';

export type LaneRole = 'top' | 'jungle' | 'mid' | 'adc' | 'support';

export const LANE_LABELS: Record<LaneRole, string> = {
  top: '탑',
  jungle: '정글',
  mid: '미드',
  adc: '원딜',
  support: '서폿',
};

export const CHAMPION_LANES: Partial<Record<string, LaneRole>> = {
  Aatrox: 'top', Akali: 'mid', Akshan: 'mid', Ambessa: 'top', Camille: 'top',
  Chogath: 'top', Darius: 'top', DrMundo: 'top', Fiora: 'top', Gangplank: 'top',
  Garen: 'top', Gnar: 'top', Gragas: 'top', Gwen: 'top', Illaoi: 'top',
  Irelia: 'top', Jax: 'top', Jayce: 'top', KSante: 'top', Kayle: 'top',
  Kennen: 'top', Kled: 'top', Malphite: 'top', Mordekaiser: 'top', Nasus: 'top',
  Ornn: 'top', Pantheon: 'top', Poppy: 'top', Quinn: 'top', Renekton: 'top',
  Riven: 'top', Rumble: 'top', Sett: 'top', Shen: 'top', Singed: 'top',
  Sion: 'top', TahmKench: 'top', Teemo: 'top', Trundle: 'top', Tryndamere: 'top',
  Urgot: 'top', Vladimir: 'top', Volibear: 'top', Warwick: 'top', Wukong: 'top',
  Yorick: 'top',

  Amumu: 'jungle', BelVeth: 'jungle', Briar: 'jungle', Diana: 'jungle',
  Elise: 'jungle', Evelynn: 'jungle', Fiddlesticks: 'jungle', Graves: 'jungle',
  Hecarim: 'jungle', Ivern: 'jungle', JarvanIV: 'jungle', Karthus: 'jungle',
  Kayn: 'jungle', Khazix: 'jungle', Kindred: 'jungle', LeeSin: 'jungle',
  Lillia: 'jungle', MasterYi: 'jungle', Nidalee: 'jungle', Nocturne: 'jungle',
  Nunu: 'jungle', Rammus: 'jungle', RekSai: 'jungle', Rengar: 'jungle',
  Sejuani: 'jungle', Shaco: 'jungle', Shyvana: 'jungle', Skarner: 'jungle',
  Taliyah: 'jungle', Udyr: 'jungle', Vi: 'jungle', Viego: 'jungle', XinZhao: 'jungle',
  Zac: 'jungle',

  Ahri: 'mid', Anivia: 'mid', Annie: 'mid', AurelionSol: 'mid', Aurora: 'mid',
  Azir: 'mid', Brand: 'mid', Cassiopeia: 'mid', Corki: 'mid', Ekko: 'mid',
  Fizz: 'mid', Galio: 'mid', Heimerdinger: 'mid', Hwei: 'mid', Kassadin: 'mid',
  Katarina: 'mid', LeBlanc: 'mid', Lissandra: 'mid', Lux: 'mid', Malzahar: 'mid',
  Mel: 'mid', Naafiri: 'mid', Neeko: 'mid', Orianna: 'mid', Qiyana: 'mid',
  Ryze: 'mid', Swain: 'mid', Sylas: 'mid', Syndra: 'mid', Talon: 'mid',
  TwistedFate: 'mid', Veigar: 'mid', Velkoz: 'mid', Vex: 'mid', Viktor: 'mid',
  Xerath: 'mid', Yasuo: 'mid', Yone: 'mid', Zoe: 'mid', Zyra: 'mid',

  Aphelios: 'adc', Ashe: 'adc', Caitlyn: 'adc', Draven: 'adc', Ezreal: 'adc',
  Jhin: 'adc', Jinx: 'adc', Kaisa: 'adc', Kalista: 'adc', KogMaw: 'adc',
  Lucian: 'adc', MissFortune: 'adc', Nilah: 'adc', Samira: 'adc', Senna: 'adc',
  Sivir: 'adc', Smolder: 'adc', Tristana: 'adc', Twitch: 'adc', Varus: 'adc',
  Vayne: 'adc', Xayah: 'adc', Zeri: 'adc',

  Alistar: 'support', Bard: 'support', Blitzcrank: 'support', Braum: 'support',
  Janna: 'support', Karma: 'support', Leona: 'support', Lulu: 'support',
  Milio: 'support', Morgana: 'support', Nami: 'support', Nautilus: 'support',
  Pyke: 'support', Rakan: 'support', Rell: 'support', Renata: 'support',
  Seraphine: 'support', Sona: 'support', Soraka: 'support', Taric: 'support',
  Thresh: 'support', Yuumi: 'support', Zilean: 'support',
};

export function getChampionLane(champion: Champion): LaneRole {
  const mapped = CHAMPION_LANES[champion.id];
  if (mapped) return mapped;
  if (champion.tags.includes('Marksman')) return 'adc';
  if (champion.tags.includes('Support')) return 'support';
  if (champion.tags.includes('Assassin') || champion.tags.includes('Mage')) return 'mid';
  if (champion.tags.includes('Tank') || champion.tags.includes('Fighter')) return 'top';
  return 'mid';
}
