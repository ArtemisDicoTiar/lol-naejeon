import { useState, useEffect, useRef, useCallback } from 'react';

const BRIDGE_URL = 'ws://localhost:8234';

export interface LcuChampSelectState {
  phase: string;
  team1Bans: number[];
  team2Bans: number[];
  team1Picks: { cellId: number; champId: number; summonerId: number }[];
  team2Picks: { cellId: number; champId: number; summonerId: number }[];
}

export function useLcuBridge() {
  const [connected, setConnected] = useState(false);
  const [lastState, setLastState] = useState<LcuChampSelectState | null>(null);
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
    setChampSelectActive(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
      if (reconnectRef.current) clearInterval(reconnectRef.current);
    };
  }, []);

  return { connected, connect, disconnect, lastState, champSelectActive };
}
