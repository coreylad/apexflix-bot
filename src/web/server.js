const path = require("path");
const express = require("express");
const morgan = require("morgan");
const { createApiRouter } = require("./routes/api");

function createWebServer({ config, logger, db, overseerr, jellyfin, envManager }) {
  const app = express();

  app.use(morgan("dev"));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const publicDir = path.join(__dirname, "public");
  app.use(express.static(publicDir));

  app.use(
    "/api",
    createApiRouter({
      db,
      overseerr,
      jellyfin,
      config,
      envManager
    })
  );

  app.get("/", (req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  app.use((err, req, res, next) => {
    logger.error(`API error: ${err.message}`);
    res.status(500).json({ error: err.message || "Internal server error" });
  });

  return {
    start: () =>
      new Promise((resolve) => {
        const server = app.listen(config.app.port, () => {
          logger.info(`Web UI listening on port ${config.app.port}`);
          resolve(server);
        });
      })
  };
}

module.exports = { createWebServer };
