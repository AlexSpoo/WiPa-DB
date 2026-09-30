class AppHeader extends HTMLElement {
    connectedCallback() { 
        this.innerHTML = `
            <header>
                <a href="/pages/dashboard.html">←</a>
                <button type="button" aria-label="Menü öffnen" aria-expanded="false">☰</button>
                <nav class="menu-nav">
                    <a id="nav-dashboard" href="dashboard.html" class="nav-tile btn btn-primary btn-shadow-inset">Dashboard</a>
                    <a id="nav-upload" href="upload.html" class="nav-tile btn btn-primary btn-shadow-inset">Bilder Hochladen</a>
                    <a id="nav-transcribe" href="transcribe.html" class="nav-tile btn btn-primary btn-shadow-inset">Bilder digitalisieren</a>
                    <a id="nav-templates" href="templates.html" class="nav-tile btn btn-primary btn-shadow-inset">Templates verwalten</a>
                    <a id="nav-tag" href="tag.html" class="nav-tile btn btn-primary btn-shadow-inset">Daten vertaggen</a>
                    <a id="nav-evaluate" href="evaluate.html" class="nav-tile btn btn-primary btn-shadow-inset">Daten auswerten</a>
                    <a id="nav-export" href="export.html" class="nav-tile btn btn-primary btn-shadow-inset">Vault/Datenbank exportieren</a>
                </nav>
            </header>
        `; 
        const button = this.querySelector("button");
        const nav = this.querySelector(".menu-nav");
        button.addEventListener("click", () => {
            nav.classList.toggle("is-open"); 
            button.setAttribute("aria-expanded", nav.classList.contains("is-open"))
        });
    }
}

customElements.define("app-header", AppHeader);

