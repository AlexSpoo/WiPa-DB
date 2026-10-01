import { invoke } from "@tauri-apps/api/core";
import { join, basename } from "@tauri-apps/api/path";
import { readDir, readTextFile, writeTextFile, exists } from "@tauri-apps/plugin-fs";
import { load as loadYaml, dump as dumpYaml } from "js-yaml";
import { load as loadStore } from "@tauri-apps/plugin-store";

// ---- HTML Elemente ----
const batchesView = document.querySelector("#tag-batches");
const batchListEl = document.querySelector("#tag-batch-list");
const batchesEmptyEl = document.querySelector("#tag-batches-empty");

const reviewView = document.querySelector("#tag-review-view");
const eventLabelEl = document.querySelector("#tag-event-label");
const progressEl = document.querySelector("#tag-progress");
const backButton = document.querySelector("#tag-back-to-batches");

const codesInput = document.querySelector("#tag-codes-input");
const interessantSelect = document.querySelector("#tag-interessant-select");
const contextListEl = document.querySelector("#tag-context-list");

const prevButton = document.querySelector("#tag-prev-button");
const nextButton = document.querySelector("#tag-next-button");

// ---- Vault-Grundlagen ----
const store = await loadStore("settings.json", { autoSave: false });
const activeVault = await store.get("activeVault");
await invoke("expand_scope", { folderPath: activeVault });

const projekteDir = await join(activeVault, "Projekte");
const eventsDir = await join(activeVault, "Events");
const personenDir = await join(activeVault, "Personen");
const screenshotsDir = await join(activeVault, "Screenshots");

// Felder, die schon als eigene Eingabe angezeigt werden — im "Bisherige
// Daten"-Kontext nicht nochmal wiederholen. Szenario/Topics bleiben bewusst
// sichtbar (bestehende Werte aus der alten MaxQDA-Auswertung), werden hier
// aber nicht bearbeitet — das kommt erst in Phase 2.
//
// Heißt bewusst "Codes" und nicht "Tags": Obsidian behandelt ein Frontmatter-
// Feld namens "tags" speziell (eigenes Tag-System, keine Leerzeichen erlaubt),
// unsere Codes sollen aber möglichst nah am genauen Wortlaut bleiben.
const HIDDEN_CONTEXT_FIELDS = new Set(["Codes", "interessantes Beispiel"]);

// Stammdaten-artige Felder treten beim Vertaggen in den Hintergrund — der
// eigentliche Inhalt (O-Töne, Eindrücke, etc. bzw. bei Screenshots die
// Template-Felder) soll im Blick stehen, nicht Geschlecht/Alter/Ort.
const MUTED_CONTEXT_FIELDS = new Set([
    "Geschlecht", "Alter geschätzt", "Personengruppe", "Leitfrage", "Ort",
    "Projektpartner", "Quartier", "Event", "Datum und Uhrzeit", "Zeitangaben",
    "Related Protokolle", "Screenshot Vorlage", "ID",
]);

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

// Manche Standort-Ordner haben die Notizen direkt drin, andere nochmal in
// Event-Unterordnern (MOSAIQ) — rekursiv suchen (siehe transcribe.js/manage.js).
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
    return list;
}

async function loadAllEvents() {
    const projekte = await loadProjekte();
    const projektByFile = new Map(projekte.map((p) => [p.fileName, p]));
    const list = [];
    if (!(await exists(eventsDir))) return list;
    for (const entry of await readDir(eventsDir)) {
        if (!entry.isFile || !entry.name.endsWith(".md")) continue;
        const filePath = await join(eventsDir, entry.name);
        const data = await safeReadFrontmatter(filePath);
        if (!data?.Name) continue;
        const projekt = projektByFile.get(extractWikilinkTarget(data.Projekt));
        if (!projekt) continue;
        list.push({ filePath, fileName: entry.name.replace(/\.md$/, ""), data, projekt });
    }
    list.sort((a, b) => formatDate(a.data.Datum).localeCompare(formatDate(b.data.Datum)));
    return list;
}

// Personen/Screenshots liegen pro PROJEKT in einem Ordner, nicht pro Event —
// deshalb einmal pro Projekt einlesen und nach Event filtern (siehe manage.js).
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
    // Screenshots haben kein eigenes Event-Feld, nur einen Link auf die Person.
    const personen = await loadAllPersonenForProjekt(projekt);
    const eventByPerson = new Map(personen.map((p) => [p.fileName, extractWikilinkTarget(p.data.Event)]));
    const screenshots = await loadAllScreenshotsForProjekt(projekt);
    return screenshots.filter((s) => eventByPerson.get(extractWikilinkTarget(s.data.Person)) === event.fileName);
}

// ---- Batch-Liste ----
async function buildBatches() {
    const events = await loadAllEvents();
    const batches = [];
    for (const event of events) {
        const personen = await loadPersonenForEvent(event.projekt, event);
        const screenshots = await loadScreenshotsForEvent(event.projekt, event);
        if (personen.length === 0 && screenshots.length === 0) continue;
        batches.push({ event, personen, screenshots });
    }
    return batches;
}

function renderBatchList(batches) {
    batchListEl.innerHTML = "";
    batchesEmptyEl.classList.toggle("is-hidden", batches.length > 0);

    for (const batch of batches) {
        const item = document.createElement("li");
        item.className = "transcribe-batch-item";
        item.textContent = `${batch.event.data.Name} — ${batch.personen.length} Personen, ${batch.screenshots.length} Screenshots`;
        item.addEventListener("click", () => startQueue(batch));
        batchListEl.appendChild(item);
    }
}

// ---- Review-Warteschlange ----
let currentEvent = null;
let queue = [];
let currentIndex = 0;

async function startQueue(batch) {
    currentEvent = batch.event;
    queue = [
        ...batch.personen.map((p) => ({ kind: "person", ...p })),
        ...batch.screenshots.map((s) => ({ kind: "screenshot", ...s })),
    ];
    currentIndex = 0;

    batchesView.classList.add("is-hidden");
    reviewView.classList.remove("is-hidden");
    eventLabelEl.textContent = batch.event.data.Name;

    await loadItem(0);
}

backButton.addEventListener("click", async () => {
    reviewView.classList.add("is-hidden");
    batchesView.classList.remove("is-hidden");
    renderBatchList(await buildBatches());
});

async function loadItem(index) {
    currentIndex = index;
    const item = queue[index];

    progressEl.textContent = `${item.kind === "person" ? "Person" : "Screenshot"} — ${index + 1} / ${queue.length}`;

    codesInput.value = (Array.isArray(item.data.Codes) ? item.data.Codes : []).join("\n");
    const interessant = Array.isArray(item.data["interessantes Beispiel"]) ? item.data["interessantes Beispiel"][0] : "";
    interessantSelect.value = interessant === "ja" || interessant === "nein" ? interessant : "";

    contextListEl.innerHTML = "";
    for (const [key, value] of Object.entries(item.data)) {
        if (HIDDEN_CONTEXT_FIELDS.has(key)) continue;
        const isMuted = MUTED_CONTEXT_FIELDS.has(key);

        const dt = document.createElement("dt");
        dt.textContent = key;
        dt.classList.toggle("is-muted", isMuted);

        const dd = document.createElement("dd");
        dd.textContent = formatDisplayValue(value);
        dd.classList.toggle("is-muted", isMuted);
        dd.classList.toggle("is-emphasized", !isMuted);

        contextListEl.append(dt, dd);
    }

    prevButton.disabled = index === 0;
    nextButton.textContent = index === queue.length - 1 ? "Speichern & fertig" : "Speichern & weiter";
}

async function saveCurrentItem() {
    const item = queue[currentIndex];
    if (!item) return;

    const data = { ...item.data };
    data.Codes = codesInput.value.split("\n").map((line) => line.trim()).filter(Boolean);
    data["interessantes Beispiel"] = interessantSelect.value ? [interessantSelect.value] : [];

    await writeNote(item.filePath, data);
    item.data = data;
}

prevButton.addEventListener("click", async () => {
    if (currentIndex === 0) return;
    await saveCurrentItem();
    await loadItem(currentIndex - 1);
});

nextButton.addEventListener("click", async () => {
    await saveCurrentItem();
    if (currentIndex === queue.length - 1) {
        reviewView.classList.add("is-hidden");
        batchesView.classList.remove("is-hidden");
        renderBatchList(await buildBatches());
        return;
    }
    await loadItem(currentIndex + 1);
});

// ---- Start ----
renderBatchList(await buildBatches());
