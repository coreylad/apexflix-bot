function firstNonEmpty(values, fallback = "") {
  for (const value of values) {
    if (value === undefined || value === null) {
      continue;
    }

    const normalized = String(value).trim();
    if (normalized) {
      return normalized;
    }
  }

  return fallback;
}

function normalizeMediaType(value) {
  const raw = String(value || "").toLowerCase();
  if (raw === "movie" || raw === "tv") {
    return raw;
  }
  return "unknown";
}

function extractRequestData(item, overseerr) {
  const mediaType = normalizeMediaType(
    item.type || item.media?.mediaType || item.media?.type || item.subjectType
  );
  const mediaId = Number(
    item.media?.tmdbId || item.mediaId || item.media?.id || item.media?.tmdb_id || 0
  );
  const title = firstNonEmpty(
    [
      item.media?.title,
      item.media?.name,
      item.subject,
      item.title,
      item.request?.media?.title,
      item.request?.media?.name,
      item.media?.originalTitle
    ],
    "Unknown title"
  );

  const snapshot = overseerr.resolveStatusSnapshot(item);

  return {
    requestId: item.id,
    mediaType,
    mediaId,
    title,
    status: snapshot.status,
    statusText: snapshot.statusText,
    requestedBy: item.requestedBy?.id || null
  };
}

async function enrichRequestDataFromDetails(normalized, requestId, overseerr) {
  if (normalized.title !== "Unknown title" && normalized.mediaType !== "unknown" && normalized.mediaId > 0) {
    return normalized;
  }

  try {
    const details = await overseerr.getRequestById(requestId);
    if (!details || typeof details !== "object") {
      return normalized;
    }

    const detailedMedia = details.media || details.request?.media || {};
    const detailedType = normalizeMediaType(
      details.type || detailedMedia.mediaType || detailedMedia.type || normalized.mediaType
    );
    const detailedMediaId = Number(
      detailedMedia.tmdbId || detailedMedia.id || details.mediaId || normalized.mediaId || 0
    );
    const detailedTitle = firstNonEmpty(
      [
        detailedMedia.title,
        detailedMedia.name,
        details.subject,
        details.title,
        normalized.title
      ],
      "Unknown title"
    );

    let merged = {
      ...normalized,
      mediaType: detailedType,
      mediaId: detailedMediaId,
      title: detailedTitle,
      requestedBy: details.requestedBy?.id || normalized.requestedBy
    };

    if (merged.title === "Unknown title" && merged.mediaId > 0) {
      const fallback = await overseerr.getMediaByTmdbId(merged.mediaId, merged.mediaType);
      if (fallback) {
        merged = {
          ...merged,
          title: firstNonEmpty([fallback.title, merged.title], "Unknown title"),
          mediaType:
            fallback.mediaType === "movie" || fallback.mediaType === "tv"
              ? fallback.mediaType
              : merged.mediaType
        };
      }
    }

    return merged;
  } catch (error) {
    return normalized;
  }
}

function createRequestPoller({ config, logger, db, overseerr, bot }) {
  const interval = Math.max(10, config.app.requestStatusPollSeconds);
  let timer = null;

  async function cycle() {
    if (!config.overseerr.url || !config.overseerr.apiKey) {
      return;
    }

    try {
      const recentRequests = await overseerr.getRecentRequests(50);
      const trackedIds = db.getAllRequestIds().slice(0, 200);
      const candidateMap = new Map();

      for (const request of recentRequests) {
        if (request?.id) {
          candidateMap.set(request.id, request);
        }
      }

      for (const requestId of trackedIds) {
        if (candidateMap.has(requestId)) {
          continue;
        }

        try {
          const details = await overseerr.getRequestById(requestId);
          if (details?.id) {
            candidateMap.set(details.id, details);
          }
        } catch (error) {
          // Ignore individual failures and continue with other tracked requests.
        }
      }

      for (const request of candidateMap.values()) {
        if (!request?.id) {
          continue;
        }

        let normalized = extractRequestData(request, overseerr);
        normalized = await enrichRequestDataFromDetails(normalized, request.id, overseerr);
        const existing = db.getRequestEventById(normalized.requestId);

        if (
          normalized.title === "Unknown title" &&
          existing?.title &&
          existing.title !== "Unknown title"
        ) {
          normalized.title = existing.title;
        }

        db.upsertRequestEvent(normalized);

        const statusChanged = existing && existing.status !== normalized.status;
        const statusTextChanged = existing && existing.status_text !== normalized.statusText;

        if (statusChanged || statusTextChanged) {
          const link = normalized.requestedBy
            ? db.getUserLinkByOverseerrId(normalized.requestedBy)
            : null;

          await bot.announceRequestStatusChange({
            title: normalized.title,
            mediaType: normalized.mediaType,
            mediaId: normalized.mediaId,
            requestId: normalized.requestId,
            statusText: normalized.statusText,
            status: normalized.status,
            requesterDiscordId: link?.discord_user_id || "",
            requesterUsername:
              request.requestedBy?.displayName || request.requestedBy?.username || "",
            seasons: Array.isArray(request.seasons) ? request.seasons : [],
            image: request.media?.posterPath || request.media?.poster || ""
          });

          if (link?.discord_user_id) {
            const msg = `Request update: ${normalized.title} is now ${normalized.statusText}.`;
            await bot.notifyDiscordUser(link.discord_user_id, msg);
            logger.info(
              `Notified Discord user ${link.discord_user_id} for request ${normalized.requestId}`
            );
          }
        }
      }
    } catch (error) {
      logger.warn(`Request poller cycle failed: ${error.message}`);
    }
  }

  return {
    start: () => {
      if (timer) {
        return;
      }

      cycle();
      timer = setInterval(cycle, interval * 1000);
      logger.info(`Request poller started with interval ${interval}s`);
    },
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      logger.info("Request poller stopped");
    }
  };
}

module.exports = { createRequestPoller };
