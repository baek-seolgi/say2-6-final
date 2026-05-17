// say-6 — WebSocket 클라이언트 (재접속 + ping 유지)
//
// backend ws.py 의 /ws/encounter/{id} 와 1:1 매핑.
// dev: Vite proxy로 localhost:3000/ws → localhost:8000/ws.
// prod: 같은 origin이므로 그대로 /ws/encounter/{id} 호출 (ALB가 WS upgrade 처리).

export type WsEvent = {
  event: string; // 'initial_proposals' | 'modal_completed' | 'ready_for_report' | ...
  [key: string]: unknown;
};

export interface WsHandle {
  /** 명시적 종료 — 재접속 시도하지 않음 */
  close(): void;
}

/**
 * encounter 단위로 WebSocket 구독.
 * @param encounterId  대상 encounter
 * @param onEvent      서버 푸시 메시지 도착 시 콜백
 * @param onStatus     'open' | 'close' | 'error' 상태 변화 콜백 (옵션)
 */
export function subscribeEncounter(
  encounterId: string,
  onEvent: (msg: WsEvent) => void,
  onStatus?: (s: "open" | "close" | "error") => void,
): WsHandle {
  let ws: WebSocket | null = null;
  let pingTimer: number | null = null;
  let reconnectTimer: number | null = null;
  let closedByUser = false;
  let backoff = 1000; // 1s → 최대 30s 백오프

  function connect() {
    if (closedByUser) return;
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/ws/encounter/${encodeURIComponent(encounterId)}`;
    ws = new WebSocket(url);

    ws.onopen = () => {
      backoff = 1000;
      onStatus?.("open");
      // 30s 마다 ping(아무 텍스트) — backend는 receive_text() 대기 중
      pingTimer = window.setInterval(() => {
        try { ws?.send("ping"); } catch { /* noop */ }
      }, 30_000);
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as WsEvent;
        onEvent(msg);
      } catch (e) {
        console.warn("[ws] parse failed:", ev.data, e);
      }
    };

    ws.onerror = () => {
      onStatus?.("error");
    };

    ws.onclose = () => {
      if (pingTimer) { window.clearInterval(pingTimer); pingTimer = null; }
      onStatus?.("close");
      if (closedByUser) return;
      // 지수 백오프 재접속 (최대 30s)
      reconnectTimer = window.setTimeout(() => {
        backoff = Math.min(backoff * 2, 30_000);
        connect();
      }, backoff);
    };
  }

  connect();

  return {
    close() {
      closedByUser = true;
      if (pingTimer) window.clearInterval(pingTimer);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      try { ws?.close(); } catch { /* noop */ }
      ws = null;
    },
  };
}
