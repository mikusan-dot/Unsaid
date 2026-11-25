# UNSAID

Phase 2 builds on the initial UNSAID frontend and adds a more complete anonymous posting and discovery experience.

## What's included
- Create anonymous text posts with category and up to five optional tags
- Client-side validation (12–1,200 characters)
- Persist posts in the current browser using localStorage
- Feed with category filtering, text/tag search, latest/trending/most-discussed sorting
- Individual post detail routes (`/post/:id`) with browser back/forward support
- Edit and delete posts created in this browser
- **Real-time comments** stored in Cloud Firestore with anonymous author labels and timestamps
- **Nested replies** (one level deep) beneath parent comments
- **Persistent reactions** — I understand / Not alone / Feel this, saved in Firestore (one per user per post)
- **Private bookmarks / Saved Thoughts** — persist across refreshes for the same anonymous Firebase account
- **Post detail page** (`/post/:id`) with full post, reactions, comments, replies, bookmarking, and copy-link
- Copy post link
- Responsive layout, light/dark mode, mobile navigation
- Firestore Security Rules enforcing ownership, field validation, and one-reaction-per-user

## Run
Requires Node.js 18+ and npm.

```bash
npm install
npm run dev
```

Build:
```bash
npm run build
npm run preview
```

## Important limitations
This remains a frontend-only prototype. localStorage is per-browser and does not synchronize between users or devices. Sample posts are seeded demo content. Reactions, saved items, and user ownership are local demo behavior, not secure server-side identity or authorization. The `owner` flag is not a security boundary.

The detail page reserves a conversation area for Phase 3; comments are not yet implemented. Reporting currently shows a demo acknowledgement and does not reach a moderation queue.

Do not use this prototype to collect sensitive personal information or claim production-grade anonymity. Before public launch, implement a backend, secure anonymous session model, server-side ownership checks, moderation, rate limiting, data retention policy, privacy notice, and security testing.

## Next phase
Phase 3: backend + Firestore persistence, real comments/replies, reactions and bookmarks APIs, and reporting/moderation workflow.

## Firebase setup (optional)
Without Firebase config the app runs in local preview mode (localStorage). To enable the shared community feed:

1. Copy `.env.example` to `.env.local` and fill in your Firebase web app values (never commit `.env.local`).
2. In Firebase console enable **Authentication → Anonymous** and create a **Firestore** database.
3. Deploy `firestore.rules` (`firebase deploy --only firestore:rules`). Test them in the emulator first; they are what actually enforce ownership, field validation and reaction limits. Client-side checks are not a security boundary.
4. Consider enabling Firebase App Check to limit abuse, since anonymous sign-in plus open reads is easy to script.

Known limits: one level of reply nesting only (replies cannot be replied to). 50-comment real-time limit per post. Anonymous-only authentication. Reporting is still a demo acknowledgement with no moderation queue. Comments, Letters and Midnight are placeholders (Letters/Midnight show coming-soon).

## Design
Type: Newsreader (thoughts, headings) with Hanken Grotesk (interface). One accent (sea-glass on cool slate; deep teal on cool paper). Light/dark follows the system setting and remembers the choice. Tokens live at the top of `src/styles.css`; contrast ratios were checked against WCAG AA.

---

# Phase 3: signature features

Letters Never Sent, Ask Anything, Midnight Thoughts, Daily Questions and a Private Journal. Everything runs on the free Firebase **Spark** plan (client SDK + security rules only; no Cloud Functions, no paid services). Phase 3 pages need Firebase configured; without it they say so instead of showing fake data.

## Firebase Console setup
1. **Authentication → Sign-in method → Anonymous: Enable** (already needed for Phase 2).
2. **Firestore Database** must exist (production mode).
3. Deploy rules and indexes: `firebase deploy --only firestore:rules,firestore:indexes` (project `unsaid-community`). Index builds take a minute or two; until then category-filtered lists show a "Couldn't load" state with a link in the browser console.
4. Add daily prompts (managed by you; clients cannot write them): create documents in `dailyPrompts` with id `YYYY-MM-DD` and fields `date` (same string) and `text`; or run `scripts/seed-daily-prompts.mjs` (instructions at the top of that file). If a day has no prompt, the latest earlier one stays current.
5. Optional: enable **App Check** to limit scripted abuse.

## How Phase 3 reuses Phase 2
| Need | Reused | Change |
| --- | --- | --- |
| Comments + replies | `services/firestoreComments.js`, `components/CommentSection.jsx` | optional `parentPath` (default unchanged: `posts/{id}`) |
| One reaction per person | `services/firestoreReactions.js` | optional `parentPath` |
| Bookmarks | `services/firestoreBookmarks.js` | `bookmarkKey(kind, id)` helper; non-post keys are `letter_<id>`, `question_<id>`, `thought_<id>` |
| Ownership | `postOwners/{id}` | optional `kind` field |

## Data model
| Path | Purpose |
| --- | --- |
| `letters/{id}`, `midnightThoughts/{id}`, `questions/{id}/answers/{id}`, `dailyResponses/{id}` | public content with `comments` and `reactions` counters; each has `comments/` and `reactions/{uid}` subcollections (same shape as posts) |
| `questions/{id}` | `title, details, category, authorLabel, answerCount, edited, createdAt` |
| `dailyPrompts/{YYYY-MM-DD}` | `date, text` (admin-managed) |
| `dailyMarkers/{promptId_uid}` | private; blocks a second response per session per prompt |
| `clock/{uid}` | write `serverTimestamp()` then read it back: the day comes from Firebase, not the device clock |
| `journals/{uid}/entries/{id}` | `title, body, mood, createdAt, updatedAt`; owner only |

Public documents never store the author's uid (ownership lives in `postOwners`), except comments, which keep Phase 2's design.

## Private journal: what "private" means
Only the signed-in owner can read or write `journals/{uid}/entries`; no public query, feed, search or URL touches it, and there is no moderation view of journals. It is **not end-to-end encrypted**: entries are stored unencrypted on Google's servers, so anyone with administrator access to the Firebase project could technically see database contents. Because sign-in is anonymous, the journal is tied to one browser session: clearing site data, switching browser/device or using a private window means permanent loss of access, with no recovery. The page offers **Export** (JSON) and explains this to users.

## Changes to Phase 2 files (bug fixes found while building on them)
- `firestoreBookmarks.js` used `serverTimestamp` without importing it, so saving a bookmark would throw.
- `firestoreReactions.js` used `getDocs` without importing it (only in `getReactionCounts`).
- `CommentSection.jsx` read `repliesByParent[id].length` without a guard, which crashes the thread when a top-level comment has no replies; the two send buttons had no accessible name.
- `firestore.rules`, rewritten with the **same intended behaviour** but valid syntax: the old file used a `/regex/` literal inside `matches(...)` (a leading `/` starts a path in the rules language), compared `keys() == [..]`, used `!(…).size() > 0`, and checked `request.resource.data.uid` on posts that have no `uid`. As written it would not compile or would reject edits and other users' reaction/comment counter updates. Please compare it with what you actually have deployed.
- `<CommentSection>` is still rendered only when `!post.owner` on post pages, so authors can't see replies on their own posts. That looks unintended; left as is.

## Tests
- UI flows were exercised in a headless browser against an in-memory stand-in for Firestore (it does not enforce security rules).
- `tests/firestore.rules.test.mjs` covers the rules. Run: `npm i -D @firebase/rules-unit-testing firebase-tools`, then `npm run test:rules` (needs Java). **It has not been run yet**; treat its first run as the real check of the rules.

## Known limitations
- Search and mood filters work over the items already loaded (no free full-text search); Trending is computed over loaded items.
- Counters are changed by client transactions (as in Phase 2). Rules bound each change to +/-1, but cannot prove the matching `reactions/{uid}` or comment document exists, so a determined user with many anonymous sessions could inflate counts. App Check helps.
- Reaction state for a list is looked up once per visible item (one small read each).
- Deleting a letter/question/thought leaves its comment subcollection in the database (unreachable from the app).
- The daily question rolls over at 00:00 UTC (`DAILY_DAY_OFFSET_HOURS` in `src/services/content/limits.js`).
- Rule-checked writes cost extra document reads against the free daily quota.
- Visiting the daily page, the journal, or any write creates an anonymous Firebase session.


## Phase 4: optional accounts

See [PHASE4.md](PHASE4.md) for the authentication architecture, account linking, schema, rules, deletion limits, console setup and commands.
