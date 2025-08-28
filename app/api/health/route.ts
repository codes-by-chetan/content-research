import { NextResponse } from "next/server"

export async function GET() {
  return NextResponse.json({
    status: "healthy",
    service: "Content Research Microservice",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    endpoints: {
      movie: "/api/research/movie",
      series: "/api/research/series",
      music: "/api/research/music",
      book: "/api/research/book",
    },
    description:
      "Microservice for deep research and data scraping of movies, series, music, and books with streaming/availability focus",
  })
}
