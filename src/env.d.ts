declare module 'cloudflare:test' {
  interface ProvidedEnv {
    DB: D1Database;
    YOUTUBE_API_KEY: string;
    YOUTUBE_UPLOADS_PLAYLIST_ID: string;
  }
}
