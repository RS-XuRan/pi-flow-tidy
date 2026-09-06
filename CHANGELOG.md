# Changelog

## 0.3.1 - 2026-09-06

- Fix incomplete tool background coverage at the right edge of rendered rows.
- Delegate full-row background painting to Pi's self render shell to avoid nested ANSI background resets.
- Add regression coverage for pending and error tool rendering.

## 0.3.0 - 2026-09-06

- Add stable tool categories with distinct Unicode icons and theme-aware colors.
- Color the raw tool name and the second-line connector without changing the two-line layout.
- Preserve separate running, success, and error state markers.
- Add a generic visual fallback for unknown and future third-party tools.

## 0.2.0 - 2026-09-05

- Remove installation, migration, and documentation coupling to specific third-party tool packages.
- Keep the package focused exclusively on generic tool output rendering.

## 0.1.2 - 2026-09-05

- Fix the test command for Windows GitHub Actions runners.

## 0.1.1 - 2026-09-05

- Add one-command PowerShell and POSIX shell installers hosted directly on GitHub.
- Avoid npm git and remote package restrictions during bootstrap.

## 0.1.0 - 2026-09-05

- Initial public release.
- Add compact two-line rendering for built-in and third-party Pi tools.
- Preserve raw third-party tool names without aliases.
- Add optional reasoning summaries and elapsed time.
- Support tools registered dynamically after `session_start`.
- Add standard Pi package commands and a one-command bootstrap installer.
- Add managed wrapper backup, repair, fallback, and uninstall flows.
