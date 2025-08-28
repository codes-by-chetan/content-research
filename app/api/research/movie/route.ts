import { type NextRequest, NextResponse } from "next/server"
import { MovieScraper } from "../../../../lib/scrapers/movie-scraper"
import type { MovieRequest } from "../../../../lib/types"

export async function POST(request: NextRequest) {
  try {
    const body: MovieRequest = await request.json()

    // Validate required fields
    if (!body.title || !body.year) {
      return NextResponse.json({ error: "Title and year are required fields" }, { status: 400 })
    }

    const scraper = new MovieScraper()
    const movieData = await scraper.scrapeMovieData(body)

    return NextResponse.json({
      success: true,
      data: movieData,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("Movie research API error:", error)
    return NextResponse.json(
      {
        error: "Failed to research movie data",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: "Movie Research API",
    description: "POST endpoint for researching comprehensive movie data including streaming availability",
    requiredFields: ["title", "year"],
    optionalFields: ["director", "cast", "genre"],
    example: {
      title: "The Matrix",
      year: 1999,
      director: "The Wachowskis",
      genre: "Sci-Fi",
    },
  })
}
