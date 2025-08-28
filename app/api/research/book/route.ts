import { type NextRequest, NextResponse } from "next/server"
import { BookScraper } from "../../../../lib/scrapers/book-scraper"
import type { BookRequest } from "../../../../lib/types"

export async function POST(request: NextRequest) {
  try {
    const body: BookRequest = await request.json()

    // Validate required fields
    if (!body.title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 })
    }

    const scraper = new BookScraper()
    const bookData = await scraper.scrapeBookData(body)

    return NextResponse.json({
      success: true,
      data: bookData,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("Book research API error:", error)
    return NextResponse.json(
      {
        error: "Failed to research book data",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: "Book Research API",
    description: "POST endpoint for researching comprehensive book data including purchase/reading availability",
    requiredFields: ["title"],
    optionalFields: ["author", "year", "isbn", "genre"],
    example: {
      title: "The Great Gatsby",
      author: "F. Scott Fitzgerald",
      year: 1925,
      isbn: "9780743273565",
    },
  })
}
