# KanbanSync

Multi-Platform Task Synchronization Agent with AI Chat Interface

## Quick Start

1. **Backend Setup:**
   ```bash
   cd backend
   npm install
   cp .env.example .env
   # Configure your environment variables
   npm run dev
   ```

2. **Frontend Setup:**
   ```bash
   cd frontend
   npm install
   cp .env.example .env
   # Configure your environment variables
   npm start
   ```

3. **Database Setup:**
   ```bash
   # Ensure PostgreSQL is running
   npm run db:migrate
   ```

## Architecture

- **Backend:** Node.js + Express + PostgreSQL
- **Frontend:** React + TypeScript
- **Agent:** Skills-based orchestration
- **Deployment:** Railway (backend) + Vercel (frontend)

## Features

- Connect multiple kanban platforms (Asana, Trello, Monday, ClickUp, Jira)
- Natural language sync rule creation via chat
- Automated webhook-based synchronization
- Intelligent field mapping
- Real-time status notifications

## Documentation

- [Setup Guide](docs/SETUP.md)
- [Deployment Guide](docs/DEPLOYMENT.md)
- [API Reference](docs/API.md)
- [Architecture Overview](docs/ARCHITECTURE.md)