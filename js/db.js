// La base de datos del libro (db/): la genera tools/build_db.py a partir de data/. La lee la pantalla Referencia.
// Ids «tipo:slug»; cada fila de tabla tiene su rango [min, max], su página y a qué lleva (refs).

export const COLLECTIONS = ["tables", "chambers", "conditions", "creatures", "items", "materials", "rules"];

/** «A» → «table:a», «3.2.spark» → «table:3-2-spark». */
export const tableId = (code) => "table:" + String(code).trim().toLowerCase().replace(/[.\s]+/g, "-");

/** Quita las marcas de nota del libro: «*Decan House (10d10)» → «Decan House (10d10)». */
export const clean = (label) => String(label ?? "").replace(/[*†ª]+/g, "").trim();

export const rangeText = (r) => (r[0] === r[1] ? `${r[0]}` : `${r[0]}–${r[1]}`);

/** Minúsculas y sin acentos, para comparar. */
const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export class Db {
  constructor(parts, index) {
    this.by = new Map();
    for (const c of COLLECTIONS) {
      this[c] = parts[c] ?? [];
      for (const r of this[c]) this.by.set(r.id, r);
    }
    // Lo que se busca: las fichas y las filas de las tablas, cada una con su texto ya en minúsculas.
    this.index = index.map((x) => ({
      ...x,
      label: x.type === "row" ? clean(x.name) : x.name,
      hay: fold([x.name, x.code, ...(x.aliases ?? [])].filter(Boolean).join(" ")),
      body: fold(x.text),
    }));
  }

  static async load(base = "db/") {
    const get = (f) => fetch(base + f).then((r) => { if (!r.ok) throw new Error(`${f}: ${r.status}`); return r.json(); });
    const [index, ...parts] = await Promise.all(["search.json", ...COLLECTIONS.map((c) => c + ".json")].map(get));
    return new Db(Object.fromEntries(COLLECTIONS.map((c, i) => [c, parts[i]])), index);
  }

  get(id) { return this.by.get(id) ?? null; }
  table(code) { return this.get(tableId(code)); }

  /** La fila de una tabla que cubre una cara del dado. */
  row(table, face) {
    const t = typeof table === "string" ? this.get(table) : table;
    return t?.rows.find((w) => w.range[0] <= face && face <= w.range[1]) ?? null;
  }

  /** «A 57», «tabla 3.1 12», «D 00»: la fila exacta, o null si no es eso. */
  jump(q) {
    const m = String(q).trim().match(/^(?:tabla\s+|table\s+)?([a-d]|\d\.\d+(?:\.\w+)?)\s+(\d{1,3})$/i);
    if (!m) return null;
    const t = this.table(m[1]);
    if (!t) return null;
    const face = +m[2] === 0 && t.die?.includes("%") ? 100 : +m[2];
    const row = this.row(t, face);
    return row ? { table: t, face, row } : null;
  }

  /**
   * Busca por nombre, por texto o por página («p. 96», «p96»). Primero lo que empieza igual, luego lo que lo
   * contiene en el nombre y al final lo que sólo lo menciona en el texto. `type` filtra: chamber, creature…
   */
  search(q, type = "all") {
    let rows = this.index.filter((x) => type === "all" || x.type === type || (type === "table" && x.type === "row"));
    const s = fold(q).trim();
    if (!s) return type === "all" ? rows.filter((x) => x.type !== "row") : rows;
    const p = s.match(/^(?:p|pag|pg|page)\.?\s*(\d{1,3})$/);
    if (p) return rows.filter((x) => x.page === +p[1]);
    const words = s.split(/\s+/);
    const scored = [];
    for (const x of rows) {
      let score = 0;
      if (x.hay.startsWith(s) || fold(x.label).startsWith(s)) score = 4;
      else if (x.hay.includes(s)) score = 3;
      else if (words.every((w) => x.hay.includes(w))) score = 2;
      else if (words.every((w) => x.body.includes(w))) score = 1;
      // Las fichas antes que las filas que las nombran.
      if (score) scored.push([score * 2 + (x.type === "row" ? 0 : 1), x]);
    }
    return scored.sort((a, b) => b[0] - a[0]).map((a) => a[1]);
  }
}
