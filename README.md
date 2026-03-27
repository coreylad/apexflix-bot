# ApexFlix Community Bot

A self-contained Node.js app that runs:
- A Discord bot for media discovery and requests
- Integrations for Overseerr and Jellyfin
- A built-in web dashboard/UI
- Local SQLite persistence for user links and request tracking

## Features

- Slash commands for searching and requesting media
- User linking between Discord and Overseerr user accounts
- Request status checks and DM notifications on status changes
- Web UI for health, recent requests, and latest Jellyfin items
- Private web login with session-based authentication
- In-browser `.env` editor (no manual file editing needed)
- Single-process Node runtime (bot + API + dashboard)

## Requirements

- Node.js 20+
- Running Jellyfin instance
- Running Overseerr instance
- Discord bot token and app/client ID

## Quick Start (Linux-first)

1. Install dependencies:

```bash
npm install
```

2. Create env file:

```bash
cp .env.example .env
```

3. Edit `.env` with your Discord, Overseerr, and Jellyfin credentials.

You can skip manual `.env` editing and set everything through the web UI after startup.

4. Start in development:

```bash
npm run dev
```

5. Start in production:

```bash
npm start
```

## Discord Commands

- `/link overseerr_username:<name>`
- `/search query:<title> media_type:<all|movie|tv>`
- `/request media_id:<id> media_type:<movie|tv>`
- `/status request_id:<id>`
- `/recent`

## Web UI

- Dashboard: `http://localhost:1337/`
- Login is required for dashboard and all non-health API routes.
- Health API: `GET /api/health`
- Recent requests: `GET /api/requests/recent`
- Latest Jellyfin items: `GET /api/jellyfin/latest`

### Default admin login

- Username: `admin`
- Password: `admin12345`

Change this password immediately from the dashboard.

## Notes

- This app uses local SQLite in `data/app.db`.
- Slash commands are registered to the guild configured by `DISCORD_GUILD_ID`.
- For DM notifications, users must allow server DMs or share a mutual server with the bot.
- Saving env values from the web UI updates runtime settings for web integrations immediately.
- If you change Discord token/client/guild values, restart the app to reconnect the bot with new credentials.
