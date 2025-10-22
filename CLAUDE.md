# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Memos is an open-source, self-hosted knowledge management platform with a Go backend and React frontend. The application uses gRPC-Web with Protocol Buffers for frontend-backend communication and supports multiple database backends (SQLite, PostgreSQL, MySQL).

## Essential Development Commands

### Backend Development
- `go run ./cmd/memos --mode dev --port 8081` - Start the backend server in development mode (default port 8081)
- `go build ./cmd/memos` - Build the backend binary
- `go test ./...` - Run all Go tests
- `./scripts/build.sh` - Cross-platform build script (creates executable in `./build/`)
- `go test ./... -v` - Run tests with verbose output

### Frontend Development
- `cd web && pnpm install` - Install frontend dependencies
- `cd web && pnpm dev` - Start Vite development server (default port 3001)
- `cd web && pnpm build` - Build frontend for production (to `web/dist/`)
- `cd web && pnpm release` - **Critical**: Build frontend and copy assets to `server/router/frontend/dist/` for embedded serving
- `cd web && pnpm lint` - Run TypeScript and ESLint checks

### Database Management
- Database migrations are automatically applied on startup
- SQLite: Default embedded database, file location configurable
- MySQL/PostgreSQL: External database support via connection string
- Data directory: `~/.memos/` (default location for all data files)

### Protocol Buffers
- API definitions in `proto/api/v1/` (public) and `proto/store/` (internal)
- Managed with Buf tool (`proto/buf.yaml` configuration)
- Generated Go code in `proto/gen/`
- Run `buf generate` to regenerate code after proto changes

## Architecture Overview

### Backend (Go)
- **Entry Point**: `cmd/memos/main.go` - Cobra CLI with dev/prod/demo modes
- **HTTP Server**: Echo framework in `server/` with gRPC-Web proxy support
- **API Layer**: Dual-mode communication (HTTP + gRPC-Web) in `server/router/api/v1/`
- **Business Logic**: Shared core logic in `internal/` (base, profile, util, version)
- **Data Layer**: Three-layer abstraction (Store → Driver → Database) in `store/`
- **Database Support**: SQLite (default), PostgreSQL, MySQL with auto-migrations
- **Configuration**: Viper-based config management with environment variables

### Frontend (React)
- **Framework**: React 18 + TypeScript + Vite 7
- **Styling**: Tailwind CSS v4 + Emotion CSS-in-JS
- **State Management**: MobX (observable stores for memo, user, etc.)
- **Routing**: React Router v7 with modern APIs
- **UI Components**: Radix UI primitives (headless components)
- **Rich Features**: Markdown rendering, syntax highlighting, math (KaTeX), diagrams (Mermaid)

### Communication Architecture
- **Dual Protocol Support**:
  - HTTP/JSON via gRPC-Gateway for compatibility
  - Native gRPC-Web for performance
- **Protocol Buffers**: Type-safe API contracts in `proto/`
- **Development**: Frontend dev server proxies API calls to backend
- **Production**: Frontend assets embedded in backend binary

## Critical Development Workflow

1. **Frontend Changes**: After modifying frontend code, run `pnpm release` to update the embedded assets in the backend
2. **API Changes**: Update Protocol Buffer definitions in `proto/`, then run `buf generate` to regenerate code
3. **Database Changes**: Add migration files to `store/migration/{database}/` following the versioning pattern (e.g., `1__init.sql`)
4. **Development Setup**: Start backend on port 8081 and frontend on port 3001 for hot reload
5. **Production Build**: Run `pnpm release` then `go build ./cmd/memos` to create self-contained binary

## Key Directories

- `cmd/memos/` - Application entry point with CLI configuration
- `server/` - HTTP server, API routes, and gRPC-Web proxy configuration
- `internal/` - Core business logic (base, profile, util, version)
- `store/` - Data access layer with database abstraction and migrations
  - `store/migration/` - Database schema migrations by database type
  - `store/db/` - Database driver implementations
- `web/src/` - React frontend source code with components and stores
  - `web/src/store/` - MobX stores for state management
  - `web/src/components/` - Reusable React components
- `proto/` - Protocol Buffer API definitions and generated code
  - `proto/api/v1/` - Public API definitions
  - `proto/store/` - Internal data structures
  - `proto/gen/` - Generated Go code
- `plugin/` - Extension modules (cron jobs, filters, storage, webhooks)
- `scripts/` - Build and deployment scripts (Docker, entrypoint)

## Development Mode Architecture

- **Backend**: `go run ./cmd/memos --mode dev --port 8081`
- **Frontend**: `cd web && pnpm dev` (serves on port 3001, proxies API to backend)
- **Data Flow**: Frontend → Vite proxy → Backend gRPC-Web → Database
- **Hot Reload**: Both frontend and backend support hot reload in development