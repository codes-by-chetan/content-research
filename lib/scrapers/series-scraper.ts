import axios from "axios"
import * as cheerio from "cheerio"
import type { SeriesRequest, SeriesResponse, StreamingPlatform } from "../types"

export class SeriesScraper {
  private readonly TMDB_API_KEY = process.env.TMDB_API_KEY

  async scrapeSeriesData(request: SeriesRequest): Promise<SeriesResponse> {
    try {
      const [tmdbData, streamingData] = await Promise.allSettled([
        this.getTMDBSeriesData(request.title, request.year),
        this.getStreamingAvailability(request.title),
      ])

      const seriesData = this.combineSeriesData(request, tmdbData, streamingData)
      return seriesData
    } catch (error) {
      console.error("Error scraping series data:", error)
      throw new Error("Failed to scrape series data")
    }
  }

  private async getTMDBSeriesData(title: string, year?: number) {
    if (!this.TMDB_API_KEY) {
      console.warn("TMDB API key not provided")
      return null
    }

    try {
      const searchQuery = year
        ? `https://api.themoviedb.org/3/search/tv?api_key=${this.TMDB_API_KEY}&query=${encodeURIComponent(title)}&first_air_date_year=${year}`
        : `https://api.themoviedb.org/3/search/tv?api_key=${this.TMDB_API_KEY}&query=${encodeURIComponent(title)}`

      const searchResponse = await axios.get(searchQuery)

      if (searchResponse.data.results.length === 0) {
        return null
      }

      const seriesId = searchResponse.data.results[0].id

      const [seriesDetails, credits] = await Promise.all([
        axios.get(`https://api.themoviedb.org/3/tv/${seriesId}?api_key=${this.TMDB_API_KEY}`),
        axios.get(`https://api.themoviedb.org/3/tv/${seriesId}/credits?api_key=${this.TMDB_API_KEY}`),
      ])

      return {
        details: seriesDetails.data,
        credits: credits.data,
      }
    } catch (error) {
      console.error("TMDB TV API error:", error)
      return null
    }
  }

  private async getStreamingAvailability(title: string): Promise<{
    streaming: StreamingPlatform[]
    purchase: StreamingPlatform[]
  }> {
    console.log(`[v0] Researching streaming availability for series: ${title}`)

    const streaming: StreamingPlatform[] = []
    const purchase: StreamingPlatform[] = []

    try {
      const [justWatchData, tmdbWatchData] = await Promise.allSettled([
        this.scrapeJustWatchSeries(title),
        this.getTMDBSeriesWatchProviders(title),
      ])

      // Combine results from all sources
      if (justWatchData.status === "fulfilled") {
        streaming.push(...justWatchData.value.streaming)
        purchase.push(...justWatchData.value.purchase)
      }

      if (tmdbWatchData.status === "fulfilled") {
        streaming.push(...tmdbWatchData.value.streaming)
        purchase.push(...tmdbWatchData.value.purchase)
      }

      // Remove duplicates
      const uniqueStreaming = this.removeDuplicatePlatforms(streaming)
      const uniquePurchase = this.removeDuplicatePlatforms(purchase)

      // Only add fallbacks if no real data found
      if (uniqueStreaming.length === 0) {
        console.log(`[v0] No streaming data found for ${title}, adding search fallbacks`)
        uniqueStreaming.push(...this.getFallbackStreamingPlatforms(title))
      }

      if (uniquePurchase.length === 0) {
        uniquePurchase.push(...this.getFallbackPurchasePlatforms(title))
      }

      console.log(
        `[v0] Found ${uniqueStreaming.length} streaming and ${uniquePurchase.length} purchase options for ${title}`,
      )

      return { streaming: uniqueStreaming, purchase: uniquePurchase }
    } catch (error) {
      console.error("Error getting streaming availability:", error)
      return { streaming: [], purchase: [] }
    }
  }

  private async getTMDBSeriesWatchProviders(title: string) {
    const streaming: StreamingPlatform[] = []
    const purchase: StreamingPlatform[] = []

    if (!this.TMDB_API_KEY) return { streaming, purchase }

    try {
      const searchResponse = await axios.get(
        `https://api.themoviedb.org/3/search/tv?api_key=${this.TMDB_API_KEY}&query=${encodeURIComponent(title)}`,
      )

      if (searchResponse.data.results.length === 0) {
        return { streaming, purchase }
      }

      const seriesId = searchResponse.data.results[0].id
      const watchResponse = await axios.get(
        `https://api.themoviedb.org/3/tv/${seriesId}/watch/providers?api_key=${this.TMDB_API_KEY}`,
      )

      const usProviders = watchResponse.data.results?.US
      if (!usProviders) return { streaming, purchase }

      const tmdbWatchUrl = `https://www.themoviedb.org/tv/${seriesId}/watch?locale=US`
      const actualLinks = await this.scrapeTMDBWatchPage(tmdbWatchUrl)

      // Add streaming providers with actual URLs
      if (usProviders.flatrate) {
        for (const provider of usProviders.flatrate) {
          const actualLink =
            actualLinks[provider.provider_name.toLowerCase()] ||
            (await this.findActualStreamingLink(provider.provider_name, title))

          streaming.push({
            platform: provider.provider_name,
            link: actualLink || tmdbWatchUrl,
            type: "subscription",
          })
        }
      }

      // Add purchase/rent providers with actual URLs
      if (usProviders.buy) {
        for (const provider of usProviders.buy) {
          const actualLink =
            actualLinks[provider.provider_name.toLowerCase()] ||
            (await this.findActualPurchaseLink(provider.provider_name, title))

          purchase.push({
            platform: provider.provider_name,
            link: actualLink || tmdbWatchUrl,
            type: "buy",
          })
        }
      }
    } catch (error) {
      console.error("TMDB series watch providers error:", error)
    }

    return { streaming, purchase }
  }

  private async scrapeTMDBWatchPage(tmdbUrl: string): Promise<Record<string, string>> {
    const links: Record<string, string> = {}

    try {
      console.log(`[v0] Scraping TMDB watch page: ${tmdbUrl}`)

      const response = await axios.get(tmdbUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        },
        timeout: 10000,
      })

      const $ = cheerio.load(response.data)

      // Look for streaming platform links
      $(".provider").each((i, element) => {
        const $element = $(element)
        const platformName = $element.find("img").attr("alt")?.toLowerCase()
        const link = $element.attr("href") || $element.find("a").attr("href")

        if (platformName && link && !link.includes("themoviedb.org")) {
          links[platformName] = link.startsWith("http") ? link : `https:${link}`
        }
      })

      // Also look for direct links in watch buttons
      $('a[href*="netflix.com"], a[href*="amazon.com"], a[href*="hulu.com"], a[href*="disneyplus.com"]').each(
        (i, element) => {
          const href = $(element).attr("href")
          if (href && !href.includes("themoviedb.org")) {
            const platform = this.extractPlatformFromUrl(href)
            if (platform) {
              links[platform] = href.startsWith("http") ? href : `https:${href}`
            }
          }
        },
      )
    } catch (error) {
      console.error("Error scraping TMDB watch page:", error)
    }

    return links
  }

  private async findActualStreamingLink(platform: string, title: string): Promise<string | null> {
    const platformLower = platform.toLowerCase()

    try {
      if (platformLower.includes("netflix")) {
        return await this.searchNetflixSeries(title)
      } else if (platformLower.includes("amazon") || platformLower.includes("prime")) {
        return await this.searchAmazonPrimeSeries(title)
      } else if (platformLower.includes("hulu")) {
        return await this.searchHuluSeries(title)
      } else if (platformLower.includes("disney")) {
        return await this.searchDisneyPlusSeries(title)
      } else if (platformLower.includes("hbo")) {
        return await this.searchHBOMaxSeries(title)
      }
    } catch (error) {
      console.error(`Error finding ${platform} link for ${title}:`, error)
    }

    return null
  }

  private async findActualPurchaseLink(platform: string, title: string): Promise<string | null> {
    const platformLower = platform.toLowerCase()

    try {
      if (platformLower.includes("amazon")) {
        return await this.searchAmazonVideoSeries(title)
      } else if (platformLower.includes("apple")) {
        return await this.searchAppleTVSeries(title)
      } else if (platformLower.includes("google")) {
        return await this.searchGooglePlaySeries(title)
      } else if (platformLower.includes("vudu")) {
        return await this.searchVuduSeries(title)
      }
    } catch (error) {
      console.error(`Error finding ${platform} purchase link for ${title}:`, error)
    }

    return null
  }

  private async searchNetflixSeries(title: string): Promise<string | null> {
    try {
      const searchQuery = `site:netflix.com "${title}" tv series`
      const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`

      const response = await axios.get(googleUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        timeout: 5000,
      })

      const $ = cheerio.load(response.data)
      const netflixLink = $('a[href*="netflix.com/title/"]').first().attr("href")

      if (netflixLink && !netflixLink.includes("google.com")) {
        return netflixLink.startsWith("http") ? netflixLink : `https:${netflixLink}`
      }
    } catch (error) {
      console.error("Netflix series search error:", error)
    }
    return null
  }

  private async searchAmazonPrimeSeries(title: string): Promise<string | null> {
    try {
      const searchQuery = `site:amazon.com "${title}" prime video tv series`
      const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`

      const response = await axios.get(googleUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        timeout: 5000,
      })

      const $ = cheerio.load(response.data)
      const amazonLink = $('a[href*="amazon.com/"][href*="/dp/"], a[href*="amazon.com/gp/video"]').first().attr("href")

      if (amazonLink && !amazonLink.includes("google.com")) {
        return amazonLink.startsWith("http") ? amazonLink : `https:${amazonLink}`
      }
    } catch (error) {
      console.error("Amazon Prime series search error:", error)
    }
    return null
  }

  private async searchHuluSeries(title: string): Promise<string | null> {
    try {
      const searchQuery = `site:hulu.com "${title}" tv series`
      const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`

      const response = await axios.get(googleUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        timeout: 5000,
      })

      const $ = cheerio.load(response.data)
      const huluLink = $('a[href*="hulu.com/series/"], a[href*="hulu.com/watch/"]').first().attr("href")

      if (huluLink && !huluLink.includes("google.com")) {
        return huluLink.startsWith("http") ? huluLink : `https:${huluLink}`
      }
    } catch (error) {
      console.error("Hulu series search error:", error)
    }
    return null
  }

  private async searchDisneyPlusSeries(title: string): Promise<string | null> {
    try {
      const searchQuery = `site:disneyplus.com "${title}" tv series`
      const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`

      const response = await axios.get(googleUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        timeout: 5000,
      })

      const $ = cheerio.load(response.data)
      const disneyLink = $('a[href*="disneyplus.com/series/"], a[href*="disneyplus.com/video/"]').first().attr("href")

      if (disneyLink && !disneyLink.includes("google.com")) {
        return disneyLink.startsWith("http") ? disneyLink : `https:${disneyLink}`
      }
    } catch (error) {
      console.error("Disney+ series search error:", error)
    }
    return null
  }

  private async searchHBOMaxSeries(title: string): Promise<string | null> {
    try {
      const searchQuery = `site:max.com "${title}" tv series OR site:hbomax.com "${title}"`
      const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`

      const response = await axios.get(googleUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        timeout: 5000,
      })

      const $ = cheerio.load(response.data)
      const hboLink = $('a[href*="max.com/"], a[href*="hbomax.com/"]').first().attr("href")

      if (hboLink && !hboLink.includes("google.com")) {
        return hboLink.startsWith("http") ? hboLink : `https:${hboLink}`
      }
    } catch (error) {
      console.error("HBO Max series search error:", error)
    }
    return null
  }

  private async searchAmazonVideoSeries(title: string): Promise<string | null> {
    return this.searchAmazonPrimeSeries(title) // Same logic for purchase
  }

  private async searchAppleTVSeries(title: string): Promise<string | null> {
    try {
      const searchQuery = `site:tv.apple.com "${title}" tv series`
      const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`

      const response = await axios.get(googleUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        timeout: 5000,
      })

      const $ = cheerio.load(response.data)
      const appleLink = $('a[href*="tv.apple.com/"]').first().attr("href")

      if (appleLink && !appleLink.includes("google.com")) {
        return appleLink.startsWith("http") ? appleLink : `https:${appleLink}`
      }
    } catch (error) {
      console.error("Apple TV series search error:", error)
    }
    return null
  }

  private async searchGooglePlaySeries(title: string): Promise<string | null> {
    try {
      const searchQuery = `site:play.google.com "${title}" tv series`
      const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`

      const response = await axios.get(googleUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        timeout: 5000,
      })

      const $ = cheerio.load(response.data)
      const googlePlayLink = $('a[href*="play.google.com/store/tv/"]').first().attr("href")

      if (googlePlayLink && !googlePlayLink.includes("google.com/search")) {
        return googlePlayLink.startsWith("http") ? googlePlayLink : `https:${googlePlayLink}`
      }
    } catch (error) {
      console.error("Google Play series search error:", error)
    }
    return null
  }

  private async searchVuduSeries(title: string): Promise<string | null> {
    try {
      const searchQuery = `site:vudu.com "${title}" tv series`
      const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`

      const response = await axios.get(googleUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        timeout: 5000,
      })

      const $ = cheerio.load(response.data)
      const vuduLink = $('a[href*="vudu.com/content/movies/"]').first().attr("href")

      if (vuduLink && !vuduLink.includes("google.com")) {
        return vuduLink.startsWith("http") ? vuduLink : `https:${vuduLink}`
      }
    } catch (error) {
      console.error("Vudu series search error:", error)
    }
    return null
  }

  private extractPlatformFromUrl(url: string): string | null {
    if (url.includes("netflix.com")) return "netflix"
    if (url.includes("amazon.com")) return "amazon prime video"
    if (url.includes("hulu.com")) return "hulu"
    if (url.includes("disneyplus.com")) return "disney+"
    if (url.includes("max.com") || url.includes("hbomax.com")) return "hbo max"
    if (url.includes("tv.apple.com")) return "apple tv"
    return null
  }

  private async scrapeJustWatchSeries(title: string) {
    const streaming: StreamingPlatform[] = []
    const purchase: StreamingPlatform[] = []

    try {
      console.log(`[v0] Scraping JustWatch for series: ${title}`)

      const searchUrl = `https://www.justwatch.com/us/search?q=${encodeURIComponent(title)}&content_type=show`

      const response = await axios.get(searchUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        },
        timeout: 10000,
      })

      const $ = cheerio.load(response.data)

      // Look for series titles and streaming info
      $(".title-list-row").each((i, element) => {
        const seriesTitle = $(element).find(".title").text().trim()

        if (seriesTitle.toLowerCase().includes(title.toLowerCase())) {
          $(element)
            .find(".offer")
            .each((j, offer) => {
              const platform = $(offer).find("img").attr("alt") || $(offer).attr("title")
              const link = $(offer).attr("href") || $(offer).find("a").attr("href")

              if (platform && link) {
                const fullLink = link.startsWith("http") ? link : `https://www.justwatch.com${link}`

                const offerType =
                  $(offer).hasClass("free") || $(offer).hasClass("subscription") ? "subscription" : "buy"

                if (offerType === "subscription") {
                  streaming.push({
                    platform: platform,
                    link: fullLink,
                    type: "subscription",
                  })
                } else {
                  purchase.push({
                    platform: platform,
                    link: fullLink,
                    type: "buy",
                  })
                }
              }
            })
        }
      })
    } catch (error) {
      console.error("JustWatch series scraping error:", error)
    }

    return { streaming, purchase }
  }

  private removeDuplicatePlatforms(platforms: StreamingPlatform[]): StreamingPlatform[] {
    const seen = new Set<string>()
    return platforms.filter((platform) => {
      const key = `${platform.platform}-${platform.type}`
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
  }

  private getFallbackStreamingPlatforms(title: string): StreamingPlatform[] {
    return [
      {
        platform: "Netflix",
        link: `https://www.netflix.com/search?q=${encodeURIComponent(title)}`,
        type: "subscription",
      },
      {
        platform: "Amazon Prime Video",
        link: `https://www.amazon.com/s?k=${encodeURIComponent(title)}&i=instant-video`,
        type: "subscription",
      },
      {
        platform: "Hulu",
        link: `https://www.hulu.com/search?q=${encodeURIComponent(title)}`,
        type: "subscription",
      },
    ]
  }

  private getFallbackPurchasePlatforms(title: string): StreamingPlatform[] {
    return [
      {
        platform: "Amazon Video",
        link: `https://www.amazon.com/s?k=${encodeURIComponent(title)}&i=instant-video`,
        type: "buy",
      },
      {
        platform: "Apple TV",
        link: `https://tv.apple.com/search?term=${encodeURIComponent(title)}`,
        type: "buy",
      },
    ]
  }

  private combineSeriesData(
    request: SeriesRequest,
    tmdbResult: PromiseSettledResult<any>,
    streamingResult: PromiseSettledResult<any>,
  ): SeriesResponse {
    const tmdbData = tmdbResult.status === "fulfilled" ? tmdbResult.value : null
    const streamingData =
      streamingResult.status === "fulfilled" ? streamingResult.value : { streaming: [], purchase: [] }

    const slug = request.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")

    const seriesResponse: SeriesResponse = {
      title: request.title,
      year:
        request.year ||
        (tmdbData?.details?.first_air_date ? new Date(tmdbData.details.first_air_date).getFullYear() : undefined),
      slug,
      rated: tmdbData?.details?.content_ratings?.results?.find((r: any) => r.iso_3166_1 === "US")?.rating,
      released: tmdbData?.details?.first_air_date,
      plot: tmdbData?.details?.overview,
      runtime: tmdbData?.details?.episode_run_time,
      seriesType: tmdbData?.details?.type || "TV Series",
      genres: tmdbData?.details?.genres?.map((g: any) => g.name) || [],
      language: tmdbData?.details?.languages || [],
      country: tmdbData?.details?.production_countries?.map((c: any) => c.name) || [],
      seasons: tmdbData?.details?.number_of_seasons,
      episodes: tmdbData?.details?.number_of_episodes,
      status: tmdbData?.details?.status,
      creators:
        tmdbData?.details?.created_by?.map((c: any) => ({
          name: c.name,
          tmdbId: c.id?.toString(),
        })) || [],
      cast:
        tmdbData?.credits?.cast?.slice(0, 20).map((c: any) => ({
          person: {
            name: c.name,
            tmdbId: c.id?.toString(),
          },
          character: c.character,
        })) || [],
      production: {
        companies:
          tmdbData?.details?.production_companies?.map((c: any) => ({
            name: c.name,
            tmdbId: c.id?.toString(),
          })) || [],
        networks:
          tmdbData?.details?.networks?.map((n: any) => ({
            name: n.name,
            id: n.id,
            logo_path: n.logo_path,
            origin_country: n.origin_country,
          })) || [],
        studios: [],
        distributors: [],
      },
      ratings: {
        tmdb: tmdbData?.details?.vote_average
          ? {
              score: tmdbData.details.vote_average,
              votes: tmdbData.details.vote_count,
            }
          : undefined,
      },
      poster: tmdbData?.details?.poster_path
        ? {
            url: `https://image.tmdb.org/t/p/w500${tmdbData.details.poster_path}`,
            publicId: tmdbData.details.poster_path,
          }
        : undefined,
      availableOn: streamingData,
      references: {
        tmdbId: tmdbData?.details?.id?.toString(),
      },
    }

    return seriesResponse
  }
}
