import { invoke } from "@tauri-apps/api/core";
import { join, basename } from "@tauri-apps/api/path";
import { readDir, readTextFile, writeTextFile, writeFile, exists } from "@tauri-apps/plugin-fs";
import { save } from "@tauri-apps/plugin-dialog";
import { load as loadYaml } from "js-yaml";
import { load as loadStore } from "@tauri-apps/plugin-store";

// Portiert aus dem eigenständigen "Futures Cone"-Tool (kleine data tools für
// WiPa/Cone Visualizer V2) — dort React/JSX, hier natives SVG im App-Design.
// Statt per Hand eingefügtem JSON liest diese Version direkt aus dem Vault:
// Zeitachse = PositionZeitstrahl, Wahrscheinlichkeitszone = Wahrscheinlichkeit
// (beides Screenshot-Felder, siehe transcribe.js saveScreenshotNote). Felder,
// die eigentlich an der Person hängen (Geschlecht, Alter, Personengruppe,
// Leitfrage, Event), werden über den Person-Link nachgeladen, falls der
// Screenshot sie nicht selbst führt — siehe buildEntry().

// ---- HTML Elemente ----
const subtitleEl = document.querySelector("#cone-subtitle");
const exportSvgButton = document.querySelector("#cone-export-svg-button");
const exportPngButton = document.querySelector("#cone-export-png-button");
const tabSettingsButton = document.querySelector("#cone-tab-settings-button");
const tabDataButton = document.querySelector("#cone-tab-data-button");
const sidebarContentEl = document.querySelector("#cone-sidebar-content");
const canvasAreaEl = document.querySelector("#cone-canvas-area");

// ---- Vault-Grundlagen ----
const store = await loadStore("settings.json", { autoSave: false });
const activeVault = await store.get("activeVault");
await invoke("expand_scope", { folderPath: activeVault });

const projekteDir = await join(activeVault, "Projekte");
const personenDir = await join(activeVault, "Personen");
const screenshotsDir = await join(activeVault, "Screenshots");

function extractWikilinkTarget(value) {
    if (typeof value !== "string") return value;
    const match = value.match(/\[\[(.+?)(\|.*)?\]\]/);
    const target = match ? match[1] : value;
    return target.includes("/") ? target.slice(target.lastIndexOf("/") + 1) : target;
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

// Personen/Screenshots liegen pro Projekt in (teils verschachtelten) Unterordnern.
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

async function loadProjekte() {
    const list = [];
    if (!(await exists(projekteDir))) return list;
    for (const entry of await readDir(projekteDir)) {
        if (!entry.isFile || !entry.name.endsWith(".md")) continue;
        const filePath = await join(projekteDir, entry.name);
        const data = await safeReadFrontmatter(filePath);
        if (!data?.Name) continue;
        list.push({ fileName: entry.name.replace(/\.md$/, ""), data });
    }
    return list;
}

function toArray(value) {
    if (Array.isArray(value)) return value.map(extractWikilinkTarget).filter(Boolean);
    if (value) return [extractWikilinkTarget(value)];
    return [];
}

// Baut einen Kegel-Eintrag aus einem Screenshot. Geschlecht/Leitfrage/Alter
// geschätzt/Personengruppe/Event hängen eigentlich an der Person, nicht am
// Screenshot — erst auf dem Screenshot selbst nachsehen (falls doch dort
// geführt), sonst über den Person-Link nachladen.
function buildEntry(data, personByFileName) {
    const probability = PROBABILITY_MAP[data.Wahrscheinlichkeit];
    const time = Number(data.PositionZeitstrahl);
    if (!probability || !Number.isFinite(time) || time < 1 || time > NUM_COLUMNS) return null;

    const person = personByFileName.get(extractWikilinkTarget(data.Person)) || {};
    const fieldFromEither = (key) => data[key] ?? person[key] ?? "";

    return {
        time,
        probability,
        szenarien: toArray(data.Szenario),
        topics: toArray(data.Topics),
        einordnung: fieldFromEither("Einordnung"),
        geschlecht: fieldFromEither("Geschlecht"),
        leitfrage: fieldFromEither("Leitfrage"),
        alter: fieldFromEither("Alter geschätzt"),
        personengruppe: fieldFromEither("Personengruppe"),
        event: extractWikilinkTarget(fieldFromEither("Event")),
    };
}

async function loadAllEntries() {
    const projekte = await loadProjekte();
    const entries = [];
    let total = 0;

    for (const projekt of projekte) {
        const personenDirForProjekt = await join(personenDir, projekt.data.Personenordner || "");
        const personen = [];
        for (const filePath of await collectMdFilesRecursive(personenDirForProjekt)) {
            const data = await safeReadFrontmatter(filePath);
            if (!data) continue;
            personen.push({ fileName: (await basename(filePath)).replace(/\.md$/, ""), data });
        }
        const personByFileName = new Map(personen.map((p) => [p.fileName, p.data]));

        const screenshotsDirForProjekt = await join(screenshotsDir, projekt.data.Personenordner || "");
        for (const filePath of await collectMdFilesRecursive(screenshotsDirForProjekt)) {
            const data = await safeReadFrontmatter(filePath);
            if (!data) continue;
            total++;
            const entry = buildEntry(data, personByFileName);
            if (entry) entries.push(entry);
        }
    }

    return { entries, total };
}

// ==== Geometrie & Konstanten (siehe Original-Tool) ====

const SVG_WIDTH = 1400;
const SVG_HEIGHT = 720;
const APEX_X = 180;
const APEX_Y = 360;
const CONE_END_X = 1140;
const ARC_BULGE_FACTOR = 0.38;
const NUM_COLUMNS = 15;
const BIG_BUCKETS = 3;
// Der Kegel spitzt sich nur auf den ersten FLATTEN_FRACTION der Strecke zu
// (rein visuell) — ab FLATTEN_X beginnt die eigentliche Zeitachse.
const FLATTEN_FRACTION = 0.2;
const FLATTEN_X = APEX_X + (CONE_END_X - APEX_X) * FLATTEN_FRACTION;

const TIME_ZONE_LABELS = [
    { label: "demnächst", pos: 0.15 },
    { label: "in naher Zukunft", pos: 0.5 },
    { label: "in ferner Zukunft", pos: 0.85 },
];
const TIME_LABEL_Y = SVG_HEIGHT - 20;
const TIME_LABEL_FONT_SIZE = 15;
const TIME_LABEL_CENTER_Y = TIME_LABEL_Y - TIME_LABEL_FONT_SIZE * 0.35;

const ZONE_ORDER = ["eher_nicht", "könnte", "sicher"];
const ZONE_CONFIG = {
    sicher: { label: "passiert\nziemlich\nsicher", halfSpread: 100 },
    könnte: { label: "könnte\npassieren", halfSpread: 200 },
    eher_nicht: { label: "passiert\neher nicht", halfSpread: 300 },
};

// Mehrere Schreibweisen pro Zone, weil sich die Formulierung im Vault über
// die Zeit geändert hat (ältere Screenshots tragen noch die Kurzform) — beide
// Varianten müssen auf dieselbe Zone abbilden, sonst fehlen ältere Einträge
// im Kegel komplett. "nicht protokolliert" bleibt bewusst unzugeordnet.
const PROBABILITY_MAP = {
    "sicher": "sicher",
    "passiert ziemlich sicher": "sicher",
    "könnte": "könnte",
    "könnte passieren": "könnte",
    "eher_nicht": "eher_nicht",
    "passiert eher nicht": "eher_nicht",
};

// Einheitliche Schrift der App statt der Web-Fonts des Original-Tools
// (IBM Plex Serif/Mono) — die App ist offline nutzbar, lädt also keine
// Google Fonts nach.
const FONT_FAMILY = "'Roboto Mono', ui-monospace, 'Cascadia Mono', 'Consolas', 'SFMono-Regular', 'Liberation Mono', monospace";

// Farbschemata für den EXPORTIERTEN Kegel (nicht die App selbst) — in der
// Sidebar unter "Farbschema" auswählbar, die Farbwähler darunter übersteuern
// das gewählte Schema live.
const COLOR_SCHEMES = {
    standard: { name: "Standard", background: "#ffffff", lineColor: "#1a1a1a", dataColor: "#dc2626", textColor: "#333333", labelBoxColor: "#111111", labelTextColor: "#ffffff" },
    midnight: { name: "Midnight", background: "#0f172a", lineColor: "#e2e8f0", dataColor: "#38bdf8", textColor: "#cbd5e1", labelBoxColor: "#1e293b", labelTextColor: "#e2e8f0" },
    kiosk_mix: { name: "Kiosk Mix", background: "#FF752B", lineColor: "#ffffff", dataColor: "#0046AA", textColor: "#ffffff", labelBoxColor: "#0046AA", labelTextColor: "#FFECE2" },
    kiosk_blue: { name: "Kiosk Blau", background: "#0046AA", lineColor: "#FFECE2", dataColor: "#FFECE2", textColor: "#FFECE2", labelBoxColor: "#FFECE2", labelTextColor: "#0046AA" },
    kiosk_orange: { name: "Kiosk Orange", background: "#FF752B", lineColor: "#FFECE2", dataColor: "#FFECE2", textColor: "#FFECE2", labelBoxColor: "#FFECE2", labelTextColor: "#FF752B" },
};

function hexToRgb(hex) {
    const clean = hex.replace("#", "");
    const bigint = parseInt(clean, 16);
    return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
}

function escapeXml(text) {
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtml(text) {
    return String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function getZonePath(halfSpread) {
    const topY = APEX_Y - halfSpread;
    const bottomY = APEX_Y + halfSpread;
    const rx = halfSpread * ARC_BULGE_FACTOR;
    const ry = halfSpread;
    return `M ${APEX_X},${APEX_Y} L ${FLATTEN_X},${topY} L ${CONE_END_X},${topY} A ${rx},${ry} 0 0,1 ${CONE_END_X},${bottomY} L ${FLATTEN_X},${bottomY} Z`;
}

function getZoneTopPath(halfSpread) {
    const topY = APEX_Y - halfSpread;
    const rx = halfSpread * ARC_BULGE_FACTOR;
    const ry = halfSpread;
    const midX = CONE_END_X + rx;
    return `M ${APEX_X},${APEX_Y} L ${FLATTEN_X},${topY} L ${CONE_END_X},${topY} A ${rx},${ry} 0 0,1 ${midX},${APEX_Y} Z`;
}

function getZoneBottomPath(halfSpread) {
    const bottomY = APEX_Y + halfSpread;
    const rx = halfSpread * ARC_BULGE_FACTOR;
    const ry = halfSpread;
    const midX = CONE_END_X + rx;
    return `M ${APEX_X},${APEX_Y} L ${midX},${APEX_Y} A ${rx},${ry} 0 0,1 ${CONE_END_X},${bottomY} L ${FLATTEN_X},${bottomY} Z`;
}

// Ring-Mittelradius je Zone (Abstand von der Mittellinie) für Punkte/Balken —
// Zonen sind ineinander verschachtelt, der sichtbare "Ring" liegt zwischen dem
// halfSpread der nächstinneren Zone und dem eigenen.
const ZONE_RING_INFO = (() => {
    const info = {};
    let prevSpread = 0;
    for (const zoneKey of [...ZONE_ORDER].reverse()) {
        const zone = ZONE_CONFIG[zoneKey];
        info[zoneKey] = { center: (prevSpread + zone.halfSpread) / 2, thickness: zone.halfSpread - prevSpread };
        prevSpread = zone.halfSpread;
    }
    return info;
})();

function countEntries(data) {
    const counts = {};
    let maxCount = 0;
    for (const { time, probability } of data) {
        const key = `${probability}-${time}`;
        counts[key] = (counts[key] || 0) + 1;
        if (counts[key] > maxCount) maxCount = counts[key];
    }
    return { counts, maxCount };
}

function getBigBucketRange(b) {
    const colsPerBucket = Math.floor(NUM_COLUMNS / BIG_BUCKETS);
    const startCol = b * colsPerBucket;
    const numCols = b === BIG_BUCKETS - 1 ? NUM_COLUMNS - startCol : colsPerBucket;
    return { startCol, numCols };
}

function sumBigBucketCounts(counts, zoneKey, startCol, numCols) {
    let sum = 0;
    for (let s = 0; s < numCols; s++) sum += counts[`${zoneKey}-${startCol + s + 1}`] || 0;
    return sum;
}

function getColorForCount(count, maxCount, baseColor) {
    if (count === 0 || maxCount === 0) return "transparent";
    const intensity = count / maxCount;
    const alpha = 0.12 + intensity * 0.88;
    return `rgba(${baseColor[0]}, ${baseColor[1]}, ${baseColor[2]}, ${alpha})`;
}

function buildHeatmapPoints(counts, maxCount, colStartX, colWidth, mirror, blobScale) {
    const points = [];
    if (!maxCount) return points;
    for (const zoneKey of ZONE_ORDER) {
        const { center, thickness } = ZONE_RING_INFO[zoneKey];
        const radius = Math.max(colWidth, thickness) * blobScale;
        for (let i = 0; i < NUM_COLUMNS; i++) {
            const count = counts[`${zoneKey}-${i + 1}`] || 0;
            if (!count) continue;
            const intensity = Math.min(1, 0.35 + (count / maxCount) * 0.65);
            const x = colStartX + (i + 0.5) * colWidth;
            if (mirror === "top" || mirror === "both") points.push({ x, y: APEX_Y - center, radius, intensity });
            if (mirror === "bottom" || mirror === "both") points.push({ x, y: APEX_Y + center, radius, intensity });
        }
    }
    return points;
}

// Packt `count` Punkte als zentriertes, deterministisches Grid in eine Zelle
// (kein Zufall, damit ein Export reproduzierbar bleibt).
function packDotsInCell(count, cellX, cellWidth, bandTop, bandHeight, radius) {
    if (!count) return [];
    const gap = radius * 0.6;
    const step = radius * 2 + gap;
    const cols = Math.max(1, Math.floor(cellWidth / step));
    const rows = Math.ceil(count / cols);
    const totalHeight = rows * step - gap;
    const startY = bandTop + bandHeight / 2 - totalHeight / 2;

    const dots = [];
    for (let r = 0; r < rows; r++) {
        const dotsInRow = Math.min(cols, count - r * cols);
        const rowWidth = dotsInRow * step - gap;
        const rowStartX = cellX + cellWidth / 2 - rowWidth / 2;
        for (let c = 0; c < dotsInRow; c++) {
            dots.push({ x: rowStartX + c * step + radius, y: startY + r * step + radius });
        }
    }
    return dots;
}

// Rechteck-Pfad, der nur an einer Seite (oben ODER unten) abgerundet ist —
// ein Balken liegt an der Grundlinie flach an und ist nur an der Spitze rund.
function halfRoundedRectPath(x, y, width, height, radius, roundTop) {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    if (roundTop) {
        return `M ${x},${y + height} L ${x},${y + r} A ${r},${r} 0 0,1 ${x + r},${y} L ${x + width - r},${y} A ${r},${r} 0 0,1 ${x + width},${y + r} L ${x + width},${y + height} Z`;
    }
    return `M ${x},${y} L ${x + width},${y} L ${x + width},${y + height - r} A ${r},${r} 0 0,1 ${x + width - r},${y + height} L ${x + r},${y + height} A ${r},${r} 0 0,1 ${x},${y + height - r} Z`;
}

// `direction` beschreibt, an welcher Kante die "Spitze" des Balkens liegt:
// "up" = Spitze oben, "down" = Spitze unten. Die Zahl sitzt nahe der Spitze,
// außer der Balken ist dafür zu kurz — dann steht sie knapp davor.
function renderBarMarkup(x, width, baselineY, barHeight, direction, color, count, bgColor) {
    const rectY = direction === "up" ? baselineY - barHeight : baselineY;
    const tipY = direction === "up" ? rectY : rectY + barHeight;
    const labelInside = barHeight > 16;
    const labelY = direction === "up"
        ? (labelInside ? tipY + 13 : tipY - 5)
        : (labelInside ? tipY - 6 : tipY + 13);
    return `
        <path d="${halfRoundedRectPath(x, rectY, width, barHeight, 4, direction === "up")}" fill="${color}" />
        <text x="${x + width / 2}" y="${labelY}" text-anchor="middle" font-size="10"
            font-family="${FONT_FAMILY}" font-weight="600"
            fill="${labelInside ? bgColor : color}">${count}</text>
    `;
}

// Klassischer Heatmap-Algorithmus: weiche Radial-Gradient-Punkte auf einem
// Graustufen-Canvas akkumulieren, danach jeder Alphawert per Farbverlauf
// (blau -> cyan -> gelb -> rot) nachgefärbt — ergibt glatte Dichte-Verläufe
// statt der bandigen Variante über reine SVG-Filter.
const HEATMAP_PALETTE_STOPS = [
    { t: 0.0, r: 0, g: 0, b: 255, a: 0 },
    { t: 0.25, r: 0, g: 80, b: 255, a: 0.85 },
    { t: 0.45, r: 0, g: 220, b: 220, a: 1 },
    { t: 0.62, r: 60, g: 220, b: 60, a: 1 },
    { t: 0.78, r: 255, g: 220, b: 0, a: 1 },
    { t: 0.9, r: 255, g: 120, b: 0, a: 1 },
    { t: 1.0, r: 230, g: 20, b: 20, a: 1 },
];

function heatmapPaletteColor(t) {
    const clamped = Math.max(0, Math.min(1, t));
    let lower = HEATMAP_PALETTE_STOPS[0];
    let upper = HEATMAP_PALETTE_STOPS[HEATMAP_PALETTE_STOPS.length - 1];
    for (let i = 0; i < HEATMAP_PALETTE_STOPS.length - 1; i++) {
        if (clamped >= HEATMAP_PALETTE_STOPS[i].t && clamped <= HEATMAP_PALETTE_STOPS[i + 1].t) {
            lower = HEATMAP_PALETTE_STOPS[i];
            upper = HEATMAP_PALETTE_STOPS[i + 1];
            break;
        }
    }
    const span = upper.t - lower.t;
    const f = span === 0 ? 0 : (clamped - lower.t) / span;
    const r = Math.round(lower.r + (upper.r - lower.r) * f);
    const g = Math.round(lower.g + (upper.g - lower.g) * f);
    const b = Math.round(lower.b + (upper.b - lower.b) * f);
    const a = lower.a + (upper.a - lower.a) * f;
    return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
}

function buildHeatmapDataURL(points, width, height) {
    if (points.length === 0) return null;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");

    for (const { x, y, radius, intensity } of points) {
        const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
        grad.addColorStop(0, `rgba(0,0,0,${intensity})`);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
    }

    const paletteCanvas = document.createElement("canvas");
    paletteCanvas.width = 256;
    paletteCanvas.height = 1;
    const pctx = paletteCanvas.getContext("2d");
    const palGrad = pctx.createLinearGradient(0, 0, 256, 0);
    for (const { t, r, g, b, a } of HEATMAP_PALETTE_STOPS) palGrad.addColorStop(t, `rgba(${r},${g},${b},${a})`);
    pctx.fillStyle = palGrad;
    pctx.fillRect(0, 0, 256, 1);
    const palette = pctx.getImageData(0, 0, 256, 1).data;

    const imgData = ctx.getImageData(0, 0, width, height);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3];
        if (a === 0) continue;
        const pi = a * 4;
        d[i] = palette[pi];
        d[i + 1] = palette[pi + 1];
        d[i + 2] = palette[pi + 2];
        d[i + 3] = palette[pi + 3];
    }
    ctx.putImageData(imgData, 0, 0);

    return canvas.toDataURL("image/png");
}

const HEATMAP_CANVAS_SCALE = 0.6;

// ==== SVG-Aufbau ====

function buildConeSvg(opts) {
    const {
        dataTop, dataBottom, columnStart, columnEnd, illustrationUrl,
        showOutlines, showLabels, splitMode, showSplitLine, externalMaxCount,
        visualizationMode, heatmapBlobScale, dotRadius, barWidthRatio, barsUniformDirection,
        bgColor, lineColor, dataColor, textColor, labelBoxColor, labelTextColor,
        topHalfLabel, bottomHalfLabel,
    } = opts;

    const dataRgb = hexToRgb(dataColor);
    const { counts: countsTop, maxCount: maxCountInternal } = countEntries(dataTop);
    const { counts: countsBottom } = splitMode && dataBottom ? countEntries(dataBottom) : { counts: {} };
    const maxCount = externalMaxCount ?? maxCountInternal;

    let bigZoneMaxSum = 0;
    if (visualizationMode === "bigzones") {
        const scan = (counts) => {
            for (const zoneKey of ZONE_ORDER) {
                for (let b = 0; b < BIG_BUCKETS; b++) {
                    const { startCol, numCols } = getBigBucketRange(b);
                    const sum = sumBigBucketCounts(counts, zoneKey, startCol, numCols);
                    if (sum > bigZoneMaxSum) bigZoneMaxSum = sum;
                }
            }
        };
        scan(countsTop);
        if (splitMode) scan(countsBottom);
    }

    const colStartX = FLATTEN_X + (CONE_END_X - FLATTEN_X) * (columnStart / NUM_COLUMNS);
    const colEndX = FLATTEN_X + (CONE_END_X - FLATTEN_X) * (columnEnd / NUM_COLUMNS);
    const colWidth = (colEndX - colStartX) / NUM_COLUMNS;

    const heatmapImages = {};
    if (visualizationMode === "heatmap") {
        const w = Math.round(SVG_WIDTH * HEATMAP_CANVAS_SCALE);
        const h = Math.round(SVG_HEIGHT * HEATMAP_CANVAS_SCALE);
        const scalePoints = (pts) => pts.map((p) => ({
            x: p.x * HEATMAP_CANVAS_SCALE, y: p.y * HEATMAP_CANVAS_SCALE,
            radius: p.radius * HEATMAP_CANVAS_SCALE, intensity: p.intensity,
        }));
        if (splitMode) {
            heatmapImages.top = buildHeatmapDataURL(scalePoints(buildHeatmapPoints(countsTop, maxCount, colStartX, colWidth, "top", heatmapBlobScale)), w, h);
            heatmapImages.bottom = buildHeatmapDataURL(scalePoints(buildHeatmapPoints(countsBottom, maxCount, colStartX, colWidth, "bottom", heatmapBlobScale)), w, h);
        } else {
            heatmapImages.full = buildHeatmapDataURL(scalePoints(buildHeatmapPoints(countsTop, maxCount, colStartX, colWidth, "both", heatmapBlobScale)), w, h);
        }
    }

    function renderZone(zoneKey, counts, halfId) {
        const zone = ZONE_CONFIG[zoneKey];
        const clipId = `clip-${zoneKey}${halfId ? `-${halfId}` : ""}`;
        const clipPath = halfId === "top" ? getZoneTopPath(zone.halfSpread)
            : halfId === "bottom" ? getZoneBottomPath(zone.halfSpread)
            : getZonePath(zone.halfSpread);
        const fillPath = getZonePath(zone.halfSpread);

        let inner = `<path d="${fillPath}" fill="${bgColor}" />`;

        if (visualizationMode === "grid") {
            for (let i = 0; i < NUM_COLUMNS; i++) {
                const x = Math.round(colStartX + i * colWidth);
                const w = Math.round(colStartX + (i + 1) * colWidth) - x;
                const count = counts[`${zoneKey}-${i + 1}`] || 0;
                const color = getColorForCount(count, maxCount, dataRgb);
                const isLastColumn = i === NUM_COLUMNS - 1;
                inner += `<rect x="${x}" y="0" width="${isLastColumn ? w + SVG_WIDTH : w}" height="${SVG_HEIGHT}" fill="${color}" shape-rendering="crispEdges" />`;
            }
        } else if (visualizationMode === "dots") {
            const { center, thickness } = ZONE_RING_INFO[zoneKey];
            const innerR = center - thickness / 2;
            const outerR = center + thickness / 2;
            const bandTop = halfId === "bottom" ? APEX_Y + innerR : APEX_Y - outerR;
            const dotColor = `rgb(${dataRgb[0]}, ${dataRgb[1]}, ${dataRgb[2]})`;
            for (let i = 0; i < NUM_COLUMNS; i++) {
                const count = counts[`${zoneKey}-${i + 1}`] || 0;
                if (!count) continue;
                const cellX = colStartX + i * colWidth;
                for (const p of packDotsInCell(count, cellX, colWidth, bandTop, thickness, dotRadius)) {
                    inner += `<circle cx="${p.x}" cy="${p.y}" r="${dotRadius}" fill="${dotColor}" fill-opacity="0.85" />`;
                }
            }
        } else if (visualizationMode === "bars" && maxCount > 0) {
            const { center, thickness } = ZONE_RING_INFO[zoneKey];
            const innerR = center - thickness / 2;
            const outerR = center + thickness / 2;
            const barColor = `rgb(${dataRgb[0]}, ${dataRgb[1]}, ${dataRgb[2]})`;
            const barW = colWidth * barWidthRatio;
            const BAR_MAX_FILL = 0.92;
            for (let i = 0; i < NUM_COLUMNS; i++) {
                const count = counts[`${zoneKey}-${i + 1}`] || 0;
                if (!count) continue;
                const barHeight = thickness * BAR_MAX_FILL * Math.min(1, count / maxCount);
                const barX = colStartX + i * colWidth + (colWidth - barW) / 2;
                if (halfId === "bottom") {
                    inner += barsUniformDirection
                        ? renderBarMarkup(barX, barW, APEX_Y + outerR, barHeight, "up", barColor, count, bgColor)
                        : renderBarMarkup(barX, barW, APEX_Y + innerR, barHeight, "down", barColor, count, bgColor);
                    continue;
                }
                inner += renderBarMarkup(barX, barW, APEX_Y - innerR, barHeight, "up", barColor, count, bgColor);
                if (halfId === "top") continue;
                inner += barsUniformDirection
                    ? renderBarMarkup(barX, barW, APEX_Y + outerR, barHeight, "up", barColor, count, bgColor)
                    : renderBarMarkup(barX, barW, APEX_Y + innerR, barHeight, "down", barColor, count, bgColor);
            }
        } else if (visualizationMode === "bigzones" && bigZoneMaxSum > 0) {
            const { center, thickness } = ZONE_RING_INFO[zoneKey];
            const innerR = center - thickness / 2;
            const outerR = center + thickness / 2;
            const barColor = `rgb(${dataRgb[0]}, ${dataRgb[1]}, ${dataRgb[2]})`;
            const insetMargin = 0.15;
            const BAR_MAX_FILL = 0.92;

            const renderBigCells = (bandTopY) => {
                let cells = "";
                for (let b = 0; b < BIG_BUCKETS; b++) {
                    const { startCol, numCols } = getBigBucketRange(b);
                    const bucketX = colStartX + startCol * colWidth;
                    const bucketWidth = numCols * colWidth;
                    const insetX = bucketX + bucketWidth * insetMargin;
                    const insetWidth = bucketWidth * (1 - 2 * insetMargin);
                    const insetTop = bandTopY + thickness * insetMargin;
                    const insetHeight = thickness * (1 - 2 * insetMargin);
                    const baselineY = insetTop + insetHeight;
                    const sum = sumBigBucketCounts(counts, zoneKey, startCol, numCols);
                    const barHeight = insetHeight * BAR_MAX_FILL * Math.min(1, sum / bigZoneMaxSum);
                    const barW = insetWidth * barWidthRatio;
                    const barX = insetX + (insetWidth - barW) / 2;
                    cells += `<line x1="${insetX}" y1="${baselineY}" x2="${insetX + insetWidth}" y2="${baselineY}" stroke="${labelBoxColor}" stroke-width="1" />`;
                    if (sum > 0) cells += renderBarMarkup(barX, barW, baselineY, barHeight, "up", barColor, sum, bgColor);
                }
                return cells;
            };

            if (halfId === "bottom") {
                inner += renderBigCells(APEX_Y + innerR);
            } else {
                inner += renderBigCells(APEX_Y - outerR);
                if (halfId !== "top") inner += renderBigCells(APEX_Y + innerR);
            }
        }

        return `
            <g id="${halfId ? `layer-data-${zoneKey}-${halfId}` : `layer-data-${zoneKey}`}">
                <defs><clipPath id="${clipId}"><path d="${clipPath}" /></clipPath></defs>
                <g clip-path="url(#${clipId})">${inner}</g>
            </g>
        `;
    }

    let svg = `<svg viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">`;
    svg += `<rect width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="${bgColor}" />`;

    svg += `<g id="layer-illustration">`;
    if (illustrationUrl) {
        svg += `<image href="${illustrationUrl}" x="0" y="60" width="260" height="600" preserveAspectRatio="xMidYMid meet" />`;
    }
    svg += `</g>`;

    if (splitMode) {
        for (const zk of ZONE_ORDER) svg += renderZone(zk, countsTop, "top");
        for (const zk of ZONE_ORDER) svg += renderZone(zk, countsBottom, "bottom");
    } else {
        for (const zk of ZONE_ORDER) svg += renderZone(zk, countsTop, null);
    }

    if (visualizationMode === "heatmap") {
        svg += `<g id="layer-data-heatmap"><defs>`;
        if (splitMode) {
            svg += `<clipPath id="clip-heatmap-top"><path d="${getZoneTopPath(ZONE_CONFIG[ZONE_ORDER[0]].halfSpread)}" /></clipPath>`;
            svg += `<clipPath id="clip-heatmap-bottom"><path d="${getZoneBottomPath(ZONE_CONFIG[ZONE_ORDER[0]].halfSpread)}" /></clipPath>`;
        } else {
            svg += `<clipPath id="clip-heatmap-full"><path d="${getZonePath(ZONE_CONFIG[ZONE_ORDER[0]].halfSpread)}" /></clipPath>`;
        }
        svg += `</defs>`;
        if (splitMode) {
            if (heatmapImages.top) svg += `<g clip-path="url(#clip-heatmap-top)"><image href="${heatmapImages.top}" x="0" y="0" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" preserveAspectRatio="none" /></g>`;
            if (heatmapImages.bottom) svg += `<g clip-path="url(#clip-heatmap-bottom)"><image href="${heatmapImages.bottom}" x="0" y="0" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" preserveAspectRatio="none" /></g>`;
        } else if (heatmapImages.full) {
            svg += `<g clip-path="url(#clip-heatmap-full)"><image href="${heatmapImages.full}" x="0" y="0" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" preserveAspectRatio="none" /></g>`;
        }
        svg += `</g>`;
    }

    if (showOutlines) {
        svg += `<g id="layer-outlines">`;
        for (const zoneKey of ZONE_ORDER) {
            svg += `<path d="${getZonePath(ZONE_CONFIG[zoneKey].halfSpread)}" fill="none" stroke="${lineColor}" stroke-width="1.8" />`;
        }
        if (splitMode && showSplitLine) {
            svg += `<line x1="0" y1="${APEX_Y}" x2="${SVG_WIDTH}" y2="${APEX_Y}" stroke="${lineColor}" stroke-width="1.8" />`;
        }
        svg += `</g>`;
    }

    if (showLabels) {
        svg += buildLabelsLayer({ splitMode, topHalfLabel, bottomHalfLabel, textColor, labelBoxColor, labelTextColor, lineColor, visualizationMode, maxCount, dataRgb });
    }

    svg += `</svg>`;
    return svg;
}

function buildLabelsLayer({ splitMode, topHalfLabel, bottomHalfLabel, textColor, labelBoxColor, labelTextColor, lineColor, visualizationMode, maxCount, dataRgb }) {
    let svg = `<g id="layer-labels">`;

    if (splitMode && (topHalfLabel || bottomHalfLabel)) {
        const outerHalfSpread = ZONE_CONFIG[ZONE_ORDER[0]].halfSpread;
        const x = 75;
        const lineHeight = 22;
        const renderHalfLabel = (text, centerY) => {
            const lines = text.split("\n");
            const startY = centerY - ((lines.length - 1) * lineHeight) / 2 + 7;
            return lines.map((line, i) =>
                `<text x="${x}" y="${startY + i * lineHeight}" text-anchor="start" fill="${textColor}" font-size="20" font-weight="700" font-family="${FONT_FAMILY}">${escapeXml(line)}</text>`
            ).join("");
        };
        if (topHalfLabel) svg += renderHalfLabel(topHalfLabel, APEX_Y - outerHalfSpread / 2);
        if (bottomHalfLabel) svg += renderHalfLabel(bottomHalfLabel, APEX_Y + outerHalfSpread / 2);
    }

    for (const [key, zone] of Object.entries(ZONE_CONFIG)) {
        const labelX = CONE_END_X + 32;
        const lines = zone.label.split("\n");
        let labelY;
        if (key === "sicher") labelY = APEX_Y - 14;
        else if (key === "könnte") labelY = APEX_Y - zone.halfSpread + 42;
        else labelY = APEX_Y - zone.halfSpread + 68;
        svg += `<g><rect x="${labelX - 6}" y="${labelY - 16}" width="114" height="${lines.length * 18 + 10}" rx="3" fill="${labelBoxColor}" />`;
        lines.forEach((line, i) => {
            svg += `<text x="${labelX + 2}" y="${labelY + i * 18}" fill="${labelTextColor}" font-size="13" font-family="${FONT_FAMILY}" font-weight="600">${escapeXml(line)}</text>`;
        });
        svg += `</g>`;
    }

    for (const { label, pos } of TIME_ZONE_LABELS) {
        const x = FLATTEN_X + (CONE_END_X - FLATTEN_X) * pos;
        svg += `<text x="${x}" y="${TIME_LABEL_Y}" text-anchor="middle" fill="${textColor}" font-size="${TIME_LABEL_FONT_SIZE}" font-family="${FONT_FAMILY}">${escapeXml(label)}</text>`;
    }

    for (let i = 0; i < TIME_ZONE_LABELS.length - 1; i++) {
        const pos = (TIME_ZONE_LABELS[i].pos + TIME_ZONE_LABELS[i + 1].pos) / 2;
        const x = FLATTEN_X + (CONE_END_X - FLATTEN_X) * pos;
        const tickHalfHeight = 7;
        svg += `<line x1="${x}" y1="${TIME_LABEL_CENTER_Y - tickHalfHeight}" x2="${x}" y2="${TIME_LABEL_CENTER_Y + tickHalfHeight}" stroke="${lineColor}" stroke-width="1.5" />`;
    }

    if (visualizationMode === "grid" || visualizationMode === "heatmap") {
        svg += `<g transform="translate(30, 30)">`;
        if (maxCount <= 5) {
            for (let level = maxCount; level >= 0; level--) {
                const alpha = maxCount > 0 ? level / maxCount : 0;
                const fill = visualizationMode === "heatmap"
                    ? heatmapPaletteColor(level === 0 ? 0 : 0.35 + (level / maxCount) * 0.65)
                    : `rgba(${dataRgb[0]}, ${dataRgb[1]}, ${dataRgb[2]}, ${alpha})`;
                const ty = (maxCount - level) * 28;
                svg += `
                    <g transform="translate(0, ${ty})">
                        <text x="0" y="5" fill="${textColor}" font-size="14" font-family="${FONT_FAMILY}" font-weight="600" text-anchor="end">${level}</text>
                        <circle cx="18" cy="1" r="9" fill="${fill}" stroke="${level === 0 ? "rgba(150, 150, 150, 0.35)" : "none"}" stroke-width="2" />
                    </g>
                `;
            }
        } else {
            const barHeight = 140;
            const labels = [
                { value: maxCount, y: 2 },
                { value: Math.round(maxCount * 2 / 3), y: barHeight * (1 - Math.round(maxCount * 2 / 3) / maxCount) },
                { value: Math.round(maxCount / 3), y: barHeight * (1 - Math.round(maxCount / 3) / maxCount) },
                { value: 0, y: barHeight - 2 },
            ];
            svg += `<defs><linearGradient id="legend-gradient" x1="0" y1="0" x2="0" y2="1">`;
            if (visualizationMode === "heatmap") {
                for (const { t, r, g, b, a } of [...HEATMAP_PALETTE_STOPS].reverse()) {
                    svg += `<stop offset="${(1 - t) * 100}%" stop-color="rgba(${r},${g},${b},${a})" />`;
                }
            } else {
                svg += `<stop offset="0%" stop-color="rgba(${dataRgb[0]},${dataRgb[1]},${dataRgb[2]},1)" />`;
                svg += `<stop offset="100%" stop-color="rgba(${dataRgb[0]},${dataRgb[1]},${dataRgb[2]},0.12)" />`;
            }
            svg += `</linearGradient></defs>`;
            svg += `<rect x="9" y="0" width="18" height="${barHeight}" fill="url(#legend-gradient)" rx="9" />`;
            for (const { value, y } of labels) {
                svg += `
                    <g transform="translate(0, ${y})">
                        <text x="0" y="4" fill="${textColor}" font-size="14" font-family="${FONT_FAMILY}" font-weight="600" text-anchor="end">${value}</text>
                        ${value < maxCount && value > 0 ? `<line x1="10" y1="1" x2="27" y2="1" stroke="rgba(255,255,255,0.6)" stroke-width="1" />` : ""}
                    </g>
                `;
            }
        }
        svg += `</g>`;
    }

    svg += `</g>`;
    return svg;
}

// ==== Zustand & Filter ====

function emptyFilters() {
    return {
        szenarien: new Set(), topics: new Set(), einordnung: new Set(), geschlecht: new Set(),
        leitfrage: new Set(), alter: new Set(), personengruppe: new Set(), event: new Set(),
    };
}

const state = {
    columnStart: 0,
    columnEnd: NUM_COLUMNS,
    showOutlines: true,
    showLabels: true,
    visualizationMode: "grid",
    heatmapBlobScale: 1.15,
    dotRadius: 5,
    barWidthRatio: 0.7,
    barsUniformDirection: false,
    colorSchemeKey: "standard",
    bgColor: COLOR_SCHEMES.standard.background,
    lineColor: COLOR_SCHEMES.standard.lineColor,
    dataColor: COLOR_SCHEMES.standard.dataColor,
    textColor: COLOR_SCHEMES.standard.textColor,
    labelBoxColor: COLOR_SCHEMES.standard.labelBoxColor,
    labelTextColor: COLOR_SCHEMES.standard.labelTextColor,
    illustrationUrl: null,
    activeTab: "settings",
    splitMode: false,
    splitSubTab: "oben",
    showSplitLine: false,
    topHalfLabel: "",
    bottomHalfLabel: "",
    openDropdown: null,
    filtersA: emptyFilters(),
    filtersB: emptyFilters(),
};

function applyColorScheme(key) {
    const scheme = COLOR_SCHEMES[key];
    state.colorSchemeKey = key;
    state.bgColor = scheme.background;
    state.lineColor = scheme.lineColor;
    state.dataColor = scheme.dataColor;
    state.textColor = scheme.textColor;
    state.labelBoxColor = scheme.labelBoxColor;
    state.labelTextColor = scheme.labelTextColor;
}

function applyFilters(entries, filters) {
    return entries.filter((e) => {
        if (filters.szenarien.size > 0 && !e.szenarien.some((s) => filters.szenarien.has(s))) return false;
        if (filters.topics.size > 0 && !e.topics.some((t) => filters.topics.has(t))) return false;
        if (filters.einordnung.size > 0 && !filters.einordnung.has(e.einordnung)) return false;
        if (filters.geschlecht.size > 0 && !filters.geschlecht.has(e.geschlecht)) return false;
        if (filters.leitfrage.size > 0 && !filters.leitfrage.has(e.leitfrage)) return false;
        if (filters.alter.size > 0 && !filters.alter.has(e.alter)) return false;
        if (filters.personengruppe.size > 0 && !filters.personengruppe.has(e.personengruppe)) return false;
        if (filters.event.size > 0 && !filters.event.has(e.event)) return false;
        return true;
    });
}

function distinctValues(entries, key) {
    return [...new Set(entries.map((e) => e[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de"));
}

function distinctArrayValues(entries, key) {
    const set = new Set();
    for (const e of entries) for (const v of e[key]) set.add(v);
    return [...set].sort((a, b) => a.localeCompare(b, "de"));
}

function dataUrlToBytes(dataUrl) {
    const base64 = dataUrl.split(",")[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

// ==== Sidebar ====

function buildSettingsTabHtml() {
    const isBottom = state.splitMode && state.splitSubTab === "unten";
    const filters = isBottom ? state.filtersB : state.filtersA;
    const displayData = applyFilters(allEntries, filters);

    const dropdowns = [
        { key: "einordnung", label: "Einordnung", values: distinctValues(allEntries, "einordnung") },
        { key: "geschlecht", label: "Geschlecht", values: distinctValues(allEntries, "geschlecht") },
        { key: "leitfrage", label: "Leitfrage", values: distinctValues(allEntries, "leitfrage") },
        { key: "alter", label: "Alter", values: distinctValues(allEntries, "alter") },
        { key: "personengruppe", label: "Personengruppe", values: distinctValues(allEntries, "personengruppe") },
        { key: "event", label: "Event", values: distinctValues(allEntries, "event") },
    ];

    return `
        <div class="transcribe-category">
            <legend>Zeitausschnitt</legend>
            <div class="transcribe-field">
                <label>Spaltenstart: <span data-label-for="columnStart">${state.columnStart}</span></label>
                <input type="range" min="0" max="${NUM_COLUMNS - 1}" value="${state.columnStart}" data-field="columnStart">
            </div>
            <div class="transcribe-field">
                <label>Spaltenende: <span data-label-for="columnEnd">${state.columnEnd}</span></label>
                <input type="range" min="1" max="${NUM_COLUMNS}" value="${state.columnEnd}" data-field="columnEnd">
            </div>
        </div>

        <div class="transcribe-category">
            <legend>Anzeige</legend>
            <label class="evaluate-chart-checkbox">
                <input type="checkbox" data-field="showOutlines" ${state.showOutlines ? "checked" : ""}>
                Kegelumrisse
            </label>
            <label class="evaluate-chart-checkbox">
                <input type="checkbox" data-field="showLabels" ${state.showLabels ? "checked" : ""}>
                Beschriftungen
            </label>
        </div>

        <div class="transcribe-category">
            <legend>Farbschema</legend>
            <select data-field="colorSchemeKey">
                ${Object.entries(COLOR_SCHEMES).map(([key, scheme]) => `<option value="${key}" ${state.colorSchemeKey === key ? "selected" : ""}>${scheme.name}</option>`).join("")}
            </select>
            <div class="cone-color-grid">
                ${[
                    ["bgColor", "Hintergrund"], ["lineColor", "Linien"], ["dataColor", "Balken/Punkte"],
                    ["textColor", "Text"], ["labelBoxColor", "Label-Box"], ["labelTextColor", "Label-Text"],
                ].map(([field, label]) => `
                    <div class="cone-color-item">
                        <input type="color" value="${state[field]}" data-field="${field}">
                        <span>${label}</span>
                    </div>
                `).join("")}
            </div>
        </div>

        <div class="transcribe-category">
            <legend>Darstellung</legend>
            <div class="transcribe-choice-group">
                ${[
                    ["grid", "Raster"], ["heatmap", "Heatmap"], ["dots", "Punkte"],
                    ["bars", "Balken"], ["bigzones", "Großzonen"],
                ].map(([key, label]) => `<button type="button" class="transcribe-choice ${state.visualizationMode === key ? "is-selected" : ""}" data-mode="${key}">${label}</button>`).join("")}
            </div>
            ${state.visualizationMode === "heatmap" ? `
                <div class="transcribe-field">
                    <label>Blob-Größe: <span data-label-for="heatmapBlobScale">${state.heatmapBlobScale.toFixed(2)}</span>x</label>
                    <input type="range" min="0.5" max="2.5" step="0.05" value="${state.heatmapBlobScale}" data-field="heatmapBlobScale">
                </div>
            ` : ""}
            ${state.visualizationMode === "dots" ? `
                <div class="transcribe-field">
                    <label>Punktgröße: <span data-label-for="dotRadius">${state.dotRadius.toFixed(1)}</span>px</label>
                    <input type="range" min="2.5" max="9" step="0.5" value="${state.dotRadius}" data-field="dotRadius">
                </div>
            ` : ""}
            ${(state.visualizationMode === "bars" || state.visualizationMode === "bigzones") ? `
                <div class="transcribe-field">
                    <label>Balkenbreite: <span data-label-for="barWidthRatio">${Math.round(state.barWidthRatio * 100)}</span>%</label>
                    <input type="range" min="0.3" max="1" step="0.05" value="${state.barWidthRatio}" data-field="barWidthRatio">
                </div>
                ${state.visualizationMode === "bars" ? `
                    <label class="evaluate-chart-checkbox">
                        <input type="checkbox" data-field="barsUniformDirection" ${state.barsUniformDirection ? "checked" : ""}>
                        Untere Balken auch von unten nach oben
                    </label>
                ` : ""}
            ` : ""}
        </div>

        <div class="transcribe-category">
            <legend>Kegel teilen</legend>
            <label class="evaluate-chart-checkbox">
                <input type="checkbox" data-field="splitMode" ${state.splitMode ? "checked" : ""}>
                Kegel in zwei Hälften teilen
            </label>
            ${state.splitMode ? `
                <label class="evaluate-chart-checkbox">
                    <input type="checkbox" data-field="showSplitLine" ${state.showSplitLine ? "checked" : ""}>
                    Mittellinie anzeigen
                </label>
                <div class="transcribe-field">
                    <label>Beschriftung obere Hälfte</label>
                    <textarea rows="2" data-field="topHalfLabel" placeholder="z. B. 29 und jünger">${escapeHtml(state.topHalfLabel)}</textarea>
                </div>
                <div class="transcribe-field">
                    <label>Beschriftung untere Hälfte</label>
                    <textarea rows="2" data-field="bottomHalfLabel" placeholder="z. B. 30 und älter">${escapeHtml(state.bottomHalfLabel)}</textarea>
                </div>
                <div class="evaluate-view-toggle">
                    <button type="button" class="evaluate-view-tab ${state.splitSubTab === "oben" ? "is-active" : ""}" data-subtab="oben">Oben</button>
                    <button type="button" class="evaluate-view-tab ${state.splitSubTab === "unten" ? "is-active" : ""}" data-subtab="unten">Unten</button>
                </div>
            ` : ""}
        </div>

        <div class="transcribe-category">
            <legend>Illustration</legend>
            <input type="file" accept="image/*" id="cone-illustration-input">
            ${state.illustrationUrl ? `<button type="button" class="link-secondary" data-action="remove-illustration">Bild entfernen</button>` : ""}
        </div>

        <div class="transcribe-category">
            <legend>Szenarien${state.splitMode ? ` (${state.splitSubTab})` : ""}</legend>
            ${distinctArrayValues(allEntries, "szenarien").map((s) => `
                <label class="evaluate-chart-checkbox">
                    <input type="checkbox" data-filter-category="szenarien" data-filter-value="${escapeHtml(s)}" ${filters.szenarien.has(s) ? "checked" : ""}>
                    ${escapeHtml(s)}
                </label>
            `).join("") || `<p class="transcribe-static">Keine Szenarien vorhanden.</p>`}
        </div>

        <div class="transcribe-category">
            <legend>Topics${state.splitMode ? ` (${state.splitSubTab})` : ""}</legend>
            ${distinctArrayValues(allEntries, "topics").map((t) => `
                <label class="evaluate-chart-checkbox">
                    <input type="checkbox" data-filter-category="topics" data-filter-value="${escapeHtml(t)}" ${filters.topics.has(t) ? "checked" : ""}>
                    ${escapeHtml(t)}
                </label>
            `).join("") || `<p class="transcribe-static">Keine Topics vorhanden.</p>`}
        </div>

        ${dropdowns.map(({ key, label, values }) => `
            <div class="cone-dropdown">
                <button type="button" class="cone-dropdown-toggle" data-dropdown="${key}">${label}${filters[key].size > 0 ? ` (${filters[key].size})` : ""}</button>
                ${state.openDropdown === key ? `
                    <div class="cone-dropdown-panel">
                        ${values.map((v) => `
                            <label>
                                <input type="checkbox" data-filter-category="${key}" data-filter-value="${escapeHtml(v)}" ${filters[key].has(v) ? "checked" : ""}>
                                ${escapeHtml(v)}
                            </label>
                        `).join("") || `<p class="transcribe-static">Keine Werte vorhanden.</p>`}
                    </div>
                ` : ""}
            </div>
        `).join("")}

        <div class="cone-overview">
            <div class="cone-overview-title">Übersicht${state.splitMode ? ` (${state.splitSubTab})` : ""}</div>
            ${ZONE_ORDER.slice().reverse().map((zk) => `
                <div class="cone-overview-row">
                    <span>${escapeHtml(ZONE_CONFIG[zk].label.replace(/\n/g, " "))}</span>
                    <span>${displayData.filter((d) => d.probability === zk).length}</span>
                </div>
            `).join("")}
            <div class="cone-overview-row cone-overview-total">
                <span>Gesamt</span>
                <span>${displayData.length}</span>
            </div>
        </div>
    `;
}

function buildDataTabHtml() {
    const { counts, maxCount } = countEntries(allEntries);
    const rgb = hexToRgb(state.dataColor);
    return `
        <p class="transcribe-static">
            ${allEntries.length} von ${totalScreenshotCount} Screenshots haben sowohl PositionZeitstrahl als auch
            Wahrscheinlichkeit gesetzt und fließen in den Kegel ein.
        </p>
        <button type="button" class="link-secondary" id="cone-reload-button">Neu aus Vault laden</button>
        <div class="cone-heatmap-preview">
            <table class="cone-heatmap-table">
                <thead>
                    <tr>
                        <th></th>
                        ${Array.from({ length: NUM_COLUMNS }, (_, i) => `<th>${i + 1}</th>`).join("")}
                    </tr>
                </thead>
                <tbody>
                    ${ZONE_ORDER.slice().reverse().map((zk) => `
                        <tr>
                            <td>${zk === "sicher" ? "s" : zk === "könnte" ? "k" : "e"}</td>
                            ${Array.from({ length: NUM_COLUMNS }, (_, i) => {
                                const c = counts[`${zk}-${i + 1}`] || 0;
                                const a = c === 0 ? 0 : 0.12 + (c / Math.max(maxCount, 1)) * 0.88;
                                return `<td style="background-color: rgba(${rgb.join(",")}, ${a})">${c || ""}</td>`;
                            }).join("")}
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </div>
    `;
}

function renderSidebar() {
    sidebarContentEl.innerHTML = state.activeTab === "settings" ? buildSettingsTabHtml() : buildDataTabHtml();

    const illustrationInput = sidebarContentEl.querySelector("#cone-illustration-input");
    if (illustrationInput) {
        illustrationInput.addEventListener("change", (event) => {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => { state.illustrationUrl = ev.target.result; renderAll(); };
            reader.readAsDataURL(file);
        });
    }

    const reloadButton = sidebarContentEl.querySelector("#cone-reload-button");
    if (reloadButton) reloadButton.addEventListener("click", async () => { await reloadData(); renderAll(); });
}

function renderCanvas() {
    const filteredA = applyFilters(allEntries, state.filtersA);
    const filteredB = state.splitMode ? applyFilters(allEntries, state.filtersB) : null;
    const externalMaxCount = state.splitMode
        ? Math.max(countEntries(filteredA).maxCount, countEntries(filteredB).maxCount)
        : null;

    canvasAreaEl.innerHTML = buildConeSvg({
        dataTop: filteredA,
        dataBottom: filteredB,
        externalMaxCount,
        columnStart: state.columnStart,
        columnEnd: state.columnEnd,
        illustrationUrl: state.illustrationUrl,
        showOutlines: state.showOutlines,
        showLabels: state.showLabels,
        splitMode: state.splitMode,
        showSplitLine: state.showSplitLine,
        visualizationMode: state.visualizationMode,
        heatmapBlobScale: state.heatmapBlobScale,
        dotRadius: state.dotRadius,
        barWidthRatio: state.barWidthRatio,
        barsUniformDirection: state.barsUniformDirection,
        bgColor: state.bgColor,
        lineColor: state.lineColor,
        dataColor: state.dataColor,
        textColor: state.textColor,
        labelBoxColor: state.labelBoxColor,
        labelTextColor: state.labelTextColor,
        topHalfLabel: state.topHalfLabel,
        bottomHalfLabel: state.bottomHalfLabel,
    });

    subtitleEl.textContent = `${filteredA.length} von ${allEntries.length} Einträgen sichtbar`;
}

function renderAll() {
    renderSidebar();
    renderCanvas();
}

// ---- Event-Delegation ----
// Strukturelle Änderungen (Tab/Modus/Dropdown/Checkbox) bauen die Sidebar neu
// auf. Schieberegler, Farbwähler und Freitext-Felder dagegen NUR den Zustand
// aktualisieren und das SVG neu zeichnen — ein voller Sidebar-Rebuild würde
// das gerade bediente Element mitten in der Eingabe ersetzen (Fokus-/Drag-
// Verlust, siehe evaluate.js-Filterfelder für denselben Bug früher in der App).

sidebarContentEl.addEventListener("click", (event) => {
    const modeButton = event.target.closest("[data-mode]");
    if (modeButton) { state.visualizationMode = modeButton.dataset.mode; renderAll(); return; }

    const subtabButton = event.target.closest("[data-subtab]");
    if (subtabButton) { state.splitSubTab = subtabButton.dataset.subtab; state.openDropdown = null; renderAll(); return; }

    const dropdownButton = event.target.closest("[data-dropdown]");
    if (dropdownButton) {
        const key = dropdownButton.dataset.dropdown;
        state.openDropdown = state.openDropdown === key ? null : key;
        renderAll();
        return;
    }

    const removeIllustrationButton = event.target.closest('[data-action="remove-illustration"]');
    if (removeIllustrationButton) { state.illustrationUrl = null; renderAll(); }
});

sidebarContentEl.addEventListener("change", (event) => {
    const target = event.target;

    if (target.matches("[data-field]")) {
        // Range-/Color-Inputs werden schon live per "input"-Event behandelt (siehe
        // unten) — hier nochmal reinzugreifen würde den dort gepflegten Number-Wert
        // mit dem rohen String-value des Elements überschreiben.
        if (target.type === "range" || target.type === "color") return;
        const field = target.dataset.field;
        if (field === "colorSchemeKey") applyColorScheme(target.value);
        else if (target.type === "checkbox") state[field] = target.checked;
        else state[field] = target.value;
        renderAll();
        return;
    }

    if (target.matches("[data-filter-category]")) {
        const isBottom = state.splitMode && state.splitSubTab === "unten";
        const filters = isBottom ? state.filtersB : state.filtersA;
        const category = target.dataset.filterCategory;
        const value = target.dataset.filterValue;
        if (target.checked) filters[category].add(value);
        else filters[category].delete(value);
        renderAll();
    }
});

sidebarContentEl.addEventListener("input", (event) => {
    const target = event.target;
    if (!target.matches("[data-field]")) return;
    const field = target.dataset.field;

    if (target.type === "range") {
        state[field] = Number(target.value);
        const labelSpan = sidebarContentEl.querySelector(`[data-label-for="${field}"]`);
        if (labelSpan) {
            if (field === "barWidthRatio") labelSpan.textContent = Math.round(state[field] * 100);
            else if (field === "dotRadius") labelSpan.textContent = state[field].toFixed(1);
            else if (field === "heatmapBlobScale") labelSpan.textContent = state[field].toFixed(2);
            else labelSpan.textContent = state[field];
        }
        renderCanvas();
        return;
    }

    if (target.type === "color") {
        state[field] = target.value;
        renderCanvas();
        return;
    }

    if (target.tagName === "TEXTAREA") {
        state[field] = target.value;
        renderCanvas();
    }
});

tabSettingsButton.addEventListener("click", () => {
    state.activeTab = "settings";
    tabSettingsButton.classList.add("is-active");
    tabDataButton.classList.remove("is-active");
    renderSidebar();
});

tabDataButton.addEventListener("click", () => {
    state.activeTab = "data";
    tabDataButton.classList.add("is-active");
    tabSettingsButton.classList.remove("is-active");
    renderSidebar();
});

exportSvgButton.addEventListener("click", async () => {
    const svgEl = canvasAreaEl.querySelector("svg");
    if (!svgEl) return;
    const svgString = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svgEl);
    const filePath = await save({ defaultPath: "zukunftskegel.svg", filters: [{ name: "SVG", extensions: ["svg"] }] });
    if (!filePath) return;
    await writeTextFile(filePath, svgString);
});

exportPngButton.addEventListener("click", async () => {
    const svgEl = canvasAreaEl.querySelector("svg");
    if (!svgEl) return;
    const svgString = new XMLSerializer().serializeToString(svgEl);
    const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const canvas = document.createElement("canvas");
    canvas.width = SVG_WIDTH * 2;
    canvas.height = SVG_HEIGHT * 2;
    const ctx = canvas.getContext("2d");
    ctx.scale(2, 2);

    const dataUrl = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            ctx.fillStyle = state.bgColor;
            ctx.fillRect(0, 0, SVG_WIDTH, SVG_HEIGHT);
            ctx.drawImage(img, 0, 0, SVG_WIDTH, SVG_HEIGHT);
            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL("image/png"));
        };
        img.onerror = reject;
        img.src = url;
    });

    const filePath = await save({ defaultPath: "zukunftskegel.png", filters: [{ name: "PNG", extensions: ["png"] }] });
    if (!filePath) return;
    await writeFile(filePath, dataUrlToBytes(dataUrl));
});

// ---- Start ----
let allEntries = [];
let totalScreenshotCount = 0;

async function reloadData() {
    const { entries, total } = await loadAllEntries();
    allEntries = entries;
    totalScreenshotCount = total;
}

await reloadData();
renderAll();
