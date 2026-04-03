#!/usr/bin/env node

import { authenticate, createWebSocketConnection, createHttp1Request } from 'league-connect';
import { WebSocketServer } from 'ws';

const WS_PORT = 8234;

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

// --- LCU Connection ---
async function connectToLCU() {
  console.log('🔍 LoL 클라이언트 탐색 중...');

  let credentials;
  try {
    credentials = await authenticate({ awaitConnection: true, pollInterval: 3000 });
    console.log(`✅ LoL 클라이언트 발견! (포트: ${credentials.port})`);
  } catch (e) {
    console.error('❌ LoL 클라이언트를 찾을 수 없습니다. 클라이언트를 실행해주세요.');
    process.exit(1);
  }

  // Subscribe to champion select events via WebSocket
  const ws = await createWebSocketConnection(credentials);
  console.log('✅ LCU WebSocket 연결 완료');
  console.log('⏳ 챔피언 셀렉트 대기 중...\n');

  let lastState = null;

  ws.on('message', (messageBuffer) => {
    const message = messageBuffer.toString();
    if (!message.startsWith('[')) return;

    try {
      const [opcode, , payload] = JSON.parse(message);
      if (opcode !== 8) return;

      const { uri, data, eventType } = payload;

      // Champion select session update
      if (uri === '/lol-champ-select/v1/session') {
        if (eventType === 'Delete') {
          console.log('⚡ 챔피언 셀렉트 종료');
          broadcast({ type: 'champSelectEnd' });
          lastState = null;
          return;
        }

        const state = parseChampSelectState(data);
        if (stateChanged(lastState, state)) {
          lastState = state;
          console.log(`⚡ 밴/픽 업데이트: T1 밴[${state.team1Bans.join(',')}] T2 밴[${state.team2Bans.join(',')}] T1 픽[${state.team1Picks.map(p=>p.champId).join(',')}] T2 픽[${state.team2Picks.map(p=>p.champId).join(',')}]`);
          broadcast({ type: 'champSelectUpdate', ...state });
        }
      }
    } catch {}
  });

  // Subscribe to all champ-select events
  ws.send(JSON.stringify([5, 'OnJsonApiEvent_lol-champ-select_v1_session']));

  // Also poll initially in case already in champ select
  try {
    const resp = await createHttp1Request({ method: 'GET', url: '/lol-champ-select/v1/session' }, credentials);
    if (resp.status === 200) {
      const state = parseChampSelectState(resp.json());
      lastState = state;
      console.log('⚡ 이미 챔피언 셀렉트 중!');
      broadcast({ type: 'champSelectUpdate', ...state });
    }
  } catch {}
}

function parseChampSelectState(data) {
  const team1Bans = [];
  const team2Bans = [];
  const team1Picks = [];
  const team2Picks = [];

  // Parse bans from actions
  if (data.actions) {
    for (const actionGroup of data.actions) {
      for (const action of actionGroup) {
        if (action.type === 'ban' && action.completed && action.championId > 0) {
          // Determine which team based on actor cell
          const isTeam1 = (data.myTeam || []).some(p => p.cellId === action.actorCellId);
          if (isTeam1) {
            team1Bans.push(action.championId);
          } else {
            team2Bans.push(action.championId);
          }
        }
      }
    }
  }

  // Parse picks from myTeam and theirTeam
  for (const member of (data.myTeam || [])) {
    if (member.championId > 0) {
      team1Picks.push({
        cellId: member.cellId,
        champId: member.championId,
        summonerId: member.summonerId,
        assignedPosition: member.assignedPosition || '',
      });
    }
  }

  for (const member of (data.theirTeam || [])) {
    if (member.championId > 0) {
      team2Picks.push({
        cellId: member.cellId,
        champId: member.championId,
        summonerId: member.summonerId,
        assignedPosition: member.assignedPosition || '',
      });
    }
  }

  // Parse phase
  const timer = data.timer || {};
  const phase = timer.phase || 'UNKNOWN';

  return { phase, team1Bans, team2Bans, team1Picks, team2Picks };
}

function stateChanged(prev, next) {
  if (!prev) return true;
  return JSON.stringify(prev) !== JSON.stringify(next);
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 브릿지 종료');
  wss.close();
  process.exit(0);
});

connectToLCU();
