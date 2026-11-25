import {
  EmailAuthProvider, GoogleAuthProvider, linkWithCredential, linkWithPopup, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signInWithCredential, signInWithPopup, signOut, sendPasswordResetEmail,
  sendEmailVerification, reauthenticateWithCredential, reauthenticateWithPopup, updatePassword, deleteUser,
} from "firebase/auth";
import { auth } from "../firebase/client";
import { appError } from "./errors";

// Firebase does NOT fire onAuthStateChanged when an anonymous user is linked (the same User object
// is mutated, the uid stays). This tiny emitter lets the UI re-render after link/reload/delete.
const listeners = new Set();
export const onAccountChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const notifyAccountChange = () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });

export const GOOGLE_ENABLED = import.meta.env.VITE_ENABLE_GOOGLE_SIGNIN === "true";

export function describeUser(user) {
  if (!user) return null;
  const providers = (user.providerData || []).map((p) => p.providerId);
  return {
    uid: user.uid, isAnonymous: user.isAnonymous, email: user.email || "", emailVerified: Boolean(user.emailVerified),
    providers, hasPassword: providers.includes("password"), hasGoogle: providers.includes("google.com"),
    createdAt: Date.parse(user.metadata?.creationTime) || null,
  };
}

const requireUser = () => { if (!auth?.currentUser) throw appError("no-session", "You're not signed in."); return auth.currentUser; };
async function afterChange(user, { verify = false } = {}) {
  if (verify) { try { await sendEmailVerification(user); } catch (e) { console.warn("verification email not sent", e); } }
  try { await user.getIdToken(true); await user.reload(); } catch (e) { console.warn("token refresh failed", e); }
  notifyAccountChange();
}

// Email + password. With an anonymous session the credential is LINKED, so the uid (and every post,
// comment, reaction, bookmark and journal entry tied to it) is unchanged. Without a session a new
// account is created. Nothing is ever copied between uids.
export async function registerWithEmail(email, password) {
  const current = auth.currentUser;
  if (current && !current.isAnonymous) throw appError("already-registered", "You already have an account. Sign out first to create another.");
  const result = current
    ? await linkWithCredential(current, EmailAuthProvider.credential(email, password))
    : await createUserWithEmailAndPassword(auth, email, password);
  await afterChange(result.user, { verify: true });
  return { user: result.user, linked: Boolean(current) };
}

// Adds Google to the current session. On a credential collision the pending credential is attached
// to the error; the caller must ask the person before switching (see switchToCredential).
export async function linkGoogle() {
  const user = requireUser();
  try { const result = await linkWithPopup(user, new GoogleAuthProvider()); await afterChange(result.user); return result.user; }
  catch (error) {
    if (error?.code === "auth/credential-already-in-use" || error?.code === "auth/email-already-in-use") error.pendingCredential = GoogleAuthProvider.credentialFromError(error);
    throw error;
  }
}
// Explicit, user-confirmed switch to an existing account. The previous (anonymous) session is left behind.
export async function switchToCredential(credential) {
  if (!credential) throw appError("no-credential", "That sign-in expired. Please try again.");
  const result = await signInWithCredential(auth, credential); notifyAccountChange(); return result.user;
}
export async function signInWithEmail(email, password) { const r = await signInWithEmailAndPassword(auth, email, password); notifyAccountChange(); return r.user; }
export async function signInWithGoogle() { const r = await signInWithPopup(auth, new GoogleAuthProvider()); notifyAccountChange(); return r.user; }
export async function resetPassword(email) { await sendPasswordResetEmail(auth, email); }
export async function resendVerification() { const u = requireUser(); await sendEmailVerification(u); }
export async function refreshUser() { const u = requireUser(); await u.reload(); notifyAccountChange(); return u; }
export async function signOutNow() { await signOut(auth); notifyAccountChange(); }

// Re-authentication (Firebase requires a recent login for password change and deletion).
export async function reauthenticate({ password } = {}) {
  const user = requireUser(); const info = describeUser(user);
  if (user.isAnonymous) return;
  if (info.hasPassword && password) { await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password)); return; }
  if (info.hasGoogle && !info.hasPassword) { await reauthenticateWithPopup(user, new GoogleAuthProvider()); return; }
  throw appError("password-required", "Enter your current password to continue.");
}
export async function changePassword(currentPassword, newPassword) {
  const user = requireUser();
  if (!user.email || !describeUser(user).hasPassword) throw appError("no-password", "This account doesn't use a password.");
  await reauthenticate({ password: currentPassword });
  await updatePassword(user, newPassword); notifyAccountChange();
}
export async function deleteAuthUser() { const u = requireUser(); await deleteUser(u); notifyAccountChange(); }
