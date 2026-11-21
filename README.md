# UNSAID — Phase 2

Phase 2 builds on the UNSAID frontend and adds a complete anonymous community experience backed by Firebase Firestore.

## What's included
- Create anonymous text posts with category and up to five optional tags
- Client-side validation (12–1,200 characters)
- Persist posts in the current browser using localStorage (demo mode)
- **Real-time comments** stored in Cloud Firestore with anonymous author labels and timestamps
- **Nested replies** (one level deep) beneath parent comments
- **Persistent reactions** — I understand / You are not alone / I feel this, saved in Firestore (one per user per post)
- **Private bookmarks / Saved Thoughts** — persist across refreshes for the same anonymous Firebase account
- **Post detail page** (`/post/:id`) with full post, reactions, comments, replies, bookmarking, and copy-link
- Feed with category filtering, text/tag search, latest/trending/most-discussed sorting
- Edit and delete posts you created
- Reaction counts and comment counts on every post
- Responsive layout, dark/light themes, mobile navigation
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

## Firebase setup
Without Firebase config the app runs in local preview mode (localStorage). To enable the shared community feed:

1. Copy `.env.example` to `.env.local` and fill in your Firebase web app values (never commit `.env.local`).
2. In Firebase console enable **Authentication → Anonymous** and create a **Firestore** database.
3. Deploy `firestore.rules` (`firebase deploy --only firestore:rules`). Test them in the emulator first.
4. Firebase Spark plan is sufficient — no payment card required.

## Firestore structure
- `posts/{postId}` — post data + `comments` and `reactions` counters
- `postOwners/{postId}` — private ownership tracking (uid only)
- `posts/{postId}/comments/{commentId}` — comments and one-level replies
- `posts/{postId}/reactions/{uid}` — one reaction document per user per post (doc ID = uid prevents duplicates)
- `users/{uid}/bookmarks/{postId}` — private bookmark records (doc ID = postId)

## Important limitations
- One level of reply nesting only (replies cannot be replied to)
- 50-comment real-time limit per post
- Anonymous-only authentication
- Reporting is a demo acknowledgement with no moderation queue
- Do not use this prototype to collect sensitive personal information or claim production-grade anonymity

## Next phase
Phase 3: moderation workflow, reporting backend, and enhanced community tooling.

## License
Private — UNSAID project