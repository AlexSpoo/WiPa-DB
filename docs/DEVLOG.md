# DEVLOG

## 2026-09-16 — Startseite-Grundgerüst & Tauri-Integration

**Ziel:** Minimal-Gerüst der "keine DB verbunden"-Startseite, plus Entscheidung und Einrichtung der Desktop-App-Basis.
**Umsetzung:** `src/index.html`, `src/styles.css`, `src/assets/cone.svg` (Kegel-Illustration aus `design/Logo 1.svg` übernommen). Tauri v2 via `npx tauri init` eingerichtet (`src-tauri/`), Rust-Toolchain von 1.68 auf 1.98 aktualisiert.
**Entscheidungen:** Electron vs. Tauri abgewogen — Tauri gewählt wegen geringerem Ressourcenverbrauch, akzeptierter Mehraufwand durch Rust. Frontend liegt in eigenem `src/`-Ordner statt im Projekt-Root, um Vermischung mit `src-tauri/` zu vermeiden.
**Probleme / Sackgassen:** `frontendDist: "../"` zeigte auf den Projekt-Root und führte zu einem zirkulären Zugriffsfehler beim Einbetten von `src-tauri/target/`. Gelöst durch `src/`-Ordner + `frontendDist: "../src"`.
**Aufwand:** ~40 min.
**Offen:** Button-Funktion, Datei-Dialog/Dateizugriff-Plugins, `identifier` in `tauri.conf.json` anpassen, macOS-Build.
