import { open } from "@tauri-apps/plugin-dialog";
import { load } from "@tauri-apps/plugin-store";


const button = document.querySelector("#connect-db-button");
const store = await load("settings.json", { autoSave: false });

if (await store.get("dbFolder")) { window.location.href = "/pages/dashboard.html"; }

button.addEventListener("click", async () => { 
    const folder = await open({ directory: true });
    if (folder) {
        await store.set("dbFolder", folder);
        await store.save();
        window.location.href = "/pages/dashboard.html";
    }
    console.log(folder);
});

