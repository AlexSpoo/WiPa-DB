import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { join, basename } from "@tauri-apps/api/path";
import { readDir, readTextFile, writeTextFile, mkdir, exists, remove } from "@tauri-apps/plugin-fs";
import { load as loadYaml } from "js-yaml";
import { load as loadStore } from "@tauri-apps/plugin-store";

const batchesView = document.querySelector("#transcribe-batches");
const batchListEl = document.querySelector("#transcribe-batch-list");
const batchesEmptyEl = document.querySelector("#transcribe-batches-empty");

const editView = document.querySelector("#transcribe-edit-view");
const eventLabelEl = document.querySelector("#transcribe-event-label");
const imageNameEl = document.querySelector("#transcribe-image-name");
const backToBatchesButton = document.querySelector("#transcribe-back-to-batches");
const formEl = document.querySelector("#transcribe-form");
const imageEl = document.querySelector("#transcribe-image");
const imageBoxEl = document.querySelector(".transcribe-image-box");
const imageColumnEl = document.querySelector(".transcribe-image-column");
const prevPersonButton = document.querySelector("#transcribe-prev-person-button");
const saveMoreButton = document.querySelector("#transcribe-save-more-button");
const nextButton = document.querySelector("#transcribe-next-button");
const templatePickerBox = document.querySelector("#transcribe-template-picker");
const templateSelect = document.querySelector("#transcribe-template-select");
const lightboxEl = document.querySelector("#transcribe-lightbox");
const lightboxImageEl = document.querySelector("#transcribe-lightbox-image");

function openLightbox() {
    if (!imageEl.src) return;
    lightboxImageEl.src = imageEl.src;
    lightboxEl.classList.remove("is-hidden");
}

function closeLightbox() {
    lightboxEl.classList.add("is-hidden");
    lightboxImageEl.src = "";
}

imageBoxEl.addEventListener("click", openLightbox);
lightboxEl.addEventListener("click", closeLightbox);
window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeLightbox();
});

// Ein <img> mit width/height:100% in einer sich selbst schrumpfenden Box lässt sich mit
// reinem CSS nicht sauber begrenzen (der Browser rechnet beim Bestimmen der Box-Breite mit
// der vollen Bildbreite, bevor die Prozentangabe überhaupt greifen kann). Deshalb hier die
// Boxgröße direkt anhand des echten Seitenverhältnisses berechnen.
function fitImageBox() {
    if (!imageEl.naturalWidth || !imageEl.naturalHeight) return;
    const availableWidth = imageColumnEl.clientWidth;
    const availableHeight = imageColumnEl.clientHeight;
    const scale = Math.min(availableWidth / imageEl.naturalWidth, availableHeight / imageEl.naturalHeight);
    imageBoxEl.style.width = `${imageEl.naturalWidth * scale}px`;
    imageBoxEl.style.height = `${imageEl.naturalHeight * scale}px`;
}

imageEl.addEventListener("load", fitImageBox);
window.addEventListener("resize", fitImageBox);

const store = await loadStore("settings.json", { autoSave: false });
const activeVault = await store.get("activeVault");
await invoke("expand_scope", { folderPath: activeVault });

const protokollDir = await join(activeVault, "Media", "Images", "Protokolle(RAW)");
const screenshotsRawDir = await join(activeVault, "Media", "Images", "Screenshots(RAW)");
const personenDir = await join(activeVault, "Personen");
const screenshotsDir = await join(activeVault, "Screenshots");
const templatesDir = await join(activeVault, "Einstellungen", "Templates");

function extractWikilinkTarget(value) {
    if (typeof value !== "string") return null;
    const match = value.match(/\[\[(.+?)\]\]/);
    return match ? match[1] : value;
}

async function readFrontmatter(filePath) {
    const raw = await readTextFile(filePath);
    return loadYaml(raw.split("---")[1]);
}

// Für Sammel-Durchläufe über viele Notizen: eine einzelne kaputte Datei (z. B.
// ungültiges YAML) soll nicht die ganze Liste/Suche abbrechen, sondern nur
// diese eine Notiz überspringen.
async function safeReadFrontmatter(filePath) {
    try {
        return await readFrontmatter(filePath);
    } catch (err) {
        console.warn(`Konnte Frontmatter nicht lesen, überspringe: ${filePath}`, err);
        return null;
    }
}

async function loadNamingRules(typeKey) {
    const rulesPath = await join(activeVault, "Einstellungen", "naming-rules.md");
    const data = await readFrontmatter(rulesPath);
    return data[typeKey];
}

// Projekte einlesen, Personenordner-Zuordnung (z. B. ReFuMoLab -> "Garching")
const projektInfo = {};
const projekteDir = await join(activeVault, "Projekte");
for (const entry of await readDir(projekteDir)) {
    if (!entry.isFile || !entry.name.endsWith(".md")) continue;
    const data = await readFrontmatter(await join(projekteDir, entry.name));
    if (!data?.Name) continue;
    projektInfo[entry.name.replace(/\.md$/, "")] = {
        name: data.Name,
        personenordner: data.Personenordner ?? "",
    };
}

// Events einlesen
const eventInfo = {};
const eventsDir = await join(activeVault, "Events");
for (const entry of await readDir(eventsDir)) {
    if (!entry.isFile || !entry.name.endsWith(".md")) continue;
    const data = await readFrontmatter(await join(eventsDir, entry.name));
    if (!data?.Name || !data?.Datum) continue;

    const projektNoteName = extractWikilinkTarget(data.Projekt);
    const projekt = projektInfo[projektNoteName];

    eventInfo[data.Name] = {
        date: formatDate(data.Datum),
        fileName: entry.name.replace(/\.md$/, ""),
        projektName: projekt?.name ?? "",
        personenordner: projekt?.personenordner ?? "",
        orte: Array.isArray(data.Orte) ? data.Orte : (data.Orte ? [data.Orte] : []),
        protokollTemplate: extractWikilinkTarget(data.ProtokollTemplate),
    };
}

// Bekannte Bereiche für "automatisch"-Felder mit Pfad wie "Event.Projekt.Name" —
// dieselbe Registry wie in Templates verwalten, hier fürs tatsächliche Auflösen
// beim Transkribieren gebraucht.
const BEREICH_FOLDERS = { Event: eventsDir, Projekt: projekteDir };

async function findNoteInKnownBereiche(name) {
    for (const dir of Object.values(BEREICH_FOLDERS)) {
        const path = await join(dir, `${name}.md`);
        if (await exists(path)) return path;
    }
    return null;
}

// Läuft einen Pfad wie "Event.Projekt.Name" ab: erster Schritt ist der
// Startbereich (aktuell immer das laufende Event), jeder weitere Schritt ist
// ein Feldname; zeigt der Wert auf eine verlinkte Notiz und ist noch nicht das
// letzte Segment, wird dort weitergelesen.
async function resolveAutomaticValue(quelle) {
    if (!quelle) return "";
    const segments = quelle.split(".").filter(Boolean);
    const startBereich = segments.shift();
    if (startBereich !== "Event") return "";

    let notePath = await join(eventsDir, `${currentBatch.info.fileName}.md`);
    let data = await readFrontmatter(notePath);

    for (let i = 0; i < segments.length; i++) {
        const rawValue = data?.[segments[i]];
        if (i === segments.length - 1) {
            if (Array.isArray(rawValue)) return rawValue;
            if (rawValue instanceof Date) return formatDate(rawValue);
            return typeof rawValue === "string" ? rawValue : (rawValue ?? "");
        }
        const targetName = extractWikilinkTarget(rawValue);
        const nextPath = targetName ? await findNoteInKnownBereiche(targetName) : null;
        if (!nextPath) return "";
        data = await readFrontmatter(nextPath);
    }
    return "";
}

function formatDate(value) {
    if (!(value instanceof Date)) return value;
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

// Template-Konfiguration für die Personen-Eingabemaske — wird pro Event aus dessen
// zugewiesenem ProtokollTemplate geladen (Templates verwalten → Event-Zuordnung),
// nicht mehr fest verdrahtet.
let templateFields = [];

async function loadTemplateFields(templateName) {
    const filePath = await join(templatesDir, "Personen", `${templateName}.md`);
    if (!(await exists(filePath))) return null;
    const data = await readFrontmatter(filePath);
    return data.felder ?? [];
}

async function listScreenshotTemplateNames() {
    const dir = await join(templatesDir, "Screenshots");
    if (!(await exists(dir))) return [];
    return (await readDir(dir))
        .filter((entry) => entry.isFile && entry.name.endsWith(".md"))
        .map((entry) => entry.name.replace(/\.md$/, ""))
        .sort();
}

async function loadScreenshotTemplateFields(templateName) {
    const filePath = await join(templatesDir, "Screenshots", `${templateName}.md`);
    if (!(await exists(filePath))) return [];
    const data = await readFrontmatter(filePath);
    return data.felder ?? [];
}

async function resolveEventFolder(baseDir, eventName) {
    const plainPath = await join(baseDir, eventName);
    if (await exists(plainPath)) return plainPath;

    const projektName = eventInfo[eventName]?.projektName;
    if (projektName) {
        const projectPath = await join(baseDir, `${projektName} ${eventName}`);
        if (await exists(projectPath)) return projectPath;
    }

    return plainPath;
}

// Manche Standort-Ordner haben die Notizen direkt drin (Garching, IAA), andere
// nochmal in Event-Unterordnern (MOSAIQ: Moosach/Schwabing) — deshalb rekursiv
// suchen, statt nur eine Ordnerebene tief zu lesen.
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

// Schon vorhandene Personen-Notizen eines Personenordners einlesen, um
// bereits transkribierte Protokoll-Bilder herauszufiltern und die nächste
// freie Personennummer zu bestimmen.
async function loadExistingPersons(personenordner) {
    const dir = await join(personenDir, personenordner);
    const persons = [];

    for (const filePath of await collectMdFilesRecursive(dir)) {
        const data = await safeReadFrontmatter(filePath);
        if (!data) continue;
        const fileName = (await basename(filePath)).replace(/\.md$/, "");
        persons.push({
            fileName,
            protokollBild: extractWikilinkTarget(data?.ProtokollBild),
            datum: data?.["Datum und Uhrzeit"] instanceof Date
                ? formatDate(data["Datum und Uhrzeit"])
                : (typeof data?.["Datum und Uhrzeit"] === "string" ? data["Datum und Uhrzeit"].slice(0, 10) : null),
        });
    }
    return persons;
}

function nextBaseNumber(existingPersons, datum, digits) {
    const pattern = new RegExp(`^Person_${datum}_(\\d+)$`);
    let highest = 0;
    for (const person of existingPersons) {
        const match = person.fileName.match(pattern);
        if (!match) continue;
        const number = parseInt(match[1], 10);
        if (number < 100 && number > highest) highest = number;
    }
    return String(highest + 1).padStart(digits, "0");
}

// ---- Batch-Übersicht ----

async function buildPersonenBatches() {
    const batches = [];
    const usedImagesByOrdner = new Map();

    for (const eventName of Object.keys(eventInfo)) {
        const info = eventInfo[eventName];
        if (!info.personenordner) continue;

        const eventFolder = await resolveEventFolder(protokollDir, eventName);
        if (!(await exists(eventFolder))) continue;

        const images = (await readDir(eventFolder))
            .filter((entry) => entry.isFile && /\.(jpg|jpeg|png)$/i.test(entry.name))
            .map((entry) => entry.name)
            .sort();
        if (images.length === 0) continue;

        if (!usedImagesByOrdner.has(info.personenordner)) {
            const existingPersons = await loadExistingPersons(info.personenordner);
            usedImagesByOrdner.set(info.personenordner, new Set(existingPersons.map((p) => p.protokollBild).filter(Boolean)));
        }
        const usedImages = usedImagesByOrdner.get(info.personenordner);
        const openImages = images.filter((name) => !usedImages.has(name));
        if (openImages.length === 0) continue;

        const hasTemplate = info.protokollTemplate
            ? await exists(await join(templatesDir, "Personen", `${info.protokollTemplate}.md`))
            : false;

        batches.push({ bereich: "Personen", eventName, eventFolder, openImages, info, hasTemplate });
    }
    return batches;
}

async function collectExistingScreenshotIds(personenordner) {
    const dir = await join(screenshotsDir, personenordner);
    const ids = new Set();
    for (const filePath of await collectMdFilesRecursive(dir)) {
        const fileName = (await basename(filePath)).replace(/\.md$/, "");
        if (fileName.startsWith("Screenshot_")) ids.add(fileName.slice("Screenshot_".length));
    }
    return ids;
}

async function buildScreenshotBatches() {
    const batches = [];
    const existingIdsByOrdner = new Map();

    for (const eventName of Object.keys(eventInfo)) {
        const info = eventInfo[eventName];
        if (!info.personenordner) continue;

        const eventFolder = await resolveEventFolder(screenshotsRawDir, eventName);
        if (!(await exists(eventFolder))) continue;

        const images = (await readDir(eventFolder))
            .filter((entry) => entry.isFile && /\.(jpg|jpeg|png)$/i.test(entry.name))
            .map((entry) => entry.name)
            .sort();
        if (images.length === 0) continue;

        if (!existingIdsByOrdner.has(info.personenordner)) {
            existingIdsByOrdner.set(info.personenordner, await collectExistingScreenshotIds(info.personenordner));
        }
        const existingIds = existingIdsByOrdner.get(info.personenordner);
        const openImages = images.filter((imageName) => !existingIds.has(imageName.replace(/\.[^.]+$/, "")));
        if (openImages.length === 0) continue;

        batches.push({ bereich: "Screenshots", eventName, eventFolder, openImages, info, hasTemplate: true });
    }
    return batches;
}

async function buildBatches() {
    const personen = await buildPersonenBatches();
    const screenshots = await buildScreenshotBatches();
    return [...personen, ...screenshots];
}

function renderBatchList(batches) {
    batchListEl.innerHTML = "";
    batchesEmptyEl.classList.toggle("is-hidden", batches.length > 0);

    for (const batch of batches) {
        const item = document.createElement("li");
        item.className = "transcribe-batch-item";
        const label = batch.bereich === "Personen" ? "Protokoll-Bild(er)" : "Screenshot-Bild(er)";
        if (!batch.hasTemplate) {
            item.classList.add("is-disabled");
            item.textContent = `${batch.eventName} — ${batch.bereich} — ${batch.openImages.length} offene ${label} (kein Protokoll-Template zugewiesen, siehe Templates verwalten → Event-Zuordnung)`;
        } else {
            item.textContent = `${batch.eventName} — ${batch.bereich} — ${batch.openImages.length} offene ${label}`;
            item.addEventListener("click", () => {
                window.location.href = `/pages/transcribe.html?event=${encodeURIComponent(batch.eventName)}&bereich=${encodeURIComponent(batch.bereich)}`;
            });
        }
        batchListEl.appendChild(item);
    }
}

// ---- Bearbeitungs-Ansicht ----

let currentBereich = "Personen";
let currentBatch = null;
let currentImageIndex = 0;
let currentImageState = null;
let imageStates = [];
let lastScreenshotTemplateName = "";

function makePersonValues() {
    const values = {};
    for (const field of templateFields) {
        if (field.typ === "verknüpfung-mehrfach" || field.typ === "freitext-liste") {
            values[field.name] = [];
        } else {
            values[field.name] = "";
        }
    }
    return values;
}

function isPersonBlank(values) {
    return templateFields.every((field) => {
        if (field.name === "Personennummer") return true;
        const value = values[field.name];
        return Array.isArray(value) ? value.length === 0 : !value;
    });
}

function makeEmptyImageState() {
    return { persons: [{ fileName: null, values: makePersonValues() }], personIndex: 0 };
}

function currentPerson() {
    return currentImageState.persons[currentImageState.personIndex];
}

function currentValues() {
    if (currentBereich === "Screenshots") return currentImageState.values;
    return currentPerson().values;
}

async function startPersonenBatch(batch) {
    currentBereich = "Personen";
    currentBatch = batch;
    imageStates = new Array(batch.openImages.length).fill(null);
    templateFields = await loadTemplateFields(batch.info.protokollTemplate);
    templatePickerBox.classList.add("is-hidden");
    saveMoreButton.classList.remove("is-hidden");
    batchesView.classList.add("is-hidden");
    editView.classList.remove("is-hidden");
    eventLabelEl.textContent = `${batch.eventName} (${batch.info.projektName}) — Personen`;
    await loadImage(0);
}

// Zustand pro Bild bleibt für die ganze Batch-Sitzung erhalten (in imageStates),
// damit man über "Zurück" zu bereits bearbeiteten Bildern/Personen zurückkommt,
// statt dass sie beim Weitergehen verloren gehen.
async function ensurePersonenImageState(index) {
    if (imageStates[index]) return imageStates[index];

    const rules = await loadNamingRules("personen");
    const existingPersons = await loadExistingPersons(currentBatch.info.personenordner);
    const baseNumber = nextBaseNumber(existingPersons, currentBatch.info.date, rules.counterDigits);

    const state = makeEmptyImageState();
    state.baseNumber = baseNumber;
    state.rules = rules;
    state.persons[0].values.Personennummer = baseNumber;

    imageStates[index] = state;
    return state;
}

// ---- Screenshots ----

function makeEmptyScreenshotState() {
    return { templateName: "", values: {} };
}

function applyScreenshotTemplateValues(state, templateName) {
    state.templateName = templateName;
    state.values = {};
    for (const field of templateFields) {
        state.values[field.name] = (field.typ === "freitext-liste" || field.typ === "verknüpfung-mehrfach") ? [] : "";
    }
}

async function ensureScreenshotImageState(index) {
    if (imageStates[index]) return imageStates[index];
    const state = makeEmptyScreenshotState();
    imageStates[index] = state;
    return state;
}

async function startScreenshotBatch(batch) {
    currentBereich = "Screenshots";
    currentBatch = batch;
    imageStates = new Array(batch.openImages.length).fill(null);
    templateFields = [];
    templatePickerBox.classList.remove("is-hidden");
    saveMoreButton.classList.add("is-hidden");
    batchesView.classList.add("is-hidden");
    editView.classList.remove("is-hidden");
    eventLabelEl.textContent = `${batch.eventName} (${batch.info.projektName}) — Screenshots`;

    templateSelect.innerHTML = '<option value="" selected disabled>Typ wählen</option>';
    for (const name of await listScreenshotTemplateNames()) {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        templateSelect.appendChild(option);
    }

    await loadImage(0);
}

templateSelect.addEventListener("change", async () => {
    templateFields = await loadScreenshotTemplateFields(templateSelect.value);
    applyScreenshotTemplateValues(currentImageState, templateSelect.value);
    lastScreenshotTemplateName = templateSelect.value;
    await renderForm();
});

async function loadImage(index) {
    currentImageIndex = index;
    const fileName = currentBatch.openImages[index];
    imageNameEl.textContent = fileName;
    imageEl.src = convertFileSrc(await join(currentBatch.eventFolder, fileName));

    if (currentBereich === "Screenshots") {
        currentImageState = await ensureScreenshotImageState(index);
        if (!currentImageState.templateName && lastScreenshotTemplateName) {
            templateFields = await loadScreenshotTemplateFields(lastScreenshotTemplateName);
            applyScreenshotTemplateValues(currentImageState, lastScreenshotTemplateName);
        } else {
            templateFields = currentImageState.templateName
                ? await loadScreenshotTemplateFields(currentImageState.templateName)
                : [];
        }
        templateSelect.value = currentImageState.templateName;
    } else {
        currentImageState = await ensurePersonenImageState(index);
    }

    await renderForm();
}

async function loadUnlinkedScreenshots(personenordner) {
    const dir = await join(screenshotsDir, personenordner);
    const screenshots = [];

    for (const filePath of await collectMdFilesRecursive(dir)) {
        const data = await safeReadFrontmatter(filePath);
        if (!data || data.Person) continue;
        const fileName = (await basename(filePath)).replace(/\.md$/, "");
        screenshots.push({ fileName, id: data?.ID ?? fileName, data });
    }
    return screenshots.sort((a, b) => a.id.localeCompare(b.id));
}

function renderChoiceGroup(field, container) {
    const group = document.createElement("div");
    group.className = "transcribe-choice-group";
    for (const option of field.optionen) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "transcribe-choice";
        button.textContent = option;
        button.classList.toggle("is-selected", currentValues()[field.name] === option);
        button.addEventListener("click", () => {
            currentValues()[field.name] = currentValues()[field.name] === option ? "" : option;
            group.querySelectorAll(".transcribe-choice").forEach((btn) => {
                btn.classList.toggle("is-selected", btn.textContent === currentValues()[field.name]);
            });
        });
        group.appendChild(button);
    }
    container.appendChild(group);
}

function renderTextField(field, container) {
    const input = document.createElement("input");
    input.type = "text";
    input.value = currentValues()[field.name] ?? "";
    input.addEventListener("input", () => {
        currentValues()[field.name] = input.value;
    });
    container.appendChild(input);
}

function autoResizeTextarea(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
}

// Mehrzeiliges Textfeld, das mit dem Inhalt mitwächst (Enter fügt eine neue
// Zeile ein, statt das Formular abzuschicken oder abgeschnitten zu werden).
function renderMultilineTextField(field, container) {
    const textarea = document.createElement("textarea");
    textarea.className = "transcribe-autogrow";
    textarea.rows = 1;
    textarea.value = currentValues()[field.name] ?? "";
    textarea.addEventListener("input", () => {
        currentValues()[field.name] = textarea.value;
        autoResizeTextarea(textarea);
    });
    container.appendChild(textarea);
    requestAnimationFrame(() => autoResizeTextarea(textarea));
}

function renderListField(field, container) {
    const textarea = document.createElement("textarea");
    textarea.rows = 3;
    textarea.placeholder = "ein Eintrag pro Zeile";
    textarea.value = (currentValues()[field.name] ?? []).join("\n");
    textarea.addEventListener("input", () => {
        currentValues()[field.name] = textarea.value.split("\n").map((line) => line.trim()).filter(Boolean);
    });
    container.appendChild(textarea);
}

// Generisch: liest field.quelle (z. B. "Event.Ort" oder "Event.Projekt.Name") aus
// den echten Notizen aus, statt einzelne Feldnamen im Code fest zu verdrahten.
async function renderAutomaticField(field, container) {
    const resolved = await resolveAutomaticValue(field.quelle);

    if (Array.isArray(resolved) && resolved.length > 1) {
        const select = document.createElement("select");
        for (const option of resolved) {
            const optionEl = document.createElement("option");
            optionEl.value = option;
            optionEl.textContent = option;
            select.appendChild(optionEl);
        }
        currentValues()[field.name] = currentValues()[field.name] || resolved[0];
        select.value = currentValues()[field.name];
        select.addEventListener("change", () => {
            currentValues()[field.name] = select.value;
        });
        container.appendChild(select);
        return;
    }

    const value = Array.isArray(resolved) ? (resolved[0] ?? "") : resolved;
    currentValues()[field.name] = currentValues()[field.name] || value;

    if (field.editierbar) {
        renderTextField(field, container);
    } else {
        const span = document.createElement("div");
        span.className = "transcribe-static";
        span.textContent = currentValues()[field.name];
        container.appendChild(span);
    }
}

function renderScreenshotField(field, container) {
    const list = document.createElement("div");
    list.className = "transcribe-screenshot-list";

    function renderEntries() {
        list.innerHTML = "";
        for (const [index, entry] of currentValues()[field.name].entries()) {
            const card = document.createElement("div");
            card.className = "transcribe-screenshot-card";

            const title = document.createElement("div");
            title.className = "transcribe-screenshot-card-title";
            title.textContent = entry.fileName;
            const removeButton = document.createElement("button");
            removeButton.type = "button";
            removeButton.className = "link-secondary";
            removeButton.textContent = "entfernen";
            removeButton.addEventListener("click", () => {
                currentValues()[field.name].splice(index, 1);
                renderEntries();
            });
            title.appendChild(removeButton);
            card.appendChild(title);

            for (const sub of field.unterfelder) {
                const subWrapper = document.createElement("div");
                subWrapper.className = "transcribe-field";
                const subLabel = document.createElement("label");
                subLabel.textContent = sub.name;
                subWrapper.appendChild(subLabel);

                if (sub.typ === "einfachauswahl") {
                    const group = document.createElement("div");
                    group.className = "transcribe-choice-group";
                    for (const option of sub.optionen) {
                        const button = document.createElement("button");
                        button.type = "button";
                        button.className = "transcribe-choice";
                        button.textContent = option;
                        button.classList.toggle("is-selected", entry[sub.name] === option);
                        button.addEventListener("click", () => {
                            entry[sub.name] = entry[sub.name] === option ? "" : option;
                            group.querySelectorAll(".transcribe-choice").forEach((btn) => {
                                btn.classList.toggle("is-selected", btn.textContent === entry[sub.name]);
                            });
                        });
                        group.appendChild(button);
                    }
                    subWrapper.appendChild(group);
                } else if (sub.typ === "freitext-liste") {
                    const textarea = document.createElement("textarea");
                    textarea.rows = 2;
                    textarea.value = (entry[sub.name] ?? []).join("\n");
                    textarea.addEventListener("input", () => {
                        entry[sub.name] = textarea.value.split("\n").map((line) => line.trim()).filter(Boolean);
                    });
                    subWrapper.appendChild(textarea);
                } else {
                    const input = document.createElement("input");
                    input.type = "text";
                    input.value = entry[sub.name] ?? "";
                    input.addEventListener("input", () => {
                        entry[sub.name] = input.value;
                    });
                    subWrapper.appendChild(input);
                }

                card.appendChild(subWrapper);
            }

            list.appendChild(card);
        }
    }

    renderEntries();
    container.appendChild(list);

    const addRow = document.createElement("div");
    addRow.className = "transcribe-screenshot-add";
    const select = document.createElement("select");
    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "link-secondary";
    addButton.textContent = "+ Screenshot hinzufügen";

    let availableByFileName = new Map();

    loadUnlinkedScreenshots(currentBatch.info.personenordner).then((screenshots) => {
        const alreadyAdded = new Set(currentValues()[field.name].map((entry) => entry.fileName));
        const available = screenshots.filter((s) => !alreadyAdded.has(s.fileName));
        if (available.length === 0) {
            select.disabled = true;
            const option = document.createElement("option");
            option.textContent = "keine freien Screenshots";
            select.appendChild(option);
            return;
        }
        for (const screenshot of available) {
            availableByFileName.set(screenshot.fileName, screenshot);
            const option = document.createElement("option");
            option.value = screenshot.fileName;
            option.textContent = screenshot.id;
            select.appendChild(option);
        }
    });

    // Falls dieser Screenshot schon einmal (z. B. von einer anderen Person)
    // verknüpft war und dabei Werte bekommen hat, werden die hier übernommen,
    // statt sie beim Speichern mit leeren Unterfeldern zu überschreiben.
    addButton.addEventListener("click", () => {
        if (!select.value) return;
        const existingData = availableByFileName.get(select.value)?.data;
        const entry = { fileName: select.value };
        for (const sub of field.unterfelder) {
            const existingValue = existingData?.[sub.name];
            if (sub.typ === "freitext-liste") {
                entry[sub.name] = Array.isArray(existingValue) ? existingValue : [];
            } else {
                entry[sub.name] = typeof existingValue === "string" ? existingValue : "";
            }
        }
        currentValues()[field.name].push(entry);
        renderEntries();
        select.querySelector(`option[value="${select.value}"]`)?.remove();
    });

    addRow.append(select, addButton);
    container.appendChild(addRow);
}

function renderCompanionsField(field, container) {
    const info = document.createElement("div");
    info.className = "transcribe-static";
    const names = currentImageState.persons
        .filter((_, index) => index !== currentImageState.personIndex)
        .map((p) => p.fileName ?? "(noch nicht gespeichert)");
    info.textContent = names.length > 0 ? names.join(", ") : "wird automatisch verknüpft, sobald es weitere Personen für dieses Protokoll gibt";
    container.appendChild(info);
}

function updatePersonNavButtons() {
    const canGoBack = currentBereich === "Screenshots"
        ? currentImageIndex > 0
        : currentImageState.personIndex > 0 || currentImageIndex > 0;
    prevPersonButton.classList.toggle("is-hidden", !canGoBack);
}

async function renderForm() {
    formEl.innerHTML = "";
    const categories = new Map();
    for (const field of templateFields) {
        if (!categories.has(field.kategorie)) categories.set(field.kategorie, []);
        categories.get(field.kategorie).push(field);
    }

    for (const [kategorie, fields] of categories) {
        const fieldset = document.createElement("fieldset");
        fieldset.className = "transcribe-category";
        const legend = document.createElement("legend");
        legend.textContent = kategorie;
        fieldset.appendChild(legend);

        for (const field of fields) {
            const wrapper = document.createElement("div");
            wrapper.className = "transcribe-field";
            const label = document.createElement("label");
            label.textContent = field.name;
            wrapper.appendChild(label);

            if (field.typ === "automatisch") {
                await renderAutomaticField(field, wrapper);
            } else if (field.typ === "automatisch-zahl") {
                renderTextField(field, wrapper);
            } else if (field.typ === "text") {
                renderMultilineTextField(field, wrapper);
            } else if (field.typ === "einfachauswahl") {
                renderChoiceGroup(field, wrapper);
            } else if (field.typ === "freitext-liste") {
                renderListField(field, wrapper);
            } else if (field.typ === "verknüpfung-mehrfach" && field.ziel === "Screenshots") {
                renderScreenshotField(field, wrapper);
            } else if (field.typ === "verknüpfung-mehrfach" && field.ziel === "Personen") {
                renderCompanionsField(field, wrapper);
            }

            fieldset.appendChild(wrapper);
        }

        formEl.appendChild(fieldset);
    }

    updatePersonNavButtons();
}

function yamlScalar(value) {
    if (value === "" || value === null || value === undefined) return "";
    // Mehrzeilige Werte (aus den auto-wachsenden Textfeldern) MÜSSEN maskiert werden —
    // ein rohes Zeilenumbruch-Zeichen in einem unquotierten Skalar ergibt ungültiges
    // YAML und macht die ganze Datei unlesbar.
    const needsQuotes = /^[[{>|*&!%#`"'@,?-]/.test(value)
        || value.includes(": ")
        || value.includes("\n")
        || value.includes("\r")
        || value !== value.trim();
    return needsQuotes ? JSON.stringify(value) : value;
}

// Markdown-Erzeugung fürs Speichern einer Person-Notiz
async function writePersonNote(v, fileName, companions) {
    const imageFileName = currentBatch.openImages[currentImageIndex];

    const lines = [];
    lines.push("---");
    lines.push(`Projektpartner: ${currentBatch.info.projektName}`);
    lines.push(`Event: "[[${currentBatch.info.fileName}]]"`);
    lines.push(`Ort: ${v.Ort ?? ""}`);
    lines.push(`ProtokollBild: "[[${imageFileName}]]"`);

    const screenshots = v.Screenshots ?? [];
    if (screenshots.length > 0) {
        lines.push("Screenshots:");
        for (const s of screenshots) lines.push(`  - "[[${s.fileName}]]"`);
    } else {
        lines.push("Screenshots:");
    }

    lines.push(`Datum und Uhrzeit: ${currentBatch.info.date}T${(v.Uhrzeit || "00:00").padStart(5, "0")}:00`);
    lines.push(`Leitfrage: ${yamlScalar(v.Leitfrage)}`);
    lines.push(`Zeitangaben: ${yamlScalar(v.Zeitangaben)}`);
    lines.push(`Geschlecht: ${yamlScalar(v.Geschlecht)}`);
    lines.push(`Alter geschätzt: ${yamlScalar(v["Alter geschätzt"])}`);
    lines.push(`Personengruppe: ${yamlScalar(v.Personengruppe)}`);

    for (const fieldName of ["O-Töne", "Eindrücke von der Person", "Wünsche und Bedürfnisse", "Ängste und Konflikte", "Emotionen / Stimmung"]) {
        const items = v[fieldName] ?? [];
        if (items.length > 0) {
            lines.push(`${fieldName}:`);
            for (const item of items) lines.push(`  - ${yamlScalar(item)}`);
        } else {
            lines.push(`${fieldName}:`);
        }
    }

    lines.push("Related Protokolle:");
    for (const companion of companions) lines.push(`  - "[[${companion}]]"`);

    lines.push("Weitere Notizen:");
    lines.push("---");
    lines.push("");
    lines.push("## Protokoll Bild");
    lines.push(`![[${imageFileName}|500]]`);
    lines.push("");
    lines.push("### Screenshots");
    if (screenshots.length > 0) {
        lines.push(screenshots.map((s) => `![[${s.fileName}|200]]`).join(" "));
    } else {
        lines.push("*Keine Screenshots ausgewählt*");
    }
    lines.push("");
    lines.push("### Relevante Personen");
    if (companions.length > 0) {
        lines.push(companions.map((c) => `- [[${c}]]`).join("\n"));
    } else {
        lines.push("*Keine relevanten Personen verknüpft*");
    }
    lines.push("");

    const dir = await join(personenDir, currentBatch.info.personenordner);
    await mkdir(dir, { recursive: true });
    await writeTextFile(await join(dir, `${fileName}.md`), lines.join("\n"));

    for (const s of screenshots) {
        await updateScreenshotNote(s, fileName);
    }

    return fileName;
}

async function updateScreenshotNote(entry, personFileName) {
    const filePath = await join(screenshotsDir, currentBatch.info.personenordner, `${entry.fileName}.md`);
    const raw = await readTextFile(filePath);
    const [, frontmatterRaw, ...bodyParts] = raw.split("---");
    const body = bodyParts.join("---");

    const lines = frontmatterRaw.split("\n").filter((line) => line.trim() !== "");
    const updated = [];
    const skipKeys = ["Person", "PositionZeitstrahl", "Wahrscheinlichkeit", "Einordnung", "InterpretationenDesScreenshots"];
    for (const line of lines) {
        if (skipKeys.some((key) => line.startsWith(`${key}:`))) continue;
        updated.push(line);
    }
    updated.push(`Person: "[[${personFileName}]]"`);
    updated.push(`PositionZeitstrahl: ${yamlScalar(entry.PositionZeitstrahl ?? "")}`);
    updated.push(`Wahrscheinlichkeit: ${yamlScalar(entry.Wahrscheinlichkeit ?? "")}`);
    updated.push(`Einordnung: ${yamlScalar(entry.Einordnung ?? "")}`);
    const interpretationen = entry.InterpretationenDesScreenshots ?? [];
    if (interpretationen.length > 0) {
        updated.push("InterpretationenDesScreenshots:");
        for (const item of interpretationen) updated.push(`  - ${yamlScalar(item)}`);
    } else {
        updated.push("InterpretationenDesScreenshots:");
    }

    await writeTextFile(filePath, `---\n${updated.join("\n")}\n---${body}`);
}

// Speichert alle Personen dieses Protokoll-Bilds neu (idempotent) — so bleiben die
// gegenseitigen "Related Protokolle"-Verlinkungen immer konsistent, egal in welcher
// Reihenfolge zurück-/vorgegangen und editiert wurde. Noch leere, nie gespeicherte
// Personen (z. B. ein per "weitere Person" angelegter, aber unausgefüllter Slot)
// werden übersprungen, damit keine leeren Dateien entstehen.
async function saveGroup() {
    const toSave = currentImageState.persons.filter((p) => p.fileName || !isPersonBlank(p.values));
    const resolved = toSave.map((person) => ({
        person,
        oldFileName: person.fileName,
        newFileName: `Person_${currentBatch.info.date}_${person.values.Personennummer}`,
    }));

    for (const entry of resolved) {
        const companions = resolved.filter((other) => other !== entry).map((other) => other.newFileName);
        await writePersonNote(entry.person.values, entry.newFileName, companions);
        if (entry.oldFileName && entry.oldFileName !== entry.newFileName) {
            await remove(await join(personenDir, currentBatch.info.personenordner, `${entry.oldFileName}.md`));
        }
        entry.person.fileName = entry.newFileName;
    }
}

async function goToPerson(index) {
    await saveGroup();
    currentImageState.personIndex = index;
    await renderForm();
}

// Markdown-Erzeugung fürs Speichern einer Screenshot-Notiz. Die Grunddaten (ID,
// Bild, Vorlage) sind fest, die restlichen Felder kommen komplett aus dem
// gewählten Screenshot-Template — nichts davon ist im Code hartcodiert.
async function saveScreenshotNote() {
    if (!currentImageState.templateName) return false;

    const imageFileName = currentBatch.openImages[currentImageIndex];
    const id = imageFileName.replace(/\.[^.]+$/, "");
    const v = currentImageState.values;

    const lines = ["---"];
    lines.push(`ID: ${id}`);
    lines.push(`Screenshot Bild: "[[${imageFileName}]]"`);
    lines.push(`Screenshot Vorlage: "[[Screenshot-Typ_${currentImageState.templateName}]]"`);

    for (const field of templateFields) {
        const value = v[field.name];
        if (field.typ === "freitext-liste") {
            lines.push(`${field.name}:`);
            for (const item of value ?? []) lines.push(`  - ${yamlScalar(item)}`);
        } else {
            lines.push(`${field.name}: ${yamlScalar(value)}`);
        }
    }

    // "Zusätzliche Anmerkungen", "Wahrscheinlichkeit", "Einordnung" & Co. sind
    // bewusst keine hartcodierten Felder — ein Screenshot-Template kann sie wie
    // jedes andere Feld selbst in seinem Feld-Katalog führen (siehe z. B. "Maps
    // Garching" für Zusätzliche Anmerkungen). Nur wenn das Template ein solches
    // Feld NICHT selbst definiert, wird hier ein leerer Platzhalter ergänzt —
    // sonst gäbe es einen doppelten YAML-Key und die Eingabe ginge verloren.
    const templateFieldNames = new Set(templateFields.map((field) => field.name));
    lines.push("Person:");
    for (const key of ["PositionZeitstrahl", "Wahrscheinlichkeit", "Einordnung", "InterpretationenDesScreenshots"]) {
        if (!templateFieldNames.has(key)) lines.push(`${key}:`);
    }
    lines.push("---");
    lines.push("");
    lines.push(`![[${imageFileName}|500]]`);

    const dir = await join(screenshotsDir, currentBatch.info.personenordner);
    await mkdir(dir, { recursive: true });
    await writeTextFile(await join(dir, `Screenshot_${id}.md`), lines.join("\n"));
    return true;
}

prevPersonButton.addEventListener("click", async () => {
    if (currentBereich === "Screenshots") {
        if (currentImageIndex === 0) return;
        await loadImage(currentImageIndex - 1);
        return;
    }

    if (currentImageState.personIndex > 0) {
        await goToPerson(currentImageState.personIndex - 1);
        return;
    }
    if (currentImageIndex === 0) return;

    await saveGroup();
    await loadImage(currentImageIndex - 1);
    currentImageState.personIndex = currentImageState.persons.length - 1;
    await renderForm();
});

saveMoreButton.addEventListener("click", async () => {
    const state = currentImageState;
    if (state.personIndex < state.persons.length - 1) {
        await goToPerson(state.personIndex + 1);
        return;
    }

    await saveGroup();
    const nextNumber = String(
        parseInt(state.baseNumber, 10) + state.rules.mitprotokollierteOffset * state.persons.length
    ).padStart(state.rules.counterDigits, "0");
    const values = makePersonValues();
    values.Personennummer = nextNumber;
    state.persons.push({ fileName: null, values });
    state.personIndex = state.persons.length - 1;
    await renderForm();
});

nextButton.addEventListener("click", async () => {
    if (currentBereich === "Screenshots") {
        const saved = await saveScreenshotNote();
        if (!saved) return;
        if (currentImageIndex + 1 >= currentBatch.openImages.length) {
            window.location.href = "/pages/transcribe.html";
            return;
        }
        await loadImage(currentImageIndex + 1);
        return;
    }

    await saveGroup();
    if (currentImageIndex + 1 >= currentBatch.openImages.length) {
        window.location.href = "/pages/transcribe.html";
        return;
    }
    await loadImage(currentImageIndex + 1);
});

backToBatchesButton.addEventListener("click", () => {
    window.location.href = "/pages/transcribe.html";
});

async function refreshBatches() {
    batchesEmptyEl.textContent = "Lade Bilder …";
    batchesEmptyEl.classList.remove("is-hidden");
    batchListEl.innerHTML = "";
    const batches = await buildBatches();
    batchesEmptyEl.textContent = "Keine offenen Bilder gefunden.";
    renderBatchList(batches);
}

const urlParams = new URLSearchParams(window.location.search);
const preselectedEvent = urlParams.get("event");
const preselectedBereich = urlParams.get("bereich") === "Screenshots" ? "Screenshots" : "Personen";

if (preselectedEvent) {
    const batches = preselectedBereich === "Screenshots" ? await buildScreenshotBatches() : await buildPersonenBatches();
    const batch = batches.find((b) => b.eventName === preselectedEvent);
    if (batch) {
        if (preselectedBereich === "Screenshots") await startScreenshotBatch(batch);
        else await startPersonenBatch(batch);
    } else {
        batchesEmptyEl.textContent = "Für dieses Event gibt es keine offenen Bilder mehr.";
        batchesEmptyEl.classList.remove("is-hidden");
    }
} else {
    await refreshBatches();
}
