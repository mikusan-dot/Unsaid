// Stand-in for firebase/auth. TEST ONLY. Models the behaviours Phase 4 depends on:
//  - linkWithCredential/linkWithPopup mutate the SAME user object and keep the uid, and do NOT fire onAuthStateChanged
//  - email / Google collisions raise the real error codes
//  - the session lives in sessionStorage (per tab) while accounts live in localStorage (shared)
const LS = typeof localStorage !== "undefined" ? localStorage : null; const SS = typeof sessionStorage !== "undefined" ? sessionStorage : null;
let memUsers = {}, memSession = null, memMail = [];
const users = () => (LS ? JSON.parse(LS.getItem("fakeUsers") || "{}") : memUsers);
const putUsers = (u) => (LS ? LS.setItem("fakeUsers", JSON.stringify(u)) : (memUsers = u));
const getSession = () => (SS ? SS.getItem("fakeSession") : memSession);
const setSession = (uid) => { if (SS) { uid ? SS.setItem("fakeSession", uid) : SS.removeItem("fakeSession"); } else memSession = uid; };
export const __reset = () => { memUsers = {}; memSession = null; memMail = []; LS?.removeItem("fakeUsers"); LS?.removeItem("fakeMail"); SS?.removeItem("fakeSession"); };
export const __mail = () => (LS ? JSON.parse(LS.getItem("fakeMail") || "[]") : memMail);
const sendMail = (m) => { if (LS) LS.setItem("fakeMail", JSON.stringify([...__mail(), m])); else memMail.push(m); };
const err = (code) => { const e = new Error(code); e.code = code; return e; };
let n = 0; const newUid = () => `uid${Date.now().toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

const authObj = { currentUser: null, __stateL: new Set(), __tokenL: new Set() };
const emit = () => { authObj.__stateL.forEach((f) => f(authObj.currentUser)); authObj.__tokenL.forEach((f) => f(authObj.currentUser)); };
function makeUser(uid) {
  const rec = () => users()[uid];
  const u = {
    uid, get isAnonymous() { return rec().providers.length === 0; }, get email() { return rec().email || null; },
    get emailVerified() { return Boolean(rec().verified); }, get providerData() { return rec().providers.map((p) => ({ providerId: p })); },
    get metadata() { return { creationTime: new Date(rec().createdAt).toUTCString() }; },
    getIdToken: async () => "tok", reload: async () => {},
  };
  return u;
}
const setCurrent = (uid) => { setSession(uid); authObj.currentUser = uid ? makeUser(uid) : null; };
export const getAuth = () => { if (!authObj.currentUser && getSession() && users()[getSession()]) authObj.currentUser = makeUser(getSession()); return authObj; };
export const onAuthStateChanged = (a, cb) => { a.__stateL.add(cb); setTimeout(() => cb(getAuth().currentUser), 0); return () => a.__stateL.delete(cb); };
export const onIdTokenChanged = (a, cb) => { a.__tokenL.add(cb); return () => a.__tokenL.delete(cb); };

export const signInAnonymously = async () => { const uid = newUid(); putUsers({ ...users(), [uid]: { providers: [], createdAt: Date.now() } }); setCurrent(uid); emit(); return { user: authObj.currentUser }; };
export const EmailAuthProvider = { credential: (email, password) => ({ kind: "password", email: email.toLowerCase(), password }), PROVIDER_ID: "password" };
export class GoogleAuthProvider { static credentialFromError(e) { return e.credential || null; } }
const findByEmail = (email) => Object.entries(users()).find(([, r]) => r.email === email);
const googleAccount = () => (globalThis.__fakeGoogle || (typeof window !== "undefined" ? window.__fakeGoogle : null) || { email: "g@example.com" });
const findByGoogle = (gid) => Object.entries(users()).find(([, r]) => r.googleId === gid);

export const linkWithCredential = async (user, cred) => {
  if (cred.kind !== "password") throw err("auth/invalid-credential");
  if (cred.password.length < 6) throw err("auth/weak-password");
  if (findByEmail(cred.email)) throw err("auth/email-already-in-use");
  const all = users(); const r = all[user.uid]; if (r.providers.includes("password")) throw err("auth/provider-already-linked");
  all[user.uid] = { ...r, email: cred.email, password: cred.password, providers: [...r.providers, "password"] }; putUsers(all);
  return { user }; // same object, same uid; no auth-state event (as in the real SDK)
};
export const createUserWithEmailAndPassword = async (a, email, password) => {
  email = email.toLowerCase(); if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) throw err("auth/invalid-email"); if (password.length < 6) throw err("auth/weak-password"); if (findByEmail(email)) throw err("auth/email-already-in-use");
  const uid = newUid(); putUsers({ ...users(), [uid]: { providers: ["password"], email, password, createdAt: Date.now() } }); setCurrent(uid); emit(); return { user: a.currentUser };
};
export const signInWithEmailAndPassword = async (a, email, password) => {
  const f = findByEmail(email.toLowerCase()); if (!f || f[1].password !== password) throw err("auth/invalid-credential");
  setCurrent(f[0]); emit(); return { user: a.currentUser };
};
export const signInWithCredential = async (a, cred) => {
  const f = cred.kind === "google" ? findByGoogle(cred.googleId) : findByEmail(cred.email); if (!f) throw err("auth/user-not-found");
  setCurrent(f[0]); emit(); return { user: a.currentUser };
};
const gCred = (g) => ({ kind: "google", googleId: g.id || g.email, email: g.email });
export const linkWithPopup = async (user, provider) => {
  const g = googleAccount(); if (g.blocked) throw err("auth/popup-closed-by-user");
  const owner = findByGoogle(g.id || g.email);
  if (owner && owner[0] !== user.uid) { const e = err("auth/credential-already-in-use"); e.credential = gCred(g); throw e; }
  const all = users(); const r = all[user.uid]; if (r.providers.includes("google.com")) throw err("auth/provider-already-linked");
  all[user.uid] = { ...r, googleId: g.id || g.email, email: r.email || g.email, verified: true, providers: [...r.providers, "google.com"] }; putUsers(all); return { user };
};
export const signInWithPopup = async (a, provider) => {
  const g = googleAccount(); if (g.blocked) throw err("auth/popup-closed-by-user");
  let f = findByGoogle(g.id || g.email);
  if (!f) { const uid = newUid(); putUsers({ ...users(), [uid]: { providers: ["google.com"], googleId: g.id || g.email, email: g.email, verified: true, createdAt: Date.now() } }); f = [uid]; }
  setCurrent(f[0]); emit(); return { user: a.currentUser };
};
export const signOut = async (a) => { setCurrent(null); emit(); };
export const sendPasswordResetEmail = async (a, email) => { if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) throw err("auth/invalid-email"); sendMail({ type: "reset", to: email.toLowerCase(), exists: Boolean(findByEmail(email.toLowerCase())) }); }; // resolves either way
export const sendEmailVerification = async (u) => { sendMail({ type: "verify", to: u.email }); };
export const reauthenticateWithCredential = async (u, cred) => { if (users()[u.uid].password !== cred.password) throw err("auth/wrong-password"); };
export const reauthenticateWithPopup = async (u) => { const g = googleAccount(); if (g.blocked) throw err("auth/popup-closed-by-user"); };
export const updatePassword = async (u, pw) => { if (pw.length < 6) throw err("auth/weak-password"); const all = users(); all[u.uid].password = pw; putUsers(all); };
export const deleteUser = async (u) => { const all = users(); delete all[u.uid]; putUsers(all); setCurrent(null); emit(); };
export const __verifyEmail = (uid) => { const all = users(); all[uid].verified = true; putUsers(all); };
