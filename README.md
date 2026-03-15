# wazuh-web-manager

A lightweight web GUI for managing a Wazuh instance running in Docker. Built with Node.js (Express) and vanilla JS — no frontend build step required.

## Features

- **Rules & Decoders** — browse, create, edit, and delete custom XML files with a syntax-highlighted CodeMirror editor. Inline log tester runs `wazuh-logtest` against any log line.
- **Agents** — view all enrolled agents with status, OS, version, last seen. Enroll new agents with generated install commands for Linux, Windows, and macOS. Remove agents.
- **ossec.conf** — read and write the main Wazuh configuration file directly from the container, with a full XML editor and manager status overview.
- **Reload Manager** — trigger `wazuh-control restart` from any page via the sidebar button.
- **Dual connection** — Docker socket for file I/O (`CopyFromContainer` / `CopyToContainer`), Wazuh REST API for agent and group management.
- **Auto-discovery** — finds the `wazuh-manager` container automatically, no manual config needed for standard Docker deployments.

## Requirements

- Node.js 18+
- Docker running locally (or accessible via `DOCKER_HOST`)
- A running [Wazuh Docker](https://github.com/wazuh/wazuh-docker) deployment

## Setup

```bash
git clone https://github.com/yourusername/wazuh-web-manager
cd wazuh-web-manager
npm install

cp .env.example .env
# Edit .env with your Wazuh API credentials and container name
```

### `.env`

```env
WAZUH_API_URL=https://localhost:55000
WAZUH_API_USER=wazuh
WAZUH_API_PASS=wazuh

# Optional: specify container name if auto-discovery fails
WAZUH_CONTAINER=

PORT=8080
```

## Running

```bash
# Production
npm start

# Development (auto-restart on file changes, Node 18+)
npm run dev
```

Open [http://localhost:8080](http://localhost:8080).

## Project Structure

```
wazuh-web-manager/
├── server.js                  # Express app, route mounting
├── .env.example
├── package.json
├── src/
│   ├── docker.js              # Dockerode wrapper — file R/W, exec, auto-discovery
│   ├── wazuh-api.js           # Wazuh REST API — auth, agents, groups
│   └── routes/
│       ├── rules.js           # /api/rules  and  /api/decoders
│       ├── agents.js          # /api/agents
│       └── config.js          # /api/config/ossec, /api/config/status, /api/config/reload
└── public/
    ├── index.html             # App shell, templates, CodeMirror CDN
    ├── css/style.css          # Dark theme
    └── js/
        ├── app.js             # Router, toast, modals, shared utils
        ├── rules.js           # Rules & decoders page
        ├── agents.js          # Agents page
        └── config.js          # ossec.conf page
```

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Container connection status |
| GET | `/api/rules` | List rule files |
| GET | `/api/rules/:filename` | Read rule file |
| PUT | `/api/rules/:filename` | Create or update rule file |
| DELETE | `/api/rules/:filename` | Delete rule file |
| POST | `/api/rules/actions/reload` | Reload Wazuh manager |
| POST | `/api/rules/actions/logtest` | Run wazuh-logtest |
| GET | `/api/decoders` | List decoder files |
| GET | `/api/decoders/:filename` | Read decoder file |
| PUT | `/api/decoders/:filename` | Create or update decoder file |
| DELETE | `/api/decoders/:filename` | Delete decoder file |
| GET | `/api/agents` | List agents |
| GET | `/api/agents/:id` | Get single agent |
| POST | `/api/agents/enroll` | Create agent + generate install commands |
| DELETE | `/api/agents/:id` | Remove agent |
| PUT | `/api/agents/:id/group/:group` | Assign agent to group |
| GET | `/api/agents/groups/list` | List groups |
| POST | `/api/agents/groups` | Create group |
| DELETE | `/api/agents/groups/:name` | Delete group |
| GET | `/api/config/ossec` | Read ossec.conf |
| PUT | `/api/config/ossec` | Write ossec.conf |
| GET | `/api/config/status` | Manager info + container status |
| POST | `/api/config/reload` | Reload Wazuh manager |

## Notes

- The Wazuh API uses a self-signed certificate in the default Docker setup. TLS verification is disabled for local use (`rejectUnauthorized: false`). For production deployments, configure a proper certificate and re-enable verification in `src/wazuh-api.js`.
- The `000` agent (the manager itself) cannot be removed and has no remove button in the UI.
- Agent install commands reference Wazuh 4.7.3 — update the version strings in `src/wazuh-api.js` (`buildEnrollCommands`) to match your deployment.

## License

MIT
