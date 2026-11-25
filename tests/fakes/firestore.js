// In-memory (optionally localStorage-backed) stand-in for firebase/firestore. TEST ONLY. It does NOT enforce
// security rules or index requirements; it exists to exercise application logic.
const LS = typeof localStorage !== "undefined" ? localStorage : null;
let mem = { docs: {} };
const load = () => { if (!LS) return mem; try { return JSON.parse(LS.getItem("fakeDB") || '{"docs":{}}'); } catch { return { docs: {} }; } };
const save = (s) => { if (LS) LS.setItem("fakeDB", JSON.stringify(s)); else mem = s; };
export const __reset = () => { mem = { docs: {} }; if (LS) LS.removeItem("fakeDB"); };
export const __dump = () => load().docs;
export const __failNext = (match) => { globalThis.__failMatch = match; };

class Timestamp { constructor(ms) { this.ms = ms; } toMillis() { return this.ms; } toDate() { return new Date(this.ms); } }
const enc = (v) => (v instanceof Timestamp ? { __ts: v.ms } : Array.isArray(v) ? v.map(enc) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v);
const dec = (v) => (v && v.__ts !== undefined ? new Timestamp(v.__ts) : Array.isArray(v) ? v.map(dec) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, dec(x)])) : v);
const SERVER = { __sentinel: "serverTimestamp" };
export const serverTimestamp = () => SERVER;
export const increment = (n) => ({ __sentinel: "increment", n });
export const documentId = () => ({ __docId: true });
export { Timestamp };
const resolve = (v, prev) => (v && v.__sentinel === "serverTimestamp" ? new Timestamp(Date.now()) : v && v.__sentinel === "increment" ? (prev || 0) + v.n : Array.isArray(v) ? v.map((x) => resolve(x)) : v && typeof v === "object" && !(v instanceof Timestamp) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x, prev?.[k])])) : v);
const applyData = (base, data, merge) => { const out = merge ? { ...base } : {}; for (const [k, v] of Object.entries(data)) { if (merge && k.includes(".")) { const [a, b] = k.split("."); out[a] = { ...(out[a] || {}), [b]: resolve(v, base?.[a]?.[b]) }; } else out[k] = resolve(v, base?.[k]); } return out; };

let idn = 0; const autoId = () => `auto${Date.now().toString(36)}${(idn++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const getFirestore = () => ({ __db: true });
export const collection = (parent, ...segs) => ({ type: "collection", path: [...(parent.type === "doc" ? parent.path : []), ...segs].join("/"), get id() { return this.path.split("/").pop(); } });
export const doc = (parent, ...segs) => {
  if (parent.type === "collection" && segs.length === 0) return docRef(`${parent.path}/${autoId()}`);
  const base = parent.type === "collection" ? [parent.path] : parent.type === "doc" ? [parent.path] : [];
  return docRef([...base, ...segs].join("/"));
};
const docRef = (path) => ({ type: "doc", path, get id() { return path.split("/").pop(); }, get parent() { const p = path.split("/").slice(0, -1).join("/"); return { type: "collection", path: p, get parent() { const pp = p.split("/").slice(0, -1).join("/"); return pp ? docRef(pp) : null; } }; } });
const snapOf = (path, data) => ({ id: path.split("/").pop(), ref: docRef(path), exists: () => data !== undefined, data: () => (data === undefined ? undefined : dec(JSON.parse(JSON.stringify(data)))), __raw: data });

const check = (what) => { if (globalThis.__failMatch && what.includes(globalThis.__failMatch)) { globalThis.__failMatch = null; const e = new Error("simulated failure"); e.code = "unavailable"; throw e; } };
export const getDoc = async (ref) => { check(`get:${ref.path}`); return snapOf(ref.path, load().docs[ref.path]); };
export const getDocFromServer = getDoc;
export const where = (field, op, value) => ({ t: "where", field, op, value });
export const orderBy = (field, dir = "asc") => ({ t: "order", field, dir });
export const limit = (n) => ({ t: "limit", n });
export const startAfter = (snap) => ({ t: "after", snap });
export const query = (src, ...cons) => ({ type: "query", src, cons });

const val = (data, field) => { const v = data[field]; return v && v.__ts !== undefined ? v.__ts : v; };
function run(q, { countOnly = false } = {}) {
  const src = q.type === "query" ? q.src : q; const cons = q.type === "query" ? q.cons : [];
  const all = load().docs; const depth = src.path.split("/").length + 1;
  let rows = Object.entries(all).filter(([p]) => p.startsWith(`${src.path}/`) && p.split("/").length === depth).map(([p, d]) => ({ p, d, id: p.split("/").pop() }));
  for (const c of cons.filter((x) => x.t === "where")) rows = rows.filter(({ d, id }) => {
    const a = c.field && c.field.__docId ? id : val(d, c.field); if (a === undefined) return false;
    if (c.op === "==") return a === c.value; if (c.op === "in") return c.value.includes(a);
    if (c.op === "<=") return a <= c.value; if (c.op === "<") return a < c.value; if (c.op === ">=") return a >= c.value; return false;
  });
  const orders = cons.filter((x) => x.t === "order");
  if (orders.length) rows = rows.filter(({ d }) => orders.every((o) => val(d, o.field) !== undefined));
  const cmp = (A, B) => { for (const o of orders) { const a = val(A.d, o.field), b = val(B.d, o.field); if (a !== b) return (a < b ? -1 : 1) * (o.dir === "desc" ? -1 : 1); } return A.id < B.id ? -1 : 1; };
  rows.sort(orders.length ? cmp : (a, b) => (a.id < b.id ? -1 : 1));
  const after = cons.find((x) => x.t === "after");
  if (after) { const i = rows.findIndex((r) => r.p === after.snap.ref.path); rows = rows.slice(i + 1); }
  if (countOnly) return rows.length;
  const lim = cons.find((x) => x.t === "limit"); if (lim) rows = rows.slice(0, lim.n);
  return rows.map(({ p, d }) => snapOf(p, d));
}
export const getDocs = async (q) => { check(`query:${(q.src || q).path}`); const docs = run(q); return { docs, size: docs.length, empty: !docs.length, forEach: (f) => docs.forEach(f) }; };
export const getCountFromServer = async (q) => ({ data: () => ({ count: run(q, { countOnly: true }) }) });

const listeners = new Set(); const fire = () => listeners.forEach((f) => f());
export const onSnapshot = (target, cb, errCb) => {
  const emit = () => { try { if (target.type === "doc") cb(snapOf(target.path, load().docs[target.path])); else { const docs = run(target); cb({ docs, size: docs.length, empty: !docs.length, forEach: (f) => docs.forEach(f) }); } } catch (e) { errCb?.(e); } };
  setTimeout(emit, 0); listeners.add(emit); return () => listeners.delete(emit);
};
if (typeof window !== "undefined") window.addEventListener("storage", (e) => { if (e.key === "fakeDB") fire(); });

function commitOps(ops) {
  check(`write:${ops.map((o) => o.path).join(",")}`);
  const s = load(); const next = { docs: { ...s.docs } };
  for (const o of ops) {
    const cur = next.docs[o.path];
    if (o.op === "delete") delete next.docs[o.path];
    else if (o.op === "set") next.docs[o.path] = enc(applyData({}, o.data, false));
    else if (o.op === "update") { if (cur === undefined) { const e = new Error(`NOT_FOUND ${o.path}`); e.code = "not-found"; throw e; } next.docs[o.path] = enc(applyData(dec(cur), o.data, true)); }
  }
  save(next); fire();
}
export const setDoc = async (ref, data) => commitOps([{ op: "set", path: ref.path, data }]);
export const updateDoc = async (ref, data) => commitOps([{ op: "update", path: ref.path, data }]);
export const deleteDoc = async (ref) => commitOps([{ op: "delete", path: ref.path }]);
export const addDoc = async (col, data) => { const r = doc(col); await setDoc(r, data); return r; };
export const writeBatch = () => { const ops = []; return { set: (r, d) => ops.push({ op: "set", path: r.path, data: d }), update: (r, d) => ops.push({ op: "update", path: r.path, data: d }), delete: (r) => ops.push({ op: "delete", path: r.path }), commit: async () => commitOps(ops) }; };
export const runTransaction = async (_db, fn) => {
  const ops = []; const tx = { get: async (r) => getDoc(r), set: (r, d) => ops.push({ op: "set", path: r.path, data: d }), update: (r, d) => ops.push({ op: "update", path: r.path, data: d }), delete: (r) => ops.push({ op: "delete", path: r.path }) };
  const out = await fn(tx); commitOps(ops); return out;
};
