# Usage

- Workspace scan: `refactor-scout scan --scope workspace --format text`
- Package scan: `refactor-scout scan --scope package:<name> --format markdown`
- Changed files: `refactor-scout scan --scope changed --since origin/main --format json`
- Safe fixes: `refactor-scout fix --dry-run`
