// Type definition for the synergy-counter-data.json structure
export interface SynergyCounterData {
  version: string;
  matchCount: number;
  synergies: Record<string, { wins: number; total: number; winrate: number }>;
  counters: Record<string, {
    strongAgainst: { id: string; winrate: number; games: number }[];
    weakAgainst: { id: string; winrate: number; games: number }[];
  }>;
}

let cachedData: SynergyCounterData | null = null;

export async function loadSynergyCounterData(): Promise<SynergyCounterData | null> {
  if (cachedData) return cachedData;

  try {
    const mod = await import('@/data/synergy-counter-data.json');
    cachedData = mod.default as SynergyCounterData;
    return cachedData;
  } catch {
    return null;
  }
}
