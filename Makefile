# AASC Assessment - common commands. Run `make` or `make help` to list them.

SHELL := /bin/sh
.DEFAULT_GOAL := help

# Number of sample tasks for `make seed` (override: make seed COUNT=250).
COUNT ?= 100
COMPOSE := docker compose

.PHONY: help install env setup dev build start seed fibonacci sync-leads sync-leads-dry \
        test test-e2e test-fibonacci check lint format clean \
        docker-build docker-up docker-down docker-restart docker-logs docker-ps docker-shell docker-clean

help: ## Show this list
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z0-9_-]+:.*## / {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ── Local (Node.js + pnpm) ────────────────────────────────────────────

install: ## Install dependencies
	pnpm install

env: ## Create .env from .env.example (keeps an existing .env)
	@test -f .env && echo ".env already exists, left unchanged" || (cp .env.example .env && echo "Created .env from .env.example")

setup: install env ## First-time setup: install dependencies and create .env

dev: env ## Run in watch mode at http://localhost:3000
	pnpm start:dev

build: ## Compile to dist/
	pnpm build

start: env build ## Build and run the compiled app
	pnpm start:prod

seed: env ## Seed sample tasks, DELETES existing tasks (COUNT=100)
	pnpm db:seed $(COUNT)

fibonacci: ## Bai 2: verify and time F(50)
	pnpm fibonacci

sync-leads: env ## Sync leads from Google Sheets to Bitrix24 once
	pnpm sync:leads

sync-leads-dry: env ## Plan the lead sync without writing anything
	pnpm sync:leads --dry-run

# ── Quality ───────────────────────────────────────────────────────────

test: ## Unit tests
	pnpm test

test-e2e: ## End-to-end tests (REST + WebSocket)
	pnpm test:e2e

test-fibonacci: ## Tests of Bai 2
	pnpm test:fibonacci

check: ## Lint + typecheck + every test suite
	pnpm check

lint: ## ESLint
	pnpm lint

format: ## Prettier (writes changes)
	pnpm format

clean: ## Remove build output and coverage (keeps data/ and node_modules/)
	rm -rf dist coverage *.tsbuildinfo

# ── Docker ────────────────────────────────────────────────────────────

docker-build: env ## Build the Docker image
	$(COMPOSE) build

docker-up: env ## Build and start the container in the background
	$(COMPOSE) up -d --build
	@echo "App: http://localhost:$$(grep -E "^PORT=" .env | cut -d= -f2 | grep . || echo 3000)"

docker-down: ## Stop and remove the container (data volume is kept)
	$(COMPOSE) down

docker-restart: ## Restart the container
	$(COMPOSE) restart

docker-logs: ## Follow the container logs
	$(COMPOSE) logs -f app

docker-ps: ## Show container status and health
	$(COMPOSE) ps

docker-shell: ## Open a shell inside the running container
	$(COMPOSE) exec app sh

docker-clean: ## Stop the container and DELETE its data volume
	$(COMPOSE) down --volumes
