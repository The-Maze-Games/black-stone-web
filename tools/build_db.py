#!/usr/bin/env python3
"""Build the normalized Black Stone database from the web app's data files.

Usage:  python tools/build_db.py            (lee data/ y escribe db/ junto a él)
        python tools/build_db.py <data dir> <output dir>

The web's data/*.json files stay the source of truth (the book audit edits
them). This script only READS them and writes a normalized, cross-referenced
copy: one collection per entity type, every record with a stable id
("type:slug"), a book page, and links to the tables that produce it.
Re-run it after any change to web/data and the database follows.
"""
import json, re, sys, os, unicodedata, datetime, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "data")
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "db")
os.makedirs(OUT, exist_ok=True)


def load(name):
    with open(os.path.join(SRC, name), encoding="utf-8") as f:
        return json.load(f)


def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = s.lower().replace("&", " and ").replace("'", "").replace("’", "")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def title(s):
    small = {"of", "and", "the", "a", "an", "in", "on", "by", "to", "for", "with"}
    words = s.lower().split()
    out = []
    for i, w in enumerate(words):
        out.append(w if (i and w in small) else w[:1].upper() + w[1:])
    return " ".join(out)


MARKS = re.compile(r"^([*†ª]+)|([*†ª]+)$")


def parse_label(label):
    """'*Decan House (10d10)' -> base, qty, marks, author, bracket."""
    raw = label
    marks = "".join(m for m in re.findall(r"[*†ª]+", label))
    label = re.sub(r"[*†ª]+", "", label).strip()
    author = None
    m = re.search(r"\s+by\s+(.+)$", label)
    if m and not label.lower().startswith("by "):
        author, label = m.group(1).strip(), label[: m.start()].strip()
    bracket = None
    m = re.search(r"\s*\[([^\]]+)\]\s*$", label)
    if m:
        bracket, label = m.group(1), label[: m.start()].strip()
    qty = None
    m = re.search(r"\s*\(([^()]*\d[^()]*)\)\s*$", label)
    if m:
        qty, label = m.group(1), label[: m.start()].strip()
    m = re.match(r"^(\d+d\d+(?:[+-]\d+)?|\d+)\s+(.+)$", label)
    if m and not qty:
        qty, label = m.group(1), m.group(2)
    return {"raw": raw, "base": label, "qty": qty, "marks": marks or None,
            "author": author, "bracket": bracket}


def faces(results):
    return sorted(results.items(), key=lambda kv: int(kv[0]))


def collapse(table, extra_key=None):
    """Group consecutive faces with identical result+page+fx into ranges."""
    rows, cur = [], None
    fx = table.get("fx", {}) or {}
    rules = table.get("rules", {}) or {}
    for k, v in faces(table["results"]):
        n = int(k)
        sig = json.dumps([v, fx.get(k), rules.get(k)], sort_keys=True, ensure_ascii=False)
        if cur and cur["_sig"] == sig and cur["range"][1] == n - 1:
            cur["range"][1] = n
            continue
        cur = {"_sig": sig, "range": [n, n], "label": v["result"], "page": v.get("page"), "_face": k}
        rows.append(cur)
    for r in rows:
        r.pop("_sig")
    return rows


db = {}                    # collection -> {id: record}
refs_in = {}               # id -> list of where it appears


def put(coll, rec):
    db.setdefault(coll, {})
    if rec["id"] in db[coll]:
        return db[coll][rec["id"]]
    db[coll][rec["id"]] = rec
    return rec


def backref(eid, where):
    refs_in.setdefault(eid, [])
    if where not in refs_in[eid]:
        refs_in[eid].append(where)


# ---------- creatures (bestiary) ----------
best = load("bestiary.json")
creature_by_name = {}
STAT_KEYS = ["ST", "Role", "S&T", "AL", "Perception", "Speed", "Armor", "Savings",
             "Immunities", "Resistances", "Weaknesses", "L&Y", "Chamber", "Attacks", "Special"]
for it in best["items"]:
    cid = "creature:" + slug(it["name"])
    rec = put("creatures", {
        "id": cid, "type": "creature", "name": it["name"], "page": it.get("page"),
        "family": it.get("family"), "shared": it.get("shared"),
        "stats": {k: it[k] for k in STAT_KEYS if k in it},
    })
    for key in {it["name"].lower(), slug(it["name"])}:
        creature_by_name[key] = cid


def norm(s):
    words = []
    for w in slug(s).split("-"):
        if w.endswith("men"): w = w[:-3] + "man"
        elif w.endswith("ies") and len(w) > 4: w = w[:-3] + "y"
        elif w.endswith("s") and len(w) > 3 and not w.endswith("ss"): w = w[:-1]
        words.append(w)
    return " ".join(w for w in words if w and w not in ("the", "a", "an"))


ALIASES = {"ghaelee": "Ghaele", "zephyr": "The Ten Zephyr", "spiritual ooze": "Spirit Ooze",
           "maze imp": "Imp", "beast": "Beasts", "mikite": "Mikites",
           "hitmen": "Common Hitmen", "rookie mazeknight": "Mazeknight (Rookie)",
           "merchant raider": "Merchant", "black pawn": "Master Hitmen (Black Pawn)",
           "red pawn": "Mazeknight Captain (Red Pawn)"}
creature_keys = {}
for it in best["items"]:
    cid = "creature:" + slug(it["name"])
    n = it["name"]
    keys = {n, n.split(":")[0], re.sub(r"\s*\([^)]*\)", "", n)}
    keys |= set(re.findall(r"\(([^)]*)\)", n))
    keys |= {x for x in re.split(r"/|\s+or\s+", re.sub(r"\s*\([^)]*\)", "", n))}
    if ":" in n: keys.add(n.split(":")[1].split(",")[0])
    for k in keys:
        if k.strip(): creature_keys.setdefault(norm(k), cid)
for k, v in ALIASES.items():
    creature_keys[norm(k)] = "creature:" + slug(v)


def find_creatures(label):
    """All creatures named in a table label such as 'Red Pawn plus 1d6+1 Mazeknights'."""
    s = re.sub(r"[*†ª]+", "", label)
    out = []
    parts = re.split(r"\s+plus\s+|\s*&\s*|\s+\+|\s+and\s+|,", s)
    for part in parts:
        part = re.sub(r"^\s*(\d+d\d+(?:[+-]\d+)?|\d+)\s+", "", part).strip()
        part = re.sub(r"\(?\b(hostile|indifferent|helpful)\b\)?", "", part, flags=re.I).strip()
        cands = [part, re.sub(r"\s*\([^)]*\)?", "", part)] + re.findall(r"\(([^)]*)\)?", part)
        for c in cands:
            cid = creature_keys.get(norm(c))
            if cid:
                if cid not in out: out.append(cid)
                break
    return out


def find_creature(name):
    r = find_creatures(name)
    return r[0] if r else None


# ---------- materials / magic items ----------
for it in load("materials.json")["items"]:
    put("materials", {"id": "material:" + slug(it["name"]), "type": "material", "name": it["name"],
                      "page": it.get("page"), "kind": it.get("kind"),
                      "stats": {k: it[k] for k in ("HP", "Hardness", "Uses") if k in it},
                      **({"uses_es": it["Uses_es"]} if "Uses_es" in it else {})})
for it in load("magic.json")["items"]:
    stats = {k: (it[k].lstrip(": ") if isinstance(it[k], str) else it[k])
             for k in ("element", "Category", "Rarity") if k in it}
    put("items", {"id": "item:" + slug(it["name"]), "type": "item", "name": it["name"],
                  "page": it.get("page"), "kind": it.get("kind"), "stats": stats})


# ---------- tables ----------
TABLE_FILES = sorted(glob.glob(os.path.join(SRC, "table-*.json")))
TABLE_ORDER = ["A", "B", "C", "D"]


tables = []
for path in TABLE_FILES:
    fname = os.path.basename(path)[:-5]          # table-3-2-spark
    t = load(os.path.basename(path))
    code = fname[len("table-"):].upper().replace("-", ".")   # A, 3.2.SPARK
    code = code.replace(".SPARK", " Sparkmist").replace(".WALL", " Mistwalls")
    name = str(t["table"])
    tid = "table:" + fname[len("table-"):]
    trec = {
        "id": tid, "type": "table", "code": code, "name": name,
        "roll": t.get("roll"), "die": t.get("die"), "page": t.get("page"),
        "source_file": "data/" + fname + ".json",
        "note": t.get("note"), "footnotes": t.get("footnotes"), "rows": [],
    }
    special = t.get("special", {}) or {}
    for r in collapse(t):
        face = r.pop("_face")
        p = parse_label(r["label"])
        row = {"range": r["range"], "label": r["label"], "page": r["page"]}
        if p["qty"]: row["qty"] = p["qty"]
        if p["marks"]: row["marks"] = p["marks"]
        if t.get("fx", {}).get(face): row["fx"] = t["fx"][face]
        if r["label"] in special: row["note"] = special[r["label"]]
        elif p["base"] in special: row["note"] = special[p["base"]]
        trec["rows"].append(row)
    if "weapons" in t: trec["weapons"] = t["weapons"]
    if "materials" in t: trec["weapon_materials"] = t["materials"]
    tables.append((fname, t, trec))


# ---------- Table A -> chambers ----------
for fname, t, trec in tables:
    if fname != "table-a":
        continue
    rules = t["rules"]
    for row in trec["rows"]:
        face = str(row["range"][0])
        rule = rules.get(face, {})
        p = parse_label(row["label"])
        canon = rule.get("chamber") or p["base"].upper()
        canon = re.sub(r"\s*\(BY [^)]*\)\s*$", "", canon)
        cname = title(canon)
        cid = "chamber:" + slug(cname)
        ch = put("chambers", {"id": cid, "type": "chamber", "name": cname, "page": rule.get("page", row["page"]),
                              "aliases": [], "author": p["author"], "variants": []})
        if p["base"] != cname and p["base"] not in ch["aliases"]:
            ch["aliases"].append(p["base"])
        variant = {"faces": row["range"], "label": row["label"]}
        for k in ("timerDice", "timerDefaulted", "entries", "excludes", "excludeCodes", "skip", "skipNote",
                  "fixedCondition", "reroll", "check", "circle", "extras", "note"):
            if k in rule and rule[k] not in ([], None):
                variant[k] = rule[k]
        if p["bracket"]: variant["variant_note"] = p["bracket"]
        ch["variants"].append(variant)
        row["refs"] = [cid]
        backref(cid, {"table": trec["id"], "range": row["range"]})
        # link creatures named in extras
        for ex in rule.get("extras", []):
            if ex.get("kind") == "inhabitant":
                en = (ex.get("of") or {}).get("en", "")
                cr = find_creature(en.split(";")[0].split(",")[0].split(" per ")[0].split(" OR ")[0].strip())
                if cr:
                    ex = dict(ex)
                    ch.setdefault("creatures", [])
                    if cr not in ch["creatures"]:
                        ch["creatures"].append(cr)
                    backref(cr, {"chamber": cid})


# ---------- Table B -> conditions ----------
for fname, t, trec in tables:
    if fname != "table-b":
        continue
    for row in trec["rows"]:
        p = parse_label(row["label"])
        cid = "condition:" + slug(p["base"])
        rec = put("conditions", {"id": cid, "type": "condition", "name": p["base"], "page": row["page"],
                                 "faces": [], "effect": row.get("fx")})
        rec["faces"].append(row["range"])
        row["refs"] = [cid]
        backref(cid, {"table": trec["id"], "range": row["range"]})

# ---------- Table D / 3.x -> creatures ----------
for fname, t, trec in tables:
    if fname not in ("table-d", "table-3-5", "table-3-6"):
        continue
    for row in trec["rows"]:
        p = parse_label(row["label"])
        found = find_creatures(row["label"])
        if found:
            row["refs"] = found
            for c in found:
                backref(c, {"table": trec["id"], "range": row["range"]})

# ---------- links to other tables mentioned in rows/notes ----------
TABLE_IDS = {trec["code"].split(" ")[0].lower(): trec["id"] for _, _, trec in tables}
for _, _, trec in tables:
    for row in trec["rows"]:
        blob = json.dumps(row.get("fx", "")) + json.dumps(row.get("note", ""))
        for m in re.findall(r"[Tt]able\s+(\d\.\d+|[A-D])\b", blob):
            tid = TABLE_IDS.get(m.lower())
            if tid and tid != trec["id"]:
                row.setdefault("see", [])
                if tid not in row["see"]:
                    row["see"].append(tid)

# ---------- rules ----------
rolls = load("rolls.json")
seven = []
for i, (k, v) in enumerate(rolls["rolls"].items(), 1):
    rec = {"id": "rule:roll-" + slug(k), "type": "rule", "group": "seven-rolls", "order": i,
           "name": title(k) + " roll", "die": v.get("die"), "page": v.get("appendix_page")}
    if v.get("table"):
        rec["table"] = "table:" + v["table"].lower()
    if v.get("note"):
        rec["note"] = v["note"] if isinstance(v["note"], dict) else {"en": v["note"]}
    put("rules", rec)
for k, v in rolls["timerRules"].items():
    rec = {"id": "rule:timer-" + slug(re.sub(r"([A-Z])", r" \1", k)), "type": "rule", "group": "timer",
           "name": "Timer · " + re.sub(r"([A-Z])", r" \1", k).lower(), "page": v.get("page"),
           "note": v.get("note")}
    for kk in ("dice", "multiplier", "formula"):
        if kk in v: rec[kk] = v[kk]
    put("rules", rec)

# ---------- finalize ----------
for coll in db.values():
    for eid, rec in coll.items():
        if eid in refs_in:
            rec["appears_in"] = refs_in[eid]

db["tables"] = {trec["id"]: trec for _, _, trec in tables}


def order_tables(rec):
    c = rec["code"]
    if c[0] in "ABCD": return (0, c)
    nums = re.findall(r"\d+", c)
    return (1, int(nums[0]), int(nums[1]) if len(nums) > 1 else 0, c)


collections = {
    "tables": sorted(db["tables"].values(), key=order_tables),
    "chambers": sorted(db["chambers"].values(), key=lambda r: r["variants"][0]["faces"][0]),
    "conditions": sorted(db["conditions"].values(), key=lambda r: r["faces"][0][0]),
    "creatures": sorted(db["creatures"].values(), key=lambda r: r["name"].lower()),
    "items": sorted(db["items"].values(), key=lambda r: r["name"].lower()),
    "materials": sorted(db["materials"].values(), key=lambda r: r["name"].lower()),
    "rules": sorted(db["rules"].values(), key=lambda r: (r["group"], r.get("order", 0))),
}

# ---------- search index ----------
def text_of(x):
    if isinstance(x, dict): return " ".join(text_of(v) for v in x.values())
    if isinstance(x, list): return " ".join(text_of(v) for v in x)
    return "" if x is None else str(x)


search = []
for cname, recs in collections.items():
    for r in recs:
        search.append({"id": r["id"], "type": r["type"], "name": r.get("name"),
                       "code": r.get("code"), "page": r.get("page"),
                       "aliases": r.get("aliases") or [],
                       "text": re.sub(r"\s+", " ", text_of({k: v for k, v in r.items()
                                                             if k not in ("id", "appears_in", "excludeCodes")})).lower()})
    if cname == "tables":
        for r in recs:
            for row in r["rows"]:
                lo, hi = row["range"]
                search.append({"id": f'{r["id"]}#{lo}', "type": "row", "name": row["label"],
                               "code": r["code"], "page": row.get("page"), "parent": r["id"],
                               "range": row["range"], "refs": row.get("refs"),
                               "text": re.sub(r"\s+", " ", text_of(row)).lower()})

manifest = {
    "name": "Black Stone · The Maze database",
    "source": "The Maze, M. A. Bastarrachea Magnani (Axo stories). Built from web/data; do not edit by hand.",
    "schema_version": 1,
    "generated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
    "conventions": {
        "id": "'<type>:<slug>' — stable, lowercase, ascii. Tables use their number: table:a, table:3-1.",
        "page": "printed page of the rulebook (same as PDF page); null = no dedicated description",
        "range": "[low, high] die faces, inclusive; d% 00 = 100",
        "refs": "a row's refs point to the entity it produces (chamber, condition, creature)",
        "appears_in": "back-links: which table rows / chambers mention this entity",
        "text": "{en, es}: English is the book text; Spanish is a helper translation",
    },
    "collections": {k: {"file": k + ".json", "count": len(v)} for k, v in collections.items()},
    "search": {"file": "search.json", "count": len(search)},
}

for k, v in collections.items():
    with open(os.path.join(OUT, k + ".json"), "w", encoding="utf-8") as f:
        json.dump(v, f, ensure_ascii=False, indent=1)
with open(os.path.join(OUT, "search.json"), "w", encoding="utf-8") as f:
    json.dump(search, f, ensure_ascii=False, separators=(",", ":"))
with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
    json.dump(manifest, f, ensure_ascii=False, indent=1)

print(json.dumps(manifest["collections"], indent=1), "search", len(search))
