import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { basename, join } from "@tauri-apps/api/path";
import { readDir, readTextFile } from "@tauri-apps/plugin-fs";
import { load as loadYaml } from "js-yaml";
import { load as loadStore } from "@tauri-apps/plugin-store";

const filesToRename = JSON.parse(sessionStorage.getItem("filesToRename")) ?? [];

const image = document.querySelector("#rename-image");
const originalNameLabel = document.querySelector("#rename-original-name");
const newNameInput = document.querySelector("#rename-new-name");
const eventSelect = document.querySelector("#rename-event-select");
const numberInput = document.querySelector("#rename-number-input");
const editNameButton = document.querySelector("#rename-edit-name-button");

let currentDate = null;
let currentRules = null;
let manualOverride = false;

const store = await loadStore("settings.json", { autoSave: false });
const activeVault = await store.get("activeVault");
await invoke("expand_scope", { folderPath: activeVault });
const protokollDir = await join(activeVault, "Media", "Images", "Protokolle(RAW)");

if (filesToRename.length > 0) {
    const currentFile = filesToRename[0];
    image.src = convertFileSrc(currentFile);
    originalNameLabel.textContent = await basename(currentFile);
}

const eventEntries = await readDir(protokollDir);
for (const entry of eventEntries) {
    if (entry.isDirectory) {
        const option = document.createElement("option");
        option.value = entry.name;
        option.textContent = entry.name;
        eventSelect.appendChild(option);
    }
}

async function findEventDate(eventName) {
    const eventPath = await join(protokollDir, eventName);
    const files = await readDir(eventPath);
    for (const file of files) {
        const match = file.name.match(/^p_(\d{4}-\d{2}-\d{2})_/);
        if (match) return match[1];
    }
    return null;
}

async function computeNextNumber(eventName, date, rules) {
    const eventPath = await join(protokollDir, eventName);
    const files = await readDir(eventPath);
    const pattern = new RegExp(`^${rules.prefix}_${date}_(\\d+)`);

    let highestUnderMax = 0;
    let highestOverall = 0;
    for (const file of files) {
        const match = file.name.match(pattern);
        if (!match) continue;
        const number = parseInt(match[1], 10);
        if (number > highestOverall) highestOverall = number;
        if (number <= rules.counterMax && number > highestUnderMax) highestUnderMax = number;
    }

    const next = highestUnderMax < rules.counterMax ? highestUnderMax + 1 : highestOverall + 1;
    return String(next).padStart(rules.counterDigits, "0");
}

function updateNameFromFields() {
    if (manualOverride) return;
    if (!currentDate || !currentRules) return;
    newNameInput.value = `${currentRules.prefix}_${currentDate}_${numberInput.value}`;
}

async function onEventChange() {
    const eventName = eventSelect.value;
    if (!eventName) return;

    currentDate = await findEventDate(eventName);
    if (!currentDate) return;

    const rulesPath = await join(activeVault, "Einstellungen", "naming-rules.md");
    const raw = await readTextFile(rulesPath);
    const frontmatter = raw.split("---")[1];
    currentRules = loadYaml(frontmatter).protokoll;

    numberInput.value = await computeNextNumber(eventName, currentDate, currentRules);
    updateNameFromFields();
}

eventSelect.addEventListener("change", onEventChange);
numberInput.addEventListener("input", updateNameFromFields);

editNameButton.addEventListener("click", () => {
    manualOverride = !manualOverride;
    newNameInput.readOnly = !manualOverride;
    if (manualOverride) newNameInput.focus();
});
