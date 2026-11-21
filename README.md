# UNSAID — Phase 2 MVP

Phase 2 builds on the initial UNSAID frontend and adds a more complete anonymous posting and discovery experience.

## What's included
- Create anonymous text posts with category and up to five optional tags
- Client-side validation (12–1,200 characters)
- Persist posts in the current browser using localStorage
- Feed with category filtering, text/tag search, latest/trending/most-discussed sorting
- Individual post detail routes (`/post/:id`) with browser back/forward support
- Edit and delete posts created in this browser
- Meaningful reactions with one reaction per post/type per page session
- Save/unsave posts locally and browse the saved-thoughts collection
- Copy post link
- Responsive layout, light/dark mode, mobile navigation

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
