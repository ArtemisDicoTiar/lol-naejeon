import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import type { Champion, Player, ProficiencyLevel, GameMode } from '@/lib/db';
import { GAME_MODE_LABELS } from '@/lib/db';
import type { RecommendedComp } from '@/lib/recommendation/types';
import { generateRecommendations, generatePerPlayerBanRecs, getPlayerTopChampions } from '@/lib/recommendation/engine';
import { computeWinrateStats, estimateCompWinrate, type WinrateStats } from '@/lib/recommendation/winrate';
import { scoreComposition } from '@/lib/recommendation/scoring';
import { loadSynergyCounterData, type SynergyCounterData } from '@/lib/recommendation/data-loader';
import { estimatePlayerProficiencies, type EstimatedProficiency } from '@/lib/recommendation/proficiency-estimator';
import { championTraits, type MechanicTag } from '@/data/champion-tags';
import { getTagColor, getTagLabel, TAG_LABELS } from '@/data/tag-display';
import { ARAM_ROLE_LABELS, type AramRole } from '@/data/aram-champion-meta';
import { ChampionIcon } from '@/components/champions/ChampionIcon';
import { ChampionWithHover } from '@/components/champions/ChampionWithHover';
import { ProficiencyBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { StreakStrip } from '@/components/stats/StreakStrip';
import { SideStatsBadge } from '@/components/stats/SideStatsBadge';
import { useLcuContext, useIdentityContext } from '@/App';

interface BanPickScreenProps {
  format: '3v3' | '3v4';
  mode?: GameMode;
  team1PlayerIds: number[];
  team2PlayerIds: number[];
  players: Player[];
  champions: Champion[];
  fierlessBans: string[];
  proficiencies: Record<number, Map<string, ProficiencyLevel>>;
  onConfirm: (result: { bans: Record<1 | 2, string[]>; picks: Record<number, string> }) => void;
  onBack: () => void;
  onReorderTeams?: (team1: number[], team2: number[]) => void;
}

type ActiveSlot =
  | { type: 'ban'; team: 1 | 2; index: number }
  | { type: 'pick'; playerId: number }
  | null;

const SKIP_BAN = '__SKIP__';
type LaneRole = 'top' | 'jungle' | 'mid' | 'adc' | 'support';

const LANE_LABELS: Record<LaneRole, string> = {
  top: '탑',
  jungle: '정글',
  mid: '미드',
  adc: '원딜',
  support: '서폿',
};

const STATIC_ICON_BASE = 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images';
const CHAMP_SELECT_SVG_BASE = 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-champ-select/global/default/svg';
const SPELL_ICON_BASE = 'https://raw.communitydragon.org/latest/game/assets/spells/icons2d';

const ROLE_ICON_URLS: Record<AramRole, string> = {
  poke: `${STATIC_ICON_BASE}/npe-ft-role-icon-mage.png`,
  engage: `${STATIC_ICON_BASE}/npe-ft-role-icon-fighter.png`,
  sustain: `${STATIC_ICON_BASE}/npe-ft-role-icon-support.png`,
  dps: `${STATIC_ICON_BASE}/npe-ft-role-icon-marksman.png`,
  tank: `${STATIC_ICON_BASE}/npe-ft-role-icon-tank.png`,
  utility: `${STATIC_ICON_BASE}/npe-ft-role-icon-support.png`,
};

const ROLE_SHORT_LABELS: Record<AramRole, string> = {
  poke: '포크',
  engage: '이니시',
  sustain: '유지',
  dps: 'DPS',
  tank: '탱커',
  utility: '유틸',
};

const LANE_ICON_URLS: Record<LaneRole, string> = {
  top: `${CHAMP_SELECT_SVG_BASE}/position-top.svg`,
  jungle: `${CHAMP_SELECT_SVG_BASE}/position-jungle.svg`,
  mid: `${CHAMP_SELECT_SVG_BASE}/position-middle.svg`,
  adc: `${CHAMP_SELECT_SVG_BASE}/position-bottom.svg`,
  support: `${CHAMP_SELECT_SVG_BASE}/position-utility.svg`,
};

const TAG_ICONS: Partial<Record<MechanicTag, string>> = {
  knockup: '↑',
  pull: '⌁',
  aoe_cc: '◎',
  single_target_cc: '●',
  shield: '⬡',
  heal: '+',
  speed_buff: '»',
  attack_steroid: '▲',
  zone_control: '▣',
  poke_long: '↗',
  poke_mid: '→',
  burst: '✦',
  dps_sustained: '∞',
  execute: '!',
  revive: '↺',
  invulnerable: '◇',
  terrain_create: '▥',
  anti_heal: '⊘',
  tank_shred: '▽',
  diving: '↯',
  dash_reset: '↻',
  stealth: '◌',
};

const TAG_ICON_URLS: Partial<Record<MechanicTag, string>> = {
  knockup: `${SPELL_ICON_BASE}/summoner_exhaust.png`,
  pull: `${SPELL_ICON_BASE}/summoner_exhaust.png`,
  aoe_cc: `${SPELL_ICON_BASE}/summoner_exhaust.png`,
  single_target_cc: `${SPELL_ICON_BASE}/summoner_exhaust.png`,
  shield: `${SPELL_ICON_BASE}/035_tower_shield.png`,
  heal: `${SPELL_ICON_BASE}/summoner_heal.png`,
  speed_buff: `${SPELL_ICON_BASE}/summoner_haste.png`,
  attack_steroid: `${STATIC_ICON_BASE}/npe-ft-role-icon-marksman.png`,
  zone_control: `${STATIC_ICON_BASE}/flag.svg`,
  poke_long: `${STATIC_ICON_BASE}/npe-ft-role-icon-mage.png`,
  poke_mid: `${STATIC_ICON_BASE}/npe-ft-role-icon-mage.png`,
  burst: `${STATIC_ICON_BASE}/npe-ft-role-icon-assassin.png`,
  dps_sustained: `${STATIC_ICON_BASE}/npe-ft-role-icon-marksman.png`,
  execute: `${STATIC_ICON_BASE}/exclamation-point.svg`,
  revive: `${SPELL_ICON_BASE}/summoner_revive.png`,
  invulnerable: `${SPELL_ICON_BASE}/summoner_boost.png`,
  terrain_create: `${STATIC_ICON_BASE}/flag.svg`,
  anti_heal: `${SPELL_ICON_BASE}/summoner_exhaust.png`,
  tank_shred: `${STATIC_ICON_BASE}/npe-ft-role-icon-fighter.png`,
  diving: `${STATIC_ICON_BASE}/npe-ft-role-icon-fighter.png`,
  dash_reset: `${STATIC_ICON_BASE}/loop-arrow.svg`,
  stealth: `${SPELL_ICON_BASE}/icon_summonerspell_vanish.png`,
};

const TAG_SHORT_LABELS: Partial<Record<MechanicTag, string>> = {
  knockup: '넉업',
  pull: '끌기',
  aoe_cc: '광역',
  single_target_cc: '단일',
  shield: '쉴드',
  heal: '힐',
  speed_buff: '이속',
  attack_steroid: '공속',
  zone_control: '장악',
  poke_long: '장거리',
  poke_mid: '중거리',
  burst: '버스트',
  dps_sustained: '지속',
  execute: '처형',
  revive: '부활',
  invulnerable: '무적',
  terrain_create: '지형',
  anti_heal: '치감',
  tank_shred: '탱파',
  diving: '다이브',
  dash_reset: '리셋',
  stealth: '은신',
};

const CHAMPION_LANES: Partial<Record<string, LaneRole>> = {
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

function getChampionLane(champion: Champion): LaneRole {
  const mapped = CHAMPION_LANES[champion.id];
  if (mapped) return mapped;
  if (champion.tags.includes('Marksman')) return 'adc';
  if (champion.tags.includes('Support')) return 'support';
  if (champion.tags.includes('Assassin') || champion.tags.includes('Mage')) return 'mid';
  if (champion.tags.includes('Tank') || champion.tags.includes('Fighter')) return 'top';
  return 'mid';
}

function normalizePlayerKey(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]/g, '');
}

function ensureBanSlotCount(bans: string[], size: number): string[] {
  if (bans.length === size) return bans;
  return [...bans.slice(0, size), ...Array(Math.max(0, size - bans.length)).fill('')];
}

function FilterIconButton({
  active,
  icon,
  label,
  title,
  onClick,
  dense = false,
}: {
  active: boolean;
  icon?: string;
  label: string;
  title: string;
  onClick: () => void;
  dense?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`flex cursor-pointer items-center justify-center rounded border transition-colors ${
        dense ? 'h-8 min-w-[3.35rem] gap-1 px-1.5' : 'h-9 min-w-[3rem] flex-col gap-0.5 px-1'
      } ${
        active
          ? 'border-lol-gold bg-lol-gold/20 text-lol-gold shadow-[0_0_10px_rgba(200,155,60,0.10)]'
          : 'border-lol-border bg-lol-blue/55 text-lol-gold-light/55 hover:border-lol-gold/50 hover:text-lol-gold-light'
      }`}
    >
      {icon ? (
        <img
          src={icon}
          alt=""
          className={`${dense ? 'h-4 w-4' : 'h-[18px] w-[18px]'} object-contain ${active ? '' : 'opacity-70 grayscale-[25%]'}`}
          loading="lazy"
        />
      ) : (
        <span className="text-xs font-bold">{label.slice(0, 1)}</span>
      )}
      <span className={`${dense ? 'max-w-10' : 'max-w-11'} truncate text-[9px] font-semibold leading-none`}>
        {label}
      </span>
    </button>
  );
}

type CounterSuggestion = {
  champion: Champion;
  target?: Champion;
  winrate?: number;
  games?: number;
  score: number;
  source: 'matchup' | 'role';
  reason: string;
};

const COUNTER_MIN_GAMES = 30;
const ROLE_COUNTERS: Record<AramRole, AramRole[]> = {
  poke: ['engage', 'tank'],
  engage: ['sustain', 'utility'],
  sustain: ['poke', 'dps'],
  dps: ['engage', 'tank'],
  tank: ['poke', 'dps'],
  utility: ['engage', 'poke'],
};
const TIER_RANK: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, D: 4 };

function formatGamesShort(games: number) {
  return games >= 1000 ? `${(games / 1000).toFixed(1)}k` : games.toLocaleString('ko-KR');
}

export function BanPickScreen({
  format, mode = 'aram', team1PlayerIds, team2PlayerIds, players, champions,
  fierlessBans, proficiencies, onConfirm, onBack, onReorderTeams,
}: BanPickScreenProps) {
  const { userId } = useIdentityContext();
  const team1Size = team1PlayerIds.length;
  const team2Size = team2PlayerIds.length;
  // Content signatures so effects can depend on team membership rather than
  // array reference identity (parent re-renders churn the references).
  const team1Sig = team1PlayerIds.join(',');
  const team2Sig = team2PlayerIds.join(',');

  // Ban state: each team bans as many as their OWN player count
  const [team1Bans, setTeam1Bans] = useState<string[]>(Array(team1Size).fill(''));
  const [team2Bans, setTeam2Bans] = useState<string[]>(Array(team2Size).fill(''));
  const [picks, setPicks] = useState<Record<number, string>>({});
  const [activeSlot, setActiveSlot] = useState<ActiveSlot>(
    team1PlayerIds[0] ? { type: 'pick', playerId: team1PlayerIds[0] } : null,
  );
  const [search, setSearch] = useState('');
  const [phase, setPhase] = useState<'planning' | 'ban' | 'pick'>('planning');
  const [planningTimer, setPlanningTimer] = useState(25);
  const [lockedPicks, setLockedPicks] = useState<Set<number>>(new Set());
  const [lockedBans, setLockedBans] = useState<Set<string>>(new Set()); // "team-index" keys
  const [sortMode, setSortMode] = useState<'auto' | 'name' | 'tier' | 'winrate'>('auto');
  const [roleFilter, setRoleFilter] = useState<AramRole | null>(null);
  const [laneFilter, setLaneFilter] = useState<LaneRole | null>(null);
  const [traitFilter, setTraitFilter] = useState<MechanicTag | null>(null);
  const [lcuPaused, setLcuPaused] = useState(false); // pause LCU sync after manual reset
  const [wrStats, setWrStats] = useState<WinrateStats | null>(null);
  const [matchData, setMatchData] = useState<SynergyCounterData | null>(null);
  const lcu = useLcuContext();
  const searchComposingRef = useRef(false);

  useEffect(() => {
    setTeam1Bans((prev) => ensureBanSlotCount(prev, team1Size));
    setTeam2Bans((prev) => ensureBanSlotCount(prev, team2Size));
    setLockedBans((prev) => {
      const next = new Set<string>();
      for (const key of prev) {
        const [team, indexRaw] = key.split('-');
        const index = Number(indexRaw);
        if ((team === '1' && index < team1Size) || (team === '2' && index < team2Size)) {
          next.add(key);
        }
      }
      return next.size === prev.size ? prev : next;
    });
  }, [team1Size, team2Size]);

  useEffect(() => { computeWinrateStats().then(setWrStats); }, []);
  useEffect(() => { loadSynergyCounterData().then(setMatchData); }, []);

  // Use LCU timer if connected, otherwise local countdown
  const lcuTimeLeft = lcu.connected && lcu.lastState?.timeLeft != null ? lcu.lastState.timeLeft : null;
  const displayTimer = lcuTimeLeft !== null ? lcuTimeLeft : (phase === 'planning' ? planningTimer : null);

  // Planning phase: local timer countdown (fallback when LCU not connected)
  useEffect(() => {
    if (phase !== 'planning') return;
    if (lcu.connected) return; // LCU handles phase transition
    if (planningTimer <= 0) {
      setPhase('ban');
      setActiveSlot({ type: 'ban', team: 1, index: 0 });
      return;
    }
    const id = setTimeout(() => setPlanningTimer(t => t - 1), 1000);
    return () => clearTimeout(id);
  }, [phase, planningTimer, lcu.connected]);

  // --- LCU Bridge: auto-apply champion select data ---
  // Build numeric champion key → string ID mapping from Data Dragon
  const [champKeyMap, setChampKeyMap] = useState<Map<number, string>>(new Map());
  useEffect(() => {
    // Fetch champion data to get numeric key mapping
    fetch('https://ddragon.leagueoflegends.com/api/versions.json')
      .then(r => r.json())
      .then(versions => fetch(`https://ddragon.leagueoflegends.com/cdn/${versions[0]}/data/ko_KR/champion.json`))
      .then(r => r.json())
      .then(data => {
        const map = new Map<number, string>();
        for (const [key, champ] of Object.entries(data.data as Record<string, any>)) {
          map.set(parseInt(champ.key), key);
        }
        setChampKeyMap(map);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reverse map: string champion ID → numeric ID (for sending to LCU)
  const champIdToNumeric = useMemo(() => {
    const map = new Map<string, number>();
    for (const [num, str] of champKeyMap) map.set(str, num);
    return map;
  }, [champKeyMap]);

  const playerNameToId = useMemo(() => {
    const map = new Map<string, number>();
    for (const player of players) {
      map.set(player.name, player.id!);
      map.set(normalizePlayerKey(player.name), player.id!);
    }
    return map;
  }, [players]);

  const resolvePlayerIdFromLcuName = useCallback((alias?: string | null, gameName?: string | null) => {
    for (const value of [alias, gameName]) {
      if (!value) continue;
      const direct = playerNameToId.get(value);
      if (direct) return direct;
      const normalized = playerNameToId.get(normalizePlayerKey(value));
      if (normalized) return normalized;
    }
    return undefined;
  }, [playerNameToId]);

  // Resume LCU sync when a new champ select starts (different state from what caused pause)
  useEffect(() => {
    if (lcuPaused && lcu.champSelectActive) {
      setLcuPaused(false);
    }
  }, [lcu.champSelectActive, lcuPaused]);

  // Apply LCU state to ban/pick slots
  useEffect(() => {
    if (lcuPaused) return;
    if (!lcu.lastState) return;
    if (champKeyMap.size === 0) {
      console.log('[LCU] champKeyMap not loaded yet, skipping');
      return;
    }
    const state = lcu.lastState;
    const lcuPhase = state.phase?.toUpperCase() ?? '';
    const sortLcuPicks = (lcuPicks: typeof state.team1Picks) =>
      [...lcuPicks].sort((a, b) => a.cellId - b.cellId);

    const sortedTeam1LcuPicks = sortLcuPicks(state.team1Picks);
    const sortedTeam2LcuPicks = sortLcuPicks(state.team2Picks);

    const buildAlignedTeamFromLcu = (lcuPicks: typeof state.team1Picks, currentIds: number[]) => {
      const slots = lcuPicks.map((p) => resolvePlayerIdFromLcuName(p.alias, p.gameName));
      const matched = new Set(slots.filter((id): id is number => typeof id === 'number'));
      const remaining = currentIds.filter((id) => !matched.has(id));
      return slots
        .map((id) => id ?? remaining.shift())
        .filter((id): id is number => typeof id === 'number');
    };

    const lcuT1 = buildAlignedTeamFromLcu(sortedTeam1LcuPicks, team1PlayerIds);
    const lcuT2 = buildAlignedTeamFromLcu(sortedTeam2LcuPicks, team2PlayerIds);
    const hasResolvedLcuPlayer = [...sortedTeam1LcuPicks, ...sortedTeam2LcuPicks]
      .some((p) => resolvePlayerIdFromLcuName(p.alias, p.gameName));

    // Rebuild team assignments from LCU data (always, regardless of phase)
    if (hasResolvedLcuPlayer) {
      const matched = new Set([...lcuT1, ...lcuT2]);
      for (const id of team1PlayerIds) { if (!matched.has(id)) lcuT1.push(id); }
      for (const id of team2PlayerIds) { if (!matched.has(id)) lcuT2.push(id); }
      const t1Changed = JSON.stringify(lcuT1) !== JSON.stringify(team1PlayerIds);
      const t2Changed = JSON.stringify(lcuT2) !== JSON.stringify(team2PlayerIds);
      if ((t1Changed || t2Changed) && onReorderTeams) onReorderTeams(lcuT1, lcuT2);
    }

    // PLANNING phase: apply picks as tentative (hover) but don't lock-in or change phase
    if (lcuPhase === 'PLANNING') {
      const applyHovers = (lcuPicks: typeof state.team1Picks, alignedIds: number[]) => {
        const result: Record<number, string> = {};
        lcuPicks.forEach((p, i) => {
          if (p.champId <= 0) return;
          const champStrId = champKeyMap.get(p.champId);
          if (!champStrId) return;
          const playerId = resolvePlayerIdFromLcuName(p.alias, p.gameName) ?? alignedIds[i];
          if (playerId) result[playerId] = champStrId;
        });
        return result;
      };
      const hovers1 = applyHovers(sortedTeam1LcuPicks, lcuT1);
      const hovers2 = applyHovers(sortedTeam2LcuPicks, lcuT2);
      if (Object.keys(hovers1).length > 0 || Object.keys(hovers2).length > 0) {
        setPicks(prev => ({ ...prev, ...hovers1, ...hovers2 }));
        // Stay in planning phase, don't lock, don't advance
      }
      return;
    }

    // BAN phase: auto-transition from planning if LCU enters ban phase
    if (phase === 'planning' && (lcuPhase === 'BAN_PICK' || lcuPhase === 'BANNING')) {
      setPhase('ban');
      setActiveSlot({ type: 'ban', team: 1, index: 0 });
    }

    // Apply bans
    console.log('[LCU] raw bans T1:', JSON.stringify(state.team1Bans), 'T2:', JSON.stringify(state.team2Bans));
    const lcuBans1 = state.team1Bans.map(b => ({ champId: champKeyMap.get(b.championId) ?? '', completed: b.completed })).filter(b => b.champId);
    const lcuBans2 = state.team2Bans.map(b => ({ champId: champKeyMap.get(b.championId) ?? '', completed: b.completed })).filter(b => b.champId);
    console.log('[LCU] resolved bans T1:', JSON.stringify(lcuBans1), 'T2:', JSON.stringify(lcuBans2));

    if (lcuBans1.length > 0) {
      setTeam1Bans(prev => {
        const size = team1PlayerIds.length;
        const newBans = [...ensureBanSlotCount(prev, size)];
        lcuBans1.slice(0, size).forEach((b, i) => { newBans[i] = b.champId; });
        return newBans;
      });
    }
    if (lcuBans2.length > 0) {
      setTeam2Bans(prev => {
        const size = team2PlayerIds.length;
        const newBans = [...ensureBanSlotCount(prev, size)];
        lcuBans2.slice(0, size).forEach((b, i) => { newBans[i] = b.champId; });
        return newBans;
      });
    }

    // Auto lock-in completed bans
    const newLockedBans = new Set(lockedBans);
    let banLockChanged = false;
    lcuBans1.forEach((b, i) => { if (b.completed && !newLockedBans.has(`1-${i}`)) { newLockedBans.add(`1-${i}`); banLockChanged = true; } });
    lcuBans2.forEach((b, i) => { if (b.completed && !newLockedBans.has(`2-${i}`)) { newLockedBans.add(`2-${i}`); banLockChanged = true; } });
    if (banLockChanged) setLockedBans(newLockedBans);

    // Auto-transition to pick phase ONLY when LCU explicitly says we're past ban (not just because we filled all bans)
    // This prevents ban recs from disappearing the moment the last ban is locked
    const lcuPastBan = lcuPhase && lcuPhase !== 'BAN_PICK' && lcuPhase !== 'PLANNING' && lcuPhase !== 'BANNING';
    if (lcuPastBan && (phase === 'ban' || phase === 'planning')) {
      setPhase('pick');
      const firstInDraft = draftOrder.find((id) => !picks[id]);
      setActiveSlot(firstInDraft ? { type: 'pick', playerId: firstInDraft } : null);
    }

    // Apply picks: during any phase except pure BAN_PICK with no completed bans
    const isBanPhaseOnly = lcuPhase === 'BAN_PICK' && [...lcuBans1, ...lcuBans2].every(b => !b.completed);
    if (!isBanPhaseOnly) {
      const applyPicks = (lcuPicks: typeof state.team1Picks, alignedIds: number[]) => {
        const result: Record<number, string> = {};
        lcuPicks.forEach((p, i) => {
          // Only apply picks that have a locked champion or are in pick actions (not hover during ban)
          if (p.champId <= 0) return;
          const champStrId = champKeyMap.get(p.champId);
          if (!champStrId) return;
          const playerId = resolvePlayerIdFromLcuName(p.alias, p.gameName) ?? alignedIds[i];
          if (playerId) result[playerId] = champStrId;
        });
        return result;
      };

      const picks1 = applyPicks(sortedTeam1LcuPicks, lcuT1);
      const picks2 = applyPicks(sortedTeam2LcuPicks, lcuT2);

      if (Object.keys(picks1).length > 0 || Object.keys(picks2).length > 0) {
        setPicks(prev => ({ ...prev, ...picks1, ...picks2 }));
        setPhase('pick');
      }
    }

    // Auto lock-in: match by alias first, then by position fallback
    const lockFromLcu = (lcuPicks: typeof state.team1Picks, alignedIds: number[]) => {
      const result: number[] = [];
      lcuPicks.forEach((p, i) => {
        if (!p.locked || p.champId <= 0) return;
        const playerId = resolvePlayerIdFromLcuName(p.alias, p.gameName) ?? alignedIds[i];
        if (playerId) result.push(playerId);
      });
      return result;
    };

    const locked1 = lockFromLcu(sortedTeam1LcuPicks, lcuT1);
    const locked2 = lockFromLcu(sortedTeam2LcuPicks, lcuT2);
    const allToLock = [...locked1, ...locked2];

    if (allToLock.length > 0) {
      setLockedPicks(prev => {
        const next = new Set(prev);
        let changed = false;
        for (const pid of allToLock) {
          if (!next.has(pid)) { next.add(pid); changed = true; }
        }
        return changed ? next : prev;
      });
    }
    // Use content-based signatures for team IDs so we don't re-run when the
    // parent re-renders and passes a new array reference. onReorderTeams is now
    // wrapped in useCallback in NewGame.tsx so it has a stable identity.
  }, [lcu.lastState, champKeyMap, team1Sig, team2Sig, players, onReorderTeams, resolvePlayerIdFromLcuName]);

  // Estimated proficiencies: auto-estimate for champions without manual proficiency
  const { mergedProficiencies, estimatedMap } = useMemo(() => {
    if (!wrStats) return { mergedProficiencies: proficiencies, estimatedMap: new Map<string, Map<string, EstimatedProficiency>>() };

    const champIds = champions.map((c) => c.id);
    const aramWrMap = new Map(champions.map((c) => [c.id, c.aramWinrate]));
    const allPlayerIds = [...team1PlayerIds, ...team2PlayerIds];
    const estMap = new Map<string, Map<string, EstimatedProficiency>>();
    const merged = { ...proficiencies };

    for (const pid of allPlayerIds) {
      const manual = proficiencies[pid] ?? new Map();
      const estimates = estimatePlayerProficiencies(pid, manual, champIds, aramWrMap, wrStats);
      estMap.set(String(pid), estimates);

      // Merge: manual proficiency takes priority, estimated fills gaps
      if (estimates.size > 0) {
        const mergedMap = new Map(manual);
        for (const [champId, est] of estimates) {
          if (!mergedMap.has(champId) || mergedMap.get(champId) === '없음') {
            mergedMap.set(champId, est.level);
          }
        }
        merged[pid] = mergedMap;
      }
    }

    return { mergedProficiencies: merged, estimatedMap: estMap };
  }, [wrStats, proficiencies, champions, team1PlayerIds, team2PlayerIds]);

  const getPlayerName = (id: number) => players.find((p) => p.id === id)?.name ?? '';
  const getTeamBans = (team: 1 | 2) => team === 1 ? team1Bans : team2Bans;
  const setTeamBans = (team: 1 | 2, bans: string[]) => team === 1 ? setTeam1Bans(bans) : setTeam2Bans(bans);

  // All banned champion ids (fierless + game bans, excluding SKIP)
  const allBannedIds = useMemo(() => {
    const gameBans = [...team1Bans, ...team2Bans].filter((b) => b && b !== SKIP_BAN);
    return new Set([...fierlessBans, ...gameBans]);
  }, [fierlessBans, team1Bans, team2Bans]);

  const pickedIds = useMemo(() => new Set(Object.values(picks)), [picks]);

  // Available champions (not fierless, not game-banned, not picked)
  const availableChampions = useMemo(() => {
    return champions.filter((c) => !allBannedIds.has(c.id) && !pickedIds.has(c.id));
  }, [champions, allBannedIds, pickedIds]);

  const championById = useMemo(() => new Map(champions.map((champion) => [champion.id, champion])), [champions]);

  const getCounterSuggestions = useCallback((opponentPickIds: string[], limit = 6): CounterSuggestion[] => {
    const opponentChampions = opponentPickIds
      .map((id) => championById.get(id))
      .filter((champion): champion is Champion => Boolean(champion));
    if (opponentChampions.length === 0) return [];

    const dataSuggestions: CounterSuggestion[] = [];
    for (const champion of availableChampions) {
      const counterData = matchData?.counters[champion.id];
      if (!counterData) continue;

      let score = 0;
      let best: { target: Champion; winrate: number; games: number; score: number } | null = null;
      for (const opponent of opponentChampions) {
        const strong = counterData.strongAgainst.find((row) => row.id === opponent.id && row.games >= COUNTER_MIN_GAMES);
        if (strong) {
          const confidence = Math.min(1, Math.log10(strong.games + 1) / 2.2);
          const matchupScore = (strong.winrate - 50) * confidence;
          score += matchupScore;
          if (!best || matchupScore > best.score) {
            best = { target: opponent, winrate: strong.winrate, games: strong.games, score: matchupScore };
          }
        }

        const weak = counterData.weakAgainst.find((row) => row.id === opponent.id && row.games >= COUNTER_MIN_GAMES);
        if (weak) {
          const confidence = Math.min(1, Math.log10(weak.games + 1) / 2.2);
          score -= Math.max(0, 50 - weak.winrate) * confidence * 0.8;
        }
      }

      if (!best || score <= 0) continue;
      dataSuggestions.push({
        champion,
        target: best.target,
        winrate: best.winrate,
        games: best.games,
        score,
        source: 'matchup',
        reason: `${best.target.nameKo} 상대로 ${best.winrate.toFixed(1)}%`,
      });
    }

    dataSuggestions.sort((a, b) =>
      b.score - a.score ||
      (b.winrate ?? 0) - (a.winrate ?? 0) ||
      (b.games ?? 0) - (a.games ?? 0) ||
      (TIER_RANK[a.champion.aramTier] ?? 3) - (TIER_RANK[b.champion.aramTier] ?? 3),
    );

    const suggestions = dataSuggestions.slice(0, limit);
    if (suggestions.length >= Math.min(4, limit)) return suggestions;

    const roleCounts = new Map<AramRole, number>();
    for (const opponent of opponentChampions) {
      roleCounts.set(opponent.aramRole, (roleCounts.get(opponent.aramRole) ?? 0) + 1);
    }
    const counterRoles = [...roleCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .flatMap(([role]) => ROLE_COUNTERS[role] ?? []);
    const counterRoleSet = new Set(counterRoles);
    const seen = new Set(suggestions.map((suggestion) => suggestion.champion.id));

    const roleSuggestions = availableChampions
      .filter((champion) => counterRoleSet.has(champion.aramRole) && !seen.has(champion.id))
      .sort((a, b) => (TIER_RANK[a.aramTier] ?? 3) - (TIER_RANK[b.aramTier] ?? 3) || b.aramWinrate - a.aramWinrate)
      .slice(0, limit - suggestions.length)
      .map((champion) => ({
        champion,
        score: 0,
        source: 'role' as const,
        reason: `${ARAM_ROLE_LABELS[champion.aramRole]} 역할 대응`,
      }));

    return [...suggestions, ...roleSuggestions];
  }, [availableChampions, championById, matchData]);

  // Fierless champion objects
  const fierlessChampions = useMemo(() => {
    return champions.filter((c) => fierlessBans.includes(c.id));
  }, [champions, fierlessBans]);

  // Ban recommendations (per opponent player, 5 each)
  const alreadyBannedAll = useMemo(() => [
    ...fierlessBans,
    ...team1Bans.filter((b) => b && b !== SKIP_BAN),
    ...team2Bans.filter((b) => b && b !== SKIP_BAN),
  ], [fierlessBans, team1Bans, team2Bans]);

  const team1OurProfs = useMemo(() => {
    const m: Record<number, Map<string, any>> = {};
    for (const pid of team1PlayerIds) { if (mergedProficiencies[pid]) m[pid] = mergedProficiencies[pid]; }
    return m;
  }, [team1PlayerIds, mergedProficiencies]);
  const team2OurProfs = useMemo(() => {
    const m: Record<number, Map<string, any>> = {};
    for (const pid of team2PlayerIds) { if (mergedProficiencies[pid]) m[pid] = mergedProficiencies[pid]; }
    return m;
  }, [team2PlayerIds, mergedProficiencies]);

  const champByNormId = useMemo(() => {
    const map = new Map<string, string>();
    for (const champion of champions) {
      map.set(champion.id.toLowerCase(), champion.id);
      map.set(champion.id.replace(/[^a-zA-Z]/g, '').toLowerCase(), champion.id);
    }
    return map;
  }, [champions]);

  const champFrequency = useMemo(() => {
    if (!wrStats) return undefined;
    const out: Record<string, { pickRate: number; banRate: number }> = {};
    for (const [cid, cs] of Object.entries(wrStats.champOverallStats)) {
      out[cid] = { pickRate: cs.pickRate, banRate: cs.banRate };
    }
    return out;
  }, [wrStats]);

  const team1BanRecs = useMemo(() => generatePerPlayerBanRecs({
    opponentPlayerIds: team2PlayerIds,
    opponentPlayerNames: Object.fromEntries(players.map((p) => [p.id!, p.name])),
    proficiencies: mergedProficiencies, allChampions: champions, alreadyBanned: alreadyBannedAll,
    ourTeamProficiencies: team1OurProfs, champFrequency,
  }), [team2PlayerIds, players, mergedProficiencies, champions, alreadyBannedAll, team1OurProfs, champFrequency]);

  const team2BanRecs = useMemo(() => generatePerPlayerBanRecs({
    opponentPlayerIds: team1PlayerIds,
    opponentPlayerNames: Object.fromEntries(players.map((p) => [p.id!, p.name])),
    proficiencies: mergedProficiencies, allChampions: champions, alreadyBanned: alreadyBannedAll,
    ourTeamProficiencies: team2OurProfs, champFrequency,
  }), [team1PlayerIds, players, mergedProficiencies, champions, alreadyBannedAll, team2OurProfs, champFrequency]);

  // Opponent picks per team (for counter recommendations)
  const team1Picks = useMemo(() =>
    team1PlayerIds.map((id) => picks[id]).filter(Boolean), [team1PlayerIds, picks]);
  const team2Picks = useMemo(() =>
    team2PlayerIds.map((id) => picks[id]).filter(Boolean), [team2PlayerIds, picks]);

  // Draft order: B1 → R1,R2 → B2,B3 → R3 (3v3) or B1 → R1,R2 → B2,B3 → R3,R4 (3v4)
  const draftOrder = useMemo(() => {
    const b = team1PlayerIds;
    const r = team2PlayerIds;
    if (format === '3v3') {
      return [
        { team: 1 as const, idx: 0 },
        { team: 2 as const, idx: 0 }, { team: 2 as const, idx: 1 },
        { team: 1 as const, idx: 1 }, { team: 1 as const, idx: 2 },
        { team: 2 as const, idx: 2 },
      ].map((d) => d.team === 1 ? b[d.idx] : r[d.idx]);
    }
    // 3v4
    return [
      { team: 1 as const, idx: 0 },
      { team: 2 as const, idx: 0 }, { team: 2 as const, idx: 1 },
      { team: 1 as const, idx: 1 }, { team: 1 as const, idx: 2 },
      { team: 2 as const, idx: 2 }, { team: 2 as const, idx: 3 },
    ].map((d) => d.team === 1 ? b[d.idx] : r[d.idx]);
  }, [team1PlayerIds, team2PlayerIds, format]);

  // Comp recommendations (with opponent counter logic)
  const getCompRecs = (teamPlayerIds: number[], team: 1 | 2) => {
    const teamPlayerObjs = teamPlayerIds.map((id) => players.find((p) => p.id === id)).filter(Boolean) as Player[];
    if (teamPlayerObjs.length === 0) return [];
    const opponentCurrentPicks = team === 1 ? team2Picks : team1Picks;

    // Separate own team's picks into locked (confirmed) and tentative (hover)
    const confirmedPicks: Record<number, string> = {};
    const otherPicks: string[] = [];
    const opponentIds = new Set(team === 1 ? team2PlayerIds : team1PlayerIds);
    for (const [pidStr, champId] of Object.entries(picks)) {
      const pid = Number(pidStr);
      if (teamPlayerIds.includes(pid) && lockedPicks.has(pid)) {
        // Only locked picks are fixed in recommendations
        confirmedPicks[pid] = champId;
      } else if (opponentIds.has(pid)) {
        otherPicks.push(champId);
      }
    }

    const recs = generateRecommendations({
      teamPlayers: teamPlayerObjs,
      bannedChampions: [...Array.from(allBannedIds), ...otherPicks],
      allChampions: champions, proficiencies: mergedProficiencies, format,
      opponentPicks: opponentCurrentPicks.length > 0 ? opponentCurrentPicks : undefined,
      matchData,
      lockedPicks: Object.keys(confirmedPicks).length > 0 ? confirmedPicks : undefined,
      champFrequency,
    }).slice(0, 10);
    if (wrStats) {
      for (const rec of recs) {
        rec.estimatedWinrate = estimateCompWinrate(rec.assignments, wrStats, rec.score);
      }
    }
    return recs;
  };

  // Per-player top champions
  const getPlayerRecs = (playerId: number) => {
    const profMap = mergedProficiencies[playerId] ?? new Map();
    return getPlayerTopChampions(
      playerId,
      profMap,
      availableChampions.filter((c) => !pickedIds.has(c.id) || picks[playerId] === c.id),
      7,
      champFrequency,
    );
  };

  const isBanLocked = (team: 1 | 2, index: number) => lockedBans.has(`${team}-${index}`);

  const lockBan = (team: 1 | 2, index: number) => {
    const bans = getTeamBans(team);
    const champId = bans[index];
    setLockedBans(prev => new Set(prev).add(`${team}-${index}`));
    // Send ban lock-in to LoL client (only when LCU is in ban phase)
    const lcuPhaseNow = lcu.lastState?.phase?.toUpperCase() ?? '';
    if (lcu.connected && champId && champId !== SKIP_BAN && (lcuPhaseNow === 'BAN_PICK' || lcuPhaseNow === 'BANNING')) {
      const numId = champIdToNumeric.get(champId);
      if (numId) lcu.lockInBan(numId);
    }
    advanceBanSlot(team, index);
  };

  // Handle champion click from grid
  const handleChampionSelect = (champId: string) => {
    if (!activeSlot) return;
    setSearch(''); // clear search on any selection
    if (activeSlot.type === 'ban') {
      const bans = [...getTeamBans(activeSlot.team)];
      bans[activeSlot.index] = champId;
      setTeamBans(activeSlot.team, bans);
      // Send ban hover to LoL client (only when LCU is in ban phase)
      const lcuPhaseNow = lcu.lastState?.phase?.toUpperCase() ?? '';
      if (lcu.connected && (lcuPhaseNow === 'BAN_PICK' || lcuPhaseNow === 'BANNING')) {
        const numId = champIdToNumeric.get(champId);
        if (numId) lcu.hoverBan(numId);
      }
      // Don't advance — stay on same slot until lock-in
    } else {
      setPicks((prev) => ({ ...prev, [activeSlot.playerId]: champId }));
      // If this is my pick, send to LoL client
      if (lcu.connected && activeSlot.playerId === userId) {
        const numId = champIdToNumeric.get(champId);
        if (numId) lcu.hoverChampion(numId);
      }
      // Stay on same player until lock-in (don't auto-advance)
    }
  };

  const confirmedRef = useRef(false);

  // Swap
  const [swapFirst, setSwapFirst] = useState<number | null>(null);
  const swapMode = swapFirst !== null;

  const resetRound = useCallback(() => {
    setTeam1Bans(Array(team1PlayerIds.length).fill(''));
    setTeam2Bans(Array(team2PlayerIds.length).fill(''));
    setPicks({});
    setLockedPicks(new Set());
    setLockedBans(new Set());
    setPlanningTimer(25);
    setSwapFirst(null);
    setPhase('planning');
    setActiveSlot({ type: 'pick', playerId: team1PlayerIds[0] });
    setSearch('');
    setRoleFilter(null);
    setLaneFilter(null);
    setTraitFilter(null);
    // Pause LCU sync so it doesn't re-apply old state
    setLcuPaused(true);
  }, [team1PlayerIds, team2PlayerIds]);

  // Champ-select Delete can arrive just before gameflow becomes InProgress.
  // Delay the reset so normal game start has time to auto-confirm instead of
  // wiping the final picks as a false "back to lobby" signal.
  useEffect(() => {
    if (!lcu.connected || lcu.champSelectActive || lcu.gameStartedAt) return;

    const hadDraft = Object.keys(picks).length > 0 || team1Bans.some(b => b) || team2Bans.some(b => b);
    if (!hadDraft) return;

    const resetTimer = window.setTimeout(() => {
      if (!confirmedRef.current) resetRound();
    }, 6000);

    return () => window.clearTimeout(resetTimer);
  }, [lcu.connected, lcu.champSelectActive, lcu.gameStartedAt, picks, resetRound, team1Bans, team2Bans]);

  const handleSkipBan = () => {
    if (!activeSlot || activeSlot.type !== 'ban') return;
    const bans = [...getTeamBans(activeSlot.team)];
    bans[activeSlot.index] = SKIP_BAN;
    setTeamBans(activeSlot.team, bans);
    setLockedBans(prev => new Set(prev).add(`${activeSlot.team}-${activeSlot.index}`));
    advanceBanSlot(activeSlot.team, activeSlot.index);
  };

  const advanceBanSlot = (team: 1 | 2, index: number) => {
    // Use latest state by reading from the setter callbacks
    // Build snapshot of what bans look like AFTER current assignment
    const currentT1 = [...team1Bans];
    const currentT2 = [...team2Bans];
    if (team === 1) currentT1[index] = 'filled';
    else currentT2[index] = 'filled';

    // Check T1 next empty
    const nextT1 = currentT1.findIndex((b) => !b);
    // Check T2 next empty
    const nextT2 = currentT2.findIndex((b) => !b);

    if (nextT1 >= 0) { setActiveSlot({ type: 'ban', team: 1, index: nextT1 }); return; }
    if (nextT2 >= 0) { setActiveSlot({ type: 'ban', team: 2, index: nextT2 }); return; }

    // All bans done, switch to pick phase
    setPhase('pick');
    const firstInDraft = draftOrder.find((id) => !picks[id]);
    setActiveSlot(firstInDraft ? { type: 'pick', playerId: firstInDraft } : null);
  };

  const advancePickSlot = (currentPlayerId: number) => {
    // Follow draft order: find next unpicked player after current in draft sequence
    const currentDraftIdx = draftOrder.indexOf(currentPlayerId);
    for (let i = 1; i < draftOrder.length; i++) {
      const nextId = draftOrder[(currentDraftIdx + i) % draftOrder.length];
      if (!picks[nextId] && nextId !== currentPlayerId) {
        setActiveSlot({ type: 'pick', playerId: nextId });
        return;
      }
    }
    setActiveSlot(null);
  };

  const totalSlots = team1PlayerIds.length + team2PlayerIds.length;
  const teamsReady = team1PlayerIds.length > 0 && team2PlayerIds.length > 0 && totalSlots > 0;
  const allPicked = teamsReady && [...team1PlayerIds, ...team2PlayerIds].every((id) => picks[id]);
  const allLocked = teamsReady && [...team1PlayerIds, ...team2PlayerIds].every((id) => lockedPicks.has(id));
  const canConfirm = allPicked && allLocked;

  const handleSwapClick = (pid: number) => {
    if (swapFirst === null) {
      setSwapFirst(pid);
    } else {
      if (swapFirst !== pid) {
        setPicks((prev) => ({ ...prev, [swapFirst]: prev[pid], [pid]: prev[swapFirst] }));
      }
      setSwapFirst(null);
    }
  };

  const lockPick = (playerId: number) => {
    if (!picks[playerId]) return;
    setLockedPicks((prev) => new Set(prev).add(playerId));
    // If this is my pick, lock in on LoL client too
    if (lcu.connected && playerId === userId) {
      const numId = champIdToNumeric.get(picks[playerId]);
      if (numId) lcu.lockInChampion(numId);
    }
    advancePickSlot(playerId);
  };

  const unlockPick = (playerId: number) => {
    setLockedPicks((prev) => { const n = new Set(prev); n.delete(playerId); return n; });
  };

  // Apply comp recommendation
  const applyComp = (comp: RecommendedComp) => {
    const newPicks = { ...picks };
    for (const a of comp.assignments) { newPicks[a.playerId] = a.championId; }
    setPicks(newPicks);
  };

  const hasAllTeamPicks = useCallback((candidatePicks: Record<number, string>) =>
    teamsReady && [...team1PlayerIds, ...team2PlayerIds].every((id) => candidatePicks[id]),
  [teamsReady, team1PlayerIds, team2PlayerIds]);

  const liveGamePlayers = lcu.liveGamePlayers;
  const resolveLiveGamePicks = useCallback(() => {
    if (!liveGamePlayers) return null;

    const resolved: Record<number, string> = { ...picks };
    const applyLiveTeam = (liveTeam: typeof liveGamePlayers.team1, fallbackIds: number[]) => {
      const slots = liveTeam.map((livePlayer) => resolvePlayerIdFromLcuName(livePlayer.alias, livePlayer.summonerName));
      const matched = new Set(slots.filter((id): id is number => typeof id === 'number'));
      const remaining = fallbackIds.filter((id) => !matched.has(id));
      const alignedIds = slots
        .map((id) => id ?? remaining.shift())
        .filter((id): id is number => typeof id === 'number');
      liveTeam.forEach((livePlayer, index) => {
        const playerId = resolvePlayerIdFromLcuName(livePlayer.alias, livePlayer.summonerName) ?? alignedIds[index];
        if (!playerId) return;

        const championId =
          champByNormId.get(livePlayer.championId.toLowerCase()) ??
          champByNormId.get(livePlayer.championId.replace(/[^a-zA-Z]/g, '').toLowerCase());
        if (championId) resolved[playerId] = championId;
      });
    };

    applyLiveTeam(liveGamePlayers.team1, team1PlayerIds);
    applyLiveTeam(liveGamePlayers.team2, team2PlayerIds);
    return resolved;
  }, [champByNormId, liveGamePlayers, picks, resolvePlayerIdFromLcuName, team1PlayerIds, team2PlayerIds]);

  const handleConfirm = useCallback((confirmPicks: Record<number, string> = picks) => {
    const banResult: Record<1 | 2, string[]> = {
      1: team1Bans.filter((b) => b && b !== SKIP_BAN),
      2: team2Bans.filter((b) => b && b !== SKIP_BAN),
    };
    onConfirm({ bans: banResult, picks: confirmPicks });
  }, [onConfirm, picks, team1Bans, team2Bans]);

  // Auto-confirm and navigate when game starts (LCU detected) — guard against
  // double-fire from StrictMode / repeated gameStart messages from the bridge.
  useEffect(() => {
    if (!lcu.gameStartedAt) {
      confirmedRef.current = false;
      return;
    }
    if (confirmedRef.current) return;
    if (!teamsReady || lcuPaused) return;

    const livePicks = resolveLiveGamePicks();
    const confirmPicks = livePicks ?? picks;
    if (hasAllTeamPicks(confirmPicks)) {
      confirmedRef.current = true;
      if (livePicks) setPicks(livePicks);
      handleConfirm(confirmPicks);
    }
  }, [lcu.gameStartedAt, teamsReady, lcuPaused, picks, hasAllTeamPicks, resolveLiveGamePicks, handleConfirm]);

  const computeGridChampions = (query: string) => {
    let list = champions.filter((c) => !fierlessBans.includes(c.id));
    const trimmedQuery = query.trim();
    const searchLower = trimmedQuery.toLowerCase();
    if (trimmedQuery) {
      list = list.filter((c) => c.nameKo.includes(trimmedQuery) || c.id.toLowerCase().includes(searchLower));
    }
    if (roleFilter) {
      list = list.filter((c) => c.aramRole === roleFilter);
    }
    if (laneFilter) {
      list = list.filter((c) => getChampionLane(c) === laneFilter);
    }
    if (traitFilter) {
      list = list.filter((c) => {
        const traits = championTraits[c.id];
        if (!traits) return false;
        return traits.mechanics.includes(traitFilter);
      });
    }
    const tierOrder: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, D: 4 };
    const profOrder: Record<string, number> = { 'S': 0, '상': 1, '중': 2, '하': 3, '없음': 4 };
    const isDisabled = (c: Champion) => allBannedIds.has(c.id) || pickedIds.has(c.id);

    // Search relevance: 0=exact ko, 1=ko prefix, 2=en prefix, 3=ko contains, 4=en contains
    const relevance = (c: Champion): number => {
      if (!trimmedQuery) return 0;
      if (c.nameKo === trimmedQuery) return 0;
      if (c.nameKo.startsWith(trimmedQuery)) return 1;
      if (c.id.toLowerCase().startsWith(searchLower)) return 2;
      if (c.nameKo.includes(trimmedQuery)) return 3;
      return 4;
    };

    const mode = sortMode === 'auto' ? (phase === 'pick' ? 'proficiency' : 'tier') : sortMode;

    list.sort((a, b) => {
      const dA = isDisabled(a) ? 1 : 0;
      const dB = isDisabled(b) ? 1 : 0;
      if (dA !== dB) return dA - dB;

      // Search relevance takes top priority when searching
      if (trimmedQuery) {
        const rA = relevance(a);
        const rB = relevance(b);
        if (rA !== rB) return rA - rB;
        // Within same relevance bucket, prefer shorter name (more specific match)
        if (a.nameKo.length !== b.nameKo.length) return a.nameKo.length - b.nameKo.length;
      }

      if (mode === 'name') return a.nameKo.localeCompare(b.nameKo, 'ko');
      if (mode === 'winrate') return b.aramWinrate - a.aramWinrate;
      if (mode === 'proficiency' && activeSlot?.type === 'pick') {
        // Use merged proficiencies (manual + estimated)
        const profMap = mergedProficiencies[activeSlot.playerId] ?? new Map();
        const pA = profOrder[profMap.get(a.id) ?? '없음'] ?? 3;
        const pB = profOrder[profMap.get(b.id) ?? '없음'] ?? 3;
        if (pA !== pB) return pA - pB;
      }
      if (mode === 'tier' && activeSlot?.type === 'ban') {
        // In ban phase, sort by opponent proficiency (highest threat first)
        const opponentIds = activeSlot.team === 1 ? team2PlayerIds : team1PlayerIds;
        const bestProfA = Math.min(...opponentIds.map((pid) => profOrder[(mergedProficiencies[pid] ?? new Map()).get(a.id) ?? '없음'] ?? 3));
        const bestProfB = Math.min(...opponentIds.map((pid) => profOrder[(mergedProficiencies[pid] ?? new Map()).get(b.id) ?? '없음'] ?? 3));
        if (bestProfA !== bestProfB) return bestProfA - bestProfB;
      }
      return (tierOrder[a.aramTier] ?? 3) - (tierOrder[b.aramTier] ?? 3);
    });
    return list;
  };

  // Grid champions filtered
  const gridChampions = useMemo(() => (
    computeGridChampions(search)
  ), [champions, fierlessBans, search, roleFilter, laneFilter, traitFilter, allBannedIds, pickedIds, activeSlot, mergedProficiencies, phase, team1PlayerIds, team2PlayerIds, sortMode]);

  // --- RENDER ---
  const renderTeamPanel = (team: 1 | 2) => {
    const playerIds = team === 1 ? team1PlayerIds : team2PlayerIds;
    const bans = getTeamBans(team);
    const banRecs = team === 1 ? team1BanRecs : team2BanRecs;
    const compRecs = getCompRecs(playerIds, team);
    const teamColor = team === 1 ? 'blue' : 'red';
    const bgClass = team === 1 ? 'bg-blue-950/20 border-blue-900/40' : 'bg-red-950/20 border-red-900/40';

    // Compute counter roles based on opponent picks
    const oppPicks = team === 1 ? team2Picks : team1Picks;
    const counterSuggestions = getCounterSuggestions(oppPicks, 7);
    const counterChampIds = new Set(counterSuggestions.map((suggestion) => suggestion.champion.id));

    return (
      <div className={`w-[360px] shrink-0 rounded-lg border ${bgClass} p-3 space-y-3 overflow-y-auto max-h-[calc(100vh-180px)]`}>
        {/* Team Header */}
        <h3 className={`text-center font-bold text-${teamColor}-400`}>Team {team}</h3>

        {/* Ban Slots */}
        <div>
          <div className="text-xs text-lol-gold-light/50 mb-1.5">밴 ({bans.filter((b) => b && b !== SKIP_BAN).length})</div>
          <div className="flex gap-1.5 flex-wrap">
            {bans.map((banId, idx) => {
              const isActive = activeSlot?.type === 'ban' && activeSlot.team === team && activeSlot.index === idx;
              const champ = banId && banId !== SKIP_BAN ? champions.find((c) => c.id === banId) : null;
              const isSkipped = banId === SKIP_BAN;
              const locked = isBanLocked(team, idx);
              return (
                <div key={idx} className="flex flex-col items-center gap-0.5">
                  <div
                    onClick={() => {
                      if (locked) return;
                      if (isSkipped || champ) {
                        const newBans = [...bans]; newBans[idx] = '';
                        setTeamBans(team, newBans);
                        setLockedBans(prev => { const n = new Set(prev); n.delete(`${team}-${idx}`); return n; });
                      }
                      setActiveSlot({ type: 'ban', team, index: idx });
                      setPhase('ban');
                    }}
                    className={`cursor-pointer w-10 h-10 rounded border-2 flex items-center justify-center transition-all ${
                      locked ? 'border-red-600/80 opacity-70'
                      : isActive ? 'border-lol-gold shadow-[0_0_8px_rgba(200,155,60,0.5)]'
                      : champ ? 'border-red-800/60'
                      : isSkipped ? 'border-gray-700 bg-gray-800/30'
                      : 'border-dashed border-gray-600 bg-lol-dark/30'
                    }`}
                  >
                    {champ ? <img src={champ.imageUrl} className={`w-full h-full rounded ${locked ? 'opacity-50 grayscale' : ''}`} />
                     : isSkipped ? <span className="text-[10px] text-gray-500">없음</span>
                     : <span className="text-gray-600 text-lg">+</span>}
                  </div>
                  {/* Ban lock-in button — show whenever a champion is selected but not locked */}
                  {champ && !locked && (
                    <button onClick={(e) => { e.stopPropagation(); lockBan(team, idx); }}
                      className="cursor-pointer text-[8px] px-1.5 py-0.5 rounded bg-red-900/30 text-red-300 border border-red-800/40 hover:bg-red-900/50">
                      확정
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {phase === 'ban' && activeSlot?.type === 'ban' && activeSlot.team === team && (
            <div className="flex gap-2 mt-1">
              <button onClick={handleSkipBan} className="cursor-pointer text-[10px] text-gray-500 hover:text-gray-400">
                밴 없음
              </button>
            </div>
          )}
        </div>

        {/* Ban Recommendations — per opponent player */}
        {(phase === 'ban' || phase === 'planning') && Object.keys(banRecs).length > 0 && (
          <div>
            <div className="text-xs text-lol-gold-light/50 mb-1.5">추천 밴 (상대 플레이어별)</div>
            <div className="space-y-1.5">
              {(team === 1 ? team2PlayerIds : team1PlayerIds).map((oppId) => {
                const recs = banRecs[oppId];
                if (!recs || recs.length === 0) return null;
                const canClick = activeSlot?.type === 'ban' && activeSlot.team === team;
                return (
                  <div key={oppId} className="flex items-center gap-1.5">
                    <span className="text-[10px] text-lol-gold-light/40 shrink-0 w-8 truncate">{getPlayerName(oppId)}</span>
                    <div className="flex gap-1 overflow-x-auto">
                      {recs.map((rec) => {
                        const champ = champions.find((c) => c.id === rec.championId);
                        if (!champ) return null;
                        const isBanned = allBannedIds.has(champ.id);
                        return (
                          <ChampionWithHover key={rec.championId} champion={champ} wrStats={wrStats}
                            allPlayers={players} proficiencies={proficiencies} estimatedMap={estimatedMap}
                            highlightPlayerIds={[oppId]} disabled={isBanned}>
                            <div
                              title={rec.reason ? `${champ.nameKo}: ${rec.reason}` : champ.nameKo}
                              onClick={() => canClick && !isBanned && handleChampionSelect(rec.championId)}
                              className={`shrink-0 ${canClick && !isBanned ? 'cursor-pointer hover:opacity-100' : ''} ${isBanned ? 'opacity-20' : 'opacity-70'}`}>
                              <ChampionIcon champion={champ} size="sm" disabled={isBanned} />
                            </div>
                          </ChampionWithHover>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Comp Recommendations */}
        {compRecs.length > 0 && (
          <div>
            <div className="text-xs text-lol-gold-light/50 mb-1">추천 조합 ({compRecs.length})</div>
            <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
              {compRecs.map((comp, i) => (
                <div key={i} onClick={() => applyComp(comp)}
                  className="cursor-pointer p-1.5 rounded border border-lol-border hover:border-lol-gold/50 bg-lol-dark/30 transition-colors">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-lol-gold">{comp.archetypeName}</span>
                    <div className="flex items-center gap-1.5">
                      {comp.estimatedWinrate != null && (
                        <span className={`text-[10px] font-mono ${comp.estimatedWinrate >= 55 ? 'text-prof-high' : comp.estimatedWinrate >= 45 ? 'text-lol-gold' : 'text-prof-low'}`}>
                          {Math.round(comp.estimatedWinrate)}%
                        </span>
                      )}
                      <span className="text-[10px] text-lol-gold-light/50 font-mono">{Math.round(comp.score * 100)}</span>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    {comp.assignments.map((a) => {
                      const c = champions.find((ch) => ch.id === a.championId);
                      return c ? <ChampionIcon key={a.playerId} champion={c} size="sm" /> : null;
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Counter Picks — show actual matchup and role counter champions */}
        {phase === 'pick' && (() => {
          const oppPicks = team === 1 ? team2Picks : team1Picks;
          if (oppPicks.length === 0) return null;

          const suggestions = getCounterSuggestions(oppPicks, 6);
          if (suggestions.length === 0) return null;
          const hasMatchupData = suggestions.some((suggestion) => suggestion.source === 'matchup');

          return (
            <div className="rounded-lg border border-lol-gold/30 bg-[linear-gradient(135deg,rgba(120,90,40,0.16),rgba(1,10,19,0.42))] p-2">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-lol-gold">
                  Counter Picks
                </div>
                <div className={`rounded border px-1.5 py-0.5 text-[9px] ${
                  hasMatchupData
                    ? 'border-prof-high/35 bg-prof-high/10 text-prof-high'
                    : 'border-lol-border bg-lol-dark/40 text-lol-gold-light/45'
                }`}>
                  {hasMatchupData ? '매치업 데이터' : '역할 기반'}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {suggestions.map((suggestion) => {
                  const c = suggestion.champion;
                  return (
                    <button
                      key={`${c.id}-${suggestion.target?.id ?? suggestion.source}`}
                      onClick={() => {
                        if (activeSlot?.type === 'pick') {
                          setPicks(prev => ({ ...prev, [activeSlot.playerId]: c.id }));
                          if (lcu.connected && activeSlot.playerId === userId) {
                            const numId = champIdToNumeric.get(c.id);
                            if (numId) lcu.hoverChampion(numId);
                          }
                        }
                      }}
                      title={suggestion.reason}
                      className="group flex cursor-pointer items-center gap-1.5 rounded border border-lol-border/70 bg-lol-dark/45 p-1 text-left transition-colors hover:border-lol-gold/55 hover:bg-lol-gold/10"
                    >
                      <div className="relative shrink-0">
                        <ChampionIcon champion={c} size="sm" />
                        <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-lol-gold px-0.5 text-[7px] font-black leading-none text-lol-dark">
                          C
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[10px] font-bold text-lol-gold-light group-hover:text-lol-gold">
                          {c.nameKo}
                        </div>
                        {suggestion.target ? (
                          <div className="flex items-center gap-1 text-[9px] text-lol-gold-light/45">
                            <span className="truncate">vs {suggestion.target.nameKo}</span>
                            {suggestion.winrate && <span className="font-mono text-prof-high">{suggestion.winrate.toFixed(1)}%</span>}
                          </div>
                        ) : (
                          <div className="truncate text-[9px] text-lol-gold-light/40">{suggestion.reason}</div>
                        )}
                        {suggestion.games && (
                          <div className="text-[8px] text-lol-gold-light/30">{formatGamesShort(suggestion.games)} games</div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="mt-1.5 text-[10px] text-lol-gold-light/40">
                상대 픽별 승률 매치업을 우선 사용하고, 데이터가 적으면 역할 상성으로 보완합니다.
              </div>
            </div>
          );
        })()}

        {/* Player Rows */}
        <div className="space-y-2">
          {playerIds.map((pid) => {
            const isActive = activeSlot?.type === 'pick' && activeSlot.playerId === pid;
            const isLocked = lockedPicks.has(pid);
            const pickedChamp = picks[pid] ? champions.find((c) => c.id === picks[pid]) : null;
            const recs = getPlayerRecs(pid);
            const pStats = wrStats?.playerOverallStats[pid];
            // Player's stats with picked champion
            const champStat = pickedChamp && wrStats
              ? wrStats.playerChampStats.find((s) => s.playerId === pid && s.championId === pickedChamp.id)
              : null;

            return (
              <div key={pid}
                onClick={() => {
                  if (!isLocked) { setActiveSlot({ type: 'pick', playerId: pid }); setPhase('pick'); }
                }}
                className={`p-2 rounded border transition-all ${
                  swapFirst === pid ? 'border-purple-500 bg-purple-950/30 ring-1 ring-purple-500/50'
                  : isLocked ? 'border-prof-high/50 bg-prof-high/5'
                  : isActive ? 'border-lol-gold bg-lol-gold/10 cursor-pointer'
                  : 'border-lol-border/50 hover:border-lol-gold/30 cursor-pointer'
                }`}>
                {/* Player header with stats */}
                <div className="flex items-center gap-2 mb-1">
                  {pickedChamp ? (
                    <ChampionIcon champion={pickedChamp} size="md" selected={isActive && !isLocked} />
                  ) : (
                    <div className={`w-12 h-12 rounded border-2 border-dashed flex items-center justify-center ${isActive ? 'border-lol-gold' : 'border-gray-600'}`}>
                      <span className="text-gray-500 text-sm">?</span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm text-lol-gold-light font-medium truncate">{getPlayerName(pid)}</span>
                      {isLocked && <span className="text-[10px] text-prof-high">LOCKED</span>}
                    </div>
                    <div className="flex items-center gap-2 text-[10px]">
                      {pStats && pStats.totalPicks > 0 && (
                        <>
                          <span className={`font-mono ${pStats.winrate >= 55 ? 'text-prof-high' : pStats.winrate >= 45 ? 'text-lol-gold-light/60' : 'text-prof-low'}`}>
                            {Math.round(pStats.winrate)}%
                          </span>
                          <span className="text-lol-gold-light/40">
                            {pStats.wins}W {pStats.losses}L
                          </span>
                          <span className="text-lol-gold-light/30">({pStats.totalPicks}게임)</span>
                        </>
                      )}
                      {pickedChamp && champStat && (
                        <span className="text-lol-gold-light/50">
                          | {pickedChamp.nameKo} {champStat.wins}W{champStat.losses}L
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Lock-in + Swap buttons */}
                  <div className="flex gap-1 shrink-0">
                    {pickedChamp && !isLocked && (
                      <button
                        onClick={(e) => { e.stopPropagation(); lockPick(pid); }}
                        className="cursor-pointer px-2 py-1 text-[10px] rounded bg-prof-high/20 text-prof-high border border-prof-high/40 hover:bg-prof-high/30 transition-colors"
                      >
                        락인
                      </button>
                    )}
                    {isLocked && (
                      <button
                        onClick={(e) => { e.stopPropagation(); unlockPick(pid); }}
                        className="cursor-pointer px-2 py-1 text-[10px] rounded bg-lol-gray text-lol-gold-light/50 border border-lol-border hover:text-lol-gold-light transition-colors"
                      >
                        해제
                      </button>
                    )}
                    {/* Swap button */}
                    {pickedChamp && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSwapClick(pid);
                        }}
                        className={`cursor-pointer px-2 py-1 text-[10px] rounded border transition-colors ${
                          swapFirst === pid
                            ? 'bg-purple-900/50 text-purple-300 border-purple-600 ring-1 ring-purple-500/50'
                            : 'bg-lol-gray text-lol-gold-light/40 border-lol-border hover:text-purple-300 hover:border-purple-600'
                        }`}
                        title={swapFirst === pid ? '스왑 대상을 선택하세요' : swapFirst ? '이 플레이어와 스왑' : '스왑'}
                      >
                        {swapFirst === pid ? '...' : '↔'}
                      </button>
                    )}
                  </div>
                </div>
                {/* Champion mechanic tags — separate line below header */}
                {pickedChamp && (() => {
                  const traits = championTraits[pickedChamp.id];
                  if (!traits) return null;
                  return (
                    <div className="flex flex-wrap items-center gap-1 mt-1">
                      <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-[10px] font-bold ${
                        pickedChamp.aramTier === 'S' ? 'bg-tier-s/20 text-tier-s' :
                        pickedChamp.aramTier === 'A' ? 'bg-tier-a/20 text-tier-a' :
                        pickedChamp.aramTier === 'B' ? 'bg-tier-b/20 text-tier-b' :
                        pickedChamp.aramTier === 'C' ? 'bg-tier-c/20 text-tier-c' :
                        'bg-tier-d/20 text-tier-d'
                      }`}>{pickedChamp.aramTier}</span>
                      {traits.mechanics.slice(0, 5).map(tag => (
                        <span
                          key={tag}
                          title={TAG_LABELS[tag] ?? tag}
                          aria-label={TAG_LABELS[tag] ?? tag}
                          className={`inline-flex h-5 items-center gap-1 rounded px-1 text-[9px] font-bold ${getTagColor(tag)}`}
                        >
                          {TAG_ICON_URLS[tag] ? (
                            <img src={TAG_ICON_URLS[tag]} alt="" className="h-3.5 w-3.5 object-contain" loading="lazy" />
                          ) : (
                            <span>{TAG_ICONS[tag] ?? '?'}</span>
                          )}
                          <span>{TAG_SHORT_LABELS[tag] ?? getTagLabel(tag)}</span>
                        </span>
                      ))}
                    </div>
                  );
                })()}
                {/* Top champions with pick rate bars */}
                {!isLocked && (
                  <div className="flex flex-wrap gap-0.5 mt-1">
                    {recs.map((c) => {
                      const cs = wrStats?.playerChampStats.find((s) => s.playerId === pid && s.championId === c.id);
                      const isUnavailable = pickedIds.has(c.id) && picks[pid] !== c.id;
                      return (
                        <ChampionWithHover key={c.id} champion={c} wrStats={wrStats}
                          allPlayers={players} proficiencies={proficiencies} estimatedMap={estimatedMap}
                          highlightPlayerIds={team1PlayerIds.includes(pid) ? team2PlayerIds : team1PlayerIds}
                          disabled={isUnavailable}>
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!isLocked) {
                                setPicks((prev) => ({ ...prev, [pid]: c.id }));
                                if (lcu.connected && pid === userId) {
                                  const numId = champIdToNumeric.get(c.id);
                                  if (numId) lcu.hoverChampion(numId);
                                }
                              }
                            }}
                            className="cursor-pointer relative">
                            <ChampionIcon champion={c} size="base"
                              selected={picks[pid] === c.id}
                              disabled={isUnavailable} />
                            {counterChampIds.has(c.id) && !isUnavailable && (
                              <span className="absolute -top-1 -right-1 text-[7px] bg-lol-gold text-lol-dark rounded-full w-3.5 h-3.5 flex items-center justify-center font-bold leading-none">C</span>
                            )}
                            {cs && (cs.wins + cs.losses > 0) && (
                              <div className={`absolute -bottom-0.5 left-1/2 -translate-x-1/2 text-[8px] font-mono font-bold px-0.5 rounded bg-lol-dark/80 ${
                                cs.winrate >= 60 ? 'text-prof-high' : cs.winrate >= 40 ? 'text-lol-gold-light/70' : 'text-prof-low'
                              }`}>
                                {Math.round(cs.winrate)}%
                              </div>
                            )}
                          </div>
                        </ChampionWithHover>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

      </div>
    );
  };

  return (
    <div className="banpick-compact space-y-2">
      {/* Phase indicator + LCU bridge */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="text-lol-gold hover:text-lol-gold-light cursor-pointer">&larr;</button>
          <button onClick={() => { if (confirm('이번 라운드의 밴/픽을 초기화하시겠습니까?')) resetRound(); }}
            className="cursor-pointer px-2 py-1 rounded text-[10px] border border-lol-border text-lol-gold-light/40 hover:text-lol-gold-light hover:border-lol-gold/50 transition-colors">
            리셋
          </button>
          <span className={`text-[11px] px-2 py-0.5 rounded border font-medium ${
            mode === 'augmented'
              ? 'border-purple-400/60 bg-purple-900/30 text-purple-300'
              : 'border-lol-gold/50 bg-lol-gold/10 text-lol-gold'
          }`} title={mode === 'augmented' ? '증강 칼바람' : '일반 칼바람'}>
            {GAME_MODE_LABELS[mode]}
          </span>
        </div>
        <div className="flex gap-2 items-center">
          {displayTimer !== null && (
            <span className={`mr-1 font-mono text-[11px] ${displayTimer <= 5 ? 'text-red-400 animate-pulse' : 'text-lol-gold'}`}>
              {displayTimer}s
            </span>
          )}
          <button onClick={() => { setPhase('planning'); setPlanningTimer(25); setActiveSlot({ type: 'pick', playerId: team1PlayerIds[0] }); }}
            className={`cursor-pointer rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${phase === 'planning' ? 'bg-blue-900/50 text-blue-300 border border-blue-700' : 'bg-lol-gray text-lol-gold-light/60 border border-lol-border'}`}>
            조율
          </button>
          <button onClick={() => { setPhase('ban'); const idx = team1Bans.findIndex((b) => !b); if (idx >= 0) setActiveSlot({ type: 'ban', team: 1, index: idx }); }}
            className={`cursor-pointer rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${phase === 'ban' ? 'bg-red-900/50 text-red-300 border border-red-700' : 'bg-lol-gray text-lol-gold-light/60 border border-lol-border'}`}>
            밴
          </button>
          <button onClick={() => { setPhase('pick'); const first = [...team1PlayerIds, ...team2PlayerIds].find((id) => !picks[id]); if (first) setActiveSlot({ type: 'pick', playerId: first }); }}
            className={`cursor-pointer rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${phase === 'pick' ? 'bg-lol-gold/30 text-lol-gold border border-lol-gold/50' : 'bg-lol-gray text-lol-gold-light/60 border border-lol-border'}`}>
            픽
          </button>
        </div>
        <Button size="sm" onClick={() => handleConfirm()} disabled={!canConfirm || swapMode}>
          {!allPicked ? '픽 미완료' : !allLocked ? `락인 대기 (${lockedPicks.size}/${team1PlayerIds.length + team2PlayerIds.length})` : '게임 시작!'}
        </Button>
      </div>

      {/* Current session round-based streak strip + side winrate reference */}
      <div className="flex gap-2">
        <div className="flex-1">
          <StreakStrip
            players={players}
            playerIds={[...team1PlayerIds, ...team2PlayerIds]}
            compact
            mode="session"
            className="p-1.5 bg-lol-gray/40 rounded border border-lol-border/60"
          />
        </div>
        <SideStatsBadge mode={mode} className="p-1.5 bg-lol-gray/40 rounded border border-lol-border/60 shrink-0" />
      </div>

      {/* Fierless Banner */}
      {fierlessChampions.length > 0 && (
        <div className="p-2 bg-lol-gray/50 rounded border border-lol-border">
          <div className="text-[10px] text-lol-gold-light/40 mb-1 text-center">피어리스 밴 ({fierlessChampions.length})</div>
          <div className="flex flex-wrap gap-1 justify-center">
            {fierlessChampions.map((c) => (
              <div key={c.id} className="w-7 h-7 rounded overflow-hidden opacity-30 grayscale" title={c.nameKo}>
                <img src={c.imageUrl} className="w-full h-full" loading="lazy" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Team Composition Summary: [T1 summary] [win bar] [T2 summary] */}
      {(() => {
        const traitDefs = [
          { label: 'CC', tags: ['aoe_cc', 'knockup', 'pull'], color: 'text-yellow-300 bg-yellow-900/70' },
          { label: '포크', tags: ['poke_long', 'poke_mid'], color: 'text-blue-300 bg-blue-900/70' },
          { label: '힐', tags: ['heal'], color: 'text-green-300 bg-green-900/70' },
          { label: '쉴드', tags: ['shield'], color: 'text-cyan-300 bg-cyan-900/70' },
          { label: '치감', tags: ['anti_heal'], color: 'text-red-300 bg-red-900/70' },
          { label: '탱킹', tags: ['diving'], color: 'text-amber-300 bg-amber-900/70' },
          { label: '탱파', tags: ['tank_shred'], color: 'text-red-300 bg-red-900/70' },
          { label: '버스트', tags: ['burst'], color: 'text-orange-300 bg-orange-900/70' },
        ];

        const champMapLocal = new Map(champions.map((c) => [c.id, c]));
        const traitsMapLocal = new Map(Object.entries(championTraits));

        const getTeamData = (playerIds: number[], opponentPicks: string[]) => {
          const pickedChamps = playerIds
            .map((pid) => ({ pid, cid: picks[pid] }))
            .filter((x) => x.cid)
            .map((x) => ({ pid: x.pid, champ: champions.find((c) => c.id === x.cid)! }))
            .filter((x) => x.champ);
          let ap = 0, ad = 0, hybrid = 0;
          for (const { champ } of pickedChamps) {
            if (champ.damageType === 'AP') ap++;
            else if (champ.damageType === 'AD') ad++;
            else hybrid++;
          }
          const total = ap + ad + hybrid;
          const apPct = total > 0 ? ((ap + hybrid * 0.5) / total) * 100 : 50;
          const tagCounts = new Map<string, number>();
          for (const { champ } of pickedChamps) {
            const traits = championTraits[champ.id];
            if (traits) for (const t of traits.mechanics) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
          }
          // Real winrate estimate: scoreComposition (proficiency/synergy/counter
          // vs opponent picks) → baseScore → estimateCompWinrate blends in each
          // player's personal champion winrate + global champion winrate.
          let estimate = 50;
          if (pickedChamps.length > 0 && wrStats) {
            const assignments = pickedChamps.map(({ pid, champ }) => ({
              playerId: pid,
              playerName: players.find((p) => p.id === pid)?.name ?? '',
              championId: champ.id,
              championName: champ.nameKo,
              proficiency: mergedProficiencies[pid]?.get(champ.id) ?? '중',
            }));
            const { score: baseScore } = scoreComposition(
              assignments, champMapLocal, traitsMapLocal, 'balanced', opponentPicks, matchData
            );
            estimate = estimateCompWinrate(assignments, wrStats, baseScore);
          }
          return { apPct, adPct: 100 - apPct, tagCounts, estimate, count: pickedChamps.length };
        };

        const anyPicks = Object.keys(picks).length > 0;
        if (!anyPicks) return null;

        const t1 = getTeamData(team1PlayerIds, team2Picks);
        const t2 = getTeamData(team2PlayerIds, team1Picks);
        // Head-to-head: each team's estimate is a "vs unknown opponent" wr.
        // Convert to a relative win probability by spreading the difference
        // around 50% (clamped to [10, 90] to avoid extreme readings on tiny
        // sample sizes).
        const diff = t1.estimate - t2.estimate;
        const t1Pct = Math.max(10, Math.min(90, Math.round(50 + diff / 2)));
        const t2Pct = 100 - t1Pct;
        const t1Winning = t1Pct >= t2Pct;
        const dataGames = wrStats?.totalGames ?? 0;

        const renderSummary = (data: ReturnType<typeof getTeamData>, team: 1 | 2) => {
          if (data.count === 0) return <div className="w-[360px] shrink-0 text-center text-xs text-lol-gold-light/20 py-2">픽 대기중</div>;
          const teamColor = team === 1 ? 'blue' : 'red';
          return (
            <div className="w-[360px] shrink-0 space-y-1.5">
              <div className={`text-xs text-${teamColor}-400 font-bold text-center`}>Team {team}</div>
              <div>
                <div className="flex justify-between text-[10px] text-lol-gold-light/50 mb-0.5">
                  <span>AP {Math.round(data.apPct)}%</span>
                  <span>AD {Math.round(data.adPct)}%</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden flex bg-lol-dark/50">
                  <div className="bg-blue-500/70 transition-all" style={{ width: `${data.apPct}%` }} />
                  <div className="bg-red-500/70 transition-all" style={{ width: `${data.adPct}%` }} />
                </div>
              </div>
              <div className="flex flex-wrap gap-1 justify-center">
                {traitDefs.map((t) => {
                  const present = t.tags.some((tag) => data.tagCounts.has(tag));
                  return (
                    <span key={t.label} className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${present ? t.color : 'text-gray-600 bg-lol-dark/40 line-through'}`}>
                      {t.label}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        };

        return (
          <div className="flex items-start gap-3">
            {renderSummary(t1, 1)}
            {/* Win probability — centered between the two team summaries */}
            <div className="flex-1 min-w-0 flex flex-col items-center justify-center pt-4">
              <div className="w-full max-w-[280px]">
                <div className="flex justify-between items-center text-xs mb-1">
                  <span className={`font-bold font-mono ${t1Winning ? 'text-green-400' : 'text-blue-400/60'}`}>
                    {t1Pct}%
                  </span>
                  <span className="text-lol-gold-light/30 text-[10px]">승리 예측</span>
                  <span className={`font-bold font-mono ${!t1Winning ? 'text-green-400' : 'text-red-400/60'}`}>
                    {t2Pct}%
                  </span>
                </div>
                <div className="h-2.5 rounded-full overflow-hidden flex bg-lol-dark/50">
                  <div className={`${t1Winning ? 'bg-green-500/80' : 'bg-blue-500/40'} transition-all`} style={{ width: `${t1Pct}%` }} />
                  <div className={`${!t1Winning ? 'bg-green-500/80' : 'bg-red-500/40'} transition-all`} style={{ width: `${t2Pct}%` }} />
                </div>
                <div className="flex justify-between text-[9px] text-lol-gold-light/40 mt-1 font-mono">
                  <span>단독 {Math.round(t1.estimate)}%</span>
                  <span className="text-lol-gold-light/30">내전 {dataGames}판 기반</span>
                  <span>단독 {Math.round(t2.estimate)}%</span>
                </div>
              </div>
            </div>
            {renderSummary(t2, 2)}
          </div>
        );
      })()}

      {/* Main 3-column layout */}
      <div className="flex gap-3">
        {/* Team 1 */}
        {renderTeamPanel(1)}

        {/* Center: Champion Grid */}
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onCompositionStart={() => { searchComposingRef.current = true; }}
                onCompositionEnd={(e) => {
                  searchComposingRef.current = false;
                  setSearch(e.currentTarget.value);
                }}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing || searchComposingRef.current) return;
                  if (e.key !== 'Enter' || !activeSlot) return;
                  const query = e.currentTarget.value;
                  // Case A: search has text → pick top relevant match (hover)
                  if (query.trim()) {
                    const first = computeGridChampions(query)
                      .find((c) => !allBannedIds.has(c.id) && !pickedIds.has(c.id));
                    if (first) { handleChampionSelect(first.id); setSearch(''); }
                    return;
                  }
                  // Case B: empty search → second Enter locks in the currently hovered champ
                  if (activeSlot.type === 'pick') {
                    const pid = activeSlot.playerId;
                    if (picks[pid] && !lockedPicks.has(pid)) lockPick(pid);
                  } else {
                    const bans = getTeamBans(activeSlot.team);
                    const banId = bans[activeSlot.index];
                    if (banId && banId !== SKIP_BAN && !isBanLocked(activeSlot.team, activeSlot.index)) {
                      lockBan(activeSlot.team, activeSlot.index);
                    }
                  }
                }}
                placeholder="검색 후 Enter로 즉시 선택..."
                className="w-full bg-lol-blue border border-lol-border rounded px-3 py-1.5 pr-8 text-sm text-lol-gold-light placeholder:text-lol-gold-light/30 focus:outline-none focus:border-lol-gold"
                autoFocus
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-lol-gold-light/40 hover:text-lol-gold-light cursor-pointer text-sm"
                >
                  &times;
                </button>
              )}
            </div>
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as any)}
              className="bg-lol-blue border border-lol-border rounded px-2 py-1.5 text-xs text-lol-gold-light cursor-pointer"
            >
              <option value="auto">자동 정렬</option>
              <option value="tier">티어순</option>
              <option value="name">이름순</option>
              <option value="winrate">승률순</option>
            </select>
            {/* Skip ban is now in the champion grid as an X card */}
          </div>

          <div className="space-y-1.5 rounded border border-lol-border bg-lol-dark/40 p-2">
            <div className="flex items-center gap-1.5">
              <span className="w-8 shrink-0 text-center text-[10px] text-lol-gold-light/40" title="역할">역할</span>
              {(Object.keys(ARAM_ROLE_LABELS) as AramRole[]).map((role) => {
                const active = roleFilter === role;
                return (
                  <FilterIconButton
                    key={role}
                    active={active}
                    icon={ROLE_ICON_URLS[role]}
                    label={ROLE_SHORT_LABELS[role]}
                    title={`역할: ${ARAM_ROLE_LABELS[role]}`}
                    onClick={() => setRoleFilter((prev) => prev === role ? null : role)}
                  />
                );
              })}
              {(roleFilter || laneFilter || traitFilter) && (
                <button
                  onClick={() => { setRoleFilter(null); setLaneFilter(null); setTraitFilter(null); }}
                  title="필터 초기화"
                  aria-label="필터 초기화"
                  className="ml-auto flex h-7 w-7 cursor-pointer items-center justify-center rounded border border-lol-border/50 text-xs text-lol-gold-light/45 hover:text-lol-gold-light"
                >
                  ×
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <span className="w-8 shrink-0 text-center text-[10px] text-lol-gold-light/40" title="라인">라인</span>
              {(Object.keys(LANE_LABELS) as LaneRole[]).map((lane) => {
                const active = laneFilter === lane;
                return (
                  <FilterIconButton
                    key={lane}
                    active={active}
                    icon={LANE_ICON_URLS[lane]}
                    label={LANE_LABELS[lane]}
                    title={`라인: ${LANE_LABELS[lane]}`}
                    onClick={() => setLaneFilter((prev) => prev === lane ? null : lane)}
                  />
                );
              })}
            </div>

            <div className="flex max-h-[5.8rem] items-start gap-1.5 overflow-y-auto pr-1">
              <span className="mt-2 w-8 shrink-0 text-center text-[10px] text-lol-gold-light/40" title="특성">특성</span>
              <div className="flex flex-wrap gap-1">
                {(Object.keys(TAG_LABELS) as MechanicTag[]).map((tag) => {
                  const active = traitFilter === tag;
                  return (
                    <FilterIconButton
                      key={tag}
                      active={active}
                      icon={TAG_ICON_URLS[tag]}
                      label={TAG_SHORT_LABELS[tag] ?? getTagLabel(tag)}
                      title={`특성: ${TAG_LABELS[tag] ?? tag}`}
                      onClick={() => setTraitFilter((prev) => prev === tag ? null : tag)}
                      dense
                    />
                  );
                })}
              </div>
            </div>
          </div>

          <div className="text-xs text-center space-y-1">
            <div className="text-lol-gold-light/40">
              {activeSlot
                ? activeSlot.type === 'ban'
                  ? `Team ${activeSlot.team} 밴 선택 중`
                  : `${getPlayerName(activeSlot.playerId)} 챔피언 선택 중`
                : '슬롯을 클릭하세요'}
            </div>
            {phase === 'pick' && (
              <div className="flex items-center justify-center gap-1 text-[10px]">
                <span className="text-lol-gold-light/30">드래프트:</span>
                {draftOrder.map((pid, i) => {
                  const isPicked = !!picks[pid];
                  const isCurrent = activeSlot?.type === 'pick' && activeSlot.playerId === pid;
                  const isT1 = team1PlayerIds.includes(pid);
                  return (
                    <span key={i} className={`px-1 rounded ${
                      isCurrent ? 'bg-lol-gold text-lol-dark font-bold'
                      : isPicked ? 'text-lol-gold-light/20 line-through'
                      : isT1 ? 'text-blue-400' : 'text-red-400'
                    }`}>
                      {getPlayerName(pid).slice(0, 2)}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
          <div className="grid grid-cols-6 sm:grid-cols-7 md:grid-cols-9 lg:grid-cols-11 gap-px max-h-[calc(100vh-320px)] overflow-y-auto">
            {/* Skip Ban card — shown first in ban phase */}
            {phase === 'ban' && activeSlot?.type === 'ban' && (
              <div
                onClick={handleSkipBan}
                className="cursor-pointer w-full aspect-square rounded border-2 border-dashed border-gray-600 bg-gray-800/40 flex flex-col items-center justify-center hover:border-gray-400 hover:bg-gray-700/40 transition-colors"
                title="밴 없음"
              >
                <span className="text-gray-400 text-lg font-bold">✕</span>
                <span className="text-[8px] text-gray-500">밴 없음</span>
              </div>
            )}
            {gridChampions.map((champ) => {
              const isBanned = allBannedIds.has(champ.id);
              const isPicked = pickedIds.has(champ.id);
              const disabled = isBanned || isPicked;
              const profLevel = activeSlot?.type === 'pick'
                ? mergedProficiencies[activeSlot.playerId]?.get(champ.id) : undefined;

              // Opponent winrate for this champion
              const opponentIds = activeSlot?.type === 'ban'
                ? (activeSlot.team === 1 ? team2PlayerIds : team1PlayerIds)
                : (activeSlot?.type === 'pick'
                  ? (team1PlayerIds.includes(activeSlot.playerId) ? team2PlayerIds : team1PlayerIds)
                  : []);
              let oppWr: string | null = null;
              let oppTooltipParts: string[] = [];
              if (wrStats && opponentIds.length > 0) {
                const oppStats = wrStats.playerChampStats.filter(
                  (s) => s.championId === champ.id && opponentIds.includes(s.playerId)
                );
                if (oppStats.length > 0) {
                  const totalW = oppStats.reduce((a, s) => a + s.wins, 0);
                  const totalL = oppStats.reduce((a, s) => a + s.losses, 0);
                  if (totalW + totalL > 0) {
                    oppWr = `${Math.round((totalW / (totalW + totalL)) * 100)}%`;
                  }
                  oppTooltipParts = oppStats.map((s) => {
                    const name = getPlayerName(s.playerId);
                    return `${name}: ${s.wins}승 ${s.losses}패 (${Math.round(s.winrate)}%)`;
                  });
                }
                // Also show proficiency info in tooltip
                for (const oid of opponentIds) {
                  const prof = proficiencies[oid]?.get(champ.id);
                  if (prof && prof !== '없음' && !oppStats.some((s) => s.playerId === oid)) {
                    oppTooltipParts.push(`${getPlayerName(oid)}: 숙련도 ${prof}`);
                  }
                }
              }

              return (
                <ChampionWithHover
                  key={champ.id}
                  champion={champ}
                  wrStats={wrStats}
                  allPlayers={players}
                  proficiencies={proficiencies}
                  estimatedMap={estimatedMap}
                  highlightPlayerIds={opponentIds}
                  disabled={disabled}
                >
                  <div
                    onClick={() => !disabled && handleChampionSelect(champ.id)}
                    className={`flex flex-col items-center gap-0.5 p-0.5 rounded border transition-colors ${
                      disabled
                        ? 'border-transparent opacity-20 cursor-not-allowed'
                        : 'border-lol-border hover:border-lol-gold cursor-pointer bg-lol-blue/50'
                    }`}
                  >
                    <div className="w-11 h-11 rounded overflow-hidden">
                      <img src={champ.imageUrl} className={`w-full h-full ${disabled ? 'grayscale' : ''}`} loading="lazy" />
                    </div>
                    <span className="text-[9px] text-lol-gold-light/60 text-center leading-tight truncate w-full">
                      {champ.nameKo}
                    </span>
                    {profLevel && profLevel !== '없음' && (
                      <ProficiencyBadge level={profLevel} size="sm" />
                    )}
                    {oppWr && !disabled && (
                      <span className={`text-[9px] font-mono ${
                        parseInt(oppWr) >= 60 ? 'text-prof-low' : parseInt(oppWr) >= 40 ? 'text-lol-gold-light/50' : 'text-prof-high'
                      }`}>
                        vs {oppWr}
                      </span>
                    )}
                  </div>
                </ChampionWithHover>
              );
            })}
          </div>
        </div>

        {/* Team 2 */}
        {renderTeamPanel(2)}
      </div>
    </div>
  );
}
