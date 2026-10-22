# Atlas Signal

Next.js App Router, TypeScript and MapLibre GL. Keep the map primary; calm, neutral interfaces.

## Working agreements

- Live source records only. No fictional scenarios, demo mode, seeded events, or fabricated source relationships may enter the application or its APIs. Synthetic fixtures belong only in tests.
- Preserve publisher wording and provenance. Do not claim a source is unbiased, independently verified, or corroborated merely because it is reachable or repeated.
- Unassessed severity and confidence are `null`, not invented numerical scores. Derived hazard severity must disclose its basis.
- Missing coordinates stay missing. Never imply that analytical risk or automated scoring is verified fact.
- Source URLs must use HTTP(S); provider endpoints are configured, never arbitrary user-controlled fetch targets.
- Keep shared contracts in `src/types/index.ts`. Coordinate before changing them.
- Prefer small modules and CSS modules for isolated components. The application shell uses `src/app/globals.css`.
- Check `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`.
- Do not add paid-service requirements to the default local experience.
- Read `docs/architecture.md` and `docs/operations.md` for data flow and production boundaries.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
