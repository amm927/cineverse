import unittest
from unittest.mock import Mock, patch

from bs4 import BeautifulSoup

import main


def theater_html():
    today = main.datetime.now(main.MADRID_TZ).date().isoformat()
    return f"""
<html><body>
  <div class="movie-card">
    <div class="mc-title"><a>Película de prueba</a></div>
    <div class="movie-showtimes-n">
      <div class="mv-title"><span>Película de prueba (Digital VOS)</span></div>
      <div data-sess-date="{today}">
        <div class="sess-times">
          <a href="https://tickets.example/venta">20:30</a>
        </div>
      </div>
    </div>
  </div>
</body></html>
"""


class FilmAffinityShowtimesTests(unittest.TestCase):
    def test_normalize_removes_accents_and_punctuation(self):
        self.assertEqual(main._normalize("Yelmo Cines Torrecárdenas"), "yelmo cines torrecardenas")

    @patch.object(main, "_cache_set")
    @patch.object(main, "_cache_get", return_value=None)
    @patch.object(main, "_film_affinity_soup")
    def test_parser_extracts_version_and_sale_url(self, mocked_soup, _mocked_get, _mocked_set):
        mocked_soup.return_value = BeautifulSoup(theater_html(), "lxml")
        movie = main.ShowtimeMovie(
            id=1,
            titulo="Película de prueba",
            titulo_original="Test movie",
            fecha_estreno="2099-06-11",
            duracion=100,
        )

        result = main._parse_fa_showtimes("https://example.test/cinema", movie, 3)

        self.assertEqual(len(result["horarios"]), 1)
        self.assertEqual(result["horarios"][0]["version"], "Digital VOS")
        self.assertEqual(result["horarios"][0]["compra_url"], "https://tickets.example/venta")

    @patch.object(main, "_film_affinity_soup")
    def test_theater_catalog_is_reused_for_multiple_movie_filters(self, mocked_soup):
        cache = {}

        def cache_get(key):
            return cache.get(key)

        def cache_set(key, value, _ttl):
            cache[key] = value

        mocked_soup.return_value = BeautifulSoup(theater_html(), "lxml")
        movie = main.ShowtimeMovie(id=1, titulo="Película de prueba")

        with patch.object(main, "_cache_get", side_effect=cache_get), patch.object(
            main, "_cache_set", side_effect=cache_set
        ):
            first = main._parse_fa_showtimes(
                "https://www.filmaffinity.com/es/theater-showtimes.php?id=test",
                movie,
                3,
            )
            second = main._parse_fa_showtimes(
                "https://www.filmaffinity.com/es/theater-showtimes.php?id=test",
                movie,
                3,
            )

        self.assertEqual(len(first["horarios"]), 1)
        self.assertEqual(first, second)
        mocked_soup.assert_called_once()


class TmdbCacheTests(unittest.TestCase):
    def setUp(self):
        self.cache = {}

    def cache_get(self, key):
        return self.cache.get(key)

    def cache_set(self, key, value, _ttl):
        self.cache[key] = value

    @patch.object(main, "_has_credentials", return_value=True)
    @patch.object(main.requests, "get")
    def test_trending_catalog_reuses_cache(self, mocked_get, _mocked_credentials):
        response = Mock(status_code=200)
        response.json.return_value = {
            "results": [
                {
                    "id": movie_id,
                    "title": f"Película {movie_id}",
                    "overview": "Sinopsis",
                    "vote_average": 7.5,
                    "genre_ids": [18],
                }
                for movie_id in range(1, 6)
            ]
        }
        mocked_get.return_value = response

        with patch.object(main, "_cache_get", side_effect=self.cache_get), patch.object(
            main, "_cache_set", side_effect=self.cache_set
        ):
            first = main._fetch_trending_movies(pages=1)
            second = main._fetch_trending_movies(pages=1)

        self.assertEqual(first, second)
        self.assertEqual(len(first), 5)
        mocked_get.assert_called_once()

    @patch.object(main.requests, "get")
    def test_movie_detail_reuses_cache(self, mocked_get):
        response = Mock(status_code=200)
        response.json.return_value = {"id": 42, "runtime": 123}
        mocked_get.return_value = response

        with patch.object(main, "_cache_get", side_effect=self.cache_get), patch.object(
            main, "_cache_set", side_effect=self.cache_set
        ):
            first = main._fetch_tmdb_movie_detail(42, {}, {})
            second = main._fetch_tmdb_movie_detail(42, {}, {})

        self.assertEqual(first["runtime"], 123)
        self.assertEqual(first, second)
        mocked_get.assert_called_once()


if __name__ == "__main__":
    unittest.main()
