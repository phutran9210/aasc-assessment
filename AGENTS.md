# Repository Guidelines

## Project Structure & Module Organization

This NestJS 12 TypeScript application keeps runtime code under `src/`: shared utilities in `src/common/`, infrastructure in `src/core/`, configuration in `src/config/`, and feature modules in `src/modules/` (`auth`, `user`, `task`, `caro`, and `line98`). Keep each feature's controllers, services, repositories, DTOs, entities, gateways, and tests together. Unit tests use `src/**/__tests__/*.spec.ts`; end to end tests are in `test/`. Browser assets are in `public/`, exercises in `scripts/fibonacci/`, and documents in `docs/`.

## Build, Test, and Development Commands

Run `pnpm install` and copy `.env.example` to `.env` for setup. Commands:

- `pnpm start:dev` — run the server with watch mode at `http://localhost:3000`.
- `pnpm build` / `pnpm start:prod` — compile to `dist/` and run the compiled app.
- `pnpm test` — run unit tests; `pnpm test:e2e` runs REST and WebSocket tests.
- `pnpm test:fibonacci` — run the Node test suite for the Fibonacci exercise.
- `pnpm lint`, `pnpm typecheck`, and `pnpm format:check` — run code and formatting checks.
- `pnpm check` — run linting, type checking, all test suites, and Fibonacci tests.

GNU Make aliases include `make setup`, `make dev`, `make check`, and `make docker-up`. `pnpm db:seed` deletes tasks before seeding; use it only with disposable data.

## Coding Style & Naming Conventions

Use two spaces, semicolons, single quotes, trailing commas, and a 100 character print width. Run Prettier and ESLint. Use `PascalCase` for classes, `camelCase` for variables and methods, and kebab-case filenames such as `task-query.dto.ts`. Prefer type-only imports, `type` aliases, and path aliases (`@common`, `@core`, `@modules`, `@config`).

## Testing Guidelines

Name unit tests `*.spec.ts` and end to end tests `*.e2e-spec.ts`; place unit tests beside the code under test in `__tests__/`. Add focused coverage for domain engines and services, and update `test/` when an API or WebSocket contract changes. Run `pnpm test:cov` when needed.

## Commit & Pull Request Guidelines

Use Conventional Commit prefixes shown in history, such as `feat(auth): ...`, `fix(task): ...`, `chore(docker): ...`, and `docs: ...`. Keep commits focused and describe the behavior or area changed. Pull requests should explain the change, list validation commands (normally `pnpm check`), mention configuration or database effects, link the issue or assessment item, and include screenshots for `public/` changes.

## Working With Running Processes

If a Chrome DevTools or Playwright process (browser, MCP server, or test runner) is already running, do not stop, kill, or restart it: it may belong to another session or to the developer. Start a separate process for your own work instead, for example a new browser instance, context, or page, on a different port or profile if needed. The same applies to broad commands such as `pkill chrome`, `pkill node`, or `pkill -f playwright`: never use them; only stop a process you started yourself, by its PID.

## Security & Configuration Tips

Never commit `.env`, SQLite data, tokens, or logs. Use a unique `JWT_SECRET` of at least 16 characters in production, review CORS and Swagger settings before deployment, and treat `DATABASE_SYNCHRONIZE=true` and the seed command as development-only settings.
