# Spotify Like Sorter

A web application to organize your Spotify liked songs into playlists efficiently.

## Features

- View all your liked songs
- Browse existing playlists
- Add multiple songs to playlists with one click
- Remove songs from liked songs
- Filter songs by title and artist
- Built-in music player with Spotify Web Playback SDK
- Responsive design for mobile and desktop

## Setup

### Prerequisites

- Node.js installed
- Spotify Premium account (required for music playback)
- Spotify Developer account

### Installation

1. Clone or download this repository
2. Install dependencies:

   ```bash
   npm install
   ```

3. Install mkcert for SSL certificates:

   **Windows:**

   ```bash
   choco install mkcert
   ```

   **macOS:**

   ```bash
   brew install mkcert
   ```

   **Linux:**

   ```bash
   sudo apt install mkcert
   ```

4. Generate SSL certificates for localhost:

   ```bash
   mkcert -install
   mkcert 127.0.0.1
   ```

5. Create a Spotify app at [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)

6. Configure your app:

   - Add redirect URI: `https://127.0.0.1:3000/callback`
   - Note your Client ID and Client Secret

7. Create environment file:

   ```bash
   cp env.example .env
   ```

8. Fill in your Spotify credentials in `.env`:
   ```
   SPOTIFY_CLIENT_ID=your_client_id
   SPOTIFY_CLIENT_SECRET=your_client_secret
   REDIRECT_URI=https://127.0.0.1:3000/callback
   ```

### Running the Application

1. Start the server:

   ```bash
   npm start
   ```

2. Open your browser and visit: `https://127.0.0.1:3000`

3. Click "Connect with Spotify" and authorize the application

## Required Permissions

The application requests these Spotify scopes:

- `user-library-read` - Access to liked songs
- `user-library-modify` - Modify liked songs
- `playlist-read-private` - Read private playlists
- `playlist-modify-public` - Modify public playlists
- `playlist-modify-private` - Modify private playlists
- `streaming` - Music playback
- `user-read-email` - User profile information
- `user-read-private` - User profile information
- `user-read-playback-state` - Playback control
- `user-modify-playback-state` - Playback control

## Usage

1. **Login**: Connect your Spotify account
2. **Browse Songs**: View all your liked songs with filtering options
3. **Select Songs**: Choose songs individually or use bulk selection
4. **Choose Playlist**: Select a target playlist from your library
5. **Organize**: Add songs to playlists or remove from liked songs
6. **Play Music**: Use the built-in player to preview songs

## Technical Details

- **Backend**: Node.js with Express
- **Frontend**: Vanilla JavaScript with responsive CSS
- **Authentication**: Spotify OAuth 2.0
- **API**: Spotify Web API
- **Player**: Spotify Web Playback SDK
- **Security**: HTTPS with SSL certificates

## Troubleshooting

- **Player not working**: Ensure you have Spotify Premium
- **Authentication errors**: Clear cookies and re-login
- **Permission denied**: Re-authorize the application
- **SSL errors**:
  - Ensure mkcert is installed and certificates are generated
  - Run `mkcert -install` to install the root certificate
  - Verify `127.0.0.1.pem` and `127.0.0.1-key.pem` files exist

## License

This project is for personal use. Please respect Spotify's terms of service.
