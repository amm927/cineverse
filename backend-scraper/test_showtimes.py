import unittest
from unittest.mock import patch

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

    @patch.object(main, "_film_affinity_soup")
    def test_parser_extracts_version_and_sale_url(self, mocked_soup):
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


if __name__ == "__main__":
    unittest.main()
