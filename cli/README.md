# tinker CLI

Globally installable writing coach. See the [CLI section in the repo
README](../README.md#cli-tinker) for install and usage.

```bash
npm i -g ./cli
tinker login
tinker
```

Runs from any directory. Compact output for a short terminal panel:
one question line and a `>` prompt (no full-screen TUI). No exercise
commands — writing only.

Colors follow the web writing UI (truecolor when the terminal supports
it; 256/16-color fallback). Set `NO_COLOR=1` or pipe output to disable.
