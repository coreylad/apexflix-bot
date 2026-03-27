const path = require("path");
const express = require("express");
const morgan = require("morgan");
const { createApiRouter } = require("./routes/api");

function normalizeBasePath(raw) {
  const value = (raw || "/").trim();
  if (!value || value === "/") {
    return "/";
  }

  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  return withLeadingSlash.replace(/\/+$/, "");
}

function createWebServer({ config, logger, db, overseerr, jellyfin, envManager }) {
  const app = express();
  const basePath = normalizeBasePath(config.app.basePath);

  app.set("trust proxy", config.app.trustProxy);

  app.use(morgan("dev"));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const publicDir = path.join(__dirname, "public");
  if (basePath === "/") {
    app.use(express.static(publicDir));
  } else {
    app.use(basePath, express.static(publicDir));
  }

  const apiMountPath = basePath === "/" ? "/api" : `${basePath}/api`;

  app.use(
    apiMountPath,
    createApiRouter({
      db,
      overseerr,
      jellyfin,
      config,
      envManager
    })
  );

  if (basePath === "/") {
    app.get(basePath, (req, res) => {
      res.sendFile(path.join(publicDir, "index.html"));
    });
  } else {
    app.get(basePath, (req, res) => {
      res.redirect(`${basePath}/`);
    });

    app.get(`${basePath}/`, (req, res) => {
      res.sendFile(path.join(publicDir, "index.html"));
    });

    app.get("/", (req, res) => {
      res.redirect(basePath);
    });
  }

  app.use((err, req, res, next) => {
    logger.error(`API error: ${err.message}`);
    res.status(500).json({ error: err.message || "Internal server error" });
  });

  return {
    start: () =>
      new Promise((resolve, reject) => {
        const server = app.listen(config.app.port, () => {
          logger.info(
            `Web UI listening on port ${config.app.port}${basePath === "/" ? "" : ` with base path ${basePath}`}`
          );
          resolve(server);
        });

        server.once("error", (error) => {
          if (error?.code === "EADDRINUSE") {
            reject(
              new Error(
                `Port ${config.app.port} is already in use. Stop the process using that port or set a different PORT value in your environment.`
              )
            );
            return;
          }

          reject(error);
        });
      })
  };
}

module.exports = { createWebServer };
