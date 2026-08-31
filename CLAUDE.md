# CLAUDE.md

@AGENTS.md

This repository's instructions live in AGENTS.md, and the line above loads them whole into
every session: Claude Code does not read AGENTS.md on its own — its documentation says so
literally, "Claude Code reads CLAUDE.md, not AGENTS.md" — only what this file imports with
the at sign. A markdown link imports nothing; this file was exactly that bug until
28-Aug-2026. Write yours there: this one exists only for the bridge, and so that there are
never two rule files to keep in sync.
