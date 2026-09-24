import { open } from "@tauri-apps/plugin-dialog";
import { basename } from "@tauri-apps/api/path";
import { getCurrentWebview } from "@tauri-apps/api/webview";



const filesToUpload = [];
const button = document.querySelector("#upload-files-button");
const infoText = document.querySelector("#upload-info-text");
const nextButton = document.querySelector("#upload-next-button");
const nextButtonBox = document.querySelector("#upload-next-button-box");
const dragDropBox = document.querySelector("#drag-drop-box");

getCurrentWebview().onDragDropEvent(async (event) => {
    if (event.payload.type === "over") {
        dragDropBox.classList.toggle("is-hovered", true);
    } else if (event.payload.type === "drop") {
        await addFiles(event.payload.paths);
        dragDropBox.classList.toggle("is-hovered", false);
    } else {
        dragDropBox.classList.toggle("is-hovered", false);
    }
});


button.addEventListener("click", async () => { 
    const filesToAdd = await open({ multiple: true, filters: [{ name: "Bilder", extensions: ["png", "jpg", "jpeg"]}] });
    await addFiles(filesToAdd);
});

nextButton.addEventListener("click", async () => {
    sessionStorage.setItem("filesToRename", JSON.stringify(filesToUpload));
    window.location.href = "/pages/rename.html";
});

async function renderFileGrid() {
    const grid = document.querySelector(".file-grid");
    grid.innerHTML = "";
    
    if (filesToUpload?.length > 0) {
        for (const file of filesToUpload) {
            const name = await basename(file);
            grid.insertAdjacentHTML("beforeend", renderFileTile(name));
        }
        document.querySelector(".drag-drop-info-interaction").classList.toggle("is-horizontal", filesToUpload.length > 0);
        infoText.classList.toggle("is-open", filesToUpload.length > 0);
        nextButtonBox.classList.toggle("is-open", filesToUpload.length > 0);
    }
}

function renderFileTile(name) {
    return `<div class="file-tile" title="${name}">
        <div class="file-tile-icon">📄</div> 
        <div class="file-tile-name">${name}</div>
    </div>`;
}

async function addFiles(paths) {
    if (paths?.length > 0) {
        filesToUpload.push(...paths);
        await renderFileGrid();
    }
}
