// Pruebas del motor contra las tablas reales. Abrir tests.html: todas deben salir en verde.
import * as E from "./engine.js";
import { Db, tableId } from "./db.js";
import { ChamberView } from "./chamber.js";

const results = [];
const test = (name, fn) => {
  try { fn(); results.push([name, null]); } catch (err) { results.push([name, err.message]); }
};
const eq = (a, b, msg = "") => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} esperaba ${JSON.stringify(b)}, salió ${JSON.stringify(a)}`);
};
const ok = (v, msg) => { if (!v) throw new Error(msg); };

const t = await E.Tables.load("data/");
const db = await Db.load("db/");
const keys = (r, typed = {}) => E.children(r, E.derive(r, t), t, typed).map((c) => c.key);

test("Dados del libro: 1d6+1, 20+1d%, 1d4-1, 10d%", () => {
  eq(E.countsOf("1d6+1 Nothics").map((c) => [c.formula.label, c.what]), [["1d6+1", "Nothics"]]);
  eq(E.countsOf("*Ghoul Pack (1d4+1)").map((c) => [c.formula.label, c.what]), [["1d4+1", "Ghoul Pack"]]);
  eq(E.formulaOf("20+1d%").plus, 20);
  eq(E.formulaOf("1d4-1").plus, -1);
  eq([E.formulaOf("10d%").min, E.formulaOf("10d%").max], [10, 1000]);
});

test("Percentiles estrictos: 50%< acepta 1–49; >75% acepta 76–100 (p. 22)", () => {
  const under = E.Chance.of("50%<"), over = E.Chance.of(">75%");
  eq([under.passes(49), under.passes(50), over.passes(75), over.passes(76)], [true, false, false, true]);
});

test("Mímicos: <10 Common Mimic y además Maze Mimics, <50 Common Mimic, resto nada (p. 85)", () => {
  eq([9, 10, 49, 50].map(E.mimicKind), ["infested", "common", "common", "none"]);
});

test("En un d%, 0 y 00 valen 100", () => {
  eq([E.typedValue("0", "d%"), E.typedValue("00", "d%"), E.typedValue("0", "d6")], [100, 100, 0]);
});

test("Las 100 cámaras tienen nombre, página y regla", () => {
  for (let n = 1; n <= 100; n++) {
    ok(t.has("A", n) && t.page("A", n), `cámara ${n} sin nombre o página`);
    ok(t.ruleOf(n), `cámara ${n} sin regla`);
  }
});

test("Tablas B, C y D completas de 1 a 100", () => {
  for (const tb of ["B", "C", "D"]) for (let n = 1; n <= 100; n++) ok(t.has(tb, n), `${tb} ${n} vacío`);
});

test("Una sola entrada multiplica el Temporizador ×10 (p. 85)", () => {
  const d = E.derive({ chamber: 20, condition: 60, entries: 1, timer: 20 }, t);
  eq(d.timer, 200);
});

test("Una entrada y Reduced Time: primero ×10, luego la mitad (pp. 85, 95)", () => {
  const d = E.derive({ chamber: 20, condition: 90, entries: 1, timer: 7 }, t);
  eq(d.timer, 35);
});

test("Sealed Chamber: sin cuenta atrás (p. 87)", () => {
  const d = E.derive({ chamber: 8, condition: 1, entries: 2, timer: 30 }, t);
  eq([d.sealed, d.timer], [true, null]);
});

test("Una condición excluida pide re-tirar (Hydras' Nest excluye Sealed Chamber)", () => {
  const d = E.derive({ chamber: 1, condition: 1 }, t);
  eq(d.conditionExcluded, true);
  ok(!E.blockers({ chamber: 1, condition: 1, entries: 2, timer: 20, loot: 50, inhabitant: 50 }, {}, t).ready, "dejó entrar");
});

test("Deep Rest Temple no tira Condición, Habitantes ni Mímicos (p. 137)", () => {
  const r = { chamber: 93 };
  eq(["condition", "inhabitant", "mimic"].map((x) => E.skipped(x, r, t)), [true, true, true]);
  eq(E.pending(r, t), ["entries", "timer", "loot"]);
});

test("Decan House: la Tabla 3.7 es obligatoria antes de entrar", () => {
  const r = { chamber: 2, entries: 2, timer: 50, loot: 50 };
  const block = E.blockers(r, { "timer.window": 3 }, t);
  ok(block.children.some((c) => c.table === "3.7"), "no pide la 3.7");
});

test("Deep Tombs: 1d10+5 niveles, un d% de esqueletos por nivel", () => {
  const r = { chamber: 8 };
  const levels = keys(r, { "chamber.extra.audit20260921-0": 3 }).filter((k) => k.includes(".level"));
  eq(levels.length, 8);
});

test("Botín con asterisco: el dado es cuántas veces se tira la tabla (p. 167)", () => {
  const r = { chamber: 50, loot: 3 };
  const k = keys(r, { "loot.0": 2 });
  ok(k.includes("loot.0.w1") && k.includes("loot.0.w3") && !k.includes("loot.0.w4"), k.join(","));
});

test("Cambiar una tirada borra lo que colgaba de ella", () => {
  const kept = E.keep({ "loot.0": 2, "inhabitant.0": 1 }, { loot: 3, inhabitant: 41 }, { loot: 4, inhabitant: 41 });
  eq(kept, { "inhabitant.0": 1 });
});

test("Cambiar la cámara vacía las demás tiradas (p. 84)", () => {
  eq(E.typeRoll({ chamber: 8, condition: 12 }, "chamber", 9), { chamber: 9 });
});

test("Ventana de la entrada: cerrada el Temporizador, abierta 1+1d6 rondas", () => {
  eq(E.door(0, 5, 3), { open: false, rounds: 5 });
  eq(E.door(5, 5, 3), { open: true, rounds: 3 });
  eq(E.door(8, 5, 3), { open: false, rounds: 5 });
});

test("Magia salvaje: se tira jugando en la Tabla 3.1", () => {
  const r = { chamber: 8, condition: 12 };
  const live = E.live(r, E.derive(r, t));
  eq(live.map((x) => x.extra.table), ["3.1"]);
  eq(E.resolveLive(live[0], { total: 7 }, t).text, t.name("3.1", 7));
});

test("La base de datos (db/) dice lo mismo que data/ en cada cara de cada tabla (si falla: python tools/build_db.py)", () => {
  let faces = 0;
  for (const [id, file] of Object.entries(t.files)) {
    const table = db.get(tableId(id));
    ok(table, `falta ${tableId(id)} en db/tables.json`);
    for (const [n, v] of Object.entries(file.results ?? {})) {
      const row = db.row(table, +n);
      ok(row, `${id} ${n}: no está en db/`);
      eq([row.label, row.page ?? null], [v.result, v.page ?? row.page ?? null], `${id} ${n}:`);
      faces++;
    }
  }
  ok(faces > 700, `sólo ${faces} caras`);
});

test("Cada enlace de la base lleva a una ficha que existe", () => {
  for (const table of db.tables) for (const w of table.rows) for (const r of w.refs ?? []) ok(db.get(r), `${table.id} ${w.range}: ${r}`);
  for (const c of db.creatures) for (const a of c.appears_in ?? []) ok(db.get(a.table ?? a.chamber), `${c.id}: ${JSON.stringify(a)}`);
});

test("Buscador: «A 57», «d 00», «p. 96» y por nombre", () => {
  const a = db.jump("A 57");
  eq([a.table.id, a.row.label], ["table:a", t.entry("A", 57).result]);
  eq(db.jump("d 00").face, 100);
  eq(db.jump("hydra"), null);
  ok(db.search("p. 96").length && db.search("p. 96").every((x) => x.page === 96), "p. 96");
  eq(db.search("darkest cave")[0].id, "chamber:the-darkest-cave");
  ok(db.search("hydra", "creature").every((x) => x.type === "creature"), "filtro");
});

// La pantalla de la Cámara: en las 100 cámaras, con varias tiradas, sale todo lo que pide el motor,
// cada derivada debajo de la tirada que la pidió y las siete en el orden del libro.
test("Cámara: en las 100 salas cada derivada sale una vez, bajo su madre y en su tirada; las siete en orden", () => {
  const view = new ChamberView(t);
  view.mimics = true;
  let checked = 0;
  const cross = new Set();
  const order = E.ROLLS.map((x) => x.id);
  for (let n = 1; n <= 100; n++) {
    for (const v of [1, 23, 55, 77, 99]) {
      let r = E.typeRoll({}, "chamber", n);
      for (const id of ["condition", "entries", "timer", "loot", "inhabitant", "mimic"]) {
        if (E.skipped(id, r, t)) continue;
        const [a, b] = E.rangeOf(id, E.derive(r, t));
        r = E.typeRoll(r, id, Math.min(b, Math.max(a, id === "entries" ? 3 : id === "timer" ? 20 : v)));
      }
      const typed = {};
      if (r.condition >= 37 && r.condition <= 41) typed[E.DOUBLE_MODE] = 1;
      for (let pass = 0; pass < 8; pass++) {
        let more = false;
        for (const c of E.children(r, E.derive(r, t), t, typed)) {
          if (typed[c.key] != null || c.extraction) continue;
          for (const x of [c.chance ? 3 : null, c.formula.min, c.formula.max, Math.ceil((c.formula.min + c.formula.max) / 2)]) {
            if (x != null && E.answerValid(c, x, t)) { typed[c.key] = x; more = true; break; }
          }
        }
        if (!more) break;
      }
      view.d = { rolls: r, typed, buffers: {}, round: 0, locked: false, mimicHidden: false, live: [], liveBuffers: {}, deaths: 0 };
      const doc = new DOMParser().parseFromString(view.render(), "text/html");
      const where = `sala ${n}, tiradas ${v}:`;
      eq([...doc.querySelectorAll("[data-section]")].map((x) => x.dataset.section), order, `${where} orden`);
      const kids = E.children(r, E.derive(r, t), t, typed).filter((c) => !c.extraction && c.kind !== "inside");
      const keys = new Set(kids.map((c) => c.key));
      for (const c of kids) {
        const els = [...doc.querySelectorAll("[data-child]")].filter((x) => x.dataset.child === c.key);
        eq(els.length, 1, `${where} ${c.key} veces`);
        // La madre: la clave más larga que empieza la suya; «X.chance» es la puerta de «X», así que «X» cuelga de ella.
        let p = keys.has(`${c.key}.chance`) ? `${c.key}.chance` : null;
        const self = c.key.replace(/\.chance$/, "");
        if (!p) for (const k of keys) if (k !== self && self.startsWith(k + ".") && (!p || k.length > p.length)) p = k;
        // Si la madre está en otra de las siete (los niveles del Deep Tomb y sus esqueletos, que son Habitantes),
        // la hija va en su tirada, como raíz: el motor decide la sección.
        const pc = p && kids.find((x) => x.key === p);
        if (pc && view.sectionOf(pc) !== view.sectionOf(c)) { cross.add(`${n}:${c.key}`); p = null; }
        if (p) ok([...doc.querySelectorAll("[data-node]")].some((x) => x.dataset.node === p && x.contains(els[0])), `${where} ${c.key} no está bajo ${p}`);
        eq(els[0].closest("[data-section]").dataset.section, view.sectionOf(c), `${where} ${c.key} sección`);
        checked++;
      }
    }
  }
  ok(checked > 2000, `sólo ${checked} derivadas`);
  console.log("Cámara: derivadas revisadas", checked, "· hijas en otra tirada que su madre:", [...new Set([...cross].map((x) => x.split(":")[0]))].join(", "));
});

const ul = document.getElementById("results");
ul.innerHTML = results.map(([name, err]) => `<li class="${err ? "err" : ""}">${err ? "✗" : "✓"} ${name}${err ? `<br><small>${err}</small>` : ""}</li>`).join("");
const failed = results.filter((r) => r[1]).length;
document.getElementById("summary").textContent = failed ? `${failed} de ${results.length} fallaron` : `${results.length} de ${results.length} pasan`;
document.title = failed ? "FALLAN pruebas" : "Pruebas OK";
