# Cloudflare Tunnel 설정 가이드

## 개요

Claude Code Remote 프로젝트를 외부에서 접속할 수 있도록 Cloudflare Tunnel을 사용합니다.
두 가지 방식을 지원합니다.

| 방식 | 스크립트 | URL | 용도 |
|------|----------|-----|------|
| Named Tunnel | `tunnel.ps1` | `https://example.com` | 고정 도메인, 운영/상시 사용 |
| Quick Tunnel | `tunnel-quick.ps1` | 랜덤 URL (매번 변경) | 임시 테스트, 빠른 공유 |

---

## 환경 변수 (.env)

모든 포트와 도메인 설정은 `.env` 파일에서 관리합니다.

```env
CCR_PORT=8080          # 백엔드 (FastAPI) 포트
CCR_VITE_PORT=5173     # 프론트엔드 (Vite) 포트
CCR_DOMAIN=example.com   # Cloudflare Tunnel 도메인
```

이 값들을 참조하는 파일:

| 환경 변수 | 참조 파일 |
|-----------|-----------|
| `CCR_PORT` | `start-dev.ps1`, `start.ps1`, `vite.config.ts` (프록시 대상), `tunnel-quick.ps1` |
| `CCR_VITE_PORT` | `start-dev.ps1`, `vite.config.ts` (서버 포트), `tunnel.ps1` |
| `CCR_DOMAIN` | `tunnel.ps1` |

포트나 도메인을 변경하려면 `.env`만 수정하면 됩니다.

---

## 사전 준비

### 1. cloudflared 설치

```powershell
winget install Cloudflare.cloudflared --accept-package-agreements --accept-source-agreements
```

설치 후 터미널을 재시작하거나 PATH를 갱신합니다.

```powershell
$machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$env:Path = "$machinePath;$userPath"
```

설치 확인:

```powershell
cloudflared --version
```

### 2. 로컬 서버 실행

터널을 시작하기 전에 반드시 로컬 서버가 실행 중이어야 합니다.

```powershell
# 개발 모드
.\start-dev.ps1

# 또는 운영 모드
.\start.ps1
```

---

## Named Tunnel (example.com)

고정 도메인을 사용하는 방식입니다. 한 번 설정하면 항상 같은 URL로 접속할 수 있습니다.

### 현재 설정 정보

| 항목 | 값 |
|------|-----|
| 터널 이름 | `ccr-tunnel` |
| 터널 ID | `7592bba9-abe6-4da3-ac60-d37e918f25b4` |
| 도메인 | `.env`의 `CCR_DOMAIN` |
| 로컬 서비스 | `http://localhost:{CCR_VITE_PORT}` |
| 프로토콜 | QUIC |

### 설정 파일 위치

```
C:\Users\tjseh\.cloudflared\
├── cert.pem                                              # Cloudflare 인증서
├── 7592bba9-abe6-4da3-ac60-d37e918f25b4.json            # 터널 자격증명
└── config.yml                                            # 터널 설정 (tunnel.ps1이 자동 생성)
```

> `config.yml`은 `tunnel.ps1` 실행 시 `.env` 값을 기반으로 자동 생성됩니다.
> 직접 수정할 필요가 없습니다.

### 트래픽 흐름 (DEV 모드)

```
example.com → Cloudflare Tunnel → localhost:{CCR_VITE_PORT} (Vite)
                                    ├── 페이지 요청 → Vite가 프론트엔드 제공
                                    ├── /api/* → localhost:{CCR_PORT} (프록시)
                                    └── /ws/*  → localhost:{CCR_PORT} (프록시)
```

### 실행

```powershell
.\tunnel.ps1
```

또는 수동으로:

```powershell
cloudflared tunnel run ccr-tunnel
```

### 접속

```
https://example.com
```

---

## Quick Tunnel (임시)

로그인이나 설정 없이 즉시 사용할 수 있는 임시 터널입니다.
실행할 때마다 URL이 변경됩니다. `.env`의 `CCR_PORT`를 사용합니다.

### 실행

```powershell
.\tunnel-quick.ps1
```

또는 수동으로:

```powershell
cloudflared tunnel --url http://localhost:8080
```

### 접속

터미널에 표시되는 `https://xxxxx.trycloudflare.com` URL로 접속합니다.

> Quick Tunnel은 백엔드 포트(CCR_PORT)를 직접 가리키므로, 프론트엔드 빌드된 운영 모드(`start.ps1`)에서 사용하는 것이 적합합니다.

---

## Named Tunnel 처음부터 설정하기 (참고용)

이미 설정이 완료되어 있으므로, 다른 환경에서 새로 설정할 때 참고하세요.

### 1단계: Cloudflare 로그인

```powershell
cloudflared tunnel login
```

브라우저가 열리면 Cloudflare 계정으로 로그인하고 도메인을 선택합니다.
인증서가 `~/.cloudflared/cert.pem`에 저장됩니다.

### 2단계: 터널 생성

```powershell
cloudflared tunnel create <터널이름>
```

출력에서 터널 ID와 자격증명 파일 경로를 확인합니다.

### 3단계: DNS 라우팅

```powershell
cloudflared tunnel route dns <터널이름> <도메인>
```

Cloudflare DNS에 CNAME 레코드가 자동 생성됩니다.

### 4단계: .env 설정

```env
CCR_PORT=8080
CCR_VITE_PORT=5173
CCR_DOMAIN=your-domain.com
```

### 5단계: tunnel.ps1의 터널 ID 업데이트

`tunnel.ps1` 내부의 `$tunnelId` 변수를 새로 생성된 터널 ID로 변경합니다.

### 6단계: 실행

```powershell
.\tunnel.ps1
```

---

## 서브도메인 추가 (선택)

도메인 외에 서브도메인을 추가하려면:

### 1. DNS 라우팅 추가

```powershell
cloudflared tunnel route dns ccr-tunnel api.example.com
```

### 2. tunnel.ps1의 config.yml 생성 부분 수정

`tunnel.ps1`에서 `config.yml`을 생성하는 부분에 ingress 규칙을 추가합니다.

```yaml
ingress:
  - hostname: example.com
    service: http://localhost:5173
  - hostname: api.example.com
    service: http://localhost:3000
  - service: http_status:404
```

---

## 관리 명령어

```powershell
# 터널 목록 조회
cloudflared tunnel list

# 터널 상태 확인
cloudflared tunnel info ccr-tunnel

# 터널 삭제 (주의)
cloudflared tunnel delete ccr-tunnel

# DNS 레코드 확인은 Cloudflare 대시보드에서
# https://dash.cloudflare.com → example.com → DNS
```

---

## 문제 해결

### cloudflared 명령을 찾을 수 없음

터미널을 재시작하거나 PATH를 수동 갱신합니다.

```powershell
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
```

### 터널은 실행되지만 접속 안 됨

1. 로컬 서버가 실행 중인지 확인
2. DEV 모드: `http://localhost:{CCR_VITE_PORT}` 접속 가능한지 확인
3. PROD 모드: `http://localhost:{CCR_PORT}` 접속 가능한지 확인
4. Cloudflare 대시보드에서 DNS 레코드가 존재하는지 확인

### "Not Found" 응답

터널이 백엔드 포트(8080)를 가리키고 있는데 DEV 모드로 실행 중일 수 있습니다.
DEV 모드에서는 Vite 포트(5173)를 가리켜야 합니다. `.env`의 `CCR_VITE_PORT`를 확인하세요.

### 인증 오류

```powershell
cloudflared tunnel login
```

로 재인증합니다. 인증서(`cert.pem`)가 만료되었을 수 있습니다.

### 포트 변경

`.env`에서 포트를 변경하면 모든 스크립트에 자동 반영됩니다.
`tunnel.ps1`은 실행 시 `.env`를 읽어 `config.yml`을 자동 생성합니다.
