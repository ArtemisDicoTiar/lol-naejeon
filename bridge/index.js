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

  try {
    const resp = await createHttp1Request({
      method: 'GET',
      url: `/lol-summoner/v2/summoners?ids=[${summonerId}]`,
    }, credentials);

    if (resp.status === 200) {
      const summoners = resp.json();
      if (summoners.length > 0) {
        const name = summoners[0].gameName || summoners[0].displayName || '';
        const alias = findAlias(name);
        const result = { gameName: name, alias };
        summonerCache.set(summonerId, result);
        console.log(`   👤 ${name} → ${alias ?? '(매핑 없음)'}`);
        return result;
      }
    }
  } catch {}

  return null;
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

        const state = await parseChampSelectState(data);
        if (stateChanged(lastState, state)) {
          lastState = state;
          const t1Info = state.team1Picks.map(p => `${p.alias ?? '?'}=${p.champId}`).join(', ');
          const t2Info = state.team2Picks.map(p => `${p.alias ?? '?'}=${p.champId}`).join(', ');
          console.log(`⚡ 업데이트 | T1 밴[${state.team1Bans}] 픽[${t1Info}] | T2 밴[${state.team2Bans}] 픽[${t2Info}]`);
          broadcast({ type: 'champSelectUpdate', ...state });
        }
      }
    } catch {}
  });

  ws.send(JSON.stringify([5, 'OnJsonApiEvent_lol-champ-select_v1_session']));

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
  const team1Bans = [];
  const team2Bans = [];
  const team1Picks = [];
  const team2Picks = [];

  // Parse bans
  if (data.actions) {
    for (const actionGroup of data.actions) {
      for (const action of actionGroup) {
        if (action.type === 'ban' && action.completed && action.championId > 0) {
          const isTeam1 = (data.myTeam || []).some(p => p.cellId === action.actorCellId);
          if (isTeam1) team1Bans.push(action.championId);
          else team2Bans.push(action.championId);
        }
      }
    }
  }

  // Parse picks with summoner name resolution
  for (const member of (data.myTeam || [])) {
    const summoner = await resolveSummoner(member.summonerId);
    team1Picks.push({
      cellId: member.cellId,
      champId: member.championId || 0,
      summonerId: member.summonerId,
      gameName: summoner?.gameName ?? '',
      alias: summoner?.alias ?? null,
    });
  }

  for (const member of (data.theirTeam || [])) {
    const summoner = await resolveSummoner(member.summonerId);
    team2Picks.push({
      cellId: member.cellId,
      champId: member.championId || 0,
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
