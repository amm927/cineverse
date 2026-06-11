"""
CineVerse Scraper Microservice
==============================
Servicio independiente de scraping y NLP.
Expone endpoints REST limpios para ser consumidos internamente por el API Gateway (cineverse-api).

Endpoints:
  GET /health                             → Healthcheck del servicio
  GET /scrape/trending?pages=5            → Películas populares de TMDB
  GET /scrape/reviews?tmdb_id={id}        → Críticas reales de TMDB + NLP
  GET /scrape/news?title={title}          → Noticias de Google News RSS + NLP
  GET /scrape/sentiment?text={text}       → Polaridad NLP atómica de un texto
"""

import os
import json
import re
import threading
import time
import unicodedata
import urllib.parse
from datetime import date, datetime, timedelta
from typing import List, Optional
from zoneinfo import ZoneInfo

import requests
import redis
from bs4 import BeautifulSoup
from fastapi import FastAPI, Query, HTTPException
from pydantic import BaseModel
from rapidfuzz import fuzz
from textblob import TextBlob

# ---------------------------------------------------------------------------
# Configuración TMDB
# ---------------------------------------------------------------------------
TMDB_API_KEY = os.environ.get("TMDB_API_KEY", "")
TMDB_READ_ACCESS_TOKEN = os.environ.get("TMDB_READ_ACCESS_TOKEN", "")
MADRID_TZ = ZoneInfo("Europe/Madrid")
REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")
FA_REQUEST_INTERVAL_SECONDS = 2.0
FA_DIRECTORY_TTL_SECONDS = 86400
FA_THEATER_TTL_SECONDS = 43200
FA_STALE_TTL_SECONDS = 172800
TMDB_CATALOG_TTL_SECONDS = 21600
TMDB_DETAIL_TTL_SECONDS = 86400
TMDB_REVIEWS_TTL_SECONDS = 86400
TMDB_STALE_TTL_SECONDS = 604800
_fa_request_lock = threading.Lock()
_fa_last_request_at = 0.0

try:
    redis_client = redis.Redis.from_url(REDIS_URL, decode_responses=True)
    redis_client.ping()
except Exception as exc:
    print(f"[Scraper] Redis no disponible; caché ética solo en memoria: {exc}")
    redis_client = None

_memory_cache = {}


def _cache_get(key: str):
    if redis_client:
        try:
            value = redis_client.get(key)
            return json.loads(value) if value else None
        except Exception as exc:
            print(f"[Scraper] Error leyendo caché {key}: {exc}")
    cached = _memory_cache.get(key)
    if cached and cached["expires_at"] > time.time():
        return cached["value"]
    return None


def _cache_set(key: str, value, ttl: int):
    if redis_client:
        try:
            redis_client.setex(key, ttl, json.dumps(value))
            return
        except Exception as exc:
            print(f"[Scraper] Error guardando caché {key}: {exc}")
    _memory_cache[key] = {"value": value, "expires_at": time.time() + ttl}


def _tmdb_cache_get(cache_key: str):
    cached = _cache_get(cache_key)
    if cached is not None:
        print(f"[TMDB] Cache HIT: {cache_key}")
        return cached
    print(f"[TMDB] Cache MISS: {cache_key}")
    return None


def _tmdb_cache_store(cache_key: str, value, ttl: int):
    _cache_set(cache_key, value, ttl)
    _cache_set(f"{cache_key}:stale", value, TMDB_STALE_TTL_SECONDS)
    print(f"[TMDB] Cache STORE: {cache_key}")


def _tmdb_stale_or(cache_key: str, fallback):
    stale = _cache_get(f"{cache_key}:stale")
    if stale is not None:
        print(f"[TMDB] Using stale cache: {cache_key}")
        return stale
    return fallback

# ---------------------------------------------------------------------------
# Mapeo de Géneros de TMDB
# ---------------------------------------------------------------------------
TMDB_GENRES = {
    28: "Acción",
    12: "Aventura",
    16: "Animación",
    35: "Comedia",
    80: "Crimen",
    99: "Documental",
    18: "Drama",
    10751: "Familia",
    14: "Fantasía",
    36: "Historia",
    27: "Terror",
    10402: "Música",
    9648: "Misterio",
    10749: "Romance",
    878: "Ciencia ficción",
    10770: "Película de TV",
    53: "Suspense",
    10752: "Bélica",
    37: "Western",
    10759: "Acción y Aventura",
    10762: "Kids",
    10763: "News",
    10764: "Reality",
    10765: "Sci-Fi y Fantasía",
    10766: "Soap",
    10767: "Talk",
    10768: "War & Politics"
}

# ---------------------------------------------------------------------------
# Catálogo de respaldo local (5 clásicos) para cuando TMDB no está disponible
# ---------------------------------------------------------------------------
FALLBACK_MOVIES = [
    {
        "id": 27205,
        "titulo": "Origen (Inception)",
        "sinopsis": "Un ladrón que roba secretos corporativos a través del uso de la tecnología de compartir sueños es tentado con una última misión para redimirse.",
        "poster_url": "https://image.tmdb.org/t/p/w500/tXQvtRWfkUUnWJAn2tN3jERIUG.jpg",
        "backdrop_url": "https://image.tmdb.org/t/p/original/8ZTVqvKDQ8emSGUEMjsS4yHAwrp.jpg",
        "rating": 8.3,
        "genero": "Ciencia ficción",
    },
    {
        "id": 157336,
        "titulo": "Interstellar",
        "sinopsis": "Un equipo de exploradores viaja a través de un agujero de gusano en el espacio en un intento de asegurar la supervivencia de la humanidad.",
        "poster_url": "https://image.tmdb.org/t/p/w500/9cTfZWP5TfdnmAjiD6ZBXWIJ7O9.jpg",
        "backdrop_url": "https://image.tmdb.org/t/p/original/2ssWTSVklAEc98frZUQhgtGHx7s.jpg",
        "rating": 8.4,
        "genero": "Ciencia ficción",
    },
    {
        "id": 155,
        "titulo": "El Caballero Oscuro (The Dark Knight)",
        "sinopsis": "Con la ayuda del teniente de policía Jim Gordon y el fiscal del distrito Harvey Dent, Batman se propone destruir el crimen organizado en Gotham.",
        "poster_url": "https://image.tmdb.org/t/p/w500/8QDQExnfNFOtabLDKqfDQuHDsIg.jpg",
        "backdrop_url": "https://image.tmdb.org/t/p/original/cfT29Im5VDvjE0RpyKOSdCKZal7.jpg",
        "rating": 8.5,
        "genero": "Acción",
    },
    {
        "id": 278,
        "titulo": "Cadena perpetua",
        "sinopsis": "Dos hombres encarcelados se unen durante varios años, encontrando consuelo y eventual redención a través de actos de decencia común.",
        "poster_url": "https://image.tmdb.org/t/p/w500/uRRTV7p6l2ivtODWJVVAMRrwTn2.jpg",
        "backdrop_url": "https://image.tmdb.org/t/p/original/dqK15n4vKmedxKIGEF6Y14R86OI.jpg",
        "rating": 8.7,
        "genero": "Drama",
    },
    {
        "id": 13,
        "titulo": "Forrest Gump",
        "sinopsis": "La vida de Forrest Gump, un hombre con un coeficiente intelectual bajo, que deforma y influye en algunos de los momentos clave del siglo XX en los Estados Unidos.",
        "poster_url": "https://image.tmdb.org/t/p/w500/azV6hV99lYkdhydsQbJCI6FqMl4.jpg",
        "backdrop_url": "https://image.tmdb.org/t/p/original/66Kn4XWhkuPkJxOJyPEx4U2CUfN.jpg",
        "rating": 8.8,
        "genero": "Drama",
    },
]

FALLBACK_TV = [
    {
        "id": 1396,
        "titulo": "Breaking Bad",
        "sinopsis": "Un profesor de química con cáncer terminal se asocia con un exalumno para fabricar y vender metanfetamina.",
        "poster_url": "https://image.tmdb.org/t/p/w500/ztkUQFLlC19CCMYHW9o1zWhJRNq.jpg",
        "backdrop_url": "https://image.tmdb.org/t/p/original/tsRy63Mu5cu8etL1X7ZLyf7UP1M.jpg",
        "rating": 8.9,
        "genero": "Drama",
    },
    {
        "id": 1399,
        "titulo": "Juego de Tronos (Game of Thrones)",
        "sinopsis": "Nueve familias nobles luchan por el control de las tierras míticas de Poniente.",
        "poster_url": "https://image.tmdb.org/t/p/w500/3hDtRuwTfQQYRst3kjhvp4Cogjw.jpg",
        "backdrop_url": "https://image.tmdb.org/t/p/original/2OMB0ynKlyIenMJWI2Dy9IWT4c.jpg",
        "rating": 8.4,
        "genero": "Fantasía",
    },
    {
        "id": 66732,
        "titulo": "Stranger Things",
        "sinopsis": "Cuando un niño desaparece, una ciudad descubre un misterio que involucra experimentos secretos.",
        "poster_url": "https://image.tmdb.org/t/p/w500/1sRJ8D1vpXE5WQBGrUBky3uUwvX.jpg",
        "backdrop_url": "https://image.tmdb.org/t/p/original/56v2KjBlU4XaOv9rVYEQypROD7P.jpg",
        "rating": 8.6,
        "genero": "Fantasía",
    },
    {
        "id": 87108,
        "titulo": "Chernobyl",
        "sinopsis": "La historia del desaxial desastre nuclear de 1986, una de las peores catástrofes provocadas por el hombre.",
        "poster_url": "https://image.tmdb.org/t/p/w500/hlLXt2tOPT6RRnjiUmoxyG1LTFi.jpg",
        "backdrop_url": "https://image.tmdb.org/t/p/original/3URK0z9PzpVNJrGE7XOuyy6KFzk.jpg",
        "rating": 8.6,
        "genero": "Drama",
    },
    {
        "id": 60625,
        "titulo": "Rick y Morty (Rick and Morty)",
        "sinopsis": "Un científico brillante pero alcohólico secuestra a su irritable nieto para vivir aventuras intergalácticas.",
        "poster_url": "https://image.tmdb.org/t/p/w500/5Yiep9EwcQgLolg013ETBVqHxuD.jpg",
        "backdrop_url": "https://image.tmdb.org/t/p/original/9In9QgVJx7PlFOAgVHCKKSbo605.jpg",
        "rating": 9.2,
        "genero": "Animación",
    },
]

# ---------------------------------------------------------------------------
# Helpers TMDB — construir headers/params según el tipo de credencial disponible
# ---------------------------------------------------------------------------

def _tmdb_auth() -> tuple[dict, dict]:
    """Devuelve (headers, params) con la autenticación TMDB adecuada."""
    headers: dict = {}
    params: dict = {}
    if TMDB_READ_ACCESS_TOKEN:
        headers["Authorization"] = f"Bearer {TMDB_READ_ACCESS_TOKEN}"
    elif TMDB_API_KEY:
        params["api_key"] = TMDB_API_KEY
    return headers, params


def _has_credentials() -> bool:
    return bool(TMDB_API_KEY or TMDB_READ_ACCESS_TOKEN)

# ---------------------------------------------------------------------------
# Lógica de scraping (migrada desde backend/app/scraper.py)
# ---------------------------------------------------------------------------

def _analyze_sentiment(text: str) -> float:
    """Calcula la polaridad NLP en el rango [-1.0, 1.0] usando TextBlob."""
    try:
        return float(TextBlob(text).sentiment.polarity)
    except Exception:
        return 0.0


def _fetch_trending_movies(pages: int = 5) -> List[dict]:
    """Obtiene hasta `pages` × 20 películas populares de TMDB."""
    if not _has_credentials():
        print("[Scraper] Sin credenciales TMDB — devolviendo catálogo de respaldo.")
        return FALLBACK_MOVIES

    cache_key = f"tmdb:catalog:v1:movie:popular:es-ES:{pages}"
    cached = _tmdb_cache_get(cache_key)
    if cached is not None:
        return cached

    movies: list = []
    titles_seen: set = set()
    headers, base_params = _tmdb_auth()

    for page in range(1, pages + 1):
        try:
            params = {**base_params, "language": "es-ES", "page": page}
            resp = requests.get(
                "https://api.themoviedb.org/3/movie/popular",
                params=params,
                headers=headers,
                timeout=10,
            )
            if resp.status_code != 200:
                print(f"[Scraper] TMDB popular page {page} → HTTP {resp.status_code}")
                continue

            for item in resp.json().get("results", []):
                titulo = item.get("title") or item.get("original_title")
                tmdb_id = item.get("id")
                if not titulo or not tmdb_id or titulo in titles_seen:
                    continue
                titles_seen.add(titulo)
                genre_ids = item.get("genre_ids", [])
                genero = TMDB_GENRES.get(genre_ids[0], "Otro") if genre_ids else "Otro"
                poster_path = item.get("poster_path")
                backdrop_path = item.get("backdrop_path")
                movies.append(
                    {
                        "id": tmdb_id,
                        "titulo": titulo,
                        "sinopsis": item.get("overview") or "Sin sinopsis disponible en español.",
                        "poster_url": f"https://image.tmdb.org/t/p/w500{poster_path}" if poster_path else None,
                        "backdrop_url": f"https://image.tmdb.org/t/p/original{backdrop_path}" if backdrop_path else None,
                        "rating": round(item.get("vote_average", 0.0), 1),
                        "genero": genero
                    }
                )
        except Exception as e:
            print(f"[Scraper] Error al scrapear página {page}: {e}")

    if len(movies) >= 5:
        print(f"[Scraper] {len(movies)} películas obtenidas de TMDB.")
        _tmdb_cache_store(cache_key, movies, TMDB_CATALOG_TTL_SECONDS)
        return movies

    print("[Scraper] Pocos resultados — usando caché anterior o catálogo de respaldo.")
    return _tmdb_stale_or(cache_key, FALLBACK_MOVIES)


def _fetch_upcoming_movies() -> List[dict]:
    """Obtiene películas en estreno (now_playing) y que van a salir pronto (upcoming) de TMDB."""
    if not _has_credentials():
        print("[Scraper] Sin credenciales TMDB — devolviendo catálogo de respaldo.")
        return FALLBACK_MOVIES

    cache_key = "tmdb:catalog:v1:movie:upcoming-combined:es-ES:1"
    cached = _tmdb_cache_get(cache_key)
    if cached is not None:
        return cached

    movies: list = []
    titles_seen: set = set()
    headers, base_params = _tmdb_auth()

    # Consultar now_playing y upcoming
    endpoints = [
        "https://api.themoviedb.org/3/movie/now_playing",
        "https://api.themoviedb.org/3/movie/upcoming"
    ]

    for url in endpoints:
        try:
            params = {**base_params, "language": "es-ES", "page": 1}
            resp = requests.get(url, params=params, headers=headers, timeout=10)
            if resp.status_code != 200:
                print(f"[Scraper] TMDB endpoint {url} → HTTP {resp.status_code}")
                continue

            for item in resp.json().get("results", []):
                titulo = item.get("title") or item.get("original_title")
                tmdb_id = item.get("id")
                if not titulo or not tmdb_id or titulo in titles_seen:
                    continue
                titles_seen.add(titulo)
                genre_ids = item.get("genre_ids", [])
                genero = TMDB_GENRES.get(genre_ids[0], "Otro") if genre_ids else "Otro"
                poster_path = item.get("poster_path")
                backdrop_path = item.get("backdrop_path")
                movies.append(
                    {
                        "id": tmdb_id,
                        "titulo": titulo,
                        "sinopsis": item.get("overview") or "Sin sinopsis disponible en español.",
                        "poster_url": f"https://image.tmdb.org/t/p/w500{poster_path}" if poster_path else None,
                        "backdrop_url": f"https://image.tmdb.org/t/p/original{backdrop_path}" if backdrop_path else None,
                        "rating": round(item.get("vote_average", 0.0), 1),
                        "genero": genero
                    }
                )
        except Exception as e:
            print(f"[Scraper] Error al obtener de {url}: {e}")

    if len(movies) >= 5:
        print(f"[Scraper] {len(movies)} películas en cartelera/próximas obtenidas de TMDB.")
        _tmdb_cache_store(cache_key, movies, TMDB_CATALOG_TTL_SECONDS)
        return movies

    print("[Scraper] Pocos resultados para estrenos — usando caché anterior o respaldo.")
    return _tmdb_stale_or(cache_key, FALLBACK_MOVIES)


def _fetch_tmdb_movie_detail(movie_id: int, headers: dict, base_params: dict) -> dict:
    cache_key = f"tmdb:detail:v1:movie:{movie_id}:es-ES"
    cached = _tmdb_cache_get(cache_key)
    if cached is not None:
        return cached

    try:
        response = requests.get(
            f"https://api.themoviedb.org/3/movie/{movie_id}",
            params={**base_params, "language": "es-ES"},
            headers=headers,
            timeout=8,
        )
        response.raise_for_status()
        detail = response.json()
        _tmdb_cache_store(cache_key, detail, TMDB_DETAIL_TTL_SECONDS)
        return detail
    except Exception:
        return _tmdb_stale_or(cache_key, {})


def _fetch_cinema_category(category: str, pages: int = 2) -> List[dict]:
    if not _has_credentials():
        return []

    cache_key = f"tmdb:cinema:v1:{category}:ES:es-ES:{pages}"
    cached = _tmdb_cache_get(cache_key)
    if cached is not None:
        return cached

    headers, base_params = _tmdb_auth()
    movies: list = []
    seen: set = set()
    for page in range(1, pages + 1):
        params = {
            **base_params,
            "language": "es-ES",
            "region": "ES",
            "page": page,
        }
        try:
            response = requests.get(
                f"https://api.themoviedb.org/3/movie/{category}",
                params=params,
                headers=headers,
                timeout=10,
            )
            response.raise_for_status()
        except Exception:
            stale = _tmdb_stale_or(cache_key, None)
            if stale is not None:
                return stale
            raise
        for item in response.json().get("results", []):
            movie_id = item.get("id")
            if not movie_id or movie_id in seen:
                continue
            seen.add(movie_id)
            detail_data = _fetch_tmdb_movie_detail(movie_id, headers, base_params)
            genre_ids = item.get("genre_ids", [])
            poster_path = item.get("poster_path")
            backdrop_path = item.get("backdrop_path")
            movies.append({
                "id": movie_id,
                "titulo": item.get("title") or item.get("original_title"),
                "titulo_original": item.get("original_title"),
                "sinopsis": item.get("overview") or "Sin sinopsis disponible en español.",
                "poster_url": f"https://image.tmdb.org/t/p/w500{poster_path}" if poster_path else None,
                "backdrop_url": f"https://image.tmdb.org/t/p/original{backdrop_path}" if backdrop_path else None,
                "rating": round(item.get("vote_average", 0.0), 1),
                "genero": TMDB_GENRES.get(genre_ids[0], "Otro") if genre_ids else "Otro",
                "fecha_estreno": item.get("release_date"),
                "duracion": detail_data.get("runtime"),
            })
    if movies:
        _tmdb_cache_store(cache_key, movies, TMDB_CATALOG_TTL_SECONDS)
        return movies
    return _tmdb_stale_or(cache_key, [])


def _normalize(value: str) -> str:
    value = unicodedata.normalize("NFKD", value or "")
    value = "".join(char for char in value if not unicodedata.combining(char))
    value = re.sub(r"\([^)]*\)", " ", value.lower())
    return re.sub(r"[^a-z0-9]+", " ", value).strip()


class ShowtimeMovie(BaseModel):
    id: int
    titulo: str
    titulo_original: Optional[str] = None
    fecha_estreno: Optional[str] = None
    duracion: Optional[int] = None


class ShowtimeCinema(BaseModel):
    nombre: str


class ShowtimeRequest(BaseModel):
    movie: ShowtimeMovie
    province_code: str
    cinemas: List[ShowtimeCinema]
    days: int = 3


def _film_affinity_soup(url: str) -> BeautifulSoup:
    global _fa_last_request_at
    with _fa_request_lock:
        elapsed = time.monotonic() - _fa_last_request_at
        if elapsed < FA_REQUEST_INTERVAL_SECONDS:
            time.sleep(FA_REQUEST_INTERVAL_SECONDS - elapsed)
        response = requests.get(
            url,
            headers={
                "User-Agent": "CineVerse university project/1.0",
                "Accept-Language": "es-ES,es;q=0.9",
            },
            timeout=12,
        )
        _fa_last_request_at = time.monotonic()
    response.raise_for_status()
    return BeautifulSoup(response.text, "lxml")


def _resolve_fa_cinemas(province_code: str, cinema_names: List[str]) -> dict:
    cache_key = f"fa:directory:v1:{province_code}"
    stale_key = f"{cache_key}:stale"
    candidates = _cache_get(cache_key)
    if candidates is not None:
        print(f"[FilmAffinity] Directory cache HIT: {province_code}")
    if candidates is None:
        try:
            print(f"[FilmAffinity] Directory cache MISS: {province_code}")
            soup = _film_affinity_soup(
                f"https://www.filmaffinity.com/es/theaters.php?state={province_code}"
            )
            candidates = []
            seen_urls = set()
            for link in soup.select('a[href*="theater-showtimes.php?id="]'):
                name = link.get_text(" ", strip=True)
                href = urllib.parse.urljoin("https://www.filmaffinity.com", link.get("href"))
                if name and href and href not in seen_urls:
                    candidates.append({"name": name, "url": href})
                    seen_urls.add(href)
            _cache_set(cache_key, candidates, FA_DIRECTORY_TTL_SECONDS)
            _cache_set(stale_key, candidates, FA_STALE_TTL_SECONDS)
        except Exception:
            candidates = _cache_get(stale_key)
            if candidates is None:
                raise
            print(f"[FilmAffinity] Using stale directory cache: {province_code}")

    resolved = {}
    for requested_name in cinema_names:
        scores = sorted(
            (
                (
                    fuzz.token_set_ratio(_normalize(requested_name), _normalize(candidate["name"])),
                    candidate["name"],
                    candidate["url"],
                )
                for candidate in candidates
            ),
            reverse=True,
        )
        if scores and scores[0][0] >= 70:
            second_score = scores[1][0] if len(scores) > 1 else 0
            if scores[0][0] - second_score >= 8 or scores[0][0] >= 90:
                resolved[requested_name] = {
                    "matched_name": scores[0][1],
                    "cartelera_url": scores[0][2],
                }
    return resolved


def _movie_matches(candidate: dict, movie: ShowtimeMovie) -> bool:
    requested = [movie.titulo, movie.titulo_original or ""]
    title_score = max(
        fuzz.token_set_ratio(_normalize(candidate.get("titulo", "")), _normalize(value))
        for value in requested if value
    )
    if title_score < 88:
        return False
    if title_score >= 96:
        return True

    release_year = (movie.fecha_estreno or "")[:4]
    card_year = candidate.get("anio") or ""
    if release_year and card_year and release_year != card_year:
        return False

    runtime = candidate.get("duracion")
    if movie.duracion and runtime:
        if abs(movie.duracion - runtime) > 20:
            return False
    return True


def _parse_fa_theater_catalog_from_soup(soup: BeautifulSoup, url: str) -> dict:
    movies = []
    official_link = soup.select_one(
        'a[href^="http"][title*="web" i], a[href^="http"][class*="official" i]'
    )
    for showtimes in soup.select(".movie-showtimes-n"):
        card = showtimes.find_parent(class_=re.compile(r"\bmovie-card\b")) or showtimes.parent
        title_node = card.select_one(".mc-title a, .movie-card .mc-title a")
        display_node = showtimes.select_one(".mv-title > span, .mv-title")
        title = title_node.get_text(" ", strip=True) if title_node else ""
        display_title = display_node.get_text(" ", strip=True) if display_node else ""
        candidate_title = title or display_title
        year_node = card.select_one(".mc-year")
        runtime_node = card.select_one(".runtime")
        runtime_match = re.search(r"(\d+)", runtime_node.get_text(" ", strip=True)) if runtime_node else None
        title_text = showtimes.select_one(".mv-title > span, .mv-title")
        version_match = re.search(r"\(([^()]*)\)\s*$", title_text.get_text(" ", strip=True)) if title_text else None
        version = version_match.group(1) if version_match else "Estándar"
        sessions = []
        for row in showtimes.select("[data-sess-date]"):
            session_date = row.get("data-sess-date")
            if not session_date:
                continue
            for link in row.select(".sess-times a[href]"):
                hour = link.get_text(" ", strip=True)
                if re.fullmatch(r"\d{1,2}:\d{2}", hour):
                    sessions.append({
                        "fecha": session_date,
                        "hora": hour,
                        "version": version,
                        "compra_url": urllib.parse.urljoin(url, link.get("href")),
                        "fuente": "FilmAffinity",
                    })
        movies.append({
            "titulo": candidate_title,
            "anio": year_node.get_text(" ", strip=True) if year_node else None,
            "duracion": int(runtime_match.group(1)) if runtime_match else None,
            "version": version,
            "horarios": sessions,
        })
    return {
        "peliculas": movies,
        "web_oficial_url": official_link.get("href") if official_link else None,
        "actualizado_en": datetime.now(MADRID_TZ).isoformat(),
    }


def _get_fa_theater_catalog(url: str) -> dict:
    theater_id = urllib.parse.parse_qs(urllib.parse.urlparse(url).query).get("id", ["unknown"])[0]
    cache_key = f"fa:theater:v2:{theater_id}"
    stale_key = f"{cache_key}:stale"
    catalog = _cache_get(cache_key)
    if catalog is not None:
        print(f"[FilmAffinity] Theater cache HIT: {theater_id}")
        return catalog
    try:
        print(f"[FilmAffinity] Theater cache MISS: {theater_id}")
        catalog = _parse_fa_theater_catalog_from_soup(_film_affinity_soup(url), url)
        _cache_set(cache_key, catalog, FA_THEATER_TTL_SECONDS)
        _cache_set(stale_key, catalog, FA_STALE_TTL_SECONDS)
        return catalog
    except Exception:
        stale = _cache_get(stale_key)
        if stale is not None:
            stale["stale"] = True
            print(f"[FilmAffinity] Using stale theater cache: {theater_id}")
            return stale
        raise


def _parse_fa_showtimes(url: str, movie: ShowtimeMovie, days: int) -> dict:
    catalog = _get_fa_theater_catalog(url)
    today = datetime.now(MADRID_TZ).date()
    last_day = today + timedelta(days=max(1, days) - 1)
    sessions = []
    for candidate in catalog.get("peliculas", []):
        if not _movie_matches(candidate, movie):
            continue
        for session in candidate.get("horarios", []):
            try:
                parsed_date = datetime.strptime(session["fecha"], "%Y-%m-%d").date()
            except (KeyError, TypeError, ValueError):
                continue
            if today <= parsed_date <= last_day:
                sessions.append(session)
    return {
        "horarios": sessions,
        "web_oficial_url": catalog.get("web_oficial_url"),
        "actualizado_en": catalog.get("actualizado_en"),
        "stale": catalog.get("stale", False),
    }


def _fetch_tmdb_reviews(tmdb_id: int, media_type: str = "movie") -> List[dict]:
    """Obtiene hasta 3 críticas reales de TMDB + análisis NLP de sentimiento."""
    if not _has_credentials():
        return []

    cache_key = f"tmdb:reviews:v1:{media_type}:{tmdb_id}:en-US"
    cached = _tmdb_cache_get(cache_key)
    if cached is not None:
        return cached

    headers, base_params = _tmdb_auth()
    params = {**base_params, "language": "en-US"}

    try:
        resp = requests.get(
            f"https://api.themoviedb.org/3/{media_type}/{tmdb_id}/reviews",
            params=params,
            headers=headers,
            timeout=5,
        )
        if resp.status_code != 200:
            return _tmdb_stale_or(cache_key, [])

        criticas = []
        for item in resp.json().get("results", [])[:3]:
            content = item.get("content", "")
            if len(content) > 350:
                content = content[:350] + "..."

            polarity = _analyze_sentiment(content)
            label = "Positivo" if polarity > 0.15 else ("Negativo" if polarity < -0.15 else "Neutral")
            percentage = int((polarity + 1) * 50)

            criticas.append(
                {
                    "texto": f"{item.get('author', 'Crítico')}: {content}",
                    "sentimiento": f"{percentage}% {label}",
                    "polaridad": round(polarity, 4),
                }
            )
        _tmdb_cache_store(cache_key, criticas, TMDB_REVIEWS_TTL_SECONDS)
        return criticas
    except Exception as e:
        print(f"[Scraper] Error al obtener críticas TMDB para {tmdb_id}: {e}")
        return _tmdb_stale_or(cache_key, [])


def _scrape_news(titulo: str) -> List[dict]:
    """Scrapea Google News RSS y devuelve hasta 3 noticias con análisis NLP."""
    query = urllib.parse.quote(f"{titulo} película")
    url = f"https://news.google.com/rss/search?q={query}&hl=es&gl=ES&ceid=ES:es"

    try:
        resp = requests.get(url, timeout=5)
        if resp.status_code == 200:
            soup = BeautifulSoup(resp.content, "xml")
            noticias = []
            for item in soup.find_all("item")[:3]:
                title_text = item.title.text if item.title else "Noticia reciente"
                source = item.source.text if item.source else "Prensa"
                polarity = _analyze_sentiment(title_text)
                label = "Positivo" if polarity > 0.05 else ("Negativo" if polarity < -0.05 else "Neutral")
                percentage = int((polarity + 1) * 50)
                noticias.append(
                    {
                        "texto": f"Prensa ({source}): {title_text}",
                        "sentimiento": f"{percentage}% {label}",
                        "polaridad": round(polarity, 4),
                    }
                )
            if noticias:
                return noticias
    except Exception as e:
        print(f"[Scraper] Error al buscar noticias para '{titulo}': {e}")

    # Fallback local
    fallback_text = f"Prensa local: Todo listo para el visionado especial de la aclamada película {titulo}."
    polarity = _analyze_sentiment(fallback_text)
    return [
        {
            "texto": fallback_text,
            "sentimiento": f"{int((polarity + 1) * 50)}% Positivo",
            "polaridad": round(polarity, 4),
        }
    ]

# ---------------------------------------------------------------------------
# FastAPI Application
# ---------------------------------------------------------------------------

app = FastAPI(
    title="CineVerse Scraper Service",
    description="Microservicio independiente de scraping TMDB + Google News + NLP. Solo para uso interno de la red Docker.",
    version="1.0.0",
)


@app.get("/health")
def health():
    """Healthcheck del servicio."""
    return {
        "status": "ok",
        "service": "cineverse-scraper-service",
        "tmdb_credentials": _has_credentials(),
    }


@app.get("/scrape/trending")
def scrape_trending(pages: int = Query(default=5, ge=1, le=10)):
    """
    Devuelve una lista de películas populares de TMDB.
    - pages: número de páginas a solicitar (20 películas/página, máx 10).
    """
    movies = _fetch_trending_movies(pages=pages)
    return {"count": len(movies), "movies": movies}


@app.get("/scrape/reviews")
def scrape_reviews(
    tmdb_id: int = Query(..., description="ID real de TMDB de la película o serie"),
    tipo: str = Query(default="pelicula", description="Tipo de medio: pelicula o serie")
):
    """
    Devuelve hasta 3 críticas reales de TMDB para la película o serie indicada,
    enriquecidas con análisis de sentimiento NLP (TextBlob).
    """
    media_type = "movie" if tipo == "pelicula" else "tv"
    reviews = _fetch_tmdb_reviews(tmdb_id=tmdb_id, media_type=media_type)
    return {"tmdb_id": tmdb_id, "count": len(reviews), "reviews": reviews}


@app.get("/scrape/news")
def scrape_news(title: str = Query(..., description="Título de la película o serie a buscar en Google News")):
    """
    Scrapea Google News RSS buscando noticias de la película o serie.
    Retorna hasta 3 artículos con polaridad NLP.
    """
    news = _scrape_news(titulo=title)
    return {"title": title, "count": len(news), "news": news}


@app.get("/scrape/sentiment")
def scrape_sentiment(text: str = Query(..., description="Texto a analizar")):
    """
    Calcula la polaridad NLP exacta de un fragmento de texto en el rango [-1.0, 1.0].
    Útil para recalcular opiniones ya guardadas en la DB.
    """
    polarity = _analyze_sentiment(text)
    label = "Positivo" if polarity > 0.15 else ("Negativo" if polarity < -0.15 else "Neutral")
    return {
        "polarity": round(polarity, 4),
        "label": label,
        "percentage": int((polarity + 1) * 50),
    }

@app.get("/scrape/upcoming")
def scrape_upcoming():
    """
    Devuelve películas en estreno (now playing) y que saldrán pronto (upcoming) de TMDB.
    """
    movies = _fetch_upcoming_movies()
    return {"count": len(movies), "movies": movies}


@app.get("/scrape/cinema-catalog")
def scrape_cinema_catalog():
    try:
        now_playing = _fetch_cinema_category("now_playing")
        upcoming = _fetch_cinema_category("upcoming")
        return {
            "now_playing": now_playing,
            "upcoming": upcoming,
            "updated_at": datetime.now(MADRID_TZ).isoformat(),
        }
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"TMDB no disponible: {exc}")


@app.post("/scrape/showtimes")
def scrape_showtimes(payload: ShowtimeRequest):
    try:
        resolved = _resolve_fa_cinemas(
            payload.province_code,
            [cinema.nombre for cinema in payload.cinemas],
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"FilmAffinity no disponible: {exc}")

    results = []
    catalog_timestamps = []
    for cinema in payload.cinemas:
        match = resolved.get(cinema.nombre)
        if not match:
            results.append({
                "nombre": cinema.nombre,
                "horarios": [],
                "cartelera_url": None,
                "web_oficial_url": None,
                "sesiones_estado": "cinema_unmatched",
            })
            continue
        try:
            parsed = _parse_fa_showtimes(
                match["cartelera_url"],
                payload.movie,
                payload.days,
            )
            sessions = parsed["horarios"]
            if parsed.get("actualizado_en"):
                catalog_timestamps.append(parsed["actualizado_en"])
            results.append({
                "nombre": cinema.nombre,
                "horarios": sessions,
                "cartelera_url": match["cartelera_url"],
                "web_oficial_url": parsed["web_oficial_url"],
                "sesiones_estado": "available" if sessions else "no_sessions",
            })
        except Exception as exc:
            print(f"[Scraper] FilmAffinity error for {cinema.nombre}: {exc}")
            results.append({
                "nombre": cinema.nombre,
                "horarios": [],
                "cartelera_url": match["cartelera_url"],
                "web_oficial_url": None,
                "sesiones_estado": "source_unavailable",
            })
    return {
        "cinemas": results,
        "updated_at": min(catalog_timestamps) if catalog_timestamps else datetime.now(MADRID_TZ).isoformat(),
    }


def _fetch_tmdb_catalog(media_type: str, category: str, pages: int = 2) -> List[dict]:
    """
    Obtiene títulos de TMDB para cualquier combinación de tipo de medio (movie/tv)
    y categoría (popular/top_rated/upcoming/now_playing).
    """
    if not _has_credentials():
        print(f"[Scraper] Sin credenciales TMDB — usando catálogo de respaldo para {media_type}:{category}.")
        if media_type == "tv":
            return FALLBACK_TV
        return FALLBACK_MOVIES

    cache_key = f"tmdb:catalog:v1:{media_type}:{category}:es-ES:{pages}"
    cached = _tmdb_cache_get(cache_key)
    if cached is not None:
        return cached

    items_list: list = []
    titles_seen: set = set()
    headers, base_params = _tmdb_auth()

    for page in range(1, pages + 1):
        try:
            params = {**base_params, "language": "es-ES", "page": page}
            url = f"https://api.themoviedb.org/3/{media_type}/{category}"
            resp = requests.get(url, params=params, headers=headers, timeout=10)
            if resp.status_code != 200:
                print(f"[Scraper] TMDB {media_type}/{category} page {page} → HTTP {resp.status_code}")
                continue

            results = resp.json().get("results", [])
            for item in results:
                # Las series usan "name" y "original_name", las películas usan "title" y "original_title"
                titulo = item.get("title") or item.get("name") or item.get("original_title") or item.get("original_name")
                tmdb_id = item.get("id")
                if not titulo or not tmdb_id or titulo in titles_seen:
                    continue
                titles_seen.add(titulo)
                genre_ids = item.get("genre_ids", [])
                genero = TMDB_GENRES.get(genre_ids[0], "Otro") if genre_ids else "Otro"
                poster_path = item.get("poster_path")
                backdrop_path = item.get("backdrop_path")
                items_list.append(
                    {
                        "id": tmdb_id,
                        "titulo": titulo,
                        "sinopsis": item.get("overview") or "Sin sinopsis disponible en español.",
                        "poster_url": f"https://image.tmdb.org/t/p/w500{poster_path}" if poster_path else None,
                        "backdrop_url": f"https://image.tmdb.org/t/p/original{backdrop_path}" if backdrop_path else None,
                        "rating": round(item.get("vote_average", 0.0), 1),
                        "genero": genero
                    }
                )
        except Exception as e:
            print(f"[Scraper] Error al obtener de {media_type}/{category} página {page}: {e}")

    if items_list:
        _tmdb_cache_store(cache_key, items_list, TMDB_CATALOG_TTL_SECONDS)
        return items_list
    fallback = FALLBACK_TV if media_type == "tv" else FALLBACK_MOVIES
    return _tmdb_stale_or(cache_key, fallback)


@app.get("/scrape/tv/popular")
def scrape_tv_popular(pages: int = Query(default=2, ge=1, le=5)):
    """Obtiene series de televisión populares de TMDB."""
    series = _fetch_tmdb_catalog(media_type="tv", category="popular", pages=pages)
    return {"count": len(series), "series": series}


@app.get("/scrape/tv/top-rated")
def scrape_tv_top_rated(pages: int = Query(default=2, ge=1, le=5)):
    """Obtiene series de televisión mejor valoradas de TMDB."""
    series = _fetch_tmdb_catalog(media_type="tv", category="top_rated", pages=pages)
    return {"count": len(series), "series": series}


@app.get("/scrape/movie/top-rated")
def scrape_movie_top_rated(pages: int = Query(default=2, ge=1, le=5)):
    """Obtiene películas mejor valoradas de TMDB."""
    movies = _fetch_tmdb_catalog(media_type="movie", category="top_rated", pages=pages)
    return {"count": len(movies), "movies": movies}
