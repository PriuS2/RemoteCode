# File Explorer

## Overview

The File Explorer component provides a web-based file browser with support for navigating directories, viewing files, uploading/downloading content, and syntax-highlighted preview.

## Features

- **Directory Navigation**: Browse folders with breadcrumb trail
- **View Modes**: Grid and List views
- **File Operations**: Upload, download, preview
- **Path Insertion**: Insert file paths into terminal
- **Keyboard Navigation**: Enter, Backspace, Arrow keys
- **Mobile Support**: Swipe gestures, responsive design
- **Context Menu**: Right-click for file actions

## Component Structure

```
FileExplorer
├── Header
│   ├── Close button
│   ├── Breadcrumb navigation
│   ├── View toggle (Grid/List)
│   └── Refresh button
├── File List (Grid or List)
│   └── FileEntry[]
├── Context Menu (Portal)
└── File Preview Modal (Portal)
    ├── Header (filename, actions)
    └── Content (highlighted or raw)
```

## API Endpoints

### GET /api/files

List directory contents.

**Query Parameters:**
- `path` (string): Directory path

**Response:**
```json
{
  "current": "/current/path",
  "parent": "/parent/path",
  "entries": [
    {
      "name": "filename.txt",
      "type": "file",
      "size": 1024,
      "modified": "2024-01-01T00:00:00",
      "extension": ".txt"
    },
    {
      "name": "folder",
      "type": "folder",
      "size": null,
      "modified": "2024-01-01T00:00:00",
      "extension": null
    }
  ],
  "drives": ["C:\\", "D:\\"] // Windows only
}
```

### GET /api/file-raw

Download a file.

**Query Parameters:**
- `path` (string): File path

**Response:** File content with appropriate content-type

**Errors:**
- `400`: Path is a directory
- `404`: File not found

### POST /api/upload

Upload file(s).

**Query Parameters:**
- `path` (string): Target directory

**Request:** Multipart form data with `files` field(s)

**Response:**
```json
{
  "uploaded": [
    {
      "name": "uploaded.txt",
      "size": 1024
    }
  ],
  "count": 1
}
```

## File Types

### Text File Detection

Files are considered text if:
1. Extension is in `TEXT_EXTENSIONS` set, OR
2. Filename (without extension) is in `TEXT_NAMES` set

**Supported Extensions:**
- Code: `.js`, `.jsx`, `.ts`, `.tsx`, `.py`, `.rs`, `.go`, `.java`, `.c`, `.cpp`, `.h`, etc.
- Web: `.html`, `.htm`, `.css`, `.scss`, `.sass`
- Config: `.json`, `.yaml`, `.yml`, `.toml`, `.ini`, `.env`
- Data: `.csv`, `.tsv`, `.xml`, `.sql`
- Shell: `.sh`, `.bash`, `.zsh`, `.ps1`, `.bat`
- Docs: `.md`, `.txt`, `.log`

**Special Filenames:**
- `makefile`, `dockerfile`, `vagrantfile`
- `gemfile`, `rakefile`, `cmakelists.txt`
- `.gitignore`, `.gitattributes`

### Icon System

Icons based on file extension:
- Folder: Directory icon
- Image: `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`, `.ico`
- Video: `.mp4`, `.webm`, `.mov`, `.avi`, `.mkv`
- Audio: `.mp3`, `.wav`, `.ogg`, `.flac`
- Archive: `.zip`, `.tar`, `.gz`, `.bz2`, `.7z`, `.rar`
- Code: Language-specific icons
- Document: `.pdf`, `.doc`, `.docx`
- Data: `.db`, `.sqlite`

## User Interface

### Grid View

- Large icons with file names
- Suitable for media browsing
- Responsive grid columns

### List View

- Small icons with detailed columns
- Shows: Name, Size, Modified date
- More compact for code directories

### Breadcrumb Navigation

```
Home / project / src / components
```

- Click segment to navigate up
- "Home" goes to rootPath

### Context Menu Actions

Right-click on file/folder:
- **Open**: Navigate folder or preview file
- **Insert Path**: Insert path into terminal
- **Download**: Download file
- **Preview**: Open preview modal (files only)

### File Preview Modal

For text files:
- Syntax-highlighted content
- Line numbers
- Copy button
- File metadata (size, modified)

For binary files:
- Download button
- File type indicator
- File size

## Keyboard Navigation

| Key | Action |
|-----|--------|
| `Enter` | Open selected item |
| `Backspace` | Go to parent directory |
| `Arrow Up/Down` | Navigate list (List view) |
| `Arrow Left/Right` | Change view mode |
| `Esc` | Close preview or explorer |

## Mobile Interactions

### Touch Gestures

- **Tap**: Open folder or file
- **Long Press**: Open context menu
- **Swipe Right**: Go to parent directory
- **Swipe Left**: Insert path into terminal

### Responsive Design

- Full-screen overlay on mobile
- Larger touch targets
- Simplified context menu
- No drag-and-drop upload

## Path Utilities

### Path Join

```typescript
joinPath("/home/user", "project") // "/home/user/project"
joinPath("C:\\Users", "project")   // "C:\\Users\\project"
```

### Parent Path

```typescript
getParentPath("/home/user/project") // "/home/user"
getParentPath("C:\\Users\\project")  // "C:\\Users"
getParentPath("/")                   // null
```

### Base Name

```typescript
getBaseName("/home/user/file.txt") // "file.txt"
```

## Upload Handling

### Drag and Drop

1. Drag files over file list
2. Visual feedback (highlight)
3. Drop to upload
4. Progress indication
5. Auto-refresh after upload

### File Input

- Hidden `<input type="file">`
- Triggered by context menu or button
- Multiple file selection support

### Upload Restrictions

Currently no restrictions on:
- File size
- File type
- Number of files

(Files are saved to server filesystem)

## Security Considerations

1. **Path Traversal**: All paths validated to stay within bounds
2. **File Access**: Only accessible files are shown
3. **Upload**: No virus scanning (client-side responsibility)
4. **Download**: Content-Type based on extension (not magic bytes)

## Performance Considerations

1. **Lazy Loading**: Files loaded on demand
2. **Caching**: No client-side caching of directory listings
3. **Large Directories**: Pagination not implemented (may be slow for 1000+ files)
4. **Preview**: Large files (>1MB) may be truncated in preview

## Integration with Terminal

The File Explorer can insert paths into the terminal:

```typescript
// In Terminal.tsx
const handleInsertPath = useCallback((text: string) => {
  sendInput(text);
  termRef.current?.focus();
}, [sendInput]);
```

This enables workflows like:
1. Browse to file in explorer
2. Right-click → "Insert Path"
3. Path appears in terminal input
