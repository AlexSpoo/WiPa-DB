# DEVLOG

## 2026-10-01 — Fünf neue Seiten: Post-its, Daten verwalten, Vertaggen, Topics, Zukunftskegel

**Ziel:** Den kompletten Auswertungs-Workflow abbilden: von rohem Post-it-Digitalisieren über freies Vertaggen bis zur Konsolidierung in Topics/Szenarien, einer interaktiven Auswertungstabelle mit Graphen und dem Zukunftskegel als Abschlussvisualisierung.

**Umsetzung:**
- `postits.js`/`.html`: Post-it Digitizer nativ nachgebaut (ursprünglich eigenständiges React-Tool), Batch → Poster-Auswahl → Workspace, Positionen prozentual statt Grid/Kalibrierung.
- `manage.js`/`.html`: "Daten verwalten" als Projekt→Event-Baum mit Detailansicht, Caching pro Projekt/Event gegen lange Ladezeiten, getrennte Lese-/Bearbeitungsansicht.
- `tag.js`/`.html`: "Daten vertaggen" — MAXQDA-artige Review-Queue pro Event, freies `Codes`-Feld (bewusst nicht `Tags`, da Obsidian das reserviert und keine Leerzeichen erlaubt), Fokus auf O-Töne statt Stammdaten.
- `topics.js`/`.html`: "Topics verwalten" — Codes zu Topics, Topics zu Szenarien (many-to-many) zusammenfassen, pro Quartier statt pro Event/global. "Neu berechnen" leitet `Topics`/`Szenario` automatisch aus Codes ab (plus manuelle Hinzufügen/Entfernen-Überschreibung), rührt aber alte, nur manuell gepflegte Dateien nicht an.
- `evaluate.js`/`.html`: Tabelle zu einer Bases-artigen Ansicht ausgebaut (Spaltenauswahl, Sortierung, Freitextfilter mit Vorschlägen), "Graphen"-Ansicht mit selbstgebauten SVG-Charts (portiert aus dem Data-Explorer-Tool), plus "+ Verknüpftes Feld" zum Nachbauen von Relationsketten wie `Event.Quartier` oder `Person.Event.Quartier`.
- `cone.js`/`.html` (neu): "Zukunftskegel", portiert aus dem eigenständigen Futures-Cone-Tool — liest `PositionZeitstrahl`/`Wahrscheinlichkeit` direkt aus den Screenshot-Notizen, 5 Darstellungsarten, Split-Modus, freie Farbschemata, SVG-/PNG-Export.
- `rename.js`/`.html`: dritter Typ "Szenariobild" (freier Name statt fortlaufender Nummer).
- `app-header.js`: Home-Icon von 🏠 auf schlichtes ⌂ geändert, Navigation um alle neuen Seiten ergänzt.
- `src-tauri/capabilities/default.json`: `fs:allow-write-file` ergänzt (für den PNG-Export im Zukunftskegel).

**Entscheidungen:** Jede portierte Seite liest live aus dem Vault statt aus eingefügtem JSON. Topics-Zuordnung pro Quartier statt Event, weil das dem bisherigen manuellen Vorgehen (MaxQDA-Export) entspricht. Bei den Wahrscheinlichkeits-Werten im Zukunftskegel beide Schreibweisen ("sicher" und "passiert ziemlich sicher" etc.) zugelassen, weil sich die Formulierung im Vault über die Zeit geändert hat.

**Probleme / Sackgassen:** Erste Version des Zukunftskegels erkannte nur die kurze Schreibweise der Wahrscheinlichkeits-Werte und ließ dadurch einen Großteil der "passiert ziemlich sicher"-Screenshots unter den Tisch fallen — nach dem Testlauf korrigiert.

**Aufwand:** ~20-24h (verteilt über mehrere Sitzungen; grobe Schätzung anhand des Umfangs, keine echte Zeitmessung).

**Offen:** Editierbarkeit von Personen/Screenshot-Inhaltsfeldern in "Daten verwalten"; UI für `Topics hinzugefügt`/`Topics entfernt`-Overrides pro Datei; PNG-Export einzelner Graphen in "Daten auswerten".

## 2026-09-30 — Bugfixes aus dem zweiten Testdurchlauf

**Ziel:** Drei Probleme beheben, die beim erneuten Testen nach den gestrigen Fixes aufgetaucht sind: Überschreiben bestehender Screenshot-Interpretationen beim Verknüpfen, fehlendes Einordnungs-Feld im Screenshot-Template, und veraltete Anzeige nach Entfernen einer Datenbank.

**Umsetzung:**
- `transcribe.js`: `saveScreenshotNote()` schreibt hartkodierte Leerzeilen für PositionZeitstrahl/Wahrscheinlichkeit/Einordnung/InterpretationenDesScreenshots nur noch, wenn das aktive Template das Feld nicht selbst definiert (gleiches Muster wie der "Zusätzliche Anmerkungen"-Fix von gestern).
- `transcribe.js`: Beim Verknüpfen eines bestehenden Screenshots aus dem Personen-Formular ("+ Screenshot hinzufügen") werden die aktuellen Werte der Zieldatei jetzt vorgeladen und das Formular damit vorbefüllt, statt leer zu starten.
- `dashboard.js`: `renderSwitchList()` als eigene Funktion extrahiert und nach jedem Entfernen einer Datenbank in "Datenbanken verwalten" erneut aufgerufen, damit der normale Vault-Switcher aktuell bleibt.
- Vault: Feld "Einordnung" (wünschenswert/nicht wünschenswert/ambivalent/nicht protokolliert) zu allen 14 Screenshot-Templates hinzugefügt — erst möglich, weil der Duplicate-Key-Fix jetzt verhindert, dass das Feld beim Speichern überschrieben wird.

**Entscheidungen:** Duplicate-Key-Fix wurde bewusst auf alle vier betroffenen Felder generalisiert statt nur für Einordnung, da derselbe Bug dieselbe Ursache hat. Vorbefüllung nach dem vom Nutzer selbst vorgeschlagenen Prinzip umgesetzt: bestehenden Wert aus der Zieldatei laden, Formular damit befüllen, Nutzer kann ändern/ergänzen.

**Probleme / Sackgassen:** Keine.

**Aufwand:** ~2h

**Offen:** "Wahrscheinlichkeit" könnte durch denselben Fix ebenfalls in die Screenshot-Templates aufgenommen werden — noch nicht gemacht, da nicht ausdrücklich gewünscht.

## 2026-09-29 — Daten auswerten, erster Testdurchlauf, Bugfixes aus dem Testfeedback

**Ziel:** Erste vollständige, abgabefähige Version fertigstellen — Datenbank-Listenansicht mit CSV-Export ergänzen, dann per komplettem Testdurchlauf verifizieren und die dabei gefundenen Probleme beheben.

**Umsetzung:**
- Neue Seite `evaluate.html`/`.js` ("Daten auswerten"): Tabellenansicht aller Personen-/Screenshot-Notizen (Spalten = alle vorkommenden Frontmatter-Felder), CSV-Export mit BOM für Excel.
- Fehlende Templates ergänzt: Personen-Templates `IAA` und `Mosaiq` (eigene Leitfragen/Personengruppe je nach echten Projektdaten), 11 fehlende Screenshot-Templates (Felder aus echten Beispiel-Notizen), allen 8 Events ein `ProtokollTemplate` zugewiesen.
- Kompletter Testdurchlauf (Upload → Umbenennen → Templates verwalten → Transkribieren Personen/Screenshots → Auswerten) ergab 5 Fehlermeldungen, alle behoben:
  - Kritischer Bug gefunden: mehrzeilige Textfelder wurden beim Speichern nicht als YAML maskiert → kaputte Notizen. War die eigentliche Ursache für zwei der gemeldeten Symptome ("keine Screenshots wählbar", "Umschalten in Auswerten geht nicht").
  - MOSAIQ-Notizen (Personen und Screenshots) liegen in Event-Unterordnern statt flach wie Garching/IAA — Erkennung war nicht rekursiv, betraf die Hälfte aller Events.
  - Sammel-Funktionen (`loadExistingPersons`, `loadUnlinkedScreenshots`, `readAllNotesRecursive`) jetzt defensiv: eine kaputte Notiz überspringt sich selbst statt alles abzubrechen.
  - Screenshot-Nummerierung kollidierte zwischen Events desselben Projekts (Präfix+Kürzel sind projektweit, nicht pro Event) — Nummerierung scannt jetzt alle Events eines Projekts; die dadurch schon entstandene Dateikollision (Garching 1/2, `G-P-001`–`003`) repariert.
  - CSV-Export normalisiert Screenshot-Wikilinks jetzt einheitlich auf den bloßen Namen (alte Vault-Daten hatten teils den vollen Pfad im Link).
  - "Zusätzliche Anmerkungen" war hart einprogrammiert und konnte Nutzereingaben überschreiben — ist jetzt ein normales Template-Feld.
- "Datenbanken verwalten"-Button (bisher ohne Funktion) implementiert: Liste aller registrierten Vaults mit "Entfernen" (nur aus der Liste, keine Datei-Löschung).

**Entscheidungen:** Nummerierungs-Fix im Code gelöst statt die RAW-Ordnerstruktur auf "ein Ordner pro Projekt" umzustellen — kleinerer Eingriff, gleiche Wirkung. Detaillierte Code-Erklärung aller Fixes in `docs/Review-2026-09-29.md` festgehalten statt hier im DEVLOG, da sehr umfangreich.

**Probleme / Sackgassen:** Die Ursachenanalyse für "Screenshots nicht wählbar" und "Umschalten geht nicht" führte zunächst in zwei getrennte Richtungen, bis sich herausstellte, dass beide auf denselben zugrunde liegenden YAML-Escaping-Bug zurückgingen — ein Fund, der die Fehlersuche am Ende deutlich verkürzt hat.

**Aufwand:** ~4h.

**Offen:** Alles nur syntaktisch geprüft, noch nicht in der laufenden App getestet. Grundsatzfrage RAW-Ordner-pro-Projekt vs. pro-Event weiterhin offen. Tagging, Poster/Post-its, restliche Dashboard-Seiten weiterhin nicht angebunden.

## 2026-09-28 — Templates verwalten: generisches Template-System

**Ziel:** Statt eines fest verdrahteten Personen-Templates ein generisches System, mit dem beliebige Template-Kategorien (Personen, Screenshots, künftig weitere) über die App selbst angelegt und bearbeitet werden können — inklusive automatischer Feld-Befüllung ohne hartcodierte Feldnamen im Code.

**Umsetzung:**
- Neue Seite `templates.html`/`.js`: Kategorien/Templates auflisten, Feldkatalog editieren (Name, Formular-Abschnitt, Typ, typspezifische Zusatzangaben wie Optionen oder Unterfelder).
- Screenshot-Typ-Anbindung: Template unter Kategorie "Screenshots" anlegen erstellt/verknüpft automatisch die zugehörige Screenshot-Typ-Notiz (Kürzel, Englischer Name, `Template:`-Verweis).
- Event-Zuordnung: pro Event ein Protokoll-Template zuweisen (wird beim Transkribieren automatisch geladen) sowie informativ gültige Screenshot-Typen vermerken (ohne die Auswahl beim Transkribieren einzuschränken).
- `automatisch`-Felder generalisiert: statt hartcodierter Prüfung auf Feldnamen "Datum"/"Ort" gibt es jetzt eine Pfad-Auswahl (z. B. Event → Projekt → Name), die sich live an echten Beispiel-Notizen orientiert und beim Transkribieren generisch aufgelöst wird.
- `template-personen.md` migriert nach `Einstellungen/Templates/Personen/Standard.md`.

**Entscheidungen:** Bewusst keine volle Generizität für Bereichs-Ordner (Events, Projekte bleiben fest im Code verankert) — nur die Feld-Auflösung selbst ist generisch. Eine vollständige "Datei-Arten"-Registry (auch Ordner-Zuordnung konfigurierbar) wäre der nächste Ausbauschritt, aber bewusst zurückgestellt.

**Probleme / Sackgassen:** Erster Ansatz für "automatisch" sollte laut Nutzer sicherstellen, dass gar nichts bereichsspezifisch hartcodiert ist — nach Abwägung des Aufwands (würde eine volle Datei-Arten-Registry brauchen) auf eine abgespeckte, aber noch generische Version geeinigt.

**Aufwand:** ~4h.

**Offen:** Volle Datei-Arten-Registry (Ordner-Zuordnung generisch statt fest im Code), Poster/Post-its-Integration, restliche Dashboard-Unterseiten.

## 2026-09-28 — Transkribieren: Mehrpersonen-Navigation, Zoom, Screenshots-Unterstützung

**Ziel:** Bugs aus dem ersten Transkribieren-Test beheben und die Seite bereichsübergreifend (Personen + Screenshots) statt nur für Personen nutzbar machen.

**Umsetzung:**
- CSS-Bug behoben (`.is-hidden` bekam `!important`, da eine spätere, spezifischere Regel sie überstimmt hatte — Ursache für verirrte Buttons auf der Übersicht).
- Personennummer wird beim Speichern jetzt aus dem tatsächlichen Formularfeld gelesen statt neu berechnet.
- Personen-Verwaltung pro Bild umgebaut: Zustand aller Bilder einer Batch-Sitzung bleibt erhalten (`imageStates`), "Zurück" navigiert jetzt bild- und personenübergreifend, `saveGroup()` schreibt bei jeder Navigation alle Personen eines Protokolls neu (inkl. Nummern-Änderung mit Umbenennung der Datei).
- Bild-Zoom: Klick aufs Protokollbild öffnet eine vergrößerte, scrollbare Ansicht.
- Dropdown-Styling vereinheitlicht (Renamer-Look) für die ganze App.
- Screenshots transkribieren funktioniert jetzt: 1:1 pro Bild, Typ-Dropdown pro Bild (merkt sich die letzte Wahl als Vorschlag), generisches Formular aus dem gewählten Screenshot-Template.
- Textfelder wachsen jetzt mit dem Inhalt mit (mehrzeilige Eingabe möglich).

**Entscheidungen:** Bild-Box-Größe wird per JS anhand von `naturalWidth`/`naturalHeight` berechnet statt per CSS, weil `max-width: 100%` in einer sich selbst schrumpfenden Box eine bekannte CSS-Falle ist (Browser rechnet mit der vollen Bildbreite, bevor die Prozentangabe greifen kann).

**Probleme / Sackgassen:** "Screenshots werden nicht gefunden" stellte sich als Eigenschaft der Testdaten heraus (kopierte echte Notizen mit bereits gesetztem `Person`-Feld), nicht als Bug.

**Aufwand:** ~4h.

**Offen:** Poster/Post-its weiterhin nicht angebunden.

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
