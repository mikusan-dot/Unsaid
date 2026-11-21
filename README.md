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
