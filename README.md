# Wazuh Docker Config Manager

> A local web dashboard for managing Wazuh Docker configuration, agents, lists, backups, and container operations from one place.

---

## My Problem

Running Wazuh in Docker is convenient, but operational changes still end up split across containers, API calls, XML files, CDB lists, ad hoc backups, and shell access. That slows down routine admin work and makes safe change management harder than it needs to be.

## What it is NOT

- **Not a SIEM replacement**: it does not replace the Wazuh dashboard or alerting workflow
- **Not a hosted control plane**: this app is intended to run locally or inside your own Docker environment
- **Not a full cluster orchestrator**: it helps operate a Wazuh Docker deployment, but it is not a generic container platform
- **Not a scanner or security automation engine**: it manages Wazuh state and files, it does not perform offensive actions

## What it IS

- **A local web application**: the dashboard runs as a small Node.js app with a browser UI
- **A Docker-aware Wazuh admin surface**: it reads and writes manager files through the Docker socket and uses the Wazuh REST API for agent operations
- **A change-management tool**: history, restore points, conflict checks, and backup import/export are built around safer config editing
- **A practical operator interface**: rules, decoders, `ossec.conf`, agent enrollment, CDB lists, and container controls are exposed in one workflow

## Workspace Model

The app works across three operational layers:

- **Wazuh API session**: users sign in with Wazuh API credentials and receive a server-side session
- **Manager files**: rules, decoders, lists, and `ossec.conf` are read from and written back into the Wazuh manager container
- **Operational history**: edits and restore actions can be snapshotted so changes remain traceable and reversible

This keeps authentication, file operations, and rollback concerns separated while still presenting them as one UI.

## Tech Stack

| Area | Technology | Notes |
|---|---|---|
| Runtime | Node.js | App server runtime |
| Backend | Express | API routes, sessions, and static asset serving |
| Frontend | Vanilla JavaScript | No frontend build step |
| Auth | `express-session` | Session-backed login after Wazuh API authentication |
| Wazuh API access | `axios` | REST calls to the manager API |
| Container access | `dockerode` | File I/O and container lifecycle operations |
| XML parsing | `fast-xml-parser` | Wazuh config and rule handling |
| Backup format | `jszip` | Export and restore ZIP backups |
| Upload handling | `multer` | Backup restore uploads |
| Containerization | Docker / Docker Compose | Optional deployment mode |

## Features

**Rules & Decoders**
- Browse, create, edit, and delete custom XML files
- Run inline rule-ID conflict checks before saving
- Detect collisions between custom rules and overrides against the default Wazuh ruleset
- Keep history snapshots for restore workflows

**Configuration**
- Read and update `ossec.conf`
- View manager/container health details
- Trigger manager reload/restart operations from the UI

**Agents**
- List enrolled agents with metadata and status
- Enroll new agents using generated install commands
- Remove agents and manage agent groups through the Wazuh API

**CDB Lists**
- Create, edit, and delete files under `/var/ossec/etc/lists`
- Parse list content into structured key/value rows and write it back safely

**Backups & Restore**
- Export `ossec.conf`, custom rules, and custom decoders into a ZIP archive
- Preview uploaded backup contents before restore
- Restore from ZIP while snapshotting previous file state first when possible

**Container Controls**
- Discover Wazuh-related containers
- Start, stop, and restart containers from the app

## Security Model

This project is designed around a trusted operator managing a trusted Wazuh environment.

High-level security position:

- users authenticate with real Wazuh API credentials
- the app stores only the validated API token inside the session
- most API routes require an authenticated session
- Docker socket access is powerful by design and should be treated as privileged
- default Wazuh Docker setups often use self-signed TLS, so API verification is currently disabled for local practicality

This means the app is useful for local/admin environments, but it should be deployed deliberately and not exposed casually to untrusted networks.

## Requirements

- Node.js 18+
- Docker access to the Wazuh manager environment
- A reachable Wazuh REST API endpoint
- A running Wazuh Docker deployment

## Quick Start

### Docker Compose

```bash
docker compose up -d --build
```

By default the app listens on `http://localhost:8080`.

The Compose setup expects:

- `/var/run/docker.sock` mounted into the app container
- access to the external Wazuh Docker network
- `WAZUH_API_PASS` and `SESSION_SECRET` provided as environment variables

### Running with Node.js

```bash
npm install
npm start
```

Create environment variables before starting the app:

```env
PORT=8080
WAZUH_API_URL=https://single-node-wazuh.manager-1:55000
WAZUH_API_USER=wazuh-wui
WAZUH_API_PASS=change-me
WAZUH_CONTAINER=single-node-wazuh.manager-1
WAZUH_DASHBOARD_PORT=443
SESSION_SECRET=change-me-to-a-random-string
COOKIE_SECURE=false
DATA_DIR=./data
```

In production, `SESSION_SECRET` must be set to a non-default value or the server will refuse to start.

## Login Model

Users sign in through the app with the same credentials used for the Wazuh REST API. After successful authentication, the server stores the validated token in the session and uses that session to gate the rest of the API.

Public routes are intentionally limited to:

- `GET /api/health`
- `GET /api/config/info`
- `/api/auth/*`

## API Surface

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Docker/container health status |
| GET | `/api/config/info` | Public config hints for login |
| POST | `/api/auth/login` | Authenticate with Wazuh API credentials |
| POST | `/api/auth/logout` | End current app session |
| GET | `/api/auth/me` | Return current session info |
| GET | `/api/rules` | List custom rule files |
| GET | `/api/rules/:filename` | Read a rule file |
| PUT | `/api/rules/:filename` | Create or update a rule file |
| DELETE | `/api/rules/:filename` | Delete a rule file |
| GET | `/api/decoders` | List custom decoder files |
| GET | `/api/decoders/:filename` | Read a decoder file |
| PUT | `/api/decoders/:filename` | Create or update a decoder file |
| DELETE | `/api/decoders/:filename` | Delete a decoder file |
| GET | `/api/agents` | List agents |
| POST | `/api/agents/enroll` | Enroll agent and generate install commands |
| GET | `/api/config/status` | Manager and config status |
| GET | `/api/config/ossec` | Read `ossec.conf` |
| PUT | `/api/config/ossec` | Write `ossec.conf` |
| POST | `/api/config/reload` | Reload or restart manager services |
| GET | `/api/lists` | List CDB files |
| GET | `/api/lists/:name` | Read and parse a CDB file |
| PUT | `/api/lists/:name` | Save a CDB file |
| POST | `/api/lists` | Create a new CDB file |
| DELETE | `/api/lists/:name` | Delete a CDB file |
| GET | `/api/conflicts` | Full custom/default rule conflict report |
| POST | `/api/conflicts/check` | Check one file’s rule IDs before save |
| GET | `/api/history` | List change snapshots |
| GET | `/api/history/:id` | Read a snapshot |
| POST | `/api/history/:id/restore` | Restore a snapshot |
| GET | `/api/backup/download` | Download ZIP backup |
| POST | `/api/backup/preview` | Preview uploaded backup contents |
| POST | `/api/backup/restore` | Restore uploaded ZIP backup |
| GET | `/api/containers` | List Wazuh containers |
| POST | `/api/containers/:name/start` | Start container |
| POST | `/api/containers/:name/stop` | Stop container |
| POST | `/api/containers/:name/restart` | Restart container |

## Notes

- Default Wazuh Docker deployments often use self-signed certs, so TLS verification is disabled in the current API client
- The Docker socket effectively grants privileged access to the Docker host; treat deployment accordingly
- The external network name in `docker-compose.yml` must match your Wazuh deployment
- Persist `/app/data` if you want history and related state to survive container recreation

## AI Disclosure

See [AI-DISCLOSURE.md](./AI-DISCLOSURE.md).
