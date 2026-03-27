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
      .setDescription("Open an easy request form for movie, TV, or music"),
    new SlashCommandBuilder()
      .setName("requesthelp")
      .setDescription("Show how to use the /request command with TV seasons"),
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
      .setName("issues")
      .setDescription("Show recent reports/issues from Overseerr")
      .addIntegerOption((option) =>
        option
          .setName("limit")
          .setDescription("How many issues to show (1-10)")
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(10)
      ),
    new SlashCommandBuilder()
      .setName("respond")
      .setDescription("Respond to a Seerr issue report (reports channel only)")
      .addIntegerOption((option) =>
        option
          .setName("issue_id")
          .setDescription("Seerr issue ID")
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("message")
          .setDescription("Response message to add to the issue")
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName("recent")
      .setDescription("Show latest items from Jellyfin"),
    new SlashCommandBuilder()
      .setName("jellysearch")
      .setDescription("Search your Jellyfin library")
      .addStringOption((option) =>
        option
          .setName("query")
          .setDescription("Title or keyword")
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("media_type")
          .setDescription("Filter by library item type")
          .addChoices(
            { name: "All", value: "all" },
            { name: "Movie", value: "movie" },
            { name: "Series", value: "series" },
            { name: "Episode", value: "episode" },
            { name: "Audio", value: "audio" }
          )
          .setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName("jellystats")
      .setDescription("Show Jellyfin media library and usage stats"),
    new SlashCommandBuilder()
      .setName("nowplaying")
      .setDescription("Show currently playing media in Jellyfin")
      .addIntegerOption((option) =>
        option
          .setName("limit")
          .setDescription("How many active plays to show (1-10)")
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(10)
      ),
    new SlashCommandBuilder()
      .setName("libraries")
      .setDescription("Show Jellyfin library sections and types")
  ];
}

module.exports = { buildCommands };
