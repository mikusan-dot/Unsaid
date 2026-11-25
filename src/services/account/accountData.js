import { collection, doc, getDoc, getDocs, query, where, orderBy, limit, writeBatch, increment, deleteDoc } from "firebase/firestore";
import { db } from "../firebase/client";
import { fetchByIds } from "../content/content";
import { fetchAllEntries } from "../content/journal";
import { fetchProfile, deleteProfile } from "./profile";
import { COLLECTION, kindOf } from "./ownership";
import { reauthenticate, deleteAuthUser, describeUser } from "../auth/account";
import { auth } from "../firebase/client";

const CAP = 500;
async function ownerRows(uid) {
  const snap = await getDocs(query(collection(db, "postOwners"), where("uid", "==", uid), limit(CAP)));
  return snap.docs.map((d) => ({ id: d.id, kind: kindOf(d.data()), parent: d.data().parent || null }));
}

// Everything the account holds, for the person's own backup. Reads only documents they own.
export async function exportMyData(user) {
  const uid = user.uid; const info = describeUser(user);
  const [profile, rows, journal, bm] = await Promise.all([fetchProfile(uid), ownerRows(uid), fetchAllEntries(uid), getDocs(query(collection(db, "users", uid, "bookmarks"), orderBy("createdAt", "desc"), limit(CAP)))]);
  const writing = { posts: [], letters: [], questions: [], answers: [], thoughts: [] };
  const plural = { post: "posts", letter: "letters", question: "questions", answer: "answers", thought: "thoughts" };
  for (const k of Object.keys(COLLECTION)) {
    const ids = rows.filter((r) => r.kind === k).map((r) => r.id);
    for (let i = 0; i < ids.length; i += 10) (await fetchByIds([COLLECTION[k]], ids.slice(i, i + 10))).forEach((d) => writing[plural[k]].push({ id: d.id, ...strip(d) }));
  }
  await Promise.all(rows.filter((r) => r.kind === "answer" && r.parent).map(async (r) => { const s = await getDoc(doc(db, "questions", r.parent, "answers", r.id)); if (s.exists()) writing.answers.push({ id: r.id, questionId: r.parent, ...strip({ ...s.data(), createdAt: s.data().createdAt?.toMillis?.() }) }); }));
  return {
    exportedAt: new Date().toISOString(),
    account: { accountType: info.isAnonymous ? "anonymous" : "registered", email: info.email || null, providers: info.providers, createdAt: info.createdAt ? new Date(info.createdAt).toISOString() : null },
    profile: profile && { displayName: profile.displayName, preferences: profile.preferences },
    writing, saved: bm.docs.map((d) => d.id), journalEntries: journal,
    notes: ["Replies and reactions you made on other writing are not included: they can't be located without scanning the whole database.", "Older answers saved before Phase 4 don't record their question and are omitted."],
  };
}
const strip = ({ comments, reactions, authorLabel, ...rest }) => ({ ...rest, publicLabel: authorLabel, replies: comments, reactions });

export function downloadJson(data, filename = "unsaid-data.json") {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })); a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}

async function purge(snapDocsFn) {
  let total = 0;
  for (;;) {
    const docs = await snapDocsFn(); if (!docs.length) return total;
    const b = writeBatch(db); docs.forEach((d) => b.delete(d.ref)); await b.commit(); total += docs.length;
  }
}

export const DELETE_STEPS = ["Confirming it's you", "Public writing", "Daily answers", "Private journal and saved items", "Profile", "Sign-in account"];

// Spark-compatible deletion (no Cloud Functions). The client removes what it can LOCATE and is allowed to
// delete, then deletes the Firebase Auth user last. mode "delete": public writing is removed;
// mode "detach": only the private ownership link is removed, leaving the writing anonymous and unmanageable.
// Replies and reactions made on others' writing cannot be enumerated without a database scan and remain.
export async function deleteAccount({ password, mode = "detach", onStep = () => {} } = {}) {
  const user = auth.currentUser; if (!user) throw new Error("You're not signed in.");
  const uid = user.uid; const report = { writing: 0, detached: 0, unreachable: 0, daily: 0, journal: 0, saved: 0 };
  onStep(0); await reauthenticate({ password });

  onStep(1);
  for (;;) {
    const snap = await getDocs(query(collection(db, "postOwners"), where("uid", "==", uid), limit(100)));
    if (!snap.docs.length) break;
    const batch = writeBatch(db); let n = 0;
    for (const d of snap.docs) {
      const kind = kindOf(d.data());
      if (kind === "answer") {
        const parent = d.data().parent;
        if (mode === "delete" && parent) {
          const q = await getDoc(doc(db, "questions", parent)); const b = writeBatch(db);
          b.delete(doc(db, "questions", parent, "answers", d.id)); b.delete(d.ref);
          if (q.exists()) b.update(doc(db, "questions", parent), { answerCount: increment(-1) });
          await b.commit(); report.writing++; continue;
        }
        if (mode === "delete") report.unreachable++; else report.detached++;
        batch.delete(d.ref); n++; continue;
      }
      if (mode === "delete") { batch.delete(doc(db, COLLECTION[kind], d.id)); report.writing++; } else report.detached++;
      batch.delete(d.ref); n++;
    }
    if (n) await batch.commit();
  }

  onStep(2);
  const prompts = await getDocs(query(collection(db, "dailyPrompts"), orderBy("date", "desc"), limit(400)));
  for (const p of prompts.docs) {
    const mref = doc(db, "dailyMarkers", `${p.id}_${uid}`); const m = await getDoc(mref); if (!m.exists()) continue;
    const b = writeBatch(db);
    if (mode === "delete") { b.delete(doc(db, "dailyResponses", m.data().responseId)); report.daily++; } else report.detached++;
    b.delete(mref); await b.commit();
  }

  onStep(3);
  report.journal = await purge(async () => (await getDocs(query(collection(db, "journals", uid, "entries"), limit(200)))).docs);
  report.saved = await purge(async () => (await getDocs(query(collection(db, "users", uid, "bookmarks"), limit(200)))).docs);

  onStep(4);
  await deleteProfile(uid);
  try { await deleteDoc(doc(db, "clock", uid)); } catch (e) { console.warn("clock record kept", e); }

  onStep(5);
  await deleteAuthUser();
  return report;
}
