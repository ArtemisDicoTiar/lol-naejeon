#!/usr/bin/env node

import { authenticate, createWebSocketConnection, createHttp1Request } from 'league-connect';
import { WebSocketServer } from 'ws';
import https from 'node:https';

const WS_PORT = 8234;

// Summoner name → app alias mapping
const SUMMONER_ALIAS = {
  'TwelveOClock': '12시',
  'Twelveoclock': '12시',
  'twelveoclock': '12시',
  'RabiEddin': '11시',
  'Rabieddin': '11시',
  'rabieddin': '11시',
  'Gomjkhan': '곰',
  'gomjkhan': '곰',
  '인왕산와일드보어': '엔디',
  '행복한욕조견': '마참',
  '감귤 아저씨': '귤아저씨',
  '감귤아저씨': '귤아저씨',
  '기장앞바다벨코즈': '그리',
};

console.log('🎮 눈오는 헤네시스 - LoL 브릿지');
console.log('================================');

// --- Web app clients ---
const clients = new Set();
const wss = new WebSocketServer({ port: WS_PORT });

wss.on('listening', () => {
  console.log(`✅ 웹앱 브릿지 서버 시작: ws://localhost:${WS_PORT}`);
  console.log('   웹앱에서 "클라이언트 연결" 버튼을 클릭하세요.\n');
});

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`🌐 웹앱 연결됨 (현재 ${clients.size}개)`);
  ws.on('close', () => {
    clients.delete(ws);
    console.log(`🌐 웹앱 연결 해제 (현재 ${clients.size}개)`);
  });
  // Handle messages from web app
  ws.on('message', async (msgBuffer) => {
    try {
      const msg = JSON.parse(msgBuffer.toString());
      if (msg.type === 'hoverChampion') {
        await lcuHoverChampion(msg.championNumericId);
      } else if (msg.type === 'lockInChampion') {
        await lcuLockInChampion(msg.championNumericId);
      } else if (msg.type === 'hoverBan') {
        await lcuHoverBan(msg.championNumericId);
      } else if (msg.type === 'lockInBan') {
        await lcuLockInBan(msg.championNumericId);
      } else if (msg.type === 'fetchRecentCustomGames') {
        const result = await fetchRecentCustomGames(msg.limit);
        ws.send(JSON.stringify({ type: 'recentCustomGamesResult', requestId: msg.requestId, ...result }));
      }
    } catch {}
  });
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const client of clients) {
    try { client.send(msg); } catch {}
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`).join(',')}}`;
}

function hashString(input) {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  }
  return `eog_${(hash >>> 0).toString(16)}`;
}

function buildFingerprint(raw) {
  return hashString(stableStringify(raw));
}

function isCustomHistoryGame(game) {
  const queueId = Number(game?.queueId ?? game?.queue?.id ?? -1);
  const queueType = String(game?.queueType ?? game?.gameQueueType ?? '').toUpperCase();
  const gameType = String(game?.gameType ?? '').toUpperCase();
  const gameMode = String(game?.gameMode ?? game?.gameModeName ?? '').toUpperCase();
  return (
    queueId === 0 ||
    queueType.includes('CUSTOM') ||
    gameType.includes('CUSTOM') ||
    gameMode.includes('CUSTOM')
  );
}

function collectStringHints(value, out = []) {
  if (value === null || value === undefined) return out;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    out.push(String(value));
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringHints(item, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const [key, val] of Object.entries(value)) {
      if (/mode|queue|map|variant|variation|mutator|augment|game|type|name|description/i.test(key)) {
        out.push(String(key));
        collectStringHints(val, out);
      }
    }
  }
  return out;
}

function inferInternalMode(game) {
  const hints = collectStringHints(game).join(' ').toUpperCase();
  const queueId = Number(game?.queueId ?? game?.queue?.id ?? game?.gameQueueConfigId ?? -1);
  if (
    hints.includes('AUGMENT') ||
    hints.includes('AUGMENTED') ||
    hints.includes('증강') ||
    hints.includes('증바람') ||
    hints.includes('CHERRY') ||
    hints.includes('STRAWBERRY') ||
    queueId === 1700 ||
    queueId === 1710
  ) {
    return 'augmented';
  }
  return 'aram';
}

function normalizeHistoryGame(game) {
  const participantIdentities = game?.participantIdentities || [];
  const identityById = new Map(
    participantIdentities.map((entry) => [entry.participantId, entry.player || {}]),
  );

  const participants = (game?.participants || []).map((participant) => {
    const player = identityById.get(participant.participantId) || {};
    const summonerName = player.gameName || player.summonerName || player.displayName || '';
    return {
      participantId: participant.participantId,
      teamId: participant.teamId,
      championId: participant.championId,
      summonerName,
      alias: findAlias(summonerName) ?? null,
      riotId: player.riotId || player.riotIdGameName || null,
      stats: participant.stats || {},
    };
  });

  const winnerTeamId = (game?.teams || []).find((team) => team.win === 'Win' || team.win === true)?.teamId ?? null;

  return {
    gameId: game.gameId,
    gameCreation: game.gameCreation || game.gameCreationDate || Date.now(),
    gameDuration: game.gameDuration || 0,
    queueId: game.queueId ?? null,
    mapId: game.mapId ?? null,
    gameMode: game.gameMode || game.gameModeName || null,
    gameType: game.gameType || null,
    mode: inferInternalMode(game),
    winnerTeamId,
    participants,
    raw: game,
  };
}

// --- Lobby snapshot for fallback alias resolution ---
let lobbySnapshot = { team100: [], team200: [] };

// --- LCU Write: hover/lock-in champion for current user ---
let mySummonerId = null;
let eogCapturePromise = null;
let lastEogFingerprint = null;
let lastEogCapturedAt = 0;

async function getMySelldId() {
  if (!credentials) return undefined;
  // Get current summoner ID
  if (!mySummonerId) {
    try {
      const resp = await createHttp1Request({ method: 'GET', url: '/lol-summoner/v1/current-summoner' }, credentials);
      if (resp.status === 200) {
        mySummonerId = resp.json().summonerId;
        console.log(`   🆔 내 summonerId: ${mySummonerId}`);
      }
    } catch {}
  }

  try {
    const resp = await createHttp1Request({ method: 'GET', url: '/lol-champ-select/v1/session' }, credentials);
    if (resp.status !== 200) return undefined;
    const data = resp.json();

    // Find my cellId from myTeam using summonerId
    let myCell = undefined;
    for (const m of (data.myTeam || [])) {
      if (m.summonerId === mySummonerId) { myCell = m.cellId; break; }
    }
    // Fallback: first member with summonerId > 0
    if (myCell === undefined) {
      myCell = (data.myTeam || []).find(m => m.summonerId > 0)?.cellId;
    }
    return { myCell, data };
  } catch {}
  return undefined;
}

async function findMyAction(actionType = 'pick') {
  const result = await getMySelldId();
  if (!result || result.myCell === undefined) return null;
  const { myCell, data } = result;

  // 1st: find in-progress action (it's my turn)
  for (const group of (data.actions || [])) {
    for (const action of group) {
      if (action.type === actionType && action.actorCellId === myCell && !action.completed && action.isInProgress) {
        console.log(`   🔍 ${actionType} 액션 발견 (inProgress): id=${action.id} cell=${myCell}`);
        return action.id;
      }
    }
  }
  // 2nd: find any uncompleted action
  for (const group of (data.actions || [])) {
    for (const action of group) {
      if (action.type === actionType && action.actorCellId === myCell && !action.completed) {
        console.log(`   🔍 ${actionType} 액션 발견 (pending): id=${action.id} cell=${myCell}`);
        return action.id;
      }
    }
  }
  console.log(`   ⚠️ ${actionType} 액션 없음 (cell=${myCell})`);
  return null;
}

async function lcuHoverChampion(championId) {
  const actionId = await findMyAction('pick');
  if (actionId === null) return;
  try {
    const resp = await createHttp1Request({
      method: 'PATCH',
      url: `/lol-champ-select/v1/session/actions/${actionId}`,
      body: { championId },
    }, credentials);
    console.log(`🎯 호버 → champId ${championId} (status: ${resp.status})`);
  } catch (e) {
    console.log(`⚠️ 호버 실패: ${e.message || e}`);
  }
}

async function lcuHoverBan(championId) {
  const actionId = await findMyAction('ban');
  if (actionId === null) return;
  try {
    const resp = await createHttp1Request({
      method: 'PATCH',
      url: `/lol-champ-select/v1/session/actions/${actionId}`,
      body: { championId },
    }, credentials);
    console.log(`🚫 밴 호버 → champId ${championId} (status: ${resp.status})`);
  } catch (e) {
    console.log(`⚠️ 밴 호버 실패: ${e.message || e}`);
  }
}

async function lcuLockInBan(championId) {
  const actionId = await findMyAction('ban');
  if (actionId === null) return;
  try {
    await createHttp1Request({
      method: 'PATCH',
      url: `/lol-champ-select/v1/session/actions/${actionId}`,
      body: { championId },
    }, credentials);
    const resp = await createHttp1Request({
      method: 'POST',
      url: `/lol-champ-select/v1/session/actions/${actionId}/complete`,
      body: {},
    }, credentials);
    console.log(`🔒 밴 락인 → champId ${championId} (status: ${resp.status})`);
  } catch (e) {
    console.log(`⚠️ 밴 락인 실패: ${e.message || e}`);
  }
}

async function lcuLockInChampion(championId) {
  const actionId = await findMyAction('pick');
  if (actionId === null) { console.log('⚠️ 픽 액션을 찾을 수 없음'); return; }
  try {
    await createHttp1Request({
      method: 'PATCH',
      url: `/lol-champ-select/v1/session/actions/${actionId}`,
      body: { championId },
    }, credentials);
    await createHttp1Request({
      method: 'POST',
      url: `/lol-champ-select/v1/session/actions/${actionId}/complete`,
      body: {},
    }, credentials);
    console.log(`🔒 락인 → champId ${championId}`);
  } catch (e) {
    console.log(`⚠️ 락인 실패: ${e}`);
  }
}

// --- Summoner name cache (summonerId → { gameName, alias }) ---
const summonerCache = new Map();
let credentials = null;

async function resolveSummoner(summonerId) {
  if (!summonerId || summonerId === 0) return null;
  if (summonerCache.has(summonerId)) return summonerCache.get(summonerId);

  // Try multiple endpoints
  const endpoints = [
    `/lol-summoner/v2/summoners?ids=[${summonerId}]`,
    `/lol-summoner/v1/summoners/${summonerId}`,
  ];

  for (const url of endpoints) {
    try {
      const resp = await createHttp1Request({ method: 'GET', url }, credentials);
      if (resp.status === 200) {
        const data = resp.json();
        const summoner = Array.isArray(data) ? data[0] : data;
        if (summoner) {
          const name = summoner.gameName || summoner.displayName || summoner.internalName || '';
          if (name) {
            const alias = findAlias(name);
            const result = { gameName: name, alias };
            summonerCache.set(summonerId, result);
            console.log(`   👤 ${name} → ${alias ?? '(매핑 없음)'}`);
            return result;
          }
        }
      }
    } catch {}
  }

  console.log(`   ⚠️ summonerId ${summonerId} 조회 실패`);
  return null;
}

// Pre-cache lobby members and broadcast team info
async function cacheLobbyMembers() {
  try {
    const resp = await createHttp1Request({ method: 'GET', url: '/lol-lobby/v2/lobby' }, credentials);
    if (resp.status === 200) {
      const lobby = resp.json();
      const team100 = lobby.gameConfig?.customTeam100 || [];
      const team200 = lobby.gameConfig?.customTeam200 || [];
      lobbySnapshot = { team100: [...team100], team200: [...team200] };
      const allMembers = [...(lobby.members || []), ...team100, ...team200];

      for (const m of allMembers) {
        const name = extractName(m);
        if (m.summonerId && name && !summonerCache.has(m.summonerId)) {
          const alias = findAlias(name);
          summonerCache.set(m.summonerId, { gameName: name, alias });
          console.log(`   👤 (로비) ${name} → ${alias ?? '(매핑 없음)'}`);
        } else if (m.summonerId && !summonerCache.has(m.summonerId)) {
          await resolveSummoner(m.summonerId);
        }
      }

      // Broadcast lobby teams
      if (team100.length > 0 || team200.length > 0) {
        const resolveMember = async (m) => {
          let name = extractName(m);
          let alias = name ? findAlias(name) : null;
          if (!alias && m.summonerId) {
            const resolved = summonerCache.get(m.summonerId) || await resolveSummoner(m.summonerId);
            if (resolved) { name = resolved.gameName; alias = resolved.alias; }
          }
          return { summonerId: m.summonerId, gameName: name || '', alias };
        };
        const lobbyTeam1 = await Promise.all(team100.map(resolveMember));
        const lobbyTeam2 = await Promise.all(team200.map(resolveMember));
        console.log(`🏠 로비 | T1: [${lobbyTeam1.map(m => m.alias ?? m.gameName ?? '?').join(', ')}] T2: [${lobbyTeam2.map(m => m.alias ?? m.gameName ?? '?').join(', ')}]`);
        broadcast({ type: 'lobbyUpdate', team1: lobbyTeam1, team2: lobbyTeam2 });
      }
    }
  } catch {}
}

async function fetchCurrentGameflowPhase() {
  if (!credentials) return null;
  try {
    const resp = await createHttp1Request({ method: 'GET', url: '/lol-gameflow/v1/gameflow-phase' }, credentials);
    if (resp.status === 200) return resp.json();
  } catch {}
  return null;
}

async function fetchRecentCustomGames(limit = 20) {
  try {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 50));
    const endIndex = Math.max(0, safeLimit - 1);
    const resp = await createHttp1Request({
      method: 'GET',
      url: `/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=${endIndex}`,
    }, credentials);
    if (resp.status !== 200) {
      return { ok: false, error: `match history status ${resp.status}`, items: [] };
    }

    const payload = resp.json();
    const games = payload?.games?.games || payload?.games || [];
    const customGames = games.filter(isCustomHistoryGame);
    const items = [];

    for (const game of customGames) {
      try {
        const detailResp = await createHttp1Request({
          method: 'GET',
          url: `/lol-match-history/v1/games/${game.gameId}`,
        }, credentials);
        if (detailResp.status !== 200) continue;
        const detail = detailResp.json();
        items.push(normalizeHistoryGame(detail?.game || detail));
      } catch {}
    }

    return { ok: true, items };
  } catch (error) {
    return { ok: false, error: error?.message || String(error), items: [] };
  }
}

async function fetchEogStatsBlock() {
  if (!credentials) throw new Error('LCU credentials unavailable');
  const resp = await createHttp1Request({ method: 'GET', url: '/lol-end-of-game/v1/eog-stats-block' }, credentials);
  if (resp.status !== 200) {
    throw new Error(`eog-stats-block status ${resp.status}`);
  }
  return resp.json();
}

async function captureEndOfGameStats(trigger = 'phase') {
  if (eogCapturePromise) return eogCapturePromise;

  const startedAt = new Date().toISOString();
  broadcast({ type: 'eogCaptureStarted', trigger, startedAt });

  eogCapturePromise = (async () => {
    const delays = [1500, 3000, 5000];
    let lastError = 'EOG data unavailable';

    for (const delay of delays) {
      await sleep(delay);
      try {
        const raw = await fetchEogStatsBlock();
        const fingerprint = buildFingerprint(raw);
        const now = Date.now();
        if (fingerprint === lastEogFingerprint && now - lastEogCapturedAt < 60_000) {
          broadcast({
            type: 'eogCaptureSucceeded',
            trigger,
            startedAt,
            capturedAt: new Date(now).toISOString(),
            fingerprint,
            raw,
            duplicate: true,
          });
          return;
        }

        lastEogFingerprint = fingerprint;
        lastEogCapturedAt = now;
        broadcast({
          type: 'eogCaptureSucceeded',
          trigger,
          startedAt,
          capturedAt: new Date(now).toISOString(),
          fingerprint,
          raw,
          duplicate: false,
        });
        return;
      } catch (error) {
        lastError = error?.message || String(error);
      }
    }

    broadcast({
      type: 'eogCaptureFailed',
      trigger,
      startedAt,
      failedAt: new Date().toISOString(),
      error: lastError,
    });
  })().finally(() => {
    eogCapturePromise = null;
  });

  return eogCapturePromise;
}

function extractName(member) {
  return member.gameName || member.summonerName || member.displayName || member.internalName || member.name || '';
}

function findAlias(gameName) {
  // Try exact match first
  if (SUMMONER_ALIAS[gameName]) return SUMMONER_ALIAS[gameName];
  // Try case-insensitive
  const lower = gameName.toLowerCase();
  for (const [key, val] of Object.entries(SUMMONER_ALIAS)) {
    if (key.toLowerCase() === lower) return val;
  }
  // Try partial match (contains)
  for (const [key, val] of Object.entries(SUMMONER_ALIAS)) {
    if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) return val;
  }
  return null;
}

// --- LCU Connection ---
async function connectToLCU() {
  console.log('🔍 LoL 클라이언트 탐색 중...');

  try {
    credentials = await authenticate({ awaitConnection: true, pollInterval: 3000 });
    console.log(`✅ LoL 클라이언트 발견! (포트: ${credentials.port})`);
  } catch (e) {
    console.error('❌ LoL 클라이언트를 찾을 수 없습니다. 클라이언트를 실행해주세요.');
    process.exit(1);
  }

  const ws = await createWebSocketConnection(credentials);
  console.log('✅ LCU WebSocket 연결 완료');
  console.log('⏳ 챔피언 셀렉트 대기 중...\n');

  let lastState = null;
  let lastGameflowPhase = null;

  ws.on('message', async (messageBuffer) => {
    const message = messageBuffer.toString();
    if (!message.startsWith('[')) return;

    try {
      const [opcode, , payload] = JSON.parse(message);
      if (opcode !== 8) return;

      const { uri, data, eventType } = payload;

      if (uri === '/lol-champ-select/v1/session') {
        if (eventType === 'Delete') {
          console.log('⚡ 챔피언 셀렉트 종료');
          broadcast({ type: 'champSelectEnd' });
          lastState = null;
          stopTimerPolling();
          return;
        }

        // Cache lobby members on first champ select event
        if (!lastState) {
          await cacheLobbyMembers();
          startTimerPolling();
        }

        const state = await parseChampSelectState(data);
        if (stateChanged(lastState, state)) {
          lastState = state;
          const t1Info = state.team1Picks.map(p => `${p.alias ?? '?'}=${p.champId}`).join(', ');
          const t2Info = state.team2Picks.map(p => `${p.alias ?? '?'}=${p.champId}`).join(', ');
          console.log(`⚡ 업데이트 | T1 밴[${state.team1Bans}] 픽[${t1Info}] | T2 밴[${state.team2Bans}] 픽[${t2Info}]`);
          broadcast({ type: 'champSelectUpdate', ...state });
        }
      }

      // Lobby update — cache members AND broadcast team info
      if (uri === '/lol-lobby/v2/lobby' && eventType !== 'Delete') {
        const team100 = data.gameConfig?.customTeam100 || [];
        const team200 = data.gameConfig?.customTeam200 || [];
        const allMembers = [...(data.members || []), ...team100, ...team200];
        // Save snapshot for fallback alias resolution in champ select
        lobbySnapshot = { team100: [...team100], team200: [...team200] };

        // Debug: log raw member data on first encounter
        for (const m of allMembers) {
          const name = extractName(m);
          if (m.summonerId && name) {
            if (!summonerCache.has(m.summonerId)) {
              const alias = findAlias(name);
              summonerCache.set(m.summonerId, { gameName: name, alias });
              console.log(`   👤 (로비) ${name} → ${alias ?? '(매핑 없음)'}`);
            }
          } else if (m.summonerId) {
            // Try to resolve via API
            await resolveSummoner(m.summonerId);
          }
        }

        // Broadcast lobby teams to web app
        if (team100.length > 0 || team200.length > 0) {
          const resolveMember = async (m) => {
            let name = extractName(m);
            let alias = name ? findAlias(name) : null;
            // If no name from lobby data, try summonerId lookup
            if (!alias && m.summonerId) {
              const resolved = summonerCache.get(m.summonerId) || await resolveSummoner(m.summonerId);
              if (resolved) {
                name = resolved.gameName;
                alias = resolved.alias;
              }
            }
            return { summonerId: m.summonerId, gameName: name || '', alias };
          };

          const lobbyTeam1 = await Promise.all(team100.map(resolveMember));
          const lobbyTeam2 = await Promise.all(team200.map(resolveMember));
          console.log(`🏠 로비 | T1: [${lobbyTeam1.map(m => m.alias ?? m.gameName ?? '?').join(', ')}] T2: [${lobbyTeam2.map(m => m.alias ?? m.gameName ?? '?').join(', ')}]`);
          broadcast({ type: 'lobbyUpdate', team1: lobbyTeam1, team2: lobbyTeam2 });
        }
      }

      // Gameflow phase changes: detect game start/end
      if (uri === '/lol-gameflow/v1/gameflow-phase') {
        const phase = data;  // payload is just the phase string
        if (phase === lastGameflowPhase) return;
        lastGameflowPhase = phase;
        console.log(`🎮 게임 페이즈: ${phase}`);
        if (phase === 'InProgress' || phase === 'GameStart') {
          // Cache lobby once more before game starts
          await cacheLobbyMembers();
          broadcast({ type: 'gameStart' });
          // Fetch actual picks from Live Client Data API (runs in background)
          scheduleLivePicksFetch();
        } else if (phase === 'WaitingForStats' || phase === 'EndOfGame' || phase === 'PreEndOfGame') {
          broadcast({ type: 'gameEnd' });
          captureEndOfGameStats(`gameflow:${phase}`);
        }
      }
    } catch {}
  });

  ws.send(JSON.stringify([5, 'OnJsonApiEvent_lol-champ-select_v1_session']));
  ws.send(JSON.stringify([5, 'OnJsonApiEvent_lol-lobby_v2_lobby']));
  ws.send(JSON.stringify([5, 'OnJsonApiEvent_lol-gameflow_v1_gameflow-phase']));

  // Pre-cache lobby members if already in a lobby
  await cacheLobbyMembers();

  const currentPhase = await fetchCurrentGameflowPhase();
  if (currentPhase) {
    lastGameflowPhase = currentPhase;
    if (currentPhase === 'WaitingForStats' || currentPhase === 'EndOfGame' || currentPhase === 'PreEndOfGame') {
      captureEndOfGameStats(`startup:${currentPhase}`);
    }
  }

  // Poll in case already in champ select
  try {
    const resp = await createHttp1Request({ method: 'GET', url: '/lol-champ-select/v1/session' }, credentials);
    if (resp.status === 200) {
      const state = await parseChampSelectState(resp.json());
      lastState = state;
      console.log('⚡ 이미 챔피언 셀렉트 중!');
      broadcast({ type: 'champSelectUpdate', ...state });
    }
  } catch {}
}

async function parseChampSelectState(data) {
  // Debug: log team structure on first parse
  const myIds = (data.myTeam || []).map(m => `cell${m.cellId}:sid${m.summonerId}`);
  const theirIds = (data.theirTeam || []).map(m => `cell${m.cellId}:sid${m.summonerId}`);
  console.log(`   📋 myTeam: [${myIds}] theirTeam: [${theirIds}]`);

  // Log all action types
  if (data.actions) {
    const actionSummary = data.actions.map((group, gi) =>
      group.map(a => `${a.type}:cell${a.actorCellId}:champ${a.championId}:${a.completed ? 'done' : 'pending'}`).join(',')
    ).join(' | ');
    console.log(`   📋 actions: ${actionSummary}`);
  }

  // Determine team membership by myTeam/theirTeam arrays
  const myCellIds = new Set((data.myTeam || []).map(m => m.cellId));
  const theirCellIds = new Set((data.theirTeam || []).map(m => m.cellId));

  // Figure out which side is blue (Team 1) based on cellId
  // The team with the lower average cellId is blue
  const myMinCell = Math.min(...(data.myTeam || []).map(m => m.cellId));
  const theirMinCell = (data.theirTeam || []).length > 0 ? Math.min(...(data.theirTeam || []).map(m => m.cellId)) : 999;
  const myTeamIsBlue = myMinCell < theirMinCell;

  console.log(`   🔵 myTeam(min cell ${myMinCell}) = ${myTeamIsBlue ? 'Blue/T1' : 'Red/T2'}`);

  // Blue = Team 1, Red = Team 2
  const blueCellIds = myTeamIsBlue ? myCellIds : theirCellIds;
  const redCellIds = myTeamIsBlue ? theirCellIds : myCellIds;
  const blueMembers = myTeamIsBlue ? (data.myTeam || []) : (data.theirTeam || []);
  const redMembers = myTeamIsBlue ? (data.theirTeam || []) : (data.myTeam || []);

  const team1Bans = [];
  const team2Bans = [];
  const team1Picks = [];
  const team2Picks = [];

  // Parse bans — assign based on which team the actor belongs to
  if (data.actions) {
    for (const actionGroup of data.actions) {
      for (const action of actionGroup) {
        if (action.type === 'ban' && action.championId > 0) {
          const banEntry = { championId: action.championId, completed: !!action.completed };
          if (blueCellIds.has(action.actorCellId)) team1Bans.push(banEntry);
          else if (redCellIds.has(action.actorCellId)) team2Bans.push(banEntry);
          else {
            if (action.actorCellId < 5) team1Bans.push(banEntry);
            else team2Bans.push(banEntry);
          }
        }
      }
    }
    if (team1Bans.length > 0 || team2Bans.length > 0) {
      console.log(`   🚫 밴 감지 | T1(Blue): [${team1Bans.map(b => `${b.championId}${b.completed ? '✓' : ''}`)}] T2(Red): [${team2Bans.map(b => `${b.championId}${b.completed ? '✓' : ''}`)}]`);
    }
  }

  // Build a map of cellId → pick action champion (including hover/intent)
  const cellPickChamp = new Map();
  const cellPickCompleted = new Map();
  if (data.actions) {
    for (const actionGroup of data.actions) {
      for (const action of actionGroup) {
        if (action.type === 'pick' && action.championId > 0) {
          cellPickChamp.set(action.actorCellId, action.championId);
          cellPickCompleted.set(action.actorCellId, action.completed);
        }
      }
    }
  }

  // Check for completed trades — if trades happened, member.championId is already swapped
  const hasCompletedTrades = (data.trades || []).some(t => t.state === 'COMPLETED');

  // Helper: resolve a member's name/alias with lobby snapshot fallback
  const resolveWithFallback = async (member, lobbyTeam, posIdx) => {
    let summoner = await resolveSummoner(member.summonerId);
    if (summoner?.alias) return summoner;

    // Fallback 1: try to match by summonerId in lobby snapshot
    const lobbyMatch = lobbyTeam.find(lm => lm.summonerId && lm.summonerId === member.summonerId);
    if (lobbyMatch) {
      const name = extractName(lobbyMatch);
      if (name) {
        const alias = findAlias(name);
        return { gameName: name, alias };
      }
    }
    // Fallback 2: position-based match (champ select team order matches lobby team order)
    if (posIdx >= 0 && posIdx < lobbyTeam.length) {
      const posMatch = lobbyTeam[posIdx];
      const name = extractName(posMatch);
      if (name) {
        const alias = findAlias(name);
        return { gameName: name, alias };
      }
    }
    return summoner;
  };

  // Parse Team 1 (Blue) picks
  const blueLobby = myTeamIsBlue ? lobbySnapshot.team100 : lobbySnapshot.team200;
  for (let i = 0; i < blueMembers.length; i++) {
    const member = blueMembers[i];
    const summoner = await resolveWithFallback(member, blueLobby, i);
    const champId = hasCompletedTrades
      ? (member.championId || 0)
      : (cellPickChamp.get(member.cellId) || member.championId || 0);
    const locked = cellPickCompleted.get(member.cellId) || false;
    team1Picks.push({
      cellId: member.cellId,
      champId,
      locked,
      summonerId: member.summonerId,
      gameName: summoner?.gameName ?? '',
      alias: summoner?.alias ?? null,
    });
  }

  // Parse Team 2 (Red) picks
  const redLobby = myTeamIsBlue ? lobbySnapshot.team200 : lobbySnapshot.team100;
  for (let i = 0; i < redMembers.length; i++) {
    const member = redMembers[i];
    const summoner = await resolveWithFallback(member, redLobby, i);
    const champId = hasCompletedTrades
      ? (member.championId || 0)
      : (cellPickChamp.get(member.cellId) || member.championId || 0);
    const locked = cellPickCompleted.get(member.cellId) || false;
    team2Picks.push({
      cellId: member.cellId,
      champId,
      locked,
      summonerId: member.summonerId,
      gameName: summoner?.gameName ?? '',
      alias: summoner?.alias ?? null,
    });
  }

  const timer = data.timer || {};
  const phase = timer.phase || 'UNKNOWN';
  const timeLeft = Math.ceil((timer.adjustedTimeLeftInPhase ?? 0) / 1000);
  const totalTime = Math.ceil((timer.totalTimeInPhase ?? 0) / 1000);

  // Bench champions (ARAM reroll pool — populated in augmented ARAM). LCU has
  // returned both object rows and raw numeric arrays across patches/modes.
  const benchSources = [
    data.benchChampions,
    data.benchChampionIds,
    data.gameData?.benchChampions,
    data.gameData?.benchChampionIds,
  ].filter(Boolean);
  const benchChampions = [];
  for (const source of benchSources) {
    for (const entry of source || []) {
      const championId = Number(typeof entry === 'number' ? entry : entry?.championId ?? entry?.id);
      if (championId > 0 && !benchChampions.includes(championId)) benchChampions.push(championId);
    }
  }

  return { phase, mode: inferInternalMode(data), timeLeft, totalTime, team1Bans, team2Bans, team1Picks, team2Picks, benchChampions };
}

function stateChanged(prev, next) {
  if (!prev) return true;
  // Compare without timeLeft (timer is polled separately)
  const { timeLeft: _a, ...prevRest } = prev;
  const { timeLeft: _b, ...nextRest } = next;
  return JSON.stringify(prevRest) !== JSON.stringify(nextRest);
}

// --- Timer polling: send timer updates every second during champ select ---
let timerInterval = null;

async function startTimerPolling() {
  stopTimerPolling();
  // LCU gives a static adjustedTimeLeftInPhase that resets each poll.
  // Capture once per phase, then count down locally without re-polling the timer.
  let currentPhase = '';
  let phaseEndTime = 0;
  let totalTime = 0;

  // One-time fetch to capture initial phase & timer
  const capturePhase = async () => {
    try {
      const resp = await createHttp1Request({ method: 'GET', url: '/lol-champ-select/v1/session' }, credentials);
      if (resp.status === 200) {
        const data = resp.json();
        const timer = data.timer || {};
        const phase = timer.phase || 'UNKNOWN';
        if (phase !== currentPhase) {
          currentPhase = phase;
          const rawTimeLeft = timer.adjustedTimeLeftInPhase ?? timer.timeLeftInPhase ?? 0;
          phaseEndTime = Date.now() + rawTimeLeft;
          totalTime = Math.ceil((timer.totalTimeInPhase ?? 0) / 1000);
          console.log(`   ⏱️ 페이즈 변경: ${phase} (${Math.ceil(rawTimeLeft/1000)}s)`);
        }
      }
    } catch {}
  };

  await capturePhase();

  // Check for phase changes every 2 seconds (not timer value, just phase name)
  phaseCheckInterval = setInterval(capturePhase, 2000);

  // Tick down locally every second
  timerInterval = setInterval(() => {
    const timeLeft = Math.max(0, Math.ceil((phaseEndTime - Date.now()) / 1000));
    console.log(`   ⏱️ ${currentPhase} ${timeLeft}s / ${totalTime}s`);
    broadcast({ type: 'timerUpdate', phase: currentPhase, timeLeft, totalTime });
  }, 1000);
}

let phaseCheckInterval = null;

function stopTimerPolling() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  if (phaseCheckInterval) { clearInterval(phaseCheckInterval); phaseCheckInterval = null; }
}

// --- Live Client Data API: fetch all players' champions once game starts ---
// The Live Client Data API runs on port 2999 (separate from LCU), requires
// no auth, but uses a self-signed cert → rejectUnauthorized: false.

function fetchLiveClientPlayers() {
  return new Promise((resolve) => {
    const req = https.get(
      'https://127.0.0.1:2999/liveclientdata/playerlist',
      { rejectUnauthorized: false },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(raw)); }
          catch { resolve(null); }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
  });
}

// Normalise Live Client champion display name → internal ID format.
// E.g. "Miss Fortune" → "MissFortune", "Vel'Koz" → "Velkoz"
function normalizeChampionName(displayName) {
  return displayName
    .replace(/['’]/g, '')   // apostrophes: Vel'Koz → VelKoz, Cho'Gath → ChoGath
    .replace(/\./g, '')           // dots: Dr. Mundo → Dr Mundo
    .replace(/\s+/g, '')          // spaces: Miss Fortune → MissFortune
    .replace(/^Nunu$/, 'Nunu')    // keep as-is
    .trim();
}

async function scheduleLivePicksFetch() {
  const MAX_RETRIES = 15;
  const INTERVAL_MS = 3000; // 3s between retries → up to 45s total

  for (let i = 0; i < MAX_RETRIES; i++) {
    await new Promise(r => setTimeout(r, i === 0 ? 5000 : INTERVAL_MS)); // first retry after 5s

    const players = await fetchLiveClientPlayers();
    if (!Array.isArray(players) || players.length === 0) {
      console.log(`   ⏳ 라이브 픽 대기 중... (${i + 1}/${MAX_RETRIES})`);
      continue;
    }

    const team1 = [];
    const team2 = [];

    for (const p of players) {
      const alias = findAlias(p.summonerName) ?? findAlias(p.riotId) ?? null;
      const entry = {
        summonerName: p.summonerName,
        riotId: p.riotId ?? p.summonerName,
        alias,
        championName: p.championName,
        championId: normalizeChampionName(p.championName),
        team: p.team, // 'ORDER' (blue/T1) or 'CHAOS' (red/T2)
      };
      if (p.team === 'ORDER') team1.push(entry);
      else team2.push(entry);
    }

    broadcast({ type: 'liveGamePlayers', team1, team2 });
    const t1Str = team1.map(p => `${p.alias ?? p.summonerName}=${p.championId}`).join(', ');
    const t2Str = team2.map(p => `${p.alias ?? p.summonerName}=${p.championId}`).join(', ');
    console.log(`🎮 라이브 픽 확인!`);
    console.log(`   T1(Order): ${t1Str}`);
    console.log(`   T2(Chaos): ${t2Str}`);
    return;
  }

  console.log('⚠️ 라이브 픽 정보를 시간 내에 가져오지 못했습니다.');
}

process.on('SIGINT', () => {
  stopTimerPolling();
  console.log('\n👋 브릿지 종료');
  wss.close();
  process.exit(0);
});

connectToLCU();
