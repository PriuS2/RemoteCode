# ToDo

이 문서는 현재 레포를 기준으로 정리한 우선순위별 작업 체크리스트다.
각 항목에는 중요도, 영향 범위, 상세 내용, 수정 방향, 확인 기준, 관련 파일을 함께 적었다.

우선순위 기준:

- `P0`: 보안, 데이터 손상, 서비스 사용 불가, 배포 차단
- `P1`: 핵심 기능 신뢰성 저하, 주요 사용자 흐름 장애
- `P2`: UX 및 기능 개선
- `P3`: 문서, 정리, 마감 품질

## P0

- [ ] `P0 / 보안` OpenCode Web 프록시에 인증 추가
  상세 내용:
  OpenCode Web의 상태 조회, 시작, 중지 API는 인증이 걸려 있지만 실제 프록시 엔드포인트는 인증 없이 접근 가능하다. 내부 서비스가 한번 시작되면 비인증 사용자가 프록시된 UI에 접근할 수 있는 구조다.
  수정 방향:
  `opencode_web_proxy()`에 `Depends(get_current_user)`를 추가한다. 프록시로 전달하는 헤더도 최소화하고, 인증 토큰이나 불필요한 헤더는 명시적으로 제거한다.
  확인 기준:
  로그인 없이 `/api/opencode-web/proxy` 접근 시 `401` 또는 `403`이 반환되어야 한다. 로그인 후에는 정상 접근 가능해야 한다.
  관련 파일:
  [backend/main.py](/C:/Users/STOICPC_QQQ/Documents/RemoteCode/backend/main.py)

- [ ] `P0 / 보안` 파일 `rename` 및 `delete` 경로 검증 강화
  상세 내용:
  `rename`과 `delete` API는 `oldName`과 `name`에 경로 구분자나 상대 경로(`..`)가 들어와도 막지 않는다. 현재는 `newName`만 검증하므로, UI를 우회하면 현재 폴더 밖 파일을 rename/delete할 수 있다.
  수정 방향:
  `oldName`, `newName`, `name` 모두 파일명 단위 검증을 적용한다. 단순한 `basename` 비교로 끝내지 말고, 절대 경로화 후 대상이 반드시 부모 디렉터리 하위에 있는지 확인한다. 같은 검증 로직을 rename/delete에서 공통으로 재사용한다.
  확인 기준:
  `../`, `..\\`, 절대 경로, 경로 구분자를 포함한 입력은 모두 거부되어야 한다. 정상적인 같은 폴더 내 rename/delete는 그대로 동작해야 한다.
  관련 파일:
  [backend/main.py](/C:/Users/STOICPC_QQQ/Documents/RemoteCode/backend/main.py)

- [ ] `P0 / 배포 차단` 프론트엔드 빌드 실패 수정
  상세 내용:
  `GitPanel`의 `PanelHeader`가 `gitFontSize`, `onFontSizeChange`를 필수 prop으로 요구하는데, Git 저장소가 아닐 때와 초기 로딩 상태의 두 렌더 경로에서 해당 prop이 빠져 있다. 현재 `npm.cmd run build`가 실제로 실패한다.
  수정 방향:
  두 early-return 경로에 동일한 prop을 전달하거나, `PanelHeader` prop 설계를 조정해 기본값을 제공한다. 타입만 완화하지 말고 UI 동작도 일관되게 유지해야 한다.
  확인 기준:
  `frontend`에서 `npm.cmd run build`가 성공해야 한다. Git 저장소가 아닌 경로, 로딩 중 상태, 정상 Git 저장소 상태 모두에서 헤더 UI가 깨지지 않아야 한다.
  관련 파일:
  [frontend/src/components/GitPanel.tsx](/C:/Users/STOICPC_QQQ/Documents/RemoteCode/frontend/src/components/GitPanel.tsx)

## P1

- [ ] `P1 / 신뢰성` OpenCode Web 연결을 프록시 경로 기준으로 정리
  상세 내용:
  `OpenCodeWebViewer`는 백엔드 프록시가 이미 있는데도 새 창을 `http://<host>:8096`으로 직접 연다. 이 방식은 커스텀 포트, HTTPS, 리버스 프록시, Cloudflare Tunnel 환경에서 쉽게 깨진다.
  수정 방향:
  새 창 URL을 하드코딩하지 말고 `/api/opencode-web/proxy` 기반으로 열도록 변경한다. 프론트엔드가 내부 서비스 포트를 직접 알지 않도록 정리한다.
  확인 기준:
  기본 포트, 커스텀 포트, HTTPS 환경에서 모두 정상 동작해야 하며 mixed content 경고가 없어야 한다.
  관련 파일:
  [frontend/src/components/OpenCodeWebViewer.tsx](/C:/Users/STOICPC_QQQ/Documents/RemoteCode/frontend/src/components/OpenCodeWebViewer.tsx)
  [backend/main.py](/C:/Users/STOICPC_QQQ/Documents/RemoteCode/backend/main.py)

- [ ] `P1 / 프로세스 관리` Windows에서 OpenCode Web 시작/종료 추적 방식 수정
  상세 내용:
  Windows에서는 `Start-Process`를 감싼 PowerShell 프로세스를 저장하고 있어서 실제 `opencode` 자식 프로세스를 안정적으로 추적하지 못할 가능성이 크다. 이 경우 `stop()`이 기대대로 동작하지 않을 수 있다.
  수정 방향:
  실제 `opencode` 프로세스를 직접 추적하거나, 별도 PID 관리 전략을 둔다. 단순 sleep 뒤 포트 확인만 하는 현재 방식 대신 시작 성공과 실패를 더 명확히 판단하도록 바꾼다.
  확인 기준:
  Windows에서 `start -> status -> stop`이 반복적으로 안정 동작해야 한다. 이미 실행 중일 때 중복 기동하지 않고, 중지 후에는 포트가 실제로 닫혀야 한다.
  관련 파일:
  [backend/opencode_web_manager.py](/C:/Users/STOICPC_QQQ/Documents/RemoteCode/backend/opencode_web_manager.py)

- [ ] `P1 / 연결 안정성` WebSocket 중복 재연결 방지
  상세 내용:
  `useWebSocket` 훅은 `visibilitychange` 시 기존 reconnect timer나 기존 소켓 상태를 충분히 정리하지 않고 `connect()`를 다시 호출한다. 탭 복귀나 네트워크 불안정 상황에서 같은 세션에 중복 연결 시도가 생길 수 있다.
  수정 방향:
  재연결 전에 기존 reconnect timer를 해제하고, 이미 `OPEN` 또는 `CONNECTING` 상태의 소켓이 있으면 재연결을 생략한다. 가시성 복귀 시 필요한 경우에만 재연결하도록 상태 규칙을 명확히 한다.
  확인 기준:
  탭 전환, 네트워크 순간 끊김, 서버 재시작 상황에서 세션당 WebSocket 연결이 하나만 유지되어야 한다.
  관련 파일:
  [frontend/src/hooks/useWebSocket.ts](/C:/Users/STOICPC_QQQ/Documents/RemoteCode/frontend/src/hooks/useWebSocket.ts)

- [ ] `P1 / 파일 프리뷰` 오디오 프리뷰 로직을 이미지 프리뷰와 분리
  상세 내용:
  오디오 파일 클릭 시 전용 오디오 로더가 아니라 이미지 프리뷰 로더를 재사용하고 있다. blob URL이라 우연히 동작할 수는 있지만, 상태명과 에러 처리, 유지보수 측면에서 구조가 어색하다.
  수정 방향:
  이미지와 오디오 프리뷰 로딩 함수를 분리하고, 파일 타입별 상태와 에러 메시지를 명확히 나눈다. 이후 프리뷰 유형이 늘어나도 확장하기 쉬운 구조로 정리한다.
  확인 기준:
  텍스트, 이미지, 오디오가 각각 올바른 로더와 올바른 에러 처리 경로를 사용해야 한다.
  관련 파일:
  [frontend/src/components/FileExplorer.tsx](/C:/Users/STOICPC_QQQ/Documents/RemoteCode/frontend/src/components/FileExplorer.tsx)

- [ ] `P1 / 보안 하드닝` 인증 토큰 저장 방식 재검토
  상세 내용:
  현재 토큰을 `localStorage`에 저장한다. XSS가 한번 발생하면 세션 탈취 가능성이 커지고, 프록시 HTML까지 다루는 앱 구조에서는 특히 위험하다.
  수정 방향:
  가능하면 `HttpOnly` 쿠키 기반 세션으로 전환한다. 당장 전환이 어렵다면 토큰 노출 범위와 수명을 줄이고, 프론트엔드가 raw token을 직접 다루는 범위를 최소화한다.
  확인 기준:
  로그인, 새로고침, 로그아웃, 만료 처리가 모두 정상 동작해야 한다. 가능하면 프론트엔드가 토큰 문자열을 직접 보관하지 않는 구조가 되어야 한다.
  관련 파일:
  [frontend/src/App.tsx](/C:/Users/STOICPC_QQQ/Documents/RemoteCode/frontend/src/App.tsx)
  [frontend/src/components/Login.tsx](/C:/Users/STOICPC_QQQ/Documents/RemoteCode/frontend/src/components/Login.tsx)
  [backend/auth.py](/C:/Users/STOICPC_QQQ/Documents/RemoteCode/backend/auth.py)

## P2

- [ ] `P2 / UX` 새 세션 모달의 모바일 레이아웃 개선
  상세 내용:
  CLI 타입 선택지가 많고 현재 배치가 가로 중심이라 모바일에서 답답하게 느껴질 가능성이 크다.
  수정 방향:
  모바일에서는 세로 스택 또는 2열 그리드로 바꾸고, 각 CLI 타입에 짧은 설명을 붙인다. `custom` 선택 시 나타나는 필드도 모바일에서 입력하기 쉬운 형태로 조정한다.
  확인 기준:
  360px 내외 화면에서도 주요 선택지와 입력 필드가 무리 없이 조작 가능해야 한다.
  관련 파일:
  [frontend/src/components/NewSession.tsx](/C:/Users/STOICPC_QQQ/Documents/RemoteCode/frontend/src/components/NewSession.tsx)

- [ ] `P2 / UX` 세션 리스트와 파일 탐색기에 검색 및 필터 추가
  상세 내용:
  세션 수나 파일 수가 많아지면 현재 UI로는 원하는 항목을 빠르게 찾기 어렵다.
  수정 방향:
  세션 리스트에는 이름/경로 기준 검색을 추가하고, 파일 탐색기에는 현재 디렉터리 기준 필터를 추가한다. 우선은 클라이언트 측 필터로 시작하고 필요 시 서버 검색으로 확장한다.
  확인 기준:
  많은 세션과 큰 디렉터리에서도 원하는 항목을 빠르게 찾을 수 있어야 한다.
  관련 파일:
  [frontend/src/components/SessionList.tsx](/C:/Users/STOICPC_QQQ/Documents/RemoteCode/frontend/src/components/SessionList.tsx)
  [frontend/src/components/FileExplorer.tsx](/C:/Users/STOICPC_QQQ/Documents/RemoteCode/frontend/src/components/FileExplorer.tsx)

- [ ] `P2 / UX` 브라우저 기본 대화상자를 앱 내 모달로 교체
  상세 내용:
  세션 이름 변경, 세션 삭제, 파일 이름 변경, 일부 오류 처리에서 `prompt`, `confirm`, `alert`를 사용하고 있다. 모바일, 접근성, 시각적 일관성 측면에서 완성도가 낮다.
  수정 방향:
  입력형, 확인형, 위험 작업형 모달을 공통 컴포넌트로 만든다. 삭제나 종료 같은 위험 작업은 영향 범위를 더 명확히 보여주도록 바꾼다.
  확인 기준:
  세션 삭제, 세션명 변경, 파일 rename/delete가 모두 앱 내부 모달로 일관되게 동작해야 한다.
  관련 파일:
  [frontend/src/components/SessionList.tsx](/C:/Users/STOICPC_QQQ/Documents/RemoteCode/frontend/src/components/SessionList.tsx)
  [frontend/src/components/FileExplorer.tsx](/C:/Users/STOICPC_QQQ/Documents/RemoteCode/frontend/src/components/FileExplorer.tsx)
  [frontend/src/components/FolderBrowser.tsx](/C:/Users/STOICPC_QQQ/Documents/RemoteCode/frontend/src/components/FolderBrowser.tsx)

- [ ] `P2 / UX` "Open in Explorer" 계열 액션 문구 명확화
  상세 내용:
  현재 액션 이름만 보면 사용자 로컬 PC에서 열릴 것처럼 보이지만 실제로는 서버 측 탐색기나 파일 핸들러를 연다.
  수정 방향:
  `Open on Server`, `Open Server Folder` 같은 식으로 라벨을 명확히 바꾸고, 필요하면 툴팁도 추가한다.
  확인 기준:
  처음 보는 사용자도 이 기능이 서버 측 동작이라는 점을 바로 이해할 수 있어야 한다.
  관련 파일:
  [frontend/src/components/FileExplorer.tsx](/C:/Users/STOICPC_QQQ/Documents/RemoteCode/frontend/src/components/FileExplorer.tsx)
  [backend/main.py](/C:/Users/STOICPC_QQQ/Documents/RemoteCode/backend/main.py)

- [ ] `P2 / 기능 개선` 세션 생성 전에 CLI 실행 가능 여부 사전 점검
  상세 내용:
  현재는 PTY spawn 단계에 가서야 `claude`, `opencode`, custom command 실행 실패가 드러난다. 사용자 입장에서는 실패가 늦고 원인도 불친절하다.
  수정 방향:
  세션 생성 전에 CLI 존재 여부와 실행 가능 여부를 검사하는 API를 추가하거나, 세션 생성 API가 구조화된 실패 이유를 반환하도록 바꾼다.
  확인 기준:
  필요한 CLI가 없을 때 사용자가 로그를 보지 않아도 원인을 바로 알 수 있어야 한다.
  관련 파일:
  [frontend/src/components/NewSession.tsx](/C:/Users/STOICPC_QQQ/Documents/RemoteCode/frontend/src/components/NewSession.tsx)
  [backend/session_manager.py](/C:/Users/STOICPC_QQQ/Documents/RemoteCode/backend/session_manager.py)
  [backend/pty_manager.py](/C:/Users/STOICPC_QQQ/Documents/RemoteCode/backend/pty_manager.py)

- [ ] `P2 / 기능 개선` 파일 프리뷰 기능 고도화
  상세 내용:
  현재 프리뷰는 텍스트, 이미지, 오디오 정도를 지원하지만 대용량 파일 읽기나 더 풍부한 미리보기 경험은 부족하다.
  수정 방향:
  대용량 파일 chunk preview, 텍스트 검색, line jump, PDF/영상 지원 등을 단계적으로 추가한다.
  확인 기준:
  파일 타입이 다양해져도 프리뷰 구조가 복잡해지지 않고, 실제 읽기 경험이 개선되어야 한다.
  관련 파일:
  [frontend/src/components/FileExplorer.tsx](/C:/Users/STOICPC_QQQ/Documents/RemoteCode/frontend/src/components/FileExplorer.tsx)
  [backend/main.py](/C:/Users/STOICPC_QQQ/Documents/RemoteCode/backend/main.py)

- [ ] `P2 / 운영 UX` 상태 메시지와 실패 이유 구조화
  상세 내용:
  재연결, PTY 시작 실패, CLI 미설치, 인증 오류 등 여러 상황이 사용자 관점에서 충분히 구분되지 않는다.
  수정 방향:
  백엔드는 오류 코드를 구조화하고, 프론트엔드는 배지, 토스트, 상태 라벨을 나눠서 보여준다. 최소한 `connecting`, `reconnecting`, `auth failed`, `cli not found`, `spawn failed` 정도는 구분한다.
  확인 기준:
  사용자가 브라우저 콘솔이나 서버 로그를 보지 않아도 실패 원인을 UI만 보고 이해할 수 있어야 한다.
  관련 파일:
  [frontend/src/components/Terminal.tsx](/C:/Users/STOICPC_QQQ/Documents/RemoteCode/frontend/src/components/Terminal.tsx)
  [frontend/src/hooks/useWebSocket.ts](/C:/Users/STOICPC_QQQ/Documents/RemoteCode/frontend/src/hooks/useWebSocket.ts)
  [backend/websocket.py](/C:/Users/STOICPC_QQQ/Documents/RemoteCode/backend/websocket.py)

## P3

- [ ] `P3 / 문서` README와 실제 API/동작 일치시키기
  상세 내용:
  README와 일부 문서의 엔드포인트 및 동작 설명이 현재 구현과 다르다. 설치와 운영 단계에서 바로 혼란을 줄 수 있다.
  수정 방향:
  인증, 파일 업로드/다운로드, Git 관련 API 명칭과 예시를 실제 구현 기준으로 전면 점검한다. 오래된 설명은 제거하고 현재 지원하는 동작만 남긴다.
  확인 기준:
  문서만 보고 따라가도 실제 엔드포인트, 명령어, 설정명이 코드와 일치해야 한다.
  관련 파일:
  [README.md](/C:/Users/STOICPC_QQQ/Documents/RemoteCode/README.md)
  [docs/backend-api.md](/C:/Users/STOICPC_QQQ/Documents/RemoteCode/docs/backend-api.md)

- [ ] `P3 / 정리` UI와 문서의 인코딩 깨짐 텍스트 정리
  상세 내용:
  일부 주석과 사용자 노출 문자열이 깨져 보인다. 앱 완성도와 신뢰도를 떨어뜨리는 요소다.
  수정 방향:
  파일 인코딩을 UTF-8로 통일하고, 사용자에게 보이는 문자열부터 우선 정리한다. 이후 주석과 문서도 함께 정리한다.
  확인 기준:
  UI, README, 주요 소스에서 깨진 문자열이 보이지 않아야 한다.
  관련 파일:
  [frontend/src/components/OpenCodeWebViewer.tsx](/C:/Users/STOICPC_QQQ/Documents/RemoteCode/frontend/src/components/OpenCodeWebViewer.tsx)
  [backend/main.py](/C:/Users/STOICPC_QQQ/Documents/RemoteCode/backend/main.py)
  [README.md](/C:/Users/STOICPC_QQQ/Documents/RemoteCode/README.md)

- [ ] `P3 / 검증` 기본 검증 루틴 문서화
  상세 내용:
  현재 확인 가능한 빌드 실패는 있었지만, 반복 가능한 공통 검증 루틴이 문서로 정리되어 있지 않다.
  수정 방향:
  프론트엔드 빌드, 백엔드 실행, 로그인, 세션 생성, 파일 탐색기, Git 패널, OpenCode Web 경로까지 확인하는 기본 체크리스트를 문서로 남긴다. 가능하면 이후 자동화 대상으로 확장한다.
  확인 기준:
  기능 추가 후 어떤 순서로 검증해야 하는지 팀 내 공통 기준이 생겨야 한다.
  관련 파일:
  [docs/README.md](/C:/Users/STOICPC_QQQ/Documents/RemoteCode/docs/README.md)

## 권장 작업 순서

1. P0 세 항목부터 먼저 처리
2. OpenCode Web 연결 및 프로세스 안정화
3. WebSocket 재연결 동작과 파일 프리뷰 구조 정리
4. 세션 생성 UX, 검색/필터, 앱 내 모달 등 사용자 경험 개선
5. 문서, 인코딩, 검증 루틴 정리
