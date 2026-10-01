import { invoke } from "@tauri-apps/api/core";
import { join, basename } from "@tauri-apps/api/path";
import { readDir, readTextFile, writeTextFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import { load as loadYaml, dump as dumpYaml } from "js-yaml";
import { load as loadStore } from "@tauri-apps/plugin-store";

// ---- HTML Elemente ----
const quartierListEl = document.querySelector("#topics-quartier-list");
const contentEl = document.querySelector("#topics-content");

// ---- Vault-Grundlagen ----
const store = await loadStore("settings.json", { autoSave: false });
const activeVault = await store.get("activeVault");
await invoke("expand_scope", { folderPath: activeVault });

const projekteDir = await join(activeVault, "Projekte");
const eventsDir = await join(activeVault, "Events");
const personenDir = await join(activeVault, "Personen");
const screenshotsDir = await join(activeVault, "Screenshots");
const topicsDir = await join(activeVault, "Topics");
const szenarienDir = await join(activeVault, "Szenarien");

function extractWikilinkTarget(value) {
    if (typeof value !== "string") return null;
    const match = value.match(/\[\[(.+?)\]\]/);
    return match ? match[1] : value;
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
// Event-Unterordnern (MOSAIQ) — rekursiv suchen (siehe transcribe.js/manage.js/tag.js).
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

// ---- Grunddaten laden ----
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
    return list;
}

// Personen/Screenshots liegen pro PROJEKT in einem Ordner, nicht pro Event —
// einmal pro Projekt einlesen und cachen (siehe manage.js/tag.js).
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

// ---- Quartiere, gruppiert nach Projekt ----
async function loadQuartiereByProjekt() {
    const events = await loadAllEvents();
    const groups = new Map(); // projekt.fileName -> { projekt, quartiere: Set }
    for (const event of events) {
        if (!event.data.Quartier) continue;
        if (!groups.has(event.projekt.fileName)) {
            groups.set(event.projekt.fileName, { projekt: event.projekt, quartiere: new Set() });
        }
        groups.get(event.projekt.fileName).quartiere.add(event.data.Quartier);
    }
    return [...groups.values()]
        .sort((a, b) => a.projekt.data.Name.localeCompare(b.projekt.data.Name))
        .map((group) => ({ projekt: group.projekt, quartiere: [...group.quartiere].sort() }));
}

// Ein Quartier kann mehrere Events (und im Prinzip mehrere Projekte) umfassen
// (z. B. Moosach 1 + Moosach 2) — Personen/Screenshots über alle einsammeln.
async function loadItemsForQuartier(quartier) {
    const events = (await loadAllEvents()).filter((e) => e.data.Quartier === quartier);
    const eventFileNames = new Set(events.map((e) => e.fileName));
    const projekte = [...new Map(events.map((e) => [e.projekt.fileName, e.projekt])).values()];

    const items = [];
    for (const projekt of projekte) {
        const personen = await loadAllPersonenForProjekt(projekt);
        for (const person of personen) {
            if (eventFileNames.has(extractWikilinkTarget(person.data.Event))) {
                items.push({ kind: "person", ...person });
            }
        }

        const eventByPerson = new Map(personen.map((p) => [p.fileName, extractWikilinkTarget(p.data.Event)]));
        const screenshots = await loadAllScreenshotsForProjekt(projekt);
        for (const screenshot of screenshots) {
            const personFileName = extractWikilinkTarget(screenshot.data.Person);
            if (eventFileNames.has(eventByPerson.get(personFileName))) {
                items.push({ kind: "screenshot", ...screenshot });
            }
        }
    }
    return items;
}

// ---- Topics (Vault-Notizen: Topics/Topic_<Name>.md, Feld Codes = Roh-Codes) ----
// Heißt bewusst "Codes" und nicht "Tags": Obsidian behandelt ein Frontmatter-
// Feld namens "tags" speziell (eigenes Tag-System, keine Leerzeichen erlaubt),
// unsere Codes sollen aber möglichst nah am genauen Wortlaut bleiben (siehe tag.js).
async function loadAllTopics() {
    const list = [];
    if (!(await exists(topicsDir))) return list;
    for (const entry of await readDir(topicsDir)) {
        if (!entry.isFile || !entry.name.endsWith(".md")) continue;
        const filePath = await join(topicsDir, entry.name);
        const data = await safeReadFrontmatter(filePath);
        if (!data?.Name) continue;
        list.push({ filePath, fileName: entry.name.replace(/\.md$/, ""), data });
    }
    list.sort((a, b) => a.data.Name.localeCompare(b.data.Name));
    return list;
}

async function saveTopicCodes(topic, codes) {
    await writeNote(topic.filePath, { Name: topic.data.Name, Codes: codes });
    topic.data.Codes = codes;
}

async function createTopic(name) {
    await mkdir(topicsDir, { recursive: true });
    const filePath = await join(topicsDir, `Topic_${name}.md`);
    const data = { Name: name, Codes: [] };
    await writeNote(filePath, data);
    return { filePath, fileName: `Topic_${name}`, data };
}

// ---- Szenarien (Vault-Notizen: Szenarien/Szenario_<Name>.md, Feld Topics =
// Namen der zugehörigen Topics) — many-to-many, ein Topic kann zu mehreren
// Szenarien gehören, deshalb auf der Szenario-Seite gespeichert wie schon in
// der alten "Szenarien und Topics/..."-Referenzdatei. ----
async function loadAllSzenarien() {
    const list = [];
    if (!(await exists(szenarienDir))) return list;
    for (const entry of await readDir(szenarienDir)) {
        if (!entry.isFile || !entry.name.endsWith(".md")) continue;
        const filePath = await join(szenarienDir, entry.name);
        const data = await safeReadFrontmatter(filePath);
        if (!data?.Name) continue;
        list.push({ filePath, fileName: entry.name.replace(/\.md$/, ""), data });
    }
    list.sort((a, b) => a.data.Name.localeCompare(b.data.Name));
    return list;
}

async function saveSzenarioTopics(szenario, topicNames) {
    await writeNote(szenario.filePath, { Name: szenario.data.Name, Topics: topicNames });
    szenario.data.Topics = topicNames;
}

async function createSzenario(name) {
    await mkdir(szenarienDir, { recursive: true });
    const filePath = await join(szenarienDir, `Szenario_${name}.md`);
    const data = { Name: name, Topics: [] };
    await writeNote(filePath, data);
    return { filePath, fileName: `Szenario_${name}`, data };
}

// ---- Code-Auszählung ----
function countCodes(items) {
    const counts = new Map();
    for (const item of items) {
        const codes = Array.isArray(item.data.Codes) ? item.data.Codes : [];
        for (const code of codes) {
            counts.set(code, (counts.get(code) ?? 0) + 1);
        }
    }
    return counts;
}

// ---- Quartier-Liste ----
let currentQuartier = null;

async function renderQuartierList() {
    const groups = await loadQuartiereByProjekt();
    quartierListEl.innerHTML = "";
    for (const group of groups) {
        const heading = document.createElement("div");
        heading.className = "topics-projekt-heading";
        heading.textContent = group.projekt.data.Name;
        quartierListEl.appendChild(heading);

        for (const quartier of group.quartiere) {
            const item = document.createElement("div");
            item.className = "manage-tree-row";
            if (quartier === currentQuartier) item.classList.add("is-selected");
            item.textContent = quartier;
            item.addEventListener("click", () => selectQuartier(quartier));
            quartierListEl.appendChild(item);
        }
    }
}

async function selectQuartier(quartier) {
    currentQuartier = quartier;
    await renderQuartierList();
    await renderContent();
}

// ---- Inhalt (Topics + unzugeordnete Codes) ----
async function renderContent() {
    contentEl.innerHTML = "";
    if (!currentQuartier) return;

    const items = await loadItemsForQuartier(currentQuartier);
    const codeCounts = countCodes(items);
    const topics = await loadAllTopics();
    const assignedCodes = new Set(topics.flatMap((t) => t.data.Codes ?? []));
    const szenarien = await loadAllSzenarien();

    const header = document.createElement("div");
    header.className = "manage-view-header";
    const h2 = document.createElement("h2");
    h2.textContent = currentQuartier;
    header.appendChild(h2);

    const right = document.createElement("div");
    right.className = "manage-view-header-right";

    const stats = document.createElement("span");
    stats.className = "manage-view-stats";
    stats.textContent = `${items.length} Dateien · ${codeCounts.size} verschiedene Codes`;
    right.appendChild(stats);

    const regenerateButton = document.createElement("button");
    regenerateButton.type = "button";
    regenerateButton.className = "link-secondary";
    regenerateButton.textContent = "Topics & Szenarien neu berechnen";
    regenerateButton.addEventListener("click", async () => {
        regenerateButton.disabled = true;
        regenerateButton.textContent = "Wird berechnet …";
        await regenerateTopicsForQuartier(currentQuartier, topics, szenarien);
        regenerateButton.disabled = false;
        regenerateButton.textContent = "Topics & Szenarien neu berechnen";
    });
    right.appendChild(regenerateButton);

    header.appendChild(right);
    contentEl.appendChild(header);

    // ---- Topics mit ihren zugeordneten Codes ----
    const topicsSection = document.createElement("fieldset");
    topicsSection.className = "transcribe-category";
    const topicsLegend = document.createElement("legend");
    topicsLegend.textContent = "Topics";
    topicsSection.appendChild(topicsLegend);

    for (const topic of topics) {
        // Nur Topics zeigen, die mindestens einen Code enthalten, der in diesem
        // Quartier tatsächlich vorkommt — Topics anderer Quartiere blenden wir aus.
        const topicCodes = (topic.data.Codes ?? []).filter((code) => codeCounts.has(code));
        if (topicCodes.length === 0) continue;

        const row = document.createElement("div");
        row.className = "topics-topic-row";

        const mainRow = document.createElement("div");
        mainRow.className = "topics-topic-main-row";

        const name = document.createElement("strong");
        name.textContent = topic.data.Name;
        mainRow.appendChild(name);

        const chipList = document.createElement("div");
        chipList.className = "topics-chip-list";
        for (const code of topicCodes) {
            const chip = document.createElement("span");
            chip.className = "topics-chip";
            chip.textContent = `${code} (${codeCounts.get(code)})`;

            const removeButton = document.createElement("button");
            removeButton.type = "button";
            removeButton.textContent = "×";
            removeButton.addEventListener("click", async () => {
                await saveTopicCodes(topic, (topic.data.Codes ?? []).filter((c) => c !== code));
                await renderContent();
            });
            chip.appendChild(removeButton);
            chipList.appendChild(chip);
        }
        mainRow.appendChild(chipList);
        row.appendChild(mainRow);

        // ---- Szenarien-Zuordnung dieses Topics (many-to-many) ----
        const szenarioRow = document.createElement("div");
        szenarioRow.className = "topics-szenario-row";

        const szenarioLabel = document.createElement("span");
        szenarioLabel.className = "topics-szenario-label";
        szenarioLabel.textContent = "Szenarien:";
        szenarioRow.appendChild(szenarioLabel);

        const szenarioChipList = document.createElement("div");
        szenarioChipList.className = "topics-chip-list";
        const topicSzenarien = szenarien.filter((s) => (s.data.Topics ?? []).includes(topic.data.Name));
        for (const szenario of topicSzenarien) {
            const chip = document.createElement("span");
            chip.className = "topics-chip";
            chip.textContent = szenario.data.Name;

            const removeButton = document.createElement("button");
            removeButton.type = "button";
            removeButton.textContent = "×";
            removeButton.addEventListener("click", async () => {
                await saveSzenarioTopics(szenario, (szenario.data.Topics ?? []).filter((t) => t !== topic.data.Name));
                await renderContent();
            });
            chip.appendChild(removeButton);
            szenarioChipList.appendChild(chip);
        }
        szenarioRow.appendChild(szenarioChipList);

        const szenarioSelect = document.createElement("select");
        const szenarioPlaceholder = document.createElement("option");
        szenarioPlaceholder.value = "";
        szenarioPlaceholder.textContent = "+ Szenario …";
        szenarioSelect.appendChild(szenarioPlaceholder);
        for (const szenario of szenarien) {
            if (topicSzenarien.includes(szenario)) continue;
            const option = document.createElement("option");
            option.value = szenario.fileName;
            option.textContent = szenario.data.Name;
            szenarioSelect.appendChild(option);
        }
        const newSzenarioOption = document.createElement("option");
        newSzenarioOption.value = "__neu__";
        newSzenarioOption.textContent = "+ Neues Szenario …";
        szenarioSelect.appendChild(newSzenarioOption);

        szenarioSelect.addEventListener("change", async () => {
            if (szenarioSelect.value === "__neu__") {
                const name = prompt("Name des neuen Szenarios:");
                if (!name?.trim()) { szenarioSelect.value = ""; return; }
                const szenario = await createSzenario(name.trim());
                await saveSzenarioTopics(szenario, [topic.data.Name]);
            } else if (szenarioSelect.value) {
                const szenario = szenarien.find((s) => s.fileName === szenarioSelect.value);
                await saveSzenarioTopics(szenario, [...(szenario.data.Topics ?? []), topic.data.Name]);
            }
            await renderContent();
        });
        szenarioRow.appendChild(szenarioSelect);

        row.appendChild(szenarioRow);
        topicsSection.appendChild(row);
    }
    contentEl.appendChild(topicsSection);

    // ---- Noch nicht zugeordnete Codes ----
    const unassignedSection = document.createElement("fieldset");
    unassignedSection.className = "transcribe-category";
    const unassignedLegend = document.createElement("legend");
    unassignedLegend.textContent = "Noch nicht zugeordnet";
    unassignedSection.appendChild(unassignedLegend);

    const unassignedCodes = [...codeCounts.keys()]
        .filter((code) => !assignedCodes.has(code))
        .sort((a, b) => codeCounts.get(b) - codeCounts.get(a));

    if (unassignedCodes.length === 0) {
        const empty = document.createElement("p");
        empty.className = "transcribe-static";
        empty.textContent = "Alle Codes sind einem Topic zugeordnet.";
        unassignedSection.appendChild(empty);
    }

    for (const code of unassignedCodes) {
        const row = document.createElement("div");
        row.className = "topics-unassigned-row";

        const label = document.createElement("span");
        label.textContent = `${code} (${codeCounts.get(code)})`;
        row.appendChild(label);

        const select = document.createElement("select");
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "Topic wählen …";
        select.appendChild(placeholder);
        for (const topic of topics) {
            const option = document.createElement("option");
            option.value = topic.fileName;
            option.textContent = topic.data.Name;
            select.appendChild(option);
        }
        const newOption = document.createElement("option");
        newOption.value = "__neu__";
        newOption.textContent = "+ Neues Topic …";
        select.appendChild(newOption);

        select.addEventListener("change", async () => {
            if (select.value === "__neu__") {
                const name = prompt("Name des neuen Topics:", code);
                if (!name?.trim()) { select.value = ""; return; }
                const topic = await createTopic(name.trim());
                await saveTopicCodes(topic, [code]);
            } else if (select.value) {
                const topic = topics.find((t) => t.fileName === select.value);
                await saveTopicCodes(topic, [...(topic.data.Codes ?? []), code]);
            }
            await renderContent();
        });
        row.appendChild(select);

        unassignedSection.appendChild(row);
    }
    contentEl.appendChild(unassignedSection);
}

// ---- "Topics & Szenarien neu berechnen" ----
async function regenerateTopicsForQuartier(quartier, topics, szenarien) {
    const items = await loadItemsForQuartier(quartier);
    const codeToTopic = new Map();
    for (const topic of topics) {
        for (const code of topic.data.Codes ?? []) codeToTopic.set(code, topic.data.Name);
    }
    // Ein Topic kann zu mehreren Szenarien gehören (many-to-many) — deshalb
    // eine Menge pro Topic statt eines einzelnen Namens.
    const topicToSzenarien = new Map();
    for (const szenario of szenarien) {
        for (const topicName of szenario.data.Topics ?? []) {
            if (!topicToSzenarien.has(topicName)) topicToSzenarien.set(topicName, new Set());
            topicToSzenarien.get(topicName).add(szenario.data.Name);
        }
    }

    for (const item of items) {
        const hasCodes = Array.isArray(item.data.Codes) && item.data.Codes.length > 0;
        const hasAdded = Array.isArray(item.data["Topics hinzugefügt"]);
        const hasRemoved = Array.isArray(item.data["Topics entfernt"]);
        // Alte, nie über dieses System bearbeitete Dateien unangetastet lassen —
        // sonst würden ihre bestehenden Topics/Szenario-Felder (aus der alten
        // MaxQDA-Auswertung) mit einer leeren automatischen Berechnung überschrieben.
        if (!hasCodes && !hasAdded && !hasRemoved) continue;

        const resolvedTopics = new Set();
        for (const code of item.data.Codes ?? []) {
            const topicName = codeToTopic.get(code);
            if (topicName) resolvedTopics.add(topicName);
        }
        for (const topicName of item.data["Topics hinzugefügt"] ?? []) resolvedTopics.add(topicName);
        for (const topicName of item.data["Topics entfernt"] ?? []) resolvedTopics.delete(topicName);

        const resolvedSzenarien = new Set();
        for (const topicName of resolvedTopics) {
            for (const szenarioName of topicToSzenarien.get(topicName) ?? []) resolvedSzenarien.add(szenarioName);
        }

        const newTopics = [...resolvedTopics].sort();
        const newSzenario = [...resolvedSzenarien].sort();
        const currentTopics = [...(Array.isArray(item.data.Topics) ? item.data.Topics : [])].sort();
        const currentSzenario = [...(Array.isArray(item.data.Szenario) ? item.data.Szenario : [])].sort();
        if (JSON.stringify(newTopics) === JSON.stringify(currentTopics)
            && JSON.stringify(newSzenario) === JSON.stringify(currentSzenario)) continue;

        const data = { ...item.data, Topics: newTopics, Szenario: newSzenario };
        await writeNote(item.filePath, data);
        item.data = data;
    }
}

// ---- Start ----
await renderQuartierList();
