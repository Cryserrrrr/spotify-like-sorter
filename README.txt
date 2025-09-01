Spotify Playlist Organizer
==========================

Setup Instructions:
1. Create a Spotify app at https://developer.spotify.com/dashboard
2. Add redirect URI: https://127.0.0.1:3000/callback
3. Copy env.example to .env and fill in your Spotify credentials:
   - SPOTIFY_CLIENT_ID=your_client_id
   - SPOTIFY_CLIENT_SECRET=your_client_secret

4. Start the server: npm start
5. Visit: https://127.0.0.1:3000

Features:
- View all liked songs
- Browse playlists
- Add songs to playlists
- Remove songs from liked songs
- Secure HTTPS connection for Spotify API

Required Scopes:
- user-library-read
- playlist-read-private  
- playlist-modify-public
- playlist-modify-private
