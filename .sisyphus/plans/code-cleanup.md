# 코드 정리 (Dead Code Cleanup)

## TL;DR

> **Quick Summary**: 사용하지 않는 캐시, 빌드 산출물, 빈 디렉토리를 정리하여 디스크 공간을 확보하고 코드베이스를 깨끗하게 유지합니다.
> 
> **Deliverables**:
> - Python 캐시 디렉토리 삭제 (__pycache__, .pytest_cache, .ruff_cache)
> - 빌드 산출물 삭제 (build/, dist/, desktop-dist/, release/)
> - 개발 의존성 삭제 (node_modules/, .venv/)
> - 빈 디렉토리 삭제 (.cursor/, .playwright/, backend/routes/)
> - 테스트 결과 삭제 (test-results/)
> - obsolete 문서 삭제 (docs/ToDo.md)
> 
> **Estimated Effort**: Short (~15분 작업)
> **Parallel Execution**: YES - 모든 삭제 작업은 독립적으로 수행 가능
> **Critical Path**: 모든 작업을 순차적으로 삭제 후 git commit

---

## Context

### Original Request
사용하지 않는 코드나 더는 사용안할 테스트코드, 파일들이 있다면 정리하고싶어

### Interview Summary
**Key Discussions**:
- 전체 정리 (사용하지 않는 코드 + 죽은 테스트 + 빈 파일 + 백업 파일)
- 한 번에 커밋
- 실행 전 plan review
- `test_runtime_env.py`: 유지 (유효한 테스트로 판명)
- `docs/ToDo.md`: 삭제

### Metis Review
**Identified Gaps** (addressed):
- `test_runtime_env.py` orphan 아님 → 유지 결정
- `.agents/`, `.claude/`, `.sisyphus/`는 삭제 대신 `.gitignore`에 추가 검토

---

## Work Objectives

### Core Objective
코드베이스에서 사용하지 않는 파일과 디렉토리를 안전하게 삭제하여 디스크 공간을 확보하고 정리를 유지합니다.

### Concrete Deliverables
- Python 캐시 삭제
- 빌드 산출물 삭제
- node_modules 및 .venv 삭제
- 빈 디렉토리 삭제
- test-results 삭제
- docs/ToDo.md 삭제
- 최종 git commit

### Definition of Done
- [ ] 모든 캐시 디렉토리가 삭제됨
- [ ] 모든 빌드 산출물이 삭제됨
- [ ] node_modules와 .venv가 삭제됨
- [ ] 빈 디렉토리가 삭제됨
- [ ] docs/ToDo.md가 삭제됨
- [ ] 단일 커밋으로 정리 완료

### Must Have
- 소스 코드는 절대 삭제하지 않음
- git history는 보존
- 삭제 후 서버가 정상 동작해야 함

### Must NOT Have (Guardrails)
- `.git` 디렉토리 삭제 금지
- `backend/`, `frontend/src/`, `desktop/` 소스 코드 삭제 금지
- `.github/workflows/` 삭제 금지
- `.agents/skills/` 삭제 금지
- `test_runtime_env.py` 삭제 금지 (유효한 테스트)
- `--dry-run`으로 미리 확인

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed.

### QA Policy
모든 삭제 작업은 PowerShell 명령으로 검증:
- `Test-Path`로 삭제 확인
- `git status --porcelain`로 깨끗한 상태 확인
- 삭제 후 Python import 검증

---

## Execution Strategy

모든 삭제 태스크는 독립적으로 실행 가능 → 순차 실행 (safe deletion 보장)

```
Wave 1 (순차 실행 - 각 삭제 독립적):
├── Task 1: Python 캐시 디렉토리 삭제
├── Task 2: 빌드 산출물 삭제
├── Task 3: node_modules 및 .venv 삭제
├── Task 4: 빈 디렉토리 삭제
├── Task 5: test-results 삭제
├── Task 6: docs/ToDo.md 삭제
└── Task 7: 최종 검증 및 git commit

Critical Path: Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7
Total freed: ~1,343 MB
```

---

## TODOs

---

## TODOs

- [x] 1. **Python 캐시 디렉토리 삭제**

  **What to do**:
  - `__pycache__/` 디렉토리 삭제 (현재 디렉토리 및 하위 모든 위치)
  - `.pytest_cache/` 디렉토리 삭제
  - `.ruff_cache/` 디렉토리 삭제
  - 삭제 전 `--dry-run`으로 확인

  **Must NOT do**:
  - `.git/` 내부 캐시 삭제 금지
  - 소스 코드 파일 삭제 금지

  **References**:
  - `__pycache__/`: Python 바이트코드 캐시 (자동 생성, 재생성 가능)
  - `.pytest_cache/`: Pytest 실행 캐시
  - `.ruff_cache/`: Ruff linter 캐시

  **Acceptance Criteria**:
  - [ ] `Get-ChildItem -Recurse -Directory "__pycache__"` 결과 없음
  - [ ] `Get-ChildItem -Directory ".pytest_cache"` 결과 없음
  - [ ] `Get-ChildItem -Directory ".ruff_cache"` 결과 없음

  **QA Scenarios**:
  ```
  Scenario: Python 캐시 디렉토리가 삭제되었는지 확인
    Tool: Bash (PowerShell)
    Preconditions: 캐시 디렉토리가 존재함
    Steps:
      1. Get-ChildItem -Recurse -Directory "__pycache__" 실행
      2. 결과가 비어있는지 확인
      3. Get-ChildItem -Directory ".pytest_cache" 실행
      4. 결과가 비어있는지 확인
      5. Get-ChildItem -Directory ".ruff_cache" 실행
      6. 결과가 비어있는지 확인
    Expected Result: 모든 명령에서 디렉토리 목록이 비어있음
    Evidence: .sisyphus/evidence/task-1-cache-verification.txt
  ```

  **Commit**: YES
  - Files: 캐시 디렉토리들

- [x] 2. **빌드 산출물 삭제**

  **What to do**:
  - `build/` 디렉토리 삭제 (PyInstaller 출력)
  - `dist/` 디렉토리 삭제 (Python 실행파일)
  - `desktop-dist/` 디렉토리 삭제 (Electron 앱)
  - `release/` 디렉토리 삭제 (배포 아카이브)

  **Must NOT do**:
  - 소스 코드 삭제 금지
  - `.github/` 디렉토리 삭제 금지

  **References**:
  - `build/`: ~34.63 MB
  - `dist/`: ~25.14 MB
  - `desktop-dist/`: ~368.36 MB
  - `release/`: ~160.63 MB

  **Acceptance Criteria**:
  - [ ] `Test-Path "build"` → $false
  - [ ] `Test-Path "dist"` → $false
  - [ ] `Test-Path "desktop-dist"` → $false
  - [ ] `Test-Path "release"` → $false

  **QA Scenarios**:
  ```
  Scenario: 빌드 산출물이 삭제되었는지 확인
    Tool: Bash (PowerShell)
    Preconditions: 빌드 디렉토리가 존재함
    Steps:
      1. Test-Path "build" 실행 → $false 확인
      2. Test-Path "dist" 실행 → $false 확인
      3. Test-Path "desktop-dist" 실행 → $false 확인
      4. Test-Path "release" 실행 → $false 확인
    Expected Result: 모든 Test-Path가 $false 반환
    Evidence: .sisyphus/evidence/task-2-build-verification.txt
  ```

  **Commit**: YES
  - Files: 빌드 디렉토리들

- [x] 3. **node_modules 및 .venv 삭제**

  **What to do**:
  - `node_modules/` 디렉토리 삭제 (root, ~670 MB)
  - `frontend/node_modules/` 디렉토리 삭제 (~0.07 MB)
  - `.venv/` 디렉토리 삭제 (~84 MB)

  **Must NOT do**:
  - `package.json` 삭제 금지 ( Regeneration 필수)
  - `requirements.txt` 삭제 금지

  **References**:
  - `node_modules/`: npm 패키지 ( Regeneration: `npm install`)
  - `frontend/node_modules/`: 프론트엔드 npm 패키지
  - `.venv/`: Python 가상환경 ( Regeneration: `python -m venv .venv`)

  **Acceptance Criteria**:
  - [ ] `Test-Path "node_modules"` → $false
  - [ ] `Test-Path "frontend/node_modules"` → $false
  - [ ] `Test-Path ".venv"` → $false

  **QA Scenarios**:
  ```
  Scenario: node_modules와 .venv가 삭제되었는지 확인
    Tool: Bash (PowerShell)
    Preconditions: 종속성 디렉토리가 존재함
    Steps:
      1. Test-Path "node_modules" 실행 → $false 확인
      2. Test-Path "frontend/node_modules" 실행 → $false 확인
      3. Test-Path ".venv" 실행 → $false 확인
    Expected Result: 모든 Test-Path가 $false 반환
    Evidence: .sisyphus/evidence/task-3-deps-verification.txt
  ```

  **Commit**: YES
  - Files: 종속성 디렉토리들

- [x] 4. **빈 디렉토리 삭제**

  **What to do**:
  - `.cursor/` 디렉토리 삭제 (빈 디렉토리)
  - `.playwright/` 디렉토리 삭제 (빈 디렉토리)
  - `backend/routes/` 디렉토리 삭제 (内容 없음, __pycache__만 있음)
  - `desktop-build-resources/` 디렉토리 삭제 (빈 디렉토리)

  **Must NOT do**:
  - 비어있지 않은 디렉토리 삭제 금지
  - 소스 코드 디렉토리 삭제 금지

  **References**:
  - `.cursor/`: Cursor IDE 설정 (비어있음)
  - `.playwright/`: Playwright 설정 (비어있음)
  - `backend/routes/`: 라우트 파일 없음 (routes는 main.py에 정의)
  - `desktop-build-resources/`: 빌드 리소스 없음

  **Acceptance Criteria**:
  - [ ] `Test-Path ".cursor"` → $false
  - [ ] `Test-Path ".playwright"` → $false
  - [ ] `Test-Path "backend/routes"` → $false
  - [ ] `Test-Path "desktop-build-resources"` → $false

  **QA Scenarios**:
  ```
  Scenario: 빈 디렉토리가 삭제되었는지 확인
    Tool: Bash (PowerShell)
    Preconditions: 빈 디렉토리가 존재함
    Steps:
      1. Test-Path ".cursor" 실행 → $false 확인
      2. Test-Path ".playwright" 실행 → $false 확인
      3. Test-Path "backend/routes" 실행 → $false 확인
      4. Test-Path "desktop-build-resources" 실행 → $false 확인
    Expected Result: 모든 Test-Path가 $false 반환
    Evidence: .sisyphus/evidence/task-4-empty-dirs-verification.txt
  ```

  **Commit**: YES
  - Files: 빈 디렉토리들

- [x] 5. **test-results 디렉토리 삭제**

  **What to do**:
  - `test-results/` 디렉토리 삭제

  **References**:
  - `test-results/`: 테스트 실행 결과 ( Regeneration 가능)

  **Acceptance Criteria**:
  - [ ] `Test-Path "test-results"` → $false

  **QA Scenarios**:
  ```
  Scenario: test-results가 삭제되었는지 확인
    Tool: Bash (PowerShell)
    Preconditions: test-results 디렉토리가 존재함
    Steps:
      1. Test-Path "test-results" 실행 → $false 확인
    Expected Result: Test-Path가 $false 반환
    Evidence: .sisyphus/evidence/task-5-test-results-verification.txt
  ```

  **Commit**: YES
  - Files: test-results/

- [x] 6. **docs/ToDo.md 삭제**

  **What to do**:
  - `docs/ToDo.md` 파일 삭제 (오래된 TODO 목록)

  **References**:
  - `docs/ToDo.md`: 222줄의 오래된 TODO 목록

  **Acceptance Criteria**:
  - [ ] `Test-Path "docs/ToDo.md"` → $false
  - [ ] `docs/` 디렉토리 내 다른 .md 파일은 유지됨

  **QA Scenarios**:
  ```
  Scenario: docs/ToDo.md가 삭제되었는지 확인
    Tool: Bash (PowerShell)
    Preconditions: docs/ToDo.md 파일이 존재함
    Steps:
      1. Test-Path "docs/ToDo.md" 실행 → $false 확인
      2. Get-ChildItem "docs/*.md"로 다른 문서 파일 확인
    Expected Result: ToDo.md만 삭제되고 다른 문서는 유지
    Evidence: .sisyphus/evidence/task-6-todo-verification.txt
  ```

  **Commit**: YES
  - Files: docs/ToDo.md

- [ ] 7. **최종 검증 및 git commit**

  **What to do**:
  - 모든 삭제 작업 검증
  - Python import 테스트 (회귀 확인)
  - git status 확인
  - 단일 커밋 생성

  **References**:
  - 검증 명령어: `git status --porcelain`
  - 회귀 확인: `cd backend && python -c "import remote_code_server"`

  **Acceptance Criteria**:
  - [ ] `git status --porcelain` 출력 없음 (깨끗한 상태)
  - [ ] Python import 성공
  - [ ] git log에 정리 커밋 1개 확인

  **QA Scenarios**:
  ```
  Scenario: 최종 git 상태 확인
    Tool: Bash
    Preconditions: 모든 삭제 작업 완료
    Steps:
      1. git status --porcelain 실행
      2. 출력为空 확인
      3. cd backend && python -c "import remote_code_server" 실행
      4. 성공 확인
      5. git log -1 --oneline 실행
    Expected Result: 깨끗한 git 상태, import 성공, 커밋 존재
    Evidence: .sisyphus/evidence/task-7-final-verification.txt
  ```

  **Commit**: YES
  - Message: `cleanup: remove build artifacts, caches, and development dependencies`

---

## Final Verification Wave

- [ ] F1. **Plan Compliance Audit** — `oracle`

  Read the plan end-to-end. For each "Must Have": verify all cache dirs deleted, all build dirs deleted, node_modules/.venv deleted, empty dirs deleted, docs/ToDo.md deleted. For each "Must NOT Have": verify source code directories exist (`backend/`, `frontend/src/`, `desktop/`, `tests/`), verify `.git/` exists, verify `.github/workflows/` exists.
  Output: `Must Have [7/7] | Must NOT Have [5/5] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Deletion Verification** — `unspecified-high`

  Execute ALL verification commands from task acceptance criteria. Verify each directory/file was actually deleted using `Test-Path` commands. Check all evidence files exist in `.sisyphus/evidence/`.
  Output: `Cache [PASS/FAIL] | Build [PASS/FAIL] | Deps [PASS/FAIL] | Empty [PASS/FAIL] | TestResults [PASS/FAIL] | ToDo [PASS/FAIL] | VERDICT`

- [ ] F3. **No Regression** — `unspecified-high`

  Start from clean state (after deletions). Verify:
  1. `cd backend && python -c "import remote_code_server"` → 성공
  2. `cd frontend && npm run dev` 또는 `npm run build` → 성공
  Output: `Backend import [PASS/FAIL] | Frontend build [PASS/FAIL] | VERDICT`

- [ ] F4. **Git Commit Verification** — `quick`

  Verify single cleanup commit was created:
  1. `git log -1 --format='%s'` → cleanup message
  2. `git log -1 --stat` → shows deleted files
  Output: `Commit [EXISTS/MISSING] | Files [N] | VERDICT`

---

## Commit Strategy

```
type: cleanup
scope: global
message: cleanup: remove build artifacts, caches, and development dependencies

Files deleted:
- Cache: __pycache__/, .pytest_cache/, .ruff_cache/
- Build: build/, dist/, desktop-dist/, release/
- Deps: node_modules/, .venv/
- Empty dirs: .cursor/, .playwright/, backend/routes/
- Artifacts: test-results/
- Docs: docs/ToDo.md

Total freed: ~1,343 MB
```

---

## Success Criteria

### Verification Commands
```powershell
# 캐시 삭제 확인
Get-ChildItem -Recurse -Directory "__pycache__", ".pytest_cache", ".ruff_cache" | Should -BeNullOrEmpty

# 빌드 디렉토리 삭제 확인
Get-ChildItem -Directory "build", "dist", "desktop-dist", "release" | Should -BeNullOrEmpty

# node_modules/.venv 삭제 확인
Test-Path "node_modules" | Should -Be $false
Test-Path ".venv" | Should -Be $false

# docs/ToDo.md 삭제 확인
Test-Path "docs/ToDo.md" | Should -Be $false

# git status 확인
git status --porcelain | Should -BeNullOrEmpty
```

### Final Checklist
- [ ] 모든 캐시 디렉토리 삭제됨
- [ ] 모든 빌드 산출물 삭제됨
- [ ] node_modules/.venv 삭제됨
- [ ] 빈 디렉토리 삭제됨
- [ ] docs/ToDo.md 삭제됨
- [ ] 단일 커밋 생성됨
- [ ] 회귀 없음 (서버 동작 확인)
