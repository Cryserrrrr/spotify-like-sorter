const express = require("express");
const SpotifyWebApi = require("spotify-web-api-node");
const cookieParser = require("cookie-parser");
const https = require("https");
const fs = require("fs");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === "production";

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
    "user-library-modify",
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
      secure: isProduction,
      sameSite: "strict",
      maxAge: 3600000,
    });
    res.cookie("refresh_token", refresh_token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "strict",
      maxAge: 86400000,
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

    while (hasMore) {
      const data = await spotifyApi.getMySavedTracks({ limit, offset });
      allTracks = allTracks.concat(data.body.items);
      hasMore = data.body.items.length === limit;
      offset += limit;
    }

    res.json(allTracks);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch liked songs" });
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

    if (
      !playlistId ||
      !trackUris ||
      (Array.isArray(trackUris) && trackUris.length === 0)
    ) {
      return res
        .status(400)
        .json({ error: "Missing playlist ID or track URIs" });
    }

    spotifyApi.setAccessToken(req.cookies.access_token);

    const uris = Array.isArray(trackUris) ? trackUris : [trackUris];

    const batchSize = 100;
    for (let i = 0; i < uris.length; i += batchSize) {
      const batch = uris.slice(i, i + batchSize);
      try {
        await spotifyApi.addTracksToPlaylist(playlistId, batch);
      } catch (batchError) {
        console.log(
          "Error adding batch:",
          batchError?.statusCode || batchError?.message
        );
        if (batchError?.statusCode === 401) {
          return res
            .status(401)
            .json({ error: "Unauthorized - please login again" });
        }
        if (batchError?.statusCode === 403) {
          return res.status(403).json({
            error:
              "Forbidden - insufficient permissions. Please login again to refresh permissions.",
          });
        }
        throw batchError;
      }
    }

    res.json({ success: true, addedCount: uris.length });
  } catch (error) {
    console.log(
      "Error in add-to-playlist:",
      error?.statusCode || error?.message
    );

    if (error?.statusCode === 401) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (error?.statusCode === 403) {
      return res
        .status(403)
        .json({ error: "Forbidden - insufficient permissions" });
    }

    res.status(500).json({
      error: "Failed to add track(s) to playlist",
      details: error?.message || "Unknown error",
    });
  }
});

app.post("/api/remove-from-liked", async (req, res) => {
  try {
    const { trackIds } = req.body;

    if (!trackIds || (Array.isArray(trackIds) && trackIds.length === 0)) {
      return res.status(400).json({ error: "No track IDs provided" });
    }

    spotifyApi.setAccessToken(req.cookies.access_token);

    const ids = Array.isArray(trackIds) ? trackIds : [trackIds];

    const batchSize = 50;
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      try {
        await spotifyApi.removeFromMySavedTracks(batch);
      } catch (batchError) {
        console.log(
          "Error removing batch:",
          batchError?.statusCode || batchError?.message
        );
        if (batchError?.statusCode === 401) {
          return res
            .status(401)
            .json({ error: "Unauthorized - please login again" });
        }
        if (batchError?.statusCode === 403) {
          return res.status(403).json({
            error:
              "Forbidden - insufficient permissions. Please login again to refresh permissions.",
          });
        }
        throw batchError;
      }
    }

    res.json({ success: true, removedCount: ids.length });
  } catch (error) {
    console.log(
      "Error in remove-from-liked:",
      error?.statusCode || error?.message
    );

    if (error?.statusCode === 401) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (error?.statusCode === 403) {
      return res
        .status(403)
        .json({ error: "Forbidden - insufficient permissions" });
    }

    res.status(500).json({
      error: "Failed to remove track(s) from liked songs",
      details: error?.message || "Unknown error",
    });
  }
});

app.get("/logout", (req, res) => {
  res.clearCookie("access_token");
  res.clearCookie("refresh_token");
  res.redirect("/");
});

if (isProduction) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
} else {
  try {
    const options = {
      key: fs.readFileSync("127.0.0.1-key.pem"),
      cert: fs.readFileSync("127.0.0.1.pem"),
    };

    https.createServer(options, app).listen(PORT, "127.0.0.1", () => {
      console.log(`HTTPS Server running on https://127.0.0.1:${PORT}`);
    });
  } catch (error) {
    console.log("SSL certificates not found, falling back to HTTP");
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`HTTP Server running on port ${PORT}`);
    });
  }
}
