@AGENTS.md

# Verification before calling a task done
Run `npm run lint` and `npm run build` before considering a change complete. Fix errors these surface rather than leaving them for the user to find.

# Package manager
This repo uses npm exclusively (`package-lock.json` is the source of truth). Never introduce a `yarn.lock` or `pnpm-lock.yaml`, and don't suggest yarn/pnpm commands.

# Dependency versions
Key dependencies are newer than typical training data: Next.js 16.2.9, React 19.2.4, Prisma 7.8. Before using an API from these, check `node_modules/next/dist/docs/` (per AGENTS.md), `node_modules/prisma`, or the installed type defs rather than assuming familiar behavior. APIs have moved between major versions.

# Scope discipline
Keep changes scoped to what was asked. Don't refactor, rename, or "clean up" unrelated code while fixing a bug or adding a feature. Separate cleanup into its own explicitly-requested change.

# Secrets and config
`.env*` files are gitignored. Never read or write any `.env*` file (`.env`, `.env.local`, `.env.development.local`, etc.) by any means: no `Read`, `cat`, `Get-Content`, `grep`/`Select-String` over them, no `Write`/`Edit`, no shell redirection into them. Never commit them, print their contents, or hardcode values from them into source. If a task needs a new env var, tell the user in your summary which variable to add, to which file, and why. Do not add it yourself.

# Branching and commits (project conventions)
- I create and switch branches myself and name them `feature/*` or `bugfix/*`. Claude Code works on whichever branch is currently checked out and never creates or switches branches. If the checked out branch looks wrong for the task (for example `main` or `dev`), stop and ask me before making any changes.
- Branch naming: `feature/short-description` for new features, `bugfix/short-description` for bug fixes.
- Commit titles are plain, short, and present-tense, with no code block formatting. Example: "Add dashboard grid layout scaffold".
- Never invent, guess, or assume a version number (vX.X.XX). Use one only when my prompt gives it to you, and then the commit title starts with it, for example "v0.9.04: Short Title". Otherwise commit titles have no version number.
- Never use em dashes or en dashes anywhere: not in code comments, not in commit messages, not in any generated text. Use a comma, colon, or period instead.

# Environment variables: critical gotcha
- The running app (`src/auth.ts`, `src/lib/prisma.ts`) and `prisma/seed.ts` all build their database connection from five separate environment variables: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`. They do NOT read `DATABASE_URL`.
- Prisma CLI commands (`migrate dev`, `migrate deploy`, `migrate reset`) read `DATABASE_URL` from `prisma.config.ts` instead.
- This means a script or command that appears to target one database via `DATABASE_URL` may silently run against a completely different database if `DB_HOST`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` are set differently in the active environment.
- Before running any command that writes, seeds, or migrates data, explicitly check and state which actual database the current `DB_HOST`/`DB_NAME` values point to. Never assume `DATABASE_URL` and `DB_NAME` are in sync.
- Never run `prisma/seed.ts` or any destructive script without first confirming the active `DB_NAME` is not the live production database, unless explicitly instructed to target production.

# Prisma conventions
- Run `npx prisma format` before every migration.
- When adding a relation between two models that already share another relation, explicitly name it with `@relation("Name")` on both sides, or `prisma format` will error on ambiguous relations.
- Always include the migration name inline in migrate commands, e.g. `npx prisma migrate dev --name add_dashboard_and_widget_models`, never leave it to prompt interactively.

# Project structure
- Prisma schema at `prisma/schema.prisma`.
- API routes under `src/app/api/`, following Next.js App Router conventions (`route.ts` with GET/POST/PATCH/DELETE exports, params as a Promise in dynamic segments).
- Shared components in `src/components/`, organized by feature area (`src/components/inventory/`, `src/components/clients/`, etc).

# Design system conventions
- Use the tinted pill pattern for accent colored badges and status labels: `bg-brand-secondary-500/10 text-brand-secondary-500` style. Avoid hardcoding solid colors with manual dark mode overrides.
- Use existing `brand-primary`/`brand-secondary` CSS variable tokens for theming, never hardcoded hex colors, so everything respects each company's brand colors and both light and dark mode.
- `PSAsync-Design-Rules.md` is the authoritative reference for motion timing, visual hierarchy, tabs, modals, data tables, and forms. Follow it for anything not explicitly stated elsewhere. (Not yet added to the repo as of this writing; if it's missing, treat the rules above as the interim source of truth rather than an error.)

# Windows environment note
- The `postinstall` script uses touch-style file creation for `.env`, which can behave unexpectedly on Windows. If a fresh `npm install` fails around `.env` creation, this is likely why, not a real project error.

# Deployment note
- After any merge into `main` that includes new Prisma migration files, `npx prisma migrate deploy` must be run against the live production database. This is a manual step performed by the project owner, not something to run automatically as part of a build or deploy script.

## Commits

- Claude Code makes commits itself, locally only. Never create or switch branches, never push, never open pull requests, never merge, never amend or rewrite history, and never force anything. I handle all of that manually.
- Make several small commits instead of one big one. Commit when a logical piece of work or a phase is finished and the build and lint pass for it. Never commit broken or half finished work.
- Stage only the files that belong to each commit. Check git status before each commit and never stage .env files, .next, secrets, or stray files. A schema change and the migration folder it needs go in the same commit.
- Title: short, imperative, plain. Do not include a version number unless my prompt gives one. If it does, the title starts with it, for example "v0.9.04: Short Title".
- Titles match the existing repo history, for example "Fix category picker not updating on add catalog item form".
- Description: plain text, one to four sentences, saying what changed and why in user terms. Never put the description in a code block.
- Never use em dashes or en dashes in commit titles or descriptions.
- Never mention Claude, Claude Code, AI, Anthropic, or any assistant in a commit. No Co-Authored-By, no "Generated with", no trailers of any kind.
- At the end of every task, list the commits you made (short hash and title) in your report.
