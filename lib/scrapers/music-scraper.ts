import axios from "axios"
import * as cheerio from "cheerio"
import type { MusicRequest, MusicResponse, StreamingPlatform } from "../types"

export class MusicScraper {
  private readonly SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID
  private readonly SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET

  async scrapeMusicData(request: MusicRequest): Promise<MusicResponse> {
    try {
      console.log(`[v0] Starting research for music: ${request.title} by ${request.artist}`)

      const [spotifyData, lyricsData, streamingData] = await Promise.allSettled([
        this.getSpotifyData(request.title, request.artist),
        this.getLyricsData(request.title, request.artist),
        this.getStreamingAvailability(request.title, request.artist),
      ])

      console.log(`[v0] Completed music data gathering for ${request.title}`)

      const musicData = this.combineMusicData(request, spotifyData, lyricsData, streamingData)
      return musicData
    } catch (error) {
      console.error("Error scraping music data:", error)
      throw new Error("Failed to scrape music data")
    }
  }

  private async getSpotifyData(title: string, artist: string) {
    if (!this.SPOTIFY_CLIENT_ID || !this.SPOTIFY_CLIENT_SECRET) {
      console.warn("Spotify credentials not provided")
      return null
    }

    try {
      console.log(`[v0] Fetching Spotify data for ${title} by ${artist}`)

      // Get Spotify access token
      const tokenResponse = await axios.post(
        "https://accounts.spotify.com/api/token",
        "grant_type=client_credentials",
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${Buffer.from(`${this.SPOTIFY_CLIENT_ID}:${this.SPOTIFY_CLIENT_SECRET}`).toString("base64")}`,
          },
        },
      )

      const accessToken = tokenResponse.data.access_token

      // Search for track
      const searchResponse = await axios.get(
        `https://api.spotify.com/v1/search?q=track:"${encodeURIComponent(title)}" artist:"${encodeURIComponent(artist)}"&type=track&limit=1`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      )

      if (searchResponse.data.tracks.items.length === 0) {
        return null
      }

      const track = searchResponse.data.tracks.items[0]

      const spotifyData = {
        track,
        audioFeatures: null,
        artist: null,
        album: null,
      }

      try {
        // Get audio features
        const audioFeaturesResponse = await axios.get(`https://api.spotify.com/v1/audio-features/${track.id}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        spotifyData.audioFeatures = audioFeaturesResponse.data
      } catch (error:any) {
        console.warn("Could not fetch audio features:", error.response?.status)
      }

      try {
        // Get artist details
        const artistResponse = await axios.get(`https://api.spotify.com/v1/artists/${track.artists[0].id}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        spotifyData.artist = artistResponse.data
      } catch (error:any) {
        console.warn("Could not fetch artist details:", error.response?.status)
      }

      try {
        // Get album details
        const albumResponse = await axios.get(`https://api.spotify.com/v1/albums/${track.album.id}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        spotifyData.album = albumResponse.data
      } catch (error:any) {
        console.warn("Could not fetch album details:", error.response?.status)
      }

      return spotifyData
    } catch (error:any) {
      console.error("Spotify API error:", error.response?.status, error.response?.data)
      return null
    }
  }

  private async getLyricsData(title: string, artist: string) {
    try {
      console.log(`[v0] Searching for lyrics: ${title} by ${artist}`)

      const geniusData = await this.scrapeGeniusLyricsContent(title, artist)
      if (geniusData) {
        return geniusData
      }

      // Fallback to AZLyrics
      const azLyricsData = await this.scrapeAZLyricsContent(title, artist)
      if (azLyricsData) {
        return azLyricsData
      }

      return {
        preview: `Lyrics not found for ${title} by ${artist}`,
        fullLyricsLink: `https://genius.com/search?q=${encodeURIComponent(artist + " " + title)}`,
      }
    } catch (error) {
      console.error("Lyrics scraping error:", error)
      return null
    }
  }

  private async scrapeGeniusLyricsContent(title: string, artist: string) {
    try {
      const searchUrl = `https://genius.com/search?q=${encodeURIComponent(artist + " " + title)}`

      const response = await axios.get(searchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        timeout: 10000,
      })

      const $ = cheerio.load(response.data)

      // Find the first song result
      const firstResult = $(".search_result").first()
      const songLink = firstResult.find("a").attr("href")

      if (songLink) {
        const fullLink = songLink.startsWith("http") ? songLink : `https://genius.com${songLink}`

        // Try to get actual lyrics from the song page
        try {
          const lyricsResponse = await axios.get(fullLink, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
            timeout: 8000,
          })

          const lyricsPage = cheerio.load(lyricsResponse.data)
          const lyricsContainer = lyricsPage('[data-lyrics-container="true"], .lyrics, .Lyrics__Container-sc-1ynbvzw-6')

          if (lyricsContainer.length > 0) {
            const lyricsText = lyricsContainer.text().trim()
            const preview = lyricsText.substring(0, 200) + (lyricsText.length > 200 ? "..." : "")

            return {
              preview: preview,
              fullLyricsLink: fullLink,
              fullLyrics: lyricsText,
            }
          }
        } catch (lyricsError) {
          console.error("Error fetching full lyrics:", lyricsError)
        }

        return {
          preview: `Lyrics available on Genius`,
          fullLyricsLink: fullLink,
        }
      }

      return null
    } catch (error) {
      console.error("Genius scraping error:", error)
      return null
    }
  }

  private async scrapeAZLyricsContent(title: string, artist: string) {
    try {
      // AZLyrics uses a specific URL format
      const cleanArtist = artist.toLowerCase().replace(/[^a-z0-9]/g, "")
      const cleanTitle = title.toLowerCase().replace(/[^a-z0-9]/g, "")
      const azUrl = `https://www.azlyrics.com/lyrics/${cleanArtist}/${cleanTitle}.html`

      const response = await axios.get(azUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        timeout: 8000,
      })

      const $ = cheerio.load(response.data)

      // AZLyrics stores lyrics in a div without class/id, usually after "Sorry about that" comment
      const lyricsDiv = $("div")
        .filter((i, el) => {
          const text = $(el).text().trim()
          return text.length > 100 && !$(el).attr("class") && !$(el).attr("id")
        })
        .first()

      if (lyricsDiv.length > 0) {
        const lyricsText = lyricsDiv.text().trim()
        const preview = lyricsText.substring(0, 200) + (lyricsText.length > 200 ? "..." : "")

        return {
          preview: preview,
          fullLyricsLink: azUrl,
          fullLyrics: lyricsText,
        }
      }

      return {
        preview: `Lyrics may be available on AZLyrics`,
        fullLyricsLink: azUrl,
      }
    } catch (error) {
      console.error("AZLyrics error:", error)
      return null
    }
  }

  private async getStreamingAvailability(title: string, artist: string) {
    console.log(`[v0] Researching streaming availability for ${title} by ${artist}`)

    const streaming: StreamingPlatform[] = []
    const purchase: StreamingPlatform[] = []

    try {
      const [spotifyLinks, appleMusicLinks, youtubeLinks, amazonMusicLinks, deezerLinks, tidalLinks] =
        await Promise.allSettled([
          this.getSpotifyStreamingLinks(title, artist),
          this.scrapeAppleMusicDirectly(title, artist),
          this.scrapeYouTubeDirectly(title, artist),
          this.scrapeAmazonMusicDirectly(title, artist),
          this.scrapeDeezerDirectly(title, artist),
          this.scrapeTidalDirectly(title, artist),
        ])

      // Add results from all platforms
      if (spotifyLinks.status === "fulfilled" && spotifyLinks.value) {
        streaming.push(spotifyLinks.value)
      }

      if (appleMusicLinks.status === "fulfilled" && appleMusicLinks.value) {
        streaming.push(appleMusicLinks.value.streaming)
        purchase.push(appleMusicLinks.value.purchase)
      }

      if (youtubeLinks.status === "fulfilled" && youtubeLinks.value) {
        streaming.push(youtubeLinks.value)
      }

      if (amazonMusicLinks.status === "fulfilled" && amazonMusicLinks.value) {
        streaming.push(amazonMusicLinks.value.streaming)
        purchase.push(amazonMusicLinks.value.purchase)
      }

      if (deezerLinks.status === "fulfilled" && deezerLinks.value) {
        streaming.push(deezerLinks.value)
      }

      if (tidalLinks.status === "fulfilled" && tidalLinks.value) {
        streaming.push(tidalLinks.value)
      }

      console.log(`[v0] Found ${streaming.length} streaming and ${purchase.length} purchase options`)
    } catch (error) {
      console.error("Error getting music streaming availability:", error)
    }

    return { streaming, purchase }
  }

  private async getSpotifyStreamingLinks(title: string, artist: string): Promise<StreamingPlatform | null> {
    if (!this.SPOTIFY_CLIENT_ID || !this.SPOTIFY_CLIENT_SECRET) {
      return {
        platform: "Spotify",
        link: `https://open.spotify.com/search/${encodeURIComponent(`${artist} ${title}`)}`,
        type: "subscription",
      }
    }

    try {
      // Get access token
      const tokenResponse = await axios.post(
        "https://accounts.spotify.com/api/token",
        "grant_type=client_credentials",
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${Buffer.from(`${this.SPOTIFY_CLIENT_ID}:${this.SPOTIFY_CLIENT_SECRET}`).toString("base64")}`,
          },
        },
      )

      const accessToken = tokenResponse.data.access_token

      // Search for the specific track
      const searchResponse = await axios.get(
        `https://api.spotify.com/v1/search?q=track:"${encodeURIComponent(title)}" artist:"${encodeURIComponent(artist)}"&type=track&limit=1`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      )

      if (searchResponse.data.tracks.items.length > 0) {
        const track = searchResponse.data.tracks.items[0]
        return {
          platform: "Spotify",
          link: track.external_urls.spotify,
          type: "subscription",
        }
      }

      return {
        platform: "Spotify",
        link: `https://open.spotify.com/search/${encodeURIComponent(`${artist} ${title}`)}`,
        type: "subscription",
      }
    } catch (error) {
      console.error("Spotify streaming link error:", error)
      return null
    }
  }

  private async scrapeAppleMusicDirectly(
    title: string,
    artist: string,
  ): Promise<{ streaming: StreamingPlatform; purchase: StreamingPlatform } | null> {
    try {
      console.log(`[v0] Scraping Apple Music for ${title} by ${artist}`)

      const searchQuery = encodeURIComponent(`${artist} ${title}`)
      const searchUrl = `https://music.apple.com/search?term=${searchQuery}`

      const response = await axios.get(searchUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        timeout: 15000,
      })

      const $ = cheerio.load(response.data)

      let trackUrl = null

      // Look for song results in Apple Music
      $('[data-testid="track-lockup"], .songs-list-row, .track-lockup').each((i, element) => {
        const songTitle = $(element).find(".songs-list-row__song-name, .track-lockup__title, h3").text().trim()
        const artistName = $(element).find(".songs-list-row__by-line, .track-lockup__subtitle, .by-line").text().trim()
        const link = $(element).find("a").attr("href") || $(element).attr("href")

        if (
          songTitle.toLowerCase().includes(title.toLowerCase()) &&
          artistName.toLowerCase().includes(artist.toLowerCase()) &&
          link
        ) {
          trackUrl = link.startsWith("http") ? link : `https://music.apple.com${link}`
          return false
        }
      })

      // If no direct match, try iTunes Search API as fallback
      if (!trackUrl) {
        try {
          const itunesResponse = await axios.get(
            `https://itunes.apple.com/search?term=${encodeURIComponent(`${artist} ${title}`)}&media=music&entity=song&limit=1`,
          )

          if (itunesResponse.data.results.length > 0) {
            const track = itunesResponse.data.results[0]
            trackUrl = track.trackViewUrl
          }
        } catch (itunesError) {
          console.error("iTunes API fallback error:", itunesError)
        }
      }

      if (trackUrl) {
        return {
          streaming: {
            platform: "Apple Music",
            link: trackUrl,
            type: "subscription",
          },
          purchase: {
            platform: "iTunes",
            link: trackUrl,
            type: "buy",
          },
        }
      }

      return null
    } catch (error) {
      console.error("Apple Music scraping error:", error)
      return null
    }
  }

  private async scrapeYouTubeDirectly(title: string, artist: string): Promise<StreamingPlatform | null> {
    try {
      console.log(`[v0] Scraping YouTube for ${title} by ${artist}`)

      const searchQuery = encodeURIComponent(`${artist} ${title} official`)
      const youtubeSearchUrl = `https://www.youtube.com/results?search_query=${searchQuery}`

      const response = await axios.get(youtubeSearchUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        timeout: 15000,
      })

      // Extract video ID from YouTube's response
      const videoIdRegex = /"videoId":"([a-zA-Z0-9_-]{11})"/g
      const titleRegex = /"title":{"runs":\[{"text":"([^"]+)"/g

      let match
      const videos: any[] = []

      // Extract all video IDs and titles
      while ((match = videoIdRegex.exec(response.data)) !== null) {
        const videoId = match[1]
        videos.push({ id: videoId })
      }

      let titleIndex = 0
      while ((match = titleRegex.exec(response.data)) !== null && titleIndex < videos.length) {
        videos[titleIndex].title = match[1]
        titleIndex++
      }

      // Find the best match
      for (const video of videos) {
        if (
          video.title &&
          video.title.toLowerCase().includes(title.toLowerCase()) &&
          video.title.toLowerCase().includes(artist.toLowerCase())
        ) {
          return {
            platform: "YouTube",
            link: `https://www.youtube.com/watch?v=${video.id}`,
            type: "free",
          }
        }
      }

      // If no perfect match, return the first video
      if (videos.length > 0 && videos[0].id) {
        return {
          platform: "YouTube",
          link: `https://www.youtube.com/watch?v=${videos[0].id}`,
          type: "free",
        }
      }

      return null
    } catch (error) {
      console.error("YouTube scraping error:", error)
      return null
    }
  }

  private async scrapeAmazonMusicDirectly(
    title: string,
    artist: string,
  ): Promise<{ streaming: StreamingPlatform; purchase: StreamingPlatform } | null> {
    try {
      console.log(`[v0] Scraping Amazon Music for ${title} by ${artist}`)

      const searchQuery = encodeURIComponent(`${artist} ${title}`)
      const searchUrl = `https://music.amazon.com/search/${searchQuery}`

      const response = await axios.get(searchUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        timeout: 15000,
      })

      const $ = cheerio.load(response.data)

      let trackUrl = null

      // Look for track results
      $('.music-item, .track-row, [data-testid="music-item"]').each((i, element) => {
        const songTitle = $(element).find(".music-item__primary-text, .track-title, h3").text().trim()
        const artistName = $(element).find(".music-item__secondary-text, .track-artist, .by-line").text().trim()
        const link = $(element).find("a").attr("href")

        if (
          songTitle.toLowerCase().includes(title.toLowerCase()) &&
          artistName.toLowerCase().includes(artist.toLowerCase()) &&
          link
        ) {
          trackUrl = link.startsWith("http") ? link : `https://music.amazon.com${link}`
          return false
        }
      })

      if (trackUrl) {
        return {
          streaming: {
            platform: "Amazon Music",
            link: trackUrl,
            type: "subscription",
          },
          purchase: {
            platform: "Amazon Music",
            link: trackUrl,
            type: "buy",
          },
        }
      }

      return null
    } catch (error) {
      console.error("Amazon Music scraping error:", error)
      return null
    }
  }

  private async scrapeDeezerDirectly(title: string, artist: string): Promise<StreamingPlatform | null> {
    try {
      console.log(`[v0] Scraping Deezer for ${title} by ${artist}`)

      const searchQuery = encodeURIComponent(`${artist} ${title}`)
      const searchUrl = `https://www.deezer.com/search/${searchQuery}`

      const response = await axios.get(searchUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        timeout: 15000,
      })

      const $ = cheerio.load(response.data)

      let trackUrl = null

      // Look for track results in Deezer
      $('[data-testid="track"], .track-item, .song-item').each((i, element) => {
        const songTitle = $(element).find(".track-title, .song-title, h3").text().trim()
        const artistName = $(element).find(".track-artist, .song-artist, .artist-name").text().trim()
        const link = $(element).find("a").attr("href")

        if (
          songTitle.toLowerCase().includes(title.toLowerCase()) &&
          artistName.toLowerCase().includes(artist.toLowerCase()) &&
          link
        ) {
          trackUrl = link.startsWith("http") ? link : `https://www.deezer.com${link}`
          return false
        }
      })

      if (trackUrl) {
        return {
          platform: "Deezer",
          link: trackUrl,
          type: "subscription",
        }
      }

      return null
    } catch (error) {
      console.error("Deezer scraping error:", error)
      return null
    }
  }

  private async scrapeTidalDirectly(title: string, artist: string): Promise<StreamingPlatform | null> {
    try {
      console.log(`[v0] Scraping Tidal for ${title} by ${artist}`)

      const searchQuery = encodeURIComponent(`${artist} ${title}`)
      const searchUrl = `https://tidal.com/search?q=${searchQuery}`

      const response = await axios.get(searchUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        timeout: 15000,
      })

      const $ = cheerio.load(response.data)

      let trackUrl = null

      // Look for track results in Tidal
      $('[data-test="track-item"], .track-item, .media-item').each((i, element) => {
        const songTitle = $(element).find('[data-test="track-title"], .track-title, h3').text().trim()
        const artistName = $(element).find('[data-test="track-artist"], .track-artist, .artist-name').text().trim()
        const link = $(element).find("a").attr("href")

        if (
          songTitle.toLowerCase().includes(title.toLowerCase()) &&
          artistName.toLowerCase().includes(artist.toLowerCase()) &&
          link
        ) {
          trackUrl = link.startsWith("http") ? link : `https://tidal.com${link}`
          return false
        }
      })

      if (trackUrl) {
        return {
          platform: "Tidal",
          link: trackUrl,
          type: "subscription",
        }
      }

      return null
    } catch (error) {
      console.error("Tidal scraping error:", error)
      return null
    }
  }

  private combineMusicData(
    request: MusicRequest,
    spotifyResult: PromiseSettledResult<any>,
    lyricsResult: PromiseSettledResult<any>,
    streamingResult: PromiseSettledResult<any>,
  ): MusicResponse {
    const spotifyData = spotifyResult.status === "fulfilled" ? spotifyResult.value : null
    const lyricsData = lyricsResult.status === "fulfilled" ? lyricsResult.value : null
    const streamingData =
      streamingResult.status === "fulfilled" ? streamingResult.value : { streaming: [], purchase: [] }

    const slug = `${request.title}-${request.artist}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")

    const musicResponse: MusicResponse = {
      title: request.title,
      slug,
      artist: {
        name: request.artist,
        spotifyId: spotifyData?.artist?.id,
        genres: spotifyData?.artist?.genres || [],
        popularity: spotifyData?.artist?.popularity,
        followers: spotifyData?.artist?.followers?.total,
        images: spotifyData?.artist?.images || [],
      },
      featuredArtists:
        spotifyData?.track?.artists?.slice(1).map((a: any) => ({
          name: a.name,
          spotifyId: a.id,
        })) || [],
      album: spotifyData?.track?.album
        ? {
            title: spotifyData.track.album.name,
            releaseYear: new Date(spotifyData.track.album.release_date).getFullYear(),
            coverImage: spotifyData.track.album.images?.[0]
              ? {
                  url: spotifyData.track.album.images[0].url,
                  publicId: spotifyData.track.album.id,
                }
              : undefined,
            spotifyId: spotifyData.track.album.id,
            recordLabel: spotifyData?.album?.label || spotifyData?.track?.album?.label,
            totalTracks: spotifyData?.album?.total_tracks || spotifyData?.track?.album?.total_tracks,
            albumType: spotifyData?.album?.album_type || spotifyData?.track?.album?.album_type,
          }
        : undefined,
      releaseYear:
        request.year ||
        (spotifyData?.track?.album?.release_date
          ? new Date(spotifyData.track.album.release_date).getFullYear()
          : new Date().getFullYear()),
      duration: spotifyData?.track?.duration_ms
        ? `${Math.floor(spotifyData.track.duration_ms / 60000)} min ${Math.floor((spotifyData.track.duration_ms % 60000) / 1000)} sec`
        : undefined,
      genres: spotifyData?.artist?.genres || (request.genre ? [request.genre] : []),
      mood: spotifyData?.audioFeatures?.valence > 0.5 ? ["Happy", "Upbeat"] : ["Mellow", "Calm"],
      language: "English", // Default, could be enhanced with language detection
      bpm: spotifyData?.audioFeatures?.tempo ? Math.round(spotifyData.audioFeatures.tempo) : undefined,
      key:
        spotifyData?.audioFeatures?.key !== undefined ? this.getMusicalKey(spotifyData.audioFeatures.key) : undefined,
      energy: spotifyData?.audioFeatures?.energy,
      danceability: spotifyData?.audioFeatures?.danceability,
      acousticness: spotifyData?.audioFeatures?.acousticness,
      instrumentalness: spotifyData?.audioFeatures?.instrumentalness,
      liveness: spotifyData?.audioFeatures?.liveness,
      speechiness: spotifyData?.audioFeatures?.speechiness,
      formats: ["Digital", "Streaming"],
      writers: spotifyData?.album?.copyrights?.filter((c: any) => c.type === "P").map((c: any) => c.text) || [],
      producers: [], // Spotify doesn't provide detailed producer info in basic API
      availableOn: streamingData,
      ratings: {
        spotify: spotifyData?.track?.popularity
          ? {
              score: spotifyData.track.popularity,
              votes: 100, // Spotify doesn't provide vote count
            }
          : undefined,
      },
      lyrics: lyricsData,
      references: {
        spotifyId: spotifyData?.track?.id,
        spotifyArtistId: spotifyData?.artist?.id,
        spotifyAlbumId: spotifyData?.track?.album?.id,
        isrc: spotifyData?.track?.external_ids?.isrc,
      },
    }

    return musicResponse
  }

  private getMusicalKey(keyNumber: number): string {
    const keys = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    return keys[keyNumber] || "Unknown"
  }
}
