# Lumior contributor conventions

Assess scope, storage compatibility and validation before implementing a feature. Preserve user data and keep substantial changes reviewable.

- Use `design-system/ui-palette.json` and shared `--ui-*` variables. Run `pnpm colors:check`. Do not add ad-hoc component colors.
- Shared menus use 12px outer radius, 8px item radius and 4px padding. Validate light and dark themes.
- Use a generic identity such as Lumior before an account system exists.
- Do not seed Game Studies in new workspaces or delete existing users' boards.
- AI calls use `lib/ai-runtime.ts`: `resolveAiAccess` and `createAiTask`. One user action has one task. Never silently switch from official service access to a personal key.
- Keep community build identities, storage and update policy separate from official releases. Contribution CI must not publish installers or use signing/model credentials.
- Follow `docs/AI-ENTRY-ACCEPTANCE.md` for AI changes. Distinguish real requests, simulations, untested cases and released behavior.
- Report tests that actually ran. Use synthetic fixtures and preserve third-party notices.
