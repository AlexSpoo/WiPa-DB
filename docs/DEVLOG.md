# DEVLOG

## 2026-09-27 — Transkribieren: Personen-Template und Eingabemaske

**Ziel:** Zweite große Dashboard-Funktion umsetzen — Protokoll-Fotos in strukturierte Personen-Notizen transkribieren, als Ersatz für den bisherigen Obsidian-Templater-Workflow.

**Umsetzung:**
- Konfig: `Einstellungen/template-personen.md` (Feld-Katalog mit Kategorien/Typen/Optionen), abgeleitet aus dem Vergleich des bestehenden Templater-Skripts mit echten Garching-1/2-Personen-Notizen. `Personenordner`-Feld zu allen Projekt-Notizen ergänzt (Standort-Gruppen-Zuordnung, z. B. ReFuMoLab → Garching). `naming-rules.md` um `personen:`-Abschnitt erweitert.
- App: `transcribe.html`/`.js` — Batch-Übersicht (offene Protokoll-Bilder pro Event, bereits transkribierte rausgefiltert), dynamisch aus der Konfig gebautes Formular (Kategorien, Einfachauswahl als Toggle-Buttons, Freitext-Listen, Screenshot-Verknüpfung mit Unterfeldern, automatische Verlinkung mitprotokollierter Personen über eine +100/+200-Konvention). Erste Seite, die tatsächlich Markdown-Dateien schreibt statt nur Bilder zu kopieren.

**Entscheidungen:** Template als YAML-Konfig-Datei statt hartcodierter Felder in HTML, damit später weitere Templates möglich sind. Reale Garching-1/2-Daten als Grundlage statt blind dem (teilweise veralteten) Templater-Skript zu folgen — dabei aufgefallen: die Leitfrage-Liste im Garching-Template war fälschlich von MQ kopiert. Navigation zwischen Batch-Übersicht und Bearbeitung über normale Seiten-Navigation, nicht über ein eigenes Tauri-Fenster (ursprünglich missverstanden).

**Probleme / Sackgassen:**
- `freitext-liste`-Felder wurden bei der Zustands-Initialisierung fälschlich mit `""` statt `[]` befüllt, wodurch `renderForm()` beim ersten Aufruf abstürzte — dadurch wirkte es zunächst so, als würde das Bild nicht angezeigt.
- Das eigentliche Bild-Problem war ein 403 vom `asset://`-Protokoll: die fs-Plugin-Scope (die `expand_scope` bisher erweitert hat) und die Asset-Protokoll-Scope sind in Tauri zwei komplett getrennte Scopes. Gelöst durch zusätzlichen `asset_protocol_scope()`-Aufruf in `expand_scope` (Rust-Änderung, braucht Neustart von `npm run tauri dev`).
- Mehrere CSS-Anläufe für die Bild-Box: `max-width: 100%` in einer sich selbst schrumpfenden Box führt dazu, dass der Browser beim Berechnen der Box-Breite die volle Bildbreite statt der Prozentangabe einrechnet (bekannte CSS-Falle bei Prozent-Sizing kombiniert mit Shrink-to-fit). Letztlich per JS gelöst: Bildgröße wird nach dem Laden anhand von `naturalWidth`/`naturalHeight` und der verfügbaren Spaltengröße berechnet und direkt als Pixelgröße gesetzt.

**Aufwand:** ~3h.

**Offen:** Transkribieren ist grundsätzlich fertig, aber der eigentliche Speichervorgang (inkl. Mitprotokollierte-Personen-Verlinkung) noch nicht mit echten Daten durchgetestet. Restliche drei Dashboard-Unterseiten (Templates verwalten, Tagging, Auswerten, Export) weiterhin inhaltlich leer.

## 2026-09-27 — Screenshot-Dateityp: Referenzdaten im Vault + Umsetzung in der App

**Ziel:** Zweiten Datei-Typ (Screenshot) neben Protokoll unterstützen, inklusive sauberer Referenzdaten im Vault (Projekte, Screenshot-Typen) statt einer Flat-Liste.

**Umsetzung:**
- Vault: `Projekte/*.md` (Name, Kürzel, ScreenshotPrefix) und `Typen/Screenshot-Typen/*.md` (Name, Kürzel, Englischer Name) als eigene Notizen angelegt, Namen gegen die echten Screenshot-Vorlage-Notizen im Vault verifiziert. Events verlinken ihr Projekt jetzt per Wikilink (`Projekt: "[[Projekt_X]]"`), `ScreenshotPrefix` aus den Events entfernt und in die Projekt-Notizen verschoben. `Dokumentation/Screenshot Codes.md` auf automatische Dataview-Tabellen umgestellt. `Media/Images/Screenshots(RAW)/` konsistent benannt, gemischter "MQ 1"-Ordner anhand der einzelnen Screenshot-Notizen auf zwei Events aufgeteilt.
- App: `rename.html`/`rename.js` um Screenshot-Typ erweitert (Muster `{Event-Präfix}{Typ-Kürzel}-{Zahl}`, ohne `counterMax`). Neue Übersichtsseite am Ende des Umbenennen-Durchgangs: Liste aller Dateien mit Ergebnis-Name bzw. "Übersprungen"-Status, Einträge anklickbar zum Zurückspringen, Speichern erfolgt von dort aus.

**Entscheidungen:** Projekte und Screenshot-Typen als eigene verlinkte Notizen statt Liste/Aufzählung — konsistent mit dem bestehenden Events/Personen-Muster ("richtige Referenzdatenbank"). Projekte bewusst nicht unter `Typen/` einsortiert, da kein Typ. Screenshot-Zähler ohne `counterMax`-Deckelung (anders als Protokoll).

**Probleme / Sackgassen:**
- Nach der Wikilink-Migration griff `resolveEventFolder`/`eventInfo` noch aufs rohe `Projekt`-Feld statt den Wikilink aufzulösen — hätte für alle Mosaiq-Events die falsche/leere ScreenshotPrefix geliefert. Vor dem ersten Test selbst gefunden und behoben.
- Erstes umbenanntes Bild bekam keinen Präfix: `recomputeNumber()` setzte `state.event` nie, das passierte bisher nur beim Verlassen der Seite über `saveCurrentState()`.
- Überspringen zählte die Nummer trotzdem hoch, weil `updateLastGoodState()` übersprungene Dateien nicht ausschloss.
- Erster Versuch, Felder beim Klick auf "Überspringen" sofort zurückzusetzen, kollidierte mit `saveCurrentState()` beim Weiternavigieren und funktionierte nicht zuverlässig. Ersetzt durch "lazy reset beim Anzeigen" in `loadFile()` — robuster, weil es an einer einzigen Stelle greift statt über mehrere Klick-Handler verteilt zu sein.
- Nach dem Reset ignorierte die Nummern-Berechnung andere, noch ungespeicherte Bilder im selben Batch (nur Dateien auf der Platte wurden gezählt) — ein neu bearbeitetes, vorher übersprungenes Bild bekam wieder Nummer 1. Behoben, indem `computeNextProtokollNumber`/`computeNextScreenshotNumber` jetzt zusätzlich die im laufenden Batch bereits vergebenen Nummern berücksichtigen.

**Aufwand:** ~4h.

**Offen:** Restliche vier Dashboard-Unterseiten (Transkribieren, Templates, Tagging, Auswerten, Export) inhaltlich leer. Weitere Datei-Typen (z. B. Post-it, Protokoll-Typen) bisher nur als spätere Idee erwähnt.

## 2026-09-24 — Multi-Vault-Verwaltung, Upload-Feinschliff, Umbenennen-Seite

**Ziel:** Mehrere Vaults verwaltbar machen (Wechseln/Hinzufügen), Upload-Seite fertigstellen (Drag&Drop, Layout-Fixes), neue Umbenennen-Seite mit automatischer Protokoll-Nummerierung.
**Umsetzung:** `dashboard.html`/`.js` — Vault-Switcher unten links (Overlay-Menü), Datenmodell von einzelnem `dbFolder` auf `vaults[]`/`activeVault` umgestellt (auch `main.js` betroffen). `upload.html`/`.js`, `styles.css` — diverse CSS-Fixes, Drag&Drop über `onDragDropEvent`, "Weiter"-Button zu `rename.html` via `sessionStorage`. Architektur-Entscheidung anhand realer Vault-Struktur verifiziert: Markdown+Frontmatter bleibt Datenquelle, kein SQL; neuer sichtbarer `Einstellungen/`-Ordner im Vault mit `naming-rules.md`. `rename.html`/`.js` — neue Seite: Bildanzeige (`convertFileSrc` + Asset-Protokoll), fs-Plugin vollständig eingerichtet, eigener Rust-Command `expand_scope` für dynamische Dateisystem-Freigabe, Event-Dropdown aus vorhandenen Ordnern, automatische Nummern-Findung, manuell überschreibbares Namensfeld.
**Entscheidungen:** Markdown/Obsidian-Vault bleibt einzige Wahrheit statt SQL-Konvertierung (Wikilinks als Relationen, Obsidian "Bases" liefert bereits Join-artige Abfragen). Separates `rename.html` statt Wiederverwendung von `tag.html` (unterschiedlicher Zweck). `sessionStorage` für Datei-Listen wieder eingeführt, da jetzt echte Seitenwechsel zwischen Upload/Umbenennen stattfinden. Dynamische Scope-Erweiterung per eigenem Rust-Command statt statischer Capabilities-Konfiguration, weil der Vault-Pfad zur Laufzeit beliebig sein kann.
**Probleme / Sackgassen:** fs-Plugin-Crate war schon länger in `Cargo.toml`, aber nie registriert/mit Capability versehen — mehrere "funktioniert nicht"-Runden dadurch. Mehrfach die Ein-Argument-Toggle-Form statt der Zwei-Argumente-Form benutzt, führte zu Flip-Flop-Bugs bei Sichtbarkeits-Klassen. `readDir()` auf tiefer verschachtelten Vault-Unterordnern schlug mit "forbidden path" fehl, weil die automatische Dialog-Scope-Freigabe nur den exakt gewählten Pfad abdeckt — gelöst über eigenen Rust-Command. Bild-Anzeige verursachte mehrfach Fenster-Scroll durch fehlendes `min-height: 0` an mehreren Stellen der verschachtelten Flex-Kette.
**Aufwand:** ~4h.
**Offen:** "Art des Screenshots" nur mit einer Option (Protokoll), weitere Datei-Typen fehlen noch. Verhalten beim Zurückschalten vom manuellen Namens-Modus (Stift-Button) noch offen. `expand_scope` muss noch auf andere Seiten (`main.js`, `dashboard.js`) ausgeweitet werden, da die Freigabe App-Neustarts nicht übersteht. Split-Vorschau/Zurück/Überspringen bei "Nächstes Bild anzeigen" noch nicht gebaut. Restliche vier Dashboard-Unterseiten inhaltlich leer.

## 2026-09-21 — Dashboard, geteilter Header, Upload-Seite (Grundgerüst)

**Ziel:** Navigation zu den sechs Funktionsbereichen nach der Datenbank-Verbindung, geteilte Kopfzeile für alle Unterseiten, Start der Upload-Funktion (Dateiauswahl + Anzeige).
**Umsetzung:** `src/pages/dashboard.html` mit Bento-Grid aus sechs Kacheln (CSS Grid). Sechs Platzhalter-Unterseiten (`upload.html`, `transcribe.html`, `templates.html`, `tag.html`, `evaluate.html`, `export.html`). Geteilter Header als Web Component (`src/shared/app-header.js`, Custom Element `<app-header>`) mit Zurück-Link und aufklappbarem Burger-Menü (Overlay-Positionierung). `src/main.js` erweitert: Weiterleitung zum Dashboard nach erfolgreicher Ordnerauswahl, sowie beim App-Start, falls schon ein Ordner gespeichert ist. `upload.html`/`upload.js`: Datei-Auswahl-Dialog (mehrere Bilder), Anzeige als Icon+Dateiname-Kacheln in einem responsiven Grid, das komplett aus dem aktuellen Auswahl-Zustand neu gerendert wird.
**Entscheidungen:** Mehrere echte HTML-Seiten statt SPA für die sechs Funktionsbereiche (einfacher, in sich abgeschlossen). Web Component statt dupliziertem Markup oder nachgeladenem HTML-Schnipsel für den geteilten Header. Bewusste, dokumentierte Ausnahme von "keine absolute Positionierung" fürs Burger-Menü-Overlay (in CLAUDE.md unter Projektkonventionen notiert). Datei-Auswahl-Zwischenstand (`filesToUpload`) bewusst nicht dauerhaft gespeichert (weder Store noch `sessionStorage`) — reicht als einfache Variable, weil kein Seitenwechsel während der Auswahl stattfindet. Grid wird bei jeder Änderung komplett neu aufgebaut statt einzelne Kacheln zu patchen, um spätere Lösch-Funktion ohne Sync-Risiko zu ermöglichen.
**Probleme / Sackgassen:** Erste Idee für die Unterseiten-Navigation war ein iframe-basierter Ansatz — verworfen wegen Isolationsproblemen (Styling, Browser-Verlauf), zugunsten des Web Components. `flex-direction` ohne `display: flex` gesetzt (keine Wirkung). Grid blieb einspaltig, weil das Elternelement `align-items: center` hatte und dem Grid dadurch keine Breite zum Verteilen gab. Mehrfache Copy-Paste-Fehler beim Übertragen von Mustern zwischen Seiten (Store-Methode `add` existiert nicht, Scope-Fehler bei `const` in `if`-Blöcken, fehlerhafte Zuweisung vergessen).
**Aufwand:** ~4-5h.
**Offen:** Drag&Drop-Funktion für Datei-Upload, Tagging/Umbenennen-Screen (Wireframes vorhanden), "Weiter"-Button + Hinweistext im Bulk-Upload, restliche fünf Unterseiten inhaltlich, `beforeunload`-Warnung für den Tagging-Screen, Design-Feinschliff (auf später verschoben).

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
