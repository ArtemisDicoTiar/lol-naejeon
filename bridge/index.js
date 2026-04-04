#!/usr/bin/env node

import { authenticate, createWebSocketConnection, createHttp1Request } from 'league-connect';
import { WebSocketServer } from 'ws';

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
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const client of clients) {
    try { client.send(msg); } catch {}
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
      const allMembers = [...(lobby.members || []), ...team100, ...team200];

      for (const m of allMembers) {
        if (m.summonerId && !summonerCache.has(m.summonerId)) {
          const name = m.summonerName || m.gameName || '';
          if (name) {
            const alias = findAlias(name);
            summonerCache.set(m.summonerId, { gameName: name, alias });
            console.log(`   👤 (로비) ${name} → ${alias ?? '(매핑 없음)'}`);
          }
        }
      }

      // Broadcast lobby teams
      if (team100.length > 0 || team200.length > 0) {
        const lobbyTeam1 = team100.map(m => {
          const name = m.summonerName || m.gameName || '';
          return { summonerId: m.summonerId, gameName: name, alias: findAlias(name) };
        });
        const lobbyTeam2 = team200.map(m => {
          const name = m.summonerName || m.gameName || '';
          return { summonerId: m.summonerId, gameName: name, alias: findAlias(name) };
        });
        console.log(`🏠 로비 | T1: [${lobbyTeam1.map(m => m.alias ?? m.gameName).join(', ')}] T2: [${lobbyTeam2.map(m => m.alias ?? m.gameName).join(', ')}]`);
        broadcast({ type: 'lobbyUpdate', team1: lobbyTeam1, team2: lobbyTeam2 });
      }
    }
  } catch {}
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
          return;
        }

        // Cache lobby members on first champ select event
        if (!lastState) {
          await cacheLobbyMembers();
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

        for (const m of allMembers) {
          if (m.summonerId && !summonerCache.has(m.summonerId)) {
            const name = m.summonerName || m.gameName || '';
            if (name) {
              const alias = findAlias(name);
              summonerCache.set(m.summonerId, { gameName: name, alias });
              console.log(`   👤 (로비) ${name} → ${alias ?? '(매핑 없음)'}`);
            }
          }
        }

        // Broadcast lobby teams to web app
        if (team100.length > 0 || team200.length > 0) {
          const lobbyTeam1 = team100.map(m => {
            const name = m.summonerName || m.gameName || '';
            return { summonerId: m.summonerId, gameName: name, alias: findAlias(name) };
          });
          const lobbyTeam2 = team200.map(m => {
            const name = m.summonerName || m.gameName || '';
            return { summonerId: m.summonerId, gameName: name, alias: findAlias(name) };
          });
          console.log(`🏠 로비 | T1: [${lobbyTeam1.map(m => m.alias ?? m.gameName).join(', ')}] T2: [${lobbyTeam2.map(m => m.alias ?? m.gameName).join(', ')}]`);
          broadcast({ type: 'lobbyUpdate', team1: lobbyTeam1, team2: lobbyTeam2 });
        }
      }
    } catch {}
  });

  ws.send(JSON.stringify([5, 'OnJsonApiEvent_lol-champ-select_v1_session']));
  ws.send(JSON.stringify([5, 'OnJsonApiEvent_lol-lobby_v2_lobby']));

  // Pre-cache lobby members if already in a lobby
  await cacheLobbyMembers();

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
  // Determine blue/red by cellId: blue = 0~4, red = 5~9
  // Combine all members from both arrays, then split by cellId
  const allMembers = [
    ...(data.myTeam || []).map(m => ({ ...m, _src: 'my' })),
    ...(data.theirTeam || []).map(m => ({ ...m, _src: 'their' })),
  ];

  const blueMembers = allMembers.filter(m => m.cellId < 5);
  const redMembers = allMembers.filter(m => m.cellId >= 5);

  // Blue = Team 1 (first pick), Red = Team 2
  const blueCellIds = new Set(blueMembers.map(m => m.cellId));

  const team1Bans = [];
  const team2Bans = [];
  const team1Picks = [];
  const team2Picks = [];

  // Parse bans — assign to blue/red based on actorCellId
  if (data.actions) {
    for (const actionGroup of data.actions) {
      for (const action of actionGroup) {
        if (action.type === 'ban' && action.completed && action.championId > 0) {
          if (blueCellIds.has(action.actorCellId)) team1Bans.push(action.championId);
          else team2Bans.push(action.championId);
        }
      }
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

  // Parse blue team (Team 1) picks
  for (const member of blueMembers) {
    const summoner = await resolveSummoner(member.summonerId);
    // After trades complete, member.championId reflects the swapped state
    // Before trades, use action champion (includes hover)
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

  // Parse red team (Team 2) picks
  for (const member of redMembers) {
    const summoner = await resolveSummoner(member.summonerId);
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

  return { phase, team1Bans, team2Bans, team1Picks, team2Picks };
}

function stateChanged(prev, next) {
  if (!prev) return true;
  return JSON.stringify(prev) !== JSON.stringify(next);
}

process.on('SIGINT', () => {
  console.log('\n👋 브릿지 종료');
  wss.close();
  process.exit(0);
});

connectToLCU();
