# UNSAID Phase 4: optional accounts, dashboard, settings

UNSAID still works with no account. Accounts are an opt-in layer on top of Firebase Anonymous Authentication.

## Authentication architecture

* A visitor browses with no session at all. The first write creates an anonymous Firebase user (unchanged from Phase 3).
* **Register** (`/register`) *links* an email/password (or Google) credential to that anonymous user. The Firebase UID does not change, so every post, comment, reaction, bookmark and journal entry stays attached with **no data copied or migrated**.
* **Sign in** (`/signin`) switches to an existing account. If the current session is anonymous the page warns what will be left behind and requires an explicit tick first.
* `src/services/auth/account.js` holds all Auth calls. Firebase mutates the same `User` object on link and does **not** fire `onAuthStateChanged`, so the service emits its own `onAccountChange` signal that `main.jsx` and the account pages subscribe to.
* Collisions never discard the anonymous session silently:
  * email already used: the session is untouched; the person can choose another email or go to sign in.
  * Google account already linked elsewhere: a confirm dialog explains that the anonymous session will be left behind; only on confirm does the app call `signInWithCredential`.
* Private profile `users/{uid}` is created lazily (first save), never holds credentials or email.

## Routes

`/signin`, `/register`, `/account` (dashboard), `/account/{posts,letters,questions,answers,thoughts,saved}`, `/account/settings`, `/account/security`. A top-bar account button and a "My account" sidebar item link to `/account`. A signed-out visitor sees a welcoming page, never a wall.

## Data model changes

| Path | Change |
|---|---|
| `users/{uid}` | **New.** `createdAt, updatedAt, accountType ("anonymous"|"registered"), displayName (<=30), preferences {theme, defaultSort, defaultCategory}, linkedProviders ["password","google.com"]`. Owner-only. `accountType`/`linkedProviders` mirror Auth for convenience; Auth is the source of truth. |
| `postOwners/{id}` | New optional `parent` (question id), allowed only when `kind == "answer"`, so "My answers" can link back to the question. |
| `letters/{id}` | The owner may now edit title/body/category (sets `edited: true`). Needed for "edit owned letters". |
| `clock/{uid}` | The owner may now delete their record (account deletion). |

Public documents still hold no UID or email. `displayName` is a **private nickname**; public labels remain the random "Anonymous #1234" because the existing rules require that format and a stable public name would link a person's posts.

## Firestore rules (diff summary)

Only additions; every Phase 2/3 rule is intact. See `firestore.rules` (search "PHASE 4" and "Phase 4"). Strict profile shape (no extra keys, bounded name, enumerated preferences), `createdAt` immutable, owner-only read/write/delete, no email or credential fields allowed.

New composite indexes (`firestore.indexes.json`): `postOwners (uid, createdAt desc)` and `postOwners (uid, kind, createdAt desc)`.

## Dashboard and queries (Spark-friendly)

* Counts use 7 aggregate queries (`getCountFromServer`, about 1 read each). Posts = total owner records minus letters, questions, answers, thoughts (posts predate `kind`).
* Recent activity: one indexed query (limit 8) plus one batched fetch.
* Lists are paged 10 at a time from `postOwners`, never by scanning a content collection.
* Journal entries are only counted, never shown on the dashboard or in activity.

## Account recovery (anonymous sessions)

An anonymous session lives only in the browser's storage. There is no credential to recover it with, and nobody (including the app owner) can restore it. If it is cleared before linking, public writing stays online anonymously but can no longer be edited or deleted, and the journal and bookmarks are unreachable for good. Prevention is the only remedy: link an email or Google account while the session still exists, and use **Settings > Privacy > Download my data** for a backup. The UI explains this in Privacy, Security, the dashboard banner and the journal page.

## Account deletion (Spark-compatible, honest about limits)

No Cloud Functions, so the client does the work, in this order, then deletes the Auth user **last** (so a failure leaves a still-working account that can simply retry):

1. Re-authenticate (password, or Google popup).
2. Public writing, by the person's choice: **detach** (delete only the private `postOwners` link; the writing stays online, anonymous and unmanageable) or **delete** (remove posts, letters, questions, thoughts, answers with count adjustment, and daily answers).
3. Private data: journal entries, bookmarks, daily markers, `clock` record, `users/{uid}`.
4. Delete the Firebase Auth user.

**Limits (shown to the person before and after):**
* Replies and reactions made on other people's writing cannot be located without scanning the database, so they remain, linked to no email or name.
* Answers saved before Phase 4 do not record their question, so they cannot be located and stay online.
* In "delete" mode, other people's answers to your deleted questions become unreachable (rules do not let you delete others' documents).
* Deleting the Auth user does not itself delete Firestore data; that is why the data steps run first.
* Daily-answer cleanup probes the latest 400 daily prompts.

## Pre-existing privacy finding (not changed in Phase 4)

Comment documents store the commenter's `uid`, and reaction documents are keyed by `uid`; both are publicly readable. They contain no email or name, but they let anyone link one person's replies and reactions across threads. Fixing this needs a schema redesign (for example a per-thread pseudonymous id) and was out of scope. Account linking does not make it worse (the UID is unchanged).

## Firebase console configuration

1. **Authentication > Sign-in method:** keep **Anonymous** enabled; enable **Email/Password**; optionally enable **Google** (choose a support email).
2. **Authentication > Settings > Authorized domains:** add your deployed domain (`localhost` is there by default). Required for Google popups.
3. **Authentication > Templates:** customise the password-reset and verification emails if you like (free).
4. For Google: set `VITE_ENABLE_GOOGLE_SIGNIN=true` in `.env.local`. The button is hidden otherwise.
5. Deploy rules and the **new indexes** (they take a few minutes to build; until then My activity and Recent activity show a retry state).

## Commands

```bash
npm install
npm run build                                   # production build
firebase login
firebase deploy --only firestore:rules,firestore:indexes --project unsaid-community
npm run test:services                           # application-logic tests (no Firebase needed)
npm run test:rules                              # rules tests (needs Java + the Firestore emulator)
# optional browser tests against a stand-in backend:
node tests/ui/build.mjs && python3 tests/ui/serve.py 5199 &
pip install playwright && playwright install chromium && python3 tests/ui/ui.test.py
```

## Manual check against the real project (please run these)

1. Open the site in a fresh private window, write a post, bookmark it, add a journal entry. Note the UID in Firebase Console > Authentication.
2. Register with an email in the same window. Confirm the **same UID** now shows the email provider, and the dashboard counts are unchanged.
3. Open the verification email and click it; the dashboard banner should disappear after reload.
4. Sign out, sign back in: same UID and data.
5. Second browser: register the same email, confirm the collision dialog; with Google enabled, link a Google account and confirm the collision dialog from a third session.
6. Change password, request a reset email, delete a throwaway account in both modes and inspect Firestore.
7. Confirm `postOwners` queries and My activity pages load once the two indexes are built.

## Spark plan

Everything uses Firebase Authentication (email/password, Google, anonymous) and Firestore client features only. No Cloud Functions, no Blaze, no paid APIs. Added cost is a handful of reads per dashboard visit (about 20-40) and a few writes when saving settings, well within the Spark free quota for a project of this size.
