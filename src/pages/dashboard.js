import { load } from "@tauri-apps/plugin-store";
import { basename } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

// Store elemente
const store = await load("settings.json", { autoSave: false });
const activeVault = await store.get("activeVault");
const vaults = await store.get("vaults");
await invoke("expand_scope", { folderPath: activeVault });

const dashboardMessage = sessionStorage.getItem("dashboardMessage");
if (dashboardMessage) {
    sessionStorage.removeItem("dashboardMessage");
    const messageBox = document.querySelector("#dashboard-message");
    messageBox.textContent = dashboardMessage;
    messageBox.classList.add("is-open");
}

// HTML elemente
const toggle = document.querySelector("#vault-switcher-toggle");
const menu = document.querySelector("#vault-switcher-menu");
const vaultList = document.querySelector('#vault-list');
const vaultAddButton = document.querySelector('#vault-add-button');
const vaultManageButton = document.querySelector('#vault-manage-button');
const vaultManageBackButton = document.querySelector('#vault-manage-back-button');
const switchView = document.querySelector('#vault-switch-view');
const manageView = document.querySelector('#vault-manage-view');
const manageList = document.querySelector('#vault-manage-list');

document.querySelector("#vault-switcher-current").textContent = await basename(activeVault);

// In eine Funktion ausgelagert, damit die Liste auch nach dem Entfernen einer
// Datenbank über "Datenbanken verwalten" aktualisiert werden kann, statt nur
// einmal beim Laden der Seite gefüllt zu werden.
async function renderSwitchList() {
    vaultList.innerHTML = "";
    const otherVaults = vaults.filter((vault) => vault !== activeVault);
    for (const vault of otherVaults) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "btn btn-primary vault-list-item";
        item.textContent = await basename(vault);
        item.addEventListener("click", async () => {
            await store.set("activeVault", vault);
            await store.save();
            await invoke("expand_scope", { folderPath: vault });
            window.location.reload();
        });
        vaultList.appendChild(item);
    }
}

await renderSwitchList();

toggle.addEventListener("click", () => {
    menu.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", menu.classList.contains("is-open"));
    switchView.classList.remove("is-hidden");
    manageView.classList.add("is-hidden");
});

vaultAddButton.addEventListener("click", async () => {
    const folder = await open({ directory: true });
    if (folder) {
        if (!vaults.includes(folder)) {
            vaults.push(folder);
            await store.set("vaults", vaults);
        }
        await store.set("activeVault", folder);
        await store.save();
        await invoke("expand_scope", { folderPath: folder });
        window.location.reload();
    }
});

async function renderManageList() {
    manageList.innerHTML = "";
    for (const vault of vaults) {
        const isActive = vault === activeVault;
        const item = document.createElement("div");
        item.className = "vault-manage-item";

        const name = document.createElement("span");
        name.className = "vault-manage-item-name";
        name.textContent = await basename(vault);
        name.title = vault;
        item.appendChild(name);

        if (isActive) {
            const activeLabel = document.createElement("span");
            activeLabel.className = "vault-manage-item-active";
            activeLabel.textContent = "(aktiv)";
            item.appendChild(activeLabel);
        } else {
            const removeButton = document.createElement("button");
            removeButton.type = "button";
            removeButton.className = "btn btn-primary";
            removeButton.textContent = "Entfernen";
            removeButton.addEventListener("click", async () => {
                const updatedVaults = vaults.filter((v) => v !== vault);
                vaults.length = 0;
                vaults.push(...updatedVaults);
                await store.set("vaults", vaults);
                await store.save();
                await renderManageList();
                await renderSwitchList();
            });
            item.appendChild(removeButton);
        }

        manageList.appendChild(item);
    }
}

vaultManageButton.addEventListener("click", async () => {
    switchView.classList.add("is-hidden");
    manageView.classList.remove("is-hidden");
    await renderManageList();
});

vaultManageBackButton.addEventListener("click", () => {
    manageView.classList.add("is-hidden");
    switchView.classList.remove("is-hidden");
});
