// El armazón: carga las tablas, pinta la vista de la ruta y guarda lo que cambia.
import { Tables } from "./engine.js";
import { T, lang, setLang } from "./i18n.js";
import { ChamberView } from "./chamber.js";
import { ReferenceView } from "./reference.js";
import { askButton, h, keepFocus, store } from "./util.js";

const main = document.getElementById("main");
const nav = document.getElementById("nav");
const langs = document.getElementById("lang");

let chamber, reference;
let askingClear = false;

function route() {
  const [, view = "chamber", sub = "search", ...rest] = (location.hash || "#/chamber").split("/");
  return { view, sub, rest };
}

function renderLog() {
  const log = chamber.log;
  const deaths = log.reduce((s, x) => s + (x.deaths || 0), 0);
  if (!log.length) return `<section class="log"><p class="empty">${h(T("logEmpty"))}</p></section>`;
  return `<section class="log">
    <p class="log-stats">${h(T("logStats")(log.length, deaths))}</p>
    <ol class="log-list">${log.map((x) => `<li class="log-entry">
      <p class="log-title"><span class="result-name">${h(x.chamber)}</span>${x.page ? ` <span class="page">${h(T("page")(x.page))}</span>` : ""}</p>
      <p class="log-rolls">${[x.condition, x.loot, x.inhabitant].filter((v) => v && v !== "—").map(h).join(" · ")}</p>
      <p class="log-outcome">${h(T("outcomes")[x.outcome] ?? x.outcome)} · ${h(T("round"))} ${x.rounds}${x.deaths ? ` · ${h(T("deaths"))} ${x.deaths}` : ""}${x.kills ? ` · ${h(T("enemiesKilled"))} ${x.kills}` : ""}</p>
      ${x.live?.length ? `<p class="log-events">${x.live.map((e) => h(e.text)).join(" · ")}</p>` : ""}
      ${x.notes ? `<p class="log-notes">${h(x.notes)}</p>` : ""}
      <p class="log-date">${h(new Date(x.at).toLocaleString(lang()))}</p>
    </li>`).join("")}</ol>
    <div class="chamber-actions">${askButton(askingClear ? "clear-log" : null, "clear-log", T("logClear"), T("confirmClear"), T("yes"), T("cancel"))}</div>
  </section>`;
}

function render() {
  const { view, sub, rest } = route();
  document.title = view === "ref" ? `${T("navRef")} · Black Stone` : view === "log" ? `${T("navLog")} · Black Stone` : T("app");
  // Por ahora la web sólo genera cámaras (decisión del 2026-11-26): el Registro y la Referencia siguen
  // en #/log y #/ref, pero no salen en el menú. Desde ellas, un enlace de vuelta a la Cámara.
  nav.innerHTML = view === "chamber" ? "" : `<a href="#/chamber">${h(T("backChamber"))}</a>`;
  // Modo Agnostic: el sistema de reglas opcional del autor. Muestra el daño de las armas y la clase de las armaduras.
  const agn = store.get("bs.agnostic", false);
  langs.innerHTML = `<button type="button" class="agnostic-toggle" data-agnostic role="switch" aria-checked="${agn}"><span class="switch" aria-hidden="true"><span></span></span>${h(T("agnostic"))}</button>`
    + ["es", "en"].map((l) => `<button type="button" data-lang="${l}" aria-pressed="${l === lang()}">${l.toUpperCase()}</button>`).join("");
  keepFocus(() => {
    main.innerHTML = view === "ref" ? reference.render(sub, rest) : view === "log" ? renderLog() : chamber.render();
  });
  document.documentElement.dataset.ready = "1";
}

async function start() {
  main.innerHTML = `<p class="empty">${h(T("loading"))}</p>`;
  try {
    const tables = await Tables.load("data/");
    chamber = new ChamberView(tables, render);
    // La referencia lee la base de datos (db/) cuando se abre por primera vez.
    reference = new ReferenceView(render);
  } catch (err) {
    console.error(err);
    main.innerHTML = `<p class="is-invalid">${h(T("loadError"))}</p>`;
    document.documentElement.dataset.ready = "1";
    return;
  }
  // Las vistas escuchan en el mismo contenedor; cada una ignora lo que no es suyo.
  chamber.bind(main, render);
  reference.bind(main, render);
  main.addEventListener("click", (ev) => {
    const a = ev.target.closest("[data-action]")?.dataset.action;
    if (a === "clear-log") { askingClear = true; render(); }
    else if (a === "ask-cancel" && askingClear) { askingClear = false; render(); }
    else if (a === "clear-log-yes") {
      askingClear = false;
      chamber.log = [];
      store.set("bs.log", []);
      render();
    }
  });
  langs.addEventListener("click", (ev) => {
    if (ev.target.closest("[data-agnostic]")) { store.set("bs.agnostic", !store.get("bs.agnostic", false)); render(); return; }
    const l = ev.target.closest("[data-lang]")?.dataset.lang;
    if (l && l !== lang()) { setLang(l); render(); }
  });
  window.addEventListener("hashchange", () => { render(); main.focus({ preventScroll: true }); window.scrollTo({ top: 0 }); });
  render();
}

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => { /* sin modo sin conexión */ });
}

start();
