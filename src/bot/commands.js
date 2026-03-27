const { SlashCommandBuilder } = require("discord.js");

function buildCommands() {
  return [
    new SlashCommandBuilder()
      .setName("link")
      .setDescription("Link your Discord account to an Overseerr user")
      .addStringOption((option) =>
        option
          .setName("overseerr_username")
          .setDescription("Your Overseerr username or display name")
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName("search")
      .setDescription("Search for media in Overseerr")
      .addStringOption((option) =>
        option.setName("query").setDescription("Movie/TV title").setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("media_type")
          .setDescription("Filter by media type")
          .addChoices(
            { name: "All", value: "all" },
            { name: "Movie", value: "movie" },
            { name: "TV", value: "tv" }
          )
          .setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName("request")
      .setDescription("Request a movie or TV show by TMDB media id")
      .addIntegerOption((option) =>
        option
          .setName("media_id")
          .setDescription("TMDB media id from /search results")
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("media_type")
          .setDescription("Movie or TV")
          .addChoices(
            { name: "Movie", value: "movie" },
            { name: "TV", value: "tv" }
          )
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName("status")
      .setDescription("Check request status in Overseerr")
      .addIntegerOption((option) =>
        option
          .setName("request_id")
          .setDescription("Overseerr request id")
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName("recent")
      .setDescription("Show latest items from Jellyfin")
  ];
}

module.exports = { buildCommands };
