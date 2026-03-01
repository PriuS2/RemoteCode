# Frontend Components

## Component Hierarchy

```
App
├── Login (when not authenticated)
└── App (authenticated)
    ├── Header
    │   └── Settings Panel
    ├── Sidebar
    │   └── SessionList
    │       └── ContextMenu (Portal)
    ├── Terminal Area
    │   └── Terminal[] (1 or 2 for split view)
    │       ├── Title Bar
    │       ├── File Explorer (optional)
    │       ├── Git Panel (optional)
    │       ├── xterm.js Terminal
    │       └── MobileKeyBar (mobile only)
    └── NewSession Modal (when creating)
```

## Components

### App.tsx

Main application component managing global state.

**State:**
- `token`: JWT token from localStorage
- `sessions`: List of all sessions
- `activeSessions`: Currently visible session IDs (1 or 2)
- `focusedIndex`: Which panel is focused (0 or 1)
- `sidebarOpen`, `sidebarWidth`: Sidebar state
- `mountedSessions`: Sessions with initialized terminals
- `sessionActivity`: Activity state per session (idle/processing/done)
- `webFontSize`, `terminalFontSize`: Font size settings
- `splitRatio`: Split panel ratio (0.2 - 0.8)

**Key Functions:**
- `selectSession(id, split)`: Open session (Shift+Click for split)
- `handleActivityChange()`: Track session processing state
- `handleSuspend/Resume/Terminate/Delete()`: Session lifecycle

### Login.tsx

Authentication form.

**Props:**
- `onLogin(token: string)`: Callback on successful login

### SessionList.tsx

Session list with context menu support and drag-and-drop reordering.

**Props:**
- `sessions: Session[]`
- `activeSessions: string[]`
- `focusedSessionId: string | null`
- `sessionActivity: Record<string, ActivityState>`
- `onSelect(id, split?)`: Click handler
- `onResume(id)`: Resume handler
- `onNewSession()`: New session handler
- `onDelete/ Rename/ Suspend/ Terminate`: Action handlers
- `onReorder?(orderedIds: string[])`: Reorder handler (optional)

**Features:**
- Status colors (active: green, suspended: yellow, closed: gray)
- Activity indicators (spinner for processing, pulse for done)
- Context menu on right-click / long-press
- Shift+Click hint for split view
- **Drag-and-drop reordering**: Drag sessions to reorder them in the sidebar
  - Draggable when `onReorder` prop is provided
  - Visual feedback during drag (semi-transparent item)
  - Drop target highlighted with blue border
  - Order is persisted to database via API

### Terminal.tsx

Terminal component wrapping xterm.js.

**Props:**
- `sessionId: string`
- `token: string`
- `visible?: boolean`
- `fontSize?: number`
- `onFontSizeChange?(delta: number)`
- `onActivityChange?(sessionId, state)`
- `panelIndex: number` (0 or 1)
- `splitMode: boolean`
- `splitRatio?: number`
- `isFocused: boolean`
- `onFocus(): void`
- `sessionName`, `workPath`: Display info
- `onClosePanel/ Suspend/ Maximize/ Terminate`: Action handlers

**Features:**
- xterm.js with Catppuccin Mocha theme
- WebSocket connection with auto-reconnect
- Activity detection (Enter key triggers processing mode)
- File explorer toggle
- Git panel toggle
- Font size controls
- Mobile touch scroll handling
- Custom scrollbar on mobile

### FileExplorer.tsx

File browser with preview support.

**Props:**
- `token: string`
- `rootPath: string`
- `onInsertPath(text: string)`: Insert path into terminal
- `onClose(): void`
- `isMobile: boolean`

**Features:**
- Grid/List view modes
- Breadcrumb navigation
- File upload (drag & drop)
- Syntax-highlighted file preview
- File download
- Context menu (right-click)
- Keyboard navigation (Enter, Backspace, Arrow keys)
- Mobile swipe-to-go-back

### GitPanel.tsx

Git integration panel.

**Props:**
- `token: string`
- `workPath: string`
- `onClose(): void`
- `isMobile: boolean`

**Features:**
- Status overview (branch, ahead/behind)
- Staged/Unstaged/Untracked file lists
- Diff viewer with syntax highlighting
- Branch list with checkout
- Commit graph visualization
- Commit message input
- Pull/Push/Fetch buttons

### NewSession.tsx

Modal for creating new sessions.

**Props:**
- `token: string`
- `onCreated(sessionId: string)`: Callback on success
- `onCancel(): void`

**Features:**
- Path input with folder browser
- "Create folder" checkbox
- Session name input (optional)

### MobileKeyBar.tsx

Mobile keyboard helper bar.

**Props:**
- `onKey(key: string)`: Key press handler

**Features:**
- Special keys: Tab, Esc, Ctrl+C, /, @, ↑, ↓, ←, →
- Swipe gesture support for arrow keys

## Custom Hooks

### useWebSocket.ts

WebSocket connection management.

**Interface:**
```typescript
interface UseWebSocketOptions {
  url: string | null;
  onMessage: (msg: { type: string; data: any }) => void;
  autoReconnect?: boolean;
}

interface UseWebSocketReturn {
  sendInput(data: string): void;
  sendResize(cols: number, rows: number): void;
  status: "connecting" | "connected" | "disconnected";
}
```

**Features:**
- Auto-reconnect with 3-second delay
- Connection status tracking
- Message type routing

## Utility Functions

### notify.ts

Notification utilities.

```typescript
export function requestNotificationPermission(): Promise<NotificationPermission>
export function sendBrowserNotification(title: string, body: string): void
export function playNotificationSound(): void
```

### pathUtils.ts

Path manipulation utilities (works with Windows and Unix paths).

```typescript
export function joinPath(a: string, b: string): string
export function getParentPath(p: string): string | null
export function getBaseName(p: string): string
export function normalizePathSeparator(p: string): string
```

### gitGraph.ts

Commit graph layout calculation.

```typescript
export interface GitLogEntry {
  hash: string;
  parents: string[];
  // ...
}

export interface GraphNode {
  commit: GitLogEntry;
  x: number;  // Column position
  y: number;  // Row position
  color: string;
}

export function computeGraphLayout(commits: GitLogEntry[]): GraphNode[]
```

### fileIcons.tsx

File type icon components.

```typescript
export function FileIcon({ filename, size }: { filename: string; size?: number }): JSX.Element
export function IconFolder({ size }: { size?: number }): JSX.Element
```

## TypeScript Types

### session.ts

```typescript
export interface Session {
  id: string;
  claude_session_id: string | null;
  name: string;
  work_path: string;
  created_at: string;
  last_accessed_at: string;
  status: "active" | "suspended" | "closed";
  cli_type: "claude" | "opencode" | "terminal" | "custom";
  custom_command: string | null;
  custom_exit_command: string | null;
  order_index: number;
}

export type ActivityState = "idle" | "processing" | "done";
```

## CSS Variables

Dynamic font size variables set by App.tsx:

```css
:root {
  --web-fs: 14px;
  --web-fs-sm: 13px;
  --web-fs-xs: 11px;
  --web-fs-xxs: 10px;
}
```

## Event System

Custom events used:
- `panel-resize-end`: Fired when sidebar/split panel resize completes
  - Used by Terminal to refit xterm.js

## Responsive Design Breakpoints

- Mobile: `width <= 768px`
- Desktop: `width > 768px`

Mobile-specific behaviors:
- Sidebar as overlay with backdrop
- No split view (force single panel)
- MobileKeyBar visible
- Custom scrollbar
- Touch gestures for file explorer navigation
