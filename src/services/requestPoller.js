function extractRequestData(item, overseerr) {
  const mediaType = item.type || item.media?.mediaType || "unknown";
  const mediaId = item.media?.tmdbId || 0;
  const title = item.media?.title || item.media?.name || "Unknown title";

  return {
    requestId: item.id,
    mediaType,
    mediaId,
    title,
    status: item.status,
    statusText: overseerr.getRequestStatusText(item.status),
    requestedBy: item.requestedBy?.id || null
  };
}

function createRequestPoller({ config, logger, db, overseerr, bot }) {
  const interval = Math.max(10, config.app.requestStatusPollSeconds);
  let timer = null;

  async function cycle() {
    if (!config.overseerr.url || !config.overseerr.apiKey) {
      return;
    }

    try {
      const requests = await overseerr.getRecentRequests(30);

      for (const request of requests) {
        if (!request?.id) {
          continue;
        }

        const normalized = extractRequestData(request, overseerr);
        const existing = db.getRequestEventById(normalized.requestId);
        db.upsertRequestEvent(normalized);

        if (existing && existing.status !== normalized.status) {
          const link = normalized.requestedBy
            ? db.getUserLinkByOverseerrId(normalized.requestedBy)
            : null;

          await bot.announceRequestStatusChange({
            title: normalized.title,
            requestId: normalized.requestId,
            statusText: normalized.statusText,
            status: normalized.status,
            requesterDiscordId: link?.discord_user_id || ""
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
