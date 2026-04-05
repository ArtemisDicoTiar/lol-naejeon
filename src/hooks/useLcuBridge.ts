import { useState, useEffect, useRef, useCallback } from 'react';

const BRIDGE_URL = 'ws://localhost:8234';

export interface LcuChampSelectState {
  phase: string;
  timeLeft: number;  // seconds remaining in current phase
  totalTime: number; // total seconds for current phase
  team1Bans: number[];
  team2Bans: number[];
  team1Picks: { cellId: number; champId: number; locked?: boolean; summonerId: number; gameName?: string; alias?: string | null }[];
  team2Picks: { cellId: number; champId: number; locked?: boolean; summonerId: number; gameName?: string; alias?: string | null }[];
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
            // Update timer in lastState without full state replacement
            setLastState(prev => prev ? { ...prev, phase: data.phase, timeLeft: data.timeLeft, totalTime: data.totalTime } : prev);
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

  return { connected, connect, disconnect, lastState, lobbyState, champSelectActive, hoverChampion, lockInChampion, hoverBan, lockInBan };
}
