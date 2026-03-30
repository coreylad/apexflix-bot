const axios = require("axios");

function createTmdbClient(config) {
  function normalizedBaseUrl() {
    const raw = String(config?.baseUrl || "https://api.themoviedb.org").trim();
    return raw.replace(/\/+$/, "") || "https://api.themoviedb.org";
  }

  function normalizedToken() {
    return String(config?.readAccessToken || "").trim();
  }

  function ensureConfigured() {
    if (!normalizedToken()) {
      throw new Error("TMDB is not configured yet. Set TMDB_API_READ_TOKEN with a TMDB v4 read token.");
    }
  }

  function getClient() {
    ensureConfigured();

    return axios.create({
      baseURL: normalizedBaseUrl(),
      timeout: 15000,
      headers: {
        Authorization: `Bearer ${normalizedToken()}`,
        Accept: "application/json",
        "Content-Type": "application/json"
      }
    });
  }

  function normalizeMediaType(mediaType) {
    const normalized = String(mediaType || "movie").trim().toLowerCase();
    return normalized === "tv" ? "tv" : "movie";
  }

  function normalizePosterPath(raw) {
    const value = String(raw || "").trim();
    return value || "";
  }

  function normalizeResult(item, mediaTypeHint = "") {
    const guessedType = item?.media_type || mediaTypeHint || (item?.first_air_date ? "tv" : "movie");
    const mediaType = normalizeMediaType(guessedType);
    return {
      id: Number(item?.id || 0),
      mediaType,
      title: String(item?.title || item?.name || item?.original_title || item?.original_name || "Unknown title"),
      overview: String(item?.overview || ""),
      posterPath: normalizePosterPath(item?.poster_path),
      backdropPath: normalizePosterPath(item?.backdrop_path),
      releaseDate: String(item?.release_date || item?.first_air_date || ""),
      voteAverage: Number(item?.vote_average || 0),
      voteCount: Number(item?.vote_count || 0),
      popularity: Number(item?.popularity || 0),
      genreIds: Array.isArray(item?.genre_ids) ? item.genre_ids.map((value) => Number(value)).filter(Number.isFinite) : [],
      adult: Boolean(item?.adult),
      originalLanguage: String(item?.original_language || "")
    };
  }

  function normalizeGenreRows(rows) {
    return Array.isArray(rows)
      ? rows
          .map((row) => ({ id: Number(row?.id || 0), name: String(row?.name || "").trim() }))
          .filter((row) => row.id > 0 && row.name)
      : [];
  }

  async function getGenres(mediaType) {
    const client = getClient();
    const type = normalizeMediaType(mediaType);
    const response = await client.get(`/3/genre/${type}/list`, {
      params: { language: "en-US" }
    });
    return normalizeGenreRows(response?.data?.genres);
  }

  async function discover({ mediaType = "movie", category = "popular", page = 1, genre = "", query = "" } = {}) {
    const client = getClient();
    const type = normalizeMediaType(mediaType);
    const normalizedCategory = String(category || "popular").trim().toLowerCase();
    const normalizedPage = Math.max(1, Math.min(500, Number(page || 1) || 1));
    const normalizedGenre = String(genre || "").trim();
    const normalizedQuery = String(query || "").trim();

    if (normalizedQuery) {
      const response = await client.get(`/3/search/${type}`, {
        params: {
          query: normalizedQuery,
          page: normalizedPage,
          include_adult: false,
          language: "en-US"
        }
      });

      return {
        category: "search",
        mediaType: type,
        page: Number(response?.data?.page || normalizedPage),
        totalPages: Number(response?.data?.total_pages || 1),
        totalResults: Number(response?.data?.total_results || 0),
        results: Array.isArray(response?.data?.results)
          ? response.data.results.map((item) => normalizeResult(item, type))
          : []
      };
    }

    const presetRouteMap = {
      movie: {
        popular: "/3/movie/popular",
        top_rated: "/3/movie/top_rated",
        upcoming: "/3/movie/upcoming",
        now_playing: "/3/movie/now_playing",
        trending: "/3/trending/movie/week",
        discover: "/3/discover/movie"
      },
      tv: {
        popular: "/3/tv/popular",
        top_rated: "/3/tv/top_rated",
        airing_today: "/3/tv/airing_today",
        on_the_air: "/3/tv/on_the_air",
        trending: "/3/trending/tv/week",
        discover: "/3/discover/tv"
      }
    };

    const route = presetRouteMap[type][normalizedCategory] || presetRouteMap[type].popular;
    const params = {
      page: normalizedPage,
      language: "en-US"
    };

    if (route.includes("/discover/")) {
      params.include_adult = false;
      params.include_video = false;
      params.sort_by = normalizedCategory === "top_rated" ? "vote_average.desc" : "popularity.desc";
      if (normalizedGenre) {
        params.with_genres = normalizedGenre;
      }
    }

    const response = await client.get(route, { params });
    return {
      category: normalizedCategory,
      mediaType: type,
      page: Number(response?.data?.page || normalizedPage),
      totalPages: Number(response?.data?.total_pages || 1),
      totalResults: Number(response?.data?.total_results || 0),
      results: Array.isArray(response?.data?.results)
        ? response.data.results.map((item) => normalizeResult(item, type))
        : []
    };
  }

  async function getDetails(mediaType, mediaId) {
    const client = getClient();
    const type = normalizeMediaType(mediaType);
    const id = Number(mediaId || 0);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error("TMDB media ID must be a positive integer.");
    }

    const response = await client.get(`/3/${type}/${id}`, {
      params: {
        language: "en-US"
      }
    });

    const item = response?.data || {};
    const normalized = normalizeResult(item, type);
    return {
      ...normalized,
      genres: normalizeGenreRows(item?.genres),
      runtime: Number(item?.runtime || item?.episode_run_time?.[0] || 0),
      seasons: Array.isArray(item?.seasons)
        ? item.seasons
            .map((season) => ({
              seasonNumber: Number(season?.season_number || 0),
              name: String(season?.name || ""),
              episodeCount: Number(season?.episode_count || 0)
            }))
            .filter((season) => season.seasonNumber > 0)
        : []
    };
  }

  return {
    getGenres,
    discover,
    getDetails
  };
}

module.exports = { createTmdbClient };