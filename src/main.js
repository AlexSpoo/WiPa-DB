import { open } from "@tauri-apps/plugin-dialog";
import { load } from "@tauri-apps/plugin-store";


const button = document.querySelector("#connect-db-button");
const store = await load("settings.json", { autoSave: false });


button.addEventListener("click", async () => { 
    const folder = await open({ directory: true });
    await store.set("dbFolder", folder);
    await store.save();

    console.log(folder);
});

