let likedSongs = [];
let playlists = [];
let selectedSongs = new Set();
let selectedPlaylist = null;
let player = null;
let deviceId = null;
let currentTrackUri = null;
let isPlaying = false;
let accessToken = null;
let filteredSongs = [];
let currentFilters = {
  title: "",
  artist: "",
};

async function init() {
  try {
    await loadUserData();
    await loadPlaylists();
    await loadLikedSongs();
    await initializeSpotifyPlayer();
  } catch (error) {
    showStatus("Error loading data. Please refresh the page.", "error");
  }
}

window.onSpotifyWebPlaybackSDKReady = () => {};

async function initializeSpotifyPlayer() {
  let token = getCookie("access_token");

  if (!token) {
    try {
      const response = await fetch("/api/token");
      if (response.ok) {
        const data = await response.json();
        token = data.access_token;
      }
    } catch (error) {}
  }

  if (!token) {
    showStatus(
      "No access token found. Please logout and login again.",
      "error"
    );
    return;
  }

  accessToken = token;

  if (window.Spotify) {
    createSpotifyPlayer();
    return;
  }

  window.onSpotifyWebPlaybackSDKReady = () => {
    createSpotifyPlayer();
  };

  if (
    !document.querySelector(
      'script[src="https://sdk.scdn.co/spotify-player.js"]'
    )
  ) {
    const script = document.createElement("script");
    script.src = "https://sdk.scdn.co/spotify-player.js";
    script.onerror = () => {
      showStatus("Failed to load Spotify SDK", "error");
    };
    document.head.appendChild(script);
  }

  setTimeout(() => {
    if (!player) {
      showStatus(
        "Player initialization timeout. Check your internet connection and Spotify Premium status.",
        "error"
      );
    }
  }, 10000);
}

function createSpotifyPlayer() {
  try {
    player = new Spotify.Player({
      name: "Spotify Like Sorter Web Player",
      getOAuthToken: (cb) => {
        cb(accessToken);
      },
      volume: 0.05,
    });

    player.addListener("initialization_error", ({ message }) => {
      showStatus("Player initialization error: " + message, "error");
    });

    player.addListener("authentication_error", ({ message }) => {
      showStatus(
        "Authentication error: " +
          message +
          ". You need Spotify Premium and must re-login to grant streaming permissions.",
        "error"
      );
    });

    player.addListener("account_error", ({ message }) => {
      showStatus(
        "Account error: " +
          message +
          ". Spotify Premium required for music streaming.",
        "error"
      );
    });

    player.addListener("playback_error", ({ message }) => {
      showStatus("Playback error: " + message, "error");
    });

    player.addListener("ready", ({ device_id }) => {
      deviceId = device_id;
      document.getElementById("player-controls").style.display = "flex";
      showStatus("Spotify player ready! You can now play music.", "success");
    });

    player.addListener("not_ready", ({ device_id }) => {
      showStatus("Player went offline", "error");
    });

    player.addListener("player_state_changed", (state) => {
      if (!state) {
        return;
      }

      const track = state.track_window.current_track;
      if (track) {
        document.getElementById("current-track").textContent = track.name;
        document.getElementById("current-artist").textContent = track.artists
          .map((a) => a.name)
          .join(", ");
        currentTrackUri = track.uri;
      }

      isPlaying = !state.paused;
      const playPauseBtn = document.getElementById("play-pause-btn");
      const playPauseIcon = playPauseBtn.querySelector("i");
      playPauseIcon.className = isPlaying ? "icon-pause" : "icon-play";

      updateSongPlayingState();
    });

    player.connect().then((success) => {
      if (!success) {
        showStatus(
          "Failed to connect to Spotify player. Please check your Spotify Premium status and re-login.",
          "error"
        );
      }
    });
  } catch (error) {
    showStatus("Error creating Spotify player: " + error.message, "error");
  }
}

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(";").shift();
}

async function loadUserData() {
  const response = await fetch("/api/user");
  if (!response.ok) {
    throw new Error("Failed to load user data");
  }
  const userData = await response.json();
  document.getElementById("username").textContent =
    userData.display_name || "User";
}

async function loadLikedSongs() {
  showStatus("Loading your songs...", "success");
  const response = await fetch("/api/liked-songs");
  if (!response.ok) {
    throw new Error("Failed to load liked songs");
  }
  likedSongs = await response.json();
  setupFilters();
  applyFilters();
  showStatus(`Loaded ${likedSongs.length} songs!`, "success");
}

function setupFilters() {
  document.getElementById("title-filter").addEventListener("input", (e) => {
    currentFilters.title = e.target.value.toLowerCase();
    applyFilters();
  });

  document.getElementById("artist-filter").addEventListener("input", (e) => {
    currentFilters.artist = e.target.value.toLowerCase();
    applyFilters();
  });

  document.getElementById("clear-filters-btn").addEventListener("click", () => {
    clearAllFilters();
  });

  document
    .getElementById("mobile-title-filter")
    .addEventListener("input", (e) => {
      currentFilters.title = e.target.value.toLowerCase();
      syncFilterValues();
      applyFilters();
    });

  document
    .getElementById("mobile-artist-filter")
    .addEventListener("input", (e) => {
      currentFilters.artist = e.target.value.toLowerCase();
      syncFilterValues();
      applyFilters();
    });

  const mobileClearFilters = document.getElementById(
    "mobile-clear-filters-btn"
  );
  if (mobileClearFilters) {
    mobileClearFilters.addEventListener("click", () => {
      clearAllFilters();
    });
  }

  const selectAllDesktop = document.getElementById("select-all-btn-desktop");
  if (selectAllDesktop) {
    selectAllDesktop.addEventListener("click", selectAllSongs);
  }

  const clearSelectionDesktop = document.getElementById(
    "clear-selection-btn-desktop"
  );
  if (clearSelectionDesktop) {
    clearSelectionDesktop.addEventListener("click", clearSelection);
  }

  const selectAllMobile = document.getElementById("select-all-btn-mobile");
  if (selectAllMobile) {
    selectAllMobile.addEventListener("click", selectAllSongs);
  }

  const clearSelectionMobile = document.getElementById(
    "clear-selection-btn-mobile"
  );
  if (clearSelectionMobile) {
    clearSelectionMobile.addEventListener("click", clearSelection);
  }
}

function toggleMobileFilters() {
  const dropdown = document.getElementById("mobile-filters");
  dropdown.classList.toggle("open");
}

function syncFilterValues() {
  const titleFilter = document.getElementById("title-filter");
  if (titleFilter) titleFilter.value = currentFilters.title;

  const artistFilter = document.getElementById("artist-filter");
  if (artistFilter) artistFilter.value = currentFilters.artist;

  const mobileTitleFilter = document.getElementById("mobile-title-filter");
  if (mobileTitleFilter) mobileTitleFilter.value = currentFilters.title;

  const mobileArtistFilter = document.getElementById("mobile-artist-filter");
  if (mobileArtistFilter) mobileArtistFilter.value = currentFilters.artist;
}

function clearAllFilters() {
  currentFilters = { title: "", artist: "" };
  syncFilterValues();
  applyFilters();
}

function applyFilters() {
  filteredSongs = likedSongs.filter((item, index) => {
    const track = item.track;
    if (!track) return false;

    const titleMatch =
      !currentFilters.title ||
      track.name.toLowerCase().includes(currentFilters.title);

    const artistMatch =
      !currentFilters.artist ||
      track.artists.some((artist) =>
        artist.name.toLowerCase().includes(currentFilters.artist)
      );

    return titleMatch && artistMatch;
  });

  displayFilteredSongs();
  document.getElementById("songs-counter").textContent = filteredSongs.length;
}

async function loadPlaylists() {
  const response = await fetch("/api/playlists");
  if (!response.ok) {
    throw new Error("Failed to load playlists");
  }
  playlists = await response.json();
  displayPlaylists();
}

function displayLikedSongs() {
  applyFilters();
}

function displayFilteredSongs() {
  const songsContainer = document.getElementById("songs-list");

  if (filteredSongs.length === 0) {
    songsContainer.innerHTML =
      '<div class="loading">No songs match your filters.</div>';
    return;
  }

  songsContainer.innerHTML = filteredSongs
    .map((item, filteredIndex) => {
      const track = item.track;
      const coverUrl =
        track.album.images[2]?.url || track.album.images[0]?.url || "";

      const originalIndex = likedSongs.indexOf(item);
      const isSelected = selectedSongs.has(originalIndex);

      const isCurrentlyPlaying =
        currentTrackUri && currentTrackUri === track.uri;

      return `
                <div class="song-item ${
                  isSelected ? "selected" : ""
                }" onclick="toggleSongSelection(${originalIndex})">
                    <div class="song-checkbox">
                      <input type="checkbox" ${
                        isSelected ? "checked" : ""
                      } onchange="toggleSongSelection(${originalIndex})" onclick="event.stopPropagation()">
                    </div>
                    <div class="song-cover-container" style="position: relative;">
                                                  <img src="${coverUrl}" alt="Album cover" class="song-cover ${
        isCurrentlyPlaying ? "playing" : ""
      }" 
                       onclick="event.stopPropagation(); playTrack('${
                         track.uri
                       }')"
                       onerror="this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIHZpZXdCb3g9IjAgMCA1MCA1MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjUwIiBoZWlnaHQ9IjUwIiBmaWxsPSIjNDA0MDQwIi8+Cjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBkb21pbmFudC1iYXNlbGluZT0ibWlkZGxlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSIjYjNiM2IzIiBmb250LXNpemU9IjEycHgiPjwvdGV4dD4KPC9zdmc+'">
                      <div class="play-overlay">
                        <i class="play-icon ${
                          isCurrentlyPlaying && isPlaying
                            ? "icon-pause"
                            : "icon-play"
                        }"></i>
                      </div>
                    </div>
                    <div class="song-info">
                        <div class="song-title">${track.name}</div>
                        <div class="song-artist">${track.artists
                          .map((a) => a.name)
                          .join(", ")}</div>
                    </div>
                </div>
            `;
    })
    .join("");

  updateSelectionUI();
}

function displayPlaylists() {
  const playlistsContainer = document.getElementById("playlists-list");

  if (playlists.length === 0) {
    playlistsContainer.innerHTML =
      '<div class="loading">No playlists found.</div>';
    return;
  }

  const sortedPlaylists = [...playlists].sort((a, b) => {
    return (b.tracks?.total || 0) - (a.tracks?.total || 0);
  });

  playlistsContainer.innerHTML = sortedPlaylists
    .map((playlist, sortedIndex) => {
      const coverUrl = playlist.images[0]?.url || "";
      return `
              <div class="playlist-item" data-playlist-id="${
                playlist.id
              }" onclick="selectPlaylistById('${playlist.id}')">
                  <img src="${coverUrl}" alt="Playlist cover" class="playlist-cover"
                       onerror="this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiBmaWxsPSIjNDA0MDQwIi8+Cjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBkb21pbmFudC1iYXNlbGluZT0ibWlkZGxlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSIjYjNiM2IzIiBmb250LXNpemU9IjEwcHgiPvCfO68rPC90ZXh0Pgo8L3N2Zz4='">
                  <div class="playlist-info">
                      <div class="playlist-name">${playlist.name}</div>
                      <div class="playlist-tracks">${
                        playlist.tracks?.total || 0
                      } tracks</div>
                  </div>
              </div>
          `;
    })
    .join("");
}

function toggleSongSelection(index) {
  if (selectedSongs.has(index)) {
    selectedSongs.delete(index);
  } else {
    selectedSongs.add(index);
  }
  displayFilteredSongs();
  updateActionButtons();
}

function selectAllSongs() {
  selectedSongs.clear();
  filteredSongs.forEach((item) => {
    const originalIndex = likedSongs.indexOf(item);
    selectedSongs.add(originalIndex);
  });
  displayFilteredSongs();
  updateActionButtons();
}

function clearSelection() {
  selectedSongs.clear();
  displayFilteredSongs();
  updateActionButtons();
}

function updateSelectionUI() {
  const selectionCount = document.getElementById("selection-count");
  const count = selectedSongs.size;
  selectionCount.textContent = `${count} selected`;
}

window.addEventListener("beforeunload", () => {
  if (player) {
    player.disconnect();
  }
});

async function playTrack(trackUri) {
  if (!player || !deviceId) {
    showStatus("Player not ready. Please wait or refresh the page.", "error");
    return;
  }

  if (currentTrackUri === trackUri) {
    await togglePlayback();
    return;
  }

  try {
    if (isPlaying) {
      await player.pause();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const response = await fetch(
      `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`,
      {
        method: "PUT",
        body: JSON.stringify({ uris: [trackUri] }),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (response.ok) {
      currentTrackUri = trackUri;
      updatePlayingIcons();
    } else if (response.status === 403) {
      showStatus("Spotify Premium required to play music", "error");
    } else if (response.status === 404) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const retryResponse = await fetch(
        `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`,
        {
          method: "PUT",
          body: JSON.stringify({ uris: [trackUri] }),
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      if (retryResponse.ok) {
        currentTrackUri = trackUri;
        updatePlayingIcons();
      } else {
        showStatus("Error playing track", "error");
      }
    } else {
      showStatus("Error playing track", "error");
    }
  } catch (error) {
    showStatus("Error playing track", "error");
  }
}

async function togglePlayback() {
  if (!player) {
    showStatus("Player not ready", "error");
    return;
  }

  try {
    await player.togglePlay();
  } catch (error) {
    showStatus("Error controlling playback", "error");
  }
}

async function nextTrack() {
  if (!player) {
    showStatus("Player not ready", "error");
    return;
  }

  try {
    await player.nextTrack();
  } catch (error) {
    showStatus("Error skipping track", "error");
  }
}

async function previousTrack() {
  if (!player) {
    showStatus("Player not ready", "error");
    return;
  }

  try {
    await player.previousTrack();
  } catch (error) {
    showStatus("Error going to previous track", "error");
  }
}

async function setVolume(volume) {
  if (!player) {
    return;
  }

  try {
    await player.setVolume(volume / 600);
  } catch (error) {}
}

function updateSongPlayingState() {
  updatePlayingIcons();
}

function updatePlayingIcons() {
  document.querySelectorAll(".song-cover").forEach((img) => {
    const playOverlay = img.parentElement.querySelector(".play-icon");
    const trackUri = img.getAttribute("onclick").match(/'([^']+)'/)[1];

    if (currentTrackUri === trackUri) {
      img.classList.add("playing");
      if (playOverlay) {
        playOverlay.className = isPlaying
          ? "play-icon icon-pause"
          : "play-icon icon-play";
      }
    } else {
      img.classList.remove("playing");
      if (playOverlay) {
        playOverlay.className = "play-icon icon-play";
      }
    }
  });
}

function selectPlaylistById(playlistId) {
  document
    .querySelectorAll(".playlist-item")
    .forEach((item) => item.classList.remove("active"));

  document
    .querySelector(`[data-playlist-id="${playlistId}"]`)
    .classList.add("active");

  selectedPlaylist = playlists.find((p) => p.id === playlistId);
  updateActionButtons();
}

function updateActionButtons() {
  const addBtn = document.getElementById("add-to-playlist-btn");
  const removeBtn = document.getElementById("remove-from-liked-btn");

  const hasSelection = selectedSongs.size > 0;
  addBtn.disabled = !(hasSelection && selectedPlaylist);
  removeBtn.disabled = !hasSelection;

  const count = selectedSongs.size;
  if (count > 1) {
    addBtn.textContent = `Add ${count} to Playlist`;
    removeBtn.textContent = `Remove ${count} from Liked`;
  } else {
    addBtn.textContent = "Add to Playlist";
    removeBtn.textContent = "Remove from Liked";
  }
}

async function addToPlaylist() {
  if (selectedSongs.size === 0 || !selectedPlaylist) return;

  try {
    const trackUris = Array.from(selectedSongs).map(
      (index) => likedSongs[index].track.uri
    );

    const response = await fetch("/api/add-to-playlist", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        playlistId: selectedPlaylist.id,
        trackUris: trackUris,
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to add to playlist");
    }

    const result = await response.json();
    const count = result.addedCount || selectedSongs.size;

    showStatus(
      `Added ${count} song${count > 1 ? "s" : ""} to "${
        selectedPlaylist.name
      }"`,
      "success"
    );
  } catch (error) {
    showStatus("Error adding songs to playlist", "error");
  }
}

async function removeFromLiked() {
  if (selectedSongs.size === 0) return;

  try {
    const trackIds = Array.from(selectedSongs).map(
      (index) => likedSongs[index].track.id
    );

    const response = await fetch("/api/remove-from-liked", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        trackIds: trackIds,
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to remove from liked songs");
    }

    const selectedIndices = Array.from(selectedSongs).sort((a, b) => b - a);
    selectedIndices.forEach((index) => {
      likedSongs.splice(index, 1);
    });

    selectedSongs.clear();
    displayLikedSongs();
    updateActionButtons();

    const result = await response.json();
    const count = result.removedCount || trackIds.length;
    showStatus(
      `Removed ${count} song${count > 1 ? "s" : ""} from liked songs`,
      "success"
    );
  } catch (error) {
    showStatus("Error removing songs from liked songs", "error");
  }
}

function showStatus(message, type) {
  const statusEl = document.getElementById("status-message");
  statusEl.textContent = message;
  statusEl.className = `status-message status-${type}`;
  statusEl.style.display = "block";

  setTimeout(() => {
    statusEl.style.display = "none";
  }, 3000);
}

document
  .getElementById("add-to-playlist-btn")
  .addEventListener("click", addToPlaylist);
document
  .getElementById("remove-from-liked-btn")
  .addEventListener("click", removeFromLiked);

init();
