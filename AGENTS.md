# Workspace Rules

## Modular File Size Discipline
- Keep existing large legacy files intact unless refactoring them is explicitly requested.
- **No newly created or extracted source file should exceed 500 lines**, and **most files should stay at ~300 lines or under**.
- When adding substantial new features or views, place new UI components, helpers, and domain modules in focused files rather than appending onto 2k-5k line monoliths.
