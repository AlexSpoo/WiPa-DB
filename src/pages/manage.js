import { invoke } from "@tauri-apps/api/core";
import { join, basename, dirname } from "@tauri-apps/api/path";
import { readDir, readTextFile, writeTextFile, mkdir, exists, remove } from "@tauri-apps/plugin-fs";
import { load as loadYaml, dump as dumpYaml } from "js-yaml";
import { load as loadStore } from "@tauri-apps/plugin-store";
import { confirm } from "@tauri-apps/plugin-dialog";

const treeEl = document.querySelector("#manage-tree");
const detailEl = document.querySelector("#manage-detail");

// ---- Vault-Grundlagen ----
const store = await loadStore("settings.json", { autoSave: false });
const activeVault = await store.get("activeVault");
await invoke("expand_scope", { folderPath: activeVault });

const projekteDir = await join(activeVault, "Projekte");
const eventsDir = await join(activeVault, "Events");
const personenDir = await join(activeVault, "Personen");
const screenshotsDir = await join(activeVault, "Screenshots");
const posterNotesDir = await join(activeVault, "Poster");
const postitsDir = await join(activeVault, "Post-its");
const postitTypenDir = await join(activeVault, "Typen", "Postit-Typen");

function extractWikilinkTarget(value) {
    if (typeof value !== "string") return null;
    const match = value.match(/\[\[(.+?)\]\]/);
    return match ? match[1] : value;
}

function formatDate(value) {
    if (value === undefined || value === null || value === "") return "";
    if (!(value instanceof Date)) return String(value);
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function formatDateTimeLocal(value) {
    if (!value) return "";
    if (value instanceof Date) {
        const pad = (n) => String(n).padStart(2, "0");
        return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}T${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`;
    }
    return String(value).slice(0, 16);
}

// Für die Anzeige in der Inspizieren-Ansicht: Listen/Daten lesbar als Text.
function formatDisplayValue(value) {
    if (value === undefined || value === null || value === "") return "–";
    if (value instanceof Date) return formatDate(value);
    if (Array.isArray(value)) {
        return value.length === 0 ? "–" : value.map((v) => formatDisplayValue(v)).join("; ");
    }
    return String(value);
}

async function readFrontmatter(filePath) {
    const raw = await readTextFile(filePath);
    return loadYaml(raw.split("---")[1]);
}

async function safeReadFrontmatter(filePath) {
    try {
        return await readFrontmatter(filePath);
    } catch (err) {
        console.warn(`Konnte Frontmatter nicht lesen, überspringe: ${filePath}`, err);
        return null;
    }
}

async function writeNote(filePath, data) {
    const frontmatter = dumpYaml(data, { sortKeys: false, lineWidth: -1 });
    await writeTextFile(filePath, `---\n${frontmatter}---\n`);
}

// Manche Standort-Ordner haben die Notizen direkt drin (Garching, IAA), andere
// nochmal in Event-Unterordnern (MOSAIQ) — rekursiv suchen (siehe transcribe.js).
async function collectMdFilesRecursive(dir) {
    const files = [];
    if (!(await exists(dir))) return files;
    for (const entry of await readDir(dir)) {
        const entryPath = await join(dir, entry.name);
        if (entry.isDirectory) {
            files.push(...(await collectMdFilesRecursive(entryPath)));
        } else if (entry.isFile && entry.name.endsWith(".md")) {
            files.push(entryPath);
        }
    }
    return files;
}

// Ordner heißen mal nur "<Event>", mal "<Projekt> <Event>" (siehe rename.js/postits.js).
async function resolveEventFolder(baseDir, eventName, projektName) {
    const plainPath = await join(baseDir, eventName);
    if (await exists(plainPath)) return plainPath;
    if (projektName) {
        const projectPath = await join(baseDir, `${projektName} ${eventName}`);
        if (await exists(projectPath)) return projectPath;
    }
    return plainPath;
}

// ---- Feld-Schemata ----
const PROJEKT_FIELDS = [
    { name: "Name", typ: "text" },
    { name: "Kürzel", typ: "text" },
    { name: "ScreenshotPrefix", typ: "text" },
    { name: "Personenordner", typ: "text" },
];

// "ProtokollTemplate" fehlt hier bewusst — das wird schon über
// Templates verwalten → Event-Zuordnung gepflegt, nicht doppelt hier.
const EVENT_FIELDS = [
    { name: "Name", typ: "text" },
    { name: "Datum", typ: "datum" },
    { name: "Quartier", typ: "text" },
    { name: "Wetter", typ: "text" },
    { name: "Anfang", typ: "datumzeit" },
    { name: "Ende", typ: "datumzeit" },
    { name: "Orte", typ: "liste" },
    { name: "Ortswechsel", typ: "text" },
    { name: "Wechsel der Leitfrage", typ: "liste" },
    { name: "Durchführende Personen", typ: "liste" },
    { name: "Moderation", typ: "liste" },
    { name: "Besonderheiten Installation", typ: "liste" },
    { name: "Besonderheiten Moderation", typ: "liste" },
    { name: "Beteiligungsart", typ: "text" },
    { name: "Verweildauer im Schnitt", typ: "zahl" },
    { name: "Allgemeine Eindrücke", typ: "liste" },
    { name: "Event Anmerkungen", typ: "liste" },
];

const POSTIT_FIELDS = [
    { name: "Nummer", typ: "text" },
    { name: "PositionX", typ: "zahl" },
    { name: "PositionY", typ: "zahl" },
    { name: "Textinhalt", typ: "liste-text" },
    { name: "Postit-art", typ: "postit-art" },
];

// ---- Daten laden ----
async function loadProjekte() {
    const list = [];
    if (!(await exists(projekteDir))) return list;
    for (const entry of await readDir(projekteDir)) {
        if (!entry.isFile || !entry.name.endsWith(".md")) continue;
        const filePath = await join(projekteDir, entry.name);
        const data = await safeReadFrontmatter(filePath);
        if (!data?.Name) continue;
        list.push({ filePath, fileName: entry.name.replace(/\.md$/, ""), data });
    }
    list.sort((a, b) => a.data.Name.localeCompare(b.data.Name));
    return list;
}

async function loadEventsForProjekt(projekt) {
    const list = [];
    if (!(await exists(eventsDir))) return list;
    for (const entry of await readDir(eventsDir)) {
        if (!entry.isFile || !entry.name.endsWith(".md")) continue;
        const filePath = await join(eventsDir, entry.name);
        const data = await safeReadFrontmatter(filePath);
        if (!data?.Name) continue;
        if (extractWikilinkTarget(data.Projekt) !== projekt.fileName) continue;
        list.push({ filePath, fileName: entry.name.replace(/\.md$/, ""), data });
    }
    list.sort((a, b) => formatDate(a.data.Datum).localeCompare(formatDate(b.data.Datum)));
    return list;
}

// Personen/Screenshots liegen pro PROJEKT (nicht pro Event) in einem Ordner
// und können bei größeren Projekten viele Dateien enthalten (rekursiver Scan
// wegen MOSAIQ-Unterordnern). Da renderTree() bei jeder Auswahl neu läuft und
// dabei für jedes aufgeklappte Event alle Bereiche neu lädt, wurde das ohne
// Cache bei jedem Klick x-mal neu gescannt — deshalb hier pro Projekt einmal
// einlesen und cachen, danach nur noch nach Event filtern (siehe clearAllCaches()).
const personenByProjektCache = new Map();
const screenshotsByProjektCache = new Map();

async function loadAllPersonenForProjekt(projekt) {
    if (personenByProjektCache.has(projekt.fileName)) return personenByProjektCache.get(projekt.fileName);
    const dir = await join(personenDir, projekt.data.Personenordner || "");
    const items = [];
    for (const filePath of await collectMdFilesRecursive(dir)) {
        const data = await safeReadFrontmatter(filePath);
        if (!data) continue;
        items.push({ filePath, fileName: (await basename(filePath)).replace(/\.md$/, ""), data });
    }
    personenByProjektCache.set(projekt.fileName, items);
    return items;
}

async function loadAllScreenshotsForProjekt(projekt) {
    if (screenshotsByProjektCache.has(projekt.fileName)) return screenshotsByProjektCache.get(projekt.fileName);
    const dir = await join(screenshotsDir, projekt.data.Personenordner || "");
    const items = [];
    for (const filePath of await collectMdFilesRecursive(dir)) {
        const data = await safeReadFrontmatter(filePath);
        if (!data) continue;
        items.push({ filePath, fileName: (await basename(filePath)).replace(/\.md$/, ""), data });
    }
    screenshotsByProjektCache.set(projekt.fileName, items);
    return items;
}

async function loadPersonenForEvent(projekt, event) {
    const all = await loadAllPersonenForProjekt(projekt);
    return all.filter((p) => extractWikilinkTarget(p.data.Event) === event.fileName);
}

async function loadScreenshotsForEvent(projekt, event) {
    // Screenshots haben kein eigenes Event-Feld, nur einen Link auf die Person —
    // deshalb über die (gecachten) Personen das Event jedes Screenshots auflösen.
    const personen = await loadAllPersonenForProjekt(projekt);
    const eventByPerson = new Map(personen.map((p) => [p.fileName, extractWikilinkTarget(p.data.Event)]));

    const screenshots = await loadAllScreenshotsForProjekt(projekt);
    return screenshots.filter((s) => eventByPerson.get(extractWikilinkTarget(s.data.Person)) === event.fileName);
}

async function loadPosterForEvent(projekt, event) {
    const dir = await resolveEventFolder(posterNotesDir, event.data.Name, projekt.data.Name);
    const items = [];
    if (!(await exists(dir))) return items;
    for (const entry of await readDir(dir)) {
        if (!entry.isFile || !entry.name.endsWith(".md")) continue;
        const filePath = await join(dir, entry.name);
        const data = await safeReadFrontmatter(filePath);
        if (!data) continue;
        items.push({ filePath, fileName: entry.name.replace(/\.md$/, ""), data });
    }
    return items;
}

async function loadPostitsForEvent(projekt, event) {
    const dir = await resolveEventFolder(postitsDir, event.data.Name, projekt.data.Name);
    const items = [];
    if (!(await exists(dir))) return items;
    for (const entry of await readDir(dir)) {
        if (!entry.isFile || !entry.name.endsWith(".md")) continue;
        const filePath = await join(dir, entry.name);
        const data = await safeReadFrontmatter(filePath);
        if (!data) continue;
        items.push({ filePath, fileName: entry.name.replace(/\.md$/, ""), data });
    }
    return items;
}

async function loadPostitTypen() {
    const names = [];
    if (!(await exists(postitTypenDir))) return names;
    for (const entry of await readDir(postitTypenDir)) {
        if (!entry.isFile || !entry.name.endsWith(".md")) continue;
        const data = await safeReadFrontmatter(await join(postitTypenDir, entry.name));
        if (!data?.Name) continue;
        names.push(data.Name);
    }
    return names.sort();
}

const BEREICHE = [
    { key: "personen", label: "Personen", load: loadPersonenForEvent },
    { key: "screenshots", label: "Screenshots", load: loadScreenshotsForEvent },
    { key: "poster", label: "Poster", load: loadPosterForEvent },
    { key: "postits", label: "Post-its", load: loadPostitsForEvent },
];

// renderTree() lädt bei jeder Auswahl alle Bereiche jedes aufgeklappten
// Events neu (für die Zähler) — ohne Cache wurde dieselbe Liste bei jedem
// Klick wiederholt neu gelesen, auch wenn sich nichts geändert hat.
const bereichItemsCache = new Map();

async function loadBereichCached(bereich, projekt, event) {
    const key = `${bereich.key}|${projekt.fileName}|${event.fileName}`;
    if (bereichItemsCache.has(key)) return bereichItemsCache.get(key);
    const items = await bereich.load(projekt, event);
    bereichItemsCache.set(key, items);
    return items;
}

// Nach jeder Änderung (Speichern/Löschen) alle Caches verwerfen, damit die
// nächste Anzeige wieder den aktuellen Stand liest. Grob statt fein-granular
// invalidiert — bei der Datenmenge hier kein spürbarer Nachteil, aber deutlich
// weniger fehleranfällig als jeden einzelnen Cache-Key exakt zu treffen.
function clearAllCaches() {
    personenByProjektCache.clear();
    screenshotsByProjektCache.clear();
    bereichItemsCache.clear();
}

// ---- Baum: Zustand ----
const expandedProjekte = new Set();
const expandedEvents = new Set();
let currentSelection = null;

// Erst komplett neu (inkl. aller async Unterlisten) in ein losgelöstes Fragment
// bauen und erst danach in einem Rutsch einsetzen — sonst ist der Baum
// während der ganzen Ladezeit sichtbar leer (treeEl.innerHTML = "" + viele
// awaits dazwischen führten zu einem Flackern/Verschwinden aller Einträge).
async function renderTree() {
    treeEl.classList.add("is-loading");

    const projekte = await loadProjekte();
    const fragment = document.createDocumentFragment();

    for (const projekt of projekte) {
        fragment.appendChild(await buildProjektNode(projekt));
    }

    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "manage-tree-add";
    addButton.textContent = "+ Neues Projekt";
    addButton.addEventListener("click", () => select({ kind: "neues-projekt" }));
    fragment.appendChild(addButton);

    treeEl.innerHTML = "";
    treeEl.appendChild(fragment);
    treeEl.classList.remove("is-loading");
}

function makeRow(label, { onClick, onToggle, expanded, isSelected } = {}) {
    const row = document.createElement("div");
    row.className = "manage-tree-row";
    if (isSelected) row.classList.add("is-selected");

    if (onToggle) {
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "manage-tree-toggle";
        toggle.textContent = expanded ? "▾" : "▸";
        toggle.addEventListener("click", (event) => {
            event.stopPropagation();
            onToggle();
        });
        row.appendChild(toggle);
    } else {
        const spacer = document.createElement("span");
        spacer.className = "manage-tree-toggle-spacer";
        row.appendChild(spacer);
    }

    const label_ = document.createElement("span");
    label_.className = "manage-tree-label";
    label_.textContent = label;
    row.appendChild(label_);

    if (onClick) row.addEventListener("click", onClick);
    return row;
}

async function buildProjektNode(projekt) {
    const wrapper = document.createElement("div");
    wrapper.className = "manage-tree-node";
    const isExpanded = expandedProjekte.has(projekt.fileName);
    const isSelected = currentSelection?.kind === "projekt" && currentSelection.projekt.fileName === projekt.fileName;

    wrapper.appendChild(makeRow(projekt.data.Name, {
        expanded: isExpanded,
        isSelected,
        onClick: async () => {
            expandedProjekte.add(projekt.fileName);
            await select({ kind: "projekt", projekt });
        },
        onToggle: async () => {
            if (isExpanded) expandedProjekte.delete(projekt.fileName);
            else expandedProjekte.add(projekt.fileName);
            await renderTree();
        },
    }));

    if (isExpanded) {
        const children = document.createElement("div");
        children.className = "manage-tree-children";

        const events = await loadEventsForProjekt(projekt);
        for (const event of events) {
            children.appendChild(await buildEventNode(projekt, event));
        }

        const addEventButton = document.createElement("button");
        addEventButton.type = "button";
        addEventButton.className = "manage-tree-add";
        addEventButton.textContent = "+ Neues Event";
        addEventButton.addEventListener("click", () => select({ kind: "neues-event", projekt }));
        children.appendChild(addEventButton);

        wrapper.appendChild(children);
    }

    return wrapper;
}

async function buildEventNode(projekt, event) {
    const wrapper = document.createElement("div");
    wrapper.className = "manage-tree-node";
    const isExpanded = expandedEvents.has(event.fileName);
    const isSelected = currentSelection?.kind === "event" && currentSelection.event.fileName === event.fileName;

    wrapper.appendChild(makeRow(`${formatDate(event.data.Datum)} — ${event.data.Name}`, {
        expanded: isExpanded,
        isSelected,
        onClick: async () => {
            expandedEvents.add(event.fileName);
            await select({ kind: "event", projekt, event });
        },
        onToggle: async () => {
            if (isExpanded) expandedEvents.delete(event.fileName);
            else expandedEvents.add(event.fileName);
            await renderTree();
        },
    }));

    if (isExpanded) {
        const children = document.createElement("div");
        children.className = "manage-tree-children";

        for (const bereich of BEREICHE) {
            const items = await loadBereichCached(bereich, projekt, event);
            const isBereichSelected = currentSelection?.kind === "bereich"
                && currentSelection.event.fileName === event.fileName
                && currentSelection.bereich.key === bereich.key;
            children.appendChild(makeRow(`${bereich.label} (${items.length})`, {
                isSelected: isBereichSelected,
                onClick: () => select({ kind: "bereich", projekt, event, bereich, items }),
            }));
        }

        wrapper.appendChild(children);
    }

    return wrapper;
}

let detailMode = "view";

async function select(selection) {
    currentSelection = selection;
    detailMode = "view";
    await renderTree();
    await renderDetail();
}

// ---- Detail-Ansicht ----
let currentFieldValues = {};

function fieldRow(field, rawValue, extra) {
    const wrapper = document.createElement("div");
    wrapper.className = "transcribe-field";
    const label = document.createElement("label");
    label.textContent = field.name;
    wrapper.appendChild(label);
    renderField(field, rawValue, wrapper, extra);
    return wrapper;
}

function renderField(field, rawValue, container, extra) {
    if (field.typ === "liste") {
        const textarea = document.createElement("textarea");
        textarea.rows = 3;
        textarea.placeholder = "ein Eintrag pro Zeile";
        const initial = Array.isArray(rawValue) ? rawValue : (rawValue ? [String(rawValue)] : []);
        textarea.value = initial.join("\n");
        currentFieldValues[field.name] = initial;
        textarea.addEventListener("input", () => {
            currentFieldValues[field.name] = textarea.value.split("\n").map((line) => line.trim()).filter(Boolean);
        });
        container.appendChild(textarea);
    } else if (field.typ === "liste-text") {
        // wie "liste", aber beim Speichern als ein zusammenhängender Text (Zeilenumbrüche erlaubt)
        const textarea = document.createElement("textarea");
        textarea.rows = 3;
        textarea.value = rawValue ?? "";
        currentFieldValues[field.name] = rawValue ?? "";
        textarea.addEventListener("input", () => { currentFieldValues[field.name] = textarea.value; });
        container.appendChild(textarea);
    } else if (field.typ === "zahl") {
        const input = document.createElement("input");
        input.type = "number";
        input.step = "any";
        input.value = rawValue ?? "";
        currentFieldValues[field.name] = rawValue ?? "";
        input.addEventListener("input", () => {
            currentFieldValues[field.name] = input.value === "" ? "" : Number(input.value);
        });
        container.appendChild(input);
    } else if (field.typ === "datum") {
        const input = document.createElement("input");
        input.type = "date";
        input.value = formatDate(rawValue);
        currentFieldValues[field.name] = input.value;
        input.addEventListener("input", () => { currentFieldValues[field.name] = input.value; });
        container.appendChild(input);
    } else if (field.typ === "datumzeit") {
        const input = document.createElement("input");
        input.type = "datetime-local";
        input.value = formatDateTimeLocal(rawValue);
        currentFieldValues[field.name] = input.value ? `${input.value}:00` : "";
        input.addEventListener("input", () => {
            currentFieldValues[field.name] = input.value ? `${input.value}:00` : "";
        });
        container.appendChild(input);
    } else if (field.typ === "postit-art") {
        const select = document.createElement("select");
        for (const name of extra?.postitTypen ?? []) {
            const option = document.createElement("option");
            option.value = name;
            option.textContent = name;
            select.appendChild(option);
        }
        select.value = rawValue ?? "";
        currentFieldValues[field.name] = select.value;
        select.addEventListener("change", () => { currentFieldValues[field.name] = select.value; });
        container.appendChild(select);
    } else {
        const input = document.createElement("input");
        input.type = "text";
        input.value = rawValue ?? "";
        currentFieldValues[field.name] = rawValue ?? "";
        input.addEventListener("input", () => { currentFieldValues[field.name] = input.value; });
        container.appendChild(input);
    }
}

function detailHeader(title, onDelete) {
    const header = document.createElement("div");
    header.className = "templates-editor-header";
    const h2 = document.createElement("h2");
    h2.textContent = title;
    header.appendChild(h2);
    if (onDelete) {
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "link-secondary";
        deleteButton.textContent = "Löschen";
        deleteButton.addEventListener("click", onDelete);
        header.appendChild(deleteButton);
    }
    return header;
}

// Wie renderTree(): erst komplett in ein losgelöstes Fragment bauen (inkl.
// aller async Schritte), erst danach atomar einsetzen. Zusätzlich mit einem
// Token abgesichert — klickt man z. B. zweimal schnell hintereinander, laufen
// sonst zwei Render-Durchläufe überlappend und ihre Ausgaben stapeln sich.
let detailRenderToken = 0;

async function renderDetail() {
    const myToken = ++detailRenderToken;
    detailEl.classList.add("is-loading");
    currentFieldValues = {};
    const container = document.createDocumentFragment();

    if (!currentSelection) {
        const hint = document.createElement("p");
        hint.className = "transcribe-static";
        hint.textContent = "Wähle links ein Projekt, ein Event oder einen Bereich aus.";
        container.appendChild(hint);
    } else {
        const kind = currentSelection.kind;
        if (kind === "projekt") {
            if (detailMode === "edit") await renderProjektEditForm(container, currentSelection.projekt);
            else await renderProjektView(container, currentSelection.projekt);
        } else if (kind === "neues-projekt") {
            await renderProjektEditForm(container, null);
        } else if (kind === "event") {
            if (detailMode === "edit") await renderEventEditForm(container, currentSelection.projekt, currentSelection.event);
            else await renderEventView(container, currentSelection.projekt, currentSelection.event);
        } else if (kind === "neues-event") {
            await renderEventEditForm(container, currentSelection.projekt, null);
        } else if (kind === "bereich") {
            await renderBereichDetail(container);
        } else if (kind === "item") {
            await renderItemDetail(container);
        }
    }

    if (myToken !== detailRenderToken) return;
    detailEl.innerHTML = "";
    detailEl.appendChild(container);
    detailEl.classList.remove("is-loading");
}

// Zählt die Inhalte über alle Bereiche eines einzelnen Events.
async function countBereicheForEvent(projekt, event) {
    const counts = {};
    for (const bereich of BEREICHE) {
        counts[bereich.key] = (await loadBereichCached(bereich, projekt, event)).length;
    }
    return counts;
}

function statsLine(counts) {
    return BEREICHE.map((b) => `${counts[b.key]} ${b.label}`).join(" · ");
}

function viewHeader(title, stats, editBtn) {
    const header = document.createElement("div");
    header.className = "manage-view-header";

    const h2 = document.createElement("h2");
    h2.textContent = title;
    header.appendChild(h2);

    const right = document.createElement("div");
    right.className = "manage-view-header-right";
    const statsEl = document.createElement("span");
    statsEl.className = "manage-view-stats";
    statsEl.textContent = stats;
    right.appendChild(statsEl);
    right.appendChild(editBtn);
    header.appendChild(right);

    return header;
}

function editButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "link-secondary";
    button.textContent = "Bearbeiten";
    button.addEventListener("click", async () => {
        detailMode = "edit";
        await renderDetail();
    });
    return button;
}

// Zeigt dieselben Felder wie das Bearbeiten-Formular, nur als reiner Text —
// sonst ist die Ansicht vor dem Klick auf "Bearbeiten" fast leer.
function renderFieldValues(container, fields, data) {
    const dl = document.createElement("dl");
    dl.className = "manage-inspect-list";
    for (const field of fields) {
        const dt = document.createElement("dt");
        dt.textContent = field.name;
        const dd = document.createElement("dd");
        dd.textContent = formatDisplayValue(data?.[field.name]);
        dl.append(dt, dd);
    }
    container.appendChild(dl);
}

async function renderProjektView(container, projekt) {
    const events = await loadEventsForProjekt(projekt);
    const totals = {};
    for (const bereich of BEREICHE) totals[bereich.key] = 0;
    for (const event of events) {
        const counts = await countBereicheForEvent(projekt, event);
        for (const bereich of BEREICHE) totals[bereich.key] += counts[bereich.key];
    }

    container.appendChild(viewHeader(projekt.data.Name, `${events.length} Events · ${statsLine(totals)}`, editButton()));
    renderFieldValues(container, PROJEKT_FIELDS, projekt.data);
}

async function renderProjektEditForm(container, entry) {
    container.appendChild(detailHeader(entry ? entry.data.Name : "Neues Projekt", entry ? () => deleteProjekt(entry) : null));

    const form = document.createElement("div");
    form.className = "manage-form";
    for (const field of PROJEKT_FIELDS) form.appendChild(fieldRow(field, entry?.data?.[field.name]));
    container.appendChild(form);

    const actions = document.createElement("div");
    actions.className = "manage-form-actions";

    if (entry) {
        const cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.className = "link-secondary";
        cancelButton.textContent = "Abbrechen";
        cancelButton.addEventListener("click", async () => {
            detailMode = "view";
            await renderDetail();
        });
        actions.appendChild(cancelButton);
    }

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "btn btn-primary btn-shadow-inset";
    saveButton.textContent = "Speichern";
    saveButton.addEventListener("click", () => saveProjekt(entry));
    actions.appendChild(saveButton);

    container.appendChild(actions);
}

async function saveProjekt(entry) {
    if (!currentFieldValues.Name?.trim()) return;
    const filePath = await join(projekteDir, `Projekt_${currentFieldValues.Name}.md`);
    const data = {};
    for (const field of PROJEKT_FIELDS) data[field.name] = currentFieldValues[field.name];

    await mkdir(projekteDir, { recursive: true });
    await writeNote(filePath, data);
    if (entry && entry.filePath !== filePath) await remove(entry.filePath);
    clearAllCaches();

    const fileName = (await basename(filePath)).replace(/\.md$/, "");
    await select({ kind: "projekt", projekt: { filePath, fileName, data } });
}

async function deleteProjekt(entry) {
    const confirmed = await confirm(
        `Projekt "${entry.data.Name}" wirklich löschen? Events, die darauf verweisen, bleiben bestehen, verlieren aber ihren Projekt-Link. Das kann nicht rückgängig gemacht werden.`,
        { title: "Löschen bestätigen", kind: "warning" }
    );
    if (!confirmed) return;
    await remove(entry.filePath);
    clearAllCaches();
    await select(null);
}

async function renderEventView(container, projekt, event) {
    const counts = await countBereicheForEvent(projekt, event);
    container.appendChild(viewHeader(`${event.data.Name} (${formatDate(event.data.Datum)})`, statsLine(counts), editButton()));
    renderFieldValues(container, EVENT_FIELDS, event.data);
}

async function renderEventEditForm(container, projekt, entry) {
    container.appendChild(detailHeader(entry ? entry.data.Name : "Neues Event", entry ? () => deleteEvent(entry) : null));

    const form = document.createElement("div");
    form.className = "manage-form";

    // Projekt ist durch die Baum-Position vorgegeben, aber weiterhin änderbar
    const projekte = await loadProjekte();
    const projektWrapper = document.createElement("div");
    projektWrapper.className = "transcribe-field";
    const projektLabel = document.createElement("label");
    projektLabel.textContent = "Projekt";
    projektWrapper.appendChild(projektLabel);
    const projektSelect = document.createElement("select");
    for (const p of projekte) {
        const option = document.createElement("option");
        option.value = p.fileName;
        option.textContent = p.data.Name;
        projektSelect.appendChild(option);
    }
    const currentProjektFile = entry ? extractWikilinkTarget(entry.data.Projekt) : projekt.fileName;
    if (currentProjektFile) projektSelect.value = currentProjektFile;
    currentFieldValues.Projekt = projektSelect.value;
    projektSelect.addEventListener("change", () => { currentFieldValues.Projekt = projektSelect.value; });
    projektWrapper.appendChild(projektSelect);
    form.appendChild(projektWrapper);

    for (const field of EVENT_FIELDS) form.appendChild(fieldRow(field, entry?.data?.[field.name]));
    container.appendChild(form);

    const actions = document.createElement("div");
    actions.className = "manage-form-actions";

    if (entry) {
        const cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.className = "link-secondary";
        cancelButton.textContent = "Abbrechen";
        cancelButton.addEventListener("click", async () => {
            detailMode = "view";
            await renderDetail();
        });
        actions.appendChild(cancelButton);
    }

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "btn btn-primary btn-shadow-inset";
    saveButton.textContent = "Speichern";
    saveButton.addEventListener("click", () => saveEvent(entry));
    actions.appendChild(saveButton);

    container.appendChild(actions);
}

async function saveEvent(entry) {
    if (!currentFieldValues.Name?.trim() || !currentFieldValues.Projekt) return;
    const namePart = currentFieldValues.Name.replace(/\s+/g, "-");
    const filePath = await join(eventsDir, `Event_${currentFieldValues.Datum}_${namePart}.md`);

    const data = { ...(entry?.data ?? {}) };
    data.Projekt = `[[${currentFieldValues.Projekt}]]`;
    for (const field of EVENT_FIELDS) data[field.name] = currentFieldValues[field.name];

    await mkdir(eventsDir, { recursive: true });
    await writeNote(filePath, data);
    if (entry && entry.filePath !== filePath) await remove(entry.filePath);
    clearAllCaches();

    const projekte = await loadProjekte();
    const projekt = projekte.find((p) => p.fileName === currentFieldValues.Projekt);
    const fileName = (await basename(filePath)).replace(/\.md$/, "");
    expandedProjekte.add(projekt.fileName);
    await select({ kind: "event", projekt, event: { filePath, fileName, data } });
}

async function deleteEvent(entry) {
    const confirmed = await confirm(
        `Event "${entry.data.Name}" wirklich löschen? Verknüpfte Personen/Screenshots/Poster/Post-its bleiben als Dateien bestehen. Das kann nicht rückgängig gemacht werden.`,
        { title: "Löschen bestätigen", kind: "warning" }
    );
    if (!confirmed) return;
    await remove(entry.filePath);
    clearAllCaches();
    await select(null);
}

async function renderBereichDetail(container) {
    const { projekt, event, bereich, items } = currentSelection;
    container.appendChild(detailHeader(`${bereich.label} — ${event.data.Name}`));

    if (items.length === 0) {
        const empty = document.createElement("p");
        empty.className = "transcribe-static";
        empty.textContent = "Nichts gefunden.";
        container.appendChild(empty);
        return;
    }

    const list = document.createElement("ul");
    list.className = "manage-item-list";

    // Poster-Namen für die Post-its-Liste auflösen, damit man nicht nur den
    // Dateinamen des Posters sieht.
    let posterNameByFile = new Map();
    if (bereich.key === "postits") {
        const posters = await loadPosterForEvent(projekt, event);
        posterNameByFile = new Map(posters.map((p) => [p.fileName, p.data.Name]));
    }

    for (const item of items) {
        const row = document.createElement("li");
        row.className = "manage-item-row";

        const label = document.createElement("span");
        label.textContent = itemSummary(bereich.key, item, posterNameByFile);
        row.appendChild(label);

        const actions = document.createElement("span");
        actions.className = "manage-item-actions";

        const inspectButton = document.createElement("button");
        inspectButton.type = "button";
        inspectButton.className = "link-secondary";
        inspectButton.textContent = bereich.key === "poster" || bereich.key === "postits" ? "Bearbeiten" : "Ansehen";
        inspectButton.addEventListener("click", () => select({ kind: "item", projekt, event, bereich, item }));
        actions.appendChild(inspectButton);

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "link-secondary";
        deleteButton.textContent = "Löschen";
        deleteButton.addEventListener("click", () => deleteItem(bereich, item));
        actions.appendChild(deleteButton);

        row.appendChild(actions);
        list.appendChild(row);
    }

    container.appendChild(list);
}

function itemSummary(bereichKey, item, posterNameByFile) {
    const data = item.data;
    if (bereichKey === "personen") {
        return `${item.fileName} — ${data.Personengruppe ?? ""} ${data.Geschlecht ?? ""}`.trim();
    }
    if (bereichKey === "screenshots") {
        return `${data.ID ?? item.fileName} — ${extractWikilinkTarget(data["Screenshot Vorlage"]) ?? ""}`;
    }
    if (bereichKey === "poster") {
        return data.Name ?? item.fileName;
    }
    if (bereichKey === "postits") {
        const posterName = posterNameByFile.get(extractWikilinkTarget(data.Poster)) ?? extractWikilinkTarget(data.Poster);
        return `#${data.Nummer} · ${data["Postit-art"] ?? ""} · ${posterName}`;
    }
    return item.fileName;
}

async function deleteItem(bereich, item) {
    const confirmed = await confirm(
        `"${item.fileName}" wirklich löschen? Das kann nicht rückgängig gemacht werden.`,
        { title: "Löschen bestätigen", kind: "warning" }
    );
    if (!confirmed) return;
    await remove(item.filePath);
    clearAllCaches();
    // Bereich-Liste neu laden und wieder anzeigen
    const { projekt, event } = currentSelection;
    const items = await bereich.load(projekt, event);
    await select({ kind: "bereich", projekt, event, bereich, items });
}

async function renderItemDetail(container) {
    const { projekt, event, bereich, item } = currentSelection;

    if (bereich.key === "poster") {
        await renderPosterItemDetail(container, projekt, event, item);
        return;
    }
    if (bereich.key === "postits") {
        await renderPostitItemDetail(container, projekt, event, item);
        return;
    }

    // Personen/Screenshots: nur lesbare Ansicht, keine Bearbeitung — die
    // Felder kommen aus frei wählbaren Templates, ein generischer Editor
    // dafür ist ein eigenes, größeres Stück Arbeit.
    container.appendChild(detailHeader(item.fileName, () => deleteItem(bereich, item)));

    const hint = document.createElement("p");
    hint.className = "transcribe-static";
    hint.textContent = "Nur ansehen — Bearbeiten der Inhalte kommt in einem späteren Schritt (über die Templates von Transkribieren).";
    container.appendChild(hint);

    const dl = document.createElement("dl");
    dl.className = "manage-inspect-list";
    for (const [key, value] of Object.entries(item.data)) {
        const dt = document.createElement("dt");
        dt.textContent = key;
        const dd = document.createElement("dd");
        dd.textContent = formatDisplayValue(value);
        dl.append(dt, dd);
    }
    container.appendChild(dl);
}

async function renderPosterItemDetail(container, projekt, event, item) {
    container.appendChild(detailHeader(item.data.Name, () => deleteItem(BEREICHE.find((b) => b.key === "poster"), item)));

    const form = document.createElement("div");
    form.className = "manage-form";
    form.appendChild(fieldRow({ name: "Name", typ: "text" }, item.data.Name));

    const szenariobildRow = document.createElement("div");
    szenariobildRow.className = "transcribe-field";
    const szenariobildLabel = document.createElement("label");
    szenariobildLabel.textContent = "Szenariobild";
    const szenariobildValue = document.createElement("div");
    szenariobildValue.className = "transcribe-static";
    szenariobildValue.textContent = extractWikilinkTarget(item.data.Szenariobild) ?? "–";
    szenariobildRow.append(szenariobildLabel, szenariobildValue);
    form.appendChild(szenariobildRow);

    container.appendChild(form);

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "btn btn-primary btn-shadow-inset";
    saveButton.textContent = "Speichern";
    saveButton.addEventListener("click", async () => {
        if (!currentFieldValues.Name?.trim()) return;
        const dir = await dirname(item.filePath);
        const filePath = await join(dir, `Poster_${currentFieldValues.Name}.md`);
        await writeNote(filePath, { Name: currentFieldValues.Name, Szenariobild: item.data.Szenariobild });
        if (filePath !== item.filePath) await remove(item.filePath);
        clearAllCaches();

        const bereich = BEREICHE.find((b) => b.key === "poster");
        const items = await bereich.load(projekt, event);
        await select({ kind: "bereich", projekt, event, bereich, items });
    });
    container.appendChild(saveButton);
}

async function renderPostitItemDetail(container, projekt, event, item) {
    const bereich = BEREICHE.find((b) => b.key === "postits");
    container.appendChild(detailHeader(`Post-it #${item.data.Nummer}`, () => deleteItem(bereich, item)));

    const postitTypen = await loadPostitTypen();
    const form = document.createElement("div");
    form.className = "manage-form";
    for (const field of POSTIT_FIELDS) form.appendChild(fieldRow(field, item.data[field.name], { postitTypen }));

    const posterRow = document.createElement("div");
    posterRow.className = "transcribe-field";
    const posterLabel = document.createElement("label");
    posterLabel.textContent = "Poster";
    const posterValue = document.createElement("div");
    posterValue.className = "transcribe-static";
    posterValue.textContent = extractWikilinkTarget(item.data.Poster) ?? "–";
    posterRow.append(posterLabel, posterValue);
    form.appendChild(posterRow);

    container.appendChild(form);

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "btn btn-primary btn-shadow-inset";
    saveButton.textContent = "Speichern";
    saveButton.addEventListener("click", async () => {
        if (!currentFieldValues.Nummer?.trim()) return;
        const data = { ...item.data };
        for (const field of POSTIT_FIELDS) data[field.name] = currentFieldValues[field.name];

        // Dateiname folgt "postit_<Poster>_<Nummer>.md" (siehe postits.js) — bei
        // geänderter Nummer also mit umbenennen, sonst laufen Name und Inhalt auseinander.
        const posterFileName = extractWikilinkTarget(item.data.Poster);
        const posterName = posterFileName?.replace(/^Poster_/, "") ?? posterFileName;
        const dir = await dirname(item.filePath);
        const filePath = await join(dir, `postit_${posterName}_${currentFieldValues.Nummer}.md`);

        await writeNote(filePath, data);
        if (filePath !== item.filePath) await remove(item.filePath);
        clearAllCaches();

        const items = await bereich.load(projekt, event);
        await select({ kind: "bereich", projekt, event, bereich, items });
    });
    container.appendChild(saveButton);
}

// ---- Start ----
await renderTree();
await renderDetail();
