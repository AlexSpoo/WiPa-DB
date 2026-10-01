import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { join, basename } from "@tauri-apps/api/path";
import { readDir, readTextFile, writeTextFile, mkdir, exists, remove } from "@tauri-apps/plugin-fs";
import { load as loadYaml, dump as dumpYaml } from "js-yaml";
import { load as loadStore } from "@tauri-apps/plugin-store";

// ---- HTML Elemente ----
const batchesView = document.querySelector("#postits-batches");
const batchListEl = document.querySelector("#postits-batch-list");
const batchesEmptyEl = document.querySelector("#postits-batches-empty");

const pickerView = document.querySelector("#postits-picker-view");
const pickerLabelEl = document.querySelector("#postits-picker-label");
const pickerImageEl = document.querySelector("#postits-picker-image");
const pickerBackButton = document.querySelector("#postits-picker-back-button");
const newPosterNameInput = document.querySelector("#postits-new-poster-name");
const newPosterButton = document.querySelector("#postits-new-poster-button");
const posterListEl = document.querySelector("#postits-poster-list");
const posterListEmptyEl = document.querySelector("#postits-poster-list-empty");

const workspaceView = document.querySelector("#postits-workspace-view");
const workspaceEventLabelEl = document.querySelector("#postits-workspace-event-label");
const workspacePosterNameEl = document.querySelector("#postits-workspace-poster-name");
const workspaceBackButton = document.querySelector("#postits-workspace-back-button");

const typenListEl = document.querySelector("#postits-typen-list");
const newTypNameInput = document.querySelector("#postits-new-typ-name");
const addTypButton = document.querySelector("#postits-add-typ-button");

const itemListEl = document.querySelector("#postits-item-list");
const itemListEmptyEl = document.querySelector("#postits-item-list-empty");

const canvasEl = document.querySelector("#postits-canvas");
const canvasImageEl = document.querySelector("#postits-canvas-image");
const canvasSvgEl = document.querySelector("#postits-canvas-svg");

const modalOverlay = document.querySelector("#postits-modal-overlay");
const modalPositionEl = document.querySelector("#postits-modal-position");
const modalNumberInput = document.querySelector("#postits-modal-number");
const modalArtSelect = document.querySelector("#postits-modal-art");
const modalTextInput = document.querySelector("#postits-modal-text");
const modalCancelButton = document.querySelector("#postits-modal-cancel");
const modalSaveButton = document.querySelector("#postits-modal-save");

// ---- Vault-Grundlagen ----
const store = await loadStore("settings.json", { autoSave: false });
const activeVault = await store.get("activeVault");
await invoke("expand_scope", { folderPath: activeVault });

const szenariobildRawDir = await join(activeVault, "Media", "Images", "Szenariobilder(RAW)");
const posterNotesDir = await join(activeVault, "Poster");
const postitsDir = await join(activeVault, "Post-its");
const postitTypenDir = await join(activeVault, "Typen", "Postit-Typen");

function extractWikilinkTarget(value) {
    if (typeof value !== "string") return null;
    const match = value.match(/\[\[(.+?)\]\]/);
    return match ? match[1] : value;
}

function formatDate(value) {
    if (!(value instanceof Date)) return value;
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

async function readFrontmatter(filePath) {
    const raw = await readTextFile(filePath);
    return loadYaml(raw.split("---")[1]);
}

// Für Sammel-Durchläufe über viele Notizen: eine kaputte Datei soll nur sich
// selbst überspringen statt die ganze Liste abzubrechen (siehe transcribe.js).
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

// Projekte/Events einlesen (gleiches Muster wie rename.js/transcribe.js) — wird
// für resolveEventFolder gebraucht, da manche Ordner "<Event>" und manche
// "<Projekt> <Event>" heißen.
const projektInfo = {};
const projekteDir = await join(activeVault, "Projekte");
for (const entry of await readDir(projekteDir)) {
    if (!entry.isFile || !entry.name.endsWith(".md")) continue;
    const data = await safeReadFrontmatter(await join(projekteDir, entry.name));
    if (!data?.Name) continue;
    projektInfo[entry.name.replace(/\.md$/, "")] = { name: data.Name };
}

const eventInfo = {};
const eventsDir = await join(activeVault, "Events");
for (const entry of await readDir(eventsDir)) {
    if (!entry.isFile || !entry.name.endsWith(".md")) continue;
    const data = await safeReadFrontmatter(await join(eventsDir, entry.name));
    if (!data?.Name) continue;
    const projektNoteName = extractWikilinkTarget(data.Projekt);
    eventInfo[data.Name] = { projektName: projektInfo[projektNoteName]?.name ?? "" };
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

// ---- Post-it-Typen (Vault-Notizen, wie Typen/Screenshot-Typen) ----
let postitTypen = [];

async function loadPostitTypen() {
    postitTypen = [];
    if (!(await exists(postitTypenDir))) return;
    for (const entry of await readDir(postitTypenDir)) {
        if (!entry.isFile || !entry.name.endsWith(".md")) continue;
        const data = await safeReadFrontmatter(await join(postitTypenDir, entry.name));
        if (!data?.Name) continue;
        postitTypen.push(data.Name);
    }
    postitTypen.sort();
}

function renderTypenList() {
    typenListEl.innerHTML = "";
    for (const name of postitTypen) {
        const item = document.createElement("li");
        item.className = "postits-typ-item";
        item.textContent = name;
        typenListEl.appendChild(item);
    }
    modalArtSelect.innerHTML = "";
    for (const name of postitTypen) {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        modalArtSelect.appendChild(option);
    }
}

addTypButton.addEventListener("click", async () => {
    const name = newTypNameInput.value.trim();
    if (!name || postitTypen.includes(name)) return;
    await mkdir(postitTypenDir, { recursive: true });
    await writeNote(await join(postitTypenDir, `Postit-Typ_${name}.md`), { Name: name });
    postitTypen.push(name);
    postitTypen.sort();
    newTypNameInput.value = "";
    renderTypenList();
});

// ---- Poster-Notizen einlesen ----
// Ein Szenariobild kann mehrere Poster haben (z. B. mehrere Themenbereiche auf
// demselben Foto), deshalb sind Poster eigene Notizen statt nur Bild-Metadaten.
async function loadAllPosters() {
    const posters = [];
    if (!(await exists(posterNotesDir))) return posters;

    for (const eventEntry of await readDir(posterNotesDir)) {
        if (!eventEntry.isDirectory) continue;
        const eventDir = await join(posterNotesDir, eventEntry.name);
        for (const fileEntry of await readDir(eventDir)) {
            if (!fileEntry.isFile || !fileEntry.name.endsWith(".md")) continue;
            const filePath = await join(eventDir, fileEntry.name);
            const data = await safeReadFrontmatter(filePath);
            if (!data?.Name || !data?.Szenariobild) continue;
            posters.push({
                filePath,
                fileName: fileEntry.name.replace(/\.md$/, ""),
                name: data.Name,
                eventFolderName: eventEntry.name,
                imageFileName: extractWikilinkTarget(data.Szenariobild),
            });
        }
    }
    return posters;
}

// ---- Batch-Liste: Szenariobilder pro Event ----
async function buildRawImageBatches(posters) {
    const batches = [];
    for (const eventName of Object.keys(eventInfo)) {
        const eventDir = await resolveEventFolder(szenariobildRawDir, eventName);
        if (!(await exists(eventDir))) continue;
        const eventFolderName = await basename(eventDir);

        const images = (await readDir(eventDir))
            .filter((entry) => entry.isFile && /\.(jpg|jpeg|png)$/i.test(entry.name))
            .map((entry) => entry.name)
            .sort();

        for (const imageFileName of images) {
            const posterCount = posters.filter(
                (p) => p.eventFolderName === eventFolderName && p.imageFileName === imageFileName
            ).length;
            batches.push({ eventName, eventDir, eventFolderName, imageFileName, posterCount });
        }
    }
    return batches;
}

function renderBatchList(batches) {
    batchListEl.innerHTML = "";
    batchesEmptyEl.classList.toggle("is-hidden", batches.length > 0);

    for (const batch of batches) {
        const item = document.createElement("li");
        item.className = "transcribe-batch-item";
        item.textContent = `${batch.eventName} — ${batch.imageFileName} — ${batch.posterCount} Poster`;
        item.addEventListener("click", () => openPicker(batch));
        batchListEl.appendChild(item);
    }
}

// ---- Poster-Auswahl (Picker) für ein Szenariobild ----
let currentBatch = null;
let currentPosters = [];
let allPosters = [];

async function openPicker(batch) {
    currentBatch = batch;
    batchesView.classList.add("is-hidden");
    pickerView.classList.remove("is-hidden");
    workspaceView.classList.add("is-hidden");

    pickerLabelEl.textContent = `${batch.eventName} — ${batch.imageFileName}`;
    pickerImageEl.src = convertFileSrc(await join(batch.eventDir, batch.imageFileName));
    newPosterNameInput.value = "";

    await refreshPosterList();
}

async function refreshPosterList() {
    allPosters = await loadAllPosters();
    currentPosters = allPosters.filter(
        (p) => p.eventFolderName === currentBatch.eventFolderName && p.imageFileName === currentBatch.imageFileName
    );

    posterListEl.innerHTML = "";
    posterListEmptyEl.classList.toggle("is-hidden", currentPosters.length > 0);
    for (const poster of currentPosters) {
        const item = document.createElement("li");
        item.className = "transcribe-batch-item";
        item.textContent = poster.name;
        item.addEventListener("click", () => openWorkspace(poster));
        posterListEl.appendChild(item);
    }
}

newPosterButton.addEventListener("click", async () => {
    const name = newPosterNameInput.value.trim();
    if (!name) return;

    const eventDir = await join(posterNotesDir, currentBatch.eventFolderName);
    await mkdir(eventDir, { recursive: true });

    const poster = {
        filePath: await join(eventDir, `Poster_${name}.md`),
        fileName: `Poster_${name}`,
        name,
        eventFolderName: currentBatch.eventFolderName,
        imageFileName: currentBatch.imageFileName,
    };
    await writeNote(poster.filePath, {
        Name: poster.name,
        Szenariobild: `[[${poster.imageFileName}]]`,
    });

    await openWorkspace(poster);
});

pickerBackButton.addEventListener("click", async () => {
    pickerView.classList.add("is-hidden");
    batchesView.classList.remove("is-hidden");
    renderBatchList(await buildRawImageBatches(await loadAllPosters()));
});

// ---- Workspace: Post-its platzieren ----
let currentPoster = null;
let currentPostits = [];
let layout = null; // { width, height, left, top } — Bild-Darstellung innerhalb des Canvas

async function openWorkspace(poster) {
    currentPoster = poster;
    pickerView.classList.add("is-hidden");
    workspaceView.classList.remove("is-hidden");

    workspaceEventLabelEl.textContent = currentBatch.eventName;
    workspacePosterNameEl.textContent = poster.name;

    canvasImageEl.src = convertFileSrc(await join(currentBatch.eventDir, poster.imageFileName));

    renderTypenList();
    await refreshPostitList();
    renderCanvas();
}

workspaceBackButton.addEventListener("click", async () => {
    workspaceView.classList.add("is-hidden");
    pickerView.classList.remove("is-hidden");
    await refreshPosterList();
});

// Tabs in der Sidebar
document.querySelectorAll(".postits-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
        document.querySelectorAll(".postits-tab").forEach((t) => t.classList.toggle("is-active", t === tab));
        document.querySelectorAll(".postits-tab-panel").forEach((panel) => {
            panel.classList.toggle("is-hidden", panel.dataset.panel !== tab.dataset.tab);
        });
    });
});

// Bildgröße im Canvas berechnen (object-fit: contain von Hand, siehe transcribe.js)
function computeLayout() {
    if (!canvasImageEl.naturalWidth || !canvasImageEl.naturalHeight) {
        layout = null;
        return;
    }
    const availableWidth = canvasEl.clientWidth;
    const availableHeight = canvasEl.clientHeight;
    const imageRatio = canvasImageEl.naturalWidth / canvasImageEl.naturalHeight;
    const boxRatio = availableWidth / availableHeight;

    let width, height;
    if (imageRatio > boxRatio) {
        width = availableWidth;
        height = availableWidth / imageRatio;
    } else {
        height = availableHeight;
        width = availableHeight * imageRatio;
    }
    layout = { width, height, left: (availableWidth - width) / 2, top: (availableHeight - height) / 2 };
}

// Position eines Klicks als Prozent der Bildbreite/-höhe (nicht als Pixel) —
// so bleibt die Position unabhängig von der tatsächlichen Fotoauflösung
// vergleichbar. Eine Rasterdarstellung lässt sich bei Bedarf später aus den
// Prozentwerten + der bekannten Bildgröße ableiten, ohne dass beim
// Digitalisieren selbst ein Raster kalibriert werden müsste.
function pixelToPercent(px, py) {
    return {
        x: Math.round(Math.max(0, Math.min(100, (px / layout.width) * 100)) * 10) / 10,
        y: Math.round(Math.max(0, Math.min(100, (py / layout.height) * 100)) * 10) / 10,
    };
}

function percentToPixel(xPercent, yPercent) {
    if (!layout) return { x: 0, y: 0 };
    return { x: (xPercent / 100) * layout.width, y: (yPercent / 100) * layout.height };
}

function renderCanvas() {
    computeLayout();
    if (!layout) {
        canvasSvgEl.innerHTML = "";
        return;
    }

    canvasImageEl.style.width = `${layout.width}px`;
    canvasImageEl.style.height = `${layout.height}px`;
    canvasImageEl.style.left = `${layout.left}px`;
    canvasImageEl.style.top = `${layout.top}px`;

    canvasSvgEl.style.width = `${layout.width}px`;
    canvasSvgEl.style.height = `${layout.height}px`;
    canvasSvgEl.style.left = `${layout.left}px`;
    canvasSvgEl.style.top = `${layout.top}px`;
    canvasSvgEl.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);

    canvasSvgEl.innerHTML = renderMarkers();
}

function renderMarkers() {
    let markers = "";
    for (const postit of currentPostits) {
        const { x, y } = percentToPixel(postit.PositionX, postit.PositionY);
        markers += `<circle cx="${x}" cy="${y}" r="12" fill="rgba(255,122,47,0.9)" stroke="#fff" stroke-width="1.5" />`;
        markers += `<text x="${x}" y="${y + 4}" text-anchor="middle" fill="#fff" font-size="10" font-weight="bold">${postit.Nummer}</text>`;
    }
    return markers;
}

canvasImageEl.addEventListener("load", renderCanvas);
window.addEventListener("resize", renderCanvas);

canvasEl.addEventListener("click", (event) => {
    if (!layout) return;
    const rect = canvasEl.getBoundingClientRect();
    const px = event.clientX - rect.left - layout.left;
    const py = event.clientY - rect.top - layout.top;
    if (px < 0 || py < 0 || px > layout.width || py > layout.height) return;
    openNewPostitModal(pixelToPercent(px, py));
});

// ---- Post-it-Liste + Speichern ----
async function refreshPostitList() {
    currentPostits = [];
    const eventDir = await join(postitsDir, currentBatch.eventFolderName);
    if (await exists(eventDir)) {
        for (const entry of await readDir(eventDir)) {
            if (!entry.isFile || !entry.name.endsWith(".md")) continue;
            const filePath = await join(eventDir, entry.name);
            const data = await safeReadFrontmatter(filePath);
            if (!data) continue;
            if (extractWikilinkTarget(data.Poster) !== currentPoster.fileName) continue;
            currentPostits.push({ filePath, ...data });
        }
    }
    currentPostits.sort((a, b) => String(a.Nummer).localeCompare(String(b.Nummer), undefined, { numeric: true }));

    itemListEl.innerHTML = "";
    itemListEmptyEl.classList.toggle("is-hidden", currentPostits.length > 0);
    for (const postit of currentPostits) {
        const item = document.createElement("li");
        item.className = "postits-item";

        const label = document.createElement("span");
        label.textContent = `#${postit.Nummer} · ${postit["Postit-art"] ?? ""} · ${postit.PositionX}% / ${postit.PositionY}%`;
        item.appendChild(label);

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "link-secondary";
        deleteButton.textContent = "×";
        deleteButton.addEventListener("click", async () => {
            await remove(postit.filePath);
            await refreshPostitList();
            renderCanvas();
        });
        item.appendChild(deleteButton);

        itemListEl.appendChild(item);
    }
    renderCanvas();
}

function nextPostitNumber() {
    const numbers = currentPostits.map((p) => parseInt(p.Nummer, 10)).filter((n) => !isNaN(n));
    return String((numbers.length > 0 ? Math.max(...numbers) : 0) + 1).padStart(3, "0");
}

let pendingPosition = null;

function openNewPostitModal(position) {
    pendingPosition = position;
    modalPositionEl.textContent = `Position: ${position.x.toFixed(1)}% / ${position.y.toFixed(1)}%`;
    modalNumberInput.value = nextPostitNumber();
    modalArtSelect.value = postitTypen[0] ?? "";
    modalTextInput.value = "";
    modalOverlay.classList.remove("is-hidden");
    modalNumberInput.focus();
}

modalCancelButton.addEventListener("click", () => modalOverlay.classList.add("is-hidden"));
modalOverlay.addEventListener("click", (event) => {
    if (event.target === modalOverlay) modalOverlay.classList.add("is-hidden");
});

modalSaveButton.addEventListener("click", async () => {
    const nummer = modalNumberInput.value.trim();
    if (!nummer) return;

    const eventDir = await join(postitsDir, currentBatch.eventFolderName);
    await mkdir(eventDir, { recursive: true });

    const data = {
        Nummer: nummer,
        Szenariobild: `[[${currentPoster.imageFileName}]]`,
        Poster: `[[${currentPoster.fileName}]]`,
        PositionX: pendingPosition.x,
        PositionY: pendingPosition.y,
        Textinhalt: modalTextInput.value.trim(),
        "Postit-art": modalArtSelect.value,
        Person: "",
    };
    await writeNote(await join(eventDir, `postit_${currentPoster.name}_${nummer}.md`), data);

    modalOverlay.classList.add("is-hidden");
    await refreshPostitList();
});

// ---- Start ----
await loadPostitTypen();
const initialPosters = await loadAllPosters();
const batches = await buildRawImageBatches(initialPosters);
renderBatchList(batches);
