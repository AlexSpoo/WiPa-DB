import { invoke } from "@tauri-apps/api/core";
import { join, basename } from "@tauri-apps/api/path";
import { readDir, readTextFile, writeTextFile, exists } from "@tauri-apps/plugin-fs";
import { save } from "@tauri-apps/plugin-dialog";
import { load as loadYaml } from "js-yaml";
import { load as loadStore } from "@tauri-apps/plugin-store";

const bereichSelect = document.querySelector("#evaluate-bereich-select");
const countEl = document.querySelector("#evaluate-count");
const resetFiltersButton = document.querySelector("#evaluate-reset-filters-button");
const exportButton = document.querySelector("#evaluate-export-button");
const tableEl = document.querySelector("#evaluate-table");

const viewTableButton = document.querySelector("#evaluate-view-table-button");
const viewChartsButton = document.querySelector("#evaluate-view-charts-button");
const tableViewEl = document.querySelector("#evaluate-table-view");
const chartsViewEl = document.querySelector("#evaluate-charts-view");
const facetFieldSelect = document.querySelector("#evaluate-facet-field");
const xFieldSelect = document.querySelector("#evaluate-x-field");
const chartTypeSelect = document.querySelector("#evaluate-chart-type");
const chartPercentCheckbox = document.querySelector("#evaluate-chart-percent");
const chartHideEmptyCheckbox = document.querySelector("#evaluate-chart-hide-empty");
const chartExportCsvButton = document.querySelector("#evaluate-chart-export-csv-button");
const chartGridEl = document.querySelector("#evaluate-chart-grid");

const joinStepsEl = document.querySelector("#evaluate-join-steps");
const joinAddButton = document.querySelector("#evaluate-join-add-button");
const joinedColumnsListEl = document.querySelector("#evaluate-joined-columns-list");

const store = await loadStore("settings.json", { autoSave: false });
const activeVault = await store.get("activeVault");
await invoke("expand_scope", { folderPath: activeVault });

// Bekannte Datenbereiche und ihr Vault-Ordner — analog zur Bereichs-Registry in
// transcribe.js/templates.js, bewusst nicht generisch (siehe dortige Absprache).
const BEREICH_DIRS = {
    Personen: await join(activeVault, "Personen"),
    Screenshots: await join(activeVault, "Screenshots"),
};

// Für verknüpfte Felder ("Event.Quartier" usw.) — alle bekannten Notiz-Ordner,
// nach denen bei der Pfad-Auflösung gesucht wird (siehe findNoteAnywhere).
// readAllNotesRecursive liest sowohl flache als auch pro-Projekt verschachtelte
// Ordner (Personen/Screenshots), eine Unterscheidung ist hier nicht nötig.
const LOOKUP_FOLDERS = [
    await join(activeVault, "Events"),
    await join(activeVault, "Projekte"),
    BEREICH_DIRS.Personen,
    BEREICH_DIRS.Screenshots,
    await join(activeVault, "Poster"),
    await join(activeVault, "Post-its"),
    await join(activeVault, "Topics"),
    await join(activeVault, "Szenarien"),
];

// Ältere Notizen verlinken Screenshots teils mit vollem Pfad im Wikilink
// (z. B. "[[Screenshots/Garching/Screenshot_G-MG-009]]") statt nur mit dem
// Namen — für eine einheitliche Anzeige/Export wird nur der letzte Pfadteil
// genommen, unabhängig davon, wie der Wikilink ursprünglich geschrieben wurde.
function extractWikilinkTarget(value) {
    if (typeof value !== "string") return value;
    const match = value.match(/\[\[(.+?)(\|.*)?\]\]/);
    const target = match ? match[1] : value;
    return target.includes("/") ? target.slice(target.lastIndexOf("/") + 1) : target;
}

function formatDate(value) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

async function readFrontmatter(filePath) {
    const raw = await readTextFile(filePath);
    return loadYaml(raw.split("---")[1]);
}

// Eine einzelne kaputte Notiz (ungültiges YAML) soll nicht die ganze Liste
// abbrechen lassen — überspringen statt crashen.
async function safeReadFrontmatter(filePath) {
    try {
        return await readFrontmatter(filePath);
    } catch (err) {
        console.warn(`Konnte Frontmatter nicht lesen, überspringe: ${filePath}`, err);
        return null;
    }
}

// Personen/Screenshots liegen jeweils in Unterordnern pro Projekt/Standort —
// hier rekursiv alle Notizen einsammeln, egal in welchem Unterordner.
async function readAllNotesRecursive(dir) {
    const notes = [];
    if (!(await exists(dir))) return notes;

    for (const entry of await readDir(dir)) {
        const entryPath = await join(dir, entry.name);
        if (entry.isDirectory) {
            notes.push(...(await readAllNotesRecursive(entryPath)));
        } else if (entry.isFile && entry.name.endsWith(".md")) {
            const data = await safeReadFrontmatter(entryPath);
            if (!data) continue;
            notes.push({ fileName: entry.name.replace(/\.md$/, ""), data });
        }
    }
    return notes;
}

// ---- Verknüpfte Felder (z. B. "Event.Quartier") ----
// Verallgemeinert das Prinzip aus transcribe.js (resolveAutomaticValue /
// findNoteInKnownBereiche): einen Wikilink-Zielnamen durchprobieren gegen
// alle bekannten Notiz-Ordner, bis eine Datei mit diesem Namen gefunden wird —
// hier zusätzlich beliebig tief verkettbar (Event.Quartier, Person.Event.Quartier, …).

const folderNotesCache = new Map(); // dir -> Map(fileName -> data)
async function loadFolderNotes(dir) {
    if (folderNotesCache.has(dir)) return folderNotesCache.get(dir);
    const notes = await readAllNotesRecursive(dir);
    const map = new Map(notes.map((n) => [n.fileName, n.data]));
    folderNotesCache.set(dir, map);
    return map;
}

const noteCache = new Map(); // fileName -> data | null, über alle LOOKUP_FOLDERS hinweg
async function findNoteAnywhere(fileName) {
    if (!fileName) return null;
    if (noteCache.has(fileName)) return noteCache.get(fileName);
    for (const dir of LOOKUP_FOLDERS) {
        const notes = await loadFolderNotes(dir);
        if (notes.has(fileName)) {
            const data = notes.get(fileName);
            noteCache.set(fileName, data);
            return data;
        }
    }
    noteCache.set(fileName, null);
    return null;
}

// Folgt path = [Basisspalte, Zwischenfeld, …] von einer Zeile aus: die
// Basisspalte liefert den/die Zielnamen der ersten Notiz(en), jedes weitere
// Element außer dem letzten wird als weiterer Link gelesen und aufgelöst.
// Gibt die Notizen zurück, die am Ende der Kette erreicht werden (kein
// Auflösen des letzten Feldes — das ist je nach Aufrufer entweder der
// gesuchte Wert oder die Grundlage für den nächsten Schritt).
async function resolveNotesAlongPath(row, path) {
    let notes = [];
    for (const target of (row[path[0]] ?? "").split("; ").filter(Boolean)) {
        const note = await findNoteAnywhere(target);
        if (note) notes.push(note);
    }
    for (let i = 1; i < path.length; i++) {
        const nextNotes = [];
        for (const note of notes) {
            for (const target of formatCellValue(note[path[i]]).split("; ").filter(Boolean)) {
                const next = await findNoteAnywhere(target);
                if (next) nextNotes.push(next);
            }
        }
        notes = nextNotes;
    }
    return notes;
}

// Für den Ketten-Baukasten: welche Feldnamen kommen als nächster Schritt
// infrage, wenn path bereits (als Kette von Links) aufgelöst wird — Union
// über alle Zeilen, damit auch selten vorkommende Felder auftauchen.
async function candidateFieldsForNextStep(path) {
    const fields = new Set();
    for (const row of allRows) {
        const notes = await resolveNotesAlongPath(row, path);
        for (const note of notes) for (const key of Object.keys(note)) fields.add(key);
    }
    return [...fields].sort((a, b) => a.localeCompare(b, "de"));
}

// Berechnet den tatsächlichen Anzeigewert einer verknüpften Spalte: path[0..-2]
// werden als Link-Kette gefolgt, path[-1] wird auf den erreichten Notizen als
// normaler Wert gelesen (kein weiterer Link-Versuch).
async function resolveJoinedValue(row, path) {
    const notes = await resolveNotesAlongPath(row, path.slice(0, -1));
    const finalField = path[path.length - 1];
    const values = notes.map((note) => formatCellValue(note[finalField])).filter(Boolean);
    return [...new Set(values)].join("; ");
}

function formatCellValue(value) {
    if (value === null || value === undefined) return "";
    if (value instanceof Date) return formatDate(value);
    if (Array.isArray(value)) return value.map(formatCellValue).join("; ");
    if (typeof value === "string") return extractWikilinkTarget(value);
    return String(value);
}

const MAX_SUGGESTIONS = 25; // Obergrenze für Vorschläge pro Spalte (z. B. O-Töne mit fast lauter Unikaten)

let currentColumns = [];
let visibleColumns = new Set(); // Teilmenge von currentColumns, die angezeigt/exportiert wird
let columnIsList = new Set(); // Spalten, deren Werte ursprünglich Listen waren (für Token-Filterung)
let allRows = []; // Array von { [Spalte]: Anzeige-String }, ungefiltert/unsortiert
let filters = {}; // { [Spalte]: Filtertext }
let sortColumn = null;
let sortDirection = "asc";

let joinPath = []; // aktuell im Baukasten gewählte Kette, z. B. ["Event", "Quartier"]
let joinedColumns = []; // Spaltenschlüssel ("Event.Quartier") der bereits hinzugefügten verknüpften Felder

async function loadBereich(bereich) {
    const dir = BEREICH_DIRS[bereich];
    const notes = await readAllNotesRecursive(dir);

    const columns = ["Datei"];
    columnIsList = new Set();
    for (const note of notes) {
        for (const key of Object.keys(note.data)) {
            if (!columns.includes(key)) columns.push(key);
            if (Array.isArray(note.data[key])) columnIsList.add(key);
        }
    }

    allRows = notes.map((note) => {
        const row = {};
        for (const col of columns) {
            row[col] = col === "Datei" ? note.fileName : formatCellValue(note.data[col]);
        }
        return row;
    });

    currentColumns = columns;
    visibleColumns = new Set(columns);
    filters = {};
    sortColumn = null;
    joinPath = [];
    joinedColumns = [];
    renderColumnPicker();
    renderTableHead();
    applyFiltersAndRender();
    renderChartFieldSelects();
    renderJoinedColumnsList();
    await renderJoinBuilder();
    if (!chartsViewEl.classList.contains("is-hidden")) renderCharts();
}

function getDisplayColumns() {
    return currentColumns.filter((col) => visibleColumns.has(col));
}

// Liefert die einzelnen Werte, die eine Spalte innerhalb der übergebenen
// Zeilen tatsächlich annimmt — bei Listen-Spalten aufgesplittet (siehe
// formatCellValue-Verbindung "; "), sonst einfach der komplette Zellwert.
// Grundlage für die Vorschläge im Freitextfilter. Ungekürzt — die Begrenzung
// auf MAX_SUGGESTIONS passiert erst NACH dem Filtern nach der Eingabe (siehe
// showSuggestions), sonst könnten passende Werte durchs Abschneiden vorher
// schon rausfallen, bevor überhaupt gesucht wurde.
function collectColumnTokens(column, rows) {
    const tokens = new Set();
    for (const row of rows) {
        const cell = row[column];
        if (!cell) continue;
        if (columnIsList.has(column)) {
            for (const token of cell.split("; ")) if (token) tokens.add(token);
        } else {
            tokens.add(cell);
        }
    }
    return [...tokens].sort((a, b) => a.localeCompare(b, "de"));
}

// Alle Filter sind Freitext (Teilstring, Groß-/Kleinschreibung egal) — egal ob
// eine Spalte wenige oder viele unterschiedliche Werte hat. Dazu kommt eine
// eigene, gestylte Vorschlagsliste (siehe renderTableHead), ohne die Eingabe
// auf diese Werte zu beschränken.
function applySingleFilter(rows, column, filterValue) {
    if (!filterValue) return rows;
    const needle = filterValue.toLowerCase();
    return rows.filter((row) => (row[column] ?? "").toLowerCase().includes(needle));
}

// Für die Vorschläge einer Spalte: alle ANDEREN aktiven Filter schon
// anwenden, damit sich z. B. die Topics-Vorschläge an einem schon gewählten
// Szenario orientieren, statt immer alle Topics über den ganzen Bereich zu zeigen.
function rowsMatchingOtherFilters(excludeColumn) {
    let rows = allRows;
    for (const [column, filterValue] of Object.entries(filters)) {
        if (column === excludeColumn) continue;
        rows = applySingleFilter(rows, column, filterValue);
    }
    return rows;
}

function getVisibleRows() {
    let rows = allRows;
    for (const [column, filterValue] of Object.entries(filters)) {
        rows = applySingleFilter(rows, column, filterValue);
    }

    if (sortColumn) {
        rows = [...rows].sort((a, b) => {
            const av = a[sortColumn] ?? "";
            const bv = b[sortColumn] ?? "";
            const an = parseFloat(av);
            const bn = parseFloat(bv);
            const bothNumeric = av !== "" && bv !== "" && !isNaN(an) && !isNaN(bn);
            const cmp = bothNumeric ? an - bn : av.localeCompare(bv, "de");
            return sortDirection === "asc" ? cmp : -cmp;
        });
    }

    return rows;
}

function applyFiltersAndRender() {
    const visibleRows = getVisibleRows();
    countEl.textContent = visibleRows.length === allRows.length
        ? `${allRows.length} Einträge`
        : `${visibleRows.length} von ${allRows.length} Einträgen`;
    renderTableBody(visibleRows);
}

// Kopfzeile (Spaltennamen + Filter-Eingabefelder) wird nur einmal pro
// Bereichswechsel gebaut, NICHT bei jedem Filtern/Sortieren — sonst würden
// die Filter-Inputs bei jedem Tastendruck neu erzeugt und der Fokus ginge
// nach jedem einzelnen Zeichen verloren.
const headerCellsByColumn = new Map();

function renderTableHead() {
    headerCellsByColumn.clear();
    tableEl.innerHTML = "";
    const thead = document.createElement("thead");
    const displayColumns = getDisplayColumns();

    const headRow = document.createElement("tr");
    for (const column of displayColumns) {
        const th = document.createElement("th");
        th.textContent = column;
        th.addEventListener("click", () => {
            if (sortColumn === column) {
                sortDirection = sortDirection === "asc" ? "desc" : "asc";
            } else {
                sortColumn = column;
                sortDirection = "asc";
            }
            updateSortIndicators();
            applyFiltersAndRender();
        });
        headRow.appendChild(th);
        headerCellsByColumn.set(column, th);
    }
    thead.appendChild(headRow);

    const filterRow = document.createElement("tr");
    filterRow.className = "evaluate-filter-row";
    for (const column of displayColumns) {
        const th = document.createElement("th");
        th.className = "evaluate-filter-cell";

        const input = document.createElement("input");
        input.type = "text";
        input.placeholder = "filtern …";
        input.autocomplete = "off";
        input.value = filters[column] ?? "";

        // Eigene, im App-Design gestylte Vorschlagsliste statt einer nativen
        // <datalist> — die lässt sich vom Browser aus nicht stylen und sieht
        // dadurch immer hell/systemfremd aus, egal wie der Rest der App aussieht.
        const suggestionsEl = document.createElement("ul");
        suggestionsEl.className = "evaluate-suggestions is-hidden";

        function showSuggestions() {
            const needle = input.value.toLowerCase();
            const tokens = collectColumnTokens(column, rowsMatchingOtherFilters(column));
            const matches = (needle ? tokens.filter((t) => t.toLowerCase().includes(needle)) : tokens)
                .slice(0, MAX_SUGGESTIONS);

            suggestionsEl.innerHTML = "";
            for (const token of matches) {
                const li = document.createElement("li");
                li.textContent = token;
                // mousedown statt click: feuert vor dem blur-Event des Inputs,
                // sonst schließt sich die Liste, bevor der Klick ankommt.
                li.addEventListener("mousedown", (event) => {
                    event.preventDefault();
                    input.value = token;
                    filters[column] = token;
                    suggestionsEl.classList.add("is-hidden");
                    applyFiltersAndRender();
                });
                suggestionsEl.appendChild(li);
            }
            suggestionsEl.classList.toggle("is-hidden", matches.length === 0);
        }

        input.addEventListener("input", () => {
            filters[column] = input.value;
            showSuggestions();
            applyFiltersAndRender();
        });
        input.addEventListener("focus", showSuggestions);
        input.addEventListener("blur", () => suggestionsEl.classList.add("is-hidden"));

        th.append(input, suggestionsEl);
        filterRow.appendChild(th);
    }
    thead.appendChild(filterRow);
    tableEl.appendChild(thead);

    const tbody = document.createElement("tbody");
    tableEl.appendChild(tbody);

    // Sticky-Versatz der Filterzeile exakt an die tatsächliche Höhe der
    // Kopfzeile anpassen, statt mit einem festen CSS-Wert zu raten — sonst
    // überlappen sich Kopf-/Filterzeile/Liste je nach Zeilenumbruch in den
    // Spaltennamen unterschiedlich stark.
    requestAnimationFrame(() => {
        const headHeight = headRow.getBoundingClientRect().height;
        for (const th of filterRow.children) th.style.top = `${headHeight}px`;
    });
}

function updateSortIndicators() {
    for (const [column, th] of headerCellsByColumn) {
        th.textContent = sortColumn === column ? `${column} ${sortDirection === "asc" ? "▲" : "▼"}` : column;
    }
}

function renderTableBody(rows) {
    const tbody = tableEl.querySelector("tbody");
    tbody.innerHTML = "";
    const displayColumns = getDisplayColumns();
    for (const row of rows) {
        const tr = document.createElement("tr");
        for (const column of displayColumns) {
            const td = document.createElement("td");
            td.textContent = row[column] ?? "";
            tr.appendChild(td);
        }
        tbody.appendChild(tr);
    }
}

function toCsv(columns, rows) {
    const escapeCell = (value) => {
        const text = String(value ?? "");
        return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const lines = [columns.map(escapeCell).join(",")];
    for (const row of rows) lines.push(row.map(escapeCell).join(","));
    return lines.join("\r\n");
}

const columnPickerListEl = document.querySelector("#evaluate-column-picker-list");

function renderColumnPicker() {
    columnPickerListEl.innerHTML = "";
    for (const column of currentColumns) {
        const label = document.createElement("label");
        label.className = "evaluate-column-picker-item";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = visibleColumns.has(column);
        checkbox.addEventListener("change", () => {
            if (checkbox.checked) visibleColumns.add(column);
            else visibleColumns.delete(column);
            renderTableHead();
            applyFiltersAndRender();
        });

        label.appendChild(checkbox);
        label.append(column);
        columnPickerListEl.appendChild(label);
    }
}

// ---- Baukasten für verknüpfte Felder ----
// Ein <select> pro bereits gewähltem Schritt, plus ein weiteres für den
// nächsten möglichen Schritt (sofern die Kette an dieser Stelle überhaupt
// auf eine verlinkte Notiz mit weiteren Feldern trifft) — Klick für Klick,
// beliebig tief (z. B. Person → Event → Quartier).
async function renderJoinBuilder() {
    joinStepsEl.innerHTML = "";

    const baseOptions = currentColumns.filter((col) => col !== "Datei");
    appendJoinStepSelect(baseOptions, 0);

    for (let i = 0; i < joinPath.length; i++) {
        const candidates = await candidateFieldsForNextStep(joinPath.slice(0, i + 1));
        if (candidates.length === 0) break;
        appendJoinStepSelect(candidates, i + 1);
    }

    joinAddButton.disabled = joinPath.length < 2;
}

function appendJoinStepSelect(options, stepIndex) {
    const select = document.createElement("select");
    select.appendChild(new Option(stepIndex === 0 ? "Feld wählen …" : "weiter …", ""));
    for (const option of options) select.appendChild(new Option(option, option));
    select.value = joinPath[stepIndex] ?? "";
    select.addEventListener("change", async () => {
        joinPath = joinPath.slice(0, stepIndex);
        if (select.value) joinPath.push(select.value);
        await renderJoinBuilder();
    });
    joinStepsEl.appendChild(select);
}

function renderJoinedColumnsList() {
    joinedColumnsListEl.innerHTML = "";
    for (const key of joinedColumns) {
        const item = document.createElement("div");
        item.className = "evaluate-joined-column-item";

        const label = document.createElement("span");
        label.textContent = key;
        item.appendChild(label);

        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "link-secondary";
        removeButton.textContent = "entfernen";
        removeButton.addEventListener("click", () => {
            currentColumns = currentColumns.filter((col) => col !== key);
            visibleColumns.delete(key);
            columnIsList.delete(key);
            joinedColumns = joinedColumns.filter((col) => col !== key);
            for (const row of allRows) delete row[key];
            renderJoinedColumnsList();
            renderColumnPicker();
            renderTableHead();
            applyFiltersAndRender();
            renderChartFieldSelects();
        });
        item.appendChild(removeButton);

        joinedColumnsListEl.appendChild(item);
    }
}

joinAddButton.addEventListener("click", async () => {
    if (joinPath.length < 2) return;
    const key = joinPath.join(".");
    if (currentColumns.includes(key)) return;

    for (const row of allRows) {
        row[key] = await resolveJoinedValue(row, joinPath);
    }
    currentColumns.push(key);
    visibleColumns.add(key);
    columnIsList.add(key); // Ergebnis kann mehrere Werte enthalten (siehe resolveJoinedValue)
    joinedColumns.push(key);
    joinPath = [];

    await renderJoinBuilder();
    renderJoinedColumnsList();
    renderColumnPicker();
    renderTableHead();
    applyFiltersAndRender();
    renderChartFieldSelects();
});

bereichSelect.addEventListener("change", async () => {
    try {
        await loadBereich(bereichSelect.value);
    } catch (err) {
        console.error("Konnte Bereich nicht laden:", err);
        countEl.textContent = "Fehler beim Laden — siehe Konsole.";
    }
});

resetFiltersButton.addEventListener("click", () => {
    filters = {};
    sortColumn = null;
    renderTableHead();
    applyFiltersAndRender();
});

exportButton.addEventListener("click", async () => {
    const filePath = await save({
        defaultPath: `${bereichSelect.value}.csv`,
        filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!filePath) return;

    // Exportiert die aktuell gefilterte/sortierte/sichtbare Ansicht, nicht alles.
    const displayColumns = getDisplayColumns();
    const rows = getVisibleRows().map((row) => displayColumns.map((col) => row[col] ?? ""));
    const csv = toCsv(displayColumns, rows);
    // BOM voranstellen, damit Excel die UTF-8-Kodierung (Umlaute) korrekt erkennt.
    await writeTextFile(filePath, `﻿${csv}`);
});

// ==== Graphen ====
// Portiert aus dem eigenständigen "Data Explorer"-Tool (kleine data tools für
// WiPa/data-explorer) — dort React+Recharts, hier natives SVG im App-Design,
// arbeitet aber auf denselben gefilterten Zeilen wie die Tabelle oben.

// Bekannte Feld-Reihenfolgen (fachlich sinnvolle statt alphabetischer
// Sortierung), analog zu SORT_ORDERS im Original-Tool, an die echten
// Feldnamen in diesem Vault angepasst.
const SORT_ORDERS = {
    "Wahrscheinlichkeit": ["sicher", "könnte passieren", "passiert eher nicht", "nicht protokolliert"],
    "Einordnung": ["wünschenswert", "nicht wünschenswert", "ambivalent", "nicht protokolliert"],
    "Alter geschätzt": ["unter 18", "18-29", "30-44", "45-54", "55 und älter"],
    "Geschlecht": ["weiblich gelesen", "männlich gelesen", "nicht binär gelesen"],
};

function smartSort(values, fieldName) {
    const order = SORT_ORDERS[fieldName];
    if (order) {
        return [...values].sort((a, b) => {
            const ia = order.indexOf(a);
            const ib = order.indexOf(b);
            if (ia !== -1 && ib !== -1) return ia - ib;
            if (ia !== -1) return -1;
            if (ib !== -1) return 1;
            return a.localeCompare(b, "de");
        });
    }
    const allNumeric = values.every((v) => v === "nicht eingetragen" || !isNaN(parseFloat(v)));
    if (allNumeric) {
        return [...values].sort((a, b) => {
            if (a === "nicht eingetragen") return 1;
            if (b === "nicht eingetragen") return -1;
            return parseFloat(a) - parseFloat(b);
        });
    }
    return [...values].sort((a, b) => a.localeCompare(b, "de"));
}

// Einzelne Werte einer Zeile für ein Feld — bei Listen-Feldern aufgesplittet
// (siehe formatCellValue-Verbindung "; "), leere Zellen werden zu einer
// eigenen Ausprägung statt einfach zu verschwinden.
function getFieldValues(row, field) {
    const raw = row[field];
    if (!raw) return ["nicht eingetragen"];
    return columnIsList.has(field) ? raw.split("; ").filter(Boolean) : [raw];
}

function isEmptyValue(value) {
    return value === "nicht eingetragen" || value === "nicht protokolliert";
}

function singleCount(rows, field, hideEmpty) {
    const counts = new Map();
    for (const row of rows) {
        for (const value of getFieldValues(row, field)) {
            if (hideEmpty && isEmptyValue(value)) continue;
            counts.set(value, (counts.get(value) ?? 0) + 1);
        }
    }
    return smartSort([...counts.keys()], field).map((name) => ({ name, value: counts.get(name) }));
}

// Ein Graph pro Ausprägung von facetField, X-Achse = xField — z. B. ein
// Graph pro Szenario mit der Topic-Verteilung innerhalb dieses Szenarios.
function buildFacets(rows, facetField, xField, hideEmpty) {
    const facetMap = new Map();
    const allX = new Set();

    for (const row of rows) {
        const facetValues = getFieldValues(row, facetField);
        const xValues = getFieldValues(row, xField);
        for (const facetValue of facetValues) {
            if (hideEmpty && isEmptyValue(facetValue)) continue;
            if (!facetMap.has(facetValue)) facetMap.set(facetValue, new Map());
            const xCounts = facetMap.get(facetValue);
            for (const xValue of xValues) {
                if (hideEmpty && isEmptyValue(xValue)) continue;
                allX.add(xValue);
                xCounts.set(xValue, (xCounts.get(xValue) ?? 0) + 1);
            }
        }
    }

    const sortedX = smartSort([...allX], xField);
    let globalMax = 0;
    const facets = smartSort([...facetMap.keys()], facetField).map((facetName) => {
        const xCounts = facetMap.get(facetName);
        const total = [...xCounts.values()].reduce((sum, v) => sum + v, 0);
        const chartData = sortedX.map((x) => {
            const value = xCounts.get(x) ?? 0;
            if (value > globalMax) globalMax = value;
            return { name: x, value };
        });
        return { facetName, chartData, total };
    });

    return { facets, globalMax };
}

const CHART_PALETTE = [
    "#FF7A2F", "#5AC8FA", "#34C759", "#FFD60A", "#BF5AF2",
    "#FF375F", "#64D2FF", "#30D158", "#E0A800", "#AF52DE",
];

function escapeXml(text) {
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildBarChartSvg(data, { color, maxValue, percent }) {
    const width = Math.max(320, data.length * 70);
    const height = 220;
    const marginBottom = 46;
    const plotHeight = height - marginBottom - 20;
    const slot = width / data.length;
    const barWidth = Math.min(40, slot * 0.6);

    let svg = `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="xMinYMid meet">`;
    svg += `<line x1="0" y1="${height - marginBottom}" x2="${width}" y2="${height - marginBottom}" stroke="var(--color-line)" stroke-width="1" opacity="0.4" />`;

    data.forEach((d, i) => {
        const x = i * slot + (slot - barWidth) / 2;
        const barHeight = maxValue > 0 ? (d.value / maxValue) * plotHeight : 0;
        const y = height - marginBottom - barHeight;
        svg += `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="3" fill="${color}" />`;
        svg += `<text x="${x + barWidth / 2}" y="${y - 4}" text-anchor="middle" font-size="10" fill="var(--color-text)">${d.value}${percent ? "%" : ""}</text>`;
        svg += `<text x="${x + barWidth / 2}" y="${height - marginBottom + 14}" text-anchor="end" font-size="10" fill="var(--color-line)" transform="rotate(-35 ${x + barWidth / 2} ${height - marginBottom + 14})">${escapeXml(d.name)}</text>`;
    });

    svg += "</svg>";
    return svg;
}

function buildLineChartSvg(data, { color, maxValue, percent }) {
    const width = Math.max(320, data.length * 70);
    const height = 220;
    const marginBottom = 46;
    const plotHeight = height - marginBottom - 20;
    const slot = data.length > 1 ? width / (data.length - 1) : width;

    const points = data.map((d, i) => {
        const x = data.length > 1 ? i * slot : width / 2;
        const barHeight = maxValue > 0 ? (d.value / maxValue) * plotHeight : 0;
        return { x, y: height - marginBottom - barHeight, d };
    });

    let svg = `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="xMinYMid meet">`;
    svg += `<line x1="0" y1="${height - marginBottom}" x2="${width}" y2="${height - marginBottom}" stroke="var(--color-line)" stroke-width="1" opacity="0.4" />`;
    svg += `<polyline points="${points.map((p) => `${p.x},${p.y}`).join(" ")}" fill="none" stroke="${color}" stroke-width="2.5" />`;

    for (const p of points) {
        svg += `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="${color}" />`;
        svg += `<text x="${p.x}" y="${p.y - 8}" text-anchor="middle" font-size="10" fill="var(--color-text)">${p.d.value}${percent ? "%" : ""}</text>`;
        svg += `<text x="${p.x}" y="${height - marginBottom + 14}" text-anchor="end" font-size="10" fill="var(--color-line)" transform="rotate(-35 ${p.x} ${height - marginBottom + 14})">${escapeXml(p.d.name)}</text>`;
    }

    svg += "</svg>";
    return svg;
}

function renderChartCard(title, subtitle, data, options) {
    const card = document.createElement("div");
    card.className = "evaluate-chart-card";

    const header = document.createElement("div");
    header.className = "evaluate-chart-card-header";
    const titleEl = document.createElement("div");
    titleEl.className = "evaluate-chart-card-title";
    titleEl.textContent = title;
    header.appendChild(titleEl);
    const subtitleEl = document.createElement("div");
    subtitleEl.className = "evaluate-chart-card-subtitle";
    subtitleEl.textContent = subtitle;
    header.appendChild(subtitleEl);
    card.appendChild(header);

    const body = document.createElement("div");
    body.className = "evaluate-chart-card-body";
    body.innerHTML = data.length > 0
        ? (options.type === "line" ? buildLineChartSvg(data, options) : buildBarChartSvg(data, options))
        : `<p class="transcribe-static">Keine Daten.</p>`;
    card.appendChild(body);

    return card;
}

function renderChartFieldSelects() {
    facetFieldSelect.innerHTML = "";
    facetFieldSelect.appendChild(new Option("— Feld wählen —", ""));

    xFieldSelect.innerHTML = "";
    xFieldSelect.appendChild(new Option("— keine (nur Übersicht) —", ""));

    for (const column of currentColumns) {
        if (column === "Datei") continue;
        facetFieldSelect.appendChild(new Option(column, column));
        xFieldSelect.appendChild(new Option(column, column));
    }
}

function renderCharts() {
    chartGridEl.innerHTML = "";
    const facetField = facetFieldSelect.value;
    if (!facetField) {
        chartGridEl.innerHTML = `<p class="transcribe-static">Wähle oben ein Feld aus.</p>`;
        return;
    }

    const rows = getVisibleRows();
    const xField = xFieldSelect.value;
    const chartType = chartTypeSelect.value;
    const percent = chartPercentCheckbox.checked;
    const hideEmpty = chartHideEmptyCheckbox.checked;

    if (!xField) {
        let data = singleCount(rows, facetField, hideEmpty);
        const total = data.reduce((sum, d) => sum + d.value, 0);
        if (percent && total > 0) data = data.map((d) => ({ ...d, value: Math.round((d.value / total) * 1000) / 10 }));
        const maxValue = percent ? 100 : Math.max(1, ...data.map((d) => d.value));
        chartGridEl.appendChild(renderChartCard(
            `Verteilung: ${facetField}`,
            `${data.length} Ausprägungen`,
            data,
            { type: chartType, color: CHART_PALETTE[0], maxValue, percent }
        ));
        return;
    }

    const { facets, globalMax } = buildFacets(rows, facetField, xField, hideEmpty);
    if (facets.length === 0) {
        chartGridEl.innerHTML = `<p class="transcribe-static">Keine Daten für diese Kombination.</p>`;
        return;
    }
    facets.forEach((facet, i) => {
        let data = facet.chartData;
        if (percent && facet.total > 0) data = data.map((d) => ({ ...d, value: Math.round((d.value / facet.total) * 1000) / 10 }));
        const maxValue = percent ? 100 : Math.max(1, globalMax);
        chartGridEl.appendChild(renderChartCard(
            facet.facetName,
            `n = ${facet.total}`,
            data,
            { type: chartType, color: CHART_PALETTE[i % CHART_PALETTE.length], maxValue, percent }
        ));
    });
}

[facetFieldSelect, xFieldSelect, chartTypeSelect].forEach((el) => el.addEventListener("change", renderCharts));
[chartPercentCheckbox, chartHideEmptyCheckbox].forEach((el) => el.addEventListener("change", renderCharts));

viewTableButton.addEventListener("click", () => {
    viewTableButton.classList.add("is-active");
    viewChartsButton.classList.remove("is-active");
    tableViewEl.classList.remove("is-hidden");
    chartsViewEl.classList.add("is-hidden");
});

viewChartsButton.addEventListener("click", () => {
    viewChartsButton.classList.add("is-active");
    viewTableButton.classList.remove("is-active");
    chartsViewEl.classList.remove("is-hidden");
    tableViewEl.classList.add("is-hidden");
    renderCharts();
});

chartExportCsvButton.addEventListener("click", async () => {
    const facetField = facetFieldSelect.value;
    if (!facetField) return;

    const rows = getVisibleRows();
    const xField = xFieldSelect.value;
    const hideEmpty = chartHideEmptyCheckbox.checked;

    let csvColumns, csvRows;
    if (!xField) {
        const data = singleCount(rows, facetField, hideEmpty);
        csvColumns = [facetField, "Anzahl"];
        csvRows = data.map((d) => [d.name, d.value]);
    } else {
        const { facets } = buildFacets(rows, facetField, xField, hideEmpty);
        csvColumns = [facetField, xField, "Anzahl"];
        csvRows = facets.flatMap((facet) => facet.chartData.map((d) => [facet.facetName, d.name, d.value]));
    }

    const filePath = await save({
        defaultPath: `${bereichSelect.value}_${facetField}${xField ? `_x_${xField}` : ""}.csv`,
        filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!filePath) return;
    const csv = toCsv(csvColumns, csvRows);
    await writeTextFile(filePath, `﻿${csv}`);
});

await loadBereich(bereichSelect.value);
