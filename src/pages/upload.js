import { open } from "@tauri-apps/plugin-dialog";
import { basename } from "@tauri-apps/api/path";


const filesToUpload = [];
const button = document.querySelector("#upload-files-button");

button.addEventListener("click", async () => { 
    const filesToAdd = await open({ multiple: true, filters: [{ name: "Bilder", extensions: ["png", "jpg", "jpeg"]}] });
    if (filesToAdd?.length>0) {
        filesToUpload.push(...filesToAdd);
        await renderFileGrid();
    }
    console.log(filesToAdd);
});

async function renderFileGrid() {
    const grid = document.querySelector(".file-grid");
    grid.innerHTML = "";
    for (const file of filesToUpload) {
        const name = await basename(file);
        grid.insertAdjacentHTML("beforeend", renderFileTile(name));
    }
    document.querySelector(".drag-drop-info").classList.toggle("is-horizontal", filesToUpload.length > 0);

}

function renderFileTile(name) {
    return `<div class="file-tile" title="${name}">
        <div class="file-tile-icon">📄</div> 
        <div class="file-tile-name">${name}</div>
    </div>`;
}