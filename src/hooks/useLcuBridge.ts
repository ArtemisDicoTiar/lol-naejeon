import { useState, useEffect, useRef, useCallback } from 'react';
import { persistEogCapture } from '@/lib/eog';
import type { GameEogCapture, GameParticipantStat } from '@/lib/db';

const BRIDGE_URL = 'ws://localhost:8234';

export interface LcuChampSelectState {
  phase: string;
  mode?: 'aram' | 'augmented';
  timeLeft: number;  // seconds remaining in current phase
  totalTime: number; // total seconds for current phase
  team1Bans: { championId: number; completed: boolean }[];
  team2Bans: { championId: number; completed: boolean }[];
  team1Picks: { cellId: number; champId: number; locked?: boolean; summonerId: number; gameName?: string; alias?: string | null }[];
  team2Picks: { cellId: number; champId: number; locked?: boolean; summonerId: number; gameName?: string; alias?: string | null }[];
  benchChampions: number[];  // numeric champion IDs in the ARAM reroll pool
}

// Player info from Live Client Data API (available after game starts — includes
// both teams, making opponent picks visible for the first time).
export interface LcuLivePlayer {
  summonerName: string;
  riotId: string;
  alias: string | null;    // matched from SUMMONER_ALIAS in bridge
  championName: string;   // display name, e.g. "Miss Fortune"
  championId: string;     // normalised ID, e.g. "MissFortune"
  team: 'ORDER' | 'CHAOS';  // ORDER=blue/T1, CHAOS=red/T2
}

export interface LcuLobbyState {
  team1: { summonerId: number; gameName: string; alias: string | null }[];
  team2: { summonerId: number; gameName: string; alias: string | null }[];
}

export interface LcuEogState {
  status: 'idle' | 'capturing' | 'captured' | 'failed';
  capture: GameEogCapture | null;
  participantStats: GameParticipantStat[];
  linkedGameId: number | null;
  error: string | null;
}

export interface LcuRetroGameParticipant {
  participantId: number;
  teamId: number;
  championId: number;
  summonerName: string;
  alias: string | null;
  riotId: string | null;
  stats: Record<string, unknown>;
}

export interface LcuRetroGame {
  gameId: number;
  gameCreation: number;
  gameDuration: number;
  queueId: number | null;
  mapId: number | null;
  gameMode: string | null;
  gameType: string | null;
  mode?: 'aram' | 'augmented';
  winnerTeamId: number | null;
  participants: LcuRetroGameParticipant[];
  raw: Record<string, unknown>;
}

export function useLcuBridge() {
  const [connected, setConnected] = useState(false);
  const [lastState, setLastState] = useState<LcuChampSelectState | null>(null);
  const [lobbyState, setLobbyState] = useState<LcuLobbyState | null>(null);
  const [champSelectActive, setChampSelectActive] = useState(false);
  const [gameStartedAt, setGameStartedAt] = useState<number | null>(null);
  const [gameEndedAt, setGameEndedAt] = useState<number | null>(null);
  const [liveGamePlayers, setLiveGamePlayers] = useState<{ team1: LcuLivePlayer[]; team2: LcuLivePlayer[] } | null>(null);
  const [eog, setEog] = useState<LcuEogState>({ status: 'idle', capture: null, participantStats: [], linkedGameId: null, error: null });
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<number | null>(null);
  const pendingRequestRef = useRef(new Map<string, { resolve: (value: LcuRetroGame[]) => void; reject: (reason?: unknown) => void }>());

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(BRIDGE_URL);

      ws.onopen = () => {
        setConnected(true);
        if (reconnectRef.current) {
          clearInterval(reconnectRef.current);
          reconnectRef.current = null;
        }
      };

      ws.onmessage = (event) => {
        void (async () => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'champSelectUpdate') {
            setLastState(data);
            setChampSelectActive(true);
          } else if (data.type === 'champSelectEnd') {
            setChampSelectActive(false);
          } else if (data.type === 'lobbyUpdate') {
            setLobbyState({ team1: data.team1, team2: data.team2 });
          } else if (data.type === 'timerUpdate') {
            setChampSelectActive(true);
            setLastState(prev => {
              if (prev) return { ...prev, phase: data.phase, timeLeft: data.timeLeft, totalTime: data.totalTime };
              return { phase: data.phase, timeLeft: data.timeLeft, totalTime: data.totalTime, team1Bans: [], team2Bans: [], team1Picks: [], team2Picks: [], benchChampions: [] };
            });
          } else if (data.type === 'gameStart') {
            setGameStartedAt(Date.now());
            setChampSelectActive(false);
            setLiveGamePlayers(null); // reset; bridge will send fresh data
            setEog({ status: 'idle', capture: null, participantStats: [], linkedGameId: null, error: null });
          } else if (data.type === 'gameEnd') {
            setGameEndedAt(Date.now());
          } else if (data.type === 'liveGamePlayers') {
            setLiveGamePlayers({ team1: data.team1, team2: data.team2 });
          } else if (data.type === 'eogCaptureStarted') {
            setEog((prev) => ({ ...prev, status: 'capturing', error: null }));
          } else if (data.type === 'eogCaptureSucceeded') {
            const persisted = await persistEogCapture(data.raw, {
              capturedAt: data.capturedAt,
              fingerprint: data.fingerprint,
              trigger: data.trigger,
            });
            setEog({
              status: 'captured',
              capture: persisted.capture,
              participantStats: persisted.participantStats,
              linkedGameId: persisted.linkedGame?.id ?? persisted.capture.gameId ?? null,
              error: null,
            });
            window.dispatchEvent(new CustomEvent('lol-data-changed', {
              detail: {
                source: 'eog',
                gameId: persisted.linkedGame?.id ?? persisted.capture.gameId ?? null,
                captureId: persisted.capture.id ?? null,
              },
            }));
          } else if (data.type === 'eogCaptureFailed') {
            setEog((prev) => ({
              ...prev,
              status: 'failed',
              error: data.error ?? 'EOG 캡처 실패',
            }));
          } else if (data.type === 'recentCustomGamesResult' && data.requestId) {
            const pending = pendingRequestRef.current.get(data.requestId);
            if (pending) {
              pendingRequestRef.current.delete(data.requestId);
              if (data.ok) pending.resolve((data.items ?? []) as LcuRetroGame[]);
              else pending.reject(new Error(data.error ?? '최근 커스텀 경기 조회 실패'));
            }
          }
        } catch {
          // Ignore malformed bridge payloads and keep the socket alive.
        }
        })();
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
      };

      ws.onerror = () => {
        ws.close();
      };

      wsRef.current = ws;
    } catch {
      setConnected(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    if (reconnectRef.current) {
      clearInterval(reconnectRef.current);
      reconnectRef.current = null;
    }
    wsRef.current?.close();
    wsRef.current = null;
    setConnected(false);
    setLastState(null);
    setLobbyState(null);
    setChampSelectActive(false);
    setGameStartedAt(null);
    setGameEndedAt(null);
    setLiveGamePlayers(null);
    setEog({ status: 'idle', capture: null, participantStats: [], linkedGameId: null, error: null });
  }, []);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
      if (reconnectRef.current) clearInterval(reconnectRef.current);
    };
  }, []);

  const sendToClient = useCallback((msg: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const hoverChampion = useCallback((championNumericId: number) => {
    sendToClient({ type: 'hoverChampion', championNumericId });
  }, [sendToClient]);

  const lockInChampion = useCallback((championNumericId: number) => {
    sendToClient({ type: 'lockInChampion', championNumericId });
  }, [sendToClient]);

  const hoverBan = useCallback((championNumericId: number) => {
    sendToClient({ type: 'hoverBan', championNumericId });
  }, [sendToClient]);

  const lockInBan = useCallback((championNumericId: number) => {
    sendToClient({ type: 'lockInBan', championNumericId });
  }, [sendToClient]);

  const fetchRecentCustomGames = useCallback((limit = 20): Promise<LcuRetroGame[]> => {
    return new Promise((resolve, reject) => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        reject(new Error('클라이언트 브릿지가 연결되어 있지 않습니다.'));
        return;
      }
      const requestId = `retro-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      pendingRequestRef.current.set(requestId, { resolve, reject });
      wsRef.current.send(JSON.stringify({ type: 'fetchRecentCustomGames', requestId, limit }));
      window.setTimeout(() => {
        const pending = pendingRequestRef.current.get(requestId);
        if (pending) {
          pendingRequestRef.current.delete(requestId);
          pending.reject(new Error('최근 커스텀 경기 조회가 시간 내에 완료되지 않았습니다.'));
        }
      }, 20_000);
    });
  }, []);

  return { connected, connect, disconnect, lastState, lobbyState, champSelectActive, gameStartedAt, gameEndedAt, liveGamePlayers, eog, hoverChampion, lockInChampion, hoverBan, lockInBan, fetchRecentCustomGames };
}
