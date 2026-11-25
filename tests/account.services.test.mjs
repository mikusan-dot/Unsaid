// Application-logic tests for Phase 4 against in-memory stand-ins for Firebase Auth/Firestore.
// They do NOT verify Firebase's real backend, security rules or index requirements (see tests/firestore.rules.test.mjs
// and the manual checklist in the README). Run: npm run test:services
import { test, beforeEach, before } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

let M;
before(async () => {
  const out = resolve("tests/.build/services.mjs");
  const env = { VITE_FIREBASE_API_KEY: "k", VITE_FIREBASE_AUTH_DOMAIN: "d", VITE_FIREBASE_PROJECT_ID: "p", VITE_FIREBASE_APP_ID: "a", VITE_FIREBASE_MESSAGING_SENDER_ID: "m", VITE_ENABLE_GOOGLE_SIGNIN: "true" };
  await build({ entryPoints: ["tests/account.entry.js"], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error",
    alias: { "firebase/firestore": resolve("tests/fakes/firestore.js"), "firebase/auth": resolve("tests/fakes/auth.js"), "firebase/app": resolve("tests/fakes/app.js") },
    define: Object.fromEntries(Object.entries(env).map(([k, v]) => [`import.meta.env.${k}`, JSON.stringify(v)])) });
  M = await import(pathToFileURL(out).href);
});
beforeEach(async () => { M.fsFake.__reset(); M.authFake.__reset(); await M.account.signOutNow(); globalThis.__fakeGoogle = { email: "me@example.com" }; });

const anon = async () => (await M.ensureAnonymousSession());
const uidNow = () => M.auth.currentUser?.uid;
async function seed(u) {
  const uid = u.uid;
  const mk = (path, kind, fields, extra) => M.content.createContent({ path, kind, uid, fields: { ...fields, reactions: { understand: 0, alone: 0, feel: 0 }, comments: 0 }, ownerExtra: extra });
  const out = {};
  out.post = await M.posts.createPost({ uid, text: "a thought long enough", category: "Thoughts", tags: [], authorLabel: "Anonymous #1111" });
  out.letter = await mk(["letters"], "letter", { title: "Dear you", body: "x".repeat(40), category: "Someone I Miss" });
  out.question = await M.content.createContent({ path: ["questions"], kind: "question", uid, fields: { title: "How do I cope?", details: "", category: "Relationships", answerCount: 0, edited: false } });
  out.thought = await mk(["midnightThoughts"], "thought", { text: "it is late and quiet", mood: "Calm", category: "Reflection" });
  return out;
}

test("registering links the anonymous session: uid unchanged, data still counted", async () => {
  const u = await anon(); const uid = u.uid; await seed(u);
  await M.marks.addBookmark({ uid, postId: "somePost" }); await M.journal.createEntry(uid, { title: "t", body: "private", mood: "" });
  const before = await M.own.getCounts(uid);
  const { user, linked } = await M.account.registerWithEmail("Me@Example.com", "hunter22");
  assert.equal(linked, true); assert.equal(user.uid, uid); assert.equal(uidNow(), uid);
  const info = M.account.describeUser(M.auth.currentUser);
  assert.equal(info.isAnonymous, false); assert.equal(info.hasPassword, true); assert.equal(info.email, "me@example.com");
  assert.deepEqual(await M.own.getCounts(uid), before);
  assert.equal(before.posts, 1); assert.equal(before.letters, 1); assert.equal(before.questions, 1); assert.equal(before.thoughts, 1); assert.equal(before.saved, 1); assert.equal(before.journal, 1);
  assert.equal((await M.journal.fetchEntries(uid)).items.length, 1);
  assert.ok(M.authFake.__mail().some((m) => m.type === "verify"));
});
test("account-change signal fires on link (Firebase itself would not fire onAuthStateChanged)", async () => {
  await anon(); let n = 0; const off = M.account.onAccountChange(() => n++);
  await M.account.registerWithEmail("a@b.co", "hunter22"); off(); assert.ok(n >= 1);
});
test("registering with no session creates a fresh account", async () => {
  const { linked, user } = await M.account.registerWithEmail("new@b.co", "hunter22"); assert.equal(linked, false); assert.ok(user.uid);
});
test("already-registered user cannot register again", async () => {
  await M.account.registerWithEmail("a@b.co", "hunter22");
  await assert.rejects(() => M.account.registerWithEmail("c@d.co", "hunter22"), (e) => e.appCode === "already-registered");
});
test("email collision: error surfaced, anonymous session and its data untouched", async () => {
  await M.account.registerWithEmail("taken@b.co", "hunter22"); await M.account.signOutNow();
  const u = await anon(); await seed(u); const uid = u.uid;
  await assert.rejects(() => M.account.registerWithEmail("taken@b.co", "otherpass1"), (e) => e.code === "auth/email-already-in-use");
  assert.equal(uidNow(), uid); assert.equal(M.auth.currentUser.isAnonymous, true); assert.equal((await M.own.getCounts(uid)).total, 4);
  assert.match(M.errors.friendlyAuthError({ code: "auth/email-already-in-use" }), /already exists/);
});
test("weak password and bad email are rejected without changing the session", async () => {
  const u = await anon();
  await assert.rejects(() => M.account.registerWithEmail("a@b.co", "123"), (e) => e.code === "auth/weak-password");
  assert.equal(M.auth.currentUser.isAnonymous, true); assert.equal(uidNow(), u.uid);
});
test("Google link preserves uid; collision keeps session until the person confirms a switch", async () => {
  const u = await anon(); const uid = u.uid; await seed(u);
  globalThis.__fakeGoogle = { email: "g1@example.com", id: "G1" };
  await M.account.linkGoogle(); assert.equal(uidNow(), uid); assert.equal(M.account.describeUser(M.auth.currentUser).hasGoogle, true);
  await M.account.signOutNow();
  const u2 = await anon(); await seed(u2);
  let caught; try { await M.account.linkGoogle(); } catch (e) { caught = e; }
  assert.equal(caught.code, "auth/credential-already-in-use"); assert.ok(caught.pendingCredential);
  assert.equal(uidNow(), u2.uid); assert.equal(M.auth.currentUser.isAnonymous, true); assert.equal((await M.own.getCounts(u2.uid)).total, 4);
  await M.account.switchToCredential(caught.pendingCredential); assert.equal(uidNow(), uid);
});
test("closing the Google window changes nothing", async () => {
  const u = await anon(); globalThis.__fakeGoogle = { email: "g@x.co", blocked: true };
  await assert.rejects(() => M.account.linkGoogle(), (e) => e.code === "auth/popup-closed-by-user"); assert.equal(uidNow(), u.uid);
});
test("sign out then sign in returns to the same uid and data", async () => {
  const u = await anon(); await seed(u); await M.account.registerWithEmail("me@b.co", "hunter22"); await M.account.signOutNow(); assert.equal(uidNow(), undefined);
  await assert.rejects(() => M.account.signInWithEmail("me@b.co", "wrong-pass"), (e) => e.code === "auth/invalid-credential");
  await M.account.signInWithEmail("me@b.co", "hunter22"); assert.equal(uidNow(), u.uid); assert.equal((await M.own.getCounts(u.uid)).total, 4);
});
test("password reset sends mail and never reveals whether the email exists", async () => {
  await M.account.registerWithEmail("me@b.co", "hunter22"); await M.account.signOutNow();
  await M.account.resetPassword("me@b.co"); await M.account.resetPassword("nobody@b.co");
  assert.equal(M.authFake.__mail().filter((m) => m.type === "reset").length, 2);
});
test("change password: wrong current rejected, right current works, new password signs in", async () => {
  await M.account.registerWithEmail("me@b.co", "hunter22");
  await assert.rejects(() => M.account.changePassword("nope-nope", "newpass99"), (e) => e.code === "auth/wrong-password");
  await M.account.changePassword("hunter22", "newpass99"); await M.account.signOutNow();
  await assert.rejects(() => M.account.signInWithEmail("me@b.co", "hunter22")); await M.account.signInWithEmail("me@b.co", "newpass99");
});
test("anonymous users cannot change a password", async () => { await anon(); await assert.rejects(() => M.account.changePassword("a", "bbbbbbbb"), (e) => e.appCode === "no-password"); });

test("counts: posts exclude other kinds; no collection scan helpers used", async () => {
  const u = await anon(); await seed(u); await M.posts.createPost({ uid: u.uid, text: "second thought here", category: "Thoughts", tags: [], authorLabel: "Anonymous #2222" });
  const c = await M.own.getCounts(u.uid); assert.equal(c.posts, 2); assert.equal(c.total, 5);
});
test("My posts paging: only posts, newest first, every post once, across mixed kinds", async () => {
  const u = await anon(); const ids = [];
  for (let i = 0; i < 12; i++) { await new Promise((r) => setTimeout(r, 3)); ids.push(await M.posts.createPost({ uid: u.uid, text: `thought number ${i} is here`, category: "Thoughts", tags: [], authorLabel: "Anonymous #3333" })); if (i % 3 === 0) await M.content.createContent({ path: ["letters"], kind: "letter", uid: u.uid, fields: { title: "Dear x", body: "y".repeat(40), category: "Someone I Miss", reactions: {}, comments: 0 } }); }
  const p1 = await M.own.fetchOwnedPage(u.uid, "post"); assert.equal(p1.rows.length, 10); assert.equal(p1.hasMore, true);
  const p2 = await M.own.fetchOwnedPage(u.uid, "post", { after: p1.cursor });
  const got = [...p1.rows, ...p2.rows].map((r) => r.id); assert.equal(new Set(got).size, 12); assert.deepEqual([...got].sort(), [...ids].sort()); assert.equal(p2.hasMore, false);
  assert.ok(p1.rows.every((r) => r.kind === "post"));
  assert.deepEqual(got, [...ids].reverse());
});
test("another user's records never appear in my lists or counts", async () => {
  const a = await anon(); await seed(a); await M.account.signOutNow(); const b = await anon();
  assert.equal((await M.own.getCounts(b.uid)).total, 0); assert.equal((await M.own.fetchOwnedPage(b.uid, "letter")).rows.length, 0); assert.equal((await M.own.fetchRecentRows(b.uid)).length, 0);
});
test("answers: parent recorded, resolves to question title; legacy answer without parent is flagged unresolved", async () => {
  const u = await anon(); const s = await seed(u);
  const a = await M.content.createContent({ path: ["questions", s.question, "answers"], kind: "answer", uid: u.uid, fields: { text: "try talking to someone", reactions: {}, comments: 0 }, bumpParent: { path: ["questions", s.question], field: "answerCount" }, ownerExtra: { parent: s.question } });
  const legacy = await M.content.createContent({ path: ["questions", s.question, "answers"], kind: "answer", uid: u.uid, fields: { text: "an older answer", reactions: {}, comments: 0 } });
  const page = await M.own.fetchOwnedPage(u.uid, "answer"); const items = await M.own.resolveRows(page.rows);
  const mine = items.find((i) => i.id === a); assert.equal(mine.doc.questionTitle, "How do I cope?"); assert.equal(M.own.pathFor(mine), `/ask/${s.question}`);
  const old = items.find((i) => i.id === legacy); assert.equal(old.doc, null); assert.equal(M.own.pathFor(old), null);
  assert.equal((await M.content.fetchDoc(["questions"], s.question)).answerCount, 1); // only the new-style answer bumped it
});
test("deleting an answer decrements the count, and still works if the question is gone", async () => {
  const u = await anon(); const s = await seed(u); const mk = () => M.content.createContent({ path: ["questions", s.question, "answers"], kind: "answer", uid: u.uid, fields: { text: "an answer", reactions: {}, comments: 0 }, bumpParent: { path: ["questions", s.question], field: "answerCount" }, ownerExtra: { parent: s.question } });
  const a1 = await mk(); const a2 = await mk();
  await M.own.deleteOwned({ kind: "answer", id: a1, parent: s.question }, u.uid); assert.equal((await M.content.fetchDoc(["questions"], s.question)).answerCount, 1);
  await M.own.deleteOwned({ kind: "question", id: s.question }, u.uid);
  await M.own.deleteOwned({ kind: "answer", id: a2, parent: s.question }, u.uid);
  assert.equal((await M.own.getCounts(u.uid)).answers, 0);
});
test("owner can edit a letter and a question from the dashboard path; ownership is checked", async () => {
  const a = await anon(); const s = await seed(a);
  await M.own.editOwned({ kind: "letter", id: s.letter }, a.uid, { title: "Dear me", body: "z".repeat(50), category: "To My Past Self" });
  const l = await M.content.fetchDoc(["letters"], s.letter); assert.equal(l.title, "Dear me"); assert.equal(l.edited, true);
  await M.account.signOutNow(); const b = await anon();
  await assert.rejects(() => M.own.editOwned({ kind: "letter", id: s.letter }, b.uid, { title: "hijack", body: "z".repeat(50), category: "To My Past Self" }), /only edit your own/);
  await assert.rejects(() => M.own.deleteOwned({ kind: "letter", id: s.letter }, b.uid), /only delete your own/);
});
test("saved items resolve across kinds; a deleted item shows as unavailable and can be removed", async () => {
  const u = await anon(); const s = await seed(u);
  for (const k of [s.post, `letter_${s.letter}`, `question_${s.question}`, `thought_${s.thought}`, "post_gone"]) await M.marks.addBookmark({ uid: u.uid, postId: k });
  const items = await M.own.fetchSaved(u.uid); assert.equal(items.length, 5);
  assert.deepEqual(items.filter((i) => i.doc).map((i) => i.kind).sort(), ["letter", "post", "question", "thought"]); assert.equal(items.find((i) => i.key === "post_gone").doc, null);
  await M.marks.removeBookmark({ uid: u.uid, postId: "post_gone" }); assert.equal((await M.own.fetchSaved(u.uid)).length, 4);
});
test("profile: lazily created, validated shape, createdAt preserved on update", async () => {
  const u = await anon(); assert.equal(await M.profile.fetchProfile(u.uid), null);
  const p = await M.profile.ensureProfile(M.auth.currentUser); assert.equal(p.accountType, "anonymous"); assert.equal(p.preferences.theme, "system");
  await new Promise((r) => setTimeout(r, 5)); await M.account.registerWithEmail("me@b.co", "hunter22");
  const saved = await M.profile.saveProfile(M.auth.currentUser, { displayName: "  Night owl ", preferences: { theme: "light", defaultSort: "Trending", defaultCategory: "Thoughts" } });
  assert.equal(saved.displayName, "Night owl"); assert.equal(saved.accountType, "registered"); assert.deepEqual(saved.linkedProviders, ["password"]); assert.equal(saved.createdAtMs, p.createdAtMs);
  assert.ok(!("email" in saved) && !("password" in saved), "profile must never hold email or credentials");
});

async function seedAll(u) {
  const s = await seed(u);
  const a = await M.content.createContent({ path: ["questions", s.question, "answers"], kind: "answer", uid: u.uid, fields: { text: "an answer", reactions: {}, comments: 0 }, bumpParent: { path: ["questions", s.question], field: "answerCount" }, ownerExtra: { parent: s.question } });
  await M.marks.addBookmark({ uid: u.uid, postId: s.post }); await M.journal.createEntry(u.uid, { title: "t", body: "secret", mood: "" }); await M.journal.createEntry(u.uid, { title: "t2", body: "secret2", mood: "" });
  await M.profile.ensureProfile(M.auth.currentUser);
  return { ...s, answer: a };
}
test("export contains own writing, saved keys and journal, and no one else's data", async () => {
  const other = await anon(); await seed(other); await M.account.signOutNow();
  const u = await anon(); await seedAll(u); await M.account.registerWithEmail("me@b.co", "hunter22");
  const out = await M.data.exportMyData(M.auth.currentUser);
  assert.equal(out.writing.posts.length, 1); assert.equal(out.writing.letters.length, 1); assert.equal(out.writing.questions.length, 1); assert.equal(out.writing.thoughts.length, 1); assert.equal(out.writing.answers.length, 1);
  assert.equal(out.journalEntries.length, 2); assert.equal(out.saved.length, 1); assert.equal(out.account.email, "me@b.co");
  assert.ok(!JSON.stringify(out).includes(other.uid));
});
test("deleteAccount (detach): private data and sign-in removed, public writing stays but is unowned; others untouched", async () => {
  const other = await anon(); const os = await seed(other); await M.account.signOutNow();
  const u = await anon(); const s = await seedAll(u); await M.account.registerWithEmail("me@b.co", "hunter22");
  const steps = []; const rep = await M.data.deleteAccount({ password: "hunter22", mode: "detach", onStep: (i) => steps.push(i) });
  assert.deepEqual(steps, [0, 1, 2, 3, 4, 5]); assert.equal(rep.journal, 2); assert.equal(rep.saved, 1); assert.equal(rep.detached, 5);
  const db = M.fsFake.__dump();
  assert.ok(db[`posts/${s.post}`] && db[`letters/${s.letter}`] && db[`questions/${s.question}/answers/${s.answer}`], "public writing stays");
  assert.ok(!Object.keys(db).some((p) => p.startsWith("postOwners/") && db[p].uid === u.uid), "no ownership records left");
  assert.ok(!Object.keys(db).some((p) => p.startsWith(`journals/${u.uid}`) || p.startsWith(`users/${u.uid}`)), "private docs gone");
  assert.ok(db[`postOwners/${os.post}`] && db[`posts/${os.post}`], "other user's data untouched");
  assert.equal(uidNow(), undefined, "signed out after the auth user is deleted");
});
test("deleteAccount (delete): public writing removed too and question answer count adjusted", async () => {
  const other = await anon(); const os = await seed(other);
  const oa = await M.content.createContent({ path: ["questions", os.question, "answers"], kind: "answer", uid: other.uid, fields: { text: "other answer", reactions: {}, comments: 0 }, bumpParent: { path: ["questions", os.question], field: "answerCount" }, ownerExtra: { parent: os.question } });
  await M.account.signOutNow(); const u = await anon();
  const mine = await M.content.createContent({ path: ["questions", os.question, "answers"], kind: "answer", uid: u.uid, fields: { text: "my answer", reactions: {}, comments: 0 }, bumpParent: { path: ["questions", os.question], field: "answerCount" }, ownerExtra: { parent: os.question } });
  const s = await seedAll(u);
  const rep = await M.data.deleteAccount({ mode: "delete" }); assert.equal(rep.writing, 6);
  const db = M.fsFake.__dump();
  for (const p of [`posts/${s.post}`, `letters/${s.letter}`, `questions/${s.question}`, `midnightThoughts/${s.thought}`, `questions/${os.question}/answers/${mine}`]) assert.equal(db[p], undefined, p);
  assert.ok(db[`questions/${os.question}/answers/${oa}`], "other user's answer stays"); assert.equal(db[`questions/${os.question}`].answerCount, 1);
});
test("deleteAccount handles legacy answers (no parent) honestly and daily responses", async () => {
  const u = await anon();
  const q = await M.content.createContent({ path: ["questions"], kind: "question", uid: "someoneElse", fields: { title: "A question here", details: "", category: "Career", answerCount: 0, edited: false } });
  await M.content.createContent({ path: ["questions", q, "answers"], kind: "answer", uid: u.uid, fields: { text: "legacy answer", reactions: {}, comments: 0 } });
  await M.fsFake.setDoc(M.fsFake.doc({ __db: 1 }, "dailyPrompts", "2026-11-20"), { date: "2026-11-20", text: "Q?" });
  await M.daily.submitDailyResponse({ promptId: "2026-11-20", uid: u.uid, text: "my daily answer" });
  const rep = await M.data.deleteAccount({ mode: "delete" }); assert.equal(rep.unreachable, 1); assert.equal(rep.daily, 1);
  const db = M.fsFake.__dump(); assert.equal(Object.keys(db).filter((p) => p.startsWith("dailyResponses/") || p.startsWith("dailyMarkers/")).length, 0);
  assert.ok(db[`questions/${q}/answers/${Object.keys(db).find((p) => p.includes("/answers/")).split("/").pop()}`], "legacy answer remains");
});
test("deletion that fails midway keeps the sign-in, then succeeds when retried", async () => {
  const u = await anon(); await seedAll(u); await M.account.registerWithEmail("me@b.co", "hunter22");
  M.fsFake.__failNext("journals"); await assert.rejects(() => M.data.deleteAccount({ password: "hunter22", mode: "detach" }), /simulated/);
  assert.equal(uidNow(), u.uid, "auth user must survive a failed data step");
  await M.data.deleteAccount({ password: "hunter22", mode: "detach" }); assert.equal(uidNow(), undefined);
});
test("deletion with the wrong password stops before deleting anything", async () => {
  const u = await anon(); const s = await seedAll(u); await M.account.registerWithEmail("me@b.co", "hunter22");
  await assert.rejects(() => M.data.deleteAccount({ password: "wrong-wrong", mode: "delete" }), (e) => e.code === "auth/wrong-password");
  assert.ok(M.fsFake.__dump()[`posts/${s.post}`]); assert.equal(uidNow(), u.uid);
});
