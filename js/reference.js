// La referencia: busca en la base de datos del libro (db/) y muestra sus tablas, criaturas, ítems y materiales.
// Sólo datos y página; la base la genera tools/build_db.py a partir de data/.
import * as E from "./engine.js";
import { Db, clean, rangeText } from "./db.js";
import { T } from "./i18n.js";
import { h } from "./util.js";

/** Los títulos de las tablas, por id de la base. */
const TITLES = {
  "table:a": "Table A · Chamber", "table:b": "Table B · Condition", "table:c": "Table C · Loot", "table:d": "Table D · Inhabitants",
  "table:3-1": "3.1 · Wild Magic effects", "table:3-2": "3.2 · Mistchamber", "table:3-2-spark": "3.2 · Mistchamber (spark)", "table:3-2-wall": "3.2 · Mistchamber (wall)",
  "table:3-3": "3.3 · Legendary Raiders", "table:3-4": "3.4 · School Forbiddance", "table:3-5": "3.5 · Arrival Circle Encounter", "table:3-6": "3.6 · Bonfire Encounter",
  "table:3-7": "3.7 · Decan House Encounter", "table:3-8": "3.8 · Temples of Ha'o Traps", "table:3-9": "3.9 · Hall of the Vanquished Encounter", "table:3-10": "3.10 · Trap table",
  "table:4-1": "4.1 · Trinkets", "table:4-2": "4.2 · Foraging Loot", "table:4-3": "4.3 · Common Metals", "table:4-4": "4.4 · Special Metals", "table:4-5": "4.5 · Minerals",
  "table:4-6": "4.6 · Clothing Loot", "table:4-7": "4.7 · Armor Loot", "table:4-8": "4.8 · Weapon Loot", "table:4-9": "4.9 · Gear and Tools Loot",
};
const LOOKUP = Object.keys(TITLES);
const titleOf = (t) => TITLES[t.id] ?? `Table ${t.code}`;

const FIELDS = ["ST", "Role", "S&T", "AL", "Perception", "Speed", "Armor", "Savings", "Immunities", "Resistances", "Weaknesses", "L&Y", "Chamber"];
const FILTERS = ["all", "table", "chamber", "condition", "creature", "item", "material", "rule"];
const MAX = 60;

const note = (title, text) => (text ? `<details class="roll-note"><summary>${h(title)}</summary><p>${h(text)}</p></details>` : "");
const pageOf = (p) => (p == null ? "" : `<span class="page">${h(T("page")(p))}</span>`);
const txt = (x) => (x == null ? "" : typeof x === "string" ? x : E.loc(x));
/** El enlace a una ficha; en una tabla, a la fila de esa cara. */
const href = (id, face) => `#/ref/search/${encodeURIComponent(id)}${face != null ? `/${face}` : ""}`;

export class ReferenceView {
  constructor(rerender) {
    this.rerender = rerender;
    this.db = null;
    this.failed = false;
    this.table = "table:a";
    this.number = "";
    this.query = "";      // criaturas
    this.find = "";       // buscador
    this.kind = "all";
  }

  /** La base se carga la primera vez que se abre la referencia; la cámara no la necesita. */
  ensure() {
    if (this.db || this.loading) return;
    this.loading = Db.load("db/").then((db) => { this.db = db; }, (err) => { console.error(err); this.failed = true; })
      .finally(() => this.rerender());
  }

  render(sub, rest = []) {
    const tabs = [["search", T("refSearch")], ["tables", T("refTables")], ["creatures", T("refCreatures")], ["items", T("refItems")], ["materials", T("refMaterials")]];
    if (sub === "roll") { rest = ["roll", ...rest]; sub = "search"; }
    if (!tabs.some(([k]) => k === sub)) sub = "search";
    this.ensure();
    const body = this.failed ? `<p class="is-invalid">${h(T("loadError"))}</p>`
      : !this.db ? `<p class="empty">${h(T("loading"))}</p>`
      : sub === "creatures" ? this.creatures() : sub === "items" ? this.items() : sub === "materials" ? this.materials()
      : sub === "tables" ? this.tables() : this.searchView(rest);
    return `<nav class="ref-nav" aria-label="${h(T("navRef"))}">${tabs.map(([k, v]) => `<a href="#/ref/${k}" ${k === sub ? 'aria-current="page"' : ""}>${h(v)}</a>`).join("")}</nav>
      <div class="ref-body" data-ref-view="${h(sub)}">${body}</div>
      <p class="credit">${h(T("credit"))}</p>`;
  }

  /** Una tabla del libro entera; cada resultado lleva a su ficha si la tiene. */
  fullTable(t, open = false, face = null) {
    const db = this.db;
    return `<details class="book-table" ${open ? "open" : ""}><summary>${h(titleOf(t))} ${pageOf(t.page)}</summary>
      <div class="scroll"><table class="rows"><tbody>${t.rows.map((w) => {
        const on = face != null && w.range[0] <= face && face <= w.range[1];
        const refs = (w.refs ?? []).filter((r) => db.get(r));
        const label = refs.length === 1 ? `<a href="${href(refs[0])}">${h(clean(w.label))}</a>`
          : h(clean(w.label)) + refs.map((r) => ` · <a href="${href(r)}">${h(db.get(r).name)}</a>`).join("");
        return `<tr${on ? ' class="is-hit"' : ""}><td class="rows-n">${rangeText(w.range)}</td><td>${label}</td><td class="rows-p">${h(w.page ?? "")}</td></tr>`;
      }).join("")}</tbody></table></div>
    </details>`;
  }

  // ---------------------------------------------------------------- buscador

  searchView([id, face, n]) {
    // «#/ref/roll/A/57», desde la Cámara: la ficha a la que lleva esa tirada, o la fila si lleva a varias o a ninguna.
    if (id === "roll") {
      const j = this.db.jump(`${face} ${n}`);
      if (!j) return this.detail("", null);
      const refs = (j.row.refs ?? []).filter((r) => this.db.get(r));
      return refs.length === 1 ? this.detail(refs[0], null) : this.detail(j.table.id, j.face);
    }
    if (id) return this.detail(decodeURIComponent(id), face != null && face !== "" ? +face : null);
    const db = this.db;
    const jump = db.jump(this.find);
    let list = db.search(this.find, this.kind);
    if (jump) list = []; // «A 57» es una tirada: basta su resultado.
    const shown = list.slice(0, MAX);
    const hint = this.find.trim() ? "" : `<p class="search-hint">${h(T("searchHint"))}</p>`;
    return `<input id="ref-find" class="search" data-ref="find" type="search" value="${h(this.find)}" placeholder="${h(T("searchPlaceholder"))}" aria-label="${h(T("search"))}" autocomplete="off">
      <div class="chips" role="group" aria-label="${h(T("filter"))}">${FILTERS.map((k) => `<button type="button" class="chip" data-kind="${k}" aria-pressed="${k === this.kind}">${h(T("kinds")[k])}</button>`).join("")}</div>
      ${hint}
      <div aria-live="polite">
      ${jump ? this.jumpCard(jump) : ""}
      ${shown.length ? `<ul class="hits">${shown.map((x) => this.hit(x)).join("")}</ul>` : jump ? "" : `<p class="empty">${h(T("noMatches"))}</p>`}
      ${list.length > MAX ? `<p class="empty">${h(T("more")(list.length - MAX))}</p>` : ""}
      </div>`;
  }

  /** «A 57»: el resultado de esa tirada, como en la cámara. */
  jumpCard({ table, face, row }, inTable = false) {
    const db = this.db;
    const target = (row.refs ?? []).map((r) => db.get(r)).find(Boolean);
    const extra = this.rowNote(table, face, row);
    return `<div class="jump"><p class="jump-head">${h(titleOf(table))} · ${face}</p>
      <p class="result"><span class="result-name">${target ? `<a href="${href(target.id)}">${h(clean(row.label))}</a>` : h(clean(row.label))}</span> ${pageOf(row.page ?? table.page)}</p>
      ${extra ? `<p class="jump-note">${h(extra)}</p>` : ""}
      ${inTable ? "" : `<p><a href="${href(table.id, face)}">${h(T("seeTable"))}</a></p>`}</div>`;
  }

  hit(x) {
    const db = this.db;
    const link = x.type === "row" ? href(x.parent, x.range[0]) : href(x.id);
    let sub = "";
    if (x.type === "row") sub = `${titleOf(db.get(x.parent))} · ${rangeText(x.range)}`;
    else {
      const r = db.get(x.id);
      if (r?.type === "chamber") sub = `A ${r.variants.map((v) => rangeText(v.faces)).join(", ")}`;
      else if (r?.type === "condition") sub = `B ${r.faces.map(rangeText).join(", ")}`;
      else if (r?.type === "creature") sub = r.stats?.["S&T"] ?? r.family ?? "";
      else if (r?.type === "table") sub = [r.die, T("results")(r.rows.length)].filter(Boolean).join(" · ");
      else if (r) sub = r.kind ?? r.stats?.Category?.replace(/^:\s*/, "") ?? "";
    }
    const name = x.type === "table" ? titleOf(db.get(x.id)) : x.label;
    return `<li><a class="hit" href="${link}"><span class="badge">${h(T("kind")[x.type])}</span><span class="hit-name">${h(name)}</span>${pageOf(x.page)}
      ${sub ? `<span class="hit-sub">${h(sub)}</span>` : ""}</a></li>`;
  }

  /** La nota que acompaña a una fila: el resumen de la cámara (A), el efecto (B) o la nota de la tabla. */
  rowNote(table, face, row) {
    if (table.id === "table:a") {
      const ch = this.db.get(row.refs?.[0]);
      const v = ch?.variants.find((x) => x.faces[0] <= face && face <= x.faces[1]);
      return txt(v?.note);
    }
    return [txt(row.fx?.note), txt(row.note)].filter(Boolean).join(" ");
  }

  detail(id, face) {
    const db = this.db, r = db.get(id);
    const back = `<p class="back"><a href="#/ref/search">← ${h(T("backResults"))}</a></p>`;
    if (!r) return `${back}<p class="empty">${h(T("noMatches"))}</p>`;
    const head = (name) => `${back}<article class="entry"><p class="entry-kind"><span class="badge">${h(T("kind")[r.type])}</span>${pageOf(r.page)}</p><h2 class="entry-name">${h(name)}</h2>`;
    const dl = (pairs) => {
      const ok = pairs.filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && !v.length));
      return ok.length ? `<dl class="stats">${ok.map(([k, v]) => `<dt>${h(k)}</dt><dd>${Array.isArray(v) ? `<ul>${v.map((x) => `<li>${x}</li>`).join("")}</ul>` : v}</dd>`).join("")}</dl>` : "";
    };
    const link = (rid, label) => (db.get(rid) ? `<a href="${href(rid)}">${h(label ?? db.get(rid).name ?? db.get(rid).code)}</a>` : h(label ?? rid));
    let out = "";

    if (r.type === "table") {
      out += head(titleOf(r));
      out += dl([[T("die"), h(r.die ?? "")], [T("note"), h(txt(r.note))]]);
      if (face != null) {
        const row = db.row(r, face);
        if (row) out += this.jumpCard({ table: r, face, row }, true);
      }
      out += this.fullTable(r, true, face);
      if (r.footnotes) out += `<h3>${h(T("footnotes"))}</h3>${dl(Object.entries(r.footnotes).map(([k, v]) => [k === "plain" ? "( )" : k === "ore" ? "Ore" : k, h(txt(v))]))}`;
    } else if (r.type === "chamber") {
      out += head(r.name);
      out += dl([[T("author"), h(r.author ?? "")], [T("inTable"), h((r.aliases ?? []).join(" · "))],
        [T("refCreatures"), r.creatures?.length ? r.creatures.map((c) => link(c)).join(" · ") : ""]]);
      out += r.variants.map((v) => this.variant(v, link)).join("");
    } else if (r.type === "condition") {
      out += head(r.name);
      out += dl([[T("tableB"), r.faces.map((f) => `<a href="${href("table:b", f[0])}">${rangeText(f)}</a>`).join(", ")],
        [T("effect"), h(txt(r.effect?.note))],
        [T("rolls"), (r.effect?.rolls ?? []).map((e) => this.extra(e))]]);
      const ex = db.chambers.filter((c) => c.variants.some((v) => v.excludes?.includes(r.name)));
      if (ex.length) out += `<h3>${h(T("excludedIn")(ex.length))}</h3><p class="links">${ex.map((c) => link(c.id)).join(" · ")}</p>`;
    } else if (r.type === "creature") {
      out += head(r.name);
      const s = r.stats ?? {};
      out += dl([[T("family"), h(r.family ?? "")], ...FIELDS.map((f) => [f, h(s[f] ?? "")]),
        ["Attacks", (s.Attacks ?? []).map(h)], ["Special", h((s.Special ?? []).join(" · "))]]);
    } else if (r.type === "rule") {
      out += head(r.name);
      out += dl([[T("die"), h(r.die ?? r.dice ?? "")], ["×", h(r.multiplier ?? "")], [T("formula"), h(txt(r.formula))],
        [T("table"), r.table ? link(r.table, titleOf(db.get(r.table))) : ""], [T("note"), h(txt(r.note))]]);
    } else {
      out += head(r.name);
      out += dl(Object.entries(r.stats ?? {}).map(([k, v]) => [k, h(String(v).replace(/^:\s*/, ""))]));
    }

    if (r.appears_in?.length) {
      out += `<h3>${h(T("appearsIn"))}</h3><p class="links">${r.appears_in.map((a) => a.table
        ? `<a href="${href(a.table, a.range[0])}">${h(db.get(a.table)?.code ?? a.table)} ${rangeText(a.range)}</a>` : link(a.chamber)).join(" · ")}</p>`;
    }
    return out + "</article>";
  }

  variant(v, link) {
    const skip = (v.skip ?? []).map((k) => T("roll_" + k)).join(", ");
    const excl = (v.excludes ?? []).map((n) => {
      const c = this.db.conditions.find((x) => x.name === n);
      return c ? link(c.id, n) : h(n);
    }).join(", ");
    const entries = v.entries ? (v.entries.fixed ?? v.entries.dice ?? "") : "";
    return `<section class="variant"><h3><a href="${href("table:a", v.faces[0])}">A ${rangeText(v.faces)}</a> · ${h(clean(v.label))}</h3>
      ${`<dl class="stats">${[
        [T("roll_timer"), v.timerDice ? `${v.timerDice}d10` : "—"],
        [T("roll_entries"), entries === "" ? "" : h(entries)],
        [T("excludedConditions"), excl],
        [T("skips"), skip ? h(skip) + (v.skipNote ? ` · ${h(txt(v.skipNote))}` : "") : ""],
        [T("rerollIf"), h(txt(v.reroll))],
      ].filter(([, x]) => x).map(([k, x]) => `<dt>${h(k)}</dt><dd>${x}</dd>`).join("")}</dl>`}
      ${v.extras?.length ? `<p class="variant-sub">${h(T("ownRolls"))}</p><ul class="extras">${v.extras.map((e) => `<li>${this.extra(e)}</li>`).join("")}</ul>` : ""}
      ${v.note ? `<p class="variant-note">${h(txt(v.note))}</p>` : ""}
    </section>`;
  }

  extra(e) {
    const kind = T("extraKinds")[e.kind] ?? "";
    const dice = [e.die, e.chance].filter(Boolean).map((d) => `<b>${h(d)}</b>`).join(" ");
    const t = e.table ? this.db.table(e.table) : null;
    return `${kind ? `<span class="extra-kind">${h(kind)}</span> ` : ""}${dice} ${h(txt(e.of))}${t ? ` → <a href="${href(t.id)}">${h(titleOf(t))}</a>` : ""}`;
  }

  // ---------------------------------------------------------------- tablas

  tables() {
    const db = this.db, t = db.get(this.table) ?? db.table("A");
    const die = t.die ?? "d%";
    const n = E.typedValue(this.number, die);
    const typed = String(this.number).trim() !== "";
    const row = typed && n != null ? db.row(t, n) : null;
    const bad = typed && !row;
    let out = "";
    if (row) {
      const target = (row.refs ?? []).map((r) => db.get(r)).find(Boolean);
      out = `<p class="result"><span class="result-name">${target ? `<a href="${href(target.id)}">${h(clean(row.label))}</a>` : h(clean(row.label))}</span> ${pageOf(row.page ?? t.page)}</p>${note(T("note"), this.rowNote(t, n, row))}`;
    }
    return `<div class="lookup">
        <label class="lookup-table"><span>${h(T("table"))}</span>
          <select data-ref="table">${LOOKUP.filter((x) => db.get(x)).map((x) => `<option value="${x}" ${x === t.id ? "selected" : ""}>${h(TITLES[x])}</option>`).join("")}</select></label>
        <label class="lookup-number"><span>${h(T("number"))}</span>
          <input id="ref-number" class="roll-input${bad ? " is-invalid" : ""}" data-ref="number" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off"
            value="${h(this.number)}" placeholder="${h(die)}" ${bad ? 'aria-invalid="true"' : ""}></label>
      </div>
      <div class="lookup-result" aria-live="polite">${out}</div>
      ${this.fullTable(t, false, row ? n : null)}`;
  }

  // ---------------------------------------------------------------- criaturas

  creatures() {
    const q = this.query.trim().toLowerCase();
    const all = this.db.creatures;
    const list = q ? all.filter((c) => [c.name, c.family, c.stats?.Role, c.stats?.["S&T"], c.stats?.Chamber].some((x) => x && x.toLowerCase().includes(q))) : all;
    return `<input id="ref-q" class="search" data-ref="query" type="search" value="${h(this.query)}" placeholder="${h(T("search"))}" aria-label="${h(T("search"))}" autocomplete="off">
      ${list.length ? `<ul class="creature-list">${list.map((c) => {
        const s = c.stats ?? {};
        return `<li class="creature"><details>
        <summary><span class="result-name">${h(c.name)}</span>${c.family ? ` <span class="creature-family">${h(c.family)}</span>` : ""} ${pageOf(c.page)}${s.AL ? `<span class="creature-al">AL ${h(s.AL)}</span>` : ""}</summary>
        <dl class="stats">${FIELDS.filter((f) => s[f]).map((f) => `<dt>${h(f)}</dt><dd>${h(s[f])}</dd>`).join("")}
        ${s.Attacks ? `<dt>Attacks</dt><dd><ul>${s.Attacks.map((a) => `<li>${h(a)}</li>`).join("")}</ul></dd>` : ""}
        ${s.Special ? `<dt>Special</dt><dd>${h(s.Special.join(" · "))}</dd>` : ""}</dl>
        <p class="entry-more"><a href="${href(c.id)}">${h(T("openEntry"))}</a></p>
      </details></li>`;
      }).join("")}</ul>` : `<p class="empty">${h(T("noMatches"))}</p>`}`;
  }

  // ---------------------------------------------------------------- ítems y materiales

  items() {
    const db = this.db, w = db.table("4.8");
    const magic = db.items.filter((x) => x.kind === "magic");
    const comps = db.items.filter((x) => x.kind === "component");
    return `<section class="ref-section"><h2>${h(T("weapons"))}</h2>
        <div class="scroll"><table class="rows"><thead><tr><th scope="col">${h(T("name"))}</th><th scope="col">${h(T("size"))}</th><th scope="col">${h(T("craft"))}</th></tr></thead><tbody>
        ${Object.entries(w?.weapons ?? {}).map(([name, x]) => `<tr><th scope="row">${h(name)}</th><td>${h(E.loc(x.size))}</td><td>${h(E.loc(x.craft))}</td></tr>`).join("")}
        </tbody></table></div></section>
      <section class="ref-section">${["4.8", "4.7", "4.6", "4.9", "4.1"].map((c) => db.table(c)).filter(Boolean).map((t) => this.fullTable(t)).join("")}</section>
      <section class="ref-section"><h2>${h(T("magicItems"))}</h2>
        <div class="scroll"><table class="rows"><thead><tr><th scope="col">${h(T("name"))}</th><th scope="col">${h(T("category"))}</th><th scope="col">${h(T("rarity"))}</th><th scope="col">p.</th></tr></thead><tbody>
        ${magic.map((x) => `<tr><th scope="row"><a href="${href(x.id)}">${h(x.name)}</a></th><td>${h((x.stats?.Category ?? "").replace(/^:\s*/, ""))}</td><td>${h(x.stats?.Rarity ?? "")}</td><td>${h(x.page)}</td></tr>`).join("")}
        </tbody></table></div></section>
      <section class="ref-section"><h2>${h(T("components"))}</h2>
        <div class="scroll"><table class="rows"><thead><tr><th scope="col">${h(T("name"))}</th><th scope="col">${h(T("element"))}</th><th scope="col">p.</th></tr></thead><tbody>
        ${comps.map((x) => `<tr><th scope="row"><a href="${href(x.id)}">${h(x.name)}</a></th><td>${h(x.stats?.element ?? "—")}</td><td>${h(x.page)}</td></tr>`).join("")}
        </tbody></table></div></section>`;
  }

  materials() {
    const db = this.db, mats = db.materials;
    const table = (rows) => `<div class="scroll"><table class="rows"><thead><tr><th scope="col">${h(T("name"))}</th><th scope="col">HP</th><th scope="col">${h(T("hardness"))}</th><th scope="col">${h(T("uses"))}</th><th scope="col">p.</th></tr></thead><tbody>
      ${rows.map((m) => `<tr><th scope="row"><a href="${href(m.id)}">${h(m.name)}</a></th><td>${h(m.stats?.HP ?? "")}</td><td>${h(m.stats?.Hardness ?? "")}</td><td>${h(m.stats?.Uses ?? "")}</td><td>${h(m.page)}</td></tr>`).join("")}</tbody></table></div>`;
    return `<section class="ref-section"><h2>${h(T("commonMaterials"))}</h2>${table(mats.filter((m) => m.kind === "common"))}</section>
      <section class="ref-section"><h2>${h(T("specialMaterials"))}</h2>${table(mats.filter((m) => m.kind === "special"))}</section>
      <section class="ref-section">${["4.2", "4.3", "4.4", "4.5"].map((c) => db.table(c)).filter(Boolean).map((t) => this.fullTable(t)).join("")}</section>`;
  }

  bind(root, rerender) {
    root.addEventListener("input", (ev) => {
      const el = ev.target;
      if (el.dataset.ref === "number") { this.number = el.value; rerender(); }
      else if (el.dataset.ref === "query") { this.query = el.value; rerender(); }
      else if (el.dataset.ref === "find") { this.find = el.value; rerender(); }
    });
    root.addEventListener("change", (ev) => {
      const el = ev.target;
      if (el.dataset.ref === "table") { this.table = el.value; this.number = ""; rerender(); }
    });
    root.addEventListener("click", (ev) => {
      const k = ev.target.closest("[data-kind]")?.dataset.kind;
      if (k) { this.kind = k; rerender(); }
    });
  }
}
