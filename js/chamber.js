// La cámara: las Siete Tiradas con lo que cuelga de cada una, el juego dentro y el cierre.
// El marcado lleva clases con nombre (roll-section, derived-row, dice-row…) para el diseño final.
import * as E from "./engine.js";
import { T } from "./i18n.js";
import { askButton, h, idOf, store } from "./util.js";

const EMPTY = () => ({ rolls: {}, typed: {}, buffers: {}, round: 0, locked: false, mimicHidden: true,
  live: [], liveBuffers: {}, deaths: 0, kills: {}, tab: "room", notes: "", outcome: null });

/** Las notas de las tablas C y D que sólo explican cómo leer la tabla: la app ya lo hace. */
const READING_NOTES = { C: ["*", "plain", "ore"], D: ["†"] };

/** «Arma 2 · 4.8» → «Arma»; «diez tiradas extra · 3 · C» → «diez tiradas extra». */
const groupTitle = (of) => of.replace(/\s·\s[\w.]+$/, "").replace(/(\s·\s|\s)\d+$/, "");
const REPEATED = /^(.*)\.(item|w)(\d+)$/;
const NOT_AMOUNTS = /^(Magical Infection|none|ninguno)$/i;
const DM_BOX = () => `<span class="dm-box" title="${h(T("dmCall"))}" aria-label="${h(T("dmCall"))}">DM</span>`;
const svg = (d) => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: svg('<path d="M2 12s3.6-7 10-7c2 0 3.8.7 5.2 1.7M22 12s-3.6 7-10 7c-2 0-3.8-.7-5.2-1.7"/><path d="M3 3l18 18"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
};
/** Etiquetas del libro en corto: sin «(p. 101 dice…)», sin la tabla («— Tabla 4.5», «· 4.3»: basta la página), «; requiere explorar el nido» fuera
    (ya lo dice el título del grupo), y «diez tiradas extra de botín de cámara» → «+10 de botín». */
const short = (x) => String(x ?? "")
  .replace(/^(ten extra Chamber loot rolls|diez tiradas extra de botín de cámara)$/i, (m) => (/^ten/i.test(m) ? "+10 loot rolls" : "+10 de botín"))
  .replace(/\s*\((?:p\.|pp\.)[^)]*\)/g, "").replace(/\s*\([^)]*p\. \d+[^)]*\)/g, "")
  .replace(/\s*[—–]\s*(?:Table|Tabla)\s+[\w.]+(?:,\s*p\.\s*\d+)?/g, "")
  .replace(/\s·\s(?:(?:Table|Tabla)\s+)?(?:\d+(?:\.\w+)+|[A-D])(?=\s·|$)/g, "")
  .replace(/;\s*(?:requires exploring the nest|requiere explorar el nido)$/i, "")
  .replace(/^(?:rolls on|tiradas en la)\s+(?:Table|Tabla)\s+/i, (m) => (/^rolls/i.test(m) ? "Table " : "Tabla "))
  .trim();
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];
const r0 = (d) => d.rolls.chamber != null;

export class ChamberView {
  constructor(tables, onLogChange) {
    this.t = tables;
    this.onLogChange = onLogChange;
    this.d = { ...EMPTY(), ...store.get("bs.draft", {}) };
    this.log = store.get("bs.log", []);
    this.mimics = store.get("bs.mimics", false);
  }

  save() { store.set("bs.draft", this.d); }

  // ---------------------------------------------------------------- cambios

  /** Una de las siete. Cambiar la cámara vacía todo lo demás (p. 84). */
  setRoll(id, raw) {
    const d = this.d;
    d.buffers[id] = raw;
    const der = E.derive(d.rolls, this.t);
    const n = E.typedValue(raw, id === "entries" ? der.entryDie : E.rollDef(id).die);
    const [a, b] = E.rangeOf(id, der);
    const before = d.rolls;
    let after;
    if (n == null || n < a || n > b) {
      after = id === "chamber" ? {} : { ...before };
      delete after[id];
    } else after = E.typeRoll(before, id, n);
    if (id === "chamber" && after.chamber !== before.chamber) { d.buffers = { chamber: raw }; d.typed = {}; }
    else d.typed = E.keep(d.typed, before, after);
    d.rolls = after;
    this.save();
  }

  /** Una tirada derivada. Lo que colgaba de ella se borra: dependía de este valor. */
  setChild(key, raw) {
    const d = this.d;
    const c = this.children().find((x) => x.key === key);
    if (!c) return;
    d.buffers[key] = raw;
    const n = E.typedValue(raw, c.formula.die);
    for (const k of Object.keys(d.typed)) {
      if (k.startsWith(key + ".") && k !== `${key}.chance`) { delete d.typed[k]; delete d.buffers[k]; }
    }
    if (n != null && E.answerValid(c, n, this.t)) d.typed[key] = n;
    else delete d.typed[key];
    this.save();
  }

  setChoice(key, value) {
    this.d.typed[key] = value;
    if (key === E.DOUBLE_MODE && value === 2) this.drop("condition.double.encounter");
    if (key === E.TORCHER_TRIGGER && value === 0) this.drop("condition.torcher.encounter");
    if (key === E.LEGENDARY_MODE && value === 2) this.drop("condition.fx.0");
    this.save();
  }

  drop(prefix) {
    for (const map of [this.d.typed, this.d.buffers]) {
      for (const k of Object.keys(map)) if (k === prefix || k.startsWith(prefix + ".")) delete map[k];
    }
  }

  children() { return E.children(this.d.rolls, E.derive(this.d.rolls, this.t), this.t, this.d.typed); }

  reset() { this.d = EMPTY(); this.save(); }

  /** Entra si ya está todo; si no, lleva el foco a lo primero que falta. */
  enter(root) {
    if (E.blockers(this.d.rolls, this.d.typed, this.t).ready) {
      this.d.locked = true;
      this.d.round = 0;
      this.d.tab = "room";
      this.save();
      return true;
    }
    const missing = root.querySelector(".roll-input:not(:disabled)[value=''], [aria-invalid='true'], .is-needed input");
    missing?.focus();
    missing?.scrollIntoView({ block: "center", behavior: "smooth" });
    return false;
  }

  recordLive(key) {
    const item = E.live(this.d.rolls, E.derive(this.d.rolls, this.t)).find((x) => x.key === key);
    if (!item) return;
    const b = this.d.liveBuffers[key] ?? {};
    const die = E.formulaOf(item.extra.die ?? "")?.die ?? "d%";
    const r = E.resolveLive(item, { chance: E.typedValue(b.chance, "d%"), total: E.typedValue(b.total, die) }, this.t);
    if (!r) return;
    this.d.live.push({ key, round: this.d.round, label: E.loc(item.extra.of), ...r });
    this.d.liveBuffers[key] = {};
    this.save();
  }

  close(form) {
    const d = this.d, t = this.t, r = d.rolls, der = E.derive(r, t);
    const name = (roll, table) => (r[roll] != null && !E.skipped(roll, r, t) ? t.name(table, r[roll]) : "—");
    this.log.unshift({
      at: Date.now(),
      chamber: r.chamber != null ? t.chamberName(r.chamber) : "?",
      page: r.chamber != null ? t.page("A", r.chamber) : null,
      condition: der.conditionExcluded ? "—" : name("condition", "B"),
      loot: name("loot", "C"), inhabitant: name("inhabitant", "D"),
      entries: der.entries, timer: der.timer, sealed: der.sealed, open: der.open,
      rounds: d.round, outcome: form.outcome, deaths: d.deaths, kills: Object.values(d.kills ?? {}).reduce((a, n) => a + n, 0),
      notes: (form.notes || "").trim(), rolls: r, typed: d.typed, live: d.live,
    });
    store.set("bs.log", this.log);
    this.reset();
    this.onLogChange?.();
  }

  // ---------------------------------------------------------------- pintar

  render() {
    const d = this.d, der = E.derive(d.rolls, this.t);
    const kids = this.children();
    this.fresh = new Set();
    const ids = E.ROLLS.map((x) => x.id).filter((id) => id !== "mimic" || this.mimics);
    const poster = this.poster(der);
    const sections = ids.map((id, i) => this.section(id, i + 1, der, kids)).join("");
    const ladder = this.ladder(ids, der);
    this.seen = this.fresh;
    const side = (extra = "") => `<aside class="chamber-side">${poster}${ladder}${extra}</aside>`;
    if (d.locked) {
      return `<div class="chamber" data-state="playing">
        ${side()}
        <div class="chamber-body">${this.playing(der, sections, ids)}</div>
      </div>`;
    }
    const enter = `<button type="button" class="primary" data-action="enter">${h(T("enter"))}</button>`;
    return `<div class="chamber" data-state="setup">
      ${side(r0(d) ? `<div class="side-actions">${enter}</div>` : "")}
      <div class="chamber-body">
        ${r0(d) ? `<p class="req-legend"><span class="req-mark" aria-hidden="true"></span>${h(T("requiredLegend"))}</p>` : ""}
        ${sections}
        <div class="chamber-actions">
          ${enter}
          ${Object.keys(d.rolls).length ? askButton(this.asking, "new", T("newChamber"), T("confirmNew"), T("yes"), T("cancel")) : ""}
        </div>
      </div>
    </div>`;
  }

  /** Las siete en una escalera: dónde vas, qué salió, y un salto a cada una. */
  ladder(ids, der) {
    const d = this.d, r = d.rolls, t = this.t;
    const next = d.locked ? null : r.chamber == null ? "chamber" : E.pending(r, t)[0];
    const items = ids.map((id, i) => {
      const skip = r.chamber != null && E.skipped(id, r, t);
      const fixed = skip && id === "entries" && der.entryChange === "fixed";
      const state = id === next ? "is-current" : skip && !fixed ? "is-skipped" : r[id] != null || fixed ? "is-done" : "";
      const stamp = r[id] != null ? this.isNew(`fill:${id}:${r[id]}`).replace("is-new", "is-stamped") : "";
      return `<li class="ladder-item ${state}${stamp}${id === "mimic" ? " is-mimic" : ""}">
        <label class="ladder-label" for="${idOf(`roll.${id}`)}"><span class="ladder-n">${ROMAN[i]}</span><span class="ladder-name">${h(T(`roll_${id}`))}</span></label>
        ${this.rollBox(id, der, skip, fixed)}
      </li>`;
    }).join("");
    // Mímicos (p. 85) es opcional: arriba, un botón que se vuelve la tirada VII al pulsarlo.
    const add = !d.locked && !this.mimics ? `<li class="ladder-item ladder-add"><button type="button" data-action="mimics-on">
        <span class="ladder-n">VII</span><span class="ladder-name">${h(T("useMimics"))}</span><span class="page">${h(T("page")(85))}</span></button></li>` : "";
    return `<section class="ladder" aria-label="${h(T("theRolls"))}"><h2 class="ladder-title">${h(T("theRolls"))}</h2><ol>${items}${add}</ol></section>`;
  }

  /** « is-new» la primera vez que se pinta algo: así entra con animación y lo de antes se queda quieto. */
  isNew(key) {
    this.fresh?.add(key);
    return this.seen && !this.seen.has(key) ? " is-new" : "";
  }

  /** La cabecera tipo cartel: número y nombre de la cámara, y en una línea lo que ya se sabe de ella. */
  poster(der) {
    const t = this.t, r = this.d.rolls;
    if (r.chamber == null) return `<header class="poster is-empty"><p class="poster-name">${h(T("posterEmpty"))}</p><p class="poster-hint">${h(T("posterHint"))}</p></header>`;
    const facts = [];
    const cond = r.condition != null ? t.name("B", der.rule?.fixedCondition ?? r.condition) : null;
    if (!E.skipped("condition", r, t) && !der.conditionExcluded && cond && !/^no condition$/i.test(cond)) facts.push(["condition", cond]);
    if (der.entries != null && (r.entries != null || der.entryChange === "fixed")) facts.push(["entries", der.entries]);
    if (der.sealed) facts.push(["timer", T("sealed")]);
    else if (der.open) facts.push(["timer", T("noCountdown")]);
    else if (der.timer != null) facts.push(["timer", T("rounds")(der.timer)]);
    if (!E.skipped("loot", r, t) && r.loot != null) facts.push(["loot", t.name("C", r.loot)]);
    if (!E.skipped("inhabitant", r, t) && r.inhabitant != null) facts.push(["inhabitant", t.name("D", r.inhabitant)]);
    return `<header class="poster${this.isNew("poster:" + r.chamber)}">
      <p class="poster-n">${h(String(r.chamber).padStart(2, "0"))}</p>
      <h1 class="poster-name">${h(t.chamberName(r.chamber))} <span class="page">${h(T("page")(t.page("A", r.chamber)))}</span></h1>
      ${facts.length ? `<dl class="poster-facts">${facts.map(([k, v]) => `<div class="fact${this.isNew(`fact:${k}:${v}`)}"><dt>${h(T(`roll_${k}`))}</dt><dd>${h(v)}</dd></div>`).join("")}</dl>` : ""}
    </header>`;
  }

  /** Una de las siete, con su resultado y lo que cuelga de ella. */
  section(id, n, der, kids) {
    const d = this.d, t = this.t, r = d.rolls;
    const skip = r.chamber != null && E.skipped(id, r, t);
    const fixed = skip && id === "entries" && der.entryChange === "fixed";
    const page = { last: this.mainPage(id, der) };
    const all = kids.filter((c) => this.sectionOf(c) === id && !c.extraction);
    // El temporizador va en una sola línea: «4 rondas · abierta 1d6+1 [5] = 6».
    const win = id === "timer" && !der.sealed && !der.open ? all.find((c) => c.kind === "window") : null;
    const own = all.filter((c) => c !== win);
    const fixedLines = this.fixedLinesOf(id, der, skip);
    const lootDm = id === "loot" && r.loot != null && !skip && !own.some((c) => c.from === "loot") && !NOT_AMOUNTS.test(t.name("C", r.loot));
    const body = skip && !fixed ? "" : win ? this.timerLine(der, win) : this.result(id, der);
    const derived = own.length || fixedLines.length ? this.derivedList(own, fixedLines, page) : "";
    const current = !d.locked && (r.chamber == null ? id === "chamber" : E.pending(r, t)[0] === id);
    const waiting = r[id] == null && !fixed && !skip;
    // Sin condición no hay nada que leer abajo: la lista de arriba ya dice el número y la carta lo nombra.
    const quiet = (id === "mimic" && d.mimicHidden) || id === "condition" && r.condition != null && !der.conditionExcluded && /^no condition$/i.test(t.name("B", der.rule?.fixedCondition ?? r.condition)) && !own.length;
    const unfold = r[id] != null ? this.isNew(`sec:${id}:${r[id]}`).replace("is-new", "is-unfolding") : "";
    return `<section class="roll-section${skip && !fixed ? " is-skipped" : ""}${current ? " is-current" : ""}${waiting ? " is-waiting" : ""}${quiet ? " is-quiet" : ""}${unfold}" data-section="${id}">
      ${this.head(id, n, der, skip, fixed)}
      ${body ? `<div class="roll-result${lootDm ? " has-dm" : ""}">${body}${lootDm ? DM_BOX() : ""}</div>` : ""}
      ${id === "condition" ? this.choices(der) : ""}
      ${derived}
    </section>`;
  }

  /** Lo que una tirada trae sin dado. Lo que no trae dado lleva la ficha «DM»: la cantidad la decide el Máster. */
  fixedLinesOf(id, der, skip) {
    const d = this.d, t = this.t, r = d.rolls;
    const fixedLines = r.chamber != null ? E.fixedExtras(der.rule).filter((e) => e.section === id) : [];
    // Mímicos: con menos de 50 hay un Common Mimic; dónde y cómo aparece es cosa suya (p. 85).
    if (id === "mimic" && r.mimic != null && !d.mimicHidden && E.mimicKind(r.mimic) !== "none") fixedLines.unshift({ kind: "dm", of: "Common Mimic", page: 296 });
    // Habitantes sin dado («Evil Whisperer plus 1d4+2 Ghouls», «Vampire»): una fila con su página y «1».
    if (id === "inhabitant" && r.inhabitant != null && !skip) {
      t.name("D", r.inhabitant).split(/\s+(?:plus|and|&)\s+|\s*\+\s*/i).map((x) => x.trim()).map((x) => x.replace(/^1\s+/, "")).filter((x) => x && !/\d/.test(x))
        .forEach((x) => fixedLines.unshift({ kind: "one", of: x.replace(/\)$/, "").replace(/\s*\([^)]*$/, (m) => m + ")") }));
    }
    return fixedLines;
  }

  sectionOf(c) {
    if (c.section) return c.section;
    if (c.kind === "window") return "timer";
    return c.from ?? "chamber";
  }

  mainPage(id, der) {
    const t = this.t, r = this.d.rolls;
    if (id === "chamber") return r.chamber != null ? t.page("A", r.chamber) : null;
    if (id === "condition") return r.condition != null ? t.page("B", r.condition) : null;
    if (id === "loot") return r.loot != null ? t.page("C", r.loot) : null;
    if (id === "inhabitant") return r.inhabitant != null ? t.page("D", r.inhabitant) : null;
    if (id === "timer") return 84;
    if (id === "mimic") return 85;
    return null;
  }

  /** La cabeza de cada tirada abajo: sello con su numeral, nombre y lo que salió. Las casillas viven arriba. */
  head(id, n, der, skip, fixed) {
    const d = this.d, r = d.rolls;
    const v = fixed ? der.entries : skip ? "—" : id === "mimic" && this.d.mimicHidden && r[id] != null ? "•" : r[id];
    return `<div class="roll-head"><h2 class="roll-label"><span class="roll-n">${ROMAN[n - 1]}</span> <span class="roll-name">${h(T(`roll_${id}`))}</span></h2>${d.locked && v != null ? `<span class="roll-value">${h(v)}</span>` : ""}</div>`;
  }

  /** La casilla de una de las siete, para la lista de arriba. */
  rollBox(id, der, skip, fixed) {
    const d = this.d, r = d.rolls;
    const input = idOf(`roll.${id}`);
    if (fixed) return `<span class="roll-value">${h(der.entries)}</span>`;
    if (skip) return `<span class="roll-value">—</span>`;
    const die = id === "entries" ? der.entryDie : id === "timer" ? `${der.timerDice}d10` : E.rollDef(id).die;
    const raw = d.buffers[id] ?? (r[id] != null ? String(r[id]) : "");
    const hidden = id === "mimic" && d.mimicHidden;
    if (d.locked) return `<span class="roll-value">${hidden && r[id] != null ? "•" : h(r[id] ?? "—")}</span>`;
    const [a, b] = E.rangeOf(id, der);
    const v = E.typedValue(raw, die);
    const bad = String(raw).trim() !== "" && (v == null || v < a || v > b);
    const waiting = id !== "chamber" && r.chamber == null;
    return `<input id="${input}" class="roll-input${bad ? " is-invalid" : ""}" data-roll="${id}" type="${hidden ? "password" : "text"}"
        inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${h(raw)}" placeholder="${h(die)}"
        ${waiting ? "disabled" : ""} ${bad ? 'aria-invalid="true"' : ""} aria-describedby="${input}-die">
      ${id === "mimic" ? `<button type="button" class="icon-btn" data-action="mimic-toggle" aria-pressed="${!hidden}" aria-label="${h(hidden ? T("show") : T("hide"))}" title="${h(hidden ? T("show") : T("hide"))}">${hidden ? ICON.eyeOff : ICON.eye}</button><button type="button" class="icon-btn" data-action="mimics-off" aria-label="${h(T("dropMimics"))}" title="${h(T("dropMimics"))}">${ICON.close}</button>`
        : `<span id="${input}-die" class="roll-die${bad ? " is-invalid" : ""}">${h(bad ? `${a}–${b}` : die)}</span>`}`;
  }

  /** El nombre del resultado con su página, y la nota plegada. */
  result(id, der) {
    const t = this.t, r = this.d.rolls, n = r[id];
    if (n == null) return "";
    if (id === "mimic" && this.d.mimicHidden) return `<p class="result is-hidden">${h(T("hidden"))}</p>`;
    // Con `ref` (tabla, número) el nombre lleva a su ficha en la Referencia.
    const line = (name, page, cls = "") => `<p class="result${cls}${this.isNew(`r:${id}:${n}:${name}`)}"><span class="result-name">${h(name)}</span>${page ? ` <span class="page">${h(T("page")(page))}</span>` : ""}</p>`;
    const note = (title, ...texts) => {
      const body = texts.filter(Boolean).map((x) => `<p>${h(x)}</p>`).join("");
      return body ? `<details class="roll-note"><summary>${h(title)}</summary>${body}</details>` : "";
    };
    switch (id) {
      case "chamber":
        return line(t.chamberName(n), t.page("A", n)) + note(T("chamberRules"), E.loc(der.rule?.note));
      case "condition": {
        if (der.conditionExcluded) {
          return line(t.name("B", n), null, " is-invalid") + `<p class="result-hint">${h(der.rule?.reroll ? E.loc(der.rule.reroll) : T("excluded"))}</p>`;
        }
        const c = der.rule?.fixedCondition ?? n;
        return line(t.name("B", c), t.page("B", c)) + note(T("effect"), E.loc(der.fx?.note));
      }
      case "entries":
        return der.entryChange === "raised" ? `<p class="result"><span class="result-name">${h(der.entries)}</span> <span class="result-hint">${h(T("raised"))}</span></p>` : "";
      case "timer": {
        if (der.sealed) return line(T("sealed"));
        if (der.open) return line(T("noCountdown"));
        const ops = der.steps.slice(1).map((s) => ({ extended: "×2", reduced: "÷2", "one-entry": T("oneEntry") })[s.kind]).filter(Boolean);
        const jam = der.steps.some((s) => s.kind === "jammed");
        return `<p class="result"><span class="result-name">${h(T("rounds")(der.timer))}</span>${ops.length ? ` <span class="result-hint">${h(der.steps[0].value)} ${h(ops.join(" "))}</span>` : ""}</p>${jam ? `<p class="result-hint">${h(T("jammed"))}</p>` : ""}`;
      }
      case "loot":
      case "inhabitant": {
        const tb = id === "loot" ? "C" : "D";
        const raw = t.entry(tb, n).result;
        const mark = /^\*+|[†ª]+$/.exec(raw)?.[0] ?? (raw.includes("(") ? "plain" : null);
        const foot = mark && !(READING_NOTES[tb] ?? []).includes(mark) && !(tb === "C" && mark === "*") ? t.footnote(tb, n) : null;
        // En Habitantes no van descripciones: cada criatura lleva su página del bestiario (petición de Giovani).
        if (tb === "D") return line(t.name(tb, n), t.page(tb, n));
        return line(t.name(tb, n), t.page(tb, n)) + note(T("note"), E.loc(t.noteOf(tb, n)), E.loc(foot));
      }
      case "mimic":
        return E.mimicKind(n) === "none" ? `<p class="result-hint">${h(T("mimic").none)}</p>` : "";
    }
    return "";
  }

  timerLine(der, c) {
    const d = this.d, v = d.typed[c.key];
    const raw = d.buffers[c.key] ?? "";
    const bad = String(raw).trim() !== "" && v == null;
    const ops = der.steps.slice(1).map((s) => ({ extended: "×2", reduced: "÷2", "one-entry": T("oneEntry") })[s.kind]).filter(Boolean);
    const jam = der.steps.some((s) => s.kind === "jammed");
    return `<div class="timer-line${this.isNew(`r:timer:${der.timer}`)}">
      <p class="timer-total"><span class="timer-n">${h(der.timer)}</span> <span class="timer-unit">${h(T("roundsWord"))}</span>${ops.length ? ` <span class="result-hint">${h(der.steps[0].value)} ${h(ops.join(" "))}</span>` : ""}</p>
      <span class="timer-sep" aria-hidden="true"></span>
      <p class="timer-window${c.required ? " is-required" : ""}${c.required && v == null ? " is-needed" : ""}">
        <label class="derived-label" for="${idOf(c.key)}">${h(T("window"))}</label>
        <span class="derived-die">${h(bad ? `${c.formula.min}–${c.formula.max}` : c.formula.label)}</span>
        ${this.input(c)}
        ${v != null ? `<span class="derived-total">= ${h(c.formula.total(v))}</span>` : ""}
      </p>
    </div>${jam ? `<p class="result-hint">${h(T("jammed"))}</p>` : ""}`;
  }

  choices(der) {
    const d = this.d, r = d.rolls, c = r.condition;
    if (c == null || der.conditionExcluded || E.skipped("condition", r, this.t)) return "";
    const radio = (key, name, value, label, checked, disabled) => `<label class="choice-option"><input type="radio" name="${name}" data-choice="${key}" value="${value}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}> ${h(label)}</label>`;
    if (c >= 37 && c <= 41) {
      const v = d.typed[E.DOUBLE_MODE];
      return `<fieldset class="choice${v == null ? " is-needed" : ""}"><legend>${h(T("doubleTitle"))}</legend>${radio(E.DOUBLE_MODE, "double", 1, T("doubleTwo"), v === 1, d.locked)}${radio(E.DOUBLE_MODE, "double", 2, T("doubleTimes"), v === 2, d.locked)}</fieldset>`;
    }
    if (c >= 65 && c <= 69 && !d.locked) {
      const v = d.typed[E.LEGENDARY_MODE] ?? 1;
      return `<fieldset class="choice"><legend>${h(T("legendaryTitle"))}</legend>${radio(E.LEGENDARY_MODE, "legendary", 1, T("legendaryTable"), v !== 2)}${radio(E.LEGENDARY_MODE, "legendary", 2, T("legendaryMM"), v === 2)}</fieldset>`;
    }
    if (E.schoolExcluded(r, d.typed)) return `<p class="result-hint is-invalid">${h(T("schoolExcluded"))}</p>`;
    return "";
  }

  /** Lo que cuelga de una tirada, como árbol: cada derivada va debajo de la tirada que la pidió
   *  (la clave de la hija empieza por la de la madre). Las repetidas van en una fila de casillas,
   *  y lo que cuelga de cada casilla, debajo con su número. El Arma Definitiva, junta al final. */
  derivedList(own, fixedLines, page) {
    const keys = new Set(own.map((c) => c.key));
    const parentOf = new Map();
    for (const c of own) {
      // «X.chance» es la puerta de «X»: «X» cuelga de ella, no al revés.
      if (keys.has(`${c.key}.chance`)) { parentOf.set(c.key, `${c.key}.chance`); continue; }
      const self = c.key.replace(/\.chance$/, "");
      let p = null;
      for (const k of keys) if (k !== self && self.startsWith(k + ".") && (!p || k.length > p.length)) p = k;
      parentOf.set(c.key, p);
    }
    const kidsOf = (key) => own.filter((c) => parentOf.get(c.key) === key);
    const ultimate = own.filter((c) => c.group === "ultimate");
    const isDm = (e) => e.kind === "dm" || (["loot", "exclusiveLoot"].includes(e.kind) && !NOT_AMOUNTS.test(E.loc(e.of)));
    const rows = fixedLines.filter((e) => e.kind === "one").reverse().map((e) => this.oneRow(e));
    rows.push(...fixedLines.filter(isDm).map((e) => this.dmRow(e, page)));
    // Primero lo seguro (lo que está sin tirar), luego lo que hace falta para entrar y al final lo opcional.
    const top = kidsOf(null).filter((c) => c.group !== "ultimate");
    rows.push(...this.nodes([...top.filter((c) => c.required), ...top.filter((c) => !c.required)], kidsOf, page));
    if (ultimate.length || fixedLines.some((e) => e.kind === "ultimate")) rows.push(this.ultimateGroup(ultimate, fixedLines.filter((e) => e.kind === "ultimate")));
    fixedLines.filter((e) => e.kind !== "ultimate" && e.kind !== "one" && !isDm(e)).forEach((e) => rows.push(`<p class="fixed-line">${h(E.loc(e.of))}</p>`));
    return `<div class="derived">${rows.join("")}</div>`;
  }

  /** Una fila sin dado: el nombre y la ficha «DM», porque la cantidad la decide el Máster. */
  dmRow(e, page) {
    const raw = typeof e.of === "string" ? e.of : E.loc(e.of);
    const label = raw.charAt(0).toUpperCase() + raw.slice(1);
    const sure = ["loot", "exclusiveLoot", "ultimate"].includes(e.kind);
    return `<div class="derived-row dm-row${sure ? " is-sure" : ""}${this.isNew("dm:" + label)}"${sure ? ` title="${h(T("sure"))}"` : ""}>
      <p class="derived-label">${h(label)}${e.page ? this.page(e.page, page) : ""}</p>${DM_BOX()}</div>`;
  }

  /** Un habitante que viene solo: su nombre, su página del bestiario y una ficha fija «1». */
  oneRow(e) {
    const p = this.creaturePage(e.of);
    return `<div class="derived-row dm-row${this.isNew("one:" + e.of)}">
      <p class="derived-label">${h(e.of)}${p ? ` <span class="page">${h(T("page")(p))}</span>` : ""}</p><span class="derived-value">1</span></div>`;
  }

  /** La criatura del bestiario que nombra un texto de la cámara, por palabras enteras: «Hydras en la cámara» → Hydra. */
  beastIn(text) {
    const norm = (x) => ` ${String(x).toLowerCase().replace(/\([^)]*\)?/g, " ").replace(/[^a-z ]/g, " ").replace(/s\b/g, "").replace(/\s+/g, " ").trim()} `;
    const raw = typeof text === "string" ? text : E.loc(text);
    // Sólo cuando la criatura abre el texto y es una cuenta de ellas («Raiders it can hold» es un aforo, no enemigos).
    if (/\b(?:hold|capacity|caben|aforo|encounter|encuentro)\b/i.test(raw)) return null;
    const words = norm(raw);
    let best = null;
    for (const x of this.t.bestiary ?? []) {
      const k = norm(x.name);
      if (k.trim().length > 2 && words.startsWith(k) && (!best || k.length > norm(best.name).length)) best = x;
    }
    return best;
  }

  /** La página del bestiario de una criatura: «Ghouls» → Ghouls, «Rookie Hitmen» → Rookie Hitman, «Stone Golem)» → Stone Golem. */
  creaturePage(name, twinned = false) {
    const items = this.t.bestiary ?? [];
    const norm = (x) => x.toLowerCase().replace(/\([^)]*\)?/g, " ").replace(/[^a-z ]/g, " ").replace(/\bmen\b|men\b/g, "man").replace(/s\b/g, "").replace(/\s+/g, " ").trim();
    const key = norm(name);
    if (!key) return null;
    const exact = items.find((x) => norm(x.name) === key);
    if (exact) return exact.page;
    let best = null;
    for (const x of items) {
      const k = norm(x.name);
      if (k && (key.includes(k) || k.includes(key)) && (!best || k.length > norm(best.name).length)) best = x;
    }
    if (best) return best.page;
    // «Black Pawn», «Dark Stalker (Black Horse)»: la ficha se llama por su pieza de ajedrez, entre paréntesis.
    const paren = (x) => norm((/\(([^)]*)\)?/.exec(x) ?? [])[1] ?? "");
    const piece = paren(name) || key;
    const byPiece = items.find((x) => paren(x.name) && paren(x.name) === piece);
    if (byPiece) return byPiece.page;
    // «The Red Queen» comparte ficha con «The Red King».
    const twin = key.replace(/queen/, "king").replace(/\bking\b(?!.*queen)/, (m) => (key.includes("queen") ? m : "queen"));
    return twin !== key && !twinned ? this.creaturePage(twin, true) : null;
  }

  /** Unas hermanas del árbol, en el orden del motor. */
  nodes(list, kidsOf, page) {
    const base = (c) => { const m = REPEATED.exec(c.key); return m && c.table && !c.chance ? `${m[1]}.${m[2]}` : null; };
    const done = new Set();
    const rows = [];
    for (const c of list) {
      if (done.has(c.key)) continue;
      const b = base(c);
      const group = b ? list.filter((x) => base(x) === b) : [];
      if (group.length > 1) {
        group.forEach((x) => done.add(x.key));
        // Las ramas con el mismo resultado se apilan: «Common Metal Ore ×7», una línea compacta por dado.
        const stacks = new Map();
        group.forEach((x, i) => {
          if (!kidsOf(x.key).length) return;
          const name = this.t.name(x.table, this.d.typed[x.key]);
          if (!stacks.has(name)) stacks.set(name, []);
          stacks.get(name).push([x, i + 1]);
        });
        const branches = [...stacks].map(([name, xs]) => (xs.length > 1 ? this.stack(name, xs, kidsOf, page)
          : `<div class="node branch" data-node="${h(xs[0][0].key)}">
            <p class="branch-title"><span class="dice-n">${xs[0][1]}</span> <span class="result-name">${h(name)}</span></p>
            <div class="derived">${this.nodes(kidsOf(xs[0][0].key), kidsOf, page).join("")}</div></div>`)).join("");
        rows.push(this.diceRow(group, page, new Set([...stacks.values()].flat().map(([x]) => x.key))) + branches);
        continue;
      }
      done.add(c.key);
      const sub = kidsOf(c.key);
      rows.push(sub.length
        ? `<div class="node" data-node="${h(c.key)}">${this.derivedRow(c, page)}<div class="derived">${this.nodes(sub, kidsOf, page).join("")}</div></div>`
        : this.derivedRow(c, page));
    }
    return rows;
  }

  /** Una pila de ramas iguales: el título con «×N», la tirada que comparten una vez, y cada dado en una línea
   *  con sus casillas encadenadas («[1] Mineral → Mineral [50] Flint»). Debajo, el recuento de lo que salió. */
  stack(name, xs, kidsOf, page) {
    const first = kidsOf(xs[0][0].key)[0];
    const base = this.label(first);
    const tally = new Map();
    const lines = xs.map(([x, n]) => {
      const leaves = [];
      const cells = this.chain(kidsOf(x.key), kidsOf, base, leaves);
      leaves.forEach((l) => { const k = l.name; tally.set(k, { ...l, n: (tally.get(k)?.n ?? 0) + 1 }); });
      return `<div class="stack-line" data-node="${h(x.key)}"><span class="dice-n">${n}</span>${cells}</div>`;
    }).join("");
    const sum = [...tally.values()].map((l) => `<li><span class="result-name">${h(l.name)}</span>${l.page ? ` <span class="page">${h(T("page")(l.page))}</span>` : ""}${l.n > 1 ? ` <span class="stack-count">×${l.n}</span>` : ""}</li>`).join("");
    return `<div class="node branch stack${this.isNew("stack:" + xs[0][0].key)}" data-node="${h(xs[0][0].key)}">
      <p class="branch-title"><span class="result-name">${h(name)}</span> <span class="stack-count">×${xs.length}</span></p>
      <p class="stack-head${first.required ? " is-required" : " is-optional"}"><span class="derived-label">${h(base)}</span>${first.page ? ` <span class="page">${h(T("page")(first.page))}</span>` : ""}</p>
      <div class="stack-lines">${lines}</div>
      ${sum ? `<ul class="stack-tally">${sum}</ul>` : ""}
    </div>`;
  }

  /** Las casillas de una rama en fila, de madre a hija. Las hojas con resultado van a `leaves` para el recuento. */
  chain(list, kidsOf, base, leaves) {
    const t = this.t, d = this.d;
    return list.map((c) => {
      const v = d.typed[c.key];
      const full = this.label(c);
      const own = full === base ? "" : full.startsWith(base + " · ") ? full.slice(base.length + 3) : full;
      const sub = kidsOf(c.key);
      const needed = c.required && v == null;
      if (!sub.length && v != null && c.table) leaves.push({ name: t.name(c.table, v), page: t.page(c.table, v) });
      const cell = `<span class="chain-cell${c.required ? " is-required" : ""}${needed ? " is-needed" : ""}">
        ${own ? `<span class="chain-label">${h(own)}</span>` : ""}<span class="derived-die">${h(c.chance ? c.chance.label : c.formula.label)}</span>
        ${this.input(c, "derived-input chain-input", `aria-label="${h(full)}"`)}
        ${v != null ? `<span class="chain-answer">${this.answer(c)}</span>` : ""}</span>`;
      return cell + (sub.length ? `<span class="chain-arrow" aria-hidden="true">→</span>${this.chain(sub, kidsOf, base, leaves)}` : "");
    }).join("");
  }

  /** La página sólo si cambia respecto a la línea de arriba. */
  page(p, page) {
    if (!p || p === page.last) return "";
    page.last = p;
    return ` <span class="page">${h(T("page")(p))}</span>`;
  }

  label(c) {
    if (c.kind === "window") return T("window");
    if (c.kind === "times") return `${short(c.of)} · ${T("times")}`;
    return short(c.of);
  }

  /** Lo que salió en una derivada, en corto. */
  answer(c) {
    const t = this.t, v = this.d.typed[c.key];
    if (v == null) return "";
    if (c.chance) return c.chance.passes(v) ? `<span class="derived-yes"><span class="yes-star" aria-hidden="true"></span>${h(T("found"))}</span>` : `<span class="derived-no">${h(T("missed"))}</span>`;
    if (c.table) return `<span class="result-name">${h(t.name(c.table, v))}</span>`;
    return `<span class="derived-total">= ${h(c.formula.total(v))}</span>`;
  }

  input(c, cls = "derived-input", aria = "") {
    const d = this.d;
    const raw = d.buffers[c.key] ?? (d.typed[c.key] != null ? String(d.typed[c.key]) : "");
    const bad = String(raw).trim() !== "" && d.typed[c.key] == null;
    const hidden = c.secret && d.mimicHidden;
    if (d.locked && c.required) return `<span class="derived-value">${h(raw)}</span>`;
    return `<input id="${idOf(c.key)}" class="${cls}${bad ? " is-invalid" : ""}" data-child="${h(c.key)}" type="${hidden ? "password" : "text"}"
      inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${h(raw)}" placeholder="${h(c.formula.die)}"
      ${bad ? 'aria-invalid="true"' : ""} ${aria}>`;
  }

  derivedRow(c, page) {
    const t = this.t, d = this.d;
    if (c.kind === "inside") return `<p class="fixed-line">${h(c.of)}</p>`;
    if (c.secret && d.mimicHidden) return "";
    const v = d.typed[c.key];
    const raw = d.buffers[c.key] ?? "";
    const bad = String(raw).trim() !== "" && v == null;
    const die = c.chance ? c.chance.label : c.formula.label;
    const note = c.table && v != null ? t.noteOf(c.table, v) : null;
    const resultPage = c.table && v != null ? t.page(c.table, v) : null;
    const needed = c.required && v == null;
    const luck = c.chance && v != null ? (c.chance.passes(v) ? " is-found" : " is-missed") : "";
    return `<div class="derived-row${c.required ? " is-required" : " is-optional"}${needed ? " is-needed" : ""}${luck}${c.table ? "" : " is-inline"}${this.isNew(c.key)}" data-key="${h(c.key)}">
      <label class="derived-label" for="${idOf(c.key)}">${h(this.label(c))}${this.sectionOf(c) === "inhabitant" ? this.page(this.creaturePage(c.of) ?? c.page, {}) : this.page(c.page, page)}</label>
      <span class="derived-die">${h(bad ? `${c.formula.min}–${c.formula.max}` : die)}</span>
      ${this.input(c)}
      <span class="derived-result">${this.answer(c)}${this.page(resultPage, page)}</span>
      ${note ? `<details class="roll-note"><summary>${h(T("note"))}</summary><p>${h(E.loc(note))}</p></details>` : ""}
    </div>`;
  }

  /** Las repetidas: «+10 tiradas de la Tabla C» en una fila de casillas, con lo que salió debajo. */
  diceRow(items, page, branched = new Set()) {
    const t = this.t, d = this.d;
    const first = items[0];
    const title = short(groupTitle(first.of));
    // Los resultados iguales van juntos: «1 · 4 · 6 Water ×3».
    const same = new Map();
    items.forEach((c, i) => {
      const v = d.typed[c.key];
      if (v == null || branched.has(c.key)) return;
      const name = t.name(c.table, v);
      if (!same.has(name)) same.set(name, { ns: [], page: t.page(c.table, v) });
      same.get(name).ns.push(i + 1);
    });
    const results = [...same].map(([name, { ns, page: p }]) => `<li><span class="dice-n">${ns.join(" · ")}</span> <span class="result-name">${h(name)}</span>${this.page(p, page)}${ns.length > 1 ? ` <span class="stack-count">×${ns.length}</span>` : ""}</li>`).join("");
    return `<div class="dice-row${items.some((c) => c.required) ? " is-required" : " is-optional"}${this.isNew(first.key)}" data-group="${h(first.key.replace(REPEATED, "$1"))}">
      <p class="derived-label">${h(title)}${this.page(first.page, page)}</p>
      <div class="dice-cells">${items.map((c, i) => this.input(c, "dice-cell", `aria-label="${h(title)} ${i + 1}"`)).join("")}</div>
      ${results ? `<ol class="dice-results">${results}</ol>` : ""}
    </div>`;
  }

  /** Los componentes del Arma Definitiva, juntos al final del Botín. */
  ultimateGroup(items, fixedLines) {
    const reasons = items.filter((c) => c.chance).map((c) => c.of.split(/;\s*/)[1] ?? "");
    const shared = reasons.length > 1 && reasons.every((x) => x && x === reasons[0]) ? reasons[0] : "";
    const row = (c) => {
      const name = shared ? c.of.split(/;\s*/)[0] : c.of;
      const v = this.d.typed[c.key];
      const state = c.chance && v != null ? (c.chance.passes(v) ? this.isNew(`found:${c.key}`).replace("is-new", "is-revealed") + " is-found" : " is-missed") : "";
      return `<div class="derived-row is-inline ultimate-row${this.isNew(c.key)}${state}">
        <label class="derived-label" for="${idOf(c.key)}">${h(name)}</label>
        <span class="derived-die">${c.chance ? `<span class="chance-seal">${h(c.chance.label.replace(/<$/, ""))}</span>` : h(c.formula.label)}</span>
        ${this.input(c)}
        <span class="derived-result">${this.answer(c)}</span>
      </div>`;
    };
    // «X.chance» es la tirada de si sale; «X», cuánto sale: va debajo de la suya.
    const gated = new Set(items.filter((c) => items.some((g) => g.key === `${c.key}.chance`)).map((c) => c.key));
    const rows = items.filter((c) => !gated.has(c.key)).map((c) => {
      const amount = c.key.endsWith(".chance") ? items.find((x) => `${x.key}.chance` === c.key) : null;
      return amount ? `<div class="node" data-node="${h(c.key)}">${row(c)}<div class="derived">${row(amount)}</div></div>` : row(c);
    }).join("");
    const fixed = fixedLines.map((e) => this.dmRow(e, {})).join("");
    return `<div class="ultimate-group"><p class="group-title"><span class="relic-mark" aria-hidden="true"></span>${h(T("ultimate"))}${shared ? ` <span class="group-hint">${h(shared.charAt(0).toUpperCase() + shared.slice(1))}</span>` : ""}</p>${rows}${fixed}</div>`;
  }

  /** Dentro de la cámara: la barra de la ronda arriba y tres pestañas. «La sala» dice lo que hay,
   *  «Extraer» anota lo que se saca jugando, y «Terminar» cierra la partida y da el registro. */
  playing(der, sections, ids) {
    const d = this.d;
    const pending = this.extractable().length + E.live(d.rolls, der).length;
    const groups = this.manifest(der, ids);
    // Ítems y Bestiario sólo si hay botín o criaturas. Las fichas con stats llegan después.
    const items = groups.filter((g) => g.id === "loot").flatMap((g) => g.items).filter((it) => it.kind !== "head" || !groups.find((g) => g.id === "loot").items.some((x) => x.kind !== "head"));
    const beasts = [...groups.filter((g) => g.id === "chamber").flatMap((g) => g.items).filter((it) => it.beast),
      ...groups.filter((g) => g.id === "inhabitant" || g.id === "mimic").flatMap((g) => g.items).filter((it) => it.kind !== "head")];
    const tabs = [["room", T("tabRoom"), ""], items.length && ["items", T("tabItems"), String(items.length)], beasts.length && ["beasts", T("tabBeasts"), String(beasts.length)],
      ["extract", T("tabExtract"), pending ? String(pending) : ""], ["end", T("tabEnd"), ""]].filter(Boolean);
    const tab = tabs.some(([k]) => k === d.tab) ? d.tab : "room";
    const body = tab === "extract" ? this.extractTab(der, items.filter((it) => it.qty === "DM")) : tab === "end" ? this.endTab(beasts)
      : tab === "items" ? this.listTab(items, "items") : tab === "beasts" ? this.beastTab(beasts) : this.roomTab(der, sections, ids, groups);
    return `${this.roundBar(der)}
      <nav class="play-tabs" role="tablist" aria-label="${h(T("inChamber"))}">
        ${tabs.map(([k, label, badge]) => `<button type="button" role="tab" class="play-tab" data-action="tab" data-tab="${k}" aria-selected="${k === tab}" id="tab-${k}">${h(label)}${badge ? ` <span class="tab-badge">${h(badge)}</span>` : ""}</button>`).join("")}
      </nav>
      <section class="play-panel tab-${tab}${this.isNew("tab:" + tab)}" role="tabpanel" aria-labelledby="tab-${tab}">${body}</section>`;
  }

  /** La puerta: abierta, cerrada o sin cuenta, y en cuántas rondas cambia. */
  door(der) {
    const d = this.d, r = d.rolls;
    const trigger = E.entryTrigger(r.chamber);
    if (der.sealed) return { text: T("sealed"), state: "closed" };
    if (der.open) return { text: T("noCountdown"), state: "open" };
    if (E.BONFIRES.has(r.chamber) && d.typed[E.DOORS] != null) return d.typed[E.DOORS] === 1 ? { text: T("opened"), state: "open" } : { text: T("closed"), state: "closed" };
    if (der.timer != null && d.typed[E.WINDOW_KEY] != null) {
      const dr = E.door(d.round, der.timer, E.WINDOW.total(d.typed[E.WINDOW_KEY]));
      const open = dr.open && !(trigger && d.typed[E.ENTRY] !== 1);
      return { text: open ? T("doorOpen")(dr.rounds) : T("doorClosed")(dr.rounds), state: open ? "open" : "closed", left: dr.rounds };
    }
    return null;
  }

  /** La barra fija de la ronda: el número grande entre sus dos botones y, al lado, la puerta y el reloj. */
  roundBar(der) {
    const d = this.d, r = d.rolls;
    const trigger = E.entryTrigger(r.chamber);
    const manual = E.BONFIRES.has(r.chamber);
    const door = this.door(der);
    const meta = [der.timer != null && !der.sealed && !der.open ? T("rounds")(der.timer) : null, der.entries != null ? T("entriesN")(der.entries) : null].filter(Boolean);
    return `<div class="round-bar">
      <div class="round-counter">
        <button type="button" class="round-btn" data-action="round-" aria-label="${h(T("prevRound"))}" ${d.round <= 0 ? "disabled" : ""}>−</button>
        <p class="round-read"><span class="round-label">${h(T("round"))}</span><strong class="round-value${this.isNew("round:" + d.round)}" aria-live="polite">${d.round}</strong></p>
        <button type="button" class="round-btn is-next" data-action="round+" aria-label="${h(T("nextRound"))}">+</button>
      </div>
      <div class="round-info">
        ${door ? `<p class="door-status is-${door.state}" role="status"><span class="door-dot" aria-hidden="true"></span>${h(door.text)}</p>` : ""}
        ${meta.length ? `<p class="round-meta">${h(meta.join(" · "))}</p>` : ""}
        ${trigger ? `<label class="gate-check"><input type="checkbox" data-flag="${E.ENTRY}" ${d.typed[E.ENTRY] === 1 ? "checked" : ""}> ${h(trigger === "first-death" ? T("gateDeath") : T("gateFire"))}</label>` : ""}
        ${manual ? `<div class="bonfire-doors"><button type="button" data-action="doors-open">${h(T("open"))}</button><button type="button" data-action="doors-close">${h(T("close"))}</button></div>` : ""}
      </div>
    </div>`;
  }

  /** «La sala»: lo que hay, en fichas por tirada. Las tiradas completas quedan plegadas debajo. */
  roomTab(der, sections, ids, groups) {
    const d = this.d, r = d.rolls, t = this.t;
    const qty = (it) => (it.qty === "DM" ? DM_BOX() : it.qty != null ? `<span class="m-qty">${h(it.qty)}</span>` : "");
    const cards = groups.map((g) => `<div class="m-card m-${g.id}">
      <h3 class="m-title"><span class="roll-n">${ROMAN[ids.indexOf(g.id)] ?? ""}</span>${h(g.title)}</h3>
      <ul class="m-list">${g.items.map((it) => `<li class="m-item${it.kind ? ` is-${it.kind}` : ""}"><span class="m-name">${it.kind === "relic" ? `<span class="yes-star" aria-hidden="true"></span>` : ""}${h(it.name)}${it.page ? ` <span class="page">${h(T("page")(it.page))}</span>` : ""}</span>${qty(it)}</li>`).join("")}</ul>
    </div>`).join("");
    return `${E.circle(r, t) ? `<p class="circle-note">${h(T("circle"))}</p>` : ""}
      ${r.condition >= 60 && r.condition <= 64 && !der.conditionExcluded ? `<fieldset class="choice"><legend>${h(T("torcherTitle"))}</legend>
        <label class="choice-option"><input type="radio" name="torcher" data-choice="${E.TORCHER_TRIGGER}" value="1" ${d.typed[E.TORCHER_TRIGGER] === 1 ? "checked" : ""}> ${h(T("torcherYes"))}</label>
        <label class="choice-option"><input type="radio" name="torcher" data-choice="${E.TORCHER_TRIGGER}" value="0" ${d.typed[E.TORCHER_TRIGGER] === 0 ? "checked" : ""}> ${h(T("torcherNo"))}</label></fieldset>` : ""}
      <div class="manifest">${cards || `<p class="empty">${h(T("nothingHere"))}</p>`}</div>
      <details class="chamber-summary"${this.openRolls ? " open" : ""}><summary>${h(T("rollsDetail"))}</summary>${sections}</details>`;
  }

  /** «Ítems» o «Bestiario»: una ficha por cosa, con su página y cuántas hay. Aquí irán sus stats. */
  /** «Bestiario»: cada enemigo con su cantidad en grande y su cuenta de eliminados. Aquí irán sus stats. */
  beastTab(list) {
    const kills = this.d.kills ?? {};
    return `<ul class="beast-grid">${list.map((it, i) => {
      const n = typeof it.qty === "number" ? it.qty : null;
      const k = kills[it.name] ?? 0;
      const cleared = n != null && k >= n;
      return `<li class="beast${cleared ? " is-cleared" : ""}" style="--i:${i}">
        <div class="beast-head">
          <p class="beast-name">${h(it.name)}${it.page ? ` <span class="page">${h(T("page")(it.page))}</span>` : ""}</p>
          <p class="beast-count">${n != null ? `<span class="beast-left${this.isNew(`left:${it.name}:${n - k}`)}">${Math.max(0, n - k)}</span><span class="beast-of">/ ${n}</span>` : DM_BOX()}</p>
        </div>
        ${n != null && n <= 30 ? `<p class="beast-pips" aria-hidden="true">${Array.from({ length: n }, (_, j) => `<span class="pip${j < k ? " is-dead" : ""}"></span>`).join("")}</p>` : ""}
        <div class="kill-counter">
          <button type="button" class="round-btn" data-action="kill-" data-name="${h(it.name)}" aria-label="−1" ${k <= 0 ? "disabled" : ""}>−</button>
          <p class="kill-read"><strong class="kill-n">${k}</strong> <span>${h(T("killed"))}</span></p>
          <button type="button" class="round-btn is-next" data-action="kill+" data-name="${h(it.name)}" aria-label="+1" ${cleared ? "disabled" : ""}>+</button>
        </div>
      </li>`;
    }).join("")}</ul>`;
  }

  listTab(list, kind) {
    const qty = (it) => (it.qty === "DM" ? DM_BOX() : it.qty != null ? `<span class="m-qty">${h(it.qty)}</span>` : "");
    return `<ul class="entity-grid is-${kind}">${list.map((it, i) => `<li class="entity${it.kind ? ` is-${it.kind}` : ""}" style="--i:${i}">
      <span class="entity-mark" aria-hidden="true"></span>
      <p class="entity-name">${h(it.name)}</p>
      ${it.page ? `<p class="page">${h(T("page")(it.page))}</p>` : ""}
      ${qty(it)}
    </li>`).join("")}</ul>`;
  }

  /** Lo que hay en la cámara, por tirada: el resultado y, debajo, cada cosa que salió con su cantidad.
   *  Sólo las hojas del árbol (lo que de verdad hay), y lo igual junto: «Iron ×5». */
  manifest(der, ids) {
    const d = this.d, t = this.t, r = d.rolls, typed = d.typed;
    const kids = this.children().filter((c) => !c.extraction && !(c.secret && d.mimicHidden));
    const keys = Object.keys(typed);
    const out = [];
    for (const id of ids) {
      if (id === "timer" || id === "entries") continue;
      const skip = r.chamber != null && E.skipped(id, r, t);
      if (skip || r[id] == null) continue;
      const items = [];
      const add = (it) => {
        const same = items.find((x) => x.name === it.name && x.page === it.page && x.kind === it.kind && (x.qty == null || typeof x.qty === "number") && (it.qty == null || typeof it.qty === "number"));
        if (same && it.stack) { same.qty = (same.qty ?? 1) + (it.qty ?? 1); return; }
        items.push(it);
      };
      // El resultado de la tirada, si dice algo por sí mismo.
      if (id === "condition" && !der.conditionExcluded) {
        const c = der.rule?.fixedCondition ?? r.condition;
        if (!/^no condition$/i.test(t.name("B", c))) items.push({ name: t.name("B", c), page: t.page("B", c), kind: "head" });
      }
      if (id === "mimic") {
        if (d.mimicHidden) continue;
        if (E.mimicKind(r.mimic) === "none") continue;
      }
      for (const e of this.fixedLinesOf(id, der, skip)) {
        const name = (typeof e.of === "string" ? e.of : E.loc(e.of)).replace(/^./, (m) => m.toUpperCase());
        if (e.kind === "one") items.push({ name, page: this.creaturePage(e.of), qty: 1, stack: true });
        else if (e.kind === "dm" || ["loot", "exclusiveLoot", "ultimate"].includes(e.kind) && !NOT_AMOUNTS.test(name)) items.push({ name, page: e.page, qty: "DM", kind: "sure" });
        else items.push({ name });
      }
      const lootDm = id === "loot" && !kids.some((c) => c.from === "loot") && !NOT_AMOUNTS.test(t.name("C", r.loot));
      if (lootDm) items.push({ name: t.name("C", r.loot), page: t.page("C", r.loot), qty: "DM", kind: "sure" });
      for (const c of kids.filter((x) => this.sectionOf(x) === id && x.kind !== "inside")) {
        const v = typed[c.key];
        if (v == null) continue;
        // Una hoja: nada con valor cuelga de ella (la puerta «X.chance» de «X» no cuenta como hija).
        const hasKids = keys.some((k) => k !== c.key && k.startsWith(c.key + ".") && !k.endsWith(".chance") && kids.some((x) => x.key === k));
        if (hasKids) continue;
        if (c.chance) {
          const amount = c.key.endsWith(".chance") && kids.some((x) => x.key === c.key.replace(/\.chance$/, ""));
          if (c.chance.passes(v) && !amount) items.push({ name: (c.group === "ultimate" ? c.of.split(/;\s*/)[0] : short(c.of)), kind: c.group === "ultimate" ? "relic" : "found" });
          continue;
        }
        if (c.table) {
          const name = t.name(c.table, v);
          if (!NOT_AMOUNTS.test(name)) add({ name, page: t.page(c.table, v), stack: true });
          continue;
        }
        const relic = c.group === "ultimate";
        const label = relic ? c.of.split(/;\s*/)[0] : this.label(c);
        // Enemigos que trae la propia cámara («Hydras en la cámara»): van también al Bestiario con su ficha.
        const beast = id === "chamber" ? this.beastIn(c.of) : null;
        add({ name: label, page: id === "inhabitant" ? this.creaturePage(c.of) ?? c.page : beast?.page ?? null, qty: c.formula.total(v), kind: relic ? "relic" : null, beast: !!beast });
      }
      if (!items.length && (id === "loot" || id === "inhabitant")) {
        const tb = id === "loot" ? "C" : "D";
        items.push({ name: t.name(tb, r[id]), page: t.page(tb, r[id]), kind: "head" });
      }
      if (items.length) out.push({ id, title: T(`roll_${id}`), items });
    }
    return out;
  }

  /** Las vetas que faltan por sacar: su cantidad se tira sólo cuando la extracción sale bien, ya dentro. */
  extractable() { return this.children().filter((c) => c.extraction && this.d.typed[c.key] == null); }

  /** «Extraer»: las vetas iguales juntas en una fila («Extraer Flint ×3» con sus casillas), lo que puede pasar jugando,
   *  y debajo lo ya anotado, ronda a ronda. */
  extractTab(der, dm = []) {
    const d = this.d;
    // Lo que va a criterio del Máster (agua abundante, Forest…): se anotan las unidades que se sacan, tantas veces como haga falta.
    const dmRows = dm.map((it) => {
      const key = `dm.${it.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      const raw = d.liveBuffers[key]?.total ?? "";
      const bad = String(raw).trim() !== "" && !(/^\d+$/.test(String(raw).trim()) && +raw > 0);
      const sum = d.live.filter((e) => e.key === key).reduce((a, e) => a + (e.units ?? 0), 0);
      return `<div class="live-row extract-row is-dm">
        <p class="live-label"><span class="live-name">${h(T("extract")(it.name))}</span>${it.page ? ` <span class="page">${h(T("page")(it.page))}</span>` : ""}${sum ? ` <span class="stack-count">${h(T("unitsSoFar")(sum))}</span>` : ""}</p>
        <div class="live-inputs"><input id="${idOf(key)}-x" class="dice-cell${bad ? " is-invalid" : ""}" data-live="${h(key)}" data-part="total" data-name="${h(it.name)}" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${h(raw)}" placeholder="${h(T("units"))}" aria-label="${h(T("units"))}"><button type="button" class="record-btn" data-action="extract-dm" data-key="${h(key)}" data-name="${h(it.name)}">${h(T("record"))}</button></div>
      </div>`;
    }).join("");
    const groups = new Map();
    for (const c of this.extractable()) {
      const k = `${c.of}|${c.page}|${c.formula.label}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(c);
    }
    const rows = [...groups.values()].map((cs) => {
      const c = cs[0];
      const cells = cs.map((x, i) => {
        const raw = d.liveBuffers[x.key]?.total ?? "";
        const n = E.typedValue(raw, x.formula.die);
        const bad = String(raw).trim() !== "" && (n == null || n < x.formula.min || n > x.formula.max);
        return `<input id="${idOf(x.key)}-x" class="dice-cell${bad ? " is-invalid" : ""}" data-live="${h(x.key)}" data-part="total" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${h(raw)}" placeholder="${h(x.formula.label)}" aria-label="${h(T("extract")(x.of))} ${i + 1}">`;
      }).join("");
      return `<div class="live-row extract-row">
        <p class="live-label"><span class="live-name">${h(T("extract")(c.of))}</span>${cs.length > 1 ? ` <span class="stack-count">×${cs.length}</span>` : ""}${c.page ? ` <span class="page">${h(T("page")(c.page))}</span>` : ""}</p>
        <div class="live-inputs">${cells}<button type="button" class="record-btn" data-action="extract" data-keys="${h(cs.map((x) => x.key).join(","))}">${h(T("record"))}</button></div>
      </div>`;
    }).join("");
    const live = E.live(d.rolls, der).map((x) => this.liveRow(x)).join("");
    const events = d.live.length ? `<h3 class="tab-sub">${h(T("recorded"))}</h3><ol class="events">${d.live.map((e) => `<li><span class="event-round">${h(T("roundShort"))}${e.round}</span> <span class="event-text">${h(e.text)}</span>${e.page ? ` <span class="page">${h(T("page")(e.page))}</span>` : ""}${e.note ? `<details class="roll-note"><summary>${h(T("note"))}</summary><p>${h(E.loc(e.note))}</p></details>` : ""}</li>`).reverse().join("")}</ol>` : "";
    return `${dmRows || rows || live ? `<div class="live-list">${dmRows}${rows}${live}</div>` : `<p class="empty">${h(T("nothingToExtract"))}</p>`}${events}`;
  }

  liveRow(item) {
    const e = item.extra;
    const b = this.d.liveBuffers[item.key] ?? {};
    const chance = E.Chance.of(e.chance ?? "");
    const f = E.formulaOf(e.die ?? "");
    const id = idOf(item.key);
    const label = E.loc(e.of).replace(/^Tabla [\d.]+,\s*|^Table [\d.]+,\s*/, "");
    return `<div class="live-row">
      <p class="live-label"><span class="live-name">${h(label.charAt(0).toUpperCase() + label.slice(1))}</span>${item.page ? ` <span class="page">${h(T("page")(item.page))}</span>` : ""}</p>
      <div class="live-inputs">
        ${chance ? `<input id="${id}-c" class="dice-cell" data-live="${h(item.key)}" data-part="chance" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${h(b.chance ?? "")}" placeholder="${h(chance.label)}" aria-label="${h(chance.label)}">` : ""}
        ${f ? `<input id="${id}-d" class="dice-cell" data-live="${h(item.key)}" data-part="total" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${h(b.total ?? "")}" placeholder="${h(f.label)}" aria-label="${h(f.label)}">` : ""}
        <button type="button" class="record-btn" data-action="live" data-key="${h(item.key)}">${h(T("record"))}</button>
      </div>
    </div>`;
  }

  /** «Terminar»: cómo acabó, las muertes y las notas, y guardarlo en el registro. */
  endTab(beasts = []) {
    const d = this.d;
    const kills = d.kills ?? {};
    const killed = Object.values(kills).reduce((a, n) => a + n, 0);
    const total = beasts.every((b) => typeof b.qty === "number") ? beasts.reduce((a, b) => a + b.qty, 0) : null;
    const outcome = d.outcome ?? Object.keys(T("outcomes"))[0];
    return `<form class="close-form" data-form="close">
      <fieldset class="outcomes"><legend class="tab-sub">${h(T("outcome"))}</legend>
        ${Object.entries(T("outcomes")).map(([k, v]) => `<label class="outcome"><input type="radio" name="outcome" data-field="outcome" value="${k}" ${k === outcome ? "checked" : ""}><span>${h(v)}</span></label>`).join("")}
      </fieldset>
      <div class="end-stats">
        <div class="deaths-counter">
          <span class="round-label">${h(T("deaths"))}</span>
          <button type="button" class="round-btn" data-action="deaths-" aria-label="−1" ${d.deaths <= 0 ? "disabled" : ""}>−</button>
          <strong class="round-value">${d.deaths}</strong>
          <button type="button" class="round-btn" data-action="deaths+" aria-label="+1">+</button>
        </div>
        <p class="end-rounds"><span class="round-label">${h(T("roundsPlayed"))}</span><strong>${d.round}</strong></p>
        ${beasts.length ? `<p class="end-rounds end-kills"><span class="round-label">${h(T("enemiesKilled"))}</span><strong>${killed}</strong>${total != null ? `<span class="beast-of">/ ${total}</span>` : ""}</p>` : ""}
      </div>
      <label class="tab-sub" for="close-notes">${h(T("notes"))}</label>
      <textarea id="close-notes" name="notes" data-field="notes" rows="4" placeholder="${h(T("notesHint"))}">${h(d.notes ?? "")}</textarea>
      <div class="chamber-actions">
        <button type="submit" class="primary">${h(T("save"))}</button>
        ${askButton(this.asking, "discard", T("discard"), T("confirmDiscard"), T("yes"), T("cancel"))}
      </div>
    </form>`;
  }

  recordExtract(key) {
    const c = this.children().find((x) => x.key === key);
    if (!c) return;
    const n = E.typedValue(this.d.liveBuffers[key]?.total, c.formula.die);
    if (n == null || n < c.formula.min || n > c.formula.max) return;
    this.d.typed[key] = n;
    this.d.live.push({ key, round: this.d.round, label: T("extract")(c.of), text: `${T("extract")(c.of)} → ${c.formula.total(n)}` });
    delete this.d.liveBuffers[key];
  }

  // ---------------------------------------------------------------- eventos

  bind(root, rerender) {
    root.addEventListener("input", (ev) => {
      const el = ev.target;
      if (el.dataset.field && el.type !== "radio") { this.d[el.dataset.field] = el.value; this.save(); return; }
      if (el.dataset.roll) { this.setRoll(el.dataset.roll, el.value); rerender(); }
      else if (el.dataset.child) { this.setChild(el.dataset.child, el.value); rerender(); }
      else if (el.dataset.live) {
        (this.d.liveBuffers[el.dataset.live] ??= {})[el.dataset.part] = el.value;
        this.save();
      }
    });
    root.addEventListener("change", (ev) => {
      const el = ev.target;
      if (el.dataset.field && el.type === "radio") { this.d[el.dataset.field] = el.value; this.save(); }
      else if (el.dataset.choice) { this.setChoice(el.dataset.choice, +el.value); rerender(); }
      else if (el.dataset.flag) {
        if (el.checked) this.d.typed[el.dataset.flag] = 1; else delete this.d.typed[el.dataset.flag];
        this.save(); rerender();
      } else if (el.dataset.action === "mimics") {
        this.mimics = el.checked;
        store.set("bs.mimics", this.mimics);
        rerender();
      }
    });
    root.addEventListener("click", (ev) => {
      const el = ev.target.closest("button[data-action]");
      if (!el) return;
      const a = el.dataset.action;
      if (a === "mimics-on" || a === "mimics-off") {
        this.mimics = a === "mimics-on";
        store.set("bs.mimics", this.mimics);
        rerender();
        root.querySelector(this.mimics ? "[data-roll=mimic]" : "[data-roll=inhabitant]")?.focus();
        return;
      }
      if (a === "mimic-toggle") this.d.mimicHidden = !this.d.mimicHidden;
      else if (a === "enter") { if (!this.enter(root)) return; window.scrollTo({ top: 0 }); }
      else if (a === "new" || a === "discard") { this.asking = a; rerender(); return; }
      else if (a === "new-yes" || a === "discard-yes") { this.asking = null; this.reset(); }
      else if (a === "ask-cancel") { this.asking = null; rerender(); return; }
      else if (a === "round+") this.d.round += 1;
      else if (a === "round-") this.d.round = Math.max(0, this.d.round - 1);
      else if (a === "deaths+") this.d.deaths += 1;
      else if (a === "deaths-") this.d.deaths = Math.max(0, this.d.deaths - 1);
      else if (a === "doors-open") this.d.typed[E.DOORS] = 1;
      else if (a === "doors-close") this.d.typed[E.DOORS] = 0;
      else if (a === "live") this.recordLive(el.dataset.key);
      else if (a === "extract") el.dataset.keys.split(",").forEach((k) => this.recordExtract(k));
      else if (a === "tab") this.d.tab = el.dataset.tab;
      else if (a === "kill+" || a === "kill-") {
        const k = (this.d.kills ??= {}), n = el.dataset.name;
        k[n] = Math.max(0, (k[n] ?? 0) + (a === "kill+" ? 1 : -1));
      }
      else if (a === "extract-dm") {
        const k = el.dataset.key, raw = String(this.d.liveBuffers[k]?.total ?? "").trim();
        if (!/^\d+$/.test(raw) || +raw <= 0) return;
        this.d.live.push({ key: k, round: this.d.round, units: +raw, text: `${T("extract")(el.dataset.name)} → ${raw}` });
        delete this.d.liveBuffers[k];
      }
      else return;
      this.save();
      rerender();
    });
    root.addEventListener("toggle", (ev) => {
      if (ev.target.classList?.contains("chamber-summary")) this.openRolls = ev.target.open;
    }, true);
    root.addEventListener("submit", (ev) => {
      if (ev.target.dataset.form !== "close") return;
      ev.preventDefault();
      const f = new FormData(ev.target);
      this.close({ outcome: f.get("outcome"), notes: f.get("notes") });
      rerender();
      window.scrollTo({ top: 0 });
    });
  }
}
