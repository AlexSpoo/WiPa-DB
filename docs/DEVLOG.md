# DEVLOG

## 2026-09-16 — Ordner-Auswahl, Vite, persistente Speicherung

**Ziel:** Button-Funktionalität: nativen Ordner-Dialog öffnen und den gewählten Pfad dauerhaft speichern, damit er beim nächsten App-Start nicht erneut abgefragt werden muss.
**Umsetzung:** Tauri-Dialog-Plugin (`tauri-plugin-dialog` + `@tauri-apps/plugin-dialog`) eingebunden, erstes JS (`src/main.js`) mit Klick-Handler auf den Button. Vite als Build-Tool ergänzt (`vite.config.js`, `tauri.conf.json`/`package.json` angepasst), um npm-Paket-Importe im Frontend aufzulösen. Tauri-Store-Plugin (`tauri-plugin-store` + `@tauri-apps/plugin-store`) eingebunden, gewählter Ordner wird nach `settings.json` im App-Daten-Ordner geschrieben.
**Entscheidungen:** Store-Plugin statt `localStorage` gewählt — Daten landen als einsehbare Datei im OS-App-Daten-Ordner statt in einer versteckten Browser-Datenbank, passender für eine "richtige" Desktop-App und BA-Verteidigung. Auslesen des gespeicherten Ordners beim App-Start wird erst umgesetzt, sobald ein zweiter Screen existiert (Verhalten sonst nicht sinnvoll festlegbar).
**Probleme / Sackgassen:** `import ... from "@tauri-apps/plugin-dialog"` schlug zunächst fehl — Browser/WebView lösen npm-Paketnamen ohne Bundler nicht auf. Behoben durch Einführung von Vite statt eines Workarounds (Import Map), da absehbar war, dass weitere Plugins denselben Bedarf haben würden.
**Aufwand:** ~1h.
**Offen:** Auslese-Logik beim App-Start (abhängig von zweitem Screen), `identifier` in `tauri.conf.json` weiterhin Platzhalter, Datei-Dialog/i18n-Feinschliff, macOS-Build.

## 2026-09-16 — Button-Interaktion & Roboto Mono

**Ziel:** Wiederverwendbare Inner-Shadow-Komponente für Haupt-Buttons, Hover-Vergrößerung, und Schriftart passend zu Figma (Roboto Mono statt System-Monospace-Stack).
**Umsetzung:** `src/styles.css` — Modifier-Klasse `.btn-shadow-inset` mit variabler `--shadow-color` (via `color-mix()`, 40 % normal / 70 % bei Hover), `.btn:hover` mit `transform: scale(1.05)` plus `transition`. Drei `@font-face`-Regeln für Roboto Mono (Regular/Bold/Italic), lokal gehostet unter `src/assets/fonts/` als `.woff2`. `src/index.html` — Button um Klasse `btn-shadow-inset` ergänzt.
**Entscheidungen:** Schatten als eigene Modifier-Klasse statt fest in `.btn-primary`, damit selektiv auf einzelne Buttons anwendbar. Schattenfarbe als Custom Property (`--shadow-color`) statt hart codiert, damit pro Button überschreibbar. Roboto Mono selbst gehostet statt über Google-Fonts-CDN geladen, um Offline-Fähigkeit zu erhalten (keine Netzwerkpflicht beim App-Start).
**Aufwand:** ~1h.
**Offen:** Button-Funktion (Datei-Dialog/Dateizugriff-Plugins), `identifier` in `tauri.conf.json`, macOS-Build, `href="#"`-Platzhalter beim Sekundär-Link.

## 2026-09-16 — Startseite-Grundgerüst & Tauri-Integration

**Ziel:** Minimal-Gerüst der "keine DB verbunden"-Startseite, plus Entscheidung und Einrichtung der Desktop-App-Basis.
**Umsetzung:** `src/index.html`, `src/styles.css`, `src/assets/cone.svg` (Kegel-Illustration aus `design/Logo 1.svg` übernommen). Tauri v2 via `npx tauri init` eingerichtet (`src-tauri/`), Rust-Toolchain von 1.68 auf 1.98 aktualisiert.
**Entscheidungen:** Electron vs. Tauri abgewogen — Tauri gewählt wegen geringerem Ressourcenverbrauch, akzeptierter Mehraufwand durch Rust. Frontend liegt in eigenem `src/`-Ordner statt im Projekt-Root, um Vermischung mit `src-tauri/` zu vermeiden.
**Probleme / Sackgassen:** `frontendDist: "../"` zeigte auf den Projekt-Root und führte zu einem zirkulären Zugriffsfehler beim Einbetten von `src-tauri/target/`. Gelöst durch `src/`-Ordner + `frontendDist: "../src"`.
**Aufwand:** ~40 min.
**Offen:** Button-Funktion, Datei-Dialog/Dateizugriff-Plugins, `identifier` in `tauri.conf.json` anpassen, macOS-Build.
