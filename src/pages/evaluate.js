import { invoke } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { readDir, readTextFile, writeTextFile, exists } from "@tauri-apps/plugin-fs";
import { save } from "@tauri-apps/plugin-dialog";
import { load as loadYaml } from "js-yaml";
import { load as loadStore } from "@tauri-apps/plugin-store";

const bereichSelect = document.querySelector("#evaluate-bereich-select");
const countEl = document.querySelector("#evaluate-count");
const exportButton = document.querySelector("#evaluate-export-button");
const tableEl = document.querySelector("#evaluate-table");

const store = await loadStore("settings.json", { autoSave: false });
const activeVault = await store.get("activeVault");
await invoke("expand_scope", { folderPath: activeVault });

// Bekannte Datenbereiche und ihr Vault-Ordner — analog zur Bereichs-Registry in
// transcribe.js/templates.js, bewusst nicht generisch (siehe dortige Absprache).
const BEREICH_DIRS = {
    Personen: await join(activeVault, "Personen"),
    Screenshots: await join(activeVault, "Screenshots"),
};

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

function formatCellValue(value) {
    if (value === null || value === undefined) return "";
    if (value instanceof Date) return formatDate(value);
    if (Array.isArray(value)) return value.map(formatCellValue).join("; ");
    if (typeof value === "string") return extractWikilinkTarget(value);
    return String(value);
}

let currentColumns = [];
let currentRows = [];

async function loadBereich(bereich) {
    const dir = BEREICH_DIRS[bereich];
    const notes = await readAllNotesRecursive(dir);

    const columns = ["Datei"];
    for (const note of notes) {
        for (const key of Object.keys(note.data)) {
            if (!columns.includes(key)) columns.push(key);
        }
    }

    const rows = notes.map((note) =>
        columns.map((col) => (col === "Datei" ? note.fileName : formatCellValue(note.data[col])))
    );

    currentColumns = columns;
    currentRows = rows;
    countEl.textContent = `${rows.length} Einträge`;
    renderTable();
}

function renderTable() {
    tableEl.innerHTML = "";

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const column of currentColumns) {
        const th = document.createElement("th");
        th.textContent = column;
        headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    tableEl.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const row of currentRows) {
        const tr = document.createElement("tr");
        for (const cell of row) {
            const td = document.createElement("td");
            td.textContent = cell;
            tr.appendChild(td);
        }
        tbody.appendChild(tr);
    }
    tableEl.appendChild(tbody);
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

bereichSelect.addEventListener("change", async () => {
    try {
        await loadBereich(bereichSelect.value);
    } catch (err) {
        console.error("Konnte Bereich nicht laden:", err);
        countEl.textContent = "Fehler beim Laden — siehe Konsole.";
    }
});

exportButton.addEventListener("click", async () => {
    const filePath = await save({
        defaultPath: `${bereichSelect.value}.csv`,
        filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!filePath) return;

    const csv = toCsv(currentColumns, currentRows);
    // BOM voranstellen, damit Excel die UTF-8-Kodierung (Umlaute) korrekt erkennt.
    await writeTextFile(filePath, `﻿${csv}`);
});

await loadBereich(bereichSelect.value);
