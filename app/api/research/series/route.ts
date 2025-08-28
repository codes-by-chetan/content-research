import { type NextRequest, NextResponse } from "next/server"
import { SeriesScraper } from "../../../../lib/scrapers/series-scraper"
import type { SeriesRequest } from "../../../../lib/types"

export async function POST(request: NextRequest) {
  try {
    const body: SeriesRequest = await request.json()

    // Validate required fields
    if (!body.title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 })
    }

    const scraper = new SeriesScraper()
    const seriesData = await scraper.scrapeSeriesData(body)

    return NextResponse.json({
      success: true,
      data: seriesData,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("Series research API error:", error)
    return NextResponse.json(
      {
        error: "Failed to research series data",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: "Series Research API",
    description: "POST endpoint for researching comprehensive TV series data including streaming availability",
    requiredFields: ["title"],
    optionalFields: ["year", "creator", "network", "genre"],
    example: {
      title: "Breaking Bad",
      year: 2008,
      creator: "Vince Gilligan",
      network: "AMC",
    },
  })
}
