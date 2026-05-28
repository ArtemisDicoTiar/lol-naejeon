import type { GameParticipantStat, GamePick } from './db';

function rowSortKey(row: GameParticipantStat) {
  return row.id ?? 0;
}

function pickSortKey(pick: GamePick) {
  return pick.id ?? 0;
}

function findUnusedPick(
  picks: GamePick[],
  usedPickIds: Set<number>,
  predicate: (pick: GamePick) => boolean,
) {
  return picks.find((pick) => {
    if (pick.id && usedPickIds.has(pick.id)) return false;
    return predicate(pick);
  });
}

interface ResolveOptions {
  preferPickChampion?: boolean;
}

function applyPick(
  row: GameParticipantStat,
  pick: GamePick | undefined,
  usedPickIds: Set<number>,
  options: ResolveOptions,
) {
  if (!pick) return row;
  if (pick.id) usedPickIds.add(pick.id);
  return {
    ...row,
    playerId: pick.playerId,
    championId: options.preferPickChampion ? pick.championId : row.championId ?? pick.championId,
    team: pick.team,
    alias: row.alias ?? null,
  };
}

export function resolveParticipantStatsToPicks(
  rows: GameParticipantStat[],
  picks: GamePick[],
  options: ResolveOptions = {},
): GameParticipantStat[] {
  if (rows.length === 0 || picks.length === 0) return rows;

  const sortedPicks = [...picks].sort((a, b) => {
    if (a.team !== b.team) return a.team - b.team;
    return pickSortKey(a) - pickSortKey(b);
  });
  const sortedRows = [...rows].sort((a, b) => rowSortKey(a) - rowSortKey(b));
  const usedPickIds = new Set<number>();
  const matchedRowIds = new Set<number | undefined>();
  const resolvedByRowId = new Map<number | undefined, GameParticipantStat>();

  for (const row of sortedRows) {
    const pick = findUnusedPick(sortedPicks, usedPickIds, (candidate) =>
      candidate.playerId === row.playerId &&
      (!row.championId || candidate.championId === row.championId) &&
      (row.team === 0 || candidate.team === row.team),
    );
    if (pick) matchedRowIds.add(row.id);
    resolvedByRowId.set(row.id, applyPick(row, pick, usedPickIds, options));
  }

  for (const row of sortedRows) {
    if (matchedRowIds.has(row.id)) continue;
    const pick = findUnusedPick(sortedPicks, usedPickIds, (candidate) =>
      !!row.championId &&
      candidate.championId === row.championId &&
      (row.team === 0 || candidate.team === row.team),
    );
    if (pick) matchedRowIds.add(row.id);
    resolvedByRowId.set(row.id, applyPick(row, pick, usedPickIds, options));
  }

  for (const team of [1, 2] as const) {
    const teamRows = sortedRows.filter((row) => {
      return row.team === team && !matchedRowIds.has(row.id);
    });
    const teamPicks = sortedPicks.filter((pick) => pick.team === team && (!pick.id || !usedPickIds.has(pick.id)));
    teamRows.forEach((row, index) => {
      if (teamPicks[index]) matchedRowIds.add(row.id);
      resolvedByRowId.set(row.id, applyPick(row, teamPicks[index], usedPickIds, options));
    });
  }

  const unresolvedRows = sortedRows.filter((row) => !matchedRowIds.has(row.id));
  const unusedPicks = sortedPicks.filter((pick) => !pick.id || !usedPickIds.has(pick.id));
  if (unresolvedRows.length === unusedPicks.length) {
    unresolvedRows.forEach((row, index) => {
      if (unusedPicks[index]) matchedRowIds.add(row.id);
      resolvedByRowId.set(row.id, applyPick(row, unusedPicks[index], usedPickIds, options));
    });
  }

  return rows.map((row) => resolvedByRowId.get(row.id) ?? row);
}
