# Phase 1 — Grundgerüst & Tauri-Setup: Erklärung

Dieses Dokument erklärt jede Datei und jede Entscheidung aus Phase 1: das
HTML/CSS-Grundgerüst der Startseite und die anschließende Tauri-Integration.
Referenz zum Nachschlagen — für Rückfragen einfach im Chat melden.

## 1. Ordnerstruktur

```
Data App/
├── .gitignore
├── CLAUDE.md
├── package.json
├── package-lock.json
├── node_modules/           (npm-Pakete, nicht versioniert)
├── design/                 (dein Referenzmaterial, unverändert)
│   ├── Logo 1.svg
│   └── No DB Start.png
├── src/                    (Frontend: das, was im Fenster angezeigt wird)
│   ├── index.html
│   ├── styles.css
│   └── assets/
│       └── cone.svg
└── src-tauri/               (Rust-Backend: das, was die App zur Desktop-App macht)
    ├── Cargo.toml
    ├── build.rs
    ├── tauri.conf.json
    ├── capabilities/
    │   └── default.json
    ├── icons/
    └── src/
        ├── main.rs
        └── lib.rs
```

**Warum `src/` und `src-tauri/` getrennt sind:** Tauri braucht eine klare
Grenze zwischen Frontend-Dateien (die als "Assets" ins fertige Programm
eingebettet werden) und dem Rust-Projekt selbst. `src-tauri/` enthält u.a.
einen `target/`-Ordner mit Build-Artefakten (bei jedem Kompilieren
Hunderte MB an Dateien). Läge das Frontend im selben Ordner wie
`src-tauri/`, würde Tauri versuchen, auch `target/` als Frontend-Asset
einzubetten — das hat uns den ersten Fehler beschert (siehe Abschnitt 5).

**`assets/` bleibt innerhalb von `src/`**, nicht auf oberster Ebene, weil es
zum Frontend gehört — es wird über eine relative URL (`assets/cone.svg`) aus
`index.html` heraus geladen, genau wie `styles.css`.

## 2. `src/index.html` Zeile für Zeile

```html
<!DOCTYPE html>
<html lang="de">
```
`<!DOCTYPE html>` sagt dem Browser/der Rendering-Engine, dass HTML5 benutzt
wird (kein Legacy-Modus). `lang="de"` ist wichtig für Screenreader — sie
wählen darüber die richtige Sprachausgabe.

```html
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WiPa DB</title>
  <link rel="stylesheet" href="styles.css">
</head>
```
- `charset="UTF-8"`: Zeichenkodierung, wichtig wegen Umlauten (ü in
  "verknüpfen"). Ohne das können Umlaute als Kauderwelsch angezeigt werden.
- `viewport`-Meta: eigentlich für responsive Web-Design gedacht (mobile
  Skalierung). In einer Desktop-App via Tauri weniger kritisch, aber
  Standard-Praxis und schadet nicht.
- `title`: erscheint im Betriebssystem-Fenstertitel/Taskleiste — bei Tauri
  wird das aber vom `title`-Feld in `tauri.conf.json` überschrieben, sobald
  die App über Tauri läuft (siehe Abschnitt 4).
- `link rel="stylesheet"`: bindet `styles.css` ein, relativer Pfad, weil
  beide Dateien im selben Ordner (`src/`) liegen.

```html
<body>
  <main class="start-screen">
```
`<main>` statt `<div>`: semantisches Element, sagt Screenreadern "das ist der
Hauptinhalt der Seite". Bei nur einer Sektion auf der Seite ist `<main>`
korrekt (nicht `<section>` oder `<article>`, die für Inhalte mit eigenem
Kontext/Wiederholung gedacht sind).

```html
    <img class="start-screen__illustration" src="assets/cone.svg" alt="">
```
- `src="assets/cone.svg"`: **kein** Inline-SVG, wie gefordert — das SVG wird
  als externe Datei geladen, genau wie ein PNG/JPG.
- `alt=""`: bewusst leer, nicht weggelassen. Ein leeres `alt`-Attribut sagt
  Screenreadern "dieses Bild ist rein dekorativ, überspringen" — korrekt,
  weil die Kegel-Illustration keine Information transportiert, die für das
  Verständnis der Seite nötig ist. Ein fehlendes `alt`-Attribut dagegen wäre
  ein Accessibility-Fehler (Screenreader lesen dann oft den Dateinamen vor).

```html
    <button type="button" class="btn btn-primary">
      <svg class="btn__icon" viewBox="0 0 20 16" aria-hidden="true">
        <path d="..." fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
      </svg>
      Datenbank finden und verknüpfen
    </button>
```
- `type="button"`: **wichtig**. Ohne explizites `type` ist ein `<button>`
  in einem `<form>` standardmäßig `type="submit"` und würde ein Formular
  absenden/die Seite neu laden. Hier gibt es zwar kein `<form>`, aber es ist
  guter Stil, das nie dem Zufall zu überlassen.
- Das Icon ist als **Inline-SVG** im HTML eingebettet, nicht als eigene
  Datei — bewusste Abweichung von der Kegel-Regel, weil:
  - `stroke="currentColor"` das Icon automatisch die Textfarbe des Buttons
    übernehmen lässt (ändert sich die Button-Textfarbe, ändert sich das Icon
    mit, ohne dass man zwei Stellen pflegen muss).
  - kein zusätzlicher HTTP-Request nötig ist für ein so kleines, rein
    dekoratives UI-Icon.
- `aria-hidden="true"` auf dem SVG: Screenreader ignorieren das Icon
  komplett — der Button-Text "Datenbank finden und verknüpfen" beschreibt
  die Aktion bereits vollständig, das Icon ist rein visuell redundant.
- Kein `<img>`/`alt` beim Icon nötig, weil es ein `<svg>` ist — das
  `aria-hidden` übernimmt hier die gleiche Rolle wie `alt=""` beim Bild.

```html
    <a class="link-secondary" href="#">Wie du die Datenbank findest und herunterlädst</a>
```
`<a href="#">` ist ein Platzhalter — es gibt noch kein Ziel für den Link.
Das ist bewusst so belassen (kein JavaScript, keine Zielseite in Phase 1).
Wenn der Link später eine echte Funktion bekommt (z. B. ein Modal öffnen
statt zu navigieren), sollte das `href="#"` überdacht werden — ein Link ohne
echtes Ziel ist ein kleiner Accessibility-Schwachpunkt (Screenreader/
Tastatur-Nutzer erwarten bei einem `<a>` eine Navigation).

## 3. `src/styles.css` Zeile für Zeile

```css
:root {
  --color-bg: #0A46B4;
  --color-accent: #FF7A2F;
  --color-line: #A9C6F0;
  --color-text: #FFFFFF;
  --font-mono: ui-monospace, "Cascadia Mono", "Consolas", "SFMono-Regular", "Liberation Mono", monospace;
}
```
Alle Farben und die Schrift als Custom Properties auf `:root` — genau wie
gefordert, damit sie an genau einer Stelle definiert sind und nirgendwo als
Hex-Code verstreut im Code auftauchen. `--font-mono` ist ein System-Font-Stack
(keine Webfont-Datei wird geladen): Windows bekommt `Cascadia Mono` oder
`Consolas`, macOS/Linux fallen auf `ui-monospace`/`SFMono-Regular` zurück,
absoluter Fallback ist das generische `monospace`.

```css
*, *::before, *::after {
  box-sizing: border-box;
}
```
Reset-Zeile 1: `border-box` sorgt dafür, dass `padding` und `border` in die
angegebene Breite/Höhe eines Elements *hineingerechnet* werden, statt
draufaddiert zu werden. Ohne das würde z. B. der Button beim Hinzufügen von
`padding` breiter werden als erwartet.

```css
html, body {
  height: 100%;
  margin: 0;
}
```
`margin: 0` entfernt den Standard-Außenabstand, den Browser dem `<body>`
geben (sonst hättest du einen sichtbaren weißen/blauen Rand). `height: 100%`
auf `html` und `body` ist Voraussetzung dafür, dass `min-height: 100vh` im
`.start-screen` später wirklich den ganzen Fensterinhalt ausfüllt.

```css
body {
  background-color: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-mono);
}
```
Hintergrundfarbe, Textfarbe und Schriftart einmal zentral auf `body` gesetzt
— alle Kindelemente erben das automatisch (`color` und `font-family` sind
vererbende CSS-Eigenschaften), müssen es also nicht einzeln wiederholen.

```css
button { font: inherit; color: inherit; }
a { color: inherit; }
```
Browser geben `<button>`-Elementen von sich aus eine eigene (meist andere)
Schriftart und Systemfarbe, und Links eine Standard-Linkfarbe (meist Blau).
Diese zwei Regeln heben das auf, damit Button und Link bewusst *unsere*
Farben/Schrift bekommen, nicht die Browser-Vorgabe.

```css
.start-screen {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 40px;
  min-height: 100vh;
  padding: 24px;
}
```
Das ist die geforderte Flexbox-Zentrierung, keine `position: absolute`:
`flex-direction: column` stapelt die drei Kindelemente untereinander,
`align-items: center` zentriert sie horizontal, `justify-content: center`
zentriert sie vertikal innerhalb der `min-height: 100vh` (= mindestens die
volle Fensterhöhe). `gap: 40px` erzeugt den Abstand zwischen den drei
Elementen, ohne dass man auf jedem einzelnen `margin` setzen muss. `padding:
24px` verhindert, dass Inhalt bei einem sehr kleinen Fenster direkt am
Rand klebt.

```css
.start-screen__illustration {
  width: min(480px, 80vw);
  height: auto;
}
```
`min(480px, 80vw)` heißt: nimm den *kleineren* der beiden Werte. Auf einem
großen Fenster wird das Bild maximal 480px breit; auf einem schmalen Fenster
schrumpft es mit (`80vw` = 80 % der Fensterbreite), damit es nie über den
Rand hinausragt. `height: auto` erhält dabei automatisch das
Seitenverhältnis des SVGs.

```css
.btn {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 14px 24px;
  border-radius: 8px;
  border: 1px solid var(--color-line);
  font-size: 1rem;
  cursor: pointer;
}
```
`.btn` ist die **Basis-Klasse** für alle Buttons im Projekt (aktuell nur
einer, aber das Muster ist für spätere Buttons gedacht). `display:
inline-flex` + `align-items: center` + `gap: 10px` sorgen dafür, dass Icon
und Text sauber nebeneinander und vertikal zentriert sitzen, unabhängig
davon wie viel Text im Button steht. `cursor: pointer` signalisiert visuell
"klickbar", auch wenn `<button>` das browser-seitig meist schon tut.

```css
.btn-primary {
  background-color: var(--color-bg);
  color: var(--color-text);
}
```
`.btn-primary` liefert nur noch die **Variante** (Hintergrund-/Textfarbe)
oben auf `.btn` drauf. Trennung von Struktur (`.btn`) und Variante
(`.btn-primary`) heißt: ein späterer `.btn-secondary` (z. B. mit
transparentem Hintergrund) müsste nur Farben definieren, nicht Padding/
Border-Radius/Flex-Verhalten erneut schreiben.

```css
.btn__icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
```
`flex-shrink: 0` verhindert, dass das Icon bei wenig Platz im Flex-Container
gequetscht/verzerrt wird — es behält immer seine 18×18px.

```css
.link-secondary {
  color: var(--color-accent);
  text-decoration: underline;
  font-size: 0.9rem;
}
```
Der Textlink: orange (Akzentfarbe), unterstrichen, etwas kleiner als der
Button-Text (`0.9rem` vs. `1rem`), um die visuelle Hierarchie
Button-zuerst/Link-sekundär zu unterstreichen.

**Benennungslogik der Klassen:** Ich habe mich an einem vereinfachten
BEM-Muster orientiert (Block, Element, Modifier):
- `.start-screen` ist der **Block** (die Seite/Komponente als Ganzes).
- `.start-screen__illustration` ist ein **Element** *innerhalb* dieses
  Blocks (`__` = "gehört zu").
- `.btn-primary` und `.link-secondary` sind **Modifier**-artige Namen
  (`-primary`/`-secondary` = "Variante von etwas Allgemeinerem"), angelehnt
  an das verbreitete `.btn`/`.btn-primary`-Muster aus vielen CSS-Frameworks
  — bewusst gewählt, weil es dir vermutlich aus anderem Kontext schon
  bekannt vorkommt und sich gut auf weitere Varianten (`.btn-secondary`,
  `.link-primary`, …) erweitern lässt, ohne dass die Namensgebung
  inkonsistent wird.

## 4. Tauri-Setup

### Warum Tauri, kurz zur Erinnerung
Ziel: eine Desktop-App (Windows + macOS), die auf lokale Dateien zugreifen
kann. Tauri nutzt dafür einen Rust-Backend-Prozess (mit vollem
Dateisystem-Zugriff) und zeigt das Frontend im System-eigenen WebView an
(auf Windows: WebView2, auf macOS: WKWebView) — kein mitgelieferter
Chromium wie bei Electron, dadurch kleinere/genügsamere App.

### `package.json`
```json
"scripts": {
  "tauri": "tauri",
  "dev": "tauri dev",
  "build": "tauri build"
},
"devDependencies": {
  "@tauri-apps/cli": "^2.11.4"
}
```
`@tauri-apps/cli` ist das einzige npm-Paket, das wir brauchen — es ist nur
das Kommandozeilen-Werkzeug, das den Rust-Build anstößt und die App-Fenster
während der Entwicklung verwaltet. Die eigentliche App-Logik läuft in Rust,
nicht in Node.js. `npm run dev` startet den Entwicklungsmodus (Fenster öffnet
sich, Frontend-Änderungen werden ohne Neu-Build übernommen), `npm run build`
erzeugt die fertigen, installierbaren Programme.

### `src-tauri/Cargo.toml` — das Rust-Projekt-Manifest
```toml
[lib]
name = "app_lib"
crate-type = ["staticlib", "cdylib", "rlib"]
```
Drei verschiedene Ausgabeformate für dieselbe Bibliothek: `staticlib`/
`cdylib` werden für mobile Ziele (iOS/Android, falls das später relevant
wird) und für das Verlinken mit dem nativen Betriebssystem gebraucht,
`rlib` ist das normale Format, damit `main.rs` diese Bibliothek als
gewöhnliche Rust-Dependency einbinden kann (siehe unten).

```toml
[dependencies]
serde_json = "1.0"
serde = { version = "1.0", features = ["derive"] }
log = "0.4"
tauri = { version = "2.11.3", features = [] }
tauri-plugin-log = "2"
```
`serde`/`serde_json`: Standard-Bibliothek in Rust, um Daten zwischen Rust
und JavaScript zu (de)serialisieren (JSON hin und her) — wird relevant,
sobald du Daten aus der Datenbank ans Frontend schickst. `tauri-plugin-log`
+ `log`: Logging-Ausgabe in der Konsole während der Entwicklung.

### `src-tauri/build.rs`
```rust
fn main() {
  tauri_build::build()
}
```
Ein **Build-Skript** — läuft *vor* dem eigentlichen Kompilieren des
Programms (Cargo-Konvention: jede Datei namens `build.rs` wird automatisch
so behandelt). Es bereitet Icons, Metadaten und die Config für das spätere
Einbetten vor.

### `src-tauri/src/main.rs`
```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  app_lib::run();
}
```
Der eigentliche Programmeinstiegspunkt (wie in jedem Rust-Programm). Die
erste Zeile ist eine bedingte Compiler-Anweisung: **nur im Release-Build**
(`not(debug_assertions)`) wird das Programm als reine "Windows"-Anwendung
markiert statt als Konsolen-Anwendung — sonst würde bei jedem Start der App
zusätzlich ein schwarzes Konsolenfenster im Hintergrund aufgehen. Im
Dev-Build (`npm run dev`) bleibt die Konsole bewusst sichtbar, damit du
Log-Ausgaben siehst. `main()` selbst delegiert sofort an `app_lib::run()` —
die eigentliche Logik liegt in `lib.rs`.

### `src-tauri/src/lib.rs`
```rust
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
```
`tauri::Builder::default()` baut die App-Konfiguration schrittweise auf
(sog. **Builder-Pattern**). `.setup(...)` registriert Code, der einmalig
beim App-Start läuft — hier wird das Logging-Plugin **nur im Debug-Build**
aktiviert (`cfg!(debug_assertions)`, zur Laufzeit geprüft, im Gegensatz zum
`#[cfg_attr]` oben, das zur Kompilierzeit entscheidet). `generate_context!()`
ist ein Makro, das zur Kompilierzeit `tauri.conf.json` einliest und den
kompletten Frontend-Ordner (`frontendDist`) als Binärdaten in die
ausführbare Datei einbettet — deshalb braucht die fertige App später keine
losen HTML/CSS-Dateien mehr, alles steckt in der `.exe`. `.expect(...)`
lässt das Programm mit einer Fehlermeldung abstürzen, falls der Start
fehlschlägt (in einem Einstiegspunkt wie diesem ist das akzeptabel, es gibt
keine sinnvolle Fallback-Logik für "die App konnte nicht starten").

### `src-tauri/tauri.conf.json`
```json
{
  "productName": "wipa-db",
  "version": "0.1.0",
  "identifier": "com.tauri.dev",
  "build": {
    "frontendDist": "../src"
  },
  "app": {
    "windows": [
      { "title": "WiPa DB", "width": 800, "height": 600, "resizable": true, "fullscreen": false }
    ],
    "security": { "csp": null }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [ "icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png", "icons/icon.icns", "icons/icon.ico" ]
  }
}
```
- `identifier`: **noch ein Platzhalter** (`com.tauri.dev`). Das ist die
  eindeutige App-ID (ähnlich einer Bundle-ID bei iOS/macOS-Apps) und sollte
  vor einer echten Veröffentlichung z. B. zu `com.wipadb.app` geändert
  werden — aktuell unkritisch, da wir nur lokal entwickeln.
- `frontendDist`: der Pfad, den wir in Abschnitt 5 korrigiert haben —
  relativ zu `src-tauri/`, zeigt auf `../src`.
- `app.windows`: Startgröße und -titel des Fensters. Der Titel hier
  überschreibt das `<title>` aus `index.html`, sobald die App über Tauri
  läuft.
- `security.csp: null`: keine Content-Security-Policy gesetzt — für die
  aktuelle Phase unkritisch (keine externen Skripte, kein Netzwerk-Code),
  aber ein Punkt, den man sich vor einer echten Veröffentlichung nochmal
  ansieht (Tauri empfiehlt dann eine restriktive CSP).

### `src-tauri/capabilities/default.json`
```json
{
  "identifier": "default",
  "windows": ["main"],
  "permissions": ["core:default"]
}
```
Tauris **Berechtigungssystem**: jedes Fenster (hier: `"main"`) bekommt
explizit zugewiesene Berechtigungen. `core:default` ist ein Bündel
harmloser Grundrechte (Fenstersteuerung etc.), aber **kein** Dateisystem-
oder Dialog-Zugriff. Für die eigentliche "Datenbank finden"-Funktion (Phase
2) wirst du hier gezielt Berechtigungen wie `dialog:default` oder
`fs:allow-read-file` ergänzen müssen — das ist bewusst nicht automatisch
inkludiert, weil Tauri nach dem Prinzip "so wenig Zugriff wie nötig"
arbeitet.

### `src-tauri/icons/`
Automatisch generierte Icon-Varianten in verschiedenen Auflösungen/Formaten
(`.ico` für Windows, `.icns` für macOS, diverse PNG-Größen für Windows-
Store-Kacheln). Aktuell Tauris Standard-Platzhalter-Icon — ein eigenes Logo
kannst du später einfach durch Ersetzen dieser Dateien einsetzen (oder mit
`npx tauri icon <pfad-zu-deinem-logo.png>` neu generieren lassen).

## 5. Der Fehler, den wir unterwegs hatten (und warum er passiert ist)

Erster Versuch: `frontendDist` zeigte auf `"../"` (den kompletten
Projekt-Root) statt auf `"../src"`. Das lag daran, dass Standard-
Tauri-Vorlagen ohne Bundler oft direkt den Root nutzen — bei uns lag aber
`src-tauri/` selbst *innerhalb* dieses Roots.

Ergebnis: Tauri versuchte beim Kompilieren, den **kompletten** Root
(inklusive `src-tauri/target/`, dem Ordner, in den der laufende Build
gerade selbst hineinschreibt) als Frontend-Assets einzubetten. Der Build
griff dabei auf seine eigene, in dem Moment gesperrte
`.cargo-build-lock`-Datei zu — ein Zugriffsfehler unter Windows
("Der Prozess kann nicht auf die Datei zugreifen"). Ein klassischer
zirkulärer Selbstbezug.

Fix: Frontend-Dateien in einen eigenen `src/`-Ordner verschoben, der
**nichts** mit `src-tauri/` zu tun hat, und `frontendDist` auf `"../src"`
angepasst. Das ist auch der Aufbau, den offizielle Tauri-Vorlagen ohne
Bundler standardmäßig verwenden.

Ein zweiter, kleinerer Stolperstein danach: beim allerersten `npm run dev`
schlug der Build kurzzeitig mit "Zugriff verweigert" beim Überschreiben der
frisch gelinkten `app.exe` fehl — sehr wahrscheinlich, weil der Windows-
Defender-Echtzeitschutz die neu erstellte `.exe` in genau dem Moment
gescannt und kurz gesperrt hat, als der Linker sie ersetzen wollte. Ein
einfacher Neustart des Builds hat gereicht, kein struktureller Fehler.

## 6. Wie die App gestartet wird

```powershell
npm run dev
```
Kompiliert das Rust-Projekt (beim ersten Mal dauert das mehrere Minuten,
da alle Abhängigkeiten frisch gebaut werden — danach nur noch Sekunden dank
Cargos Build-Cache) und öffnet das App-Fenster mit der Startseite.
Änderungen an `src/index.html`/`styles.css` werden automatisch neu geladen,
ohne dass du den Befehl neu ausführen musst.

```powershell
npm run build
```
Erstellt die fertige, installierbare Anwendung (auf Windows z. B. eine
`.msi`/`.exe`-Datei unter `src-tauri/target/release/bundle/`). Wichtig:
eine **macOS-App muss auf einem Mac gebaut werden** — Tauri kann (wie die
meisten nativen Toolchains) nicht von Windows aus für macOS
cross-kompilieren. Für die Mac-Version brauchst du irgendwann Zugriff auf
einen Mac (eigenes Gerät, CI-Dienst wie GitHub Actions mit
`macos-latest`-Runner, o. ä.) — das ist noch offen und kein Problem, das
sich in der aktuellen Codebasis lösen lässt.

## 7. Offene Punkte für Phase 2

- `identifier` in `tauri.conf.json` ist noch der Platzhalter `com.tauri.dev`.
- Der Button hat noch keine Funktion — Klick-Handler kommt über
  Tauris JavaScript-API (`@tauri-apps/plugin-dialog` für den nativen
  "Datei/Ordner öffnen"-Dialog, `@tauri-apps/plugin-fs` für Dateizugriff).
  Beide Plugins sind noch **nicht** installiert und müssten erst per
  `npm install` + Rust-seitiger Registrierung + Capability-Eintrag
  hinzugefügt werden.
- Der `href="#"`-Platzhalter beim Sekundär-Link braucht ein echtes Ziel
  oder eine Klick-Funktion.
- Mac-Build noch nicht getestet (kein Zugriff auf macOS in dieser Umgebung).
