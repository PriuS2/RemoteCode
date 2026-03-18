# Remote Code Documentation

## Overview

Remote Code는 웹 브라우저에서 Claude Code CLI에 원격으로 접속할 수 있는 풀스택 애플리케이션입니다. FastAPI 기반의 백엔드와 React 기반의 프론트엔드로 구성되어 있으며, 터미널 세션 관리, 파일 탐색기, Git 통합 기능을 제공합니다.

## Key Features

- **Web Terminal**: xterm.js 기반의 풀기능 터미널 에뮬레이션
- **Session Management**: 세션 생성/일시중지/재개/종료 관리
- **Split View**: 듀얼 패널 터미널 지원
- **File Explorer**: 파일 탐색 및 미리보기
- **Git Integration**: Git 상태 확인, diff 보기, 브랜치 관리, 커밋 그래프
- **Mobile Support**: 모바일 키보드 및 터치 스크롤 지원

## Tech Stack

### Backend
- Python 3.11+
- FastAPI
- WebSocket
- SQLite (aiosqlite)
- pywinpty (Windows) / pexpect (Linux/macOS)

### Frontend
- React 18
- TypeScript
- Vite
- xterm.js

## Documentation Index

| Document | Description |
|----------|-------------|
| [Architecture](./architecture.md) | 시스템 아키텍처 개요 |
| [Backend API](./backend-api.md) | REST API 엔드포인트 |
| [Verification Checklist](./verification-checklist.md) | 기본 수동 검증 순서 |
| [Frontend Components](./frontend-components.md) | React 컴포넌트 구조 |
| [Database Schema](./database-schema.md) | 데이터베이스 스키마 |
| [WebSocket Protocol](./websocket-protocol.md) | WebSocket 메시지 프로토콜 |
| [Git Integration](./git-integration.md) | Git 기능 상세 |
| [File Explorer](./file-explorer.md) | 파일 탐색기 기능 |
| [Configuration](./configuration.md) | 설정 옵션 |
| [Deployment](./deployment.md) | 배포 가이드 |

## Quick Start

```bash
# Setup
make setup

# Development mode
make dev

# Production mode
make start
```

## Verification

For release checks and post-change smoke tests, use [Verification Checklist](./verification-checklist.md).

## Project Structure

```
.
├── backend/           # FastAPI backend
│   ├── main.py       # Main application
│   ├── auth.py       # JWT authentication
│   ├── database.py   # SQLite operations
│   ├── pty_manager.py # PTY process management
│   ├── session_manager.py # Session lifecycle
│   ├── websocket.py  # WebSocket handlers
│   └── git_utils.py  # Git utilities
├── frontend/         # React frontend
│   ├── src/
│   │   ├── components/  # React components
│   │   ├── hooks/       # Custom hooks
│   │   ├── utils/       # Utilities
│   │   └── types/       # TypeScript types
│   └── package.json
├── docs/             # Documentation
└── Makefile          # Build automation
```
