# Changelog

## 0.1.2 - 2026-07-28

- Preserve Safari's permission gesture by creating the push subscription before
  permission analytics requests.
- Replace stale subscriptions that were created with a different VAPID key.
- Refuse to overwrite an unrelated service worker at the configured scope
  unless replacement is explicitly enabled.
- Support migration from another push provider with isolated service-worker
  paths and scopes.
- Improve cross-browser diagnostics and document Chrome, Edge, Brave, Firefox,
  Safari, and iOS/iPadOS Home Screen requirements.
