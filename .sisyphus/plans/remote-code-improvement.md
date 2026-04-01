# Remote Code Improvement Plan

## TL;DR

> **Quick Summary**: Remote Code 프로젝트의 보안漏洞(P0), 빌드 실패, Python type 오류, 코드 품질 문제, 테스트 coverage 부족을 개선합니다.
> 
> **Deliverables**:
> - P0 보안 이슈 3개 수정 (OpenCode Web 인증, 경로 검증, 빌드 실패)
> - Python 백엔드 type 오류 수정 및 God File 리팩토링
> - Electron desktop 코드 품질 개선
> - 테스트 infrastructure 보강
> 
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 여러 wave로 분리
> **Critical Path**: P0 보안 → Type/BUILD → Refactoring → Tests

---

## Context

### Original Request
프로젝트 분석 후 개선이 필요한 사항을 찾아 플랜을 작성해달라는 요청.
- 개선 가능한 사항, 리팩토링할 사항, UX개선 필요 사항, 수정이 필요한 사항

### Interview Summary
**User Decisions**:
- P0 보안 이슈 2개(인증 우회, 경로 검증)와 빌드 실패 모두 즉시 수정
- 전체 범위 (Python 백엔드 + Electron desktop + React frontend)
- Python type 오류 수정 필요
- 테스트 coverage 확대 필요 (확인 후 결정)

### Research Findings Summary

| Area | Critical Issues | Medium Issues |
|------|----------------|---------------|
| Python Backend | Dead code (session_manager.py:539-602), God File (main.py:2142줄) | Global state, path traversal risk, no DB pooling |
| Electron Desktop | URL validation missing, no exception handlers | registerIpc monster (148줄), state.cjs I/O errors |
| Test Infrastructure | 62% backend untested, 64% frontend untested | Broken test (test_runtime_env.py), no e2e |
| Existing ToDo (docs/ToDo.md) | P0: auth bypass, path validation, build failure | P1-P3: UX improvements |

### Metis Review (Internal Gap Analysis)
**Identified Gaps Addressed**:
- 기존 docs/ToDo.md의 P0-P3 목록을 기반으로 하되, 새로운 분석 결과로 보강
- Python type 오류는 LSP diagnostics 기반으로 구체화
- Electron desktop issues는 코드 분석 기반으로 구체화

---

## Work Objectives

### Core Objective
Remote Code 프로젝트의 안정성, 보안성, 유지보수성을 향상시키기 위한 체계적 개선

### Concrete Deliverables
- [ ] `backend/main.py` - OpenCode Web 프록시 인증 추가, 경로 검증 강화
- [ ] `frontend/src/components/GitPanel.tsx` - 빌드 실패 수정 (prop 누락)
- [ ] `backend/session_manager.py` - Dead code 제거 (lines 539-602)
- [ ] `backend/*.py` - LSP type 오류 수정
- [ ] `backend/main.py` - route modules로 분리 (God File 리팩토링)
- [ ] `desktop/window-manager.cjs` - registerIpc 분리
- [ ] `desktop/state.cjs` - file I/O error handling 추가
- [ ] `tests/test_runtime_env.py` - broken import 수정
- [ ] `tests/test_auth.py` - auth 모듈 테스트 추가

### Definition of Done
- [ ] `npm run build` (frontend) 성공
- [ ] P0 보안漏洞 2개 수정됨
- [ ] Python LSP errors 0개
- [ ] `pytest` 모든 테스트 통과

### Must Have
- P0 보안 이슈 3개 (인증 우회, 경로 검증, 빌드 실패)
- Python type accuracy 향상
- Dead code 제거
- God File 분해

### Must NOT Have (Guardrails)
- API 동작 방식 변경 (기능 추가 아님)
- UI外观 변경 (리팩토링 범위 밖)
- 테스트가 없는 새로운 코드 추가
- Breaking changes (하위 호환성 유지)

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES
- **Automated tests**: pytest (backend) + Vitest (frontend) + Playwright (e2e - 미구현)
- **Framework**: pytest + Vitest
- **Strategy**: Fix broken tests first, then add critical missing tests

### QA Policy
Every task includes agent-executed QA scenarios. Evidence saved to `.sisyphus/evidence/`.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (P0 - Immediate Security & Build):
├── Task 1: OpenCode Web 프록시 인증 추가 (P0-보안)
├── Task 2: 파일 rename/delete 경로 검증 강화 (P0-보안)
├── Task 3: GitPanel.tsx 빌드 실패 수정 (P0-빌드)
├── Task 4: session_manager.py dead code 제거
└── Task 5: Python type errors 분석 및 수정 plan 수립

Wave 2 (Type Errors Fix - Python Backend):
├── Task 6: backend/*.py LSP type errors 수정
└── Task 7: Verify: pytest passes, tsc passes

Wave 3 (Refactoring - God File Decomposition):
├── Task 8: backend/routes/ 구조 생성 및 main.py 분리
├── Task 9: desktop/window-manager.cjs registerIpc 분리
├── Task 10: desktop/state.cjs file I/O error handling
└── Task 11: Verify: 기능동일성 확인

Wave 4 (Test Infrastructure):
├── Task 12: test_runtime_env.py broken import 수정
├── Task 13: auth.py 테스트 추가
├── Task 14: Verify: pytest all pass

Wave FINAL (4 parallel reviews):
├── Task F1: Plan compliance audit
├── Task F2: Code quality review
├── Task F3: Real manual QA
└── Task F4: Scope fidelity check
```

### Dependency Matrix

| Task | Depends On | Blocks |
|------|-----------|--------|
| 1. OpenCode Web auth | - | 2, 7 |
| 2. Path validation | - | 7 |
| 3. GitPanel fix | - | 7 |
| 4. Dead code removal | - | 7 |
| 5. Type analysis | - | 6 |
| 6. Type error fixes | 5 | 7 |
| 7. Verify (Wave 2) | 1, 2, 3, 4, 6 | 8, 9, 10, 11 |
| 8. main.py split | 7 | 11 |
| 9. registerIpc split | 7 | 11 |
| 10. state.cjs errors | 7 | 11 |
| 11. Verify (Wave 3) | 8, 9, 10 | 12, 13, 14 |
| 12. Fix test import | 11 | 14 |
| 13. Add auth tests | 11 | 14 |
| 14. Verify tests | 12, 13 | F1, F2, F3, F4 |

---

## TODOs

---

## TODOs

- [ ] 1. **P0-보안: OpenCode Web 프록시 endpoint 생성 + 인증 추가**

  **What to do**:
  - 먼저 `backend/main.py`에서 `/api/opencode-web/proxy` 엔드포인트是否存在 확인
  - If not exists: `opencode_web_proxy()` 함수 생성 (docs/backend-api.md:931-948 참조)
  - If exists: 해당 함수에 `Depends(get_current_user)` 인증 추가
  - 프록시로 전달하는 헤더에서 인증 토큰和不필요한 헤더 제거
  - 로그인 없이 `/api/opencode-web/proxy` 접근 시 401 또는 403 반환 확인

  **Must NOT do**:
  - 기존 프록시 동작 방식 변경하지 않기
  - 내부 서비스 포트 하드코딩 추가하지 않기
  - API docs에 없는 새로운 endpoint 추가하지 않기

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 보안 관련 수정으로 주의 깊은 작업 필요
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4, 5)
  - **Blocks**: Task 7
  - **Blocked By**: None

  **References**:
  - `backend/main.py` - `opencode_web_proxy()` 함수 위치 (grep으로 검색하여 확인)
  - `docs/backend-api.md:931-948` - API仕樣 참고
  - `backend/auth.py:41-61` - `get_current_user` dependency 사용 예시
  - `docs/ToDo.md:15-23` - 기존 P0 보안 항목 참고

  **Acceptance Criteria**:
  - [ ] `grep -n "opencode_web_proxy\|/api/opencode-web" backend/main.py` → endpoint 확인
  - [ ] 해당 endpoint에 인증 추가됨
  - [ ] 인증 없이 접근 시 401 응답

  **QA Scenarios**:
  ```
  Scenario: OpenCode Web proxy requires authentication
    Tool: Bash (curl)
    Preconditions: 백엔드 실행 중, 로그인 토큰 없음
    Steps:
      1. curl -X GET http://localhost:8080/api/opencode-web/proxy?path=/
      2. curl -v -X GET -H "Authorization: Bearer <token>" http://localhost:8080/api/opencode-web/proxy?path=/
    Expected Result: 첫 번째 요청은 401 Unauthorized, 두 번째 요청은 프록시 응답
    Failure Indicators: 인증 없이 접근 가능하면 보안漏洞
    Evidence: .sisyphus/evidence/task-1-auth-check.txt
  ```

  **Commit**: YES
  - Message: `fix(security): add auth to OpenCode Web proxy endpoint`
  - Files: `backend/main.py`
  - Pre-commit: `pytest tests/ -v`

---

- [ ] 2. **P0-보안: 파일 rename/delete 경로 검증 강화**

  **What to do**:
  - `backend/main.py`의 `rename`과 `delete` API에서 `oldName`, `newName`, `name` 모두 검증
  - 절대 경로화 후 대상이 부모 디렉터리 하위에 있는지 `_is_within_root`로 확인
  - `..`, `/\`, `\\` 등 경로 구분자 포함한 입력은 거부

  **Must NOT do**:
  - `newName`만 검증하던 기존 로직 제거 (이미 있는 검증 유지)
  - 정상적인 같은 폴더 내 rename/delete 동작 변경

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 보안 관련 수정이므로 주의 필요
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4, 5)
  - **Blocks**: Task 7
  - **Blocked By**: None

  **References**:
  - `backend/main.py` - `_is_within_root` 함수 (lines 216-222)
  - `backend/main.py` - `rename` API endpoint (line ~802, `grep -n "rename" backend/main.py`로 확인)
  - `backend/main.py` - `delete` API endpoint (line ~834, `grep -n "delete" backend/main.py`로 확인)
  - `docs/ToDo.md:25-33` - 기존 P0 경로 검증 항목 참고

  **Acceptance Criteria**:
  - [ ] `grep -n "def.*rename\|def.*delete" backend/main.py` → 함수 목록
  - [ ] 모든 rename/delete API에서 oldName, newName, name 검증 추가
  - [ ] `../`, `..\\`, 절대 경로 입력 시 400 Bad Request

  **QA Scenarios**:
  ```
  Scenario: Path traversal attempt in rename is blocked
    Tool: Bash (curl)
    Preconditions: 로그인된 상태
    Steps:
      1. curl -X POST -H "Cookie: remote_code_session=<token>" http://localhost:8080/api/files/rename -d '{"oldName":"../secret.txt","newName":"hacked.txt"}'
    Expected Result: 400 Bad Request with validation error
    Failure Indicators: 파일이 rename되면 보안漏洞
    Evidence: .sisyphus/evidence/task-2-path-traversal-blocked.txt

  Scenario: Normal rename still works
    Tool: Bash (curl)
    Preconditions: 로그인된 상태, 테스트 파일 존재
    Steps:
      1. Create test file via upload API
      2. Rename within same directory
    Expected Result: 200 OK with renamed file
    Failure Indicators: 정상 rename 실패
    Evidence: .sisyphus/evidence/task-2-normal-rename-works.txt
  ```

  **Commit**: YES
  - Message: `fix(security): validate all path parameters in rename/delete APIs`
  - Files: `backend/main.py`

---

- [ ] 3. **P0-빌드: GitPanel.tsx 빌드 실패 수정**

  **What to do**:
  - `frontend/src/components/GitPanel.tsx`에서 `gitFontSize`, `onFontSizeChange` prop 누락 문제 해결
  - Git 저장소가 아닐 때와 초기 로딩 상태의 렌더 경로에서 prop 전달 확인
  - `npm run build` 성공 확인

  **Must NOT do**:
  - prop 타입 완화만으로 끝내지 않기 (UI 동작도 일관되게)
  - GitPanel 외 다른 컴포넌트 수정하지 않기

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: React 컴포넌트와 빌드 관련 작업
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4, 5)
  - **Blocks**: Task 7
  - **Blocked By**: None

  **References**:
  - `frontend/src/components/GitPanel.tsx` - 문제의 컴포넌트
  - `frontend/src/components/PanelHeader.tsx` - prop 정의 확인
  - `docs/ToDo.md:35-43` - 기존 P0 빌드 실패 항목 참고

  **Acceptance Criteria**:
  - [ ] `cd frontend && npm run build` 성공 (exit code 0)
  - [ ] Git 저장소 아닌 경로에서 GitPanel 렌더링 확인
  - [ ] 로딩 중 상태에서 GitPanel 렌더링 확인

  **QA Scenarios**:
  ```
  Scenario: Frontend build succeeds
    Tool: Bash
    Preconditions: 없음
    Steps:
      1. cd frontend && npm run build
    Expected Result: 빌드 성공, dist/ 디렉토리 생성
    Failure Indicators: 빌드 실패 시 에러 메시지
    Evidence: .sisyphus/evidence/task-3-build-success.txt

  Scenario: GitPanel renders without git repo
    Tool: Playwright
    Preconditions: Frontend dev server 실행 중
    Steps:
      1. Navigate to app
      2. Create project with non-git folder
      3. Open GitPanel
    Expected Result: 에러 없이 렌더링
    Failure Indicators: prop 관련 warning/error
    Evidence: .sisyphus/evidence/task-3-gitpanel-no-repo.png
  ```

  **Commit**: YES
  - Message: `fix(frontend): add missing props to GitPanel for non-git and loading states`
  - Files: `frontend/src/components/GitPanel.tsx`

---

- [ ] 4. **Dead code 제거: session_manager.py lines 539-602**

  **What to do**:
  - `backend/session_manager.py`의 `resume_session` 메서드에서 line 537 이후의 unreachable code 제거
  - lines 539-602가 `return` 문 이후에 있어 실행되지 않음을 확인 후 삭제

  **Must NOT do**:
  - 정상 실행 코드인 lines 1-536 수정하지 않기
  - 주석만 있는 코드도 지우지 않기 (actual dead code만)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 단순 dead code 삭제
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3, 5)
  - **Blocks**: Task 7
  - **Blocked By**: None

  **References**:
  - `backend/session_manager.py:536-602` - dead code 블록
  - Line 537에 `return await db_get_session(session_id)` 이후 모든 код 영원히 실행 안 됨

  **Acceptance Criteria**:
  - [ ] `grep -n "return await db_get_session" backend/session_manager.py` → return 위치 확인
  - [ ] return 이후 코드 삭제됨
  - [ ] `pytest tests/test_project_layout_persistence.py -v` 통과

  **QA Scenarios**:
  ```
  Scenario: session_manager.py has no unreachable code after line 537
    Tool: Bash
    Preconditions: 없음
    Steps:
      1. Read backend/session_manager.py around line 537
      2. Verify no code exists after return statement
    Expected Result: return 이후 코드 없음
    Failure Indicators: 여전히 dead code 존재
    Evidence: .sisyphus/evidence/task-4-dead-code-removed.py

  Scenario: Session resume still works after dead code removal
    Tool: Bash
    Preconditions: 테스트 환경
    Steps:
      1. pytest tests/test_project_layout_persistence.py::test_session_resume -v
    Expected Result: 테스트 통과
    Failure Indicators: 테스트 실패
    Evidence: .sisyphus/evidence/task-4-resume-test.txt
  ```

  **Commit**: YES
  - Message: `refactor(backend): remove dead code in session_manager.py resume_session`
  - Files: `backend/session_manager.py`

---

- [ ] 5. **Python type errors 분석 및 수정 plan 수립**

  **What to do**:
  - LSP diagnostics로 확인된 type 오류들을 분석
  - `possibly unbound`, type mismatch, `None` not subscriptable等问题 분류
  - 각 오류별 수정方案 수립 (단순 오류는 바로 수정, 복잡한 것은 별도 task로)

  **Must NOT do**:
  - 모든 오류를 한 번에 수정하려고 하기
  - 동작 변경 없이 type만 변경하는 안전한 수정優先

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Type system 분석 필요
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3, 4)
  - **Blocks**: Task 6
  - **Blocked By**: None

  **References**:
  - `backend/main.py` - LSP diagnostics 실행하여 actual errors 확인
  - `backend/session_manager.py` - LSP diagnostics 실행하여 actual errors 확인
  - `backend/database.py` - LSP diagnostics 실행하여 actual errors 확인
  - `backend/pty_manager.py` - LSP diagnostics 실행하여 actual errors 확인
  - Note: Specific line numbers cannot be pre-verified; executor가 실제 LSP output 기반 수정

  **Acceptance Criteria**:
  - [ ] 모든 type 오류 분류됨
  - [ ] 수정 가능한 것들은 Task 6에서 수정할 plan 수립

  **QA Scenarios**:
  ```
  Scenario: Type errors cataloged and categorized
    Tool: Bash
    Preconditions: 없음
    Steps:
      1. lsp_diagnostics on all backend/*.py files
      2. Categorize errors by severity and complexity
    Expected Result: 명확한 분류와 수정 plan
    Failure Indicators: 분류 불완전
    Evidence: .sisyphus/evidence/task-5-type-analysis.md
  ```

  **Commit**: NO

---

- [ ] 6. **Python type errors 수정**

  **What to do**:
  - Task 5에서 수립한 plan에 따라 type 오류 수정
  - 주요 수정 유형:
    - `possibly unbound` 변수 → 초기화 또는 early return 추가
    - `dict | None` return type → `Optional[dict]`로 변경
    - `None not subscriptable` → None check 추가
    - `spawn args type errors` → 올바른 type으로 캐스팅
  - 실제 LSP diagnostics 결과 기반 수정

  **Must NOT do**:
  - 동작 변경 (type만 수정, logic 변화 없도록)
  - 새로운 type 오류 유발

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Python type annotation 작업
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (Task 5에 의존)
  - **Parallel Group**: Sequential
  - **Blocks**: Task 7
  - **Blocked By**: Task 5

  **References**:
  - Task 5의 분석 결과
  - `lsp_diagnostics` on `backend/*.py` - actual errors 기반 수정

  **Acceptance Criteria**:
  - [ ] LSP diagnostics에서 type error 0개
  - [ ] 모든 테스트 여전히 통과

  **QA Scenarios**:
  ```
  Scenario: All Python type errors resolved
    Tool: Bash
    Preconditions: 없음
    Steps:
      1. lsp_diagnostics on backend/*.py (severity: error)
    Expected Result: 0 errors
    Failure Indicators: 여전히 type error 존재
    Evidence: .sisyphus/evidence/task-6-lsp-clean.txt

  Scenario: Tests still pass after type fixes
    Tool: Bash
    Preconditions: 없음
    Steps:
      1. pytest tests/ -v
    Expected Result: All tests pass
    Failure Indicators: 테스트 실패
    Evidence: .sisyphus/evidence/task-6-tests-pass.txt
  ```

  **Commit**: YES
  - Message: `fix(types): resolve LSP type errors in backend modules`
  - Files: `backend/main.py`, `backend/session_manager.py`, `backend/database.py`, `backend/pty_manager.py`

---

- [ ] 7. **Wave 1 & 2 Verification: Build & Tests**

  **What to do**:
  - `npm run build` (frontend) 성공 확인
  - `pytest tests/ -v` 모든 테스트 통과 확인
  - LSP diagnostics error 0개 확인
  - P0 수정 사항 동작 확인

  **Must NOT do**:
  - 새로운 기능 추가
  - 문제 해결을 위한 임시 workaround

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 검증 작업
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (Tasks 1-6 완료 필요)
  - **Blocks**: Tasks 8, 9, 10, 11
  - **Blocked By**: Tasks 1, 2, 3, 4, 6

  **References**:
  - 각 task의 acceptance criteria

  **Acceptance Criteria**:
  - [ ] `cd frontend && npm run build` 성공
  - [ ] `pytest tests/ -v` 모두 통과
  - [ ] LSP error 0개
  - [ ] OpenCode Web proxy 인증 동작 확인
  - [ ] 경로 검증 동작 확인

  **QA Scenarios**:
  ```
  Scenario: All Wave 1 & 2 verification checks pass
    Tool: Bash
    Preconditions: Tasks 1-6 완료
    Steps:
      1. cd frontend && npm run build
      2. pytest tests/ -v
      3. LSP diagnostics check
    Expected Result: 모두 성공
    Failure Indicators:任何一个 검증 실패
    Evidence: .sisyphus/evidence/task-7-verification.txt
  ```

  **Commit**: NO

---

- [ ] 8. **Refactoring: backend/routes/ 구조 생성 및 main.py 분리**

  **What to do**:
  - `backend/routes/` 디렉토리 생성
  - `main.py` (2142줄) 을以下の route modules로 분리:
    - `routes/auth.py` - /api/auth/* 엔드포인트
    - `routes/sessions.py` - /api/sessions/* 엔드포인트
    - `routes/projects.py` - /api/projects/* 엔드포인트
    - `routes/files.py` - /api/files/*, /api/browse/* 엔드포인트
    - `routes/git.py` - /api/git/* 엔드포인트
    - `routes/ide.py` - /api/ide/* 엔드포인트
  - 각 route module에 해당 Pydantic models也别도 이동
  - `main.py`는 route registration만 담당하도록简化

  **Must NOT do**:
  - API 동작 방식 변경하지 않기
  - 기능 추가하지 않기
  - route URL 변경하지 않기

  **Recommended Agent Profile**:
  - **Category**: `ultrabrain`
    - Reason: 대규모 리팩토링, 주의深い plan 필요
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 3, Task 7 완료 후)
  - **Parallel Group**: Wave 3 (with Tasks 9, 10)
  - **Blocks**: Task 11
  - **Blocked By**: Task 7

  **References**:
  - `backend/main.py` - 현재 모든 endpoint가 이 파일에 2142줄
  - `backend/session_manager.py` - business logic (이동 안 함)
  - `backend/database.py` - data layer (이동 안 함)

  **Acceptance Criteria**:
  - [ ] `backend/routes/` 디렉토리 생성됨
  - [ ] `main.py` 500줄 이하로 축소
  - [ ] 모든 API endpoint 동작 동일
  - [ ] `pytest tests/ -v` 모두 통과

  **QA Scenarios**:
  ```
  Scenario: API endpoints work after main.py refactoring
    Tool: Bash
    Preconditions: Task 8 완료
    Steps:
      1. Start backend
      2. Login and test all major API endpoints
      3. Compare responses with baseline
    Expected Result: 모든 endpoint 동작 동일
    Failure Indicators: endpoint 동작 변경
    Evidence: .sisyphus/evidence/task-8-api-unchanged.txt
  ```

  **Commit**: YES
  - Message: `refactor(backend): split main.py into route modules`
  - Files: `backend/main.py`, `backend/routes/*.py`, `backend/models/*.py`

---

- [ ] 9. **Refactoring: window-manager.cjs registerIpc 분리**

  **What to do**:
  - `desktop/window-manager.cjs`의 `registerIpc` (148줄, lines 1086-1234)를 분리
  - 분리 대상:
    - `ipc-handlers/runtime.js` - runtime 관련 핸들러
    - `ipc-handlers/window.js` - window 관련 핸들러
    - `ipc-handlers/app.js` - app 관련 핸들러
  - 각 핸들러 파일로抽出して読み込み

  **Must NOT do**:
  - IPC channel 동작 변경하지 않기
  - preload.cjs interface 변경하지 않기

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: JavaScript 리팩토링
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 3, Task 7 완료 후)
  - **Parallel Group**: Wave 3 (with Tasks 8, 10)
  - **Blocks**: Task 11
  - **Blocked By**: Task 7

  **References**:
  - `desktop/window-manager.cjs:1086-1234` - registerIpc 함수
  - `desktop/preload.cjs` - exposed IPC channels 확인용

  **Acceptance Criteria**:
  - [ ] `desktop/ipc-handlers/` 디렉토리 생성됨
  - [ ] `registerIpc` 함수가 3개 파일로 분리됨
  - [ ] Electron app 정상 동작

  **QA Scenarios**:
  ```
  Scenario: Electron desktop works after registerIpc refactoring
    Tool: Bash
    Preconditions: Task 9 완료
    Steps:
      1. npm run desktop:start
      2. Verify window creation, tray, menus work
    Expected Result: 모든 desktop 기능 정상
    Failure Indicators: IPC 핸들러 오류
    Evidence: .sisyphus/evidence/task-9-desktop-works.txt
  ```

  **Commit**: YES
  - Message: `refactor(desktop): split registerIpc into handler modules`
  - Files: `desktop/window-manager.cjs`, `desktop/ipc-handlers/*.js`

---

- [ ] 10. **desktop/state.cjs file I/O error handling 추가**

  **What to do**:
  - `desktop/state.cjs`의 `save()` 함수에 try-catch 추가
  - `load()` 함수의 `mkdirSync` 실패 처리
  - `setPreferences()`의 fragile comparison logic 개선

  **Must NOT do**:
  - state persistence 동작 방식 변경
  - 데이터 손실 가능성 있는 수정

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 단순 error handling 추가
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 3, Task 7 완료 후)
  - **Parallel Group**: Wave 3 (with Tasks 8, 9)
  - **Blocks**: Task 11
  - **Blocked By**: Task 7

  **References**:
  - `desktop/state.cjs:136-142` - save() 함수
  - `desktop/state.cjs:119-134` - load() 함수
  - `desktop/state.cjs:148-165` - setPreferences()

  **Acceptance Criteria**:
  - [ ] save()에 try-catch 추가됨
  - [ ] load()의 mkdirSync 실패 처리됨
  - [ ] setPreferences comparison logic 개선됨

  **QA Scenarios**:
  ```
  Scenario: State persistence handles errors gracefully
    Tool: Bash
    Preconditions: Task 10 완료
    Steps:
      1. Electron app 실행
      2. State save/load operations 확인
    Expected Result: 오류 발생 시 crash 없음
    Failure Indicators: 상태 저장 실패 시 crash
    Evidence: .sisyphus/evidence/task-10-state-errors.txt
  ```

  **Commit**: YES
  - Message: `fix(desktop): add error handling to state.cjs file I/O`
  - Files: `desktop/state.cjs`

---

- [ ] 11. **Wave 3 Verification: Refactoring 품질 확인**

  **What to do**:
  - Task 8, 9, 10 수정 사항 모두 검증
  - backend: 모든 endpoint 동작 확인
  - desktop: Electron app 정상 실행 확인
  - code: LSP diagnostics clean 확인

  **Must NOT do**:
  - 새로운 기능 추가
  - 문제 해결을 위한 임시 수정

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 검증 작업
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (Tasks 8, 9, 10 완료 필요)
  - **Blocks**: Tasks 12, 13, 14
  - **Blocked By**: Tasks 8, 9, 10

  **References**:
  - Tasks 8, 9, 10의 acceptance criteria

  **Acceptance Criteria**:
  - [ ] backend: 모든 endpoint 동작 동일
  - [ ] desktop: Electron app 정상 실행
  - [ ] LSP diagnostics error 0개

  **QA Scenarios**:
  ```
  Scenario: All Wave 3 refactoring verification
    Tool: Bash
    Preconditions: Tasks 8, 9, 10 완료
    Steps:
      1. Backend API test
      2. Desktop app launch test
      3. Frontend build test
    Expected Result: 모두 성공
    Failure Indicators:任何一个 검증 실패
    Evidence: .sisyphus/evidence/task-11-verification.txt
  ```

  **Commit**: NO

---

- [ ] 12. **test_runtime_env.py broken import 수정**

  **What to do**:
  - `tests/test_runtime_env.py`의 import 에러 해결
  - `load_env_defaults` 함수가 `remote_code_launcher`에不存在 → 해당 함수 직접 구현 또는 import 경로修正
  - pytest가 테스트를発見하고 실행할 수 있도록 수정

  **Must NOT do**:
  - 실제 테스트 로직 변경 (import만修正)
  - 다른 테스트 파일 수정

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 단순 import 수정
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 4, Task 11 완료 후)
  - **Parallel Group**: Wave 4 (with Task 13)
  - **Blocks**: Task 14
  - **Blocked By**: Task 11

  **References**:
  - `tests/test_runtime_env.py` - broken import
  - `remote_code_launcher.py` - 함수 존재 여부 확인

  **Acceptance Criteria**:
  - [ ] `pytest tests/test_runtime_env.py -v` 실행 가능
  - [ ] import error 없이 테스트 발견

  **QA Scenarios**:
  ```
  Scenario: test_runtime_env.py import error fixed
    Tool: Bash
    Preconditions: Task 12 완료
    Steps:
      1. pytest tests/test_runtime_env.py -v --collect-only
    Expected Result: 테스트 발견됨 (import error 없음)
    Failure Indicators: ImportError
    Evidence: .sisyphus/evidence/task-12-import-fixed.txt
  ```

  **Commit**: YES
  - Message: `fix(tests): resolve import error in test_runtime_env.py`
  - Files: `tests/test_runtime_env.py`

---

- [ ] 13. **auth.py 테스트 추가**

  **What to do**:
  - `tests/test_auth.py` 파일 생성
  - 테스트 대상:
    - `verify_password` - password verification
    - `create_access_token` - token creation
    - `verify_token` - token validation
    - `get_current_user` - dependency
    - `verify_ws_token` - WebSocket auth
  - Happy path + error cases 모두 테스트

  **Must NOT do**:
  - auth.py 자체 수정 (테스트 추가 전용)
  - 실제 secret 사용 (mock 사용)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 테스트 작성
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 4, Task 11 완료 후)
  - **Parallel Group**: Wave 4 (with Task 12)
  - **Blocks**: Task 14
  - **Blocked By**: Task 11

  **References**:
  - `backend/auth.py` - 테스트 대상 코드
  - `tests/test_project_layouts.py` - 테스트 패턴 참고

  **Acceptance Criteria**:
  - [ ] `tests/test_auth.py` 생성됨
  - [ ] `pytest tests/test_auth.py -v` 모두 통과
  - [ ] coverage 80% 이상

  **QA Scenarios**:
  ```
  Scenario: Auth module has comprehensive tests
    Tool: Bash
    Preconditions: Task 13 완료
    Steps:
      1. pytest tests/test_auth.py -v
      2. pytest tests/test_auth.py --cov=backend/auth --cov-report=term
    Expected Result: 모든 테스트 통과, coverage 80%+
    Failure Indicators: 테스트 실패 또는 coverage 부족
    Evidence: .sisyphus/evidence/task-13-auth-tests.txt
  ```

  **Commit**: YES
  - Message: `test(auth): add comprehensive tests for auth module`
  - Files: `tests/test_auth.py`

---

- [ ] 14. **Wave 4 Verification: All Tests Pass**

  **What to do**:
  - `pytest tests/ -v` 모든 테스트 통과 확인
  - `cd frontend && npm run test` (Vitest) 실행 확인
  - 테스트 coverage 확인

  **Must NOT do**:
  - 새로운 테스트 강요
  - 실패하는 테스트 무시

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 검증 작업
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (Tasks 12, 13 완료 필요)
  - **Blocks**: Tasks F1, F2, F3, F4
  - **Blocked By**: Tasks 12, 13

  **References**:
  - Tasks 12, 13의 acceptance criteria

  **Acceptance Criteria**:
  - [ ] `pytest tests/ -v` 모두 통과
  - [ ] Frontend Vitest 모두 통과
  - [ ] 테스트 빌드 시스템 정상 동작

  **QA Scenarios**:
  ```
  Scenario: All tests pass in Wave 4
    Tool: Bash
    Preconditions: Tasks 12, 13 완료
    Steps:
      1. pytest tests/ -v
      2. cd frontend && npm run test
    Expected Result: 모든 테스트 통과
    Failure Indicators: 테스트 실패
    Evidence: .sisyphus/evidence/task-14-all-tests.txt
  ```

  **Commit**: NO

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists. For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `tsc --noEmit` + `linter` + `pytest tests/`. Review all changed files for: type errors, empty catches, console.log in prod, commented-out code, unused imports.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill if UI)
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff. Verify 1:1 — everything in spec was built, nothing beyond spec was built.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **1-4**: P0 security & build fixes
- **5**: Type analysis (no commit)
- **6**: Type error fixes
- **7**: Wave 2 verification (no commit)
- **8-10**: Refactoring
- **11**: Wave 3 verification (no commit)
- **12-13**: Test fixes
- **14**: Wave 4 verification (no commit)

---

## Success Criteria

### Verification Commands
```bash
# Frontend build
cd frontend && npm run build  # Expected: success

# Python tests
pytest tests/ -v  # Expected: all pass

# LSP diagnostics (no errors)
# Expected: 0 errors

# Type coverage
pytest tests/ --cov=backend --cov-report=term  # Expected: 80%+ coverage
```

### Final Checklist
- [ ] All P0 security issues fixed
- [ ] Frontend build succeeds
- [ ] Python type errors resolved
- [ ] Dead code removed
- [ ] God File (main.py) refactored
- [ ] Desktop registerIpc refactored
- [ ] State.cjs error handling added
- [ ] All tests pass
- [ ] No scope creep