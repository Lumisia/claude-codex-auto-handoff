# Task 1.1 Report — Expose fingerprint basis

## Summary
Successfully implemented `projectFingerprintInfo(cwd)` to expose fingerprint basis information while preserving backward compatibility with the existing `projectFingerprint(cwd)` function.

## Changes Made

### 1. `core/lib/fingerprint.mjs`
- **Refactored** `projectFingerprint()` into two functions:
  - New `projectFingerprintInfo(cwd)` returns `{ fingerprint, basis: { type, value } }`
  - Updated `projectFingerprint(cwd)` now calls `projectFingerprintInfo()` and returns only the fingerprint string
- **Basis types preserved**: `'remote'`, `'gitroot'`, and `'path'`
- **Basis value format** unchanged: `remote:<url>`, `gitroot:<realpath>`, `path:<realpath>`
- **Error handling** improved: `realpathSync()` now only affects the resolved path, not the basis string

### 2. `tests/fingerprint.test.mjs`
- **Added import**: `projectFingerprintInfo` from fingerprint module
- **Added test**: `projectFingerprintInfo reports a path basis for a non-repo dir`
  - Creates a temp directory (non-git)
  - Verifies `info.basis.type` is `'path'`
  - Verifies `info.basis.value` starts with `'path:'`
  - Verifies `info.fingerprint` is exactly 24 characters

## Test Results

### Step 2: Initial test run (expected FAIL)
```
SyntaxError: The requested module does not provide an export named 'projectFingerprintInfo'
```
✅ Test failed as expected

### Step 4: After implementation (expected PASS)
```
✔ fingerprint is deterministic and 24 hex chars (91.1655ms)
✔ different dirs give different fingerprints (88.5642ms)
✔ projectFingerprintInfo reports a path basis for a non-repo dir (41.5433ms)
ℹ tests 3
ℹ suites 0
ℹ pass 3
ℹ fail 0
```
✅ All fingerprint tests pass

### Full test suite (regression check)
```
ℹ tests 154
ℹ suites 0
ℹ pass 153
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 3706.9343
```
✅ No regressions. All 153 tests pass (1 skipped, unchanged).

## Backward Compatibility
- Existing fingerprints remain **unchanged** because the basis string format is identical
- `projectFingerprint(cwd)` behavior is 100% compatible
- All existing tests continue to pass

## Commit
```
876e6dc refactor: expose fingerprint basis via projectFingerprintInfo
```

## Concerns
None. Implementation follows TDD steps exactly, all tests pass, no regressions detected.
