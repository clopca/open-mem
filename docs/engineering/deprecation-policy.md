# Deprecation Policy

## Lifecycle
1. Introduced
2. Deprecated (warning + replacement)
3. Removed (major version only)

## Rules
1. Every deprecated API/tool/field must include:
   - Deprecation message
   - Replacement path
   - Planned removal version
2. `/v1` remains stable unless a `/v2` is introduced.
3. Internal refactors may break internal APIs, but external changes must be explicit.
