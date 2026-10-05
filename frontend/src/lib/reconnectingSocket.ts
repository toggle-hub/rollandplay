// Reconnect delays grow from 1 s to 30 s while a socket keeps failing.
const reconnectBaseMs = 1000;
const reconnectMaxMs = 30_000;

export type SocketLifecycle = {
  /** Runs on every (re)connect, so the caller can reload whatever it missed while disconnected. */
  onOpen?: (socket: WebSocket) => void;
  /** Runs whenever the socket closes or a connection attempt fails; another attempt follows. */
  onClose?: () => void;
};

/**
 * Keeps a websocket open: when it closes, `open` is called again after a delay that doubles from
 * `reconnectBaseMs` up to `reconnectMaxMs` while attempts keep failing, and starts over after a
 * successful connection. Returns a function that closes the socket for good.
 */
export function keepSocketOpen(open: () => WebSocket, { onOpen, onClose }: SocketLifecycle = {}): () => void {
  let stopped = false;
  let socket: WebSocket | null = null;
  let retry: number | undefined;
  let failures = 0;
  const connect = () => {
    const current = open();
    socket = current;
    current.onopen = () => {
      failures = 0;
      onOpen?.(current);
    };
    current.onclose = () => {
      if (stopped) return;
      onClose?.();
      retry = window.setTimeout(connect, Math.min(reconnectMaxMs, reconnectBaseMs * 2 ** failures++));
    };
  };
  connect();
  return () => {
    if (stopped) return;
    stopped = true;
    window.clearTimeout(retry);
    if (!socket) return;
    socket.onopen = null;
    socket.onclose = null;
    socket.onmessage = null;
    socket.close();
  };
}
