# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Memos is an open-source, self-hosted knowledge management platform with a Go backend and React frontend. The application uses gRPC-Web with Protocol Buffers for frontend-backend communication and supports multiple database backends (SQLite, PostgreSQL, MySQL).

## Essential Development Commands

### Backend Development
- `go run ./cmd/memos --mode dev --port 8081` - Start the backend server in development mode
- `go build ./cmd/memos` - Build the backend binary
- `go test ./...` - Run all Go tests

### Frontend Development
- `cd web && pnpm install` - Install frontend dependencies
- `cd web && pnpm dev` - Start Vite development server (port 3001)
- `cd web && pnpm build` - Build frontend for production
- `cd web && pnpm release` - **Critical**: Build frontend and copy assets to `server/router/frontend/dist/`
- `cd web && pnpm lint` - Run TypeScript and ESLint checks

### Protocol Buffers
- API definitions are in `proto/api/v1/` and `proto/store/`
- Managed with Buf tool (`buf.yaml` configuration)
- Generated Go code is in `proto/gen/`

## Architecture Overview

### Backend (Go)
- **Entry Point**: `cmd/memos/main.go`
- **HTTP Server**: Echo framework in `server/`
- **API Layer**: gRPC-Web services in `server/router/api/v1/`
- **Business Logic**: Shared logic in `internal/`
- **Data Layer**: Database abstraction in `store/` with migrations in `store/migration/`

### Frontend (React)
- **Framework**: React 18 + TypeScript + Vite
- **Styling**: Tailwind CSS v4
- **State Management**: MobX
- **Routing**: React Router v7
- **UI Components**: Radix UI primitives

### Communication
- gRPC-Web for API calls
- Protocol Buffers define API contracts
- Frontend proxies API requests to backend during development

## Critical Development Workflow

1. **Frontend Changes**: After modifying frontend code, run `pnpm release` to update the embedded assets in the backend
2. **API Changes**: Update Protocol Buffer definitions in `proto/`, then regenerate code
3. **Database Changes**: Add migration files to `store/migration/{database}/` following the versioning pattern
4. **Development Setup**: Start backend on port 8081 and frontend on port 3001 for hot reload

## Key Directories

- `cmd/memos/` - Application entry point
- `server/` - HTTP server and API routes
- `internal/` - Core business logic and utilities
- `store/` - Data access layer, migrations, and database drivers
- `web/src/` - React frontend source code
- `proto/` - Protocol Buffer API definitions and generated code
- `plugin/` - Extension modules (cron, filter, storage, webhook)
- `scripts/` - Build and deployment scripts