// Firestore rules tests. Run against the emulator (needs Java):
//   npm i -D @firebase/rules-unit-testing firebase-tools
//   npm run test:rules
// NOTE: written together with the rules but NOT executed in the environment that produced them
// (no emulator was available there). Treat a first run as the real verification.
import { readFileSync } from "node:fs";
import { test, before, after, beforeEach } from "node:test";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, getDocs, deleteDoc, updateDoc, writeBatch, serverTimestamp, collection, query, where } from "firebase/firestore";

let env;
before(async () => { env = await initializeTestEnvironment({ projectId: "unsaid-rules-test", firestore: { rules: readFileSync("firestore.rules", "utf8") } }); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const as = (uid) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const R = (u = 0, a = 0, f = 0) => ({ understand: u, alone: a, feel: f });
const ts = serverTimestamp;
const seedAdmin = (fn) => env.withSecurityRulesDisabled(async (ctx) => fn(ctx.firestore()));

const letter = (o = {}) => ({ title: "Dear friend", body: "x".repeat(40), category: "Someone I Miss", authorLabel: "Anonymous #1234", comments: 0, reactions: R(), createdAt: ts(), ...o });
async function createLetter(db, uid, id = "L1", o = {}) {
  const b = writeBatch(db);
  b.set(doc(db, "letters", id), letter(o));
  b.set(doc(db, "postOwners", id), { uid, kind: "letter", createdAt: ts() });
  return b.commit();
}

test("letters: signed in + matching postOwners record required; validation; no extra fields", async () => {
  await assertSucceeds(createLetter(as("alice"), "alice"));
  await assertFails(createLetter(anon(), "alice", "L2"));
  await assertFails(setDoc(doc(as("alice"), "letters", "L3"), letter()));              // no owner record
  await assertFails(createLetter(as("alice"), "bob", "L4"));                           // owner record names someone else
  await assertFails(createLetter(as("a"), "a", "X1", { body: "short" }));
  await assertFails(createLetter(as("a"), "a", "X2", { body: "x".repeat(5001) }));
  await assertFails(createLetter(as("a"), "a", "X3", { category: "Nope" }));
  await assertFails(createLetter(as("a"), "a", "X4", { uid: "a" }));                   // uid must never be public
  await assertFails(createLetter(as("a"), "a", "X5", { authorLabel: "Real Name" }));
});
test("letters: public read; only the owner deletes", async () => {
  await createLetter(as("alice"), "alice");
  await assertSucceeds(getDoc(doc(anon(), "letters", "L1")));
  const del = (db) => { const b = writeBatch(db); b.delete(doc(db, "letters", "L1")); b.delete(doc(db, "postOwners", "L1")); return b.commit(); };
  await assertFails(del(as("mallory")));
  await assertSucceeds(del(as("alice")));
});
test("counters: bounded changes only; content edits by others rejected", async () => {
  await createLetter(as("alice"), "alice");
  const ref = (db) => doc(db, "letters", "L1");
  await assertSucceeds(updateDoc(ref(as("bob")), { reactions: R(1, 0, 0) }));          // add one
  await assertSucceeds(updateDoc(ref(as("bob")), { reactions: R(0, 1, 0) }));          // switch
  await assertFails(updateDoc(ref(as("bob")), { reactions: R(5, 0, 0) }));             // inflation
  await assertFails(updateDoc(ref(as("bob")), { reactions: { ...R(1), extra: 1 } }));  // extra key
  await assertSucceeds(updateDoc(ref(as("bob")), { comments: 1 }));
  await assertFails(updateDoc(ref(as("bob")), { comments: 9 }));
  await assertFails(updateDoc(ref(as("bob")), { body: "y".repeat(40) }));
  await assertFails(updateDoc(ref(anon()), { comments: 1 }));
});
test("reactions: document id must be the caller's uid", async () => {
  await createLetter(as("alice"), "alice");
  const r = (db, uid) => doc(db, "letters", "L1", "reactions", uid);
  await assertSucceeds(setDoc(r(as("bob"), "bob"), { type: "alone", createdAt: ts(), updatedAt: ts() }));
  await assertFails(setDoc(r(as("bob"), "alice"), { type: "alone", createdAt: ts(), updatedAt: ts() }));
  await assertFails(setDoc(r(as("bob"), "bob"), { type: "love", createdAt: ts(), updatedAt: ts() }));
});
test("comments: author uid enforced, one reply level, author-only delete", async () => {
  await createLetter(as("alice"), "alice");
  const c = (db, id) => doc(db, "letters", "L1", "comments", id);
  const body = (uid, parentId = null) => ({ postId: "L1", uid, authorLabel: "Anonymous #4321", text: "hi", createdAt: ts(), parentId });
  await assertSucceeds(setDoc(c(as("bob"), "C1"), body("bob")));
  await assertFails(setDoc(c(as("bob"), "C2"), body("alice")));                        // impersonation
  await assertSucceeds(setDoc(c(as("alice"), "C3"), body("alice", "C1")));             // reply
  await assertFails(setDoc(c(as("alice"), "C4"), body("alice", "C3")));                // reply to a reply
  await assertFails(deleteDoc(c(as("alice"), "C1")));
  await assertSucceeds(deleteDoc(c(as("bob"), "C1")));
});
test("bookmarks: private, key is the stored postId", async () => {
  const bm = (db, uid, key) => doc(db, "users", uid, "bookmarks", key);
  await assertSucceeds(setDoc(bm(as("a"), "a", "letter_L1"), { postId: "letter_L1", createdAt: ts() }));
  await assertFails(setDoc(bm(as("a"), "a", "letter_L2"), { postId: "other", createdAt: ts() }));
  await assertFails(getDoc(bm(as("b"), "a", "letter_L1")));
  await assertSucceeds(getDoc(bm(as("a"), "a", "letter_L1")));
});
test("questions + answers: owner-only edit/delete; anyone can answer", async () => {
  const a = as("alice"); const b = writeBatch(a);
  b.set(doc(a, "questions", "Q1"), { title: "How do I start over?", details: "", category: "Life Advice", authorLabel: "Anonymous #1111", answerCount: 0, edited: false, createdAt: ts() });
  b.set(doc(a, "postOwners", "Q1"), { uid: "alice", kind: "question", createdAt: ts() });
  await assertSucceeds(b.commit());
  await assertSucceeds(updateDoc(doc(a, "questions", "Q1"), { title: "How do I start over again?", edited: true, updatedAt: ts() }));
  await assertFails(updateDoc(doc(as("bob"), "questions", "Q1"), { title: "Hijacked title here", edited: true, updatedAt: ts() }));
  const bob = as("bob"); const ab = writeBatch(bob);
  ab.set(doc(bob, "questions", "Q1", "answers", "A1"), { text: "Take it slowly.", authorLabel: "Anonymous #2222", reactions: R(), comments: 0, createdAt: ts() });
  ab.set(doc(bob, "postOwners", "A1"), { uid: "bob", kind: "answer", createdAt: ts() });
  ab.update(doc(bob, "questions", "Q1"), { answerCount: 1 });
  await assertSucceeds(ab.commit());
  await assertFails(deleteDoc(doc(as("alice"), "questions", "Q1", "answers", "A1")));
});
test("midnight thoughts: short text, valid mood", async () => {
  const db = as("a");
  const make = (id, o) => { const b = writeBatch(db); b.set(doc(db, "midnightThoughts", id), { text: "Tonight feels very quiet.", mood: "Calm", category: "Reflection", authorLabel: "Anonymous #5555", comments: 0, reactions: R(), createdAt: ts(), ...o }); b.set(doc(db, "postOwners", id), { uid: "a", kind: "thought", createdAt: ts() }); return b.commit(); };
  await assertSucceeds(make("T1", {}));
  await assertFails(make("T2", { text: "x".repeat(281) }));
  await assertFails(make("T3", { mood: "Furious" }));
});
test("daily: prompts read-only; one response per session per prompt; marker private", async () => {
  await seedAdmin((db) => setDoc(doc(db, "dailyPrompts", "2026-11-21"), { date: "2026-11-21", text: "Q?" }));
  await assertSucceeds(getDoc(doc(anon(), "dailyPrompts", "2026-11-21")));
  await assertFails(setDoc(doc(as("a"), "dailyPrompts", "2026-11-22"), { date: "2026-11-22", text: "Hack" }));
  const respond = (db, uid, id) => { const b = writeBatch(db); b.set(doc(db, "dailyResponses", id), { promptId: "2026-11-21", text: "My answer", authorLabel: "Anonymous #7777", reactions: R(), comments: 0, createdAt: ts() }); b.set(doc(db, "dailyMarkers", `2026-11-21_${uid}`), { promptId: "2026-11-21", responseId: id, createdAt: ts() }); return b.commit(); };
  await assertSucceeds(respond(as("alice"), "alice", "R1"));
  await assertFails(respond(as("alice"), "alice", "R2"));                              // duplicate
  await assertSucceeds(respond(as("bob"), "bob", "R3"));
  await assertSucceeds(getDoc(doc(as("alice"), "dailyMarkers", "2026-11-21_alice")));
  await assertFails(getDoc(doc(as("bob"), "dailyMarkers", "2026-11-21_alice")));
  const del = (db, uid, id) => { const b = writeBatch(db); b.delete(doc(db, "dailyResponses", id)); b.delete(doc(db, "dailyMarkers", `2026-11-21_${uid}`)); return b.commit(); };
  await assertFails(del(as("bob"), "bob", "R1"));
  await assertSucceeds(del(as("alice"), "alice", "R1"));
});
test("clock: own doc, server time only", async () => {
  await assertSucceeds(setDoc(doc(as("a"), "clock", "a"), { t: ts() }));
  await assertFails(setDoc(doc(as("a"), "clock", "a"), { t: new Date("2000-01-01") }));
  await assertFails(setDoc(doc(as("a"), "clock", "b"), { t: ts() }));
});
test("journal: owner only, strict fields, nothing public or cross-user", async () => {
  const entry = (o = {}) => ({ title: "t", body: "private words", mood: "Calm", createdAt: ts(), updatedAt: ts(), ...o });
  await assertSucceeds(setDoc(doc(as("alice"), "journals", "alice", "entries", "E1"), entry()));
  await assertFails(setDoc(doc(as("alice"), "journals", "bob", "entries", "E2"), entry()));
  await assertFails(setDoc(doc(as("alice"), "journals", "alice", "entries", "E3"), entry({ extra: 1 })));
  await assertFails(setDoc(doc(as("alice"), "journals", "alice", "entries", "E4"), entry({ body: "" })));
  await assertSucceeds(getDoc(doc(as("alice"), "journals", "alice", "entries", "E1")));
  await assertFails(getDoc(doc(as("bob"), "journals", "alice", "entries", "E1")));
  await assertFails(getDoc(doc(anon(), "journals", "alice", "entries", "E1")));
  await assertFails(getDocs(collection(as("bob"), "journals", "alice", "entries")));
  await assertFails(deleteDoc(doc(as("bob"), "journals", "alice", "entries", "E1")));
  await assertSucceeds(deleteDoc(doc(as("alice"), "journals", "alice", "entries", "E1")));
});
test("phase 2 posts still work: create with owner record, counters, owner edit; unknown collections denied", async () => {
  const db = as("alice"); const b = writeBatch(db);
  b.set(doc(db, "posts", "P1"), { text: "A phase two post is fine.", category: "Thoughts", tags: [], authorLabel: "Anonymous #9999", comments: 0, reactions: R(), createdAt: ts(), edited: false });
  b.set(doc(db, "postOwners", "P1"), { uid: "alice", createdAt: ts() });                 // no `kind`: unchanged Phase 2 shape
  await assertSucceeds(b.commit());
  await assertSucceeds(updateDoc(doc(as("bob"), "posts", "P1"), { reactions: R(1) }));    // non-owner counter (Phase 2 transaction)
  await assertSucceeds(updateDoc(doc(db, "posts", "P1"), { text: "Edited by the owner, still valid.", edited: true, updatedAt: ts() }));
  await assertFails(updateDoc(doc(as("bob"), "posts", "P1"), { text: "Edited by a stranger, not valid." }));
  await assertFails(setDoc(doc(as("a"), "surprise", "x"), { a: 1 }));
});

// ============================================================ PHASE 4 (accounts). Not executed in the authoring environment.
const profile = (o = {}) => ({ createdAt: ts(), updatedAt: ts(), accountType: "anonymous", displayName: "", preferences: { theme: "system", defaultSort: "Latest", defaultCategory: "All" }, linkedProviders: [], ...o });

test("users/{uid}: owner creates a valid profile; nobody else can read or write it", async () => {
  await assertSucceeds(setDoc(doc(as("alice"), "users", "alice"), profile()));
  await assertSucceeds(getDoc(doc(as("alice"), "users", "alice")));
  await assertFails(getDoc(doc(as("bob"), "users", "alice")));
  await assertFails(getDoc(doc(anon(), "users", "alice")));
  await assertFails(setDoc(doc(as("bob"), "users", "alice"), profile()));
  await assertFails(deleteDoc(doc(as("bob"), "users", "alice")));
  await assertSucceeds(deleteDoc(doc(as("alice"), "users", "alice")));
});
test("users/{uid}: shape is strict (no email, no extra keys, bounded name, valid enums)", async () => {
  const create = (o) => setDoc(doc(as("alice"), "users", "alice"), profile(o));
  await assertFails(create({ email: "a@b.co" }));
  await assertFails(create({ accountType: "admin" }));
  await assertFails(create({ displayName: "x".repeat(31) }));
  await assertFails(create({ preferences: { theme: "neon", defaultSort: "Latest", defaultCategory: "All" } }));
  await assertFails(create({ preferences: { theme: "dark", defaultSort: "Latest", defaultCategory: "All", extra: 1 } }));
  await assertFails(create({ linkedProviders: ["facebook.com"] }));
  await assertFails(create({ createdAt: new Date() }));            // must be the server time
  await assertSucceeds(create({ accountType: "registered", linkedProviders: ["password", "google.com"], displayName: "Night owl" }));
});
test("users/{uid}: createdAt cannot be changed; bookmarks stay private", async () => {
  await assertSucceeds(setDoc(doc(as("alice"), "users", "alice"), profile()));
  const upd = (o) => updateDoc(doc(as("alice"), "users", "alice"), { updatedAt: ts(), ...o });
  await assertSucceeds(upd({ displayName: "New name" }));
  await assertFails(upd({ createdAt: new Date("2020-01-01") }));
  await assertFails(upd({ password: "x" }));
  await assertSucceeds(setDoc(doc(as("alice"), "users", "alice", "bookmarks", "p1"), { postId: "p1", createdAt: ts() }));
  await assertFails(getDoc(doc(as("bob"), "users", "alice", "bookmarks", "p1")));
});
test("postOwners: optional parent only for answers, bounded; owners list only their own records", async () => {
  const own = (db, id, o) => setDoc(doc(db, "postOwners", id), { uid: "alice", createdAt: ts(), ...o });
  await assertSucceeds(own(as("alice"), "A1", { kind: "answer", parent: "Q1" }));
  await assertFails(own(as("alice"), "A2", { kind: "letter", parent: "Q1" }));
  await assertFails(own(as("alice"), "A3", { parent: "Q1" }));
  await assertFails(own(as("alice"), "A4", { kind: "answer", parent: "" }));
  await assertFails(own(as("alice"), "A5", { kind: "answer", parent: "x".repeat(129) }));
  await assertFails(own(as("alice"), "A6", { kind: "answer", parent: "Q1", extra: 1 }));
  await assertSucceeds(getDocs(query(collection(as("alice"), "postOwners"), where("uid", "==", "alice"))));
  await assertFails(getDocs(query(collection(as("bob"), "postOwners"), where("uid", "==", "alice"))));
  await assertFails(getDocs(collection(as("bob"), "postOwners")));
});
test("letters: the owner may edit; others and out-of-bounds edits are rejected", async () => {
  await createLetter(as("alice"), "alice");
  const edit = (db, o) => updateDoc(doc(db, "letters", "L1"), { title: "Dear me", body: "y".repeat(40), category: "To My Past Self", edited: true, updatedAt: ts(), ...o });
  await assertSucceeds(edit(as("alice")));
  await assertFails(edit(as("bob")));
  await assertFails(edit(as("alice"), { edited: false }));
  await assertFails(edit(as("alice"), { body: "short" }));
  await assertFails(edit(as("alice"), { category: "Nope" }));
  await assertFails(edit(as("alice"), { authorLabel: "Anonymous #9999" }));
  await assertFails(edit(as("alice"), { createdAt: new Date() }));
  await assertSucceeds(updateDoc(doc(as("bob"), "letters", "L1"), { comments: 1 }));  // counters unchanged for everyone
});
test("clock: only the owner may delete their record (account deletion); journals never cross users", async () => {
  await assertSucceeds(setDoc(doc(as("alice"), "clock", "alice"), { t: ts() }));
  await assertFails(deleteDoc(doc(as("bob"), "clock", "alice")));
  await assertSucceeds(deleteDoc(doc(as("alice"), "clock", "alice")));
  await assertSucceeds(setDoc(doc(as("alice"), "journals", "alice", "entries", "e1"), { title: "", body: "private", mood: "", createdAt: ts(), updatedAt: ts() }));
  await assertFails(getDocs(collection(as("bob"), "journals", "alice", "entries")));
  await assertFails(getDocs(collection(anon(), "journals", "alice", "entries")));
});
