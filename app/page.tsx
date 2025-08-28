export default function Home() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Content Research Microservice</h1>
          <p className="text-xl text-gray-600 mb-8">
            Deep research and data scraping for movies, series, music, and books
          </p>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-8">
            <h2 className="text-lg font-semibold text-blue-900 mb-2">Service Status</h2>
            <p className="text-blue-700">✅ All endpoints operational</p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-xl font-semibold mb-4 text-gray-900">🎬 Movie Research</h3>
            <p className="text-gray-600 mb-4">
              Comprehensive movie data including cast, ratings, box office, and streaming availability.
            </p>
            <div className="bg-gray-50 rounded p-4 mb-4">
              <code className="text-sm">POST /api/research/movie</code>
            </div>
            <p className="text-sm text-gray-500">Required: title, year | Optional: director, cast, genre</p>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-xl font-semibold mb-4 text-gray-900">📺 Series Research</h3>
            <p className="text-gray-600 mb-4">TV series data with seasons, episodes, cast, and streaming platforms.</p>
            <div className="bg-gray-50 rounded p-4 mb-4">
              <code className="text-sm">POST /api/research/series</code>
            </div>
            <p className="text-sm text-gray-500">Required: title | Optional: year, creator, network, genre</p>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-xl font-semibold mb-4 text-gray-900">🎵 Music Research</h3>
            <p className="text-gray-600 mb-4">Music track data with album info, audio features, and streaming links.</p>
            <div className="bg-gray-50 rounded p-4 mb-4">
              <code className="text-sm">POST /api/research/music</code>
            </div>
            <p className="text-sm text-gray-500">Required: title, artist | Optional: year, album, genre</p>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-xl font-semibold mb-4 text-gray-900">📚 Book Research</h3>
            <p className="text-gray-600 mb-4">Book data with author info, ratings, and purchase/reading platforms.</p>
            <div className="bg-gray-50 rounded p-4 mb-4">
              <code className="text-sm">POST /api/research/book</code>
            </div>
            <p className="text-sm text-gray-500">Required: title | Optional: author, year, isbn, genre</p>
          </div>
        </div>

        <div className="mt-12 bg-white rounded-lg shadow-md p-6">
          <h3 className="text-xl font-semibold mb-4 text-gray-900">🔧 Configuration</h3>
          <p className="text-gray-600 mb-4">
            To enhance data quality, configure these optional API keys as environment variables:
          </p>
          <ul className="list-disc list-inside text-gray-600 space-y-2">
            <li>
              <code className="bg-gray-100 px-2 py-1 rounded">TMDB_API_KEY</code> - The Movie Database API
            </li>
            <li>
              <code className="bg-gray-100 px-2 py-1 rounded">OMDB_API_KEY</code> - Open Movie Database API
            </li>
            <li>
              <code className="bg-gray-100 px-2 py-1 rounded">SPOTIFY_CLIENT_ID</code> &{" "}
              <code className="bg-gray-100 px-2 py-1 rounded">SPOTIFY_CLIENT_SECRET</code> - Spotify Web API
            </li>
            <li>
              <code className="bg-gray-100 px-2 py-1 rounded">GOOGLE_BOOKS_API_KEY</code> - Google Books API
            </li>
          </ul>
          <p className="text-sm text-gray-500 mt-4">
            The service works without these keys but provides enhanced data when configured.
          </p>
        </div>

        <div className="mt-8 text-center">
          <a
            href="/api/health"
            className="inline-block bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Check Service Health
          </a>
        </div>
      </div>
    </div>
  )
}
