import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { readDir, readTextFile, writeTextFile, mkdir, exists } from "@tauri-apps/plugin-fs";
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
const saveMoreButton = document.querySelector("#transcribe-save-more-button");
const nextButton = document.querySelector("#transcribe-next-button");

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
const personenDir = await join(activeVault, "Personen");
const screenshotsDir = await join(activeVault, "Screenshots");

function extractWikilinkTarget(value) {
    if (typeof value !== "string") return null;
    const match = value.match(/\[\[(.+?)\]\]/);
    return match ? match[1] : value;
}

async function readFrontmatter(filePath) {
    const raw = await readTextFile(filePath);
    return loadYaml(raw.split("---")[1]);
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
    };
}

function formatDate(value) {
    if (!(value instanceof Date)) return value;
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

// Template-Konfiguration für die Personen-Eingabemaske
const templateConfig = await readFrontmatter(await join(activeVault, "Einstellungen", "template-personen.md"));
const templateFields = templateConfig.felder;

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

// Schon vorhandene Personen-Notizen eines Personenordners einlesen, um
// bereits transkribierte Protokoll-Bilder herauszufiltern und die nächste
// freie Personennummer zu bestimmen.
async function loadExistingPersons(personenordner) {
    const dir = await join(personenDir, personenordner);
    const persons = [];
    if (!(await exists(dir))) return persons;

    for (const entry of await readDir(dir)) {
        if (!entry.isFile || !entry.name.endsWith(".md")) continue;
        const data = await readFrontmatter(await join(dir, entry.name));
        persons.push({
            fileName: entry.name.replace(/\.md$/, ""),
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

async function buildBatches() {
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

        batches.push({ eventName, eventFolder, openImages, info });
    }
    return batches;
}

function renderBatchList(batches) {
    batchListEl.innerHTML = "";
    batchesEmptyEl.classList.toggle("is-hidden", batches.length > 0);

    for (const batch of batches) {
        const item = document.createElement("li");
        item.className = "transcribe-batch-item";
        item.textContent = `${batch.eventName} — ${batch.openImages.length} offene Protokoll-Bild(er)`;
        item.addEventListener("click", () => {
            window.location.href = `/pages/transcribe.html?event=${encodeURIComponent(batch.eventName)}`;
        });
        batchListEl.appendChild(item);
    }
}

// ---- Bearbeitungs-Ansicht ----

let currentBatch = null;
let currentImageIndex = 0;
let currentImageState = null;

function makeEmptyImageState() {
    const values = {};
    for (const field of templateFields) {
        if (field.typ === "verknüpfung-mehrfach" || field.typ === "freitext-liste") {
            values[field.name] = [];
        } else {
            values[field.name] = "";
        }
    }
    return { values, savedPersons: [] };
}

async function startBatch(batch) {
    currentBatch = batch;
    currentImageIndex = 0;
    batchesView.classList.add("is-hidden");
    editView.classList.remove("is-hidden");
    eventLabelEl.textContent = `${batch.eventName} (${batch.info.projektName})`;
    await loadImage();
}

async function loadImage() {
    currentImageState = makeEmptyImageState();
    const fileName = currentBatch.openImages[currentImageIndex];
    imageNameEl.textContent = fileName;
    imageEl.src = convertFileSrc(await join(currentBatch.eventFolder, fileName));

    const rules = await loadNamingRules("personen");
    const datum = currentBatch.info.date;
    const existingPersons = await loadExistingPersons(currentBatch.info.personenordner);
    const baseNumber = nextBaseNumber(existingPersons, datum, rules.counterDigits);

    currentImageState.baseNumber = baseNumber;
    currentImageState.rules = rules;
    currentImageState.values.Personennummer = baseNumber;

    await renderForm();
}

async function loadUnlinkedScreenshots(personenordner) {
    const dir = await join(screenshotsDir, personenordner);
    const screenshots = [];
    if (!(await exists(dir))) return screenshots;

    for (const entry of await readDir(dir)) {
        if (!entry.isFile || !entry.name.endsWith(".md")) continue;
        const data = await readFrontmatter(await join(dir, entry.name));
        if (data?.Person) continue;
        screenshots.push({ fileName: entry.name.replace(/\.md$/, ""), id: data?.ID ?? entry.name });
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
        button.classList.toggle("is-selected", currentImageState.values[field.name] === option);
        button.addEventListener("click", () => {
            currentImageState.values[field.name] = currentImageState.values[field.name] === option ? "" : option;
            group.querySelectorAll(".transcribe-choice").forEach((btn) => {
                btn.classList.toggle("is-selected", btn.textContent === currentImageState.values[field.name]);
            });
        });
        group.appendChild(button);
    }
    container.appendChild(group);
}

function renderTextField(field, container) {
    const input = document.createElement("input");
    input.type = "text";
    input.value = currentImageState.values[field.name] ?? "";
    input.addEventListener("input", () => {
        currentImageState.values[field.name] = input.value;
    });
    container.appendChild(input);
}

function renderListField(field, container) {
    const textarea = document.createElement("textarea");
    textarea.rows = 3;
    textarea.placeholder = "ein Eintrag pro Zeile";
    textarea.value = (currentImageState.values[field.name] ?? []).join("\n");
    textarea.addEventListener("input", () => {
        currentImageState.values[field.name] = textarea.value.split("\n").map((line) => line.trim()).filter(Boolean);
    });
    container.appendChild(textarea);
}

async function renderAutomaticField(field, container) {
    if (field.quelle === "Event" && field.name === "Datum") {
        const span = document.createElement("div");
        span.className = "transcribe-static";
        span.textContent = currentBatch.info.date;
        container.appendChild(span);
        return;
    }

    if (field.quelle === "Event" && field.name === "Ort") {
        const orte = currentBatch.info.orte;
        if (orte.length > 1) {
            const select = document.createElement("select");
            for (const ort of orte) {
                const option = document.createElement("option");
                option.value = ort;
                option.textContent = ort;
                select.appendChild(option);
            }
            currentImageState.values[field.name] = currentImageState.values[field.name] || orte[0];
            select.value = currentImageState.values[field.name];
            select.addEventListener("change", () => {
                currentImageState.values[field.name] = select.value;
            });
            container.appendChild(select);
        } else {
            currentImageState.values[field.name] = currentImageState.values[field.name] || orte[0] || "";
            renderTextField(field, container);
        }
        return;
    }

    renderTextField(field, container);
}

function renderScreenshotField(field, container) {
    const list = document.createElement("div");
    list.className = "transcribe-screenshot-list";

    function renderEntries() {
        list.innerHTML = "";
        for (const [index, entry] of currentImageState.values[field.name].entries()) {
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
                currentImageState.values[field.name].splice(index, 1);
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

    loadUnlinkedScreenshots(currentBatch.info.personenordner).then((screenshots) => {
        const alreadyAdded = new Set(currentImageState.values[field.name].map((entry) => entry.fileName));
        const available = screenshots.filter((s) => !alreadyAdded.has(s.fileName));
        if (available.length === 0) {
            select.disabled = true;
            const option = document.createElement("option");
            option.textContent = "keine freien Screenshots";
            select.appendChild(option);
            return;
        }
        for (const screenshot of available) {
            const option = document.createElement("option");
            option.value = screenshot.fileName;
            option.textContent = screenshot.id;
            select.appendChild(option);
        }
    });

    addButton.addEventListener("click", () => {
        if (!select.value) return;
        const entry = { fileName: select.value };
        for (const sub of field.unterfelder) {
            entry[sub.name] = sub.typ === "freitext-liste" ? [] : "";
        }
        currentImageState.values[field.name].push(entry);
        renderEntries();
        select.querySelector(`option[value="${select.value}"]`)?.remove();
    });

    addRow.append(select, addButton);
    container.appendChild(addRow);
}

function renderCompanionsField(field, container) {
    const info = document.createElement("div");
    info.className = "transcribe-static";
    const names = currentImageState.savedPersons.map((p) => p.fileName);
    info.textContent = names.length > 0 ? names.join(", ") : "wird automatisch verknüpft, sobald es weitere Personen für dieses Protokoll gibt";
    container.appendChild(info);
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
                renderTextField(field, wrapper);
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
}

function yamlScalar(value) {
    if (value === "" || value === null || value === undefined) return "";
    const needsQuotes = /^[[{>|*&!%#`"'@,?-]/.test(value) || value.includes(": ") || value !== value.trim();
    return needsQuotes ? JSON.stringify(value) : value;
}

// Markdown-Erzeugung fürs Speichern einer Person-Notiz
async function writePersonNote(state, personNumber, companions) {
    const v = state.values;
    const fileName = `Person_${currentBatch.info.date}_${personNumber}`;
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

async function addCompanionLink(fileName, companionFileName) {
    const filePath = await join(personenDir, currentBatch.info.personenordner, `${fileName}.md`);
    const raw = await readTextFile(filePath);
    const relatedIndex = raw.indexOf("Related Protokolle:");
    let insertAt = raw.indexOf("\n", relatedIndex) + 1;
    while (raw.startsWith("  - ", insertAt)) {
        insertAt = raw.indexOf("\n", insertAt) + 1;
    }
    const before = raw.slice(0, insertAt);
    const after = raw.slice(insertAt);
    await writeTextFile(filePath, `${before}  - "[[${companionFileName}]]"\n${after}`);
}

async function savePerson() {
    const state = currentImageState;
    const companionOffset = state.rules.mitprotokollierteOffset;
    const personNumber = state.savedPersons.length === 0
        ? state.baseNumber
        : String(parseInt(state.baseNumber, 10) + companionOffset * state.savedPersons.length).padStart(state.rules.counterDigits, "0");

    const companionFileNames = state.savedPersons.map((p) => p.fileName);
    const fileName = await writePersonNote(state, personNumber, companionFileNames);

    for (const previous of state.savedPersons) {
        await addCompanionLink(previous.fileName, fileName);
    }

    state.savedPersons.push({ fileName, number: personNumber });
    return fileName;
}

saveMoreButton.addEventListener("click", async () => {
    await savePerson();
    currentImageState.values = makeEmptyImageState().values;
    currentImageState.values.Personennummer = String(
        parseInt(currentImageState.baseNumber, 10) + currentImageState.rules.mitprotokollierteOffset * currentImageState.savedPersons.length
    ).padStart(currentImageState.rules.counterDigits, "0");
    await renderForm();
});

nextButton.addEventListener("click", async () => {
    await savePerson();
    currentBatch.openImages.splice(currentImageIndex, 1);
    if (currentBatch.openImages.length === 0) {
        window.location.href = "/pages/transcribe.html";
        return;
    }
    if (currentImageIndex >= currentBatch.openImages.length) currentImageIndex = currentBatch.openImages.length - 1;
    await loadImage();
});

backToBatchesButton.addEventListener("click", () => {
    window.location.href = "/pages/transcribe.html";
});

async function refreshBatches() {
    batchesEmptyEl.textContent = "Lade Protokoll-Bilder …";
    batchesEmptyEl.classList.remove("is-hidden");
    batchListEl.innerHTML = "";
    const batches = await buildBatches();
    batchesEmptyEl.textContent = "Keine offenen Protokoll-Bilder gefunden.";
    renderBatchList(batches);
}

const urlParams = new URLSearchParams(window.location.search);
const preselectedEvent = urlParams.get("event");

if (preselectedEvent) {
    const batches = await buildBatches();
    const batch = batches.find((b) => b.eventName === preselectedEvent);
    if (batch) {
        await startBatch(batch);
    } else {
        batchesEmptyEl.textContent = "Für dieses Event gibt es keine offenen Protokoll-Bilder mehr.";
        batchesEmptyEl.classList.remove("is-hidden");
    }
} else {
    await refreshBatches();
}
