# ApexFlix Setup Guide

This guide covers:
- Installing and running ApexFlix on Linux
- Creating a Discord bot application
- Connecting Jellyfin and Overseerr
- Managing settings from the browser
- Running ApexFlix under systemd

## 1. Server Requirements

Recommended baseline:
- Linux server or VM
- Node.js 20 or newer
- npm
- Running Jellyfin instance
- Running Overseerr instance
- A Discord server where you can install the bot

## 2. Install Node.js 20 on Ubuntu or Debian

If Node.js 20 is not already installed:

```bash
sudo apt update
sudo apt install -y curl ca-certificates gnupg
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

You should see Node 20.x or newer.

## 3. Get the Project Running

If you are deploying from a git checkout:

```bash
cd /opt
sudo git clone <your-repo-url> apexflix
sudo chown -R $USER:$USER /opt/apexflix
cd /opt/apexflix
npm install
npm start
```

By default the web UI listens on:

```text
http://localhost:1337/
```

If you are accessing it from another machine, use the server IP or reverse proxy.

## 4. First-Run Setup and Web-Based Configuration

ApexFlix can be configured entirely from the browser.

1. Open the dashboard at `http://YOUR_SERVER_IP:1337/`
2. On a brand new install, the first-run wizard appears automatically.
3. Create your first admin username and password.
4. Fill in the configuration values in the same wizard:

```text
DISCORD_TOKEN
DISCORD_CLIENT_ID
DISCORD_GUILD_ID
OVERSEERR_URL
OVERSEERR_API_KEY
OVERSEERR_DEFAULT_USER_ID
JELLYFIN_URL
JELLYFIN_API_KEY
JELLYFIN_USER_ID
PORT
REQUEST_STATUS_POLL_SECONDS
LOG_LEVEL
```

5. Submit the wizard to create the admin account and save the environment.
6. After setup completes, you are taken into the private dashboard.
7. Restart ApexFlix after changing Discord credentials so the bot reconnects with the new token and app IDs.

Notes:
- Jellyfin and Overseerr settings are applied to runtime immediately after saving.
- Discord token, client ID, and guild ID should be treated as restart-required values.
- On later visits, you will see the login screen instead of the setup wizard.

## 5. How to Create the Discord Bot

### Create the application

1. Go to the Discord Developer Portal:

```text
https://discord.com/developers/applications
```

2. Click `New Application`.
3. Enter a name such as `ApexFlix`.
4. Open the new application.

### Create the bot user

1. Open the `Bot` section.
2. Click `Add Bot`.
3. Under the bot page, copy the bot token.
4. Put that token into `DISCORD_TOKEN` in the ApexFlix web UI.

### Get the application client ID

1. Open `General Information`.
2. Copy the `Application ID`.
3. Put it into `DISCORD_CLIENT_ID`.

### Get the guild ID for your server

1. In Discord, enable Developer Mode:

```text
User Settings > Advanced > Developer Mode
```

2. Right-click your server.
3. Click `Copy Server ID`.
4. Put that value into `DISCORD_GUILD_ID`.

### Recommended bot settings

In the bot settings page:
- Keep `Public Bot` disabled unless you want anyone to add it.
- `Server Members Intent` is not required for the current feature set.
- `Message Content Intent` is not required for slash-command usage.

### Invite the bot to your server

In the Developer Portal:
1. Open `OAuth2`.
2. Open `URL Generator`.
3. Select these scopes:

```text
bot
applications.commands
```

4. Select these bot permissions:

```text
View Channels
Send Messages
Embed Links
Use Application Commands
Read Message History
```

5. Copy the generated URL.
6. Open it in a browser and add the bot to your server.

### Restart ApexFlix after entering Discord settings

After saving the Discord values in the dashboard:

```bash
sudo systemctl restart apexflix
```

Or if running manually:

```bash
Ctrl+C
npm start
```

## 6. Finding the Jellyfin and Overseerr Values

### Overseerr

You need:
- `OVERSEERR_BASE_URL`
- `OVERSEERR_API_KEY`
- `OVERSEERR_DEFAULT_USER_ID`

How to get them:
1. Log in to Overseerr.
2. Open `Settings`.
3. Open `General` or `API Key` depending on your version.
4. Copy the API key.
5. Base URL is the full URL to your Overseerr instance, for example:

```text
http://192.168.1.20:5055
```

6. Default user ID is the Overseerr user ID to use when a Discord user has not linked their own account yet.

### Jellyfin

You need:
- `JELLYFIN_BASE_URL`
- `JELLYFIN_API_KEY`
- `JELLYFIN_USER_ID`

How to get them:
1. Log in to Jellyfin as an admin.
2. Go to `Dashboard`.
3. Open `API Keys` and create a new key.
4. Copy the key into `JELLYFIN_API_KEY`.
5. Base URL is the full Jellyfin URL, for example:

```text
http://192.168.1.20:8096
```

6. For the user ID, open Jellyfin in a browser as the target user and inspect the URL or API responses depending on your setup. Use the user ID for the account whose library/recent items you want to display.

## 7. Running with systemd

Create a dedicated service user:

```bash
sudo useradd --system --create-home --home-dir /opt/apexflix --shell /usr/sbin/nologin apexflix
sudo chown -R apexflix:apexflix /opt/apexflix
```

Install dependencies as that user if needed:

```bash
cd /opt/apexflix
sudo -u apexflix npm install
```

Copy the provided service file:

```bash
sudo cp deploy/systemd/apexflix.service /etc/systemd/system/apexflix.service
```

If your Node binary is not at `/usr/bin/npm`, edit the service file first:

```bash
which npm
which node
```

Then reload and enable the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable apexflix
sudo systemctl start apexflix
```

Check status:

```bash
sudo systemctl status apexflix
```

View logs:

```bash
journalctl -u apexflix -f
```

Restart after config changes:

```bash
sudo systemctl restart apexflix
```

## 8. Example Reverse Proxy Notes

If you do not want to expose port 1337 directly, place Nginx or Caddy in front of ApexFlix and proxy traffic to:

```text
http://127.0.0.1:1337
```

This is the recommended setup if you want HTTPS from the internet.

### Reverse proxy URL examples for Overseerr/Jellyfin

If Overseerr is behind your proxy at `https://media.example.com/overseerr`, set:

```text
OVERSEERR_URL=https://media.example.com/overseerr
```

If Jellyfin is behind your proxy at `https://media.example.com/jellyfin`, set:

```text
JELLYFIN_URL=https://media.example.com/jellyfin
```

Use the full URL exactly as it is reachable from the ApexFlix server.

### Run ApexFlix itself behind a reverse proxy on a subpath

Set in ApexFlix:

```text
TRUST_PROXY=true
APP_BASE_PATH=/apexflix
PORT=1337
```

Then ApexFlix will serve UI/API at `/apexflix` and `/apexflix/api`.

### Nginx example for subpath hosting

```nginx
server {
	listen 443 ssl;
	server_name apps.example.com;

	# ssl_certificate ...
	# ssl_certificate_key ...

	location /apexflix/ {
		proxy_pass http://127.0.0.1:1337/apexflix/;
		proxy_http_version 1.1;
		proxy_set_header Host $host;
		proxy_set_header X-Real-IP $remote_addr;
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto $scheme;
		proxy_set_header Upgrade $http_upgrade;
		proxy_set_header Connection "upgrade";
	}
}
```

If your proxy TLS certificate is self-signed for upstream integrations, set:

```text
OVERSEERR_ALLOW_INSECURE_TLS=true
JELLYFIN_ALLOW_INSECURE_TLS=true
```

Use these only when necessary.

## 9. Updating the App

To update later:

```bash
cd /opt/apexflix
git pull
npm install
sudo systemctl restart apexflix
```

## 10. Common Checks

If the web UI loads but Discord features do not work:
- Confirm `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and `DISCORD_GUILD_ID` are correct.
- Confirm the bot was invited with `applications.commands` scope.
- Restart the service after changing Discord settings.

If Jellyfin latest items fail:
- Confirm base URL, API key, and user ID.
- Confirm the target user can access the library you expect.

If Overseerr search/request fails:
- Confirm the API key and base URL.
- Confirm Overseerr is reachable from the ApexFlix host.
- Confirm the default user ID exists.

If login fails:
- Make sure you are using the admin account created during first-run setup.
- If necessary, stop the app and remove `data/app.db` to reset the local database and force the setup wizard to appear again.
