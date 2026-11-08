# Dependency overrides

## DOMPurify through Monaco

- Added on 2026-11-07.
- Monaco 0.57.0, the current stable release when checked, pins DOMPurify 3.4.15 exactly.
- Override Monaco's DOMPurify dependency to 3.4.17.
- A lockfile refresh cannot cross the exact parent pin. No newer stable Monaco release was available.
- Relevant advisories include [GHSA-cg2g-xh64-v4q7](https://github.com/advisories/GHSA-cg2g-xh64-v4q7) and [GHSA-mrv2-3pqr-j5jr](https://github.com/advisories/GHSA-mrv2-3pqr-j5jr).
- Remove this override when a stable Monaco release depends on DOMPurify 3.4.17 or a later patched version.

Monaco uses the sanitizer for rendered documentation and hover content. Verify suggestions, type hovers, and diagnostics when updating it.
