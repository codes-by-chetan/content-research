import axios from "axios"
import * as cheerio from "cheerio"
import type { MovieRequest, MovieResponse, StreamingPlatform } from "../types"

export class MovieScraper {
  private tmdbApiKey: string
  private omdbApiKey: string
  private proxyList: string[] = []
  private currentProxyIndex = 0
  private proxyApiKey = process.env.PROXYSCRAPE_API_KEY
  private proxyApiUrl = process.env.PROXYSCRAPE_API_URL

  constructor() {
    this.tmdbApiKey = process.env.TMDB_API_KEY || ""
    this.omdbApiKey = process.env.OMDB_API_KEY || ""
    this.initializeProxies()
  }

  private async initializeProxies(): Promise<void> {
    try {
      if (!this.proxyApiUrl) return

      console.log(`[v0] Fetching proxy list from ProxyScrape`)
      const response = await axios.get(this.proxyApiUrl, { timeout: 10000 })

      if (response.data) {
        this.proxyList = response.data.split("\n").filter((proxy: string) => proxy.trim())
        console.log(`[v0] Loaded ${this.proxyList.length} proxies`)
      }
    } catch (error) {
      console.log(`[v0] Failed to load proxies, continuing without proxy support`)
    }
  }

  private getNextProxy(): string | null {
    if (this.proxyList.length === 0) return null

    const proxy = this.proxyList[this.currentProxyIndex]
    this.currentProxyIndex = (this.currentProxyIndex + 1) % this.proxyList.length
    return proxy
  }

  private async makeProxyRequest(url: string, options: any = {}): Promise<any> {
    const maxRetries = 3
    let lastError: any

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const requestConfig = {
          ...options,
          timeout: 15000,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Cache-Control": "no-cache",
            ...options.headers,
          },
        }

        // Use proxy if available
        const proxy = this.getNextProxy()
        if (proxy && attempt > 0) {
          const [host, port] = proxy.split(":")
          requestConfig.proxy = {
            host,
            port: Number.parseInt(port),
            protocol: "http",
          }
          console.log(`[v0] Using proxy: ${proxy}`)
        }

        const response = await axios.get(url, requestConfig)
        return response
      } catch (error: any) {
        lastError = error
        console.log(`[v0] Request attempt ${attempt + 1} failed: ${error.message}`)

        if (attempt < maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)))
        }
      }
    }

    throw lastError
  }

  async scrapeMovieData(request: MovieRequest): Promise<MovieResponse> {
    try {
      console.log(`[v0] Starting research for movie: ${request.title} (${request.year})`)

      // Get basic movie data from multiple sources
      const [tmdbData, omdbData, streamingData] = await Promise.allSettled([
        this.getTMDBData(request.title, request.year),
        this.getOMDBData(request.title, request.year),
        this.getStreamingAvailability(request.title, request.year),
      ])

      console.log(`[v0] Completed data gathering for ${request.title}`)

      // Combine data from all sources
      const movieData = this.combineMovieData(request, tmdbData, omdbData, streamingData)

      return movieData
    } catch (error) {
      console.error("Error scraping movie data:", error)
      throw new Error("Failed to scrape movie data")
    }
  }

  private async getTMDBData(title: string, year: number) {
    if (!this.tmdbApiKey) {
      console.warn("TMDB API key not provided")
      return null
    }

    try {
      console.log(`[v0] Fetching TMDB data for ${title}`)

      // Search for movie
      const searchResponse = await axios.get(
        `https://api.themoviedb.org/3/search/movie?api_key=${this.tmdbApiKey}&query=${encodeURIComponent(title)}&year=${year}`,
      )

      if (searchResponse.data.results.length === 0) {
        return null
      }

      const movieId = searchResponse.data.results[0].id

      const [movieDetails, credits, videos, watchProviders] = await Promise.all([
        axios.get(`https://api.themoviedb.org/3/movie/${movieId}?api_key=${this.tmdbApiKey}`),
        axios.get(`https://api.themoviedb.org/3/movie/${movieId}/credits?api_key=${this.tmdbApiKey}`),
        axios.get(`https://api.themoviedb.org/3/movie/${movieId}/videos?api_key=${this.tmdbApiKey}`),
        axios.get(`https://api.themoviedb.org/3/movie/${movieId}/watch/providers?api_key=${this.tmdbApiKey}`),
      ])

      return {
        details: movieDetails.data,
        credits: credits.data,
        videos: videos.data,
        watchProviders: watchProviders.data,
      }
    } catch (error) {
      console.error("TMDB API error:", error)
      return null
    }
  }

  private async getOMDBData(title: string, year: number) {
    if (!this.omdbApiKey) {
      console.warn("OMDB API key not provided")
      return null
    }

    try {
      const response = await axios.get(
        `http://www.omdbapi.com/?apikey=${this.omdbApiKey}&t=${encodeURIComponent(title)}&y=${year}&plot=full`,
      )

      return response.data.Response === "True" ? response.data : null
    } catch (error) {
      console.error("OMDB API error:", error)
      return null
    }
  }

  private async getStreamingAvailability(
    title: string,
    year: number,
  ): Promise<{
    [region: string]: {
      streaming: StreamingPlatform[]
      purchase: StreamingPlatform[]
    }
  }> {
    console.log(`[v0] Researching streaming availability for ${title} across multiple regions`)

    const regions = ["US", "IN", "GB", "CA", "AU", "DE", "FR", "JP", "BR", "MX"]
    const result: { [region: string]: { streaming: StreamingPlatform[]; purchase: StreamingPlatform[] } } = {}

    for (const region of regions) {
      console.log(`[v0] Processing region: ${region}`)

      const streaming: StreamingPlatform[] = []
      const purchase: StreamingPlatform[] = []

      try {
        const [tmdbWatchData, justWatchData] = await Promise.allSettled([
          this.getTMDBWatchProvidersForRegion(title, year, region),
          this.scrapeJustWatchForRegion(title, year, region),
        ])

        console.log(
          `[v0] ${region} - TMDB Watch result:`,
          tmdbWatchData.status,
          tmdbWatchData.status === "fulfilled" ? tmdbWatchData.value : tmdbWatchData.reason,
        )
        console.log(
          `[v0] ${region} - JustWatch result:`,
          justWatchData.status,
          justWatchData.status === "fulfilled" ? justWatchData.value : justWatchData.reason,
        )

        // Combine results from all sources
        if (tmdbWatchData.status === "fulfilled") {
          console.log(
            `[v0] ${region} - Adding ${tmdbWatchData.value.streaming.length} streaming and ${tmdbWatchData.value.purchase.length} purchase from TMDB`,
          )
          streaming.push(...tmdbWatchData.value.streaming)
          purchase.push(...tmdbWatchData.value.purchase)
        }

        if (justWatchData.status === "fulfilled") {
          console.log(
            `[v0] ${region} - Adding ${justWatchData.value.streaming.length} streaming and ${justWatchData.value.purchase.length} purchase from JustWatch`,
          )
          streaming.push(...justWatchData.value.streaming)
          purchase.push(...justWatchData.value.purchase)
        }

        const uniqueStreaming = this.removeDuplicatePlatforms(streaming)
        const uniquePurchase = this.removeDuplicatePlatforms(purchase)

        console.log(
          `[v0] ${region} - Final result: ${uniqueStreaming.length} streaming and ${uniquePurchase.length} purchase options`,
        )

        result[region] = {
          streaming: uniqueStreaming,
          purchase: uniquePurchase,
        }

        // Add delay between regions to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 1000))
      } catch (error) {
        console.error(`Error getting streaming availability for ${region}:`, error)
        result[region] = { streaming, purchase }
      }
    }

    return result
  }

  private async getTMDBWatchProvidersForRegion(title: string, year: number, region: string) {
    const streaming: StreamingPlatform[] = []
    const purchase: StreamingPlatform[] = []

    if (!this.tmdbApiKey) {
      console.log(`[v0] TMDB API key not available for watch providers`)
      return { streaming, purchase }
    }

    try {
      console.log(`[v0] Getting TMDB watch providers for ${title} in ${region}`)

      const searchResponse = await axios.get(
        `https://api.themoviedb.org/3/search/movie?api_key=${this.tmdbApiKey}&query=${encodeURIComponent(title)}&year=${year}`,
      )

      if (searchResponse.data.results.length === 0) {
        console.log(`[v0] No TMDB results found for ${title}`)
        return { streaming, purchase }
      }

      const movieId = searchResponse.data.results[0].id
      console.log(`[v0] Found TMDB movie ID: ${movieId}`)

      const watchResponse = await axios.get(
        `https://api.themoviedb.org/3/movie/${movieId}/watch/providers?api_key=${this.tmdbApiKey}`,
      )

      const regionProviders = watchResponse.data.results?.[region]
      if (!regionProviders) {
        console.log(`[v0] No ${region} watch providers found for ${title}`)
        return { streaming, purchase }
      }

      console.log(`[v0] TMDB ${region} providers:`, regionProviders)

      // Map region codes to locale strings for TMDB watch page
      const localeMap: { [key: string]: string } = {
        US: "US",
        IN: "IN",
        GB: "GB",
        CA: "CA",
        AU: "AU",
        DE: "DE",
        FR: "FR",
        JP: "JP",
        BR: "BR",
        MX: "MX",
      }

      const locale = localeMap[region] || region
      const tmdbWatchPageUrl = `https://www.themoviedb.org/movie/${movieId}/watch?locale=${locale}`
      console.log(`[v0] Scraping TMDB watch page: ${tmdbWatchPageUrl}`)

      const actualStreamingLinks = await this.scrapeTMDBWatchPage(tmdbWatchPageUrl, title, year)
      console.log(`[v0] Found ${actualStreamingLinks.length} actual streaming links from TMDB page`)

      // Add streaming providers with actual links
      if (regionProviders.flatrate) {
        console.log(`[v0] Processing ${regionProviders.flatrate.length} streaming providers`)
        for (const provider of regionProviders.flatrate) {
          console.log(`[v0] Looking for actual link for streaming provider: ${provider.provider_name}`)

          let actualLink = actualStreamingLinks.find(
            (link) =>
              link.platform.toLowerCase().includes(provider.provider_name.toLowerCase()) ||
              provider.provider_name.toLowerCase().includes(link.platform.toLowerCase()) ||
              // Handle Amazon channel providers
              (provider.provider_name.toLowerCase().includes("amazon") &&
                link.platform.toLowerCase().includes("amazon")) ||
              // Handle Lionsgate variations
              (provider.provider_name.toLowerCase().includes("lionsgate") &&
                link.platform.toLowerCase().includes("lionsgate")) ||
              // Handle Apple TV channel variations
              (provider.provider_name.toLowerCase().includes("apple") &&
                link.platform.toLowerCase().includes("apple")) ||
              // Handle Netflix variations
              (provider.provider_name.toLowerCase().includes("netflix") &&
                link.platform.toLowerCase().includes("netflix")),
          )?.link

          // If no direct match found, try platform-specific scraping only for non-channel providers
          if (!actualLink && !provider.provider_name.toLowerCase().includes("channel")) {
            actualLink = await this.findPlatformSpecificLink(provider.provider_name, title, year)
          }

          console.log(`[v0] Found link for ${provider.provider_name}: ${actualLink}`)

          if (actualLink && this.isValidContentURL(actualLink)) {
            streaming.push({
              platform: provider.provider_name,
              link: actualLink,
              type: "subscription",
            })
            console.log(`[v0] Added streaming platform: ${provider.provider_name}`)
          } else {
            console.log(`[v0] Rejected link for ${provider.provider_name} (search URL or invalid): ${actualLink}`)
          }
        }
      }

      // Add purchase/rent providers with actual links
      if (regionProviders.buy) {
        console.log(`[v0] Processing ${regionProviders.buy.length} purchase providers`)
        for (const provider of regionProviders.buy) {
          console.log(`[v0] Looking for actual link for purchase provider: ${provider.provider_name}`)

          const actualLink =
            actualStreamingLinks.find(
              (link) =>
                link.platform.toLowerCase().includes(provider.provider_name.toLowerCase()) ||
                provider.provider_name.toLowerCase().includes(link.platform.toLowerCase()),
            )?.link || (await this.findPlatformSpecificLink(provider.provider_name, title, year))

          console.log(`[v0] Found link for ${provider.provider_name}: ${actualLink}`)

          if (actualLink && this.isValidContentURL(actualLink)) {
            purchase.push({
              platform: provider.provider_name,
              link: actualLink,
              type: "buy",
            })
            console.log(`[v0] Added purchase platform: ${provider.provider_name}`)
          } else {
            console.log(`[v0] Rejected link for ${provider.provider_name} (search URL or invalid): ${actualLink}`)
          }
        }
      }

      if (regionProviders.rent) {
        console.log(`[v0] Processing ${regionProviders.rent.length} rental providers`)
        for (const provider of regionProviders.rent) {
          console.log(`[v0] Looking for actual link for rental provider: ${provider.provider_name}`)

          const actualLink =
            actualStreamingLinks.find(
              (link) =>
                link.platform.toLowerCase().includes(provider.provider_name.toLowerCase()) ||
                provider.provider_name.toLowerCase().includes(link.platform.toLowerCase()),
            )?.link || (await this.findPlatformSpecificLink(provider.provider_name, title, year))

          console.log(`[v0] Found link for ${provider.provider_name}: ${actualLink}`)

          if (actualLink && this.isValidContentURL(actualLink)) {
            purchase.push({
              platform: provider.provider_name,
              link: actualLink,
              type: "rent",
            })
            console.log(`[v0] Added rental platform: ${provider.provider_name}`)
          } else {
            console.log(`[v0] Rejected link for ${provider.provider_name} (search URL or invalid): ${actualLink}`)
          }
        }
      }
    } catch (error) {
      console.error("TMDB watch providers error:", error)
    }

    console.log(`[v0] TMDB final result: ${streaming.length} streaming, ${purchase.length} purchase`)
    return { streaming, purchase }
  }

  private async scrapeTMDBWatchPage(
    tmdbWatchUrl: string,
    title: string,
    year: number,
  ): Promise<{ platform: string; link: string }[]> {
    const links: { platform: string; link: string }[] = []

    try {
      console.log(`[v0] Scraping TMDB watch page for actual streaming URLs`)

      const response = await this.makeProxyRequest(tmdbWatchUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        timeout: 15000,
      })

      const $ = cheerio.load(response.data)

      // Look for JustWatch streaming provider links
      $('a[href*="justwatch.com"]').each((i, element) => {
        const href = $(element).attr("href")
        if (href) {
          // Extract the actual streaming URL from JustWatch redirect
          const urlParams = new URLSearchParams(href.split("?")[1] || "")
          const actualUrl = urlParams.get("r") || urlParams.get("url")
          if (actualUrl) {
            const decodedUrl = decodeURIComponent(actualUrl)
            const platform = this.getPlatformFromUrl(decodedUrl)
            if (platform) {
              links.push({ platform, link: decodedUrl })
              console.log(`[v0] Found JustWatch link for ${platform}: ${decodedUrl}`)
            }
          }
        }
      })

      // Look for direct streaming provider buttons/links
      $(".ott_offer, .provider, .streaming_option").each((i, element) => {
        const $element = $(element)
        const providerLink = $element.find("a").attr("href") || $element.attr("href")
        const providerName =
          $element.find("img").attr("alt") ||
          $element.find(".provider_name").text().trim() ||
          $element.attr("data-provider")

        if (providerName && providerLink && providerLink.startsWith("http")) {
          // Skip JustWatch redirect URLs, we handle those separately
          if (!providerLink.includes("justwatch.com")) {
            links.push({
              platform: providerName,
              link: providerLink,
            })
            console.log(`[v0] Found direct provider link for ${providerName}: ${providerLink}`)
          }
        }
      })

      const scriptTags = $("script").toArray()
      for (const script of scriptTags) {
        const scriptContent = $(script).html() || ""

        // Look for JustWatch data in script tags
        const justWatchMatch = scriptContent.match(/"offers":\s*\[(.*?)\]/s)
        if (justWatchMatch) {
          try {
            const offersData = JSON.parse(`[${justWatchMatch[1]}]`)
            for (const offer of offersData) {
              if (offer.urls && offer.urls.standard_web) {
                const platform = this.getPlatformFromUrl(offer.urls.standard_web)
                if (platform) {
                  links.push({ platform, link: offer.urls.standard_web })
                  console.log(`[v0] Found JustWatch offer for ${platform}: ${offer.urls.standard_web}`)
                }
              }
            }
          } catch (e) {
            // Continue parsing other scripts
          }
        }

        // Look for direct streaming URLs in script content
        const urlPatterns = [
          { pattern: /https:\/\/www\.netflix\.com\/title\/\d+/g, platform: "Netflix" },
          { pattern: /https:\/\/www\.amazon\.com\/[^"'\s]*\/dp\/[A-Z0-9]+/g, platform: "Amazon Prime Video" },
          { pattern: /https:\/\/watch\.amazon\.com\/detail\/[A-Z0-9]+/g, platform: "Amazon Prime Video" },
          { pattern: /https:\/\/app\.primevideo\.com\/detail\/[A-Z0-9]+/g, platform: "Amazon Prime Video" },
          { pattern: /https:\/\/www\.hulu\.com\/movie\/[^"'\s]+/g, platform: "Hulu" },
          { pattern: /https:\/\/www\.hulu\.com\/watch\/[^"'\s]+/g, platform: "Hulu" },
          { pattern: /https:\/\/tv\.apple\.com\/[^"'\s]+/g, platform: "Apple TV" },
          { pattern: /https:\/\/www\.disneyplus\.com\/[^"'\s]+/g, platform: "Disney+" },
          { pattern: /https:\/\/play\.hbomax\.com\/[^"'\s]+/g, platform: "HBO Max" },
          { pattern: /https:\/\/www\.paramountplus\.com\/[^"'\s]+/g, platform: "Paramount+" },
          { pattern: /https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}/g, platform: "YouTube" },
          { pattern: /https:\/\/play\.google\.com\/store\/movies\/details\/[^"'\s?]+/g, platform: "Google Play" },
          { pattern: /https:\/\/www\.lionsgateplay\.com\/[^"'\s?]+/g, platform: "Lionsgate Play" },
          { pattern: /https:\/\/www\.lionsgate\.com\/[^"'\s?]+/g, platform: "Lionsgate" },
          { pattern: /https:\/\/www\.rakuten\.tv\/[^"'\s?]+/g, platform: "Rakuten TV" },
          { pattern: /https:\/\/www\.skystore\.com\/[^"'\s?]+/g, platform: "SKY Store" },
          { pattern: /https:\/\/www\.cineplex\.com\/[^"'\s?]+/g, platform: "Cineplex" },
          { pattern: /https:\/\/plex\.tv\/[^"'\s?]+/g, platform: "Plex" },
          { pattern: /https:\/\/www\.fandango\.com\/[^"'\s?]+/g, platform: "Fandango" },
          { pattern: /https:\/\/www\.vudu\.com\/[^"'\s?]+/g, platform: "Vudu" },
          { pattern: /https:\/\/www\.microsoft\.com\/[^"'\s?]+/g, platform: "Microsoft Store" },
          { pattern: /https:\/\/www\.roku\.com\/[^"'\s?]+/g, platform: "Roku Channel" },
          { pattern: /https:\/\/www\.tubi\.tv\/[^"'\s?]+/g, platform: "Tubi TV" },
          { pattern: /https:\/\/www\.crackle\.com\/[^"'\s?]+/g, platform: "Crackle" },
          { pattern: /https:\/\/www\.peacocktv\.com\/[^"'\s?]+/g, platform: "Peacock" },
          { pattern: /https:\/\/www\.showtime\.com\/[^"'\s?]+/g, platform: "Showtime" },
          { pattern: /https:\/\/www\.starz\.com\/[^"'\s?]+/g, platform: "Starz" },
          { pattern: /https:\/\/www\.epix\.com\/[^"'\s?]+/g, platform: "Epix" },
          { pattern: /https:\/\/www\.cinemax\.com\/[^"'\s?]+/g, platform: "Cinemax" },
          { pattern: /https:\/\/www\.hbomax\.com\/[^"'\s?]+/g, platform: "HBO Max" },
          { pattern: /https:\/\/www\.discovery\.com\/[^"'\s?]+/g, platform: "Discovery+" },
          { pattern: /https:\/\/www\.funimation\.com\/[^"'\s?]+/g, platform: "Funimation" },
          { pattern: /https:\/\/www\.crunchyroll\.com\/[^"'\s?]+/g, platform: "Crunchyroll" },
        ]

        for (const { pattern, platform } of urlPatterns) {
          const matches = scriptContent.match(pattern)
          if (matches) {
            for (const match of matches) {
              links.push({ platform, link: match })
              console.log(`[v0] Found ${platform} URL in script: ${match}`)
            }
          }
        }
      }
    } catch (error) {
      console.error("Error scraping TMDB watch page:", error)
    }

    console.log(`[v0] Total links found from TMDB watch page: ${links.length}`)
    return links
  }

  private async findPlatformSpecificLink(platformName: string, title: string, year: number): Promise<string | null> {
    const platform = platformName.toLowerCase()

    try {
      if (platform.includes("netflix")) {
        return await this.scrapeNetflixContent(title, year)
      } else if (platform.includes("prime") || platform.includes("amazon")) {
        return await this.scrapeAmazonContent(title, year)
      } else if (platform.includes("hulu")) {
        return await this.scrapeHuluContent(title, year)
      } else if (platform.includes("apple")) {
        return await this.scrapeAppleTVContent(title, year)
      } else if (platform.includes("disney")) {
        return await this.scrapeDisneyPlusContent(title, year)
      } else if (platform.includes("hbo") || platform.includes("max")) {
        return await this.scrapeHBOMaxContent(title, year)
      } else if (platform.includes("paramount")) {
        return await this.scrapeParamountPlusContent(title, year)
      } else if (platform.includes("youtube")) {
        return await this.scrapeYouTubeContent(title, year)
      } else if (platform.includes("google play")) {
        return await this.scrapeGooglePlayContent(title, year)
      } else if (platform.includes("lionsgate play")) {
        return await this.scrapeLionsgatePlayContent(title, year)
      } else if (platform.includes("lionsgate")) {
        return await this.scrapeLionsgateContent(title, year)
      } else if (platform.includes("rakuten tv")) {
        return await this.scrapeRakutenTVContent(title, year)
      } else if (platform.includes("sky store")) {
        return await this.scrapeSKYStoreContent(title, year)
      } else if (platform.includes("cineplex")) {
        return await this.scrapeCineplexContent(title, year)
      } else if (platform.includes("plex")) {
        return await this.scrapePlexContent(title, year)
      } else if (platform.includes("fandango")) {
        return await this.scrapeFandangoContent(title, year)
      } else if (platform.includes("vudu")) {
        return await this.scrapeVuduContent(title, year)
      } else if (platform.includes("microsoft store")) {
        return await this.scrapeMicrosoftStoreContent(title, year)
      } else if (platform.includes("roku channel")) {
        return await this.scrapeRokuChannelContent(title, year)
      } else if (platform.includes("tubi tv")) {
        return await this.scrapeTubiTVContent(title, year)
      } else if (platform.includes("crackle")) {
        return await this.scrapeCrackleContent(title, year)
      } else if (platform.includes("peacock")) {
        return await this.scrapePeacockContent(title, year)
      } else if (platform.includes("showtime")) {
        return await this.scrapeShowtimeContent(title, year)
      } else if (platform.includes("starz")) {
        return await this.scrapeStarzContent(title, year)
      } else if (platform.includes("epix")) {
        return await this.scrapeEpixContent(title, year)
      } else if (platform.includes("cinemax")) {
        return await this.scrapeCinemaxContent(title, year)
      } else if (platform.includes("discovery")) {
        return await this.scrapeDiscoveryPlusContent(title, year)
      } else if (platform.includes("funimation")) {
        return await this.scrapeFunimationContent(title, year)
      } else if (platform.includes("crunchyroll")) {
        return await this.scrapeCrunchyrollContent(title, year)
      }
    } catch (error) {
      console.error(`Error finding ${platformName} link:`, error)
    }

    return null
  }

  private async scrapeNetflixContent(title: string, year: number): Promise<string | null> {
    try {
      console.log(`[v0] Scraping Netflix for ${title} (${year})`)

      // Add delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // First try to find the content through Netflix's search
      const searchUrl = `https://www.netflix.com/search?q=${encodeURIComponent(title)}`

      const response = await this.makeProxyRequest(searchUrl)

      const $ = cheerio.load(response.data)

      // Look for movie cards in search results
      let netflixId = null

      // Try to find the title ID from the page content
      $('a[href*="/title/"]').each((i, element) => {
        const href = $(element).attr("href")
        const titleText = $(element).text().toLowerCase()

        if (href && titleText.includes(title.toLowerCase())) {
          const match = href.match(/\/title\/(\d+)/)
          if (match) {
            netflixId = match[1]
            return false // break the loop
          }
        }
      })

      // Also check script tags for JSON data
      if (!netflixId) {
        $("script").each((i, element) => {
          const scriptContent = $(element).html() || ""

          // Look for Netflix title IDs in JSON data
          const titleMatches = scriptContent.match(/"id":(\d{8,})/g)
          if (titleMatches) {
            // Try to find the right title by checking surrounding context
            for (const match of titleMatches) {
              const id = match.replace('"id":', "")
              const contextStart = scriptContent.indexOf(match) - 200
              const contextEnd = scriptContent.indexOf(match) + 200
              const context = scriptContent.substring(Math.max(0, contextStart), contextEnd).toLowerCase()

              if (context.includes(title.toLowerCase()) || context.includes(year.toString())) {
                netflixId = id
                break
              }
            }
          }
        })
      }

      if (netflixId) {
        console.log(`[v0] Found Netflix title ID: ${netflixId}`)
        return `https://www.netflix.com/title/${netflixId}`
      }

      const cleanTitle = title
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, "-")
      const possibleUrls = [
        `https://www.netflix.com/title/${cleanTitle}-${year}`,
        `https://www.netflix.com/title/${cleanTitle}`,
      ]

      for (const url of possibleUrls) {
        try {
          const testResponse = await axios.head(url, { timeout: 5000 })
          if (testResponse.status === 200) {
            console.log(`[v0] Found Netflix URL via pattern matching: ${url}`)
            return url
          }
        } catch (e) {
          // Continue to next URL
        }
      }

      console.log(`[v0] Netflix content not found for ${title}`)
      return null
    } catch (error) {
      console.error("Netflix scraping error:", error)
      return null
    }
  }

  private async scrapeAmazonContent(title: string, year: number): Promise<string | null> {
    try {
      console.log(`[v0] Scraping Amazon Prime for ${title} (${year})`)

      // Add delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 1500))

      const searchUrl = `https://www.amazon.com/s?k=${encodeURIComponent(title + " " + year)}&i=prime-instant-video`

      const response = await this.makeProxyRequest(searchUrl)

      const $ = cheerio.load(response.data)

      // Look for product links in search results
      let amazonASIN = null

      $('a[href*="/dp/"], a[href*="/gp/video/detail/"]').each((i, element) => {
        const href = $(element).attr("href")
        const titleElement =
          $(element).find('[data-cy="title-recipe-title"]').text() ||
          $(element).closest('[data-component-type="s-search-result"]').find("h2 a span").text()

        if (href && titleElement.toLowerCase().includes(title.toLowerCase())) {
          const dpMatch = href.match(/\/dp\/([A-Z0-9]{10})/)
          const videoMatch = href.match(/\/gp\/video\/detail\/([A-Z0-9]{10})/)

          if (dpMatch) {
            amazonASIN = dpMatch[1]
            return false
          } else if (videoMatch) {
            amazonASIN = videoMatch[1]
            return false
          }
        }
      })

      if (amazonASIN) {
        console.log(`[v0] Found Amazon ASIN: ${amazonASIN}`)
        return `https://www.amazon.com/dp/${amazonASIN}`
      }

      try {
        const googleSearchUrl = `https://www.google.com/search?q="${title}" ${year} site:amazon.com/gp/video/detail`
        const googleResponse = await this.makeProxyRequest(googleSearchUrl)

        const amazonMatch = googleResponse.data.match(/amazon\.com\/gp\/video\/detail\/([A-Z0-9]{10})/i)
        if (amazonMatch) {
          const amazonUrl = `https://www.amazon.com/gp/video/detail/${amazonMatch[1]}`
          console.log(`[v0] Found Amazon URL via Google: ${amazonUrl}`)
          return amazonUrl
        }
      } catch (e) {
        console.log(`[v0] Google fallback failed for Amazon`)
      }

      console.log(`[v0] Amazon Prime content not found for ${title}`)
      return null
    } catch (error) {
      console.error("Amazon scraping error:", error)
      return null
    }
  }

  private async scrapeHuluContent(title: string, year: number): Promise<string | null> {
    try {
      console.log(`[v0] Scraping Hulu for ${title} (${year})`)

      const searchUrl = `https://www.hulu.com/search?q=${encodeURIComponent(title)}`

      const response = await this.makeProxyRequest(searchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        timeout: 15000,
      })

      const $ = cheerio.load(response.data)

      // Look for Hulu content links
      let huluUrl = null

      $('a[href*="/movie/"], a[href*="/watch/"]').each((i, element) => {
        const href = $(element).attr("href")
        const titleText =
          $(element).text().toLowerCase() ||
          $(element).find("img").attr("alt")?.toLowerCase() ||
          $(element).closest("[data-testid]").find('[data-testid*="title"]').text().toLowerCase()

        if (href && titleText && titleText.includes(title.toLowerCase())) {
          huluUrl = href.startsWith("http") ? href : `https://www.hulu.com${href}`
          return false
        }
      })

      if (huluUrl) {
        console.log(`[v0] Found Hulu URL: ${huluUrl}`)
        return huluUrl
      }

      console.log(`[v0] Hulu content not found for ${title}`)
      return null
    } catch (error) {
      console.error("Hulu scraping error:", error)
      return null
    }
  }

  private async scrapeAppleTVContent(title: string, year: number): Promise<string | null> {
    try {
      console.log(`[v0] Scraping Apple TV for ${title} (${year})`)

      const searchUrl = `https://tv.apple.com/us/search?term=${encodeURIComponent(title)}`

      const response = await this.makeProxyRequest(searchUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        timeout: 15000,
      })

      const $ = cheerio.load(response.data)

      // Look for Apple TV movie links
      let appleUrl = null

      $('a[href*="/movie/"]').each((i, element) => {
        const href = $(element).attr("href")
        const titleText = $(element).text().toLowerCase() || $(element).find("img").attr("alt")?.toLowerCase()

        if (href && titleText && titleText.includes(title.toLowerCase())) {
          appleUrl = href.startsWith("http") ? href : `https://tv.apple.com${href}`
          return false
        }
      })

      // Also check for content in script tags
      if (!appleUrl) {
        $("script").each((i, element) => {
          const scriptContent = $(element).html() || ""
          const appleMatch = scriptContent.match(/tv\.apple\.com\/us\/movie\/[^"']+/g)

          if (appleMatch) {
            for (const match of appleMatch) {
              if (scriptContent.toLowerCase().includes(title.toLowerCase())) {
                appleUrl = `https://${match}`
                return false
              }
            }
          }
        })
      }

      if (appleUrl) {
        console.log(`[v0] Found Apple TV URL: ${appleUrl}`)
        return appleUrl
      }

      console.log(`[v0] Apple TV content not found for ${title}`)
      return null
    } catch (error) {
      console.error("Apple TV scraping error:", error)
      return null
    }
  }

  private async scrapeDisneyPlusContent(title: string, year: number): Promise<string | null> {
    try {
      console.log(`[v0] Scraping Disney+ for ${title} (${year})`)

      // Disney+ search through Google since direct scraping is heavily protected
      const searchQuery = `"${title}" ${year} site:disneyplus.com/movies`
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`

      const response = await this.makeProxyRequest(searchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        timeout: 10000,
      })

      const disneyMatch = response.data.match(/disneyplus\.com\/movies\/([^"'\s?]+)/i)
      if (disneyMatch) {
        const disneyUrl = `https://www.disneyplus.com/movies/${disneyMatch[1]}`
        console.log(`[v0] Found Disney+ URL: ${disneyUrl}`)
        return disneyUrl
      }

      return null
    } catch (error) {
      console.error("Disney+ scraping error:", error)
      return null
    }
  }

  private async scrapeHBOMaxContent(title: string, year: number): Promise<string | null> {
    try {
      console.log(`[v0] Scraping HBO Max for ${title} (${year})`)

      const searchQuery = `"${title}" ${year} site:max.com`
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`

      const response = await this.makeProxyRequest(searchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        timeout: 10000,
      })

      const maxMatch = response.data.match(/max\.com\/([^"'\s?]+)/i)
      if (maxMatch && !maxMatch[1].includes("search")) {
        const maxUrl = `https://www.max.com/${maxMatch[1]}`
        console.log(`[v0] Found HBO Max URL: ${maxUrl}`)
        return maxUrl
      }

      return null
    } catch (error) {
      console.error("HBO Max scraping error:", error)
      return null
    }
  }

  private async scrapeParamountPlusContent(title: string, year: number): Promise<string | null> {
    try {
      console.log(`[v0] Scraping Paramount+ for ${title} (${year})`)

      const searchQuery = `"${title}" ${year} site:paramountplus.com/movies`
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`

      const response = await this.makeProxyRequest(searchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        timeout: 10000,
      })

      const paramountMatch = response.data.match(/paramountplus\.com\/movies\/([^"'\s?]+)/i)
      if (paramountMatch) {
        const paramountUrl = `https://www.paramountplus.com/movies/${paramountMatch[1]}`
        console.log(`[v0] Found Paramount+ URL: ${paramountUrl}`)
        return paramountUrl
      }

      return null
    } catch (error) {
      console.error("Paramount+ scraping error:", error)
      return null
    }
  }

  private async scrapeYouTubeContent(title: string, year: number): Promise<string | null> {
    try {
      console.log(`[v0] Scraping YouTube for ${title} (${year})`)

      // Add delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 2000))

      const searchQuery = `"${title}" ${year} full movie site:youtube.com/watch`
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`

      const response = await this.makeProxyRequest(searchUrl)

      const youtubeMatch = response.data.match(/youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})/i)
      if (youtubeMatch) {
        const youtubeUrl = `https://www.youtube.com/watch?v=${youtubeMatch[1]}`
        console.log(`[v0] Found YouTube URL: ${youtubeUrl}`)
        return youtubeUrl
      }

      return null
    } catch (error) {
      console.error("YouTube scraping error:", error)
      return null
    }
  }

  private async scrapeGooglePlayContent(title: string, year: number): Promise<string | null> {
    try {
      console.log(`[v0] Scraping Google Play for ${title} (${year})`)

      // Add delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 2500))

      const searchQuery = `"${title}" ${year} site:play.google.com/store/movies/details`
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`

      const response = await this.makeProxyRequest(searchUrl)

      const playMatch = response.data.match(/play\.google\.com\/store\/movies\/details\/([^"'\s?]+)/i)
      if (playMatch) {
        const playUrl = `https://play.google.com/store/movies/details/${playMatch[1]}`
        console.log(`[v0] Found Google Play URL: ${playUrl}`)
        return playUrl
      }

      return null
    } catch (error) {
      console.error("Google Play scraping error:", error)
      return null
    }
  }

  private async scrapeJustWatch(title: string, year: number): Promise<{ streaming: any[]; purchase: any[] }> {
    const result = { streaming: [], purchase: [] }

    try {
      console.log(`[v0] Scraping JustWatch for ${title}`)

      const searchUrl = `https://www.justwatch.com/us/search?q=${encodeURIComponent(title)}`

      const response = await this.makeProxyRequest(searchUrl)

      const $ = cheerio.load(response.data)

      // Look for movie titles and streaming info
      $(".title-list-row").each((i, element) => {
        const movieTitle = $(element).find(".title").text().trim()
        const movieYear = $(element).find(".subtitle").text().match(/\d{4}/)?.[0]

        // Check if this matches our search
        if (movieTitle.toLowerCase().includes(title.toLowerCase()) && (!movieYear || movieYear === year.toString())) {
          // Extract streaming platforms
          $(element)
            .find(".offer")
            .each((j, offer) => {
              const platform = $(offer).find("img").attr("alt") || $(offer).attr("title")
              const link = $(offer).attr("href") || $(offer).find("a").attr("href")

              if (platform && link) {
                const fullLink = link.startsWith("http") ? link : `https://www.justwatch.com${link}`

                // Determine if it's streaming or purchase based on context
                const offerType =
                  $(offer).hasClass("free") || $(offer).hasClass("subscription") ? "subscription" : "buy"

                if (offerType === "subscription") {
                  result.streaming.push({
                    platform: platform,
                    link: fullLink,
                    type: "subscription",
                  })
                } else {
                  result.purchase.push({
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
      console.error("JustWatch scraping error:", error)
    }

    return result
  }

  private async scrapeJustWatchForRegion(
    title: string,
    year: number,
    region: string,
  ): Promise<{ streaming: any[]; purchase: any[] }> {
    const result = { streaming: [], purchase: [] }

    try {
      console.log(`[v0] Scraping JustWatch for ${title} in ${region}`)

      // Map region codes to JustWatch country codes
      const countryMap: { [key: string]: string } = {
        US: "us",
        IN: "in",
        GB: "uk",
        CA: "ca",
        AU: "au",
        DE: "de",
        FR: "fr",
        JP: "jp",
        BR: "br",
        MX: "mx",
      }

      const country = countryMap[region] || "us"
      const searchUrl = `https://www.justwatch.com/${country}/search?q=${encodeURIComponent(title)}`

      const response = await this.makeProxyRequest(searchUrl)

      const $ = cheerio.load(response.data)

      // Look for movie titles and streaming info
      $(".title-list-row").each((i, element) => {
        const movieTitle = $(element).find(".title").text().trim()
        const movieYear = $(element).find(".subtitle").text().match(/\d{4}/)?.[0]

        // Check if this matches our search
        if (movieTitle.toLowerCase().includes(title.toLowerCase()) && (!movieYear || movieYear === year.toString())) {
          // Extract streaming platforms
          $(element)
            .find(".offer")
            .each((j, offer) => {
              const platform = $(offer).find("img").attr("alt") || $(offer).attr("title")
              const link = $(offer).attr("href") || $(offer).find("a").attr("href")

              if (platform && link) {
                const fullLink = link.startsWith("http") ? link : `https://www.justwatch.com${link}`

                // Determine if it's streaming or purchase based on context
                const offerType =
                  $(offer).hasClass("free") || $(offer).hasClass("subscription") ? "subscription" : "buy"

                if (offerType === "subscription") {
                  result.streaming.push({
                    platform: platform,
                    link: fullLink,
                    type: "subscription",
                  })
                } else {
                  result.purchase.push({
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
      console.error(`JustWatch scraping error for ${region}:`, error)
    }

    return result
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
    return []
  }

  private getFallbackPurchasePlatforms(title: string): StreamingPlatform[] {
    return []
  }

  private combineMovieData(
    request: MovieRequest,
    tmdbResult: PromiseSettledResult<any>,
    omdbResult: PromiseSettledResult<any>,
    streamingResult: PromiseSettledResult<any>,
  ): MovieResponse {
    const tmdbData = tmdbResult.status === "fulfilled" ? tmdbResult.value : null
    const omdbData = omdbResult.status === "fulfilled" ? omdbResult.value : null
    const streamingData =
      streamingResult.status === "fulfilled" ? streamingResult.value : { streaming: [], purchase: [] }

    // Generate slug
    const slug = request.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")

    // Combine data from all sources
    const movieResponse: MovieResponse = {
      title: request.title,
      year: request.year,
      slug,
      poster: tmdbData?.details?.poster_path
        ? {
            url: `https://image.tmdb.org/t/p/w500${tmdbData.details.poster_path}`,
            publicId: tmdbData.details.poster_path,
          }
        : undefined,
      rated: omdbData?.Rated || tmdbData?.details?.certification,
      released: tmdbData?.details?.release_date || omdbData?.Released,
      runtime: tmdbData?.details?.runtime || (omdbData?.Runtime ? Number.parseInt(omdbData.Runtime) : undefined),
      genres: tmdbData?.details?.genres?.map((g: any) => g.name) || omdbData?.Genre?.split(", ") || [],
      director:
        tmdbData?.credits?.crew
          ?.filter((c: any) => c.job === "Director")
          .map((d: any) => ({
            name: d.name,
            tmdbId: d.id?.toString(),
          })) ||
        omdbData?.Director?.split(", ").map((name: string) => ({ name })) ||
        [],
      writers:
        tmdbData?.credits?.crew
          ?.filter((c: any) => c.job === "Writer" || c.job === "Screenplay")
          .map((w: any) => ({
            name: w.name,
            tmdbId: w.id?.toString(),
          })) ||
        omdbData?.Writer?.split(", ").map((name: string) => ({ name })) ||
        [],
      cast:
        tmdbData?.credits?.cast?.slice(0, 20).map((c: any) => ({
          person: {
            name: c.name,
            tmdbId: c.id?.toString(),
          },
          character: c.character,
        })) ||
        omdbData?.Actors?.split(", ").map((name: string) => ({
          person: { name },
          character: "",
        })) ||
        [],
      plot: tmdbData?.details?.overview || omdbData?.Plot,
      language:
        tmdbData?.details?.spoken_languages?.map((l: any) => l.english_name) || omdbData?.Language?.split(", ") || [],
      country: tmdbData?.details?.production_countries?.map((c: any) => c.name) || omdbData?.Country?.split(", ") || [],
      ratings: {
        imdb: omdbData?.imdbRating
          ? {
              score: Number.parseFloat(omdbData.imdbRating),
              votes: Number.parseInt(omdbData.imdbVotes?.replace(/,/g, "") || "0"),
            }
          : undefined,
        rottenTomatoes: omdbData?.Ratings?.find((r: any) => r.Source === "Rotten Tomatoes")
          ? {
              score: Number.parseInt(omdbData.Ratings.find((r: any) => r.Source === "Rotten Tomatoes").Value),
            }
          : undefined,
        metacritic: omdbData?.Ratings?.find((r: any) => r.Source === "Metacritic")
          ? {
              score: Number.parseInt(omdbData.Ratings.find((r: any) => r.Source === "Metacritic").Value),
            }
          : undefined,
      },
      boxOffice: {
        budget: tmdbData?.details?.budget ? `$${tmdbData.details.budget.toLocaleString()}` : undefined,
        grossUSA: omdbData?.BoxOffice,
        grossWorldwide: tmdbData?.details?.revenue ? `$${tmdbData.details.revenue.toLocaleString()}` : undefined,
      },
      production: {
        companies:
          tmdbData?.details?.production_companies?.map((c: any) => ({
            name: c.name,
            tmdbId: c.id?.toString(),
          })) || [],
        studios: [],
        distributors: [],
      },
      trailer: tmdbData?.videos?.results?.find((v: any) => v.type === "Trailer")
        ? {
            url: `https://www.youtube.com/watch?v=${tmdbData.videos.results.find((v: any) => v.type === "Trailer").key}`,
            language: tmdbData.videos.results.find((v: any) => v.type === "Trailer").iso_639_1 || "en",
          }
        : undefined,
      availableOn: streamingData,
      references: {
        imdbId: omdbData?.imdbID,
        tmdbId: tmdbData?.details?.id?.toString(),
      },
    }

    return movieResponse
  }

  private isValidContentURL(url: string): boolean {
    if (!url) return false

    const validPatterns = [
      "netflix.com/title/",
      "amazon.com/dp/",
      "amazon.com/gp/video/detail/",
      "watch.amazon.com/detail",
      "app.primevideo.com/detail",
      "hulu.com/movie/",
      "hulu.com/watch/",
      "tv.apple.com/",
      "disneyplus.com/movies/",
      "max.com/movies/",
      "paramountplus.com/movies/",
      "youtube.com/watch?v=",
      "play.google.com/store/movies/details/",
      "lionsgateplay.com/",
      "lionsgate.com/",
      "rakuten.tv/",
      "skystore.com/",
      "cineplex.com/",
      "plex.tv/",
      "fandango.com/",
      "vudu.com/",
      "microsoft.com/",
      "roku.com/",
      "tubi.tv/",
      "crackle.com/",
      "peacocktv.com/",
      "showtime.com/",
      "starz.com/",
      "epix.com/",
      "cinemax.com/",
      "hbomax.com/",
      "discovery.com/",
      "funimation.com/",
      "crunchyroll.com/",
      "athome.fandango.com/",
      "watch.plex.tv/",
    ]

    const lowerUrl = url.toLowerCase()

    const isValidPattern = validPatterns.some((pattern) => lowerUrl.includes(pattern))
    const isSearchUrl =
      lowerUrl.includes("/search") ||
      lowerUrl.includes("?q=") ||
      lowerUrl.includes("search_query=") ||
      lowerUrl.includes("/results?") ||
      lowerUrl.match(/\/(us|in|gb|ca|au|de|fr|jp|br|mx)$/) ||
      // Reject generic Apple TV country homepages but allow specific movie URLs
      (lowerUrl.includes("tv.apple.com") && lowerUrl.match(/\/(us|in|gb|ca|au|de|fr|jp|br|mx)$/))

    if (isValidPattern && !isSearchUrl) {
      console.log(`[v0] Accepting valid content URL: ${url}`)
      return true
    }

    console.log(`[v0] Rejecting invalid URL: ${url}`)
    return false
  }

  // Helper method to identify platform from URL
  private getPlatformFromUrl(url: string): string | null {
    const urlLower = url.toLowerCase()

    if (urlLower.includes("netflix.com")) return "Netflix"
    if (urlLower.includes("amazon.com") || urlLower.includes("primevideo.com")) return "Amazon Prime Video"
    if (urlLower.includes("hulu.com")) return "Hulu"
    if (urlLower.includes("tv.apple.com")) return "Apple TV"
    if (urlLower.includes("disneyplus.com")) return "Disney+"
    if (urlLower.includes("hbomax.com") || urlLower.includes("max.com")) return "HBO Max"
    if (urlLower.includes("paramountplus.com")) return "Paramount+"
    if (urlLower.includes("youtube.com")) return "YouTube"
    if (urlLower.includes("vudu.com")) return "Vudu"
    if (urlLower.includes("play.google.com")) return "Google Play"
    if (urlLower.includes("lionsgateplay.com")) return "Lionsgate Play"
    if (urlLower.includes("lionsgate.com")) return "Lionsgate"
    if (urlLower.includes("rakuten.tv")) return "Rakuten TV"
    if (urlLower.includes("skystore.com")) return "SKY Store"
    if (urlLower.includes("cineplex.com")) return "Cineplex"
    if (urlLower.includes("plex.tv")) return "Plex"
    if (urlLower.includes("fandango.com")) return "Fandango"
    if (urlLower.includes("microsoft.com")) return "Microsoft Store"
    if (urlLower.includes("roku.com")) return "Roku Channel"
    if (urlLower.includes("tubi.tv")) return "Tubi TV"
    if (urlLower.includes("crackle.com")) return "Crackle"
    if (urlLower.includes("peacocktv.com")) return "Peacock"
    if (urlLower.includes("showtime.com")) return "Showtime"
    if (urlLower.includes("starz.com")) return "Starz"
    if (urlLower.includes("epix.com")) return "Epix"
    if (urlLower.includes("cinemax.com")) return "Cinemax"
    if (urlLower.includes("discovery.com")) return "Discovery+"
    if (urlLower.includes("funimation.com")) return "Funimation"
    if (urlLower.includes("crunchyroll.com")) return "Crunchyroll"

    return null
  }

  private async scrapeLionsgatePlayContent(title: string, year: number): Promise<string | null> {
    // Implementation for Lionsgate Play
    return null
  }

  private async scrapeLionsgateContent(title: string, year: number): Promise<string | null> {
    // Implementation for Lionsgate
    return null
  }

  private async scrapeRakutenTVContent(title: string, year: number): Promise<string | null> {
    // Implementation for Rakuten TV
    return null
  }

  private async scrapeSKYStoreContent(title: string, year: number): Promise<string | null> {
    // Implementation for SKY Store
    return null
  }

  private async scrapeCineplexContent(title: string, year: number): Promise<string | null> {
    // Implementation for Cineplex
    return null
  }

  private async scrapePlexContent(title: string, year: number): Promise<string | null> {
    // Implementation for Plex
    return null
  }

  private async scrapeFandangoContent(title: string, year: number): Promise<string | null> {
    // Implementation for Fandango
    return null
  }

  private async scrapeVuduContent(title: string, year: number): Promise<string | null> {
    // Implementation for Vudu
    return null
  }

  private async scrapeMicrosoftStoreContent(title: string, year: number): Promise<string | null> {
    // Implementation for Microsoft Store
    return null
  }

  private async scrapeRokuChannelContent(title: string, year: number): Promise<string | null> {
    // Implementation for Roku Channel
    return null
  }

  private async scrapeTubiTVContent(title: string, year: number): Promise<string | null> {
    // Implementation for Tubi TV
    return null
  }

  private async scrapeCrackleContent(title: string, year: number): Promise<string | null> {
    // Implementation for Crackle
    return null
  }

  private async scrapePeacockContent(title: string, year: number): Promise<string | null> {
    // Implementation for Peacock
    return null
  }

  private async scrapeShowtimeContent(title: string, year: number): Promise<string | null> {
    // Implementation for Showtime
    return null
  }

  private async scrapeStarzContent(title: string, year: number): Promise<string | null> {
    // Implementation for Starz
    return null
  }

  private async scrapeEpixContent(title: string, year: number): Promise<string | null> {
    // Implementation for Epix
    return null
  }

  private async scrapeCinemaxContent(title: string, year: number): Promise<string | null> {
    // Implementation for Cinemax
    return null
  }

  private async scrapeDiscoveryPlusContent(title: string, year: number): Promise<string | null> {
    // Implementation for Discovery+
    return null
  }

  private async scrapeFunimationContent(title: string, year: number): Promise<string | null> {
    // Implementation for Funimation
    return null
  }

  private async scrapeCrunchyrollContent(title: string, year: number): Promise<string | null> {
    // Implementation for Crunchyroll
    return null
  }
}
