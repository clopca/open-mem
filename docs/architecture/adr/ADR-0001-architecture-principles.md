# ADR-0001: Architecture Principles

- Status: Accepted
- Date: 2026-02-16
- Owners: core maintainers

## Context
open-mem is evolving into a multi-surface memory platform with MCP, HTTP, and platform adapters.
Without strict architecture principles, feature additions can create cross-layer coupling and long-term debt.

## Decision
1. Domain and contracts must be adapter-agnostic.
2. Shared schemas are the source of truth across MCP/HTTP/OpenCode tool surfaces.
3. Core orchestration should compose extension points, not embed specialized logic directly.
4. Breaking external API changes require explicit versioning and deprecation metadata.
5. Every structural change requires an ADR.

## Consequences
- Positive:
  - Easier long-term maintenance and safer refactors.
  - Less duplicated logic across transports.
- Negative:
  - More upfront design and review overhead.
  - Slightly slower short-term feature delivery.
