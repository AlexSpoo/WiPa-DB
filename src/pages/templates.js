import { invoke } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { readDir, readTextFile, writeTextFile, mkdir, exists, remove } from "@tauri-apps/plugin-fs";
import { load as loadYaml, dump as dumpYaml } from "js-yaml";
import { load as loadStore } from "@tauri-apps/plugin-store";

const listView = document.querySelector("#templates-list-view");
const bereicheEl = document.querySelector("#templates-bereiche");
const newBereichInput = document.querySelector("#templates-new-bereich");
const bereichOptionsEl = document.querySelector("#templates-bereich-options");
const newNameInput = document.querySelector("#templates-new-name");
const newButton = document.querySelector("#templates-new-button");

const editorView = document.querySelector("#templates-editor-view");
const editorBereichEl = document.querySelector("#templates-editor-bereich");
const editorNameInput = document.querySelector("#templates-editor-name");
const backButton = document.querySelector("#templates-back-button");
const screenshotTypBox = document.querySelector("#templates-screenshot-typ-box");
const typKuerzelInput = document.querySelector("#templates-typ-kuerzel");
const typEnglischInput = document.querySelector("#templates-typ-englisch");
const fieldsContainer = document.querySelector("#templates-fields");
const addFieldButton = document.querySelector("#templates-add-field-button");
const saveButton = document.querySelector("#templates-save-button");
const saveMessageEl = document.querySelector("#templates-save-message");

const gotoEventsButton = document.querySelector("#templates-goto-events-button");
const eventsView = document.querySelector("#templates-events-view");
const eventsBackButton = document.querySelector("#templates-events-back-button");
const eventSelect = document.querySelector("#templates-event-select");
const eventDetailEl = document.querySelector("#templates-event-detail");
const protokollTemplateSelect = document.querySelector("#templates-event-protokoll-template");
const typenChecklistEl = document.querySelector("#templates-typen-checklist");
const eventSaveButton = document.querySelector("#templates-event-save-button");
const eventSaveMessageEl = document.querySelector("#templates-event-save-message");

const store = await loadStore("settings.json", { autoSave: false });
const activeVault = await store.get("activeVault");
await invoke("expand_scope", { folderPath: activeVault });

const templatesDir = await join(activeVault, "Einstellungen", "Templates");
const screenshotTypenDir = await join(activeVault, "Typen", "Screenshot-Typen");
const eventsDir = await join(activeVault, "Events");
const projekteDir = await join(activeVault, "Projekte");

// Bekannte Bereiche, die als Startpunkt/Verlinkungsziel für "automatisch"-Felder infrage
// kommen. Für neue Bereiche (Personen, Screenshots, ...) müsste hier ein Eintrag dazukommen —
// das ist bewusst die eine Stelle, die noch nicht vollständig generisch ist (siehe Absprache).
const BEREICH_FOLDERS = { Event: eventsDir, Projekt: projekteDir };

async function firstSampleNote(bereich) {
    const dir = BEREICH_FOLDERS[bereich];
    if (!dir || !(await exists(dir))) return null;
    const entries = (await readDir(dir)).filter((e) => e.isFile && e.name.endsWith(".md"));
    if (entries.length === 0) return null;
    return readFrontmatter(await join(dir, entries[0].name));
}

async function discoverFields(bereich) {
    const data = await firstSampleNote(bereich);
    return data ? Object.keys(data) : [];
}

async function sampleFieldIsLink(bereich, fieldName) {
    const data = await firstSampleNote(bereich);
    const value = data?.[fieldName];
    return typeof value === "string" && /\[\[.+?\]\]/.test(value);
}

async function guessLinkedBereich(bereich, fieldName) {
    const data = await firstSampleNote(bereich);
    const value = data?.[fieldName];
    const target = extractWikilinkTarget(value);
    if (!target) return null;
    for (const [name, dir] of Object.entries(BEREICH_FOLDERS)) {
        if (await exists(await join(dir, `${target}.md`))) return name;
    }
    return null;
}

function isScreenshotsBereich(bereich) {
    return bereich.trim().toLowerCase() === "screenshots";
}

async function readFrontmatter(filePath) {
    const raw = await readTextFile(filePath);
    return loadYaml(raw.split("---")[1]);
}

function extractWikilinkTarget(value) {
    if (typeof value !== "string") return null;
    const match = value.match(/\[\[(.+?)\]\]/);
    return match ? match[1] : value;
}

const FIELD_TYPES = [
    ["text", "Text"],
    ["automatisch-zahl", "Automatische Zahl"],
    ["einfachauswahl", "Einfachauswahl"],
    ["freitext-liste", "Freitext-Liste"],
    ["automatisch", "Automatisch (aus Event)"],
    ["verknüpfung-mehrfach", "Verknüpfung (mehrfach)"],
];

const SUBFIELD_TYPES = [
    ["text", "Text"],
    ["zahl", "Zahl"],
    ["einfachauswahl", "Einfachauswahl"],
    ["freitext-liste", "Freitext-Liste"],
];

let currentTemplate = null;
let originalName = null;
let originalTypName = null;
let saveMessageTimeout = null;

// ---- Übersicht ----

async function listBereiche() {
    if (!(await exists(templatesDir))) return [];
    return (await readDir(templatesDir)).filter((e) => e.isDirectory).map((e) => e.name).sort();
}

async function listTemplateNames(bereich) {
    const dir = await join(templatesDir, bereich);
    if (!(await exists(dir))) return [];
    return (await readDir(dir))
        .filter((e) => e.isFile && e.name.endsWith(".md"))
        .map((e) => e.name.replace(/\.md$/, ""))
        .sort();
}

async function renderListView() {
    bereicheEl.innerHTML = "";
    bereichOptionsEl.innerHTML = "";
    const bereiche = await listBereiche();

    for (const bereich of bereiche) {
        const option = document.createElement("option");
        option.value = bereich;
        bereichOptionsEl.appendChild(option);

        const section = document.createElement("div");
        section.className = "templates-bereich";

        const heading = document.createElement("h2");
        heading.textContent = bereich;
        section.appendChild(heading);

        const list = document.createElement("ul");
        list.className = "templates-list";
        const names = await listTemplateNames(bereich);
        for (const name of names) {
            const item = document.createElement("li");
            item.className = "templates-list-item";
            item.textContent = name;
            item.addEventListener("click", () => openEditor(bereich, name));
            list.appendChild(item);
        }
        section.appendChild(list);
        bereicheEl.appendChild(section);
    }
}

function showList() {
    editorView.classList.add("is-hidden");
    listView.classList.remove("is-hidden");
}

function showEditor() {
    listView.classList.add("is-hidden");
    editorView.classList.remove("is-hidden");
}

async function updateScreenshotTypBox(bereich, name) {
    if (!isScreenshotsBereich(bereich)) {
        screenshotTypBox.classList.add("is-hidden");
        typKuerzelInput.value = "";
        typEnglischInput.value = "";
        return;
    }
    screenshotTypBox.classList.remove("is-hidden");
    const filePath = await join(screenshotTypenDir, `Screenshot-Typ_${name}.md`);
    if (await exists(filePath)) {
        const data = await readFrontmatter(filePath);
        typKuerzelInput.value = data?.Kürzel ?? "";
        typEnglischInput.value = data?.["Englischer Name"] ?? "";
    } else {
        typKuerzelInput.value = "";
        typEnglischInput.value = "";
    }
}

newButton.addEventListener("click", async () => {
    const bereich = newBereichInput.value.trim();
    const name = newNameInput.value.trim();
    if (!bereich || !name) return;

    currentTemplate = { bereich, felder: [] };
    originalName = null;
    originalTypName = null;
    newBereichInput.value = "";
    newNameInput.value = "";

    showEditor();
    editorBereichEl.textContent = bereich;
    editorNameInput.value = name;
    saveMessageEl.classList.add("is-hidden");
    await updateScreenshotTypBox(bereich, name);
    renderFields();
});

async function openEditor(bereich, name) {
    const filePath = await join(templatesDir, bereich, `${name}.md`);
    const data = await readFrontmatter(filePath);
    currentTemplate = { bereich, felder: data.felder ?? [] };
    originalName = name;
    originalTypName = isScreenshotsBereich(bereich) ? name : null;

    showEditor();
    editorBereichEl.textContent = bereich;
    editorNameInput.value = name;
    saveMessageEl.classList.add("is-hidden");
    await updateScreenshotTypBox(bereich, name);
    renderFields();
}

backButton.addEventListener("click", async () => {
    showList();
    await renderListView();
});

// ---- Editor ----

function renderSubfieldExtra(sub, container) {
    container.innerHTML = "";
    if (sub.typ === "einfachauswahl") {
        const textarea = document.createElement("textarea");
        textarea.rows = 2;
        textarea.placeholder = "eine Option pro Zeile";
        textarea.value = (sub.optionen ?? []).join("\n");
        textarea.addEventListener("input", () => {
            sub.optionen = textarea.value.split("\n").map((line) => line.trim()).filter(Boolean);
        });
        container.appendChild(textarea);
    }
}

function renderSubfields(field, container) {
    container.innerHTML = "";
    field.unterfelder.forEach((sub, index) => {
        const row = document.createElement("div");
        row.className = "tpl-subfield-row";

        const nameInput = document.createElement("input");
        nameInput.placeholder = "Feldname";
        nameInput.value = sub.name ?? "";
        nameInput.addEventListener("input", () => { sub.name = nameInput.value; });

        const typSelect = document.createElement("select");
        for (const [value, label] of SUBFIELD_TYPES) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = label;
            typSelect.appendChild(option);
        }
        typSelect.value = sub.typ ?? "text";

        const extra = document.createElement("div");
        extra.className = "tpl-subfield-extra";
        renderSubfieldExtra(sub, extra);

        typSelect.addEventListener("change", () => {
            sub.typ = typSelect.value;
            renderSubfieldExtra(sub, extra);
        });

        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "link-secondary";
        removeButton.textContent = "entfernen";
        removeButton.addEventListener("click", () => {
            field.unterfelder.splice(index, 1);
            renderSubfields(field, container);
        });

        row.append(nameInput, typSelect, extra, removeButton);
        container.appendChild(row);
    });
}

// Baut aus einem gespeicherten Pfad wie "Event.Projekt.Name" die Kette aus
// {bereich, feld}-Schritten wieder auf, indem an echten Beispiel-Notizen geprüft
// wird, ob ein Feld ein Wikilink ist und wohin es zeigt.
async function buildChainFromQuelle(quelle) {
    const parts = (quelle || "Event").split(".").filter(Boolean);
    const startBereich = parts[0] || "Event";
    const chain = [];
    let bereich = startBereich;
    for (let i = 1; i < parts.length; i++) {
        chain.push({ bereich, feld: parts[i] });
        if (await sampleFieldIsLink(bereich, parts[i])) {
            bereich = (await guessLinkedBereich(bereich, parts[i])) ?? bereich;
        }
    }
    return { startBereich, chain };
}

function renderQuellePicker(field, container) {
    async function rerender() {
        container.innerHTML = "";
        const { startBereich, chain } = await buildChainFromQuelle(field.quelle);

        const startLabel = document.createElement("span");
        startLabel.className = "tpl-quelle-start";
        startLabel.textContent = startBereich;
        container.appendChild(startLabel);

        let bereich = startBereich;
        for (let i = 0; i <= chain.length; i++) {
            const fieldNames = await discoverFields(bereich);
            const select = document.createElement("select");
            const placeholder = document.createElement("option");
            placeholder.value = "";
            placeholder.textContent = "(Feld wählen)";
            select.appendChild(placeholder);
            for (const name of fieldNames) {
                const option = document.createElement("option");
                option.value = name;
                option.textContent = name;
                select.appendChild(option);
            }
            select.value = chain[i]?.feld ?? "";

            select.addEventListener("change", () => {
                const kept = [startBereich, ...chain.slice(0, i).map((hop) => hop.feld), select.value].filter(Boolean);
                field.quelle = kept.join(".");
                rerender();
            });
            container.appendChild(select);

            if (!chain[i]) break;

            const removeButton = document.createElement("button");
            removeButton.type = "button";
            removeButton.className = "link-secondary";
            removeButton.textContent = "×";
            removeButton.title = "diesen und weitere Schritte entfernen";
            removeButton.addEventListener("click", () => {
                const kept = [startBereich, ...chain.slice(0, i).map((hop) => hop.feld)].filter(Boolean);
                field.quelle = kept.join(".");
                rerender();
            });
            container.appendChild(removeButton);

            if (!(await sampleFieldIsLink(bereich, chain[i].feld))) break;

            const nextBereich = await guessLinkedBereich(bereich, chain[i].feld);
            const arrow = document.createElement("span");
            arrow.className = "tpl-quelle-arrow";
            arrow.textContent = `→ ${nextBereich ?? "?"}`;
            container.appendChild(arrow);
            bereich = nextBereich ?? bereich;
        }
    }

    rerender();
}

function renderFieldExtra(field, container) {
    container.innerHTML = "";

    if (field.typ === "einfachauswahl") {
        const textarea = document.createElement("textarea");
        textarea.rows = 3;
        textarea.placeholder = "eine Option pro Zeile";
        textarea.value = (field.optionen ?? []).join("\n");
        textarea.addEventListener("input", () => {
            field.optionen = textarea.value.split("\n").map((line) => line.trim()).filter(Boolean);
        });
        container.appendChild(textarea);
    } else if (field.typ === "automatisch") {
        const quelleLabel = document.createElement("div");
        quelleLabel.className = "tpl-subfields-heading";
        quelleLabel.textContent = "Quelle (Feld wählen, ggf. weiter in eine verlinkte Notiz):";

        const quellePickerBox = document.createElement("div");
        quellePickerBox.className = "tpl-quelle-picker";
        renderQuellePicker(field, quellePickerBox);

        const editierbarLabel = document.createElement("label");
        editierbarLabel.className = "tpl-checkbox-label";
        const editierbarCheckbox = document.createElement("input");
        editierbarCheckbox.type = "checkbox";
        editierbarCheckbox.checked = !!field.editierbar;
        editierbarCheckbox.addEventListener("change", () => { field.editierbar = editierbarCheckbox.checked; });
        editierbarLabel.append(editierbarCheckbox, " editierbar");

        container.append(quelleLabel, quellePickerBox, editierbarLabel);
    } else if (field.typ === "verknüpfung-mehrfach") {
        const zielInput = document.createElement("input");
        zielInput.placeholder = "Ziel (z. B. Screenshots, Personen)";
        zielInput.value = field.ziel ?? "";
        zielInput.addEventListener("input", () => { field.ziel = zielInput.value; });

        const autoInput = document.createElement("input");
        autoInput.placeholder = "Automatik-Hinweis (optional)";
        autoInput.value = field.auto ?? "";
        autoInput.addEventListener("input", () => { field.auto = autoInput.value; });

        const subfieldsHeading = document.createElement("div");
        subfieldsHeading.className = "tpl-subfields-heading";
        subfieldsHeading.textContent = "Unterfelder (werden auf die verknüpfte Notiz geschrieben):";

        const unterfelderBox = document.createElement("div");
        unterfelderBox.className = "tpl-subfields";
        field.unterfelder = field.unterfelder ?? [];
        renderSubfields(field, unterfelderBox);

        const addSubfieldButton = document.createElement("button");
        addSubfieldButton.type = "button";
        addSubfieldButton.className = "link-secondary";
        addSubfieldButton.textContent = "+ Unterfeld hinzufügen";
        addSubfieldButton.addEventListener("click", () => {
            field.unterfelder.push({ name: "", typ: "text" });
            renderSubfields(field, unterfelderBox);
        });

        container.append(zielInput, autoInput, subfieldsHeading, unterfelderBox, addSubfieldButton);
    }
}

function renderFieldRow(field, index) {
    const row = document.createElement("div");
    row.className = "tpl-field-row";

    const nameInput = document.createElement("input");
    nameInput.className = "tpl-field-name";
    nameInput.placeholder = "Feldname";
    nameInput.value = field.name ?? "";
    nameInput.addEventListener("input", () => { field.name = nameInput.value; });

    const kategorieInput = document.createElement("input");
    kategorieInput.className = "tpl-field-kategorie";
    kategorieInput.placeholder = "Kategorie (Formular-Abschnitt)";
    kategorieInput.value = field.kategorie ?? "";
    kategorieInput.addEventListener("input", () => { field.kategorie = kategorieInput.value; });

    const typSelect = document.createElement("select");
    for (const [value, label] of FIELD_TYPES) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        typSelect.appendChild(option);
    }
    typSelect.value = field.typ ?? "text";

    const extraContainer = document.createElement("div");
    extraContainer.className = "tpl-field-extra";
    renderFieldExtra(field, extraContainer);

    typSelect.addEventListener("change", () => {
        field.typ = typSelect.value;
        renderFieldExtra(field, extraContainer);
    });

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "link-secondary";
    removeButton.textContent = "Feld entfernen";
    removeButton.addEventListener("click", () => {
        currentTemplate.felder.splice(index, 1);
        renderFields();
    });

    row.append(nameInput, kategorieInput, typSelect, extraContainer, removeButton);
    return row;
}

function renderFields() {
    fieldsContainer.innerHTML = "";
    currentTemplate.felder.forEach((field, index) => {
        fieldsContainer.appendChild(renderFieldRow(field, index));
    });
}

addFieldButton.addEventListener("click", () => {
    currentTemplate.felder.push({ name: "", kategorie: "", typ: "text" });
    renderFields();
});

async function saveScreenshotTyp(name) {
    const filePath = await join(screenshotTypenDir, `Screenshot-Typ_${name}.md`);
    const data = {
        Name: name,
        Kürzel: typKuerzelInput.value.trim(),
        "Englischer Name": typEnglischInput.value.trim(),
        Template: `[[${name}]]`,
    };
    const frontmatter = dumpYaml(data, { sortKeys: false, lineWidth: -1 });
    await mkdir(screenshotTypenDir, { recursive: true });
    await writeTextFile(filePath, `---\n${frontmatter}---\n`);

    if (originalTypName && originalTypName !== name) {
        const oldPath = await join(screenshotTypenDir, `Screenshot-Typ_${originalTypName}.md`);
        if (await exists(oldPath)) await remove(oldPath);
    }
    originalTypName = name;
}

saveButton.addEventListener("click", async () => {
    const newName = editorNameInput.value.trim();
    if (!newName) return;

    const dir = await join(templatesDir, currentTemplate.bereich);
    await mkdir(dir, { recursive: true });

    const data = { bereich: currentTemplate.bereich, name: newName, felder: currentTemplate.felder };
    const frontmatter = dumpYaml(data, { sortKeys: false, lineWidth: -1 });
    await writeTextFile(await join(dir, `${newName}.md`), `---\n${frontmatter}---\n`);

    if (originalName && originalName !== newName) {
        await remove(await join(dir, `${originalName}.md`));
    }
    originalName = newName;

    if (isScreenshotsBereich(currentTemplate.bereich)) {
        await saveScreenshotTyp(newName);
    }

    saveMessageEl.classList.remove("is-hidden");
    clearTimeout(saveMessageTimeout);
    saveMessageTimeout = setTimeout(() => saveMessageEl.classList.add("is-hidden"), 2500);
});

// ---- Event-Zuordnung ----

let eventSaveMessageTimeout = null;

async function listEvents() {
    const events = [];
    for (const entry of await readDir(eventsDir)) {
        if (!entry.isFile || !entry.name.endsWith(".md")) continue;
        const data = await readFrontmatter(await join(eventsDir, entry.name));
        if (!data?.Name) continue;
        events.push({ name: data.Name, fileName: entry.name.replace(/\.md$/, "") });
    }
    return events.sort((a, b) => a.name.localeCompare(b.name));
}

async function listPersonenTemplateNames() {
    const bereiche = await listBereiche();
    const personenBereich = bereiche.find((b) => b.trim().toLowerCase() === "personen");
    if (!personenBereich) return [];
    return listTemplateNames(personenBereich);
}

async function listScreenshotTypNames() {
    if (!(await exists(screenshotTypenDir))) return [];
    const names = [];
    for (const entry of await readDir(screenshotTypenDir)) {
        if (!entry.isFile || !entry.name.endsWith(".md")) continue;
        const data = await readFrontmatter(await join(screenshotTypenDir, entry.name));
        if (data?.Name) names.push(data.Name);
    }
    return names.sort((a, b) => a.localeCompare(b));
}

// Ersetzt/ergänzt einzelne Top-Level-Schlüssel im Frontmatter, ohne alle anderen
// Felder (inkl. mehrzeiliger Listen) anzufassen.
function splitFrontmatterEntries(frontmatterText) {
    const lines = frontmatterText.split("\n").filter((line) => line !== "");
    const entries = [];
    for (const line of lines) {
        if (/^\S.*:/.test(line)) {
            entries.push([line]);
        } else if (entries.length > 0) {
            entries[entries.length - 1].push(line);
        }
    }
    return entries;
}

async function patchFrontmatterKeys(filePath, updates) {
    const raw = await readTextFile(filePath);
    const parts = raw.split("---");
    const frontmatterText = parts[1] ?? "";
    const body = parts.slice(2).join("---");

    const entries = splitFrontmatterEntries(frontmatterText);
    for (const [key, lines] of Object.entries(updates)) {
        const index = entries.findIndex((entry) => entry[0].split(":")[0].trim() === key);
        if (index >= 0) entries[index] = lines;
        else entries.push(lines);
    }

    const newFrontmatter = entries.map((entry) => entry.join("\n")).join("\n");
    await writeTextFile(filePath, `---\n${newFrontmatter}\n---${body}`);
}

function showEventsView() {
    listView.classList.add("is-hidden");
    eventsView.classList.remove("is-hidden");
}

gotoEventsButton.addEventListener("click", async () => {
    showEventsView();
    eventDetailEl.classList.add("is-hidden");
    eventSelect.value = "";
    const events = await listEvents();
    eventSelect.innerHTML = '<option value="" selected disabled>Event wählen</option>';
    for (const event of events) {
        const option = document.createElement("option");
        option.value = event.name;
        option.textContent = event.name;
        eventSelect.appendChild(option);
    }
});

eventsBackButton.addEventListener("click", async () => {
    eventsView.classList.add("is-hidden");
    listView.classList.remove("is-hidden");
    await renderListView();
});

let currentEventFileName = null;

eventSelect.addEventListener("change", async () => {
    eventSaveMessageEl.classList.add("is-hidden");
    const events = await listEvents();
    const event = events.find((e) => e.name === eventSelect.value);
    if (!event) return;
    currentEventFileName = event.fileName;

    const filePath = await join(eventsDir, `${event.fileName}.md`);
    const data = await readFrontmatter(filePath);
    const currentTemplateName = extractWikilinkTarget(data?.ProtokollTemplate);
    const currentTypNames = (Array.isArray(data?.ScreenshotTypen) ? data.ScreenshotTypen : [])
        .map(extractWikilinkTarget)
        .map((n) => n?.replace(/^Screenshot-Typ_/, ""));

    protokollTemplateSelect.innerHTML = '<option value="">(keins)</option>';
    for (const name of await listPersonenTemplateNames()) {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        protokollTemplateSelect.appendChild(option);
    }
    protokollTemplateSelect.value = currentTemplateName ?? "";

    typenChecklistEl.innerHTML = "";
    for (const name of await listScreenshotTypNames()) {
        const label = document.createElement("label");
        label.className = "templates-typ-checkbox";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = name;
        checkbox.checked = currentTypNames.includes(name);
        label.append(checkbox, name);
        typenChecklistEl.appendChild(label);
    }

    eventDetailEl.classList.remove("is-hidden");
});

eventSaveButton.addEventListener("click", async () => {
    if (!currentEventFileName) return;
    const filePath = await join(eventsDir, `${currentEventFileName}.md`);

    const templateName = protokollTemplateSelect.value;
    const selectedTypen = Array.from(typenChecklistEl.querySelectorAll("input:checked")).map((cb) => cb.value);

    const updates = {
        ProtokollTemplate: [templateName ? `ProtokollTemplate: "[[${templateName}]]"` : "ProtokollTemplate:"],
        ScreenshotTypen: [
            "ScreenshotTypen:",
            ...selectedTypen.map((name) => `  - "[[Screenshot-Typ_${name}]]"`),
        ],
    };
    await patchFrontmatterKeys(filePath, updates);

    eventSaveMessageEl.classList.remove("is-hidden");
    clearTimeout(eventSaveMessageTimeout);
    eventSaveMessageTimeout = setTimeout(() => eventSaveMessageEl.classList.add("is-hidden"), 2500);
});

await renderListView();
