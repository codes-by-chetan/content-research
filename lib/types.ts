// Content research request/response types
export interface MovieRequest {
  title: string
  year: number
  director?: string
  cast?: string[]
  genre?: string
}

export interface SeriesRequest {
  title: string
  year?: number
  creator?: string
  network?: string
  genre?: string
}

export interface MusicRequest {
  title: string
  artist: string
  year?: number
  album?: string
  genre?: string
}

export interface BookRequest {
  title: string
  author?: string
  year?: number
  isbn?: string
  genre?: string
}

export interface StreamingPlatform {
  platform: string
  link: string
  type?: "free" | "subscription" | "rent" | "buy"
  price?: string
}

export interface MovieResponse {
  title: string
  year: number
  slug: string
  poster?: {
    url: string
    publicId: string
  }
  rated?: string
  released?: string
  runtime?: number
  genres: string[]
  director: Array<{
    name: string
    tmdbId?: string
  }>
  writers: Array<{
    name: string
    tmdbId?: string
  }>
  cast: Array<{
    person: {
      name: string
      tmdbId?: string
    }
    character: string
  }>
  plot?: string
  language: string[]
  country: string[]
  ratings: {
    imdb?: { score: number; votes: number }
    rottenTomatoes?: { score: number }
    metacritic?: { score: number }
  }
  boxOffice?: {
    budget?: string
    grossUSA?: string
    grossWorldwide?: string
  }
  production: {
    companies: Array<{ name: string; tmdbId?: string }>
    studios: Array<{ name: string; tmdbId?: string }>
    distributors: Array<{ name: string; tmdbId?: string }>
  }
  trailer?: {
    url: string
    language: string
  }
  availableOn: {
    streaming: StreamingPlatform[]
    purchase: StreamingPlatform[]
  }
  references: {
    imdbId?: string
    tmdbId?: string
  }
}

export interface SeriesResponse {
  title: string
  year?: number
  slug: string
  rated?: string
  released?: string
  plot?: string
  runtime?: number[]
  seriesType?: string
  genres: string[]
  language: string[]
  country: string[]
  seasons?: number
  episodes?: number
  status?: string
  creators: Array<{
    name: string
    tmdbId?: string
  }>
  cast: Array<{
    person: {
      name: string
      tmdbId?: string
    }
    character: string
  }>
  production: {
    companies: Array<{ name: string; tmdbId?: string }>
    networks: Array<{
      name: string
      id?: number
      logo_path?: string
      origin_country?: string
    }>
    studios: Array<{ name: string; tmdbId?: string }>
    distributors: Array<{ name: string; tmdbId?: string }>
  }
  ratings: {
    imdb?: { score: number; votes: number }
    rottenTomatoes?: { score: number }
    metacritic?: { score: number }
    tmdb?: { score: number; votes: number }
  }
  poster?: {
    url: string
    publicId: string
  }
  availableOn: {
    streaming: StreamingPlatform[]
    purchase: StreamingPlatform[]
  }
  references: {
    tmdbId?: string
    imdbId?: string
  }
}

export interface MusicResponse {
  title: string
  slug: string
  artist: {
    name: string
    spotifyId?: string
    genres?: any
    popularity?: any
    followers?: any
    images?: any
  }
  featuredArtists: Array<{
    name: string
    tmdbId?: string
  }>
  album?: {
    title: string
    releaseYear: number
    coverImage?: {
      url: string
      publicId: string
    }
    spotifyId?: string
    recordLabel?:any
    albumType?:any
    totalTracks?: any
  }
  releaseYear: number
  duration?: string
  genres: string[]
  mood: string[]
  language?: string
  bpm?: number
  key?: string
  formats: string[]
  writers: Array<{
    name: string
    tmdbId?: string
  }>
  producers: Array<{
    name: string
    tmdbId?: string
  }>
  availableOn: {
    spotify?: {
      plays?: string
      link: string
    }
    appleMusic?: {
      plays?: string
      link: string
    }
    youtube?: {
      views?: string
      link: string
    }
    amazonMusic?: {
      link: string
    }
    deezer?: {
      link: string
    }
  }
  ratings: {
    metacritic?: { score: number; votes: number }
    pitchfork?: { score: number }
    spotify?: { score: any; votes: number}
  }
  lyrics?: {
    preview: string
    fullLyricsLink: string
  }
  references?:{
    spotifyId?: string
    isrc?: string
    appleMusicId?: string
    youtubeVideoId?: string
    deezerId?: string
    amazonMusicId?: string
    spotifyAlbumId?: string
    spotifyArtistId?: string
  }
  energy?:any
  danceability?:any
  acousticness?:any
  speechiness?:any
  liveness?:any
  instrumentalness?:any
  
}

export interface BookResponse {
  title: string
  slug: string
  author: Array<{
    name: string
    biography?: string
  }>
  isbn?: string
  publishedYear?: number
  publisher?: {
    name: string
    headquarters?: string
    website?: string
  }
  genres: string[]
  language: string
  pages?: number
  format: string[]
  description?: string
  series?: {
    name: string
    bookNumber: number
    totalBooks?: number
  }
  ratings: {
    goodreads?: { score: number; votes: number }
    amazon?: { score: number; votes: number }
    googleBooks?: { score: number; votes: number }
  }
  awards: Array<{
    name: string
    year: number
    category?: string
  }>
  availableOn: {
    ebook: StreamingPlatform[]
    paperback: StreamingPlatform[]
    hardcover: StreamingPlatform[]
    audiobook: StreamingPlatform[]
  }
  references: {
    isbn10?: string
    isbn13?: string
    goodreadsId?: string
    googleBooksId?: string
  }
}