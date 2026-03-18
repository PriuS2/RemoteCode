# WebSocket Protocol

Remote Code uses one WebSocket endpoint for terminal traffic:

```text
ws://host/ws/terminal/{session_id}
```

If the page is served over HTTPS, the browser should use `wss://`.

## Authentication

The browser app relies on the same `remote_code_session` `HttpOnly` cookie used by the REST API.

- Preferred path: cookie-based auth
- Compatibility fallback: `?token=<jwt>` query parameter

Current frontend URL construction:

```ts
const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
return `${proto}//${window.location.host}/ws/terminal/${sessionId}`;
```

## Connection flow

1. Client opens `/ws/terminal/{session_id}`
2. Backend validates the cookie or fallback token
3. Backend finds the PTY instance for the session
4. If another client is connected to the same session, that client is evicted
5. PTY output and client input are relayed bidirectionally

The PTY stays alive when the WebSocket disconnects, so reconnecting to the same session is supported.

## Message format

All messages are JSON text frames.

### Client to server

Input:

```json
{
  "type": "input",
  "data": "ls -la\r"
}
```

Resize:

```json
{
  "type": "resize",
  "data": {
    "cols": 80,
    "rows": 24
  }
}
```

Constraints:

- `cols`: 1 to 500
- `rows`: 1 to 200

Mouse:

```json
{
  "type": "mouse",
  "data": {
    "event": "press",
    "button": 0,
    "x": 10,
    "y": 4,
    "modifiers": {
      "shift": false,
      "ctrl": false,
      "alt": false
    }
  }
}
```

Supported mouse events:

- `press`
- `release`
- `move`
- `drag`
- `scroll`

Supported button codes:

- `0` left click
- `1` middle click
- `2` right click
- `64` scroll up
- `65` scroll down

### Server to client

Output:

```json
{
  "type": "output",
  "data": "terminal output"
}
```

Status:

```json
{
  "type": "status",
  "data": "closed"
}
```

Status values used by the backend:

- `closed`
- `taken_over`
- `not_found`

## Close codes

The backend uses these WebSocket close codes:

- `4401` unauthorized
- `4404` session not found
- `4409` session taken over by another client

## Takeover behavior

Only one active WebSocket is allowed per session.

When a second client connects to the same session:

1. The previous connection receives `{"type":"status","data":"taken_over"}`
2. The previous socket is closed with code `4409`
3. The new connection becomes the active owner

This lets users move a live session between tabs or devices without restarting the PTY.

## Reconnection notes

The frontend reconnect hook:

- avoids reconnecting while the socket is already `OPEN` or `CONNECTING`
- clears any pending reconnect timer before reconnecting
- backs off from 1 second up to 30 seconds
- stops reconnecting on permanent states such as `auth_failed`, `not_found`, and `taken_over`

## Error handling

- Missing or expired auth closes the socket with `4401`
- Missing PTY/session closes the socket with `4404`
- PTY exit sends `{"type":"status","data":"closed"}`

## Practical notes

- Reverse proxies must support WebSocket upgrades for `/ws`
- Because auth is cookie-based in normal browser use, same-origin deployment is the simplest path
- If you document or script direct clients, note that `?token=` is fallback behavior, not the primary browser flow
