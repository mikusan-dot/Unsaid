// Plain-language messages for Firebase Auth errors. Never reveals whether an email has an account
// on sign-in or password-reset paths (Firebase's email-enumeration protection returns generic codes).
const MESSAGES = {
  "auth/invalid-email": "That email address doesn't look right.",
  "auth/weak-password": "Choose a password with at least 8 characters.",
  "auth/email-already-in-use": "An account with this email already exists.",
  "auth/credential-already-in-use": "That account is already in use by another UNSAID profile.",
  "auth/provider-already-linked": "That sign-in method is already linked to this account.",
  "auth/invalid-credential": "The email or password is incorrect.",
  "auth/invalid-login-credentials": "The email or password is incorrect.",
  "auth/wrong-password": "The password is incorrect.",
  "auth/user-not-found": "The email or password is incorrect.",
  "auth/user-disabled": "This account has been disabled.",
  "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
  "auth/network-request-failed": "Couldn't reach the server. Check your connection and try again.",
  "auth/requires-recent-login": "For your security, please confirm your password again and retry.",
  "auth/operation-not-allowed": "This sign-in method isn't enabled for this project yet.",
  "auth/popup-closed-by-user": "The Google window was closed before finishing.",
  "auth/cancelled-popup-request": "The Google window was closed before finishing.",
  "auth/popup-blocked": "Your browser blocked the Google window. Allow pop-ups and try again.",
  "auth/unauthorized-domain": "This site's domain isn't authorised for sign-in in the Firebase console.",
  "auth/account-exists-with-different-credential": "An account already exists with this email using a different sign-in method.",
};
export const authCode = (e) => e?.code || e?.appCode || "";
export function friendlyAuthError(error, fallback = "Something went wrong. Please try again.") {
  return MESSAGES[authCode(error)] || (error?.appMessage) || fallback;
}
export function appError(appCode, appMessage) { const e = new Error(appMessage); e.appCode = appCode; e.appMessage = appMessage; return e; }
