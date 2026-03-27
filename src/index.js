const config = require("./config");
const { createLogger } = require("./logger");
const { initializeDatabase } = require("./db");
const { createOverseerrClient } = require("./services/overseerr");
const { createJellyfinClient } = require("./services/jellyfin");
const { createDiscordBot } = require("./bot/client");
const { createWebServer } = require("./web/server");
const { createRequestPoller } = require("./services/requestPoller");
const { createEnvManager } = require("./services/envManager");

async function bootstrap() {
  const logger = createLogger(config.app.logLevel);
  const db = initializeDatabase(logger);
  const envManager = createEnvManager();

  const overseerr = createOverseerrClient(config.overseerr);
  const jellyfin = createJellyfinClient(config.jellyfin);

  const bot = createDiscordBot({
    config,
    logger,
    db,
    overseerr,
    jellyfin
  });

  const web = createWebServer({
    config,
    logger,
    db,
    overseerr,
    jellyfin,
    envManager,
    bot
  });

  const poller = createRequestPoller({
    config,
    logger,
    db,
    overseerr,
    bot
  });

  await web.start();
  await bot.start();
  poller.start();

  process.on("SIGINT", () => {
    logger.info("Shutting down due to SIGINT");
    poller.stop();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    logger.info("Shutting down due to SIGTERM");
    poller.stop();
    process.exit(0);
  });
}

bootstrap().catch((error) => {
  console.error("Fatal startup error:", error);
  process.exit(1);
});
