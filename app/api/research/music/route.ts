import { type NextRequest, NextResponse } from "next/server"
import { MusicScraper } from "../../../../lib/scrapers/music-scraper"
import type { MusicRequest } from "../../../../lib/types"

export async function POST(request: NextRequest) {
  try {
    const body: MusicRequest = await request.json()

    // Validate required fields
    if (!body.title || !body.artist) {
      return NextResponse.json({ error: "Title and artist are required fields" }, { status: 400 })
    }

    const scraper = new MusicScraper()
    const musicData = await scraper.scrapeMusicData(body)

    return NextResponse.json({
      success: true,
      data: musicData,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("Music research API error:", error)
    return NextResponse.json(
      {
        error: "Failed to research music data",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: "Music Research API",
    description: "POST endpoint for researching comprehensive music data including streaming availability",
    requiredFields: ["title", "artist"],
    optionalFields: ["year", "album", "genre"],
    example: {
      title: "Bohemian Rhapsody",
      artist: "Queen",
      year: 1975,
      album: "A Night at the Opera",
    },
  })
}
