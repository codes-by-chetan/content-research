import axios from "axios"
import type { BookRequest, BookResponse, StreamingPlatform } from "../types"

export class BookScraper {
  private readonly GOOGLE_BOOKS_API_KEY = process.env.GOOGLE_BOOKS_API_KEY

  async scrapeBookData(request: BookRequest): Promise<BookResponse> {
    try {
      const [googleBooksData, goodreadsData, availabilityData] = await Promise.allSettled([
        this.getGoogleBooksData(request.title, request.author),
        this.getGoodreadsData(request.title, request.author),
        this.getBookAvailability(request.title, request.author),
      ])

      const bookData = this.combineBookData(request, googleBooksData, goodreadsData, availabilityData)
      return bookData
    } catch (error) {
      console.error("Error scraping book data:", error)
      throw new Error("Failed to scrape book data")
    }
  }

  private async getGoogleBooksData(title: string, author?: string) {
    try {
      const query = author ? `intitle:"${title}" inauthor:"${author}"` : `intitle:"${title}"`
      const url = this.GOOGLE_BOOKS_API_KEY
        ? `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&key=${this.GOOGLE_BOOKS_API_KEY}`
        : `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}`

      const response = await axios.get(url)

      if (response.data.items && response.data.items.length > 0) {
        return response.data.items[0]
      }

      return null
    } catch (error) {
      console.error("Google Books API error:", error)
      return null
    }
  }

  private async getGoodreadsData(title: string, author?: string) {
    try {
      // Note: Goodreads API is deprecated, so this would need web scraping
      // This is a placeholder for the data structure
      const searchQuery = author ? `${title} ${author}` : title

      return {
        searchUrl: `https://www.goodreads.com/search?q=${encodeURIComponent(searchQuery)}`,
        // In a real implementation, you'd scrape the actual ratings and reviews
        rating: null,
        reviews: null,
      }
    } catch (error) {
      console.error("Goodreads scraping error:", error)
      return null
    }
  }

  private async getBookAvailability(
    title: string,
    author?: string,
  ): Promise<{
    ebook: StreamingPlatform[]
    paperback: StreamingPlatform[]
    hardcover: StreamingPlatform[]
    audiobook: StreamingPlatform[]
  }> {
    const searchQuery = author ? `${title} ${author}` : title
    const encodedQuery = encodeURIComponent(searchQuery)

    const ebook: StreamingPlatform[] = [
      { platform: "Amazon Kindle", link: `https://www.amazon.com/s?k=${encodedQuery}&i=digital-text`, type: "buy" },
      { platform: "Apple Books", link: `https://books.apple.com/search?term=${encodedQuery}`, type: "buy" },
      {
        platform: "Google Play Books",
        link: `https://play.google.com/store/search?q=${encodedQuery}&c=books`,
        type: "buy",
      },
      { platform: "Barnes & Noble Nook", link: `https://www.barnesandnoble.com/s/${encodedQuery}`, type: "buy" },
      { platform: "Kobo", link: `https://www.kobo.com/search?query=${encodedQuery}`, type: "buy" },
      {
        platform: "Kindle Unlimited",
        link: `https://www.amazon.com/kindle-unlimited/search?query=${encodedQuery}`,
        type: "subscription",
      },
    ]

    const paperback: StreamingPlatform[] = [
      { platform: "Amazon", link: `https://www.amazon.com/s?k=${encodedQuery}&i=stripbooks`, type: "buy" },
      { platform: "Barnes & Noble", link: `https://www.barnesandnoble.com/s/${encodedQuery}`, type: "buy" },
      {
        platform: "Book Depository",
        link: `https://www.bookdepository.com/search?searchTerm=${encodedQuery}`,
        type: "buy",
      },
      { platform: "Target", link: `https://www.target.com/s?searchTerm=${encodedQuery}&category=5xa0`, type: "buy" },
      { platform: "Walmart", link: `https://www.walmart.com/search?query=${encodedQuery}&cat_id=3920`, type: "buy" },
    ]

    const hardcover: StreamingPlatform[] = [
      {
        platform: "Amazon",
        link: `https://www.amazon.com/s?k=${encodedQuery}&i=stripbooks&rh=n%3A283155%2Cp_n_feature_browse-bin%3A2656022011`,
        type: "buy",
      },
      { platform: "Barnes & Noble", link: `https://www.barnesandnoble.com/s/${encodedQuery}`, type: "buy" },
      {
        platform: "Book Depository",
        link: `https://www.bookdepository.com/search?searchTerm=${encodedQuery}`,
        type: "buy",
      },
    ]

    const audiobook: StreamingPlatform[] = [
      { platform: "Audible", link: `https://www.audible.com/search?keywords=${encodedQuery}`, type: "subscription" },
      { platform: "Spotify", link: `https://open.spotify.com/search/${encodedQuery}`, type: "subscription" },
      { platform: "Apple Books", link: `https://books.apple.com/search?term=${encodedQuery}`, type: "buy" },
      {
        platform: "Google Play Books",
        link: `https://play.google.com/store/search?q=${encodedQuery}&c=books`,
        type: "buy",
      },
      { platform: "Libro.fm", link: `https://libro.fm/search/${encodedQuery}`, type: "buy" },
    ]

    return { ebook, paperback, hardcover, audiobook }
  }

  private combineBookData(
    request: BookRequest,
    googleBooksResult: PromiseSettledResult<any>,
    goodreadsResult: PromiseSettledResult<any>,
    availabilityResult: PromiseSettledResult<any>,
  ): BookResponse {
    const googleBooksData = googleBooksResult.status === "fulfilled" ? googleBooksResult.value : null
    const goodreadsData = goodreadsResult.status === "fulfilled" ? goodreadsResult.value : null
    const availabilityData =
      availabilityResult.status === "fulfilled"
        ? availabilityResult.value
        : {
            ebook: [],
            paperback: [],
            hardcover: [],
            audiobook: [],
          }

    const volumeInfo = googleBooksData?.volumeInfo
    const slug = request.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")

    const bookResponse: BookResponse = {
      title: request.title,
      slug,
      author: request.author
        ? [{ name: request.author }]
        : volumeInfo?.authors?.map((name: string) => ({ name })) || [],
      isbn: request.isbn || volumeInfo?.industryIdentifiers?.find((id: any) => id.type === "ISBN_13")?.identifier,
      publishedYear:
        request.year || (volumeInfo?.publishedDate ? new Date(volumeInfo.publishedDate).getFullYear() : undefined),
      publisher: volumeInfo?.publisher
        ? {
            name: volumeInfo.publisher,
          }
        : undefined,
      genres: volumeInfo?.categories || (request.genre ? [request.genre] : []),
      language: volumeInfo?.language || "en",
      pages: volumeInfo?.pageCount,
      format: ["Paperback", "Hardcover", "Ebook", "Audiobook"],
      description: volumeInfo?.description,
      ratings: {
        googleBooks: volumeInfo?.averageRating
          ? {
              score: volumeInfo.averageRating,
              votes: volumeInfo.ratingsCount || 0,
            }
          : undefined,
      },
      awards: [],
      availableOn: availabilityData,
      references: {
        isbn10: volumeInfo?.industryIdentifiers?.find((id: any) => id.type === "ISBN_10")?.identifier,
        isbn13: volumeInfo?.industryIdentifiers?.find((id: any) => id.type === "ISBN_13")?.identifier,
        googleBooksId: googleBooksData?.id,
      },
    }

    return bookResponse
  }
}
