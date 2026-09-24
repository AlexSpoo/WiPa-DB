import { load } from "@tauri-apps/plugin-store";
import { basename } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";

// Store elemente
const store = await load("settings.json", { autoSave: false });
const activeVault = await store.get("activeVault");
const vaults = await store.get("vaults");

// HTML elemente
const toggle = document.querySelector("#vault-switcher-toggle");
const menu = document.querySelector("#vault-switcher-menu");
const vaultList = document.querySelector('#vault-list');
const vaultAddButton = document.querySelector('#vault-add-button');

const otherVaults = vaults.filter((vault) => vault !== activeVault);

document.querySelector("#vault-switcher-current").textContent = await basename(activeVault);

for (const vault of otherVaults) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "btn btn-primary vault-list-item";
    item.textContent = await basename(vault);
    item.addEventListener("click", async () => {
        await store.set("activeVault", vault);
        await store.save();
        window.location.reload();
    });
    vaultList.appendChild(item);
}


toggle.addEventListener("click", () => {
    menu.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", menu.classList.contains("is-open"));
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
        window.location.reload();
    }
});
