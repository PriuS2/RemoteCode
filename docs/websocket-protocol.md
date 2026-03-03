# WebSocket Protocol

## Connection Flow

### 1. URL Format

```
ws://host/ws/terminal/{session_id}?token={jwt_token}
```

**프론트엔드 URL 생성** (`frontend/src/hooks/useWebSocket.ts:124-126`):
```typescript
const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
return `${proto}//${window.location.host}/ws/terminal/${sessionId}?token=${token}`;
```

### 2. 연결 경로

```
[React Frontend] → [Vite Proxy] → [FastAPI Backend]
```

**Vite 프록시 설정** (`frontend/vite.config.ts:17-20`):
```typescript
"/ws": {
  target: `http://localhost:${backendPort}`,
  ws: true,  // WebSocket 업그레이드 활성화
}
```

**백엔드 엔드포인트** (`backend/main.py:656-663`):
```python
@app.websocket("/ws/terminal/{session_id}")
async def websocket_terminal(ws: WebSocket, session_id: str, token: str = Query(default="")):
    if not verify_ws_token(token):
        await ws.close(code=4001, reason="Unauthorized")
        return
    await handle_terminal_ws(ws, session_id)
```

### 3. 연결 수립 프로세스

```
1. 클라이언트 → WS 연결 요청
2. 서버 → JWT 토큰 검증
3. 서버 → PTY 인스턴스 조회
4. 서버 → 기존 연결 종료 (있는 경우)
5. 양방향 데이터 중계 시작
```

**세션 인수(Takeover) 처리** (`backend/websocket.py:74-87`):
```python
async def _close_existing_connection(session_id: str) -> None:
    """기존 연결이 있으면 종료시킨다 (마지막 요청자가 세션을 차지)."""
    prev = _active_connections.pop(session_id, None)
    if prev is None:
        return
    prev_ws, prev_tasks = prev
    for task in prev_tasks:
        task.cancel()
    await prev_ws.send_json({"type": "status", "data": "taken_over"})
    await prev_ws.close(code=4001, reason="Session taken over by another client")
```

## Message Format

모든 메시지는 JSON-encoded 문자열입니다.

### Client → Server

#### Input Message
키보드 입력을 터미널로 전송합니다.

```json
{
  "type": "input",
  "data": "string to send to PTY"
}
```

**예시:**
```json
{ "type": "input", "data": "ls -la\r" }
```

#### Resize Message
터미널 크기 변경을 알립니다.

```json
{
  "type": "resize",
  "data": {
    "cols": 80,
    "rows": 24
  }
}
```

**제약 조건:**
- `cols`: 1-500
- `rows`: 1-200

### Server → Client

#### Output Message
터미널의 PTY 출력입니다.

```json
{
  "type": "output",
  "data": "terminal output string"
}
```

**참고:** ANSI escape sequences가 포함될 수 있습니다.

#### Status Messages

세션 상태 변경입니다.

```json
{
  "type": "status",
  "data": "closed"
}
```

상태 값:
- `closed`: PTY 프로세스가 종료됨
- `taken_over`: 다른 클라이언트가 이 세션에 연결함
- `not_found`: 세션이 존재하지 않음 (연결 종료 전 전송)

## 양방향 데이터 흐름

### PTY → WebSocket (`backend/websocket.py:16-39`)

PTY 출력을 비동기로 읽어 WebSocket으로 전송합니다:

```python
async def pty_to_ws(ws: WebSocket, instance: PtyInstance) -> None:
    while True:
        data = await pty_manager.async_read(instance)
        if data is None:  # PTY dead
            pty_manager.remove(instance.session_id)
            await update_session(instance.session_id, status="closed")
            break
        if data:
            instance.append_output(data)
            await ws.send_json({"type": "output", "data": data})
    await ws.send_json({"type": "status", "data": "closed"})
```

**특징:**
- 출력 버퍼링: 최근 8KB 저장 (`pty_manager.py:131-138`)
- ThreadPoolExecutor를 통한 비동기 읽기

### WebSocket → PTY (`backend/websocket.py:41-71`)

WebSocket 입력을 PTY로 전달합니다:

```python
async def ws_to_pty(ws: WebSocket, instance: PtyInstance) -> None:
    while True:
        raw = await ws.receive_text()
        msg = json.loads(raw)
        
        if msg_type == "input":
            instance.write(msg_data)
        elif msg_type == "resize":
            instance.resize(cols, rows)
```

## Session Takeover

세션당 하나의 WebSocket 연결만 허용됩니다. 새 클라이언트가 연결하면:

1. 이전 연결에 `{"type": "status", "data": "taken_over"}` 전송
2. 이전 WebSocket은 code 4001로 종료
3. 새 연결이 수립됨
4. PTY 프로세스는 계속 실행됨

이를 통해 PTY 상태를 유지하면서 디바이스 간 세션 전환이 가능합니다.

## Reconnection

### 클라이언트 자동 재연결

프론트엔드(`useWebSocket` hook)는 자동으로 재연결합니다:

```typescript
const MAX_RECONNECT_DELAY = 30000;
const BASE_RECONNECT_DELAY = 1000;

// 지수 백오프 재연결
const delay = Math.min(
  BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttemptRef.current),
  MAX_RECONNECT_DELAY
);
```

- 최대 재연결 지연: 30초
- 인증 실패(code 4001) 시 재연결 안 함
- 시각적 표시: "Connecting..." / "Disconnected"

### 재연결 동작

1. 클라이언트가 동일 session_id로 재연결
2. 서버가 새 연결 수락
3. 기존 PTY가 연결됨
4. 이전 연결이 있으면 종료됨

## 아키텍처

```
┌─────────────────┐
│  React Frontend │
│  useWebSocket   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Vite Proxy    │
│   /ws → backend │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│  FastAPI Server │────▶│  Session DB     │
│  /ws/terminal   │     │  (SQLite)       │
└────────┬────────┘     └─────────────────┘
         │
         ▼
┌─────────────────┐
│ WebSocket       │
│ Handler         │
│ (websocket.py)  │
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌─────────┐ ┌─────────┐
│pty_to_ws│ │ws_to_pty│
│ task    │ │ task    │
└────┬────┘ └────┬────┘
     │           │
     └─────┬─────┘
           ▼
┌─────────────────┐     ┌─────────────────┐
│   PTY Manager   │────▶│ ThreadPool      │
│ (pty_manager.py)│     │ Executor        │
└────────┬────────┘     └─────────────────┘
         │
         ▼
┌─────────────────┐
│ Platform Adapter│
│ - Windows:      │
│   pywinpty      │
│ - Linux/macOS:  │
│   pexpect       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Shell Process  │
│  (bash/zsh/cmd) │
└─────────────────┘
```

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

### 연결 오류
- **401 Unauthorized**: 유효하지 않거나 누락된 토큰 (연결 거부)
- **404 Not Found**: 세션이 존재하지 않음

### 런타임 오류
- PTY 프로세스 종료 → `{"type": "status", "data": "closed"}`
- 네트워크 중단 → 클라이언트 자동 재연결

## 보안 고려사항

1. **URL의 토큰**: WebSocket browser API의 제약으로 JWT는 쿼리 파라미터로 전달
   - 프로덕션에서 HTTPS/WSS 사용 필수
   - 짧은 만료 시간의 토큰 권장

2. **Rate Limiting**: WebSocket 연결도 HTTP와 동일한 rate limit 적용

3. **Path Validation**: PTY 조회 전 session_id 검증

4. **Origin Check**: WebSocket 핸드셰이크에서 CORS 적용

## 디버그 팁

### WebSocket 로깅 활성화

Browser DevTools → Network → WS → 연결 선택 → Messages

### 백엔드 로깅

```python
# 디버그 로깅 활성화
logging.getLogger("backend.websocket").setLevel(logging.DEBUG)
```

### 일반적인 문제

1. **"not_found" 상태**: 세션이 삭제되었거나 존재하지 않음
2. **"taken_over" 상태**: 다른 탭/디바이스가 동일 세션에 연결함
3. **연결 끊김**: 리버스 프록시 타임아웃 설정 확인 (nginx/cloudflared)
