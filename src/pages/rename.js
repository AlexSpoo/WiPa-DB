import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { basename, join } from "@tauri-apps/api/path";
import { readDir, readTextFile, copyFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import { load as loadYaml } from "js-yaml";
import { load as loadStore } from "@tauri-apps/plugin-store";

const filesToRename = JSON.parse(sessionStorage.getItem("filesToRename")) ?? [];
const fileStates = filesToRename.map(() => ({
    type: "protokoll",
    event: "",
    screenshotType: "",
    number: "",
    name: "",
    manualOverride: false,
    skipped: false,
    date: null,
    rules: null,
}));

let currentIndex = 0;

const image = document.querySelector("#rename-image");
const imageRow = document.querySelector("#rename-image-row");
const previewImage = document.querySelector("#rename-preview-image");
const previewCheckbox = document.querySelector("#rename-show-next-checkbox");
const originalNameLabel = document.querySelector("#rename-original-name");
const newNameInput = document.querySelector("#rename-new-name");
const typeSelect = document.querySelector("#rename-type-select");
const eventSelect = document.querySelector("#rename-event-select");
const screenshotTypeField = document.querySelector("#rename-screenshot-type-field");
const screenshotTypeSelect = document.querySelector("#rename-screenshot-type-select");
const numberInput = document.querySelector("#rename-number-input");
const editNameButton = document.querySelector("#rename-edit-name-button");
const nextButton = document.querySelector("#rename-next-button");
const skipButton = document.querySelector("#rename-skip-button");
const backButton = document.querySelector("#rename-back-button");
const overviewButton = document.querySelector("#rename-overview-button");
const editView = document.querySelector("#rename-edit-view");
const summaryView = document.querySelector("#rename-summary");
const summaryList = document.querySelector("#rename-summary-list");
const summarySaveButton = document.querySelector("#rename-summary-save-button");

let lastGoodState = null;
let hasReachedSummaryOnce = false;

const store = await loadStore("settings.json", { autoSave: false });
const activeVault = await store.get("activeVault");
await invoke("expand_scope", { folderPath: activeVault });
const protokollDir = await join(activeVault, "Media", "Images", "Protokolle(RAW)");
const screenshotDir = await join(activeVault, "Media", "Images", "Screenshots(RAW)");

function formatDate(value) {
    if (!(value instanceof Date)) return value;
    // js-yaml parst unquotierte Datumswerte (z. B. "2025-07-09") automatisch zu Date-Objekten,
    // deshalb hier zurück in "YYYY-MM-DD" umwandeln, mit UTC-Gettern gegen Zeitzonen-Verschiebung
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function extractWikilinkTarget(value) {
    if (typeof value !== "string") return null;
    const match = value.match(/\[\[(.+?)\]\]/);
    return match ? match[1] : value;
}

async function readFrontmatter(filePath) {
    const raw = await readTextFile(filePath);
    return loadYaml(raw.split("---")[1]);
}

// Projekte einlesen (Name, Kürzel, ScreenshotPrefix), Schlüssel = Dateiname ohne .md,
// damit sich Wikilinks wie "[[Projekt_Mosaiq]]" direkt darauf zurückführen lassen.
const projektInfo = {};
const projekteDir = await join(activeVault, "Projekte");
for (const entry of await readDir(projekteDir)) {
    if (!entry.isFile || !entry.name.endsWith(".md")) continue;
    const data = await readFrontmatter(await join(projekteDir, entry.name));
    if (!data?.Name) continue;
    projektInfo[entry.name.replace(/\.md$/, "")] = {
        name: data.Name,
        screenshotPrefix: data.ScreenshotPrefix ?? "",
    };
}

// Events einlesen; Projekt-Feld ist ein Wikilink, darüber Projektname + ScreenshotPrefix auflösen.
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
        projektName: projekt?.name ?? "",
        screenshotPrefix: projekt?.screenshotPrefix ?? "",
    };

    const option = document.createElement("option");
    option.value = data.Name;
    option.textContent = data.Name;
    eventSelect.appendChild(option);
}

// Screenshot-Typen einlesen (Name, Kürzel) fürs Dropdown.
const screenshotTypeInfo = {};
const screenshotTypesDir = await join(activeVault, "Typen", "Screenshot-Typen");
for (const entry of await readDir(screenshotTypesDir)) {
    if (!entry.isFile || !entry.name.endsWith(".md")) continue;
    const data = await readFrontmatter(await join(screenshotTypesDir, entry.name));
    if (!data?.Name || !data?.Kürzel) continue;

    screenshotTypeInfo[data.Name] = data.Kürzel;

    const option = document.createElement("option");
    option.value = data.Name;
    option.textContent = data.Name;
    screenshotTypeSelect.appendChild(option);
}

// Ordner heißen mal nur "<Name>" (z. B. "Garching 1"), mal "<Projekt> <Name>" (z. B. "Mosaiq Moosach 1") —
// beide Varianten prüfen; existiert keine, wird beim Anlegen der einfache Name verwendet.
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

// Nummern, die andere (noch nicht gespeicherte) Bilder im selben Rename-Durchgang
// schon zugewiesen bekommen haben, zählen mit — sonst vergibt z. B. ein neu
// bearbeitetes, vorher übersprungenes Bild wieder Nummer 1, obwohl im Batch schon
// höhere Nummern für dasselbe Event/Typ vergeben sind.
function highestBatchNumber(predicate) {
    let highest = 0;
    fileStates.forEach((state, i) => {
        if (i === currentIndex || state.skipped || !state.number) return;
        if (!predicate(state)) return;
        const number = parseInt(state.number, 10);
        if (number > highest) highest = number;
    });
    return highest;
}

async function computeNextProtokollNumber(eventName, date, rules) {
    const eventPath = await resolveEventFolder(protokollDir, eventName);

    let highestUnderMax = 0;
    let highestOverall = 0;

    if (await exists(eventPath)) {
        const files = await readDir(eventPath);
        const pattern = new RegExp(`^${rules.prefix}_${date}_(\\d+)`);
        for (const file of files) {
            const match = file.name.match(pattern);
            if (!match) continue;
            const number = parseInt(match[1], 10);
            if (number > highestOverall) highestOverall = number;
            if (number <= rules.counterMax && number > highestUnderMax) highestUnderMax = number;
        }
    }

    const batchHighest = highestBatchNumber((state) => state.type === "protokoll" && state.event === eventName && state.date === date);
    if (batchHighest > highestOverall) highestOverall = batchHighest;
    if (batchHighest <= rules.counterMax && batchHighest > highestUnderMax) highestUnderMax = batchHighest;

    const next = highestUnderMax < rules.counterMax ? highestUnderMax + 1 : highestOverall + 1;
    return String(next).padStart(rules.counterDigits, "0");
}

async function computeNextScreenshotNumber(eventName, typeKürzel, screenshotType, rules) {
    const prefix = eventInfo[eventName]?.screenshotPrefix ?? "";
    const projektName = eventInfo[eventName]?.projektName;

    let highest = 0;
    const pattern = new RegExp(`^${prefix}${typeKürzel}-(\\d+)`);

    // Präfix + Kürzel sind pro Projekt fest, nicht pro Event — die Nummerierung
    // ist also projektweit eindeutig. Deshalb über alle Events desselben
    // Projekts scannen (z. B. Garching 1 UND 2), sonst können zwei Events
    // versehentlich dieselbe Nummer vergeben.
    const relatedEventNames = Object.keys(eventInfo).filter((name) => eventInfo[name]?.projektName === projektName);
    for (const relatedEventName of relatedEventNames) {
        const eventPath = await resolveEventFolder(screenshotDir, relatedEventName);
        if (!(await exists(eventPath))) continue;
        const files = await readDir(eventPath);
        for (const file of files) {
            const match = file.name.match(pattern);
            if (!match) continue;
            const number = parseInt(match[1], 10);
            if (number > highest) highest = number;
        }
    }

    const batchHighest = highestBatchNumber((state) =>
        state.type === "screenshot" && eventInfo[state.event]?.projektName === projektName && state.screenshotType === screenshotType
    );
    if (batchHighest > highest) highest = batchHighest;

    return String(highest + 1).padStart(rules.counterDigits, "0");
}

async function loadNamingRules(typeKey) {
    const rulesPath = await join(activeVault, "Einstellungen", "naming-rules.md");
    const data = await readFrontmatter(rulesPath);
    return data[typeKey];
}

function updateNameFromFields() {
    const state = fileStates[currentIndex];
    if (state.manualOverride) return;
    if (!state.rules) return;

    if (state.type === "protokoll") {
        if (!state.date) return;
        newNameInput.value = `${state.rules.prefix}_${state.date}_${numberInput.value}`;
    } else if (state.type === "screenshot") {
        const prefix = eventInfo[state.event]?.screenshotPrefix ?? "";
        if (!state.screenshotType) return;
        newNameInput.value = `${prefix}${screenshotTypeInfo[state.screenshotType]}-${numberInput.value}`;
    }
}

async function recomputeNumber() {
    const state = fileStates[currentIndex];
    const type = typeSelect.value;
    const eventName = eventSelect.value;
    if (!eventName) return;

    state.type = type;
    state.event = eventName;
    state.skipped = false;
    state.manualOverride = false;
    newNameInput.readOnly = true;

    if (type === "protokoll") {
        state.date = eventInfo[eventName]?.date;
        if (!state.date) return;

        state.rules = await loadNamingRules("protokoll");
        const number = await computeNextProtokollNumber(eventName, state.date, state.rules);
        if (eventSelect.value !== eventName || typeSelect.value !== type) return;

        numberInput.value = number;
    } else if (type === "screenshot") {
        const screenshotType = screenshotTypeSelect.value;
        state.screenshotType = screenshotType;
        if (!screenshotType) return;

        state.rules = await loadNamingRules("screenshot");
        const typeKürzel = screenshotTypeInfo[screenshotType];
        const number = await computeNextScreenshotNumber(eventName, typeKürzel, screenshotType, state.rules);
        if (eventSelect.value !== eventName || typeSelect.value !== type || screenshotTypeSelect.value !== screenshotType) return;

        numberInput.value = number;
    }

    updateNameFromFields();
    await refreshNextButtonState();
}

typeSelect.addEventListener("change", () => {
    fileStates[currentIndex].skipped = false;
    const isScreenshot = typeSelect.value === "screenshot";
    screenshotTypeField.classList.toggle("is-hidden", !isScreenshot);
    screenshotTypeSelect.value = "";
    numberInput.value = "";
    newNameInput.value = "";
    if (eventSelect.value) recomputeNumber();
});

function saveCurrentState() {
    const state = fileStates[currentIndex];
    state.type = typeSelect.value;
    state.event = eventSelect.value;
    state.screenshotType = screenshotTypeSelect.value;
    state.number = numberInput.value;
    state.name = newNameInput.value;
}

function resetStateFields(state) {
    state.type = "protokoll";
    state.event = "";
    state.screenshotType = "";
    state.number = "";
    state.name = "";
    state.date = null;
    state.rules = null;
    state.manualOverride = false;
}

function updateLastGoodState() {
    const state = fileStates[currentIndex];
    if (state.skipped) return;
    if (state.event && state.rules && state.number &&
        (state.type === "protokoll" ? state.date : state.screenshotType)) {
        lastGoodState = { ...state };
    }
}

async function refreshNextButtonState() {
    const type = typeSelect.value;
    const eventChosen = !!eventSelect.value;
    const typeSpecificChosen = type === "screenshot" ? !!screenshotTypeSelect.value : true;

    let nameExists = false;
    if (eventChosen && typeSpecificChosen && newNameInput.value) {
        const originalName = await basename(filesToRename[currentIndex]);
        const extension = originalName.slice(originalName.lastIndexOf("."));
        const baseDir = type === "protokoll" ? protokollDir : screenshotDir;
        const eventDir = await resolveEventFolder(baseDir, eventSelect.value);
        const destinationPath = await join(eventDir, `${newNameInput.value}${extension}`);
        nameExists = await exists(destinationPath);
    }

    nextButton.disabled = !eventChosen || !typeSpecificChosen || nameExists;
}

function updatePreviewImage() {
    if (!previewCheckbox.checked) return;
    const nextFile = filesToRename[currentIndex + 1];
    previewImage.src = nextFile ? convertFileSrc(nextFile) : "";
}

previewCheckbox.addEventListener("change", () => {
    imageRow.classList.toggle("is-split", previewCheckbox.checked);
    updatePreviewImage();
});

async function loadFile(index) {
    currentIndex = index;
    const file = filesToRename[index];
    const state = fileStates[index];

    if (state.skipped) resetStateFields(state);

    image.src = convertFileSrc(file);
    originalNameLabel.textContent = await basename(file);
    updatePreviewImage();

    typeSelect.value = state.type;
    const isScreenshot = state.type === "screenshot";
    screenshotTypeField.classList.toggle("is-hidden", !isScreenshot);
    screenshotTypeSelect.value = state.screenshotType;

    eventSelect.value = state.event;
    numberInput.value = state.number;
    newNameInput.value = state.name;
    newNameInput.readOnly = !state.manualOverride;

    backButton.classList.toggle("is-hidden", index === 0);
    overviewButton.classList.toggle("is-hidden", !hasReachedSummaryOnce);
    const isLast = index === filesToRename.length - 1;
    nextButton.textContent = isLast ? "Zur Übersicht" : "Nächstes Bild";

    await refreshNextButtonState();
}

async function renderSummaryList() {
    summaryList.innerHTML = "";
    for (let i = 0; i < filesToRename.length; i++) {
        const state = fileStates[i];
        const originalName = await basename(filesToRename[i]);

        const item = document.createElement("li");
        item.className = "rename-summary-item";
        item.classList.toggle("is-skipped", state.skipped);
        item.addEventListener("click", () => showEditView(i));

        const originalSpan = document.createElement("span");
        originalSpan.className = "rename-summary-original";
        originalSpan.textContent = originalName;

        const arrowSpan = document.createElement("span");
        arrowSpan.className = "rename-summary-arrow";
        arrowSpan.textContent = "→";

        const resultSpan = document.createElement("span");
        resultSpan.className = "rename-summary-result";
        resultSpan.textContent = state.skipped ? "Übersprungen" : (state.name || "–");

        item.append(originalSpan, arrowSpan, resultSpan);
        summaryList.appendChild(item);
    }
}

async function showSummary() {
    hasReachedSummaryOnce = true;
    editView.classList.add("is-hidden");
    summaryView.classList.remove("is-hidden");
    await renderSummaryList();
}

async function showEditView(index) {
    summaryView.classList.add("is-hidden");
    editView.classList.remove("is-hidden");
    await loadFile(index);
}

async function getNextNumber(previous) {
    if (previous.type === "protokoll") {
        const previousValue = parseInt(previous.number, 10);
        if (previousValue < previous.rules.counterMax) {
            return String(previousValue + 1).padStart(previous.rules.counterDigits, "0");
        }
        // Maximum erreicht/überschritten: statt weiter hochzuzählen, insgesamt höchste vorhandene Nummer + 1 suchen
        return await computeNextProtokollNumber(previous.event, previous.date, previous.rules);
    }

    // Screenshots haben kein Maximum, einfach weiterzählen
    const previousValue = parseInt(previous.number, 10);
    return String(previousValue + 1).padStart(previous.rules.counterDigits, "0");
}

async function advanceTo(newIndex) {
    saveCurrentState();
    updateLastGoodState();

    const nextState = fileStates[newIndex];
    if (!nextState.event && lastGoodState) {
        nextState.type = lastGoodState.type;
        nextState.event = lastGoodState.event;
        nextState.screenshotType = lastGoodState.screenshotType;
        nextState.date = lastGoodState.date;
        nextState.rules = lastGoodState.rules;
        nextState.number = await getNextNumber(lastGoodState);

        if (nextState.type === "protokoll") {
            nextState.name = `${nextState.rules.prefix}_${nextState.date}_${nextState.number}`;
        } else {
            const prefix = eventInfo[nextState.event]?.screenshotPrefix ?? "";
            const typeKürzel = screenshotTypeInfo[nextState.screenshotType];
            nextState.name = `${prefix}${typeKürzel}-${nextState.number}`;
        }
    }

    loadFile(newIndex);
}

eventSelect.addEventListener("change", recomputeNumber);
screenshotTypeSelect.addEventListener("change", recomputeNumber);

numberInput.addEventListener("input", async () => {
    fileStates[currentIndex].manualOverride = false;
    fileStates[currentIndex].skipped = false;
    newNameInput.readOnly = true;
    updateNameFromFields();
    await refreshNextButtonState();
});

newNameInput.addEventListener("input", refreshNextButtonState);

editNameButton.addEventListener("click", () => {
    const state = fileStates[currentIndex];
    state.manualOverride = !state.manualOverride;
    newNameInput.readOnly = !state.manualOverride;
    if (state.manualOverride) newNameInput.focus();
});

async function saveAllFiles() {
    let savedCount = 0;
    for (let i = 0; i < filesToRename.length; i++) {
        const state = fileStates[i];
        if (state.skipped || !state.event || !state.name) continue;

        const originalPath = filesToRename[i];
        const originalName = await basename(originalPath);
        const extension = originalName.slice(originalName.lastIndexOf("."));

        const baseDir = state.type === "protokoll" ? protokollDir : screenshotDir;
        const eventDir = await resolveEventFolder(baseDir, state.event);
        await mkdir(eventDir, { recursive: true });

        const destinationPath = await join(eventDir, `${state.name}${extension}`);
        await copyFile(originalPath, destinationPath);
        savedCount++;
    }
    return savedCount;
}

nextButton.addEventListener("click", async () => {
    if (currentIndex === filesToRename.length - 1) {
        saveCurrentState();
        await showSummary();
        return;
    }
    await advanceTo(currentIndex + 1);
});

skipButton.addEventListener("click", async () => {
    fileStates[currentIndex].skipped = true;
    if (currentIndex < filesToRename.length - 1) {
        await advanceTo(currentIndex + 1);
    } else {
        await showSummary();
    }
});

overviewButton.addEventListener("click", async () => {
    saveCurrentState();
    await showSummary();
});

summarySaveButton.addEventListener("click", async () => {
    const savedCount = await saveAllFiles();
    sessionStorage.removeItem("filesToRename");
    sessionStorage.setItem("dashboardMessage", `${savedCount} Datei(en) gespeichert.`);
    window.location.href = "/pages/dashboard.html";
});

backButton.addEventListener("click", () => {
    if (currentIndex > 0) {
        saveCurrentState();
        loadFile(currentIndex - 1);
    }
});

if (filesToRename.length > 0) {
    await loadFile(0);
}
