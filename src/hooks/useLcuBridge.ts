import { useState, useEffect, useRef, useCallback } from 'react';

const BRIDGE_URL = 'ws://localhost:8234';

export interface LcuChampSelectState {
  phase: string;
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

export function useLcuBridge() {
  const [connected, setConnected] = useState(false);
  const [lastState, setLastState] = useState<LcuChampSelectState | null>(null);
  const [lobbyState, setLobbyState] = useState<LcuLobbyState | null>(null);
  const [champSelectActive, setChampSelectActive] = useState(false);
  const [gameStartedAt, setGameStartedAt] = useState<number | null>(null);
  const [gameEndedAt, setGameEndedAt] = useState<number | null>(null);
  const [liveGamePlayers, setLiveGamePlayers] = useState<{ team1: LcuLivePlayer[]; team2: LcuLivePlayer[] } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<number | null>(null);

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
          } else if (data.type === 'gameEnd') {
            setGameEndedAt(Date.now());
          } else if (data.type === 'liveGamePlayers') {
            setLiveGamePlayers({ team1: data.team1, team2: data.team2 });
          }
        } catch {}
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

  return { connected, connect, disconnect, lastState, lobbyState, champSelectActive, gameStartedAt, gameEndedAt, liveGamePlayers, hoverChampion, lockInChampion, hoverBan, lockInBan };
}
