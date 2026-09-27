import { open } from "@tauri-apps/plugin-dialog";
import { load } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";


const button = document.querySelector("#connect-db-button");
const store = await load("settings.json", { autoSave: false });
const vaults = (await store.get("vaults")) ?? [];
let activeVault = await store.get("activeVault");

if (vaults.length > 0) {
    if (!activeVault) {
        activeVault =  vaults[0];
        await store.set("activeVault", activeVault);
    }
    await invoke("expand_scope", { folderPath: activeVault });
    window.location.href = "/pages/dashboard.html";
}

button.addEventListener("click", async () => {
    const folder = await open({ directory: true });
    if (folder) {
        if (!vaults.includes(folder)) {
            vaults.push(folder);
            await store.set("vaults", vaults);
        }
        await store.set("activeVault", folder);
        await store.save();
        await invoke("expand_scope", { folderPath: folder });
        window.location.href = "/pages/dashboard.html";
    }
});

