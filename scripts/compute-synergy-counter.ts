/**
 * Compute champion synergy and counter statistics from Kaggle match data.
 *
 * Usage:
 *   npx tsx scripts/compute-synergy-counter.ts
 *
 * Input:  data/games.csv + data/champion_info.json (from Kaggle datasnaek/league-of-legends)
 * Output: src/data/synergy-counter-data.json
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const CSV_PATH = resolve(ROOT, 'data/games.csv');
const CHAMP_INFO_PATH = resolve(ROOT, 'data/champion_info.json');
const OUTPUT_PATH = resolve(ROOT, 'src/data/synergy-counter-data.json');

const MIN_SYNERGY_GAMES = 30;
const MIN_COUNTER_GAMES = 30;
const SYNERGY_WINRATE_THRESHOLD = 3; // Only keep pairs with >=3% deviation from 50%

// --- Load champion ID map ---
interface ChampInfo { id: number; key: string; name: string }
const champInfoRaw = JSON.parse(readFileSync(CHAMP_INFO_PATH, 'utf-8'));
const idToKey = new Map<number, string>();
for (const [numId, info] of Object.entries(champInfoRaw.data) as [string, ChampInfo][]) {
  // "key" field matches our internal IDs (e.g., "Annie", "TwistedFate", "MonkeyKing")
  let key = info.key;
  // Normalize known mismatches with our aram-champion-meta.ts IDs
  if (key === 'MonkeyKing') key = 'Wukong';
  if (key === 'Chogath') key = 'Chogath';
  idToKey.set(Number(numId), key);
}

console.log(`Loaded ${idToKey.size} champion ID mappings`);

// --- Parse CSV ---
const rawCsv = readFileSync(CSV_PATH, 'utf-8');
const lines = rawCsv.split(/[\r\n]+/).filter((l) => l.length > 0);
const header = lines[0].split(',');
const dataLines = lines.slice(1);

function colIndex(name: string): number {
  const idx = header.indexOf(name);
  if (idx === -1) throw new Error(`Column not found: ${name}`);
  return idx;
}

const WINNER_COL = colIndex('winner');
const T1_CHAMP_COLS = [
  colIndex('t1_champ1id'), colIndex('t1_champ2id'), colIndex('t1_champ3id'),
  colIndex('t1_champ4id'), colIndex('t1_champ5id'),
];
const T2_CHAMP_COLS = [
  colIndex('t2_champ1id'), colIndex('t2_champ2id'), colIndex('t2_champ3id'),
  colIndex('t2_champ4id'), colIndex('t2_champ5id'),
];

console.log(`Parsing ${dataLines.length} matches...`);

// --- Compute statistics ---
// Synergy: same-team pairs
const synergyMap = new Map<string, { wins: number; total: number }>();
// Counter: cross-team matchups (key = "A_vs_B" means A faces B)
const counterMap = new Map<string, { wins: number; total: number }>();

function pairKey(a: string, b: string): string {
  return a < b ? `${a}+${b}` : `${b}+${a}`;
}

let parsed = 0;
let skipped = 0;

for (const line of dataLines) {
  const cols = line.split(',');
  const winner = Number(cols[WINNER_COL]);
  if (winner !== 1 && winner !== 2) { skipped++; continue; }

  const t1Ids = T1_CHAMP_COLS.map((c) => Number(cols[c]));
  const t2Ids = T2_CHAMP_COLS.map((c) => Number(cols[c]));

  const t1Keys = t1Ids.map((id) => idToKey.get(id)).filter(Boolean) as string[];
  const t2Keys = t2Ids.map((id) => idToKey.get(id)).filter(Boolean) as string[];

  if (t1Keys.length < 5 || t2Keys.length < 5) { skipped++; continue; }

  const t1Won = winner === 1;

  // Synergy: all pairs within each team
  for (let i = 0; i < t1Keys.length; i++) {
    for (let j = i + 1; j < t1Keys.length; j++) {
      const key = pairKey(t1Keys[i], t1Keys[j]);
      const entry = synergyMap.get(key) ?? { wins: 0, total: 0 };
      entry.total++;
      if (t1Won) entry.wins++;
      synergyMap.set(key, entry);
    }
  }
  for (let i = 0; i < t2Keys.length; i++) {
    for (let j = i + 1; j < t2Keys.length; j++) {
      const key = pairKey(t2Keys[i], t2Keys[j]);
      const entry = synergyMap.get(key) ?? { wins: 0, total: 0 };
      entry.total++;
      if (!t1Won) entry.wins++;
      synergyMap.set(key, entry);
    }
  }

  // Counter: each champion on team1 vs each champion on team2
  for (const a of t1Keys) {
    for (const b of t2Keys) {
      // A vs B
      const keyAB = `${a}_vs_${b}`;
      const entryAB = counterMap.get(keyAB) ?? { wins: 0, total: 0 };
      entryAB.total++;
      if (t1Won) entryAB.wins++;
      counterMap.set(keyAB, entryAB);

      // B vs A (reverse)
      const keyBA = `${b}_vs_${a}`;
      const entryBA = counterMap.get(keyBA) ?? { wins: 0, total: 0 };
      entryBA.total++;
      if (!t1Won) entryBA.wins++;
      counterMap.set(keyBA, entryBA);
    }
  }

  parsed++;
}

console.log(`Parsed: ${parsed}, Skipped: ${skipped}`);

// --- Filter and format synergy data ---
const synergies: Record<string, { wins: number; total: number; winrate: number }> = {};
let synergyCount = 0;
for (const [key, stats] of synergyMap) {
  if (stats.total < MIN_SYNERGY_GAMES) continue;
  const wr = Math.round((stats.wins / stats.total) * 1000) / 10;
  if (Math.abs(wr - 50) < SYNERGY_WINRATE_THRESHOLD) continue; // Skip near-50% pairs
  synergies[key] = { wins: stats.wins, total: stats.total, winrate: wr };
  synergyCount++;
}

// --- Filter and format counter data ---
// Aggregate per champion: top strong-against and weak-against
const champCounters = new Map<string, { against: string; winrate: number; games: number }[]>();

for (const [key, stats] of counterMap) {
  if (stats.total < MIN_COUNTER_GAMES) continue;
  const [champA, , champB] = key.split('_'); // "A_vs_B"
  const winrate = Math.round((stats.wins / stats.total) * 1000) / 10;

  if (!champCounters.has(champA)) champCounters.set(champA, []);
  champCounters.get(champA)!.push({ against: champB, winrate, games: stats.total });
}

const counters: Record<string, {
  strongAgainst: { id: string; winrate: number; games: number }[];
  weakAgainst: { id: string; winrate: number; games: number }[];
}> = {};

for (const [champ, matchups] of champCounters) {
  matchups.sort((a, b) => b.winrate - a.winrate);
  counters[champ] = {
    strongAgainst: matchups.filter((m) => m.winrate > 53).slice(0, 5)
      .map((m) => ({ id: m.against, winrate: m.winrate, games: m.games })),
    weakAgainst: matchups.filter((m) => m.winrate < 47).slice(-5).reverse()
      .map((m) => ({ id: m.against, winrate: m.winrate, games: m.games })),
  };
}

// --- Output ---
const output = {
  version: new Date().toISOString().slice(0, 10),
  matchCount: parsed,
  synergyPairCount: synergyCount,
  counterChampionCount: Object.keys(counters).length,
  synergies,
  counters,
};

writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

console.log(`\nOutput written to ${OUTPUT_PATH}`);
console.log(`  Synergy pairs: ${synergyCount}`);
console.log(`  Counter champions: ${Object.keys(counters).length}`);

// Show top synergies
const topSynergies = Object.entries(synergies)
  .sort((a, b) => b[1].winrate - a[1].winrate)
  .slice(0, 10);
console.log(`\nTop 10 synergy pairs:`);
for (const [key, s] of topSynergies) {
  console.log(`  ${key}: ${s.winrate}% (${s.total} games)`);
}

// Show a known pair
const malphiteYasuo = synergies['Malphite+Yasuo'];
if (malphiteYasuo) {
  console.log(`\nMalphite+Yasuo: ${malphiteYasuo.winrate}% (${malphiteYasuo.total} games)`);
}
