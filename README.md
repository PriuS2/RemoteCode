# Claude Code Remote

브라우저에서 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI를 원격으로 사용할 수 있는 셀프 호스팅 웹 애플리케이션입니다.

서버에서 Claude Code 프로세스를 관리하고, WebSocket 기반 터미널을 통해 어디서든 접속할 수 있습니다. Cloudflare Tunnel을 연결하면 외부 네트워크에서도 안전하게 사용 가능합니다.

## 주요 기능

- **웹 터미널** — xterm.js 기반 풀 터미널 (입력, 출력, 리사이즈)
- **멀티 세션** — 여러 Claude Code 세션을 동시에 생성·전환·일시정지·재개
- **파일 탐색기** — 서버 파일시스템 브라우징, 텍스트 미리보기, 파일 업로드, 경로 삽입
- **폴더 브라우저** — 작업 디렉토리 선택 UI (드라이브, 프리셋 폴더)
- **세션 유지** — WebSocket 끊김 시에도 PTY 프로세스 유지, 재연결 가능
- **인증** — 패스워드 로그인 + JWT 토큰 기반 API/WebSocket 인증
- **Rate Limiting** — 로그인 API 브루트포스 방지
- **크로스 플랫폼** — Windows, Linux, macOS 지원

## 아키텍처

```
브라우저 (React + xterm.js)
    ↕ HTTP / WebSocket
FastAPI 백엔드
    ↕ PTY (pywinpty / pexpect)
Claude Code CLI 프로세스
```

| 계층 | 기술 스택 |
|------|----------|
| Frontend | React 18, TypeScript, Vite, xterm.js |
| Backend | Python, FastAPI, Uvicorn, WebSocket |
| PTY | pywinpty (Windows) / pexpect (Linux, macOS) |
| DB | SQLite (aiosqlite) — 세션 메타데이터 |
| 인증 | JWT (PyJWT), slowapi rate limit |
| 터널 | Cloudflare Tunnel (선택) |

## 요구사항

- **Python** 3.10+
- **Node.js** 18+
- **Claude Code CLI** — `claude` 명령이 PATH에 있어야 합니다

## 빠른 시작

### 1. 설정

```bash
# Windows
.\setup.ps1

# Linux / macOS
chmod +x *.sh
./setup.sh

# 또는 Make
make setup
```

### 2. 환경 변수

처음 실행 시 `.env` 파일이 자동 생성됩니다. **반드시 아래 값들을 변경하세요:**

```env
CCR_HOST=0.0.0.0
CCR_PORT=8080
CCR_CLAUDE_COMMAND=claude
CCR_PASSWORD=changeme              # 로그인 비밀번호
CCR_JWT_SECRET=change-this-secret-key  # JWT 서명 키 (필수 변경)
CCR_JWT_EXPIRE_HOURS=72
CCR_DB_PATH=sessions.db
# CCR_ALLOWED_ORIGINS=https://your-domain.com
```

> `CCR_JWT_SECRET`이 기본값이면 서버가 시작되지 않습니다.

### 3. 실행

```bash
# 개발 모드 (백엔드 hot-reload + Vite dev server)
# Windows
.\start-dev.ps1

# Linux / macOS
./start-dev.sh

# 또는 Make
make dev
```

```bash
# 프로덕션 모드 (빌드된 프론트엔드를 백엔드가 서빙)
# 먼저 프론트엔드 빌드
cd frontend && npm run build && cd ..

# Windows
.\start.ps1

# Linux / macOS
./start.sh

# 또는 Make
make start
```

### 4. 접속

- **개발 모드**: `http://localhost:5173` (Vite) → 백엔드 프록시
- **프로덕션 모드**: `http://localhost:8080`

## Cloudflare Tunnel (선택)

외부에서 안전하게 접속하려면 Cloudflare Tunnel을 사용합니다.

### Quick Tunnel (임시 URL)

```bash
# Windows
.\tunnel-quick.ps1

# Linux / macOS
./tunnel-quick.sh

# Make
make tunnel-quick
```

### Named Tunnel (고정 도메인)

`.env`에 `CCR_DOMAIN`을 설정한 뒤:

```bash
# Windows
.\tunnel.ps1

# Linux / macOS
./tunnel.sh

# Make
make tunnel
```

> Named Tunnel 사용 시 사전에 `cloudflared tunnel create` 및 DNS 설정이 필요합니다.

## 프로젝트 구조

```
├── backend/
│   ├── main.py              # FastAPI 앱, REST API
│   ├── pty_manager.py        # 크로스 플랫폼 PTY 관리
│   ├── session_manager.py    # 세션 생명주기
│   ├── websocket.py          # WebSocket ↔ PTY 중계
│   ├── auth.py               # JWT 인증
│   ├── config.py             # 환경 변수 설정
│   ├── database.py           # SQLite 세션 저장소
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.tsx           # 메인 레이아웃, 세션 관리
│   │   ├── components/
│   │   │   ├── Terminal.tsx       # xterm.js 터미널
│   │   │   ├── SessionList.tsx    # 세션 목록 사이드바
│   │   │   ├── FileExplorer.tsx   # 파일 탐색기
│   │   │   ├── FolderBrowser.tsx  # 폴더 선택 다이얼로그
│   │   │   ├── NewSession.tsx     # 세션 생성 모달
│   │   │   └── Login.tsx          # 로그인 화면
│   │   └── utils/
│   │       ├── fileIcons.tsx      # 파일 아이콘
│   │       ├── pathUtils.ts       # 경로 유틸리티
│   │       └── notify.ts          # 브라우저 알림
│   ├── package.json
│   └── vite.config.ts
├── setup.ps1 / setup.sh
├── start.ps1 / start.sh
├── start-dev.ps1 / start-dev.sh
├── tunnel.ps1 / tunnel.sh
├── tunnel-quick.ps1 / tunnel-quick.sh
└── Makefile
```

## API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/auth/login` | 패스워드 로그인 → JWT 발급 |
| GET | `/api/health` | 헬스 체크 |
| GET | `/api/browse` | 폴더 목록 조회 |
| GET | `/api/files` | 파일/폴더 목록 조회 |
| GET | `/api/file-content` | 텍스트 파일 내용 읽기 |
| GET | `/api/file-raw` | 파일 원본 다운로드 |
| POST | `/api/mkdir` | 폴더 생성 |
| POST | `/api/upload` | 파일 업로드 |
| POST | `/api/open-explorer` | OS 파일 탐색기 열기 |
| GET | `/api/sessions` | 세션 목록 |
| POST | `/api/sessions` | 세션 생성 |
| POST | `/api/sessions/:id/suspend` | 세션 일시정지 |
| POST | `/api/sessions/:id/resume` | 세션 재개 |
| PATCH | `/api/sessions/:id/rename` | 세션 이름 변경 |
| DELETE | `/api/sessions/:id` | 세션 종료/삭제 |
| WS | `/ws/terminal/:id` | 터미널 WebSocket |

## 보안 참고사항

- `CCR_JWT_SECRET`을 반드시 강력한 랜덤 문자열로 변경하세요
- `CCR_PASSWORD`를 기본값에서 변경하세요
- 프로덕션에서는 `CCR_ALLOWED_ORIGINS`를 실제 도메인으로 제한하세요
- HTTPS 환경(Cloudflare Tunnel 등)에서 사용을 권장합니다

## License

MIT
