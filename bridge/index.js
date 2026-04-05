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

// --- LCU Write: hover/lock-in champion for current user ---
let mySummonerId = null;

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
          if (blueCellIds.has(action.actorCellId)) team1Bans.push(action.championId);
          else if (redCellIds.has(action.actorCellId)) team2Bans.push(action.championId);
          else {
            // Fallback: use cellId < 5 heuristic
            if (action.actorCellId < 5) team1Bans.push(action.championId);
            else team2Bans.push(action.championId);
          }
        }
      }
    }
    if (team1Bans.length > 0 || team2Bans.length > 0) {
      console.log(`   🚫 밴 감지 | T1(Blue): [${team1Bans}] T2(Red): [${team2Bans}]`);
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

  // Parse Team 1 (Blue) picks
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

  // Parse Team 2 (Red) picks
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
  const timeLeft = Math.ceil((timer.adjustedTimeLeftInPhase ?? 0) / 1000);
  const totalTime = Math.ceil((timer.totalTimeInPhase ?? 0) / 1000);

  return { phase, timeLeft, totalTime, team1Bans, team2Bans, team1Picks, team2Picks };
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

function startTimerPolling() {
  stopTimerPolling();
  timerInterval = setInterval(async () => {
    if (!credentials) return;
    try {
      const resp = await createHttp1Request({ method: 'GET', url: '/lol-champ-select/v1/session' }, credentials);
      if (resp.status === 200) {
        const data = resp.json();
        const timer = data.timer || {};
        const phase = timer.phase || 'UNKNOWN';
        const timeLeft = Math.ceil((timer.adjustedTimeLeftInPhase ?? 0) / 1000);
        const totalTime = Math.ceil((timer.totalTimeInPhase ?? 0) / 1000);
        broadcast({ type: 'timerUpdate', phase, timeLeft, totalTime });
      }
    } catch {}
  }, 1000);
}

function stopTimerPolling() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

process.on('SIGINT', () => {
  stopTimerPolling();
  console.log('\n👋 브릿지 종료');
  wss.close();
  process.exit(0);
});

connectToLCU();
