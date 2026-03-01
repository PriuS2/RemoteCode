# WebSocket Protocol

## Connection

### URL Format

```
/ws/{session_id}?token={jwt_token}
```

### Connection Flow

1. Client connects to WebSocket endpoint
2. Server validates JWT token from query parameter
3. Server looks up PTY instance for session_id
4. If PTY not found → send `{"type": "status", "data": "not_found"}` and close
5. If existing connection exists → evict previous connection with `{"type": "status", "data": "taken_over"}`
6. Accept connection and start bidirectional relay

## Message Format

All messages are JSON-encoded strings.

### Client → Server

#### Input Message
Send keyboard input to the terminal.

```json
{
  "type": "input",
  "data": "string to send to PTY"
}
```

**Example:**
```json
{ "type": "input", "data": "ls -la\r" }
```

#### Resize Message
Notify terminal size change.

```json
{
  "type": "resize",
  "data": {
    "cols": 80,
    "rows": 24
  }
}
```

**Constraints:**
- `cols`: 1-500
- `rows`: 1-200

### Server → Client

#### Output Message
PTY output from the terminal.

```json
{
  "type": "output",
  "data": "terminal output string"
}
```

**Note:** Output may include ANSI escape sequences.

#### Status Messages

Session state changes.

```json
{
  "type": "status",
  "data": "closed"
}
```

Status values:
- `closed`: PTY process has exited
- `taken_over`: Another client has connected to this session
- `not_found`: Session does not exist (sent before closing)

## Session Takeover

Only one WebSocket connection is allowed per session. When a new client connects:

1. Previous connection receives: `{"type": "status", "data": "taken_over"}`
2. Previous WebSocket is closed with code 4001
3. New connection is established
4. PTY process continues running

This enables session switching between devices while maintaining the PTY state.

## Reconnection

### Client Auto-Reconnect

The frontend (`useWebSocket` hook) automatically reconnects:
- Reconnect delay: 3 seconds
- Max retries: unlimited
- Visual indicator shows "Connecting..." / "Disconnected"

### Reconnection Behavior

1. Client reconnects with same session_id
2. Server accepts new connection
3. Existing PTY is attached
4. Previous connection (if any) is evicted

## Connection Lifecycle

```
┌─────────────┐                    ┌─────────────┐
│   Client    │                    │    Server   │
└──────┬──────┘                    └──────┬──────┘
       │                                  │
       │  WS /ws/{id}?token=xxx           │
       │ ───────────────────────────────> │
       │                                  │
       │  Validate token                  │
       │  Check PTY exists                │
       │  Evict previous if exists        │
       │                                  │
       │  Connection established          │
       │ <─────────────────────────────── │
       │                                  │
       │  Bidirectional data flow         │
       │ <──────────────────────────────> │
       │                                  │
       │  Client disconnects              │
       │ ───────────────────────────────> │
       │                                  │
       │  PTY kept alive!                 │
       │                                  │
       │  (Reconnection possible)         │
       │                                  │
```

## Error Handling

### Connection Errors
- **401 Unauthorized**: Invalid or missing token (connection rejected)
- **404 Not Found**: Session does not exist

### Runtime Errors
- PTY process death → `{"type": "status", "data": "closed"}`
- Network interruption → Client auto-reconnects

## Implementation Details

### Backend (`websocket.py`)

```python
async def handle_terminal_ws(ws: WebSocket, session_id: str) -> None:
    # 1. Accept connection
    # 2. Check PTY exists
    # 3. Evict previous connection
    # 4. Start pty_to_ws and ws_to_pty tasks
    # 5. Wait for either task to complete
    # 6. Cleanup (keep PTY alive)
```

### Frontend (`hooks/useWebSocket.ts`)

```typescript
function useWebSocket({ url, onMessage, autoReconnect }): {
  sendInput: (data: string) => void;
  sendResize: (cols: number, rows: number) => void;
  status: "connecting" | "connected" | "disconnected";
}
```

## Security Considerations

1. **Token in URL**: JWT is passed as query parameter (necessary for WebSocket browser API)
   - Use HTTPS/WSS in production
   - Short-lived tokens recommended

2. **Rate Limiting**: WebSocket connections are subject to the same rate limits as HTTP

3. **Path Validation**: session_id is validated before PTY lookup

4. **Origin Check**: CORS is enforced on the WebSocket handshake

## Debug Tips

### Enable WebSocket Logging

Browser DevTools → Network → WS → Select connection → Messages

### Backend Logging

```python
# Enable debug logging
logging.getLogger("backend.websocket").setLevel(logging.DEBUG)
```

### Common Issues

1. **"not_found" status**: Session was deleted or never existed
2. **"taken_over" status**: Another tab/device connected to the same session
3. **Connection drops**: Check reverse proxy timeout settings (nginx/cloudflared)
