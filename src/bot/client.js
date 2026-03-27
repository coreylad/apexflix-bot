const {
  ActionRowBuilder,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  REST,
  Routes,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");
const { buildCommands } = require("./commands");

const REQUEST_MODAL_ID = "apexflix-request-modal";
const REQUEST_MODAL_MEDIA_TYPE = "media_type";
const REQUEST_MODAL_MEDIA_ID = "media_id";
const REQUEST_MODAL_SEASON = "season";

function createDiscordBot({ config, logger, db, overseerr, lidarr, jellyfin }) {
  const DEFAULT_BOT_CONFIG = {
    requestsChannelId: "",
    uploadsChannelId: "",
    updatesChannelId: "",
    newsChannelId: "",
    reportsChannelId: "",
    jellyfinNowPlayingChannelId: "",
    jellyfinStatsChannelId: "",
    newMoviesChannelId: "",
    newShowsChannelId: "",
    newEpisodesChannelId: "",
    generalChannelId: "",
    welcomeChannelId: "",
    suggestionsChannelId: "",
    cuttingBoardChannelId: "",
    botTestingChannelId: "",
    requestRoleId: "",
    adminRoleId: "",
    defaultMemberRoleId: "",
    enforceRequestChannel: false,
    announceOnRequestCreated: true,
    announceOnAvailable: true,
    announceOnAnyStatus: false,
    dailyNewsEnabled: true,
    dailyNewsHourLocal: "9",
    dailyNewsLastSentDate: "",
    dmOnStatusChange: true,
    mentionRequesterInChannel: true,
    useRichEmbeds: true,
    requestAnnouncementTemplate:
      "{{event}}\nTitle: {{subject}}\nType: {{media_type}}\nRequest ID: {{request_id}}\nRequested by: {{requestedBy_username}}",
    availableAnnouncementTemplate:
      "{{event}}\nTitle: {{subject}}\nStatus: {{media_status}}\nRequest ID: {{request_id}}",
    statusAnnouncementTemplate:
      "{{event}}\nTitle: {{subject}}\nStatus: {{media_status}}\nRequest ID: {{request_id}}"
  };

  let online = false;
  let dailyNewsTimer = null;
  let issuesTimer = null;
  let lastDailyNewsDate = "";
  let issuePollInitialized = false;
  const seenIssueIds = new Set();
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.GuildMessages
    ]
  });

  function toEphemeralResponse(content) {
    return {
      content,
      flags: MessageFlags.Ephemeral
    };
  }

  function asBoolean(value, fallback) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
    return fallback;
  }

  function normalizeId(value) {
    const raw = String(value ?? "").trim();
    return /^\d+$/.test(raw) ? raw : "";
  }

  function getBotConfig() {
    const stored = db.getBotConfig();

    const lastSentRaw = String(stored.dailyNewsLastSentDate || DEFAULT_BOT_CONFIG.dailyNewsLastSentDate);
    const lastSentDate = /^\d{4}-\d{2}-\d{2}$/.test(lastSentRaw) ? lastSentRaw : "";

    return {
      requestsChannelId: normalizeId(stored.requestsChannelId || DEFAULT_BOT_CONFIG.requestsChannelId),
      uploadsChannelId: normalizeId(stored.uploadsChannelId || DEFAULT_BOT_CONFIG.uploadsChannelId),
      updatesChannelId: normalizeId(stored.updatesChannelId || DEFAULT_BOT_CONFIG.updatesChannelId),
      newsChannelId: normalizeId(stored.newsChannelId || DEFAULT_BOT_CONFIG.newsChannelId),
      reportsChannelId: normalizeId(stored.reportsChannelId || DEFAULT_BOT_CONFIG.reportsChannelId),
      jellyfinNowPlayingChannelId: normalizeId(stored.jellyfinNowPlayingChannelId || DEFAULT_BOT_CONFIG.jellyfinNowPlayingChannelId),
      jellyfinStatsChannelId: normalizeId(stored.jellyfinStatsChannelId || DEFAULT_BOT_CONFIG.jellyfinStatsChannelId),
      newMoviesChannelId: normalizeId(stored.newMoviesChannelId || DEFAULT_BOT_CONFIG.newMoviesChannelId),
      newShowsChannelId: normalizeId(stored.newShowsChannelId || DEFAULT_BOT_CONFIG.newShowsChannelId),
      newEpisodesChannelId: normalizeId(stored.newEpisodesChannelId || DEFAULT_BOT_CONFIG.newEpisodesChannelId),
      generalChannelId: normalizeId(stored.generalChannelId || DEFAULT_BOT_CONFIG.generalChannelId),
      welcomeChannelId: normalizeId(stored.welcomeChannelId || DEFAULT_BOT_CONFIG.welcomeChannelId),
      suggestionsChannelId: normalizeId(stored.suggestionsChannelId || DEFAULT_BOT_CONFIG.suggestionsChannelId),
      cuttingBoardChannelId: normalizeId(stored.cuttingBoardChannelId || DEFAULT_BOT_CONFIG.cuttingBoardChannelId),
      botTestingChannelId: normalizeId(stored.botTestingChannelId || DEFAULT_BOT_CONFIG.botTestingChannelId),
      requestRoleId: normalizeId(stored.requestRoleId || DEFAULT_BOT_CONFIG.requestRoleId),
      adminRoleId: normalizeId(stored.adminRoleId || DEFAULT_BOT_CONFIG.adminRoleId),
      defaultMemberRoleId: normalizeId(stored.defaultMemberRoleId || DEFAULT_BOT_CONFIG.defaultMemberRoleId),
      enforceRequestChannel: asBoolean(stored.enforceRequestChannel, DEFAULT_BOT_CONFIG.enforceRequestChannel),
      announceOnRequestCreated: asBoolean(stored.announceOnRequestCreated, DEFAULT_BOT_CONFIG.announceOnRequestCreated),
      announceOnAvailable: asBoolean(stored.announceOnAvailable, DEFAULT_BOT_CONFIG.announceOnAvailable),
      announceOnAnyStatus: asBoolean(stored.announceOnAnyStatus, DEFAULT_BOT_CONFIG.announceOnAnyStatus),
      dailyNewsEnabled: asBoolean(stored.dailyNewsEnabled, DEFAULT_BOT_CONFIG.dailyNewsEnabled),
      dailyNewsHourLocal: String(stored.dailyNewsHourLocal || DEFAULT_BOT_CONFIG.dailyNewsHourLocal),
      dailyNewsLastSentDate: lastSentDate,
      dmOnStatusChange: asBoolean(stored.dmOnStatusChange, DEFAULT_BOT_CONFIG.dmOnStatusChange),
      mentionRequesterInChannel: asBoolean(stored.mentionRequesterInChannel, DEFAULT_BOT_CONFIG.mentionRequesterInChannel),
      useRichEmbeds: asBoolean(stored.useRichEmbeds, DEFAULT_BOT_CONFIG.useRichEmbeds),
      requestAnnouncementTemplate:
        String(stored.requestAnnouncementTemplate || DEFAULT_BOT_CONFIG.requestAnnouncementTemplate),
      availableAnnouncementTemplate:
        String(stored.availableAnnouncementTemplate || DEFAULT_BOT_CONFIG.availableAnnouncementTemplate),
      statusAnnouncementTemplate:
        String(stored.statusAnnouncementTemplate || DEFAULT_BOT_CONFIG.statusAnnouncementTemplate)
    };
  }

  function renderTemplate(template, context) {
    const source = String(template || "");
    return source.replace(/{{\s*([^}]+)\s*}}/g, (_, key) => {
      const value = context[key];
      return value === undefined || value === null ? "" : String(value);
    });
  }

  function buildTemplateContext({
    notificationType,
    event,
    subject,
    message,
    image,
    mediaType,
    mediaTmdbId,
    mediaStatus,
    requestId,
    requesterUsername,
    requesterDiscordId,
    seasons
  }) {
    return {
      notification_type: notificationType || "",
      event: event || "",
      subject: subject || "",
      message: message || "",
      image: image || "",
      media_type: mediaType || "",
      media_tmdbid: mediaTmdbId || "",
      media_status: mediaStatus || "",
      request_id: requestId || "",
      requestedBy_username: requesterUsername || "",
      requestedBy_settings_discordId: requesterDiscordId || "",
      extra: seasons || ""
    };
  }

  function resolvePosterUrl(image) {
    const raw = String(image || "").trim();
    if (!raw) {
      return "";
    }

    if (/^https?:\/\//i.test(raw)) {
      return raw;
    }

    if (raw.startsWith("/")) {
      return `https://image.tmdb.org/t/p/w500${raw}`;
    }

    return `https://image.tmdb.org/t/p/w500/${raw}`;
  }

  async function resolveAnnouncementImageUrl({ image, mediaId, mediaType }) {
    const direct = resolvePosterUrl(image);
    if (direct) {
      return direct;
    }

    const tmdbId = Number(mediaId || 0);
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
      return "";
    }

    try {
      const fallback = await overseerr.getMediaByTmdbId(tmdbId, mediaType);
      return resolvePosterUrl(fallback?.posterPath || fallback?.poster || "");
    } catch (error) {
      return "";
    }
  }

  async function sendToChannel(channelId, payload) {
    if (!online || !channelId) {
      return;
    }

    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) {
        return;
      }

      return await channel.send(payload);
    } catch (error) {
      logger.warn(`Failed to send message to channel ${channelId}: ${error.message}`);
      return null;
    }
  }

  async function sendOrEditTrackedRequestMessage({ requestId, channelKey, channelId, payload }) {
    if (!requestId || !channelKey || !channelId) {
      return null;
    }

    const existing = db.getRequestAnnouncementMessage(requestId, channelKey);

    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) {
        return null;
      }

      if (existing?.message_id) {
        try {
          const message = await channel.messages.fetch(existing.message_id);
          if (message) {
            await message.edit(payload);
            db.saveRequestAnnouncementMessage({
              requestId,
              channelKey,
              channelId,
              messageId: message.id
            });
            return message;
          }
        } catch (error) {
          db.deleteRequestAnnouncementMessage(requestId, channelKey);
        }
      }

      const sent = await channel.send(payload);
      if (sent?.id) {
        db.saveRequestAnnouncementMessage({
          requestId,
          channelKey,
          channelId,
          messageId: sent.id
        });
      }
      return sent || null;
    } catch (error) {
      logger.warn(`Failed to send/edit tracked message for request ${requestId} in ${channelKey}: ${error.message}`);
      return null;
    }
  }

  function buildAnnouncementPayload({ title, description, color, fields, mention, imageUrl }) {
    const cfg = getBotConfig();
    if (!cfg.useRichEmbeds) {
      const flat = [title, description]
        .concat((fields || []).map((field) => `${field.name}: ${field.value}`))
        .filter(Boolean)
        .join("\n");

      const withImage = imageUrl ? `${flat}\nPoster: ${imageUrl}` : flat;
      return {
        content: mention ? `${mention} ${withImage}` : withImage
      };
    }

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description || "")
      .setColor(color || 0x6ae3b9)
      .setTimestamp(new Date());

    if (fields?.length) {
      embed.addFields(fields);
    }

    if (imageUrl) {
      embed.setThumbnail(imageUrl);
      embed.setImage(imageUrl);
    }

    return {
      content: mention || undefined,
      embeds: [embed]
    };
  }

  async function announceRequestCreated({
    title,
    mediaType,
    mediaId,
    requestId,
    requesterDiscordId,
    requesterUsername,
    seasons,
    image
  }) {
    const cfg = getBotConfig();
    if (!cfg.announceOnRequestCreated || !cfg.requestsChannelId) {
      return;
    }

    const mention = cfg.requestRoleId
      ? `<@&${cfg.requestRoleId}>`
      : cfg.mentionRequesterInChannel && requesterDiscordId
        ? `<@${requesterDiscordId}>`
        : "";

    const posterUrl = await resolveAnnouncementImageUrl({
      image,
      mediaId,
      mediaType
    });
    const templateContext = buildTemplateContext({
      notificationType: "MEDIA_PENDING",
      event: "Request Pending Approval",
      subject: title,
      message: `${title} was requested and sent to Overseerr.`,
      image: posterUrl || image || "",
      mediaType,
      mediaTmdbId: mediaId,
      mediaStatus: "PENDING",
      requestId,
      requesterUsername,
      requesterDiscordId,
      seasons: seasons?.join(",")
    });

    const rendered = renderTemplate(cfg.requestAnnouncementTemplate, templateContext);

    const payload = buildAnnouncementPayload({
      title: "New Media Request",
      description: rendered,
      color: 0x4cc9f0,
      mention,
      imageUrl: posterUrl,
      fields: [
        { name: "Type", value: mediaType || "unknown", inline: true },
        { name: "Request ID", value: String(requestId || "unknown"), inline: true }
      ]
    });

    await sendToChannel(cfg.requestsChannelId, payload);
  }

  async function announceRequestStatusChange({
    title,
    mediaType,
    mediaId,
    requestId,
    statusText,
    status,
    requesterDiscordId,
    requesterUsername,
    seasons,
    image
  }) {
    const cfg = getBotConfig();
    const numericStatus = Number(status);
    const isCompletedText = String(statusText || "").toLowerCase().includes("completed");
    const isAvailable = numericStatus === 4 || numericStatus === 8 || isCompletedText;

    const mention = cfg.mentionRequesterInChannel && requesterDiscordId ? `<@${requesterDiscordId}>` : "";
    const availableMention = "";

    const posterUrl = await resolveAnnouncementImageUrl({
      image,
      mediaId,
      mediaType
    });
    const templateContext = buildTemplateContext({
      notificationType: isAvailable ? "MEDIA_AVAILABLE" : "MEDIA_STATUS_CHANGED",
      event: isAvailable ? "Request Available" : "Request Status Changed",
      subject: title,
      message: `${title} changed status to ${statusText}.`,
      image: posterUrl || image || "",
      mediaType,
      mediaTmdbId: mediaId,
      mediaStatus: statusText,
      requestId,
      requesterUsername,
      requesterDiscordId,
      seasons: seasons?.join(",")
    });

    if (isAvailable && cfg.announceOnAvailable && cfg.uploadsChannelId) {
      const rendered = renderTemplate(cfg.availableAnnouncementTemplate, templateContext);
      const payload = buildAnnouncementPayload({
        title: "Media Is Now Available",
        description: rendered,
        color: 0x2ecc71,
        mention: availableMention,
        imageUrl: posterUrl,
        fields: [
          { name: "Request ID", value: String(requestId || "unknown"), inline: true },
          { name: "Status", value: statusText || "Available", inline: true }
        ]
      });
      await sendToChannel(cfg.uploadsChannelId, payload);
    }

    if (cfg.announceOnAnyStatus && cfg.updatesChannelId) {
      const rendered = renderTemplate(cfg.statusAnnouncementTemplate, templateContext);
      const payload = buildAnnouncementPayload({
        title: "Request Status Updated",
        description: rendered,
        color: 0xf9c74f,
        mention,
        imageUrl: posterUrl,
        fields: [
          { name: "Request ID", value: String(requestId || "unknown"), inline: true },
          { name: "Status", value: statusText || "Unknown", inline: true }
        ]
      });
      await sendOrEditTrackedRequestMessage({
        requestId,
        channelKey: "updates",
        channelId: cfg.updatesChannelId,
        payload
      });
    }

    if (isAvailable) {
      const normalizedMediaType = String(mediaType || "").toLowerCase();

      if (normalizedMediaType === "movie" && cfg.newMoviesChannelId) {
        const payload = buildAnnouncementPayload({
          title: "New Movie Added",
          description: `${title} is now available.`,
          color: 0x2ecc71,
          imageUrl: posterUrl,
          fields: [
            { name: "Type", value: "movie", inline: true },
            { name: "Request ID", value: String(requestId || "unknown"), inline: true }
          ]
        });
        await sendToChannel(cfg.newMoviesChannelId, payload);
      }

      if (normalizedMediaType === "tv" && cfg.newShowsChannelId) {
        const payload = buildAnnouncementPayload({
          title: "New TV Show Added",
          description: `${title} is now available.`,
          color: 0x4cc9f0,
          imageUrl: posterUrl,
          fields: [
            { name: "Type", value: "tv", inline: true },
            { name: "Request ID", value: String(requestId || "unknown"), inline: true }
          ]
        });
        await sendToChannel(cfg.newShowsChannelId, payload);
      }

      if (normalizedMediaType === "tv" && cfg.newEpisodesChannelId) {
        const seasonLabels = Array.isArray(seasons)
          ? seasons
              .map((s) => {
                const n = Number(s?.seasonNumber ?? s);
                return Number.isInteger(n) && n > 0 ? `S${n}` : "";
              })
              .filter(Boolean)
          : [];

        if (seasonLabels.length > 0) {
          const payload = buildAnnouncementPayload({
            title: "New Episode Update",
            description: `${title} now has available episode content (${seasonLabels.join(", ")}).`,
            color: 0x39b96e,
            imageUrl: posterUrl,
            fields: [
              { name: "Seasons", value: seasonLabels.join(", "), inline: true },
              { name: "Request ID", value: String(requestId || "unknown"), inline: true }
            ]
          });
          await sendToChannel(cfg.newEpisodesChannelId, payload);
        }
      }
    }
  }

  async function sendManualChannelTest({ target }) {
    if (!online) {
      return { ok: false, message: "Discord bot is not online." };
    }

    const cfg = getBotConfig();
    const normalizedTarget = String(target || "").trim();
    const aliasMap = {
      requests: "requestsChannelId",
      uploads: "uploadsChannelId",
      updates: "updatesChannelId",
      news: "newsChannelId",
      reports: "reportsChannelId",
      jellyfinNowPlaying: "jellyfinNowPlayingChannelId",
      jellyfinStats: "jellyfinStatsChannelId",
      newMovies: "newMoviesChannelId",
      newShows: "newShowsChannelId",
      newEpisodes: "newEpisodesChannelId",
      general: "generalChannelId",
      welcome: "welcomeChannelId",
      suggestions: "suggestionsChannelId",
      cuttingBoard: "cuttingBoardChannelId",
      botTesting: "botTestingChannelId"
    };

    const channelKey = aliasMap[normalizedTarget] || normalizedTarget;
    const channelId = cfg[channelKey];

    if (!channelId) {
      return { ok: false, message: `Channel is not configured for ${channelKey}.` };
    }

    const payload = buildAnnouncementPayload({
      title: "Manual Channel Test",
      description: `ApexFlix test message for ${channelKey}.`,
      color: 0x6ae3b9,
      fields: [
        { name: "Target", value: channelKey, inline: true },
        { name: "Sent At", value: new Date().toISOString(), inline: true }
      ]
    });

    await sendToChannel(channelId, payload);
    return { ok: true, channelKey, channelId };
  }

  function describeCommandError(error) {
    const status = error?.response?.status;
    const data = error?.response?.data;

    if (!status) {
      return error.message;
    }

    if (typeof data === "string") {
      return `HTTP ${status}: ${data}`;
    }

    if (data && typeof data === "object") {
      const detail = data.message || data.error || JSON.stringify(data);
      return `HTTP ${status}: ${detail}`;
    }

    return `HTTP ${status}: ${error.message}`;
  }

  function parseSeasonMode(rawValue) {
    const normalized = String(rawValue || "").trim().toLowerCase();
    if (!normalized) {
      return { mode: "none" };
    }

    if (normalized === "all") {
      return { mode: "all" };
    }

    if (normalized === "latest") {
      return { mode: "latest" };
    }

    if (/^\d+$/.test(normalized)) {
      const seasonNumber = Number(normalized);
      if (Number.isInteger(seasonNumber) && seasonNumber > 0) {
        return { mode: "single", seasonNumber };
      }
    }

    const compact = normalized.replace(/\s+/g, "");
    const match = compact.match(/^season(?:\[(\d+)\]|(\d+))$/);
    if (match) {
      const seasonNumber = Number(match[1] || match[2]);
      if (Number.isInteger(seasonNumber) && seasonNumber > 0) {
        return { mode: "single", seasonNumber };
      }
    }

    return { mode: "invalid", input: rawValue };
  }

  function parseMediaIdInput(rawValue) {
    const raw = String(rawValue || "").trim();
    if (!raw) {
      return 0;
    }

    if (/^\d+$/.test(raw)) {
      const parsed = Number(raw);
      return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
    }

    try {
      const parsedUrl = new URL(raw);
      const directMatch = parsedUrl.pathname.match(/\/(movie|tv)\/(\d+)/i);
      if (directMatch?.[2]) {
        const id = Number(directMatch[2]);
        return Number.isInteger(id) && id > 0 ? id : 0;
      }
    } catch (error) {
      // Not a URL; continue with fallback pattern check.
    }

    const fallback = raw.match(/(?:^|\D)(\d{2,})(?:\D|$)/);
    if (fallback?.[1]) {
      const id = Number(fallback[1]);
      return Number.isInteger(id) && id > 0 ? id : 0;
    }

    return 0;
  }

  function buildRequestModal() {
    const modal = new ModalBuilder()
      .setCustomId(REQUEST_MODAL_ID)
      .setTitle("Request Media");

    const mediaType = new TextInputBuilder()
      .setCustomId(REQUEST_MODAL_MEDIA_TYPE)
      .setLabel("Media Type (movie, tv, or music)")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder("movie")
      .setMaxLength(10);

    const mediaId = new TextInputBuilder()
      .setCustomId(REQUEST_MODAL_MEDIA_ID)
      .setLabel("TMDB ID/URL (movie,tv) or artist query (music)")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder("1399, TMDB URL, or artist name/MBID")
      .setMaxLength(200);

    const season = new TextInputBuilder()
      .setCustomId(REQUEST_MODAL_SEASON)
      .setLabel("Season (TV only: 1, all, latest)")
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setPlaceholder("1")
      .setMaxLength(30);

    modal.addComponents(
      new ActionRowBuilder().addComponents(mediaType),
      new ActionRowBuilder().addComponents(mediaId),
      new ActionRowBuilder().addComponents(season)
    );

    return modal;
  }

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

  function parseHour(value, fallback = 9) {
    const parsed = Number(String(value || "").trim());
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 23) {
      return fallback;
    }
    return parsed;
  }

  function dateKeyLocal(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  async function resolveNewsChannelId(cfg) {
    if (cfg.newsChannelId) {
      return cfg.newsChannelId;
    }

    if (!config.discord.guildId) {
      return "";
    }

    try {
      const guild = await client.guilds.fetch(config.discord.guildId);
      const channels = await guild.channels.fetch();
      const candidates = channels
        .filter((ch) => ch && ch.isTextBased && ch.isTextBased())
        .map((ch) => ({ id: ch.id, name: String(ch.name || "").toLowerCase() }));

      const exact = candidates.find((ch) => ch.name === "news");
      if (exact?.id) {
        return exact.id;
      }

      const contains = candidates.find((ch) => ch.name.includes("news"));
      return contains?.id || "";
    } catch (error) {
      logger.warn(`Failed to auto-resolve news channel: ${error.message}`);
      return "";
    }
  }

  async function getRecentlyAvailableRequests(limit = 5) {
    const rows = await overseerr.getRecentRequests(80);
    const output = [];
    const seen = new Set();

    for (const row of rows) {
      const snapshot = overseerr.resolveStatusSnapshot(row);
      if (Number(snapshot.status) !== 4) {
        continue;
      }

      const media = row.media || {};
      const mediaType = String(row.type || media.mediaType || media.type || "unknown").toLowerCase();
      let mediaId = Number(media.tmdbId || media.id || row.mediaId || 0);
      let poster = media.posterPath || media.poster || "";
      let title = firstNonEmpty(
        [
          media.title,
          media.name,
          row.subject,
          row.title,
          media.originalTitle
        ],
        ""
      );

      const missingTitle = !title || /^request\s*#/i.test(title);
      if (missingTitle && Number.isInteger(Number(row.id)) && Number(row.id) > 0) {
        const cached = db.getRequestEventById(Number(row.id));
        if (cached?.title && cached.title !== "Unknown title") {
          title = cached.title;
          if (!mediaId && Number(cached.media_id) > 0) {
            mediaId = Number(cached.media_id);
          }
        }
      }

      if ((!title || /^request\s*#/i.test(title)) && Number(row.id) > 0) {
        try {
          const details = await overseerr.getRequestById(Number(row.id));
          const dMedia = details?.media || details?.request?.media || {};
          title = firstNonEmpty(
            [
              dMedia.title,
              dMedia.name,
              details?.subject,
              details?.title,
              dMedia.originalTitle,
              title
            ],
            ""
          );
          if (!mediaId) {
            mediaId = Number(dMedia.tmdbId || dMedia.id || details?.mediaId || 0);
          }
          if (!poster) {
            poster = dMedia.posterPath || dMedia.poster || "";
          }
        } catch (error) {
          // Continue with additional fallbacks.
        }
      }

      if ((!title || /^request\s*#/i.test(title)) && mediaId > 0) {
        try {
          const fallback = await overseerr.getMediaByTmdbId(mediaId, mediaType);
          title = firstNonEmpty(
            [fallback?.title, fallback?.name, fallback?.originalTitle, title],
            ""
          );
          if (!poster) {
            poster = fallback?.posterPath || fallback?.poster || "";
          }
        } catch (error) {
          // Continue with final fallback label.
        }
      }

      if (!title) {
        title = `Request #${row.id || "unknown"}`;
      }

      if (Number(row.id) > 0 && title && title !== `Request #${row.id}`) {
        try {
          db.upsertRequestEvent({
            requestId: Number(row.id),
            mediaType: mediaType === "movie" || mediaType === "tv" ? mediaType : "unknown",
            mediaId: mediaId > 0 ? mediaId : 0,
            title,
            status: Number(snapshot.status || 0),
            statusText: String(snapshot.statusText || "Unknown"),
            requestedBy: Number(row?.requestedBy?.id || 0) || null
          });
        } catch (error) {
          // Do not fail daily report when caching title fails.
        }
      }

      const key = `${mediaType}:${mediaId > 0 ? mediaId : title.toLowerCase()}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      output.push({
        title,
        mediaType,
        mediaId,
        requestId: row.id,
        image: poster
      });

      if (output.length >= limit) {
        break;
      }
    }

    return output;
  }

  async function sendDailyNewsReport({ forced = false } = {}) {
    if (!online) {
      return { ok: false, message: "Discord bot is not online." };
    }

    const cfg = getBotConfig();
    if (!forced && !cfg.dailyNewsEnabled) {
      return { ok: false, message: "Daily news is disabled in bot config." };
    }

    const channelId = await resolveNewsChannelId(cfg);
    if (!channelId) {
      return { ok: false, message: "No news channel found. Set News Channel ID or create #news." };
    }

    let available = [];
    let usage = {
      movieCount: 0,
      seriesCount: 0,
      episodeCount: 0,
      songCount: 0,
      playedItemsCount: 0,
      activeSessions: 0
    };

    try {
      available = await getRecentlyAvailableRequests(6);
    } catch (error) {
      logger.warn(`Daily news available-items fetch failed: ${error.message}`);
    }

    try {
      usage = await jellyfin.getUsageStats();
    } catch (error) {
      logger.warn(`Daily news Jellyfin stats fetch failed: ${error.message}`);
    }

    const availableText =
      available.length > 0
        ? available
            .map((item) => `• ${item.title} (${item.mediaType || "unknown"})`)
            .join("\n")
        : "No newly available items were detected in recent Seerr activity.";

    const summaryText = [
      `• Movies in library: ${usage.movieCount}`,
      `• Series in library: ${usage.seriesCount}`,
      `• Episodes in library: ${usage.episodeCount}`,
      `• Songs in library: ${usage.songCount}`,
      `• Played items total: ${usage.playedItemsCount}`,
      `• Active streams now: ${usage.activeSessions}`
    ].join("\n");

    const payload = buildAnnouncementPayload({
      title: "Daily Media News Report",
      description: `Daily digest for ${new Date().toLocaleDateString()}`,
      color: 0x39b96e,
      fields: [
        {
          name: "Recently Available (Seerr)",
          value: availableText.slice(0, 1024) || "No data",
          inline: false
        },
        {
          name: "Jellyfin Overview",
          value: summaryText.slice(0, 1024),
          inline: false
        }
      ]
    });

    await sendToChannel(channelId, payload);

    return {
      ok: true,
      channelId,
      availableCount: available.length,
      usage
    };
  }

  function issueStatusText(status) {
    const map = {
      1: "Open",
      2: "Resolved",
      3: "Declined"
    };
    return map[Number(status)] || `Status ${status}`;
  }

  function issueTypeText(issueType) {
    const raw = String(issueType || "other").toLowerCase();
    return raw
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (match) => match.toUpperCase());
  }

  async function announceSeerrIssue(issue) {
    const cfg = getBotConfig();
    if (!cfg.reportsChannelId) {
      return;
    }

    const payload = buildAnnouncementPayload({
      title: "New Seerr Issue Report",
      description: `${issue.subject}`,
      color: 0xf9844a,
      fields: [
        { name: "Issue ID", value: String(issue.id || "unknown"), inline: true },
        { name: "Type", value: issueTypeText(issue.issueType), inline: true },
        { name: "Status", value: issueStatusText(issue.status), inline: true },
        { name: "Media", value: issue.mediaType || "unknown", inline: true },
        { name: "Comments", value: String(issue.commentsCount || 0), inline: true },
        { name: "Created", value: String(issue.createdAt || "unknown"), inline: false }
      ]
    });

    await sendToChannel(cfg.reportsChannelId, payload);
  }

  async function pollSeerrIssues() {
    if (!online) {
      return;
    }

    const cfg = getBotConfig();
    if (!cfg.reportsChannelId) {
      return;
    }

    let issues = [];
    try {
      issues = await overseerr.getRecentIssues(30);
    } catch (error) {
      logger.warn(`Failed to fetch Overseerr issues: ${error.message}`);
      return;
    }

    if (!issuePollInitialized) {
      for (const issue of issues) {
        if (issue?.id) {
          seenIssueIds.add(issue.id);
        }
      }
      issuePollInitialized = true;
      return;
    }

    const newIssues = issues
      .filter((issue) => issue?.id && !seenIssueIds.has(issue.id))
      .sort((a, b) => {
        const aTime = new Date(a.createdAt || 0).getTime();
        const bTime = new Date(b.createdAt || 0).getTime();
        return aTime - bTime;
      });

    for (const issue of newIssues) {
      seenIssueIds.add(issue.id);
      await announceSeerrIssue(issue);
      logger.info(`Announced Overseerr issue ${issue.id} in reports channel`);
    }
  }

  function startIssuePolling() {
    if (issuesTimer) {
      return;
    }

    pollSeerrIssues().catch((error) => {
      logger.warn(`Initial issue poll failed: ${error.message}`);
    });

    issuesTimer = setInterval(() => {
      pollSeerrIssues().catch((error) => {
        logger.warn(`Issue poll failed: ${error.message}`);
      });
    }, 5 * 60 * 1000);

    logger.info("Overseerr issue polling started");
  }

  async function runDailyNewsTick() {
    if (!online) {
      return;
    }

    const cfg = getBotConfig();
    if (!cfg.dailyNewsEnabled) {
      return;
    }

    const now = new Date();
    const hour = parseHour(cfg.dailyNewsHourLocal, 9);
    const today = dateKeyLocal(now);

    if (now.getHours() < hour || lastDailyNewsDate === today) {
      return;
    }

    const result = await sendDailyNewsReport({ forced: false });
    if (result.ok) {
      lastDailyNewsDate = today;
      db.saveBotConfig({ dailyNewsLastSentDate: today });
      logger.info(`Daily news report sent to channel ${result.channelId}`);
    }
  }

  function startDailyNewsScheduler() {
    if (dailyNewsTimer) {
      return;
    }

    const cfg = getBotConfig();
    if (cfg.dailyNewsLastSentDate) {
      lastDailyNewsDate = cfg.dailyNewsLastSentDate;
    }

    runDailyNewsTick().catch((error) => {
      logger.warn(`Initial daily news tick failed: ${error.message}`);
    });

    dailyNewsTimer = setInterval(() => {
      runDailyNewsTick().catch((error) => {
        logger.warn(`Daily news tick failed: ${error.message}`);
      });
    }, 5 * 60 * 1000);

    logger.info("Daily news scheduler started");
  }

  async function resolveRequestTitleFromDetails(request) {
    const media = request?.media || {};
    let title = firstNonEmpty(
      [
        media.title,
        media.name,
        media.originalTitle,
        request?.subject,
        request?.title,
        request?.message
      ],
      "Unknown title"
    );

    if (title !== "Unknown title") {
      return title;
    }

    const mediaId = Number(media.tmdbId || media.id || request?.mediaId || 0);
    const mediaType = String(request?.type || media.mediaType || media.type || "").toLowerCase();

    if (mediaId > 0) {
      const fallback = await overseerr.getMediaByTmdbId(mediaId, mediaType);
      title = firstNonEmpty([fallback?.title, title], "Unknown title");
    }

    return title;
  }

  async function handleRequestHelp(interaction) {
    const helpText = [
      "How to use /request",
      "",
      "Run /request to open the request form.",
      "",
      "Form fields:",
      "- Media Type: movie, tv, or music",
      "- Media input:",
      "  - movie/tv: TMDB ID or TMDB URL",
      "  - music: artist name, MusicBrainz ID, or MusicBrainz URL",
      "- Season (TV only): 1, all, latest, season1, season[1]",
      "",
      "Notes:",
      "- For TV, season is required in the form.",
      "- For movies, leave season empty.",
      "- For music, leave season empty.",
      "- Seasons are validated against Seerr metadata before requesting."
    ].join("\n");

    await interaction.reply(toEphemeralResponse(helpText));
  }

  async function registerSlashCommands() {
    const commands = buildCommands().map((command) => command.toJSON());
    const rest = new REST({ version: "10" }).setToken(config.discord.token);

    await rest.put(
      Routes.applicationGuildCommands(
        config.discord.clientId,
        config.discord.guildId
      ),
      { body: commands }
    );

    logger.info(`Registered ${commands.length} slash commands.`);
  }

  function formatSearchResults(results) {
    if (results.length === 0) {
      return "No results found.";
    }

    const top = results.slice(0, 5);
    return top
      .map(
        (item) =>
          `• ${item.title} [${item.mediaType}] - TMDB ID: ${item.id}`
      )
      .join("\n");
  }

  async function resolveOverseerrUserId(discordUserId) {
    const linked = db.getUserLinkByDiscordId(discordUserId);
    if (linked) {
      return linked.overseerr_user_id;
    }

    return config.overseerr.defaultUserId;
  }

  async function handleLink(interaction) {
    const username = interaction.options.getString("overseerr_username", true);
    const user = await overseerr.findUserByUsername(username);

    if (!user) {
      await interaction.reply(toEphemeralResponse(`No Overseerr user found for: ${username}`));
      return;
    }

    db.upsertUserLink({
      discordUserId: interaction.user.id,
      overseerrUserId: user.id,
      overseerrUsername: user.username || user.displayName || username
    });

    await interaction.reply(
      toEphemeralResponse(
        `Linked to Overseerr user: ${user.displayName || user.username} (id ${user.id})`
      )
    );
  }

  async function handleSearch(interaction) {
    const query = interaction.options.getString("query", true);
    const mediaType = interaction.options.getString("media_type") || "all";
    const results = await overseerr.searchMedia(query, mediaType);

    await interaction.reply(toEphemeralResponse(formatSearchResults(results)));
  }

  async function processRequestSubmission(interaction, { mediaType, mediaInput, seasonInput }) {
    const botConfig = getBotConfig();
    if (
      botConfig.enforceRequestChannel &&
      botConfig.requestsChannelId &&
      interaction.channelId !== botConfig.requestsChannelId
    ) {
      await interaction.reply(
        toEphemeralResponse(`Requests are restricted to <#${botConfig.requestsChannelId}>.`)
      );
      return;
    }

    if (mediaType === "music") {
      const query = String(mediaInput || "").trim();
      if (!query) {
        await interaction.reply(toEphemeralResponse("Provide an artist name, MBID, or MusicBrainz URL for music requests."));
        return;
      }

      if (!lidarr || typeof lidarr.searchArtists !== "function" || typeof lidarr.addArtist !== "function") {
        await interaction.reply(toEphemeralResponse("Lidarr is not configured on this bot yet."));
        return;
      }

      const results = await lidarr.searchArtists(query);
      if (!results.length) {
        await interaction.reply(toEphemeralResponse(`No artist found in Lidarr lookup for: ${query}`));
        return;
      }

      const selected = results.find((item) => !item.inLibrary) || results[0];
      if (selected.inLibrary) {
        await interaction.reply(
          toEphemeralResponse(`Artist already in Lidarr: ${selected.artistName || query}.`)
        );
        return;
      }

      const created = await lidarr.addArtist({
        artist: selected.payload,
        options: lidarr.getDefaults()
      });

      const title = String(created.artistName || selected.artistName || query).trim();
      const localArtistId = Number(created.id || 0);
      const requestId = -Math.max(localArtistId || Date.now(), 1);

      db.upsertRequestEvent({
        requestId,
        mediaType: "music",
        mediaId: localArtistId > 0 ? localArtistId : 0,
        title,
        status: 2,
        statusText: "Added to Lidarr",
        requestedBy: null
      });

      await interaction.reply(
        toEphemeralResponse(`Music request submitted: ${title} (added to Lidarr).`)
      );

      await announceRequestCreated({
        title,
        mediaType: "music",
        mediaId: localArtistId > 0 ? localArtistId : 0,
        requestId,
        requesterDiscordId: interaction.user.id,
        requesterUsername: interaction.user.username,
        seasons: [],
        image: selected.remotePoster || ""
      });

      return;
    }

    const mediaId = Number(mediaInput || 0);

    const parsedSeason = parseSeasonMode(seasonInput);

    if (mediaType === "tv" && parsedSeason.mode === "none") {
      await interaction.reply(
        toEphemeralResponse(
          "TV requests require a season mode: 1, all, latest, season1, or season[1]."
        )
      );
      return;
    }

    if (mediaType === "tv" && parsedSeason.mode === "invalid") {
      await interaction.reply(
        toEphemeralResponse(
          "Invalid season format. Use one of: 1, all, latest, season1, season[1]."
        )
      );
      return;
    }

    if (mediaType === "movie" && parsedSeason.mode !== "none") {
      await interaction.reply(
        toEphemeralResponse("Season is only valid when media_type is TV.")
      );
      return;
    }

    let selectedSeasons = [];
    if (mediaType === "tv") {
      const availableSeasons = await overseerr.getTvSeasonNumbers(mediaId);
      if (availableSeasons.length === 0) {
        await interaction.reply(
          toEphemeralResponse(
            "Could not resolve available seasons from Seerr for that TV ID. Verify the TMDB ID and Seerr metadata."
          )
        );
        return;
      }

      if (parsedSeason.mode === "all") {
        selectedSeasons = availableSeasons;
      } else if (parsedSeason.mode === "latest") {
        selectedSeasons = [availableSeasons[availableSeasons.length - 1]];
      } else if (parsedSeason.mode === "single") {
        if (!availableSeasons.includes(parsedSeason.seasonNumber)) {
          await interaction.reply(
            toEphemeralResponse(
              `Season ${parsedSeason.seasonNumber} does not exist for this show in Seerr. Available: ${availableSeasons.join(", ")}`
            )
          );
          return;
        }
        selectedSeasons = [parsedSeason.seasonNumber];
      }
    }

    const userId = await resolveOverseerrUserId(interaction.user.id);

    const response = await overseerr.requestMedia({
      mediaType,
      mediaId,
      userId,
      seasons: selectedSeasons
    });

    const requestObj = response.request || response;
    const mediaObj = response.media || requestObj.media || {};
    const requestId = requestObj.id || response.id;
    const status = requestObj.status || response.status || 1;
    const title = mediaObj.title || mediaObj.name || `TMDB ${mediaType} ${mediaId}`;
    const requesterUsername =
      requestObj.requestedBy?.displayName || requestObj.requestedBy?.username || interaction.user.username;
    const seasons = Array.isArray(requestObj.seasons)
      ? requestObj.seasons
          .map((item) => {
            if (Number.isInteger(item)) {
              return item;
            }
            if (Number.isInteger(item?.seasonNumber)) {
              return item.seasonNumber;
            }
            return null;
          })
          .filter((item) => Number.isInteger(item))
      : selectedSeasons;

    if (requestId) {
      db.upsertRequestEvent({
        requestId,
        mediaType,
        mediaId,
        title,
        status,
        statusText: overseerr.getRequestStatusText(status),
        requestedBy: userId
      });
    }

    await interaction.reply(
      toEphemeralResponse(
        `Request submitted: ${title}${
          mediaType === "tv" && seasons.length > 0 ? ` (seasons ${seasons.join(", ")})` : ""
        } (request id ${requestId || "unknown"}, status ${overseerr.getRequestStatusText(status)}).`
      )
    );

    await announceRequestCreated({
      title,
      mediaType,
      mediaId,
      requestId,
      requesterDiscordId: interaction.user.id,
      requesterUsername,
      seasons,
      image: mediaObj.posterPath || mediaObj.poster || ""
    });
  }

  async function handleRequest(interaction) {
    await interaction.showModal(buildRequestModal());
  }

  async function handleRequestModalSubmit(interaction) {
    const mediaTypeInput = String(
      interaction.fields.getTextInputValue(REQUEST_MODAL_MEDIA_TYPE) || ""
    )
      .trim()
      .toLowerCase();
    const mediaIdInput = interaction.fields.getTextInputValue(REQUEST_MODAL_MEDIA_ID);
    const seasonInput = String(
      interaction.fields.getTextInputValue(REQUEST_MODAL_SEASON) || ""
    ).trim();

    if (!["movie", "tv", "music"].includes(mediaTypeInput)) {
      await interaction.reply(
        toEphemeralResponse("Media type must be 'movie', 'tv', or 'music'.")
      );
      return;
    }

    if (mediaTypeInput === "music") {
      const musicQuery = String(mediaIdInput || "").trim();
      if (!musicQuery) {
        await interaction.reply(
          toEphemeralResponse("Provide an artist name, MBID, or MusicBrainz URL for music requests.")
        );
        return;
      }

      await processRequestSubmission(interaction, {
        mediaType: mediaTypeInput,
        mediaInput: musicQuery,
        seasonInput: ""
      });
      return;
    }

    const parsedMediaId = parseMediaIdInput(mediaIdInput);
    if (!parsedMediaId) {
      await interaction.reply(
        toEphemeralResponse("Could not parse a TMDB ID. Use a numeric ID or TMDB movie/tv URL.")
      );
      return;
    }

    await processRequestSubmission(interaction, {
      mediaType: mediaTypeInput,
      mediaInput: parsedMediaId,
      seasonInput
    });
  }

  async function handleStatus(interaction) {
    const requestId = interaction.options.getInteger("request_id", true);
    const request = await overseerr.getRequestById(requestId);

    const title = await resolveRequestTitleFromDetails(request);
    const statusSnapshot = overseerr.resolveStatusSnapshot(request);
    const statusText = statusSnapshot.statusText;

    db.upsertRequestEvent({
      requestId: request.id,
      mediaType: request.type || request.media?.mediaType || "unknown",
      mediaId: request.media?.tmdbId || 0,
      title,
      status: statusSnapshot.status,
      statusText,
      requestedBy: request.requestedBy?.id
    });

    await interaction.reply(toEphemeralResponse(`Request #${request.id}: ${title} is currently ${statusText}.`));
  }

  async function handleIssues(interaction) {
    const limit = interaction.options.getInteger("limit") || 5;
    const issues = await overseerr.getRecentIssues(limit);

    if (!issues.length) {
      await interaction.reply(toEphemeralResponse("No recent Overseerr issues found."));
      return;
    }

    const lines = issues
      .slice(0, limit)
      .map((issue) => {
        return `• #${issue.id} ${issue.subject} (${issueTypeText(issue.issueType)}, ${issueStatusText(issue.status)})`;
      })
      .join("\n");

    await interaction.reply(toEphemeralResponse(`Recent Overseerr issues:\n${lines}`));
  }

  async function handleRespond(interaction) {
    const cfg = getBotConfig();
    if (!cfg.reportsChannelId) {
      await interaction.reply(
        toEphemeralResponse("Reports channel is not configured. Set Reports Channel ID in web UI first.")
      );
      return;
    }

    if (interaction.channelId !== cfg.reportsChannelId) {
      await interaction.reply(
        toEphemeralResponse(`Use /respond only in <#${cfg.reportsChannelId}>.`)
      );
      return;
    }

    const issueId = interaction.options.getInteger("issue_id", true);
    const message = String(interaction.options.getString("message", true) || "").trim();

    if (!message) {
      await interaction.reply(toEphemeralResponse("Response message cannot be empty."));
      return;
    }

    await overseerr.createIssueComment(issueId, message);
    await interaction.reply(
      toEphemeralResponse(`Posted response to issue #${issueId}.`)
    );
  }

  async function handleRecent(interaction) {
    const latest = await jellyfin.getLatestItems(8);
    if (latest.length === 0) {
      await interaction.reply(toEphemeralResponse("No recent Jellyfin items found."));
      return;
    }

    const lines = latest
      .map((item) => `• ${item.name} (${item.type}${item.productionYear ? `, ${item.productionYear}` : ""})`)
      .join("\n");

    await interaction.reply(toEphemeralResponse(`Latest from Jellyfin:\n${lines}`));
  }

  function formatJellyfinSearchResults(items) {
    if (!items.length) {
      return "No Jellyfin results found.";
    }

    return items
      .slice(0, 8)
      .map((item) => {
        const year = item.productionYear ? `, ${item.productionYear}` : "";
        const runtime = item.runTimeTicks > 0 ? `, ${jellyfin.ticksToDuration(item.runTimeTicks)}` : "";
        const series = item.seriesName ? `, ${item.seriesName}` : "";
        return `• ${item.name} (${item.type}${year}${runtime}${series})`;
      })
      .join("\n");
  }

  async function handleJellySearch(interaction) {
    const query = interaction.options.getString("query", true);
    const mediaType = interaction.options.getString("media_type") || "all";

    const items = await jellyfin.searchItems({
      query,
      mediaType,
      limit: 8
    });

    await interaction.reply(toEphemeralResponse(`Jellyfin search results:\n${formatJellyfinSearchResults(items)}`));
  }

  async function handleJellyStats(interaction) {
    const [usage, sections] = await Promise.all([
      jellyfin.getUsageStats(),
      jellyfin.getLibrarySections()
    ]);

    const sectionSummary =
      sections.length > 0
        ? sections
            .slice(0, 8)
            .map((section) => `• ${section.name} (${section.collectionType}, paths: ${section.pathCount})`)
            .join("\n")
        : "No library sections returned.";

    const lines = [
      "Jellyfin stats:",
      `• Movies: ${usage.movieCount}`,
      `• Series: ${usage.seriesCount}`,
      `• Episodes: ${usage.episodeCount}`,
      `• Songs: ${usage.songCount}`,
      `• Played items total: ${usage.playedItemsCount}`,
      `• Active sessions: ${usage.activeSessions}`,
      "",
      "Library sections:",
      sectionSummary
    ];

    await interaction.reply(toEphemeralResponse(lines.join("\n")));
  }

  async function handleNowPlaying(interaction) {
    const limit = interaction.options.getInteger("limit") || 6;
    const result = await jellyfin.getNowPlaying(limit);

    if (result.nowPlaying.length === 0) {
      await interaction.reply(
        toEphemeralResponse(`No active playback right now. Active sessions: ${result.activeSessions}`)
      );
      return;
    }

    const lines = result.nowPlaying
      .map((item) => {
        const percent = Number.isInteger(item.playbackPercent) ? `${item.playbackPercent}%` : "n/a";
        const pause = item.paused ? "paused" : "playing";
        return `• ${item.name} (${item.type}, ${percent}, ${pause}, ${item.playMethod})`;
      })
      .join("\n");

    await interaction.reply(
      toEphemeralResponse(
        `Now playing (${result.nowPlaying.length}/${result.activeSessions} sessions):\n${lines}`
      )
    );
  }

  async function handleLibraries(interaction) {
    const sections = await jellyfin.getLibrarySections();
    if (sections.length === 0) {
      await interaction.reply(toEphemeralResponse("No Jellyfin library sections returned."));
      return;
    }

    const lines = sections
      .map((section) => `• ${section.name} (${section.collectionType}, paths: ${section.pathCount})`)
      .join("\n");

    await interaction.reply(toEphemeralResponse(`Jellyfin library sections:\n${lines}`));
  }

  async function publishJellyfinNowPlayingSnapshot({ forced = false } = {}) {
    if (!online) {
      return { ok: false, message: "Discord bot is not online." };
    }

    const cfg = getBotConfig();
    if (!cfg.jellyfinNowPlayingChannelId) {
      return { ok: false, message: "Jellyfin Now Playing channel is not configured." };
    }

    const result = await jellyfin.getNowPlaying(8);
    const lines =
      result.nowPlaying.length > 0
        ? result.nowPlaying
            .map((item) => {
              const percent = Number.isInteger(item.playbackPercent) ? `${item.playbackPercent}%` : "n/a";
              const pause = item.paused ? "paused" : "playing";
              return `• ${item.name} (${item.type}, ${percent}, ${pause}, ${item.playMethod})`;
            })
            .join("\n")
        : "No active playback right now.";

    const payload = buildAnnouncementPayload({
      title: "Jellyfin Now Playing",
      description: forced ? "Manual snapshot" : "Automated snapshot",
      color: 0x4cc9f0,
      fields: [
        {
          name: "Playback",
          value: lines.slice(0, 1024),
          inline: false
        },
        {
          name: "Active Sessions",
          value: String(result.activeSessions),
          inline: true
        }
      ]
    });

    await sendToChannel(cfg.jellyfinNowPlayingChannelId, payload);
    return {
      ok: true,
      channelId: cfg.jellyfinNowPlayingChannelId,
      activeSessions: result.activeSessions,
      itemCount: result.nowPlaying.length
    };
  }

  async function publishJellyfinStatsSnapshot({ forced = false } = {}) {
    if (!online) {
      return { ok: false, message: "Discord bot is not online." };
    }

    const cfg = getBotConfig();
    if (!cfg.jellyfinStatsChannelId) {
      return { ok: false, message: "Jellyfin Stats channel is not configured." };
    }

    const [usage, sections] = await Promise.all([
      jellyfin.getUsageStats(),
      jellyfin.getLibrarySections()
    ]);

    const sectionsText =
      sections.length > 0
        ? sections
            .slice(0, 8)
            .map((section) => `• ${section.name} (${section.collectionType}, paths: ${section.pathCount})`)
            .join("\n")
        : "No library sections returned.";

    const payload = buildAnnouncementPayload({
      title: "Jellyfin Stats Snapshot",
      description: forced ? "Manual snapshot" : "Automated snapshot",
      color: 0x2ecc71,
      fields: [
        {
          name: "Library Totals",
          value: [
            `Movies: ${usage.movieCount}`,
            `Series: ${usage.seriesCount}`,
            `Episodes: ${usage.episodeCount}`,
            `Songs: ${usage.songCount}`,
            `Played Items: ${usage.playedItemsCount}`,
            `Active Sessions: ${usage.activeSessions}`
          ].join("\n"),
          inline: false
        },
        {
          name: "Sections",
          value: sectionsText.slice(0, 1024),
          inline: false
        }
      ]
    });

    await sendToChannel(cfg.jellyfinStatsChannelId, payload);
    return {
      ok: true,
      channelId: cfg.jellyfinStatsChannelId,
      usage,
      sectionCount: sections.length
    };
  }

  async function notifyDiscordUser(discordUserId, message) {
    // DM notifications are intentionally disabled; updates are server-channel only.
    return;
  }

  client.once("clientReady", async () => {
    logger.info(`Discord bot logged in as ${client.user.tag}`);

    try {
      await registerSlashCommands();
    } catch (error) {
      logger.error(`Failed to register slash commands: ${error.message}`);
    }
  });

  client.on("interactionCreate", async (interaction) => {
    if (interaction.isModalSubmit()) {
      if (interaction.customId === REQUEST_MODAL_ID) {
        try {
          await handleRequestModalSubmit(interaction);
        } catch (error) {
          const detail = describeCommandError(error);
          logger.error(`Request modal handling error: ${detail}`);
          const response = toEphemeralResponse(`Request failed: ${detail}`);

          if (interaction.replied || interaction.deferred) {
            await interaction.followUp(response);
          } else {
            await interaction.reply(response);
          }
        }
      }

      return;
    }

    if (!interaction.isChatInputCommand()) {
      return;
    }

    try {
      switch (interaction.commandName) {
        case "link":
          await handleLink(interaction);
          break;
        case "search":
          await handleSearch(interaction);
          break;
        case "request":
          await handleRequest(interaction);
          break;
        case "status":
          await handleStatus(interaction);
          break;
        case "issues":
          await handleIssues(interaction);
          break;
        case "respond":
          await handleRespond(interaction);
          break;
        case "recent":
          await handleRecent(interaction);
          break;
        case "jellysearch":
          await handleJellySearch(interaction);
          break;
        case "jellystats":
          await handleJellyStats(interaction);
          break;
        case "nowplaying":
          await handleNowPlaying(interaction);
          break;
        case "libraries":
          await handleLibraries(interaction);
          break;
        case "requesthelp":
          await handleRequestHelp(interaction);
          break;
        default:
          await interaction.reply(toEphemeralResponse("Unknown command."));
      }
    } catch (error) {
      const detail = describeCommandError(error);
      logger.error(`Command handling error: ${detail}`);
      const response = toEphemeralResponse(`Command failed: ${detail}`);

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(response);
      } else {
        await interaction.reply(response);
      }
    }
  });

  return {
    start: async () => {
      if (!config.discord.token || !config.discord.clientId || !config.discord.guildId) {
        logger.warn(
          "Discord bot is not configured yet. Set DISCORD_TOKEN, DISCORD_CLIENT_ID, and DISCORD_GUILD_ID in the web UI to enable it."
        );
        return;
      }

      await client.login(config.discord.token);
      online = true;
      startDailyNewsScheduler();
      startIssuePolling();
    },
    notifyDiscordUser,
    announceRequestStatusChange,
    sendManualChannelTest,
    sendDailyNewsReport,
    publishJellyfinNowPlayingSnapshot,
    publishJellyfinStatsSnapshot,
    getClient: () => client
  };
}

module.exports = { createDiscordBot };
