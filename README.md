# WiPa DB

Desktop app (Tauri + Vite, vanilla JS) built as the practical tool component
of my Bachelor's thesis. The app connects to an Obsidian vault (Markdown +
YAML frontmatter) as its database and is used to digitize, manage, and
evaluate the field research data from the WiPa project ("Zukünfte Kiosk").

## Setup

```
npm install
npm run tauri dev
```

Release build:

```
npm run tauri build
```

Installers end up under `src-tauri/target/release/bundle/`.

## Requirement

On first launch, the app needs a folder containing an Obsidian vault in the
expected structure (Projekte, Events, Personen, Screenshots, Typen,
Einstellungen/naming-rules.md, …). Without a matching vault, the individual
pages can't be used meaningfully.

## Development history

See [docs/DEVLOG.md](docs/DEVLOG.md) — a chronological log with the goal,
implementation, decisions, and dead ends for each work session.
