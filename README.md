# Content Research Microservice

A lightweight microservice for deep research and data scraping of movies, series, music, and books with a primary focus on finding streaming and availability platforms.

## Features

- **4 Research Endpoints**: Movies, TV Series, Music, and Books
- **Streaming Focus**: Prioritizes finding where content can be streamed, purchased, or accessed
- **Multiple Data Sources**: Integrates with TMDB, OMDB, Spotify, Google Books, and web scraping
- **No Database Required**: Stateless service that returns comprehensive JSON responses
- **Minimal Input**: Only title + year required, other fields optional

## API Endpoints

### 🎬 Movie Research
\`\`\`
POST /api/research/movie
\`\`\`
**Required**: `title`, `year`  
**Optional**: `director`, `cast`, `genre`

### 📺 Series Research
\`\`\`
POST /api/research/series
\`\`\`
**Required**: `title`  
**Optional**: `year`, `creator`, `network`, `genre`

### 🎵 Music Research
\`\`\`
POST /api/research/music
\`\`\`
**Required**: `title`, `artist`  
**Optional**: `year`, `album`, `genre`

### 📚 Book Research
\`\`\`
POST /api/research/book
\`\`\`
**Required**: `title`  
**Optional**: `author`, `year`, `isbn`, `genre`

## Example Usage

\`\`\`bash
# Movie research
curl -X POST http://localhost:3000/api/research/movie \
  -H "Content-Type: application/json" \
  -d '{"title": "The Matrix", "year": 1999}'

# Music research
curl -X POST http://localhost:3000/api/research/music \
  -H "Content-Type: application/json" \
  -d '{"title": "Bohemian Rhapsody", "artist": "Queen"}'
\`\`\`

## Setup

1. Install dependencies:
\`\`\`bash
npm install
\`\`\`

2. Configure environment variables (optional but recommended):
\`\`\`bash
cp .env.example .env
# Add your API keys to .env
\`\`\`

3. Run the service:
\`\`\`bash
npm run dev
\`\`\`

## Environment Variables

All API keys are optional but enhance data quality:

- `TMDB_API_KEY` - The Movie Database API
- `OMDB_API_KEY` - Open Movie Database API  
- `SPOTIFY_CLIENT_ID` & `SPOTIFY_CLIENT_SECRET` - Spotify Web API
- `GOOGLE_BOOKS_API_KEY` - Google Books API

## Response Format

All endpoints return comprehensive JSON matching your provided model schemas, with special focus on:

- **Movies/Series**: `availableOn.streaming` and `availableOn.purchase` arrays
- **Music**: `availableOn` object with Spotify, Apple Music, YouTube, etc.
- **Books**: `availableOn` object with ebook, paperback, hardcover, audiobook platforms

## Health Check

\`\`\`
GET /api/health
\`\`\`

Returns service status and endpoint information.
