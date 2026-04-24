// ── State ──
let likedSongs = [];
let playlists = [];
let currentIndex = 0;
let selectedPlaylists = new Set();
let history = [];
let player = null;
let deviceId = null;
let accessToken = null;
let isPlaying = false;
let seekInterval = null;
let isBusy = false;
let totalSongsAtStart = 0;

// Groups: [{ name: string, playlistIds: string[] }]
let groups = [];
// Flat ordered list of playlist IDs for shortcut mapping
let orderedPlaylistIds = [];

const GROUPS_STORAGE_KEY = "spotify-sorter-groups";

// ── Init ──

async function init() {
  try {
    await loadToken();
    await loadUserData();
    await Promise.all([loadPlaylists(), loadLikedSongs()]);
    totalSongsAtStart = likedSongs.length;

    if (likedSongs.length === 0) {
      document.getElementById("loading-screen").style.display = "none";
      document.getElementById("empty-screen").style.display = "flex";
      return;
    }

    await initPlayer();
    document.getElementById("loading-screen").style.display = "none";
    document.getElementById("triage-view").style.display = "flex";
    showCurrentSong();
    setupKeyboardShortcuts();
    setupVolumeControl();
    setupSeekBar();
  } catch (err) {
    console.error("Init error:", err);
    if (err && err.authFailed) {
      showToast("Session expired. Redirecting to login…", "error");
      setTimeout(() => (window.location.href = "/"), 1500);
      return;
    }
    const msg = err && err.message ? err.message : "Error loading data. Please refresh.";
    showToast(msg, "error");
  }
}

window.onSpotifyWebPlaybackSDKReady = () => {};

// ── Data loading ──

async function refreshAccessToken() {
  const res = await fetch("/api/refresh", { method: "POST" });
  if (!res.ok) {
    const err = new Error("Session expired");
    err.authFailed = true;
    throw err;
  }
  const data = await res.json();
  accessToken = data.access_token;
  return accessToken;
}

async function apiFetch(url, options = {}) {
  let res = await fetch(url, options);
  if (res.status === 401) {
    try {
      await refreshAccessToken();
    } catch (e) {
      throw e;
    }
    res = await fetch(url, options);
    if (res.status === 401) {
      const err = new Error("Session expired");
      err.authFailed = true;
      throw err;
    }
  }
  return res;
}

async function loadToken() {
  let token = getCookie("access_token");
  if (!token) {
    const res = await fetch("/api/token");
    if (res.ok) {
      const data = await res.json();
      token = data.access_token;
    } else if (res.status === 401) {
      try {
        token = await refreshAccessToken();
      } catch (e) {
        throw e;
      }
    }
  }
  if (!token) {
    const err = new Error("No token");
    err.authFailed = true;
    throw err;
  }
  accessToken = token;
}

async function loadUserData() {
  const res = await apiFetch("/api/user");
  if (!res.ok) throw new Error(`Failed to load user (${res.status})`);
  const data = await res.json();
  document.getElementById("username").textContent = data.display_name || "User";
}

async function loadLikedSongs() {
  const res = await apiFetch("/api/liked-songs");
  if (!res.ok) throw new Error(`Failed to load liked songs (${res.status})`);
  likedSongs = await res.json();
  likedSongs.reverse(); // Oldest first
}

async function loadPlaylists() {
  const res = await apiFetch("/api/playlists");
  if (!res.ok) throw new Error(`Failed to load playlists (${res.status})`);
  playlists = await res.json();
  playlists.sort((a, b) => a.name.localeCompare(b.name, "fr"));
  loadGroups();
  renderPlaylistGroups();
}

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(";").shift();
}

// ── Groups management ──

function loadGroups() {
  try {
    const saved = localStorage.getItem(GROUPS_STORAGE_KEY);
    if (saved) {
      groups = JSON.parse(saved);
      // Clean up: remove playlist IDs that no longer exist
      const validIds = new Set(playlists.map((p) => p.id));
      groups.forEach((g) => {
        g.playlistIds = g.playlistIds.filter((id) => validIds.has(id));
      });
    }
  } catch {
    groups = [];
  }
}

function saveGroups() {
  localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(groups));
}

function getGroupedPlaylistIds() {
  const ids = new Set();
  groups.forEach((g) => g.playlistIds.forEach((id) => ids.add(id)));
  return ids;
}

function getUngroupedPlaylists() {
  const grouped = getGroupedPlaylistIds();
  return playlists.filter((p) => !grouped.has(p.id));
}

// ── Shortcut keys ──

function getShortcutKey(index) {
  if (index < 9) return String(index + 1);
  if (index === 9) return "0";
  const letter = index - 10;
  if (letter < 26) return String.fromCharCode(97 + letter);
  return null;
}

function buildOrderedPlaylistIds() {
  orderedPlaylistIds = [];
  // Groups first, in order
  groups.forEach((g) => {
    g.playlistIds.forEach((id) => orderedPlaylistIds.push(id));
  });
  // Then ungrouped
  getUngroupedPlaylists().forEach((p) => orderedPlaylistIds.push(p.id));
}

function getPlaylistShortcut(playlistId) {
  const idx = orderedPlaylistIds.indexOf(playlistId);
  if (idx === -1) return null;
  return getShortcutKey(idx);
}

// ── Render playlists with groups ──

function renderPlaylistGroups() {
  buildOrderedPlaylistIds();
  const container = document.getElementById("playlist-groups");
  let html = "";

  // Render each group
  groups.forEach((group) => {
    if (group.playlistIds.length === 0) return;
    html += `<div class="playlist-group">
      <div class="group-header">${escapeHtml(group.name)}</div>
      <div class="group-chips">
        ${group.playlistIds.map((id) => renderChip(id)).join("")}
      </div>
    </div>`;
  });

  // Ungrouped
  const ungrouped = getUngroupedPlaylists();
  if (ungrouped.length > 0) {
    const label = groups.length > 0 ? "Other" : "";
    html += `<div class="playlist-group">
      ${label ? `<div class="group-header">${label}</div>` : ""}
      <div class="group-chips">
        ${ungrouped.map((p) => renderChip(p.id)).join("")}
      </div>
    </div>`;
  }

  container.innerHTML = html;
  updatePlaylistChips();
}

function renderChip(playlistId) {
  const pl = playlists.find((p) => p.id === playlistId);
  if (!pl) return "";
  const key = getPlaylistShortcut(playlistId);
  const shortcut = key ? `<span class="shortcut">${key}</span>` : "";
  const cover = pl.images?.[0]?.url
    ? `<img src="${pl.images[0].url}" class="chip-cover" alt="">`
    : "";
  return `<button class="playlist-chip" data-id="${pl.id}" onclick="togglePlaylist('${pl.id}')">
    ${shortcut}${cover}<span>${escapeHtml(pl.name)}</span>
  </button>`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ── Player init ──

function initPlayer() {
  return new Promise((resolve) => {
    function create() {
      player = new Spotify.Player({
        name: "Spotify Sorter",
        getOAuthToken: (cb) => cb(accessToken),
        volume: 0.05,
      });

      player.addListener("ready", ({ device_id }) => {
        deviceId = device_id;
        resolve();
      });

      player.addListener("not_ready", () => {});
      player.addListener("initialization_error", ({ message }) => {
        showToast("Player init error: " + message, "error");
        resolve();
      });
      player.addListener("authentication_error", () => {
        showToast("Auth error — Spotify Premium required", "error");
        resolve();
      });
      player.addListener("account_error", () => {
        showToast("Spotify Premium required", "error");
        resolve();
      });
      player.addListener("playback_error", () => {
        showToast("Playback error", "error");
      });

      player.addListener("player_state_changed", (state) => {
        if (!state) return;
        isPlaying = !state.paused;
        const icon = document.getElementById("play-icon");
        icon.className = isPlaying ? "icon-pause" : "icon-play";
      });

      player.connect();
    }

    if (window.Spotify) {
      create();
    } else {
      window.onSpotifyWebPlaybackSDKReady = create;
    }

    setTimeout(() => resolve(), 10000);
  });
}

// ── Show current song ──

function showCurrentSong() {
  if (currentIndex >= likedSongs.length) {
    document.getElementById("triage-view").style.display = "none";
    document.getElementById("empty-screen").style.display = "flex";
    if (player) player.pause();
    return;
  }

  const song = likedSongs[currentIndex];
  const track = song.track;
  if (!track) {
    likedSongs.splice(currentIndex, 1);
    showCurrentSong();
    return;
  }

  const art = track.album?.images?.[0]?.url || track.album?.images?.[1]?.url || "";
  document.getElementById("album-art").src = art;
  document.getElementById("track-name").textContent = track.name;
  document.getElementById("track-artist").textContent = track.artists
    .map((a) => a.name)
    .join(", ");

  document.getElementById("seek-bar").value = 0;
  document.getElementById("time-current").textContent = "0:00";
  document.getElementById("time-total").textContent = formatTime(track.duration_ms);

  selectedPlaylists.clear();
  updatePlaylistChips();
  updateProgress();
  document.getElementById("btn-undo").disabled = history.length === 0;

  autoPlayAtDrop(track);
}

async function autoPlayAtDrop(track) {
  if (!player || !deviceId) return;

  let startMs = null;
  try {
    const res = await fetch(`/api/audio-analysis/${track.id}`);
    if (res.ok) {
      const data = await res.json();
      startMs = data.startMs;
    }
  } catch {}

  if (startMs === null) {
    startMs = Math.floor(track.duration_ms * 0.35);
  }

  try {
    await fetch(
      `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`,
      {
        method: "PUT",
        body: JSON.stringify({ uris: [track.uri], position_ms: startMs }),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
  } catch {}
}

// ── Transition ──

function transitionTo(callback) {
  const card = document.getElementById("track-card");
  card.classList.add("fade-out");
  setTimeout(() => {
    callback();
    card.classList.remove("fade-out");
    card.classList.add("fade-in");
    requestAnimationFrame(() => {
      card.classList.remove("fade-in");
    });
  }, 250);
}

// ── Actions ──

async function next() {
  if (isBusy || currentIndex >= likedSongs.length) return;
  isBusy = true;
  setBusy(true);

  const song = likedSongs[currentIndex];
  const track = song.track;
  const playlistIds = Array.from(selectedPlaylists);

  try {
    const addPromises = playlistIds.map((pid) =>
      fetch("/api/add-to-playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlistId: pid, trackUris: [track.uri] }),
      })
    );

    const removePromise = fetch("/api/remove-from-liked", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackIds: [track.id] }),
    });

    await Promise.all([...addPromises, removePromise]);

    history.push({ song, index: currentIndex, addedToPlaylists: playlistIds });
    likedSongs.splice(currentIndex, 1);

    if (playlistIds.length > 0) {
      const names = playlistIds.map(
        (id) => playlists.find((p) => p.id === id)?.name || "?"
      );
      showToast("Added to " + names.join(", "));
    } else {
      showToast("Removed from liked");
    }

    transitionTo(() => showCurrentSong());
  } catch {
    showToast("Error — please try again", "error");
  }

  isBusy = false;
  setBusy(false);
}

function skip() {
  if (isBusy || currentIndex >= likedSongs.length) return;
  const song = likedSongs.splice(currentIndex, 1)[0];
  likedSongs.push(song);
  selectedPlaylists.clear();
  showToast("Skipped — will come back later");
  transitionTo(() => showCurrentSong());
}

async function undo() {
  if (isBusy || history.length === 0) return;
  isBusy = true;
  setBusy(true);

  const last = history.pop();

  try {
    await fetch("/api/add-to-liked", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackIds: [last.song.track.id] }),
    });

    const removePromises = last.addedToPlaylists.map((pid) =>
      fetch("/api/remove-from-playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playlistId: pid,
          trackUris: [last.song.track.uri],
        }),
      })
    );
    await Promise.all(removePromises);

    likedSongs.splice(last.index, 0, last.song);
    currentIndex = last.index;

    showToast("Undone!");
    transitionTo(() => showCurrentSong());
  } catch {
    showToast("Undo failed", "error");
  }

  isBusy = false;
  setBusy(false);
}

function setBusy(busy) {
  document.getElementById("btn-next").disabled = busy;
  document.getElementById("btn-skip").disabled = busy;
}

// ── Playlist toggle ──

function togglePlaylist(playlistId) {
  if (selectedPlaylists.has(playlistId)) {
    selectedPlaylists.delete(playlistId);
  } else {
    selectedPlaylists.add(playlistId);
  }
  updatePlaylistChips();
}

function updatePlaylistChips() {
  document.querySelectorAll(".playlist-chip").forEach((chip) => {
    chip.classList.toggle("selected", selectedPlaylists.has(chip.dataset.id));
  });
}

// ── Organize modal ──

let draggedPlaylistId = null;

function openOrganize() {
  document.getElementById("organize-modal").style.display = "flex";
  renderOrganizeModal();
}

function closeOrganize() {
  document.getElementById("organize-modal").style.display = "none";
  saveGroups();
  renderPlaylistGroups();
}

function addGroup() {
  const input = document.getElementById("new-group-name");
  const name = input.value.trim();
  if (!name) return;
  groups.push({ name, playlistIds: [] });
  input.value = "";
  saveGroups();
  renderOrganizeModal();
}

function deleteGroup(index) {
  groups.splice(index, 1);
  saveGroups();
  renderOrganizeModal();
}

function removeFromGroup(groupIndex, playlistId) {
  const g = groups[groupIndex];
  g.playlistIds = g.playlistIds.filter((id) => id !== playlistId);
  saveGroups();
  renderOrganizeModal();
}

function addToGroup(groupIndex, playlistId) {
  // Remove from any other group first
  groups.forEach((g) => {
    g.playlistIds = g.playlistIds.filter((id) => id !== playlistId);
  });
  groups[groupIndex].playlistIds.push(playlistId);
  saveGroups();
  renderOrganizeModal();
}

function renderOrganizeModal() {
  const groupsContainer = document.getElementById("modal-groups");
  const ungroupedContainer = document.getElementById("modal-ungrouped-list");

  // Groups
  groupsContainer.innerHTML = groups
    .map((g, gi) => {
      const playlistItems = g.playlistIds
        .map((id) => {
          const pl = playlists.find((p) => p.id === id);
          if (!pl) return "";
          return `<span class="modal-playlist-item" onclick="removeFromGroup(${gi}, '${id}')">
            ${escapeHtml(pl.name)} <span class="remove-x">&times;</span>
          </span>`;
        })
        .join("");

      return `<div class="modal-group" data-group-index="${gi}"
                   ondragover="event.preventDefault(); this.classList.add('drag-over')"
                   ondragleave="this.classList.remove('drag-over')"
                   ondrop="handleDrop(event, ${gi})">
        <div class="modal-group-header">
          <span class="modal-group-name">${escapeHtml(g.name)}</span>
          <button class="btn-delete-group" onclick="deleteGroup(${gi})">Delete</button>
        </div>
        <div class="modal-group-playlists">
          ${playlistItems || '<span style="color:#555;font-size:0.8rem;">Drag playlists here</span>'}
        </div>
      </div>`;
    })
    .join("");

  // Ungrouped
  const ungrouped = getUngroupedPlaylists();
  ungroupedContainer.innerHTML = ungrouped
    .map(
      (p) =>
        `<span class="modal-ungrouped-item" draggable="true"
              ondragstart="handleDragStart(event, '${p.id}')"
              ondragend="handleDragEnd(event)">
          ${escapeHtml(p.name)}
        </span>`
    )
    .join("");
}

function handleDragStart(event, playlistId) {
  draggedPlaylistId = playlistId;
  event.target.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
}

function handleDragEnd(event) {
  event.target.classList.remove("dragging");
  document.querySelectorAll(".modal-group").forEach((el) => {
    el.classList.remove("drag-over");
  });
}

function handleDrop(event, groupIndex) {
  event.preventDefault();
  event.currentTarget.classList.remove("drag-over");
  if (draggedPlaylistId) {
    addToGroup(groupIndex, draggedPlaylistId);
    draggedPlaylistId = null;
  }
}

// Also support click-to-add on mobile: clicking ungrouped item cycles through groups
// We'll add click support for ungrouped items when there are groups
document.addEventListener("click", (e) => {
  const item = e.target.closest(".modal-ungrouped-item");
  if (!item || groups.length === 0) return;

  const playlistId = item.getAttribute("ondragstart")?.match(/'([^']+)'/)?.[1];
  if (!playlistId) return;

  // If only one group, add directly; otherwise show a quick selection
  if (groups.length === 1) {
    addToGroup(0, playlistId);
  } else {
    // Create a small popup to pick group
    showGroupPicker(item, playlistId);
  }
});

function showGroupPicker(anchorEl, playlistId) {
  // Remove existing picker
  document.querySelectorAll(".group-picker").forEach((el) => el.remove());

  const picker = document.createElement("div");
  picker.className = "group-picker";
  picker.style.cssText = `
    position: absolute; background: #333; border-radius: 8px; padding: 0.4rem;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5); z-index: 2000; display: flex;
    flex-direction: column; gap: 0.2rem; min-width: 120px;
  `;

  groups.forEach((g, gi) => {
    const btn = document.createElement("button");
    btn.textContent = g.name;
    btn.style.cssText = `
      background: none; border: none; color: #b3b3b3; padding: 0.4rem 0.6rem;
      text-align: left; cursor: pointer; border-radius: 4px; font-size: 0.82rem;
    `;
    btn.onmouseenter = () => (btn.style.background = "#404040");
    btn.onmouseleave = () => (btn.style.background = "none");
    btn.onclick = (e) => {
      e.stopPropagation();
      addToGroup(gi, playlistId);
      picker.remove();
    };
    picker.appendChild(btn);
  });

  // Position near the anchor
  const rect = anchorEl.getBoundingClientRect();
  picker.style.position = "fixed";
  picker.style.left = rect.left + "px";
  picker.style.top = rect.bottom + 4 + "px";

  document.body.appendChild(picker);

  // Close on outside click
  setTimeout(() => {
    const close = (e) => {
      if (!picker.contains(e.target)) {
        picker.remove();
        document.removeEventListener("click", close);
      }
    };
    document.addEventListener("click", close);
  }, 0);
}

// Enter key in group name input
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("new-group-name")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addGroup();
    }
  });
});

// ── Player controls ──

function togglePlayback() {
  if (!player) return;
  player.togglePlay();
}

function setupVolumeControl() {
  document.getElementById("volume-slider").addEventListener("input", (e) => {
    if (player) player.setVolume(e.target.value / 600);
  });
}

function setupSeekBar() {
  const seekBar = document.getElementById("seek-bar");
  let isSeeking = false;

  seekBar.addEventListener("mousedown", () => (isSeeking = true));
  seekBar.addEventListener("touchstart", () => (isSeeking = true));
  seekBar.addEventListener("change", async () => {
    isSeeking = false;
    if (!player) return;
    const state = await player.getCurrentState();
    if (!state) return;
    player.seek((seekBar.value / 100) * state.duration);
  });
  seekBar.addEventListener("mouseup", () => (isSeeking = false));
  seekBar.addEventListener("touchend", () => (isSeeking = false));

  seekInterval = setInterval(async () => {
    if (!player || isSeeking) return;
    const state = await player.getCurrentState();
    if (!state) return;
    seekBar.value = (state.position / state.duration) * 100;
    document.getElementById("time-current").textContent = formatTime(state.position);
  }, 500);
}

// ── Progress ──

function updateProgress() {
  const sorted = totalSongsAtStart - likedSongs.length;
  const remaining = likedSongs.length;
  document.getElementById("progress-text").textContent = `${remaining} remaining`;
  const pct = totalSongsAtStart > 0 ? (sorted / totalSongsAtStart) * 100 : 0;
  document.getElementById("progress-fill").style.width = pct + "%";
}

// ── Keyboard shortcuts ──

function setupKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    // Don't capture shortcuts when modal is open
    if (document.getElementById("organize-modal").style.display !== "none") return;

    switch (e.key) {
      case " ":
        e.preventDefault();
        togglePlayback();
        break;
      case "Enter":
      case "ArrowRight":
        e.preventDefault();
        next();
        break;
      case "s":
      case "S":
        e.preventDefault();
        skip();
        break;
      case "z":
      case "Z":
        e.preventDefault();
        undo();
        break;
      default: {
        const idx = orderedPlaylistIds.findIndex(
          (_, i) => getShortcutKey(i) === e.key.toLowerCase()
        );
        if (idx !== -1) {
          e.preventDefault();
          togglePlaylist(orderedPlaylistIds[idx]);
        }
      }
    }
  });
}

// ── Utils ──

function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

function showToast(message, type = "success") {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = `toast visible toast-${type}`;
  setTimeout(() => toast.classList.remove("visible"), 2500);
}

window.addEventListener("beforeunload", () => {
  if (seekInterval) clearInterval(seekInterval);
  if (player) player.disconnect();
});

// ── Start ──

init();
