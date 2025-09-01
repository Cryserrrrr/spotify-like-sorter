const express = require("express");
const SpotifyWebApi = require("spotify-web-api-node");
const cookieParser = require("cookie-parser");
const https = require("https");
const fs = require("fs");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static("public"));
app.use(cookieParser());

const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: process.env.REDIRECT_URI,
});

const generateRandomString = (length) => {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
};

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

app.get("/login", (req, res) => {
  const state = generateRandomString(16);
  res.cookie("spotify_auth_state", state);

  const scopes = [
    "user-library-read",
    "playlist-read-private",
    "playlist-modify-public",
    "playlist-modify-private",
    "streaming",
    "user-read-email",
    "user-read-private",
    "user-read-playback-state",
    "user-modify-playback-state",
  ];

  const authorizeURL = spotifyApi.createAuthorizeURL(scopes, state);
  res.redirect(authorizeURL);
});

app.get("/callback", async (req, res) => {
  const code = req.query.code;
  const state = req.query.state;
  const storedState = req.cookies ? req.cookies["spotify_auth_state"] : null;

  if (state === null || state !== storedState) {
    res.redirect("/#error=state_mismatch");
    return;
  }

  res.clearCookie("spotify_auth_state");

  try {
    const data = await spotifyApi.authorizationCodeGrant(code);
    const { access_token, refresh_token } = data.body;

    spotifyApi.setAccessToken(access_token);
    spotifyApi.setRefreshToken(refresh_token);

    res.cookie("access_token", access_token, {
      httpOnly: false,
      secure: true,
      sameSite: "strict",
      maxAge: 3600000, // 1 hour
    });
    res.cookie("refresh_token", refresh_token, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      maxAge: 86400000, // 24 hours
    });

    res.redirect("/dashboard");
  } catch (error) {
    res.redirect("/#error=invalid_token");
  }
});

app.get("/dashboard", (req, res) => {
  if (!req.cookies.access_token) {
    res.redirect("/");
    return;
  }
  res.sendFile(__dirname + "/public/dashboard.html");
});

app.get("/api/token", (req, res) => {
  const accessToken = req.cookies.access_token;
  if (!accessToken) {
    res.status(401).json({ error: "No access token found" });
    return;
  }
  res.json({ access_token: accessToken });
});

app.get("/api/user", async (req, res) => {
  try {
    spotifyApi.setAccessToken(req.cookies.access_token);
    const userData = await spotifyApi.getMe();
    res.json(userData.body);
  } catch (error) {
    res.status(401).json({ error: "Unauthorized" });
  }
});

app.get("/api/liked-songs", async (req, res) => {
  try {
    spotifyApi.setAccessToken(req.cookies.access_token);
    const limit = 50;
    let offset = 0;
    let allTracks = [];
    let hasMore = true;

    const skipGenres = req.query.skipGenres === "true";
    const fastLoad = req.query.fastLoad === "true";

    while (hasMore) {
      const data = await spotifyApi.getMySavedTracks({ limit, offset });
      allTracks = allTracks.concat(data.body.items);
      hasMore = data.body.items.length === limit;
      offset += limit;
    }

    allTracks.forEach((item) => {
      if (item.track) {
        item.track.genres = [];
      }
    });

    if (fastLoad) {
      res.json(allTracks);
      return;
    }

    if (!skipGenres) {
      const batchSize = 10;
      let processedCount = 0;

      for (let i = 0; i < allTracks.length; i += batchSize) {
        const batch = allTracks.slice(i, i + batchSize);

        for (let item of batch) {
          try {
            if (
              item.track &&
              item.track.artists &&
              item.track.artists.length > 0
            ) {
              const artistIds = item.track.artists
                .slice(0, 2)
                .map((artist) => artist.id);
              await new Promise((resolve) => setTimeout(resolve, 50));

              const artistsData = await spotifyApi.getArtists(artistIds);

              const genres = new Set();
              artistsData.body.artists.forEach((artist) => {
                if (artist.genres) {
                  artist.genres.forEach((genre) => genres.add(genre));
                }
              });

              item.track.genres = Array.from(genres);
              processedCount++;
            }
          } catch (artistError) {
            if (artistError.statusCode === 429) {
              for (let j = i; j < allTracks.length; j++) {
                allTracks[j].track.genres = [];
              }
              break;
            } else {
              item.track.genres = [];
            }
          }
        }

        if (processedCount < i + batch.length) {
          break;
        }
        if (i + batchSize < allTracks.length) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }
    }

    res.json(allTracks);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch liked songs" });
  }
});

app.get("/api/liked-songs-genres", async (req, res) => {
  try {
    spotifyApi.setAccessToken(req.cookies.access_token);
    const limit = 50;
    let offset = 0;
    let allTracks = [];
    let hasMore = true;

    console.log("Starting to fetch liked songs for genres...");
    while (hasMore) {
      const data = await spotifyApi.getMySavedTracks({ limit, offset });
      allTracks = allTracks.concat(data.body.items);
      hasMore = data.body.items.length === limit;
      offset += limit;
    }
    console.log(`Fetched ${allTracks.length} tracks for genre processing`);

    const trackGenres = {};
    const batchSize = 5;
    let processedCount = 0;

    for (let i = 0; i < allTracks.length; i += batchSize) {
      const batch = allTracks.slice(i, i + batchSize);

      for (let item of batch) {
        try {
          if (
            item.track &&
            item.track.artists &&
            item.track.artists.length > 0
          ) {
            const artistIds = item.track.artists
              .slice(0, 2)
              .map((artist) => artist.id);
            await new Promise((resolve) => setTimeout(resolve, 200));

            const artistsData = await spotifyApi.getArtists(artistIds);

            const genres = new Set();
            artistsData.body.artists.forEach((artist) => {
              if (artist.genres) {
                artist.genres.forEach((genre) => genres.add(genre));
              }
            });

            trackGenres[item.track.uri] = Array.from(genres);
            processedCount++;
          }
        } catch (artistError) {
          console.log(
            "Error fetching artist data:",
            artistError.statusCode || artistError.message
          );
          if (artistError.statusCode === 429) {
            console.log("Rate limit hit, stopping genre fetching");
            break;
          } else {
            trackGenres[item.track.uri] = [];
          }
        }
      }

      if (processedCount < i + batch.length) {
        break;
      }
      if (i + batchSize < allTracks.length) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    console.log(
      `Processed genres for ${Object.keys(trackGenres).length} tracks`
    );
    res.json(trackGenres);
  } catch (error) {
    console.log("Error in genres endpoint:", error);
    res.status(500).json({ error: "Failed to fetch genres" });
  }
});

app.get("/api/playlists", async (req, res) => {
  try {
    spotifyApi.setAccessToken(req.cookies.access_token);

    const userInfo = await spotifyApi.getMe();
    const currentUserId = userInfo.body.id;

    const data = await spotifyApi.getUserPlaylists();

    const editablePlaylists = data.body.items.filter((playlist) => {
      return (
        playlist.owner.id === currentUserId || playlist.collaborative === true
      );
    });

    res.json(editablePlaylists);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch playlists" });
  }
});

app.post("/api/add-to-playlist", async (req, res) => {
  try {
    const { playlistId, trackUris } = req.body;
    spotifyApi.setAccessToken(req.cookies.access_token);

    const uris = Array.isArray(trackUris) ? trackUris : [trackUris];

    const batchSize = 100;
    for (let i = 0; i < uris.length; i += batchSize) {
      const batch = uris.slice(i, i + batchSize);
      await spotifyApi.addTracksToPlaylist(playlistId, batch);
    }

    res.json({ success: true, addedCount: uris.length });
  } catch (error) {
    res.status(500).json({ error: "Failed to add track(s) to playlist" });
  }
});

app.post("/api/remove-from-liked", async (req, res) => {
  try {
    const { trackIds } = req.body;
    spotifyApi.setAccessToken(req.cookies.access_token);

    const ids = Array.isArray(trackIds) ? trackIds : [trackIds];

    const batchSize = 50;
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      await spotifyApi.removeFromMySavedTracks(batch);
    }

    res.json({ success: true, removedCount: ids.length });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to remove track(s) from liked songs" });
  }
});

app.get("/logout", (req, res) => {
  res.clearCookie("access_token");
  res.clearCookie("refresh_token");
  res.redirect("/");
});

const options = {
  key: fs.readFileSync("127.0.0.1-key.pem"),
  cert: fs.readFileSync("127.0.0.1.pem"),
};

https.createServer(options, app).listen(PORT, "127.0.0.1", () => {});
