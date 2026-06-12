import os
import httpx
import redis
import json
import time
from datetime import datetime, date, timedelta
from functools import wraps
from typing import List, Dict, Optional
from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect, Request, Response, status, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from sqlalchemy.orm import Session
import sqlalchemy
from pydantic import BaseModel

from app.database import (
    SessionLocal, init_db, Pelicula, ComentarioScrapeado,
    Usuario, Sala, SalaMiembro, Decision, HistorialMatch, SystemLog, PushSubscription, engine,
    Serie, ComentarioSerie, DecisionSerie, HistorialMatchSerie, Pareja, VistasPareja, VistasUsuario
)
from app.auth import (
    get_password_hash, verify_password, create_access_token, get_current_user,
    get_optional_current_user, get_current_admin
)
from app.calendar_helper import generate_ics_content, schedule_google_calendar_event

try:
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False
    print("[WARN] scikit-learn no está instalado. El recomendador usará fallback por rating.")


# ---------------------------------------------------------------------------
# Web Push / VAPID Setup
# ---------------------------------------------------------------------------
try:
    from pywebpush import webpush, WebPushException
    WEBPUSH_AVAILABLE = True
except ImportError:
    WEBPUSH_AVAILABLE = False
    print("[PUSH] pywebpush no disponible. Las notificaciones push están desactivadas.")

VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "")
VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "")
VAPID_SUBJECT = os.environ.get("VAPID_SUBJECT", "mailto:admin@cineverse.app")

def send_push_notification(subscription_info: dict, title: str, body: str, icon: str = "/pwa-192x192.png", data: dict = None):
    """
    Envía una notificación push nativa usando el protocolo Web Push con VAPID.
    subscription_info debe tener: {endpoint, keys: {p256dh, auth}}
    """
    if not WEBPUSH_AVAILABLE or not VAPID_PRIVATE_KEY:
        print("[PUSH] pywebpush o claves VAPID no configuradas. Notificación no enviada.")
        return False
    try:
        payload = json.dumps({
            "title": title,
            "body": body,
            "icon": icon,
            "data": data or {}
        })
        webpush(
            subscription_info=subscription_info,
            data=payload,
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims={"sub": VAPID_SUBJECT}
        )
        return True
    except WebPushException as ex:
        print(f"[PUSH] Error al enviar notificación push: {ex}")
        # Si el endpoint no es válido (410 Gone), deberíamos eliminarlo
        if ex.response and ex.response.status_code in [404, 410]:
            return "expired"
        return False
    except Exception as ex:
        print(f"[PUSH] Error inesperado: {ex}")
        return False

# ---------------------------------------------------------------------------
# Scraper Microservice Client
# ---------------------------------------------------------------------------
SCRAPER_SERVICE_URL = os.environ.get("SCRAPER_SERVICE_URL", "http://backend-scraper:8001")

def _call_scraper(path: str, params: dict = None) -> dict:
    """
    Realiza una petición GET al microservicio de scraping.
    Retorna el JSON de la respuesta o un dict vacío en caso de error (robustez RAD).
    """
    url = f"{SCRAPER_SERVICE_URL}/{path.lstrip('/')}"
    try:
        with httpx.Client(timeout=60.0) as client:
            resp = client.get(url, params=params or {})
            resp.raise_for_status()
            return resp.json()
    except Exception as e:
        print(f"[API] Error al llamar al scraper service ({url}): {e}")
        return {}

def _post_scraper(path: str, payload: dict) -> dict:
    url = f"{SCRAPER_SERVICE_URL}/{path.lstrip('/')}"
    try:
        with httpx.Client(timeout=45.0) as client:
            resp = client.post(url, json=payload)
            resp.raise_for_status()
            return resp.json()
    except Exception as e:
        print(f"[API] Error al llamar al scraper service ({url}): {e}")
        return {}

# ---------------------------------------------------------------------------
# Redis Caching Setup
# ---------------------------------------------------------------------------
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
redis_client = redis.Redis.from_url(REDIS_URL, decode_responses=True)
try:
    redis_client.ping()
    print(f"[REDIS] Conectado exitosamente a Redis en {REDIS_URL}")
except Exception as e:
    print(f"[REDIS] Advertencia: No se pudo conectar a Redis en {REDIS_URL} ({e}). Funcionando sin caché.")

app = FastAPI(
    title="CineVerse AI API Gateway",
    description="Backend principal con soporte para cuentas permanentes, salas de amigos y telemetría.",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Crear directorio de static si no existe
os.makedirs("static/avatars", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

# ---------------------------------------------------------------------------
# Middleware de Telemetría SRE
# ---------------------------------------------------------------------------
class TelemetryMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if (
            "upgrade" in request.headers.get("connection", "").lower()
            or path.startswith("/ws")
            or path == "/api/admin/telemetry"
        ):
            return await call_next(request)

        start_time = time.time()
        error_message = None
        status_code = 500
        
        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        except Exception as e:
            import traceback
            error_message = f"{str(e)}\n{traceback.format_exc()}"
            raise e
        finally:
            process_time = time.time() - start_time
            db = SessionLocal()
            try:
                log_rec = SystemLog(
                    timestamp=datetime.utcnow().isoformat(),
                    path=path,
                    method=request.method,
                    status_code=status_code,
                    response_time=round(process_time, 4),
                    client_ip=request.client.host if request.client else None,
                    error_message=error_message
                )
                db.add(log_rec)
                db.commit()
            except Exception as db_err:
                print(f"[Telemetry Middleware DB Error] {db_err}")
            finally:
                db.close()

app.add_middleware(TelemetryMiddleware)

@app.on_event("startup")
def startup_event():
    init_db()
    admin_email = os.environ.get("ADMIN_EMAIL", "").strip().lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "")
    admin_name = os.environ.get("ADMIN_NAME", "Administrador CineVerse").strip()
    if not admin_email or not admin_password:
        print("[ADMIN] Credenciales no configuradas; no se crea el usuario administrador.")
        return

    db = SessionLocal()
    try:
        admin = db.query(Usuario).filter(Usuario.email == admin_email).first()
        if not admin:
            admin = Usuario(
                name=admin_name,
                email=admin_email,
                hashed_password=get_password_hash(admin_password),
                role="admin"
            )
            db.add(admin)
        else:
            admin.role = "admin"
        db.commit()
    finally:
        db.close()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ---------------------------------------------------------------------------
# Pydantic Schemas
# ---------------------------------------------------------------------------
class ComentarioBase(BaseModel):
    id: int
    texto: str
    sentimiento: str

    class Config:
        from_attributes = True

class PeliculaBase(BaseModel):
    id: int
    titulo: str
    sinopsis: str | None = None
    poster_url: str | None = None
    backdrop_url: str | None = None
    rating: float | None = None
    tipo: str = "pelicula"
    genero: str | None = None
    titulo_original: str | None = None
    fecha_estreno: str | None = None
    duracion: int | None = None
    en_cartelera: bool = False
    proximo_estreno: bool = False

    class Config:
        from_attributes = True

class PeliculaDetalle(PeliculaBase):
    comentarios: List[ComentarioBase] = []

class SerieBase(BaseModel):
    id: int
    titulo: str
    sinopsis: str | None = None
    poster_url: str | None = None
    backdrop_url: str | None = None
    rating: float | None = None
    tipo: str = "serie"
    genero: str | None = None

    class Config:
        from_attributes = True

class SerieDetalle(SerieBase):
    comentarios: List[ComentarioBase] = []

class WatchedRequest(BaseModel):
    pareja_id: int
    contenido_id: int
    tipo: str # 'MOVIE' o 'SERIE'

class UserWatchedRequest(BaseModel):
    usuario_id: int
    contenido_id: int
    tipo: str # 'MOVIE' o 'SERIE'
    para_pareja: bool = False

# Auth Schemas
class UserRegisterRequest(BaseModel):
    name: str
    email: str
    password: str

class UserLoginRequest(BaseModel):
    email: str
    password: str

class GoogleLoginRequest(BaseModel):
    name: str
    email: str
    google_id: str
    avatar_url: str | None = None

class PartnerRequest(BaseModel):
    email: str

class CreateRoomRequest(BaseModel):
    tipo: str = "grupo_amigos" # "pareja" o "grupo_amigos"
    categoria: str = "peliculas" # "peliculas" o "series"

class JoinRoomRequest(BaseModel):
    sala_codigo: str

class UpdateProfileRequest(BaseModel):
    name: Optional[str] = None
    avatar_url: Optional[str] = None
    password: Optional[str] = None

class RoomVoteRequest(BaseModel):
    sala_codigo: str
    pelicula_id: int | None = None
    serie_id: int | None = None
    voto: str

class PushSubscribeRequest(BaseModel):
    endpoint: str
    p256dh: str
    auth: str

class ScheduleRequest(BaseModel):
    pelicula_titulo: str
    fecha_iso: str
    google_token: str | None = None
    sala_codigo: str | None = None

# ---- CACHE DECORATOR ----
def cache_movie_detail(ttl: int = 3600):
    """
    Decorador para almacenar en caché el detalle de una película en Redis.
    """
    def decorator(func):
        @wraps(func)
        def wrapper(movie_id: int, *args, **kwargs):
            cache_key = f"movie:detail:{movie_id}"
            try:
                cached_data = redis_client.get(cache_key)
                if cached_data:
                    print(f"[REDIS] Cache HIT para {cache_key}")
                    return Response(content=cached_data, media_type="application/json")
                print(f"[REDIS] Cache MISS para {cache_key}")
            except Exception as e:
                print(f"[REDIS] Error al leer de Redis para {cache_key}: {e}")

            # Ejecutar el endpoint original
            pelicula = func(movie_id, *args, **kwargs)

            # Guardar en caché si se obtuvo con éxito
            try:
                detail_json = PeliculaDetalle.model_validate(pelicula).model_dump_json()
                redis_client.setex(cache_key, ttl, detail_json)
                print(f"[REDIS] Cache STORE para {cache_key}")
            except Exception as e:
                print(f"[REDIS] Error al guardar en Redis para {cache_key}: {e}")

            return pelicula
        return wrapper
    return decorator


# ---------------------------------------------------------------------------
# Endpoints de Películas (CineVerse Catalog)
# ---------------------------------------------------------------------------
@app.get("/api/movies", response_model=List[PeliculaBase])
def get_movies(
    refresh: bool = False,
    current_user: Optional[Usuario] = Depends(get_optional_current_user),
    db: Session = Depends(get_db)
):
    if refresh:
        if not current_user or current_user.role != "admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="El scraping manual está reservado a usuarios administradores."
            )
        print("[API] Solicitud de refresco. Limpiando catálogo de base de datos...")
        db.query(ComentarioScrapeado).delete()
        db.query(Pelicula).delete()
        db.commit()
        
        # Invalidar la caché de Redis para todas las películas
        try:
            keys = redis_client.keys("movie:detail:*")
            if keys:
                redis_client.delete(*keys)
                print(f"[REDIS] Caché invalidada para {len(keys)} películas debido a solicitud de refresco.")
            redis_client.delete("cinema:catalog:v1")
        except Exception as e:
            print(f"[REDIS] Error al invalidar la caché durante el refresco: {e}")
            
    peliculas = db.query(Pelicula).all()
    
    if not peliculas:
        print("[API] Base de datos vacía. Iniciando scraping automático de tendencias...")
        result = _call_scraper("/scrape/trending", {"pages": 5})
        trending = result.get("movies", [])
        
        for m in trending:
            db_pelicula = Pelicula(
                id=m["id"],
                titulo=m["titulo"],
                sinopsis=m["sinopsis"],
                poster_url=m["poster_url"],
                backdrop_url=m["backdrop_url"],
                rating=m["rating"],
                genero=m.get("genero")
            )
            db.add(db_pelicula)
            
        db.commit()
        peliculas = db.query(Pelicula).all()
        
    return peliculas

def _upsert_cinema_movie(db: Session, item: dict, now_playing: bool, upcoming: bool):
    movie = db.query(Pelicula).filter(Pelicula.id == item["id"]).first()
    if not movie:
        movie = Pelicula(id=item["id"], titulo=item["titulo"])
        db.add(movie)
    movie.titulo = item.get("titulo") or movie.titulo
    movie.titulo_original = item.get("titulo_original")
    movie.sinopsis = item.get("sinopsis")
    movie.poster_url = item.get("poster_url")
    movie.backdrop_url = item.get("backdrop_url")
    movie.rating = item.get("rating")
    movie.genero = item.get("genero")
    movie.fecha_estreno = item.get("fecha_estreno")
    movie.duracion = item.get("duracion")
    movie.en_cartelera = now_playing
    movie.proximo_estreno = upcoming
    return movie

@app.get("/api/movies/cinema")
def get_cinema_catalog(
    refresh: bool = False,
    current_user: Optional[Usuario] = Depends(get_optional_current_user),
    db: Session = Depends(get_db)
):
    if refresh and (not current_user or current_user.role != "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="El scraping manual está reservado a usuarios administradores."
        )
    cache_key = "cinema:catalog:v1"
    if not refresh:
        try:
            cached = redis_client.get(cache_key)
            if cached:
                return json.loads(cached)
        except Exception as e:
            print(f"[REDIS] Error leyendo {cache_key}: {e}")

    result = _call_scraper("/scrape/cinema-catalog")
    if not result.get("now_playing") and not result.get("upcoming"):
        now_movies = db.query(Pelicula).filter(Pelicula.en_cartelera.is_(True)).all()
        upcoming_movies = db.query(Pelicula).filter(Pelicula.proximo_estreno.is_(True)).all()
        return {
            "now_playing": [PeliculaBase.model_validate(movie).model_dump() for movie in now_movies],
            "upcoming": [PeliculaBase.model_validate(movie).model_dump() for movie in upcoming_movies],
            "updated_at": datetime.now().astimezone().isoformat(),
        }

    db.query(Pelicula).update({
        Pelicula.en_cartelera: False,
        Pelicula.proximo_estreno: False,
    }, synchronize_session=False)

    now_ids = {item["id"] for item in result.get("now_playing", [])}
    upcoming_ids = {item["id"] for item in result.get("upcoming", [])}
    all_items = {}
    for item in result.get("upcoming", []):
        all_items[item["id"]] = item
    for item in result.get("now_playing", []):
        all_items[item["id"]] = item

    for movie_id, item in all_items.items():
        _upsert_cinema_movie(
            db,
            item,
            now_playing=movie_id in now_ids,
            upcoming=movie_id in upcoming_ids,
        )
    db.commit()

    now_movies = db.query(Pelicula).filter(Pelicula.en_cartelera.is_(True)).all()
    upcoming_movies = db.query(Pelicula).filter(Pelicula.proximo_estreno.is_(True)).all()
    payload = {
        "now_playing": [PeliculaBase.model_validate(movie).model_dump() for movie in now_movies],
        "upcoming": [PeliculaBase.model_validate(movie).model_dump() for movie in upcoming_movies],
        "updated_at": result.get("updated_at") or datetime.now().astimezone().isoformat(),
    }
    try:
        redis_client.setex(cache_key, 21600, json.dumps(payload))
    except Exception as e:
        print(f"[REDIS] Error guardando {cache_key}: {e}")
    return payload

@app.get("/api/movies/{movie_id}", response_model=PeliculaDetalle)
@cache_movie_detail(ttl=3600)
def get_movie_detail(movie_id: int, db: Session = Depends(get_db)):
    pelicula = db.query(Pelicula).filter(Pelicula.id == movie_id).first()
    if not pelicula:
        raise HTTPException(status_code=404, detail="Película no encontrada")
        
    # Lazy Loading: Carga bajo demanda de críticas reales y noticias scraped en directo
    if not pelicula.comentarios:
        print(f"[API] Cargando críticas y noticias bajo demanda para: {pelicula.titulo}...")
        
        # 1. Obtener críticas reales de TMDB
        result = _call_scraper("/scrape/reviews", {"tmdb_id": movie_id})
        criticas_reales = result.get("reviews", [])
        for c in criticas_reales:
            db_comentario = ComentarioScrapeado(
                pelicula_id=pelicula.id,
                texto=c["texto"],
                sentimiento=c["sentimiento"],
                polaridad=c.get("polaridad", 0.0)
            )
            db.add(db_comentario)
            
        # 2. Obtener noticias reales
        result_news = _call_scraper("/scrape/news", {"title": pelicula.titulo})
        noticias_reales = result_news.get("news", [])
        for n in noticias_reales:
            db_comentario = ComentarioScrapeado(
                pelicula_id=pelicula.id,
                texto=n["texto"],
                sentimiento=n["sentimiento"],
                polaridad=n.get("polaridad", 0.0)
            )
            db.add(db_comentario)
            
        db.commit()
        db.refresh(pelicula)
        
    return pelicula

@app.get("/api/analytics/{movie_id}")
def get_movie_analytics(movie_id: int, db: Session = Depends(get_db)):
    pelicula = db.query(Pelicula).filter(Pelicula.id == movie_id).first()
    if not pelicula:
        raise HTTPException(status_code=404, detail="Película no encontrada")
        
    if not pelicula.comentarios:
        # Forzar carga bajo demanda
        get_movie_detail(movie_id=movie_id, db=db)
        db.refresh(pelicula)

    comentarios = pelicula.comentarios
    polaridades = [c.polaridad for c in comentarios if c.polaridad is not None]
    
    if comentarios and not polaridades:
        for c in comentarios:
            result = _call_scraper("/scrape/sentiment", {"text": c.texto})
            c.polaridad = result.get("polarity", 0.0)
        db.commit()
        polaridades = [c.polaridad for c in comentarios]

    n = len(polaridades)
    if n > 0:
        mean_sentiment = sum(polaridades) / n
        variance = sum((x - mean_sentiment) ** 2 for x in polaridades) / n
        moving_averages = []
        for i in range(n):
            window = polaridades[max(0, i - 1): i + 1]
            moving_averages.append(round(sum(window) / len(window), 3))
    else:
        mean_sentiment = 0.0
        variance = 0.0
        moving_averages = []

    rating = pelicula.rating or 0.0
    if rating >= 8.0 and mean_sentiment > 0.25:
        hype_class = "Aclamación Crítica 🔥"
        hype_desc = "La crítica especializada y el público coinciden en que es una obra maestra imprescindible."
    elif rating >= 7.0 and mean_sentiment > 0.1:
        hype_class = "Hype Elevado 🚀"
        hype_desc = "Gran recepción general con opiniones muy favorables en medios digitales."
    elif variance > 0.12:
        hype_class = "Opinión Dividida ⚡"
        hype_desc = "Amada por unos, odiada por otros. Genera encendidos debates en internet."
    elif mean_sentiment < -0.05:
        hype_class = "Decepción Colectiva 📉"
        hype_desc = "Las expectativas eran altas pero la recepción del público ha sido mayoritariamente fría."
    else:
        hype_class = "Expectativa Moderada 🍿"
        hype_desc = "Genera un interés estándar. Ideal para pasar el rato en una tarde lluviosa."

    return {
        "movie_id": movie_id,
        "titulo": pelicula.titulo,
        "rating": rating,
        "num_opiniones": n,
        "media_sentimiento": round(mean_sentiment, 3),
        "varianza": round(variance, 3),
        "hype_class": hype_class,
        "hype_desc": hype_desc,
        "opiniones_polaridad": [round(p, 3) for p in polaridades],
        "media_movil": moving_averages,
        "comentarios_recientes": [
            {
                "texto": c.texto[:120] + "..." if len(c.texto) > 120 else c.texto,
                "sentimiento": c.sentimiento,
                "polaridad": round(c.polaridad, 3)
            }
            for c in comentarios[:6]
        ]
    }


# ---- CACHE DECORATOR FOR SERIES ----
def cache_serie_detail(ttl: int = 3600):
    """
    Decorador para almacenar en caché el detalle de una serie en Redis.
    """
    def decorator(func):
        @wraps(func)
        def wrapper(serie_id: int, *args, **kwargs):
            cache_key = f"serie:detail:{serie_id}"
            try:
                cached_data = redis_client.get(cache_key)
                if cached_data:
                    print(f"[REDIS] Cache HIT para {cache_key}")
                    return Response(content=cached_data, media_type="application/json")
                print(f"[REDIS] Cache MISS para {cache_key}")
            except Exception as e:
                print(f"[REDIS] Error al leer de Redis para {cache_key}: {e}")

            # Ejecutar el endpoint original
            serie = func(serie_id, *args, **kwargs)

            # Guardar en caché si se obtuvo con éxito
            try:
                detail_json = SerieDetalle.model_validate(serie).model_dump_json()
                redis_client.setex(cache_key, ttl, detail_json)
                print(f"[REDIS] Cache STORE para {cache_key}")
            except Exception as e:
                print(f"[REDIS] Error al guardar en Redis para {cache_key}: {e}")

            return serie
        return wrapper
    return decorator


# ---------------------------------------------------------------------------
# Endpoints de Series (CineVerse Catalog)
# ---------------------------------------------------------------------------
@app.get("/api/series", response_model=List[SerieBase])
def get_series(
    refresh: bool = False,
    current_user: Optional[Usuario] = Depends(get_optional_current_user),
    db: Session = Depends(get_db)
):
    if refresh:
        if not current_user or current_user.role != "admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="El scraping manual está reservado a usuarios administradores."
            )
        print("[API] Solicitud de refresco de series. Limpiando catálogo de base de datos...")
        db.query(ComentarioSerie).delete()
        db.query(Serie).delete()
        db.commit()
        
        # Invalidar la caché de Redis para todas las series
        try:
            keys = redis_client.keys("serie:detail:*")
            if keys:
                redis_client.delete(*keys)
                print(f"[REDIS] Caché invalidada para {len(keys)} series debido a solicitud de refresco.")
        except Exception as e:
            print(f"[REDIS] Error al invalidar la caché de series durante el refresco: {e}")
            
    series = db.query(Serie).all()
    
    if not series:
        print("[API] Base de datos de series vacía. Iniciando scraping automático de series populares...")
        # Obtener series populares
        result_popular = _call_scraper("/scrape/tv/popular", {"pages": 2})
        popular_list = result_popular.get("series", [])
        
        # Obtener series mejor valoradas
        result_top = _call_scraper("/scrape/tv/top-rated", {"pages": 2})
        top_list = result_top.get("series", [])
        
        # Unir listas evitando duplicados
        series_seen = set()
        all_series = []
        for s in popular_list + top_list:
            if s["id"] not in series_seen:
                series_seen.add(s["id"])
                all_series.append(s)
                
        for s in all_series:
            db_serie = Serie(
                id=s["id"],
                titulo=s["titulo"],
                sinopsis=s["sinopsis"],
                poster_url=s["poster_url"],
                backdrop_url=s["backdrop_url"],
                rating=s["rating"],
                genero=s.get("genero")
            )
            db.add(db_serie)
            
        db.commit()
        series = db.query(Serie).all()
        
    return series

@app.get("/api/series/{serie_id}", response_model=SerieDetalle)
@cache_serie_detail(ttl=3600)
def get_serie_detail(serie_id: int, db: Session = Depends(get_db)):
    serie = db.query(Serie).filter(Serie.id == serie_id).first()
    if not serie:
        raise HTTPException(status_code=404, detail="Serie no encontrada")
        
    # Lazy Loading: Carga bajo demanda de críticas reales y noticias scraped en directo
    if not serie.comentarios:
        print(f"[API] Cargando críticas y noticias bajo demanda para la serie: {serie.titulo}...")
        
        # 1. Obtener críticas reales de TMDB
        result = _call_scraper("/scrape/reviews", {"tmdb_id": serie_id, "tipo": "serie"})
        criticas_reales = result.get("reviews", [])
        for c in criticas_reales:
            db_comentario = ComentarioSerie(
                serie_id=serie.id,
                texto=c["texto"],
                sentimiento=c["sentimiento"],
                polaridad=c.get("polaridad", 0.0)
            )
            db.add(db_comentario)
            
        # 2. Obtener noticias reales
        result_news = _call_scraper("/scrape/news", {"title": serie.titulo})
        noticias_reales = result_news.get("news", [])
        for n in noticias_reales:
            db_comentario = ComentarioSerie(
                serie_id=serie.id,
                texto=n["texto"],
                sentimiento=n["sentimiento"],
                polaridad=n.get("polaridad", 0.0)
            )
            db.add(db_comentario)
            
        db.commit()
        db.refresh(serie)
        
    return serie

@app.get("/api/analytics/series/{serie_id}")
def get_serie_analytics(serie_id: int, db: Session = Depends(get_db)):
    serie = db.query(Serie).filter(Serie.id == serie_id).first()
    if not serie:
        raise HTTPException(status_code=404, detail="Serie no encontrada")
        
    if not serie.comentarios:
        # Forzar carga bajo demanda
        get_serie_detail(serie_id=serie_id, db=db)
        db.refresh(serie)

    comentarios = serie.comentarios
    polaridades = [c.polaridad for c in comentarios if c.polaridad is not None]
    
    if comentarios and not polaridades:
        for c in comentarios:
            result = _call_scraper("/scrape/sentiment", {"text": c.texto})
            c.polaridad = result.get("polarity", 0.0)
        db.commit()
        polaridades = [c.polaridad for c in comentarios]

    n = len(polaridades)
    if n > 0:
        mean_sentiment = sum(polaridades) / n
        variance = sum((x - mean_sentiment) ** 2 for x in polaridades) / n
        moving_averages = []
        for i in range(n):
            window = polaridades[max(0, i - 1): i + 1]
            moving_averages.append(round(sum(window) / len(window), 3))
    else:
        mean_sentiment = 0.0
        variance = 0.0
        moving_averages = []

    rating = serie.rating or 0.0
    if rating >= 8.0 and mean_sentiment > 0.25:
        hype_class = "Aclamación Crítica 🔥"
        hype_desc = "La crítica especializada y el público coinciden en que es una obra maestra imprescindible."
    elif rating >= 7.0 and mean_sentiment > 0.1:
        hype_class = "Hype Elevado 🚀"
        hype_desc = "Gran recepción general con opiniones muy favorables en medios digitales."
    elif variance > 0.12:
        hype_class = "Opinión Dividida ⚡"
        hype_desc = "Amada por unos, odiada por otros. Genera encendidos debates en internet."
    elif mean_sentiment < -0.05:
        hype_class = "Decepción Colectiva 📉"
        hype_desc = "Las expectativas eran altas pero la recepción del público ha sido mayoritariamente fría."
    else:
        hype_class = "Expectativa Moderada 🍿"
        hype_desc = "Genera un interés estándar. Ideal para pasar el rato en una tarde lluviosa."

    return {
        "movie_id": serie_id,
        "titulo": serie.titulo,
        "rating": rating,
        "num_opiniones": n,
        "media_sentimiento": round(mean_sentiment, 3),
        "varianza": round(variance, 3),
        "hype_class": hype_class,
        "hype_desc": hype_desc,
        "opiniones_polaridad": [round(p, 3) for p in polaridades],
        "media_movil": moving_averages,
        "comentarios_recientes": [
            {
                "texto": c.texto[:120] + "..." if len(c.texto) > 120 else c.texto,
                "sentimiento": c.sentimiento,
                "polaridad": round(c.polaridad, 3)
            }
            for c in comentarios[:6]
        ]
    }


# ---------------------------------------------------------------------------
# Endpoints de Autenticación
# ---------------------------------------------------------------------------
@app.post("/api/auth/register")
def register(req: UserRegisterRequest, db: Session = Depends(get_db)):
    existing = db.query(Usuario).filter(Usuario.email == req.email.strip().lower()).first()
    if existing:
        raise HTTPException(status_code=400, detail="Este correo electrónico ya está registrado.")
        
    hashed = get_password_hash(req.password)
    new_user = Usuario(
        name=req.name.strip(),
        email=req.email.strip().lower(),
        hashed_password=hashed
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    token = create_access_token({"sub": new_user.id})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": new_user.id,
            "name": new_user.name,
            "email": new_user.email,
            "avatar_url": new_user.avatar_url,
            "pareja_id": new_user.pareja_id,
            "role": new_user.role
        }
    }

@app.post("/api/auth/login")
def login(req: UserLoginRequest, db: Session = Depends(get_db)):
    user = db.query(Usuario).filter(Usuario.email == req.email.strip().lower()).first()
    if not user or not user.hashed_password:
        raise HTTPException(status_code=400, detail="El correo electrónico o la contraseña son incorrectos.")
        
    if not verify_password(req.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="El correo electrónico o la contraseña son incorrectos.")
        
    token = create_access_token({"sub": user.id})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "avatar_url": user.avatar_url,
            "pareja_id": user.pareja_id,
            "role": user.role
        }
    }

@app.post("/api/auth/google-login")
def google_login(req: GoogleLoginRequest, db: Session = Depends(get_db)):
    # Búsqueda por google_id o por email
    user = db.query(Usuario).filter(
        (Usuario.google_id == req.google_id) | (Usuario.email == req.email.strip().lower())
    ).first()
    
    if not user:
        # Registrar nuevo usuario social
        user = Usuario(
            name=req.name.strip(),
            email=req.email.strip().lower(),
            google_id=req.google_id,
            avatar_url=req.avatar_url
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    else:
        # Actualizar datos de Google
        user.google_id = req.google_id
        if req.avatar_url:
            user.avatar_url = req.avatar_url
        db.commit()
        db.refresh(user)
        
    token = create_access_token({"sub": user.id})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "avatar_url": user.avatar_url,
            "pareja_id": user.pareja_id,
            "role": user.role
        }
    }


# ---------------------------------------------------------------------------
# Endpoints de Perfil de Usuario
# ---------------------------------------------------------------------------
@app.get("/api/users/me")
def get_me(current_user: Usuario = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "name": current_user.name,
        "email": current_user.email,
        "avatar_url": current_user.avatar_url,
        "pareja_id": current_user.pareja_id,
        "tiene_pareja": current_user.tiene_pareja,
        "role": current_user.role
    }

@app.put("/api/users/me")
def update_profile(req: UpdateProfileRequest, current_user: Usuario = Depends(get_current_user), db: Session = Depends(get_db)):
    db_user = db.query(Usuario).filter(Usuario.id == current_user.id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
        
    if req.name is not None:
        name_val = req.name.strip()
        if not name_val:
            raise HTTPException(status_code=400, detail="El nombre no puede estar vacío.")
        db_user.name = name_val
        
    if req.avatar_url is not None:
        db_user.avatar_url = req.avatar_url.strip()
        
    if req.password is not None:
        pass_val = req.password.strip()
        if len(pass_val) < 6:
            raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 6 caracteres.")
        db_user.hashed_password = get_password_hash(pass_val)
        
    db.commit()
    db.refresh(db_user)
    return {
        "status": "success",
        "message": "Perfil actualizado correctamente.",
        "user": {
            "id": db_user.id,
            "name": db_user.name,
            "email": db_user.email,
            "avatar_url": db_user.avatar_url,
            "pareja_id": db_user.pareja_id,
            "role": db_user.role
        }
    }

@app.post("/api/users/upload-avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: Usuario = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Validar extensión del archivo
    allowed_extensions = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
    filename = file.filename
    ext = os.path.splitext(filename)[1].lower()
    if ext not in allowed_extensions:
        raise HTTPException(status_code=400, detail="Tipo de archivo no permitido. Solo se permiten imágenes.")
        
    # Crear nombre de archivo único para evitar colisiones
    import uuid
    unique_filename = f"{uuid.uuid4().hex}{ext}"
    
    # Ruta de destino
    dest_path = os.path.join("static/avatars", unique_filename)
    
    # Guardar el archivo en disco
    try:
        with open(dest_path, "wb") as buffer:
            content = await file.read()
            buffer.write(content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al guardar el archivo: {e}")
        
    avatar_url = f"/static/avatars/{unique_filename}"
    
    # Actualizar avatar_url del usuario en la base de datos
    db_user = db.query(Usuario).filter(Usuario.id == current_user.id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
        
    db_user.avatar_url = avatar_url
    db.commit()
    db.refresh(db_user)
    
    return {
        "status": "success",
        "message": "Avatar subido e instalado correctamente.",
        "avatar_url": avatar_url,
        "user": {
            "id": db_user.id,
            "name": db_user.name,
            "email": db_user.email,
            "avatar_url": db_user.avatar_url,
            "pareja_id": db_user.pareja_id,
            "role": db_user.role
        }
    }


# ---------------------------------------------------------------------------
# Endpoints de Vinculación Permanente
# ---------------------------------------------------------------------------
@app.post("/api/partner/link")
def link_partner(req: PartnerRequest, current_user: Usuario = Depends(get_current_user), db: Session = Depends(get_db)):
    db_user = db.query(Usuario).filter(Usuario.id == current_user.id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="Usuario actual no encontrado en la base de datos.")

    if db_user.email == req.email.strip().lower():
        raise HTTPException(status_code=400, detail="No puedes vincularte contigo mismo.")
        
    partner = db.query(Usuario).filter(Usuario.email == req.email.strip().lower()).first()
    if not partner:
        raise HTTPException(status_code=404, detail="Usuario no encontrado. Asegúrate de que tu pareja ya se ha registrado.")
        
    if db_user.pareja_id or partner.pareja_id:
        raise HTTPException(status_code=400, detail="Uno de los usuarios ya está vinculado a otra pareja. Debes desvincularte primero.")
        
    # Vincular en base de datos de manera persistente
    db_user.pareja_id = partner.id
    db_user.tiene_pareja = True
    partner.pareja_id = db_user.id
    partner.tiene_pareja = True
    
    # Crear registro de Pareja unificado si no existe
    couple_key = min(db_user.id, partner.id)
    exists = db.query(Pareja).filter(Pareja.id == couple_key).first()
    if not exists:
        db_pareja = Pareja(id=couple_key)
        db.add(db_pareja)
        
    db.commit()
    return {
        "status": "success",
        "message": f"Te has vinculado con éxito con {partner.name}.",
        "partner": {
            "id": partner.id,
            "name": partner.name,
            "email": partner.email
        }
    }

@app.post("/api/partner/unlink")
def unlink_partner(current_user: Usuario = Depends(get_current_user), db: Session = Depends(get_db)):
    db_user = db.query(Usuario).filter(Usuario.id == current_user.id).first()
    if not db_user or not db_user.pareja_id:
        return {"status": "success", "message": "No estabas vinculado a ninguna pareja."}
        
    partner = db.query(Usuario).filter(Usuario.id == db_user.pareja_id).first()
    if partner:
        # Eliminar registro de Pareja unificado si existe
        couple_key = min(db_user.id, partner.id)
        db.query(Pareja).filter(Pareja.id == couple_key).delete()
        
        partner.pareja_id = None
        partner.tiene_pareja = False
        
    db_user.pareja_id = None
    db_user.tiene_pareja = False
    db.commit()
    return {"status": "success", "message": "Vínculo de pareja disuelto correctamente."}

@app.get("/api/partner/status")
def get_partner_status(current_user: Usuario = Depends(get_current_user), db: Session = Depends(get_db)):
    print(f"[STATUS_DEBUG] current_user ID: {current_user.id}, pareja_id: {current_user.pareja_id}")
    if not current_user.pareja_id:
        print("[STATUS_DEBUG] pareja_id is None or empty")
        return {"linked": False}
        
    partner = db.query(Usuario).filter(Usuario.id == current_user.pareja_id).first()
    print(f"[STATUS_DEBUG] partner query result: {partner}")
    if not partner:
        print("[STATUS_DEBUG] Partner not found in database, clearing pareja_id")
        # Caso inconsistente: limpiar
        current_user.pareja_id = None
        current_user.tiene_pareja = False
        db.commit()
        return {"linked": False}
        
    return {
        "linked": True,
        "partner": {
            "id": partner.id,
            "name": partner.name,
            "email": partner.email,
            "avatar_url": partner.avatar_url
        }
    }


# ---------------------------------------------------------------------------
# Endpoints de Historial, Matches y CineVerse Wrapped
# ---------------------------------------------------------------------------
@app.post("/api/watched")
def mark_as_watched(req: WatchedRequest, db: Session = Depends(get_db)):
    user = db.query(Usuario).filter(Usuario.id == req.pareja_id).first()
    if not user or not user.pareja_id:
        raise HTTPException(status_code=400, detail="El usuario no tiene pareja vinculada.")
    couple_id = min(user.id, user.pareja_id)
    
    # Insertar el registro en vistas_pareja si no existe
    exists_couple = db.query(VistasPareja).filter(
        VistasPareja.pareja_id == couple_id,
        VistasPareja.contenido_id == req.contenido_id,
        VistasPareja.tipo == req.tipo
    ).first()
    if not exists_couple:
        vista = VistasPareja(
            pareja_id=couple_id,
            contenido_id=req.contenido_id,
            tipo=req.tipo
        )
        db.add(vista)
    
    # También inyectar en vistas_usuario para ambos
    duracion_mins = 120 if req.tipo == 'MOVIE' else 450
    for uid in [user.id, user.pareja_id]:
        exists_user = db.query(VistasUsuario).filter(
            VistasUsuario.usuario_id == uid,
            VistasUsuario.contenido_id == req.contenido_id,
            VistasUsuario.tipo == req.tipo
        ).first()
        if not exists_user:
            vu = VistasUsuario(
                usuario_id=uid,
                contenido_id=req.contenido_id,
                tipo=req.tipo,
                duracion=duracion_mins
            )
            db.add(vu)
            
    # Si ese contenido estaba marcado como match activo en la tabla parejas, restablecerlo a NULL
    pareja = db.query(Pareja).filter(Pareja.id == couple_id).first()
    if pareja:
        if req.tipo == 'MOVIE' and pareja.match_activo_pelicula_id == req.contenido_id:
            pareja.match_activo_pelicula_id = None
        elif req.tipo == 'SERIE' and pareja.match_activo_serie_id == req.contenido_id:
            pareja.match_activo_serie_id = None
            
    db.commit()
    return {"status": "success", "message": "Contenido marcado como visto y match activo limpiado."}


@app.post("/api/watched/user")
def mark_user_watched(req: UserWatchedRequest, db: Session = Depends(get_db)):
    user = db.query(Usuario).filter(Usuario.id == req.usuario_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    
    # Duración en minutos por defecto (120 para películas, 450 para series)
    duracion_mins = 120 if req.tipo == 'MOVIE' else 450
    
    # 1. Registrar para el usuario actual
    exists = db.query(VistasUsuario).filter(
        VistasUsuario.usuario_id == req.usuario_id,
        VistasUsuario.contenido_id == req.contenido_id,
        VistasUsuario.tipo == req.tipo
    ).first()
    if not exists:
        vista_user = VistasUsuario(
            usuario_id=req.usuario_id,
            contenido_id=req.contenido_id,
            tipo=req.tipo,
            duracion=duracion_mins
        )
        db.add(vista_user)
        
    # 2. Si se marca para ambos (para_pareja) y tiene pareja
    if req.para_pareja and user.pareja_id:
        # Registrar para la pareja
        exists_partner = db.query(VistasUsuario).filter(
            VistasUsuario.usuario_id == user.pareja_id,
            VistasUsuario.contenido_id == req.contenido_id,
            VistasUsuario.tipo == req.tipo
        ).first()
        if not exists_partner:
            vista_partner = VistasUsuario(
                usuario_id=user.pareja_id,
                contenido_id=req.contenido_id,
                tipo=req.tipo,
                duracion=duracion_mins
            )
            db.add(vista_partner)
            
        # Registrar en vistas_pareja
        couple_id = min(user.id, user.pareja_id)
        exists_couple = db.query(VistasPareja).filter(
            VistasPareja.pareja_id == couple_id,
            VistasPareja.contenido_id == req.contenido_id,
            VistasPareja.tipo == req.tipo
        ).first()
        if not exists_couple:
            vista_couple = VistasPareja(
                pareja_id=couple_id,
                contenido_id=req.contenido_id,
                tipo=req.tipo
            )
            db.add(vista_couple)
            
        # Limpiar match activo
        pareja = db.query(Pareja).filter(Pareja.id == couple_id).first()
        if pareja:
            if req.tipo == 'MOVIE' and pareja.match_activo_pelicula_id == req.contenido_id:
                pareja.match_activo_pelicula_id = None
            elif req.tipo == 'SERIE' and pareja.match_activo_serie_id == req.contenido_id:
                pareja.match_activo_serie_id = None
    elif not req.para_pareja and user.pareja_id:
        # Si no se marca para ambos, pero la pareja YA lo tiene marcado individualmente
        exists_partner = db.query(VistasUsuario).filter(
            VistasUsuario.usuario_id == user.pareja_id,
            VistasUsuario.contenido_id == req.contenido_id,
            VistasUsuario.tipo == req.tipo
        ).first()
        if exists_partner:
            # Registrar en vistas_pareja
            couple_id = min(user.id, user.pareja_id)
            exists_couple = db.query(VistasPareja).filter(
                VistasPareja.pareja_id == couple_id,
                VistasPareja.contenido_id == req.contenido_id,
                VistasPareja.tipo == req.tipo
            ).first()
            if not exists_couple:
                vista_couple = VistasPareja(
                    pareja_id=couple_id,
                    contenido_id=req.contenido_id,
                    tipo=req.tipo
                )
                db.add(vista_couple)
                
            # Limpiar match activo
            pareja = db.query(Pareja).filter(Pareja.id == couple_id).first()
            if pareja:
                if req.tipo == 'MOVIE' and pareja.match_activo_pelicula_id == req.contenido_id:
                    pareja.match_activo_pelicula_id = None
                elif req.tipo == 'SERIE' and pareja.match_activo_serie_id == req.contenido_id:
                    pareja.match_activo_serie_id = None
                    
    db.commit()
    return {"status": "success", "message": "Contenido marcado como visto individual/pareja correctamente."}


@app.get("/api/watched/stats/{usuario_id}")
def get_user_watched_stats(usuario_id: int, db: Session = Depends(get_db)):
    # Contar películas
    peliculas_count = db.query(VistasUsuario).filter(
        VistasUsuario.usuario_id == usuario_id,
        VistasUsuario.tipo == 'MOVIE'
    ).count()
    
    # Contar series
    series_count = db.query(VistasUsuario).filter(
        VistasUsuario.usuario_id == usuario_id,
        VistasUsuario.tipo == 'SERIE'
    ).count()
    
    # Sumar duración
    total_minutos_query = db.query(sqlalchemy.func.sum(VistasUsuario.duracion)).filter(
        VistasUsuario.usuario_id == usuario_id
    ).scalar()
    total_minutos = total_minutos_query if total_minutos_query else 0
    
    total_horas = round(total_minutos / 60.0, 1)
    total_dias = round(total_minutos / 1440.0, 1)
    
    return {
        "total_peliculas": peliculas_count,
        "total_series": series_count,
        "tiempo_total_minutos": total_minutos,
        "tiempo_total_horas": total_horas,
        "tiempo_total_dias": total_dias
    }


@app.post("/api/watched/user/unmark")
def unmark_user_watched(req: UserWatchedRequest, db: Session = Depends(get_db)):
    # Eliminar de vistas_usuario
    db.query(VistasUsuario).filter(
        VistasUsuario.usuario_id == req.usuario_id,
        VistasUsuario.contenido_id == req.contenido_id,
        VistasUsuario.tipo == req.tipo
    ).delete()
    
    user = db.query(Usuario).filter(Usuario.id == req.usuario_id).first()
    if user and user.pareja_id:
        couple_id = min(user.id, user.pareja_id)
        # Siempre eliminar de vistas_pareja si el usuario actual lo desmarca, ya que no puede estar visto por ambos si uno lo desmarca
        db.query(VistasPareja).filter(
            VistasPareja.pareja_id == couple_id,
            VistasPareja.contenido_id == req.contenido_id,
            VistasPareja.tipo == req.tipo
        ).delete()
        
        # Si se pidió desmarcar para la pareja también
        if req.para_pareja:
            db.query(VistasUsuario).filter(
                VistasUsuario.usuario_id == user.pareja_id,
                VistasUsuario.contenido_id == req.contenido_id,
                VistasUsuario.tipo == req.tipo
            ).delete()
        
    db.commit()
    return {"status": "success", "message": "Contenido desmarcado como visto correctamente."}


@app.get("/api/watched/check/{usuario_id}/{tipo}/{contenido_id}")
def check_watched_status(usuario_id: int, tipo: str, contenido_id: int, db: Session = Depends(get_db)):
    user_view = db.query(VistasUsuario).filter(
        VistasUsuario.usuario_id == usuario_id,
        VistasUsuario.contenido_id == contenido_id,
        VistasUsuario.tipo == tipo
    ).first()
    
    user = db.query(Usuario).filter(Usuario.id == usuario_id).first()
    couple_view = None
    if user and user.pareja_id:
        couple_id = min(user.id, user.pareja_id)
        couple_view = db.query(VistasPareja).filter(
            VistasPareja.pareja_id == couple_id,
            VistasPareja.contenido_id == contenido_id,
            VistasPareja.tipo == tipo
        ).first()
        
    status = None
    if couple_view:
        status = "couple"
    elif user_view:
        status = "user"
        
    return {"watched": status is not None, "status": status}


@app.get("/api/wrapped/{pareja_id}")
def get_cineverse_wrapped(pareja_id: int, db: Session = Depends(get_db)):
    user = db.query(Usuario).filter(Usuario.id == pareja_id).first()
    if not user or not user.pareja_id:
        return {
            "total_vistas": 0,
            "genero_rey": "Ninguno",
            "mes_mas_cinefilo": "Ninguno",
            "ratio_movies_series": 0.0
        }
    couple_id = min(user.id, user.pareja_id)
    
    # 1. Total vistas
    total_query = db.execute(
        sqlalchemy.text("SELECT COUNT(*) FROM vistas_pareja WHERE pareja_id = :couple_id"),
        {"couple_id": couple_id}
    ).scalar()
    total_vistas = total_query if total_query else 0
    
    # 2. Genero Rey (coalesciendo campos de películas y series)
    genero_query = db.execute(
        sqlalchemy.text(
            """
            SELECT COALESCE(p.genero, s.genero) AS gen, COUNT(*) AS count
            FROM vistas_pareja vp
            LEFT JOIN peliculas p ON vp.tipo = 'MOVIE' AND vp.contenido_id = p.id
            LEFT JOIN series s ON vp.tipo = 'SERIE' AND vp.contenido_id = s.id
            WHERE vp.pareja_id = :couple_id 
              AND COALESCE(p.genero, s.genero) IS NOT NULL 
              AND COALESCE(p.genero, s.genero) != ''
            GROUP BY gen
            ORDER BY count DESC
            LIMIT 1
            """
        ),
        {"couple_id": couple_id}
    ).first()
    
    genero_rey = genero_query[0] if genero_query and genero_query[0] else "Ninguno"
    
    # 3. Mes mas cinefilo
    mes_query = db.execute(
        sqlalchemy.text(
            """
            SELECT strftime('%m', fecha_visualizacion) AS mes, COUNT(*) AS count
            FROM vistas_pareja
            WHERE pareja_id = :couple_id
            GROUP BY mes
            ORDER BY count DESC
            LIMIT 1
            """
        ),
        {"couple_id": couple_id}
    ).first()
    
    meses_esp = {
        "01": "Enero", "02": "Febrero", "03": "Marzo", "04": "Abril",
        "05": "Mayo", "06": "Junio", "07": "Julio", "08": "Agosto",
        "09": "Septiembre", "10": "Octubre", "11": "Noviembre", "12": "Diciembre"
    }
    mes_mas_cinefilo = "Ninguno"
    if mes_query and mes_query[0]:
        mes_mas_cinefilo = meses_esp.get(mes_query[0], "Ninguno")
        
    # 4. Ratio películas vs series (porcentaje de películas frente a series)
    ratio_query = db.execute(
        sqlalchemy.text(
            """
            SELECT tipo, COUNT(*) AS count
            FROM vistas_pareja
            WHERE pareja_id = :couple_id
            GROUP BY tipo
            """
        ),
        {"couple_id": couple_id}
    ).all()
    
    movies_count = 0
    series_count = 0
    for row in ratio_query:
        if row[0] == 'MOVIE':
            movies_count = row[1]
        elif row[0] == 'SERIE':
            series_count = row[1]
            
    total_ratio = movies_count + series_count
    ratio_movies_series = round((movies_count / total_ratio) * 100, 1) if total_ratio > 0 else 0.0
    
    return {
        "total_vistas": total_vistas,
        "genero_rey": genero_rey,
        "mes_mas_cinefilo": mes_mas_cinefilo,
        "ratio_movies_series": ratio_movies_series
    }


@app.get("/api/matches/{pareja_id}")
def get_couple_matches(pareja_id: int, pending_only: bool = False, db: Session = Depends(get_db)):
    user = db.query(Usuario).filter(Usuario.id == pareja_id).first()
    if not user or not user.pareja_id:
        return []
        
    user_ids = [user.id, user.pareja_id]
    couple_id = min(user.id, user.pareja_id)
    
    # Obtener IDs de contenidos ya vistos en pareja (excluidos siempre de matches)
    watched_movie_ids = [
        r[0] for r in db.execute(
            sqlalchemy.text("SELECT contenido_id FROM vistas_pareja WHERE pareja_id = :couple_id AND tipo = 'MOVIE'"),
            {"couple_id": couple_id}
        ).all()
    ]
    
    # Obtener IDs de series ya vistas en pareja (excluidas siempre de matches)
    watched_series_ids = [
        r[0] for r in db.execute(
            sqlalchemy.text("SELECT contenido_id FROM vistas_pareja WHERE pareja_id = :couple_id AND tipo = 'SERIE'"),
            {"couple_id": couple_id}
        ).all()
    ]

    # Obtener vistos individuales del usuario actual para marcar su check
    user_watched_movie_ids = [
        r[0] for r in db.execute(
            sqlalchemy.text("SELECT contenido_id FROM vistas_usuario WHERE usuario_id = :user_id AND tipo = 'MOVIE'"),
            {"user_id": user.id}
        ).all()
    ]
    
    user_watched_series_ids = [
        r[0] for r in db.execute(
            sqlalchemy.text("SELECT contenido_id FROM vistas_usuario WHERE usuario_id = :user_id AND tipo = 'SERIE'"),
            {"user_id": user.id}
        ).all()
    ]
    
    # Consultar películas en común
    matched_movies = db.query(Pelicula).join(Decision, Decision.pelicula_id == Pelicula.id).filter(
        Decision.voto == "like",
        Decision.usuario_id.in_(user_ids)
    )
    if watched_movie_ids:
        matched_movies = matched_movies.filter(Pelicula.id.notin_(watched_movie_ids))
    matched_movies = matched_movies.group_by(Pelicula.id).having(sqlalchemy.func.count(Decision.usuario_id) == 2).all()
    
    # Consultar series en común
    matched_series = db.query(Serie).join(DecisionSerie, DecisionSerie.serie_id == Serie.id).filter(
        DecisionSerie.voto == "like",
        DecisionSerie.usuario_id.in_(user_ids)
    )
    if watched_series_ids:
        matched_series = matched_series.filter(Serie.id.notin_(watched_series_ids))
    matched_series = matched_series.group_by(Serie.id).having(sqlalchemy.func.count(DecisionSerie.usuario_id) == 2).all()
    
    # Formatear lista unificada
    movies_list = []
    for m in matched_movies:
        movies_list.append({
            "id": m.id,
            "titulo": m.titulo,
            "sinopsis": m.sinopsis,
            "poster_url": m.poster_url,
            "backdrop_url": m.backdrop_url,
            "rating": m.rating,
            "genero": m.genero,
            "visto": m.id in user_watched_movie_ids,
            "tipo": "pelicula"
        })
        
    series_list = []
    for s in matched_series:
        series_list.append({
            "id": s.id,
            "titulo": s.titulo,
            "sinopsis": s.sinopsis,
            "poster_url": s.poster_url,
            "backdrop_url": s.backdrop_url,
            "rating": s.rating,
            "genero": s.genero,
            "visto": s.id in user_watched_series_ids,
            "tipo": "serie"
        })
        
    return movies_list + series_list

@app.delete("/api/matches/{usuario_id}/{tipo}/{contenido_id}")
def delete_match(usuario_id: int, tipo: str, contenido_id: int, sala_codigo: Optional[str] = None, db: Session = Depends(get_db)):
    if sala_codigo:
        sala = db.query(Sala).filter(Sala.codigo == sala_codigo.upper()).first()
        if not sala:
            raise HTTPException(status_code=404, detail="Sala no encontrada")
        members = db.query(SalaMiembro.usuario_id).filter(SalaMiembro.sala_id == sala.id).all()
        user_ids = [m[0] for m in members]
    else:
        user = db.query(Usuario).filter(Usuario.id == usuario_id).first()
        if not user or not user.pareja_id:
            raise HTTPException(status_code=400, detail="El usuario no tiene pareja vinculada.")
        user_ids = [user.id, user.pareja_id]
        
    if tipo.upper() == 'MOVIE' or tipo.upper() == 'PELICULA':
        q = db.query(Decision).filter(
            Decision.usuario_id.in_(user_ids),
            Decision.pelicula_id == contenido_id
        )
        if sala_codigo:
            q = q.filter(Decision.sala_id == sala.id)
        q.delete(synchronize_session=False)
    else:
        q = db.query(DecisionSerie).filter(
            DecisionSerie.usuario_id.in_(user_ids),
            DecisionSerie.serie_id == contenido_id
        )
        if sala_codigo:
            q = q.filter(DecisionSerie.sala_id == sala.id)
        q.delete(synchronize_session=False)
        
    db.commit()
    return {"status": "success", "message": "Match eliminado correctamente."}


# ---------------------------------------------------------------------------
# Motor de Recomendación Basado en Contenido (ML)
# ---------------------------------------------------------------------------
@app.get("/api/recommendations/{pareja_id}", response_model=List[PeliculaBase])
def get_recommendations(pareja_id: int, db: Session = Depends(get_db)):
    """
    Motor de recomendaciones basado en contenido.
    Toma los títulos y sinopsis de todas las películas que tienen un "LIKE" común
    de la pareja, aplica TF-IDF y Similitud del Coseno sobre las sinopsis del catálogo,
    y devuelve las 5 películas con mayor puntuación de similitud.
    """
    # 1. Obtener el usuario actual
    user = db.query(Usuario).filter(Usuario.id == pareja_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
        
    def get_rating_fallback():
        # Devolver las 5 películas con mejor rating del catálogo general
        return db.query(Pelicula).order_by(Pelicula.rating.desc()).limit(5).all()

    # 2. Verificar que tenga pareja vinculada
    if not user.pareja_id:
        return get_rating_fallback()

    user_ids = [user.id, user.pareja_id]

    # 3. Obtener películas con "LIKE" común de la pareja (ambos miembros votaron "like")
    liked_movies = db.query(Pelicula).join(Decision, Decision.pelicula_id == Pelicula.id).filter(
        Decision.voto == "like",
        Decision.usuario_id.in_(user_ids)
    ).group_by(Pelicula.id).having(sqlalchemy.func.count(Decision.usuario_id) == 2).all()

    if not liked_movies:
        return get_rating_fallback()

    # 4. Obtener todas las películas del catálogo general
    catalogo_peliculas = db.query(Pelicula).all()
    if not catalogo_peliculas:
        return []

    # Si scikit-learn no está disponible por falta de instalación en caliente, usar fallback por rating
    if not SKLEARN_AVAILABLE:
        print("[REC ENGINE] scikit-learn no disponible en tiempo de ejecución. Usando fallback.")
        return get_rating_fallback()

    try:
        # 5. Construir el perfil de gustos históricos del usuario (títulos + sinopsis de películas con LIKE común)
        liked_texts = []
        for m in liked_movies:
            text_parts = []
            if m.titulo:
                text_parts.append(m.titulo)
            if m.sinopsis:
                text_parts.append(m.sinopsis)
            liked_texts.append(" ".join(text_parts))
        
        gustos_historicos_doc = " ".join(liked_texts)

        # 6. Preparar las sinopsis del catálogo general
        catalogo_sinopsis = [m.sinopsis or "" for m in catalogo_peliculas]

        # 7. TF-IDF y Similitud del Coseno
        vectorizer = TfidfVectorizer()
        tfidf_matrix = vectorizer.fit_transform(catalogo_sinopsis)
        gustos_vector = vectorizer.transform([gustos_historicos_doc])

        similarity_scores = cosine_similarity(gustos_vector, tfidf_matrix).flatten()

        # 8. Excluir las películas que ya son likes comunes de la pareja de las recomendaciones
        liked_ids = {m.id for m in liked_movies}

        recomendaciones = []
        for idx, movie in enumerate(catalogo_peliculas):
            if movie.id not in liked_ids:
                recomendaciones.append((movie, similarity_scores[idx]))

        # 9. Ordenar por puntuación de similitud descendente y tomar las 5 mejores
        recomendaciones.sort(key=lambda x: x[1], reverse=True)
        top_5 = [item[0] for item in recomendaciones[:5]]
        
        return top_5

    except Exception as e:
        print(f"[REC ENGINE ERROR] Error al calcular similitud: {e}")
        return get_rating_fallback()


# ---------------------------------------------------------------------------
# Endpoints de Salas y Votaciones Grupales
# ---------------------------------------------------------------------------

@app.post("/api/rooms/create")
def create_room(req: CreateRoomRequest, current_user: Usuario = Depends(get_current_user), db: Session = Depends(get_db)):
    # Si es tipo pareja y tiene pareja vinculada, buscar si ya existe una sala activa para esta pareja y categoría
    if req.tipo == "pareja" and current_user.pareja_id:
        # Verificar que el vínculo de pareja sea bidireccional (ambos se apuntan entre sí)
        pareja = db.query(Usuario).filter(Usuario.id == current_user.pareja_id).first()
        if not pareja or pareja.pareja_id != current_user.id:
            raise HTTPException(
                status_code=400,
                detail="El vínculo de pareja no es bidireccional. Vincula correctamente antes de crear una sala."
            )
        existing_room = db.query(Sala).filter(
            Sala.tipo == "pareja",
            Sala.activo == True,
            Sala.categoria == req.categoria,
            Sala.creador_id.in_([current_user.id, current_user.pareja_id])
        ).first()
        
        if existing_room:
            # Asegurarse de que solo los dos miembros legítimos estén en la sala
            legitimate_ids = {current_user.id, current_user.pareja_id}
            # Expulsar cualquier miembro que no sea legítimo
            all_members = db.query(SalaMiembro).filter(SalaMiembro.sala_id == existing_room.id).all()
            for m in all_members:
                if m.usuario_id not in legitimate_ids:
                    db.delete(m)
            # Añadir los legítimos que falten
            for uid in legitimate_ids:
                member_exists = db.query(SalaMiembro).filter(
                    SalaMiembro.sala_id == existing_room.id,
                    SalaMiembro.usuario_id == uid
                ).first()
                if not member_exists:
                    new_member = SalaMiembro(
                        sala_id=existing_room.id,
                        usuario_id=uid
                    )
                    db.add(new_member)
            db.commit()
            return {
                "id": existing_room.id,
                "codigo": existing_room.codigo,
                "tipo": existing_room.tipo,
                "creador_id": existing_room.creador_id,
                "voting_started": existing_room.voting_started,
                "categoria": existing_room.categoria
            }


    # Generar código legible de 6 letras/números
    import uuid
    codigo = f"CINE-{str(uuid.uuid4())[:5].upper()}"
    
    # Crear la sala
    new_room = Sala(
        codigo=codigo,
        creador_id=current_user.id,
        tipo=req.tipo,
        activo=True,
        voting_started=(req.tipo == "pareja"),
        categoria=req.categoria
    )
    db.add(new_room)
    db.flush()
    
    # Añadir al creador como miembro
    miembro = SalaMiembro(
        sala_id=new_room.id,
        usuario_id=current_user.id
    )
    db.add(miembro)
    
    # Si es tipo pareja y tiene pareja, añadir también al partner
    if req.tipo == "pareja" and current_user.pareja_id:
        miembro_partner = SalaMiembro(
            sala_id=new_room.id,
            usuario_id=current_user.pareja_id
        )
        db.add(miembro_partner)
        
    db.commit()
    db.refresh(new_room)
    
    # Si es una sala grupal para estrenos/series, pre-scrapear y rellenar películas/series en la DB si está vacía
    if req.tipo == "grupo_amigos":
        if req.categoria == "series":
            print(f"[ROOM] Inicializando catálogo de series para sala {codigo}...")
            result = _call_scraper("/scrape/tv/popular")
            series_popular = result.get("series", [])
            for s in series_popular:
                exists = db.query(Serie).filter(Serie.id == s["id"]).first()
                if not exists:
                    new_serie = Serie(
                        id=s["id"],
                        titulo=s["titulo"],
                        sinopsis=s["sinopsis"],
                        poster_url=s["poster_url"],
                        backdrop_url=s["backdrop_url"],
                        rating=s["rating"]
                    )
                    db.add(new_serie)
            db.commit()
        else:
            print(f"[ROOM] Inicializando cartelera de estrenos para sala {codigo}...")
            result = _call_scraper("/scrape/upcoming")
            estrenos = result.get("movies", [])
            for m in estrenos:
                # Insertar en Pelicula si no existe
                exists = db.query(Pelicula).filter(Pelicula.id == m["id"]).first()
                if not exists:
                    new_movie = Pelicula(
                        id=m["id"],
                        titulo=m["titulo"],
                        sinopsis=m["sinopsis"],
                        poster_url=m["poster_url"],
                        backdrop_url=m["backdrop_url"],
                        rating=m["rating"]
                    )
                    db.add(new_movie)
            db.commit()

    return {
        "id": new_room.id,
        "codigo": new_room.codigo,
        "tipo": new_room.tipo,
        "creador_id": new_room.creador_id,
        "voting_started": new_room.voting_started,
        "categoria": new_room.categoria
    }

@app.get("/api/rooms/active")
def get_active_room(categoria: str | None = None, current_user: Usuario = Depends(get_current_user), db: Session = Depends(get_db)):
    # Buscar una sala activa donde el usuario sea miembro
    query = db.query(SalaMiembro).join(Sala).filter(
        SalaMiembro.usuario_id == current_user.id,
        Sala.activo == True
    )
    if categoria:
        query = query.filter(Sala.categoria == categoria)
    miembro = query.order_by(Sala.id.desc()).first()
    
    if not miembro:
        return {"active": False}
        
    sala = db.query(Sala).filter(Sala.id == miembro.sala_id).first()

    # Validación de acceso: si es sala de pareja, verificar que el usuario tiene derecho a estar
    if sala.tipo == "pareja":
        creador = db.query(Usuario).filter(Usuario.id == sala.creador_id).first()
        legitimate_ids = {sala.creador_id}
        if creador and creador.pareja_id:
            legitimate_ids.add(creador.pareja_id)

        if current_user.id not in legitimate_ids:
            # Este usuario no tiene derecho — eliminar su membresía y devolver inactivo
            db.delete(miembro)
            db.commit()
            return {"active": False}

    return {
        "active": True,
        "room": {
            "id": sala.id,
            "codigo": sala.codigo,
            "tipo": sala.tipo,
            "creador_id": sala.creador_id,
            "voting_started": sala.voting_started,
            "categoria": sala.categoria
        }
    }


@app.post("/api/rooms/leave")
async def leave_room(categoria: str | None = None, current_user: Usuario = Depends(get_current_user), db: Session = Depends(get_db)):
    query = db.query(SalaMiembro).join(Sala).filter(
        SalaMiembro.usuario_id == current_user.id,
        Sala.activo == True
    )
    if categoria:
        query = query.filter(Sala.categoria == categoria)
    miembros = query.all()
    
    for m in miembros:
        sala = db.query(Sala).filter(Sala.id == m.sala_id).first()
        if sala:
            if sala.tipo == "pareja":
                # En sala de pareja: solo eliminar al usuario que sale, NO desactivar la sala
                # La sala sigue activa para que la pareja pueda volver a entrar
                db.delete(m)
                await manager.broadcast({
                    "event": "PARTNER_LEFT",
                    "message": f"{current_user.name} ha salido de la sala temporalmente.",
                    "user_id": current_user.id
                }, sala.codigo)
            else:
                # En grupo de amigos: solo eliminar al usuario que sale
                db.delete(m)
                await manager.broadcast({
                    "event": "ROOM_CLOSED",
                    "message": "Un miembro ha salido de la sala.",
                    "user_id": current_user.id
                }, sala.codigo)
                
    db.commit()
    return {"status": "success", "message": "Has salido de la sala"}


@app.post("/api/rooms/join")
async def join_room(req: JoinRoomRequest, current_user: Usuario = Depends(get_current_user), db: Session = Depends(get_db)):
    sala = db.query(Sala).filter(Sala.codigo == req.sala_codigo.strip().upper(), Sala.activo == True).first()
    if not sala:
        raise HTTPException(status_code=404, detail="La sala no existe o ha expirado.")

    # ─────────────────────────────────────────────────────────────────
    # Reglas de acceso según el TIPO de sala
    # ─────────────────────────────────────────────────────────────────
    if sala.tipo == "pareja":
        # 1. El creador siempre puede (re)entrar a su propia sala
        if current_user.id != sala.creador_id:
            # 2. Solo la pareja vinculada del creador puede entrar
            creador = db.query(Usuario).filter(Usuario.id == sala.creador_id).first()
            if not creador or creador.pareja_id != current_user.id:
                raise HTTPException(
                    status_code=403,
                    detail="Esta sala es privada de pareja. Solo puede entrar la pareja vinculada del creador."
                )

            # Verificar si ya es miembro para no bloquear su re-entrada
            is_already_member = db.query(SalaMiembro).filter(
                SalaMiembro.sala_id == sala.id,
                SalaMiembro.usuario_id == current_user.id
            ).first() is not None

            if not is_already_member:
                # 3. Límite de 2 miembros para sala de pareja
                num_miembros = db.query(SalaMiembro).filter(SalaMiembro.sala_id == sala.id).count()
                if num_miembros >= 2:
                    raise HTTPException(
                        status_code=403,
                        detail="La sala de pareja ya tiene el máximo de 2 participantes."
                    )

    # ─────────────────────────────────────────────────────────────────
    # Para grupo_amigos: cualquiera con el código puede entrar (sin restricción adicional)
    # ─────────────────────────────────────────────────────────────────

    # Verificar si ya es miembro (re-entrada permitida sin duplicar)
    existing = db.query(SalaMiembro).filter(
        SalaMiembro.sala_id == sala.id,
        SalaMiembro.usuario_id == current_user.id
    ).first()
    
    if not existing:
        miembro = SalaMiembro(
            sala_id=sala.id,
            usuario_id=current_user.id
        )
        db.add(miembro)
        db.commit()
        
    # Notificar a los integrantes de la sala mediante WebSocket
    await manager.broadcast({
        "event": "MEMBER_JOINED",
        "user": {
            "id": current_user.id,
            "name": current_user.name,
            "avatar_url": current_user.avatar_url
        }
    }, sala.codigo)
    
    return {
        "id": sala.id,
        "codigo": sala.codigo,
        "tipo": sala.tipo,
        "creador_id": sala.creador_id,
        "voting_started": sala.voting_started,
        "categoria": sala.categoria
    }


@app.get("/api/rooms/members/{sala_codigo}")
def get_room_members(sala_codigo: str, db: Session = Depends(get_db)):
    sala = db.query(Sala).filter(Sala.codigo == sala_codigo.upper(), Sala.activo == True).first()
    if not sala:
        raise HTTPException(status_code=404, detail="Sala no encontrada o inactiva")
        
    members = db.query(Usuario).join(SalaMiembro).filter(SalaMiembro.sala_id == sala.id).all()
    return [
        {
            "id": m.id,
            "name": m.name,
            "email": m.email,
            "avatar_url": m.avatar_url
        }
        for m in members
    ]

@app.get("/api/rooms/movies/{sala_codigo}")
def get_room_movies(sala_codigo: str, db: Session = Depends(get_db)):
    sala = db.query(Sala).filter(Sala.codigo == sala_codigo.upper(), Sala.activo == True).first()
    if not sala:
        raise HTTPException(status_code=404, detail="Sala no encontrada o inactiva")
        
    if sala.categoria == "series":
        series = db.query(Serie).all()
        # Seed if empty
        if not series:
            print("[ROOM] Catálogo de series vacío en base de datos. Scraping...")
            result = _call_scraper("/scrape/tv/popular")
            series_popular = result.get("series", [])
            for s in series_popular:
                exists = db.query(Serie).filter(Serie.id == s["id"]).first()
                if not exists:
                    new_serie = Serie(
                        id=s["id"],
                        titulo=s["titulo"],
                        sinopsis=s["sinopsis"],
                        poster_url=s["poster_url"],
                        backdrop_url=s["backdrop_url"],
                        rating=s["rating"],
                        genero=s.get("genero")
                    )
                    db.add(new_serie)
            db.commit()
            series = db.query(Serie).all()
        import random
        random.shuffle(series)
        return series
        
    peliculas = db.query(Pelicula).all()
    import random
    random.shuffle(peliculas)
    return peliculas

class MovieDecideRequest(BaseModel):
    usuario_id: int
    sala_codigo: Optional[str] = ""
    voto: str
    pelicula_id: int
    serie_id: Optional[int] = None

class SeriesDecideRequest(BaseModel):
    usuario_id: int
    sala_codigo: Optional[str] = ""
    voto: str
    serie_id: int
    pelicula_id: Optional[int] = None

@app.post("/api/movies/decide")
async def movie_decide(req: MovieDecideRequest, db: Session = Depends(get_db)):
    sala = None
    if req.sala_codigo:
        sala = db.query(Sala).filter(Sala.codigo == req.sala_codigo.upper()).first()
    
    sala_id = sala.id if sala else None
    
    existing = db.query(Decision).filter(
        Decision.usuario_id == req.usuario_id,
        Decision.pelicula_id == req.pelicula_id,
        Decision.sala_id == sala_id
    ).first()
    
    if not existing:
        decision = Decision(
            usuario_id=req.usuario_id,
            pelicula_id=req.pelicula_id,
            voto=req.voto,
            sala_id=sala_id
        )
        db.add(decision)
    else:
        existing.voto = req.voto
        
    db.commit()
    
    is_match = False
    movie = db.query(Pelicula).filter(Pelicula.id == req.pelicula_id).first()
    
    if req.voto == "like" and sala and movie:
        members = db.query(SalaMiembro.usuario_id).filter(SalaMiembro.sala_id == sala.id).all()
        member_ids = [m[0] for m in members]
        num_members = len(member_ids)
        
        likes_count = db.query(Decision).filter(
            Decision.sala_id == sala.id,
            Decision.pelicula_id == req.pelicula_id,
            Decision.voto == "like",
            Decision.usuario_id.in_(member_ids)
        ).count()
        
        if likes_count == num_members and num_members >= 2:
            is_match = True
            
            if sala.tipo == "pareja" and num_members == 2:
                couple_key = min(member_ids[0], member_ids[1])
                exists = db.query(HistorialMatch).filter(
                    HistorialMatch.pareja_id == couple_key,
                    HistorialMatch.pelicula_id == req.pelicula_id
                ).first()
                if not exists:
                    history_rec = HistorialMatch(
                        pareja_id=couple_key,
                        pelicula_id=req.pelicula_id,
                        fecha_match=date.today().isoformat(),
                        puntuacion_conjunta=0
                    )
                    db.add(history_rec)
                    # Guardar como match activo
                    db_pareja = db.query(Pareja).filter(Pareja.id == couple_key).first()
                    if not db_pareja:
                        db_pareja = Pareja(id=couple_key)
                        db.add(db_pareja)
                    db_pareja.match_activo_pelicula_id = req.pelicula_id
                    db.commit()
            
            match_payload = {
                "event": "MATCH_FOUND",
                "movie": {
                    "id": movie.id,
                    "titulo": movie.titulo,
                    "sinopsis": movie.sinopsis,
                    "poster_url": movie.poster_url,
                    "backdrop_url": movie.backdrop_url,
                    "rating": movie.rating,
                    "tipo": "pelicula"
                }
            }
            await manager.broadcast(match_payload, sala.codigo)

            for uid in member_ids:
                subs = db.query(PushSubscription).filter(PushSubscription.usuario_id == uid).all()
                for sub in subs:
                    sub_info = {
                        "endpoint": sub.endpoint,
                        "keys": {"p256dh": sub.p256dh, "auth": sub.auth}
                    }
                    send_push_notification(
                        subscription_info=sub_info,
                        title="🍿 ¡Match en CineVerse!",
                        body=f"Los dos queréis ver la película '{movie.titulo}'. ¡Preparad las palomitas!",
                        icon="/pwa-192x192.png",
                        data={"pelicula_id": movie.id, "titulo": movie.titulo, "tipo": "pelicula"}
                    )
                    
    movie_data = PeliculaBase.model_validate(movie) if movie else None
    return {"status": "success", "match": is_match, "movie": movie_data}

@app.post("/api/series/decide")
async def series_decide(req: SeriesDecideRequest, db: Session = Depends(get_db)):
    sala = None
    if req.sala_codigo:
        sala = db.query(Sala).filter(Sala.codigo == req.sala_codigo.upper()).first()
    
    sala_id = sala.id if sala else None
    
    existing = db.query(DecisionSerie).filter(
        DecisionSerie.usuario_id == req.usuario_id,
        DecisionSerie.serie_id == req.serie_id,
        DecisionSerie.sala_id == sala_id
    ).first()
    
    if not existing:
        decision = DecisionSerie(
            usuario_id=req.usuario_id,
            serie_id=req.serie_id,
            voto=req.voto,
            sala_id=sala_id
        )
        db.add(decision)
    else:
        existing.voto = req.voto
        
    db.commit()
    
    is_match = False
    serie = db.query(Serie).filter(Serie.id == req.serie_id).first()
    
    if req.voto == "like" and sala and serie:
        members = db.query(SalaMiembro.usuario_id).filter(SalaMiembro.sala_id == sala.id).all()
        member_ids = [m[0] for m in members]
        num_members = len(member_ids)
        
        likes_count = db.query(DecisionSerie).filter(
            DecisionSerie.sala_id == sala.id,
            DecisionSerie.serie_id == req.serie_id,
            DecisionSerie.voto == "like",
            DecisionSerie.usuario_id.in_(member_ids)
        ).count()
        
        if likes_count == num_members and num_members >= 2:
            is_match = True
            
            if sala.tipo == "pareja" and num_members == 2:
                couple_key = min(member_ids[0], member_ids[1])
                exists = db.query(HistorialMatchSerie).filter(
                    HistorialMatchSerie.pareja_id == couple_key,
                    HistorialMatchSerie.serie_id == req.serie_id
                ).first()
                if not exists:
                    history_rec = HistorialMatchSerie(
                        pareja_id=couple_key,
                        serie_id=req.serie_id,
                        fecha_match=date.today().isoformat(),
                        puntuacion_conjunta=0
                    )
                    db.add(history_rec)
                    # Guardar como match activo
                    db_pareja = db.query(Pareja).filter(Pareja.id == couple_key).first()
                    if not db_pareja:
                        db_pareja = Pareja(id=couple_key)
                        db.add(db_pareja)
                    db_pareja.match_activo_serie_id = req.serie_id
                    db.commit()
            
            match_payload = {
                "event": "MATCH_FOUND",
                "movie": {
                    "id": serie.id,
                    "titulo": serie.titulo,
                    "sinopsis": serie.sinopsis,
                    "poster_url": serie.poster_url,
                    "backdrop_url": serie.backdrop_url,
                    "rating": serie.rating,
                    "tipo": "serie"
                }
            }
            await manager.broadcast(match_payload, sala.codigo)

            for uid in member_ids:
                subs = db.query(PushSubscription).filter(PushSubscription.usuario_id == uid).all()
                for sub in subs:
                    sub_info = {
                        "endpoint": sub.endpoint,
                        "keys": {"p256dh": sub.p256dh, "auth": sub.auth}
                    }
                    send_push_notification(
                        subscription_info=sub_info,
                        title="📺 ¡Match en CineVerse!",
                        body=f"Los dos queréis ver la serie '{serie.titulo}'. ¡Preparad las palomitas!",
                        icon="/pwa-192x192.png",
                        data={"serie_id": serie.id, "titulo": serie.titulo, "tipo": "serie"}
                    )
                    
    serie_data = SerieBase.model_validate(serie) if serie else None
    return {"status": "success", "match": is_match, "movie": serie_data}

@app.post("/api/rooms/vote")
async def vote_in_room(req: RoomVoteRequest, current_user: Usuario = Depends(get_current_user), db: Session = Depends(get_db)):
    sala = db.query(Sala).filter(Sala.codigo == req.sala_codigo.upper()).first()
    if not sala:
        raise HTTPException(status_code=404, detail="Sala no encontrada")
        
    is_match = False
    
    if sala.categoria == "series":
        # Registrar la decisión de serie
        existing = db.query(DecisionSerie).filter(
            DecisionSerie.usuario_id == current_user.id,
            DecisionSerie.serie_id == req.serie_id,
            DecisionSerie.sala_id == sala.id
        ).first()
        
        if not existing:
            decision = DecisionSerie(
                usuario_id=current_user.id,
                serie_id=req.serie_id,
                voto=req.voto,
                sala_id=sala.id
            )
            db.add(decision)
        else:
            existing.voto = req.voto
            
        db.commit()
        
        # Comprobar si hay MATCH de serie
        serie = db.query(Serie).filter(Serie.id == req.serie_id).first()
        
        if req.voto == "like" and serie:
            members = db.query(SalaMiembro.usuario_id).filter(SalaMiembro.sala_id == sala.id).all()
            member_ids = [m[0] for m in members]
            num_members = len(member_ids)
            
            # Contar cuántos miembros han dado LIKE a esta serie en esta sala
            likes_count = db.query(DecisionSerie).filter(
                DecisionSerie.sala_id == sala.id,
                DecisionSerie.serie_id == req.serie_id,
                DecisionSerie.voto == "like",
                DecisionSerie.usuario_id.in_(member_ids)
            ).count()
            
            # Es Match si TODOS los integrantes han votado LIKE y hay al menos 2 miembros en la sala
            if likes_count == num_members and num_members >= 2:
                is_match = True
                
                # Registrar en HistorialMatchSerie si es sala tipo pareja
                if sala.tipo == "pareja" and num_members == 2:
                    couple_key = min(member_ids[0], member_ids[1])
                    exists = db.query(HistorialMatchSerie).filter(
                        HistorialMatchSerie.pareja_id == couple_key,
                        HistorialMatchSerie.serie_id == req.serie_id
                    ).first()
                    if not exists:
                        history_rec = HistorialMatchSerie(
                            pareja_id=couple_key,
                            serie_id=req.serie_id,
                            fecha_match=date.today().isoformat(),
                            puntuacion_conjunta=0
                        )
                        db.add(history_rec)
                        # Guardar como match activo
                        db_pareja = db.query(Pareja).filter(Pareja.id == couple_key).first()
                        if not db_pareja:
                            db_pareja = Pareja(id=couple_key)
                            db.add(db_pareja)
                        db_pareja.match_activo_serie_id = req.serie_id
                        db.commit()
                
                # Notificar match vía WebSocket
                match_payload = {
                    "event": "MATCH_FOUND",
                    "movie": {
                        "id": serie.id,
                        "titulo": serie.titulo,
                        "sinopsis": serie.sinopsis,
                        "poster_url": serie.poster_url,
                        "backdrop_url": serie.backdrop_url,
                        "rating": serie.rating,
                        "tipo": "serie"
                    }
                }
                await manager.broadcast(match_payload, sala.codigo)

                # Enviar notificaciones Push nativas
                for uid in member_ids:
                    subs = db.query(PushSubscription).filter(PushSubscription.usuario_id == uid).all()
                    for sub in subs:
                        sub_info = {
                            "endpoint": sub.endpoint,
                            "keys": {"p256dh": sub.p256dh, "auth": sub.auth}
                        }
                        send_push_notification(
                            subscription_info=sub_info,
                            title="📺 ¡Match en CineVerse!",
                            body=f"Los dos queréis ver la serie '{serie.titulo}'. ¡Preparad las palomitas!",
                            icon="/pwa-192x192.png",
                            data={"serie_id": serie.id, "titulo": serie.titulo, "tipo": "serie"}
                        )
    else:
        # Registrar la decisión de película
        existing = db.query(Decision).filter(
            Decision.usuario_id == current_user.id,
            Decision.pelicula_id == req.pelicula_id,
            Decision.sala_id == sala.id
        ).first()
        
        if not existing:
            decision = Decision(
                usuario_id=current_user.id,
                pelicula_id=req.pelicula_id,
                voto=req.voto,
                sala_id=sala.id
            )
            db.add(decision)
        else:
            existing.voto = req.voto
            
        db.commit()
        
        # Comprobar si hay MATCH de película
        movie = db.query(Pelicula).filter(Pelicula.id == req.pelicula_id).first()
        
        if req.voto == "like" and movie:
            members = db.query(SalaMiembro.usuario_id).filter(SalaMiembro.sala_id == sala.id).all()
            member_ids = [m[0] for m in members]
            num_members = len(member_ids)
            
            # Contar cuántos miembros han dado LIKE a esta película en esta sala
            likes_count = db.query(Decision).filter(
                Decision.sala_id == sala.id,
                Decision.pelicula_id == req.pelicula_id,
                Decision.voto == "like",
                Decision.usuario_id.in_(member_ids)
            ).count()
            
            # Es Match si TODOS los integrantes han votado LIKE y hay al menos 2 miembros en la sala
            if likes_count == num_members and num_members >= 2:
                is_match = True
                
                # Registrar en HistorialMatch si es sala tipo pareja
                if sala.tipo == "pareja" and num_members == 2:
                    couple_key = min(member_ids[0], member_ids[1])
                    exists = db.query(HistorialMatch).filter(
                        HistorialMatch.pareja_id == couple_key,
                        HistorialMatch.pelicula_id == req.pelicula_id
                    ).first()
                    if not exists:
                        history_rec = HistorialMatch(
                            pareja_id=couple_key,
                            pelicula_id=req.pelicula_id,
                            fecha_match=date.today().isoformat(),
                            puntuacion_conjunta=0
                        )
                        db.add(history_rec)
                        # Guardar como match activo
                        db_pareja = db.query(Pareja).filter(Pareja.id == couple_key).first()
                        if not db_pareja:
                            db_pareja = Pareja(id=couple_key)
                            db.add(db_pareja)
                        db_pareja.match_activo_pelicula_id = req.pelicula_id
                        db.commit()
                
                # Notificar match vía WebSocket
                match_payload = {
                    "event": "MATCH_FOUND",
                    "movie": {
                        "id": movie.id,
                        "titulo": movie.titulo,
                        "sinopsis": movie.sinopsis,
                        "poster_url": movie.poster_url,
                        "backdrop_url": movie.backdrop_url,
                        "rating": movie.rating,
                        "tipo": "pelicula"
                    }
                }
                await manager.broadcast(match_payload, sala.codigo)

                # Enviar notificaciones Push nativas
                for uid in member_ids:
                    subs = db.query(PushSubscription).filter(PushSubscription.usuario_id == uid).all()
                    for sub in subs:
                        sub_info = {
                            "endpoint": sub.endpoint,
                            "keys": {"p256dh": sub.p256dh, "auth": sub.auth}
                        }
                        send_push_notification(
                            subscription_info=sub_info,
                            title="🍿 ¡Match en CineVerse!",
                            body=f"Los dos queréis ver '{movie.titulo}'. ¡Es una noche de cine!",
                            icon="/pwa-192x192.png",
                            data={"movie_id": movie.id, "titulo": movie.titulo, "tipo": "pelicula"}
                        )

    return {"match": is_match}

@app.get("/api/rooms/matches/{sala_codigo}")
def get_room_matches(sala_codigo: str, usuario_id: Optional[int] = None, db: Session = Depends(get_db)):
    sala = db.query(Sala).filter(Sala.codigo == sala_codigo.upper()).first()
    if not sala:
        raise HTTPException(status_code=404, detail="Sala no encontrada")
        
    members = db.query(SalaMiembro.usuario_id).filter(SalaMiembro.sala_id == sala.id).all()
    member_ids = [m[0] for m in members]
    num_members = len(member_ids)
    
    if num_members == 0:
        return []
        
    # Excluir películas/series vistas en pareja si es una sala de 2 integrantes (pareja)
    watched_movie_ids = []
    watched_series_ids = []
    if num_members == 2:
        couple_id = min(member_ids[0], member_ids[1])
        watched_movie_ids = [
            r[0] for r in db.execute(
                sqlalchemy.text("SELECT contenido_id FROM vistas_pareja WHERE pareja_id = :couple_id AND tipo = 'MOVIE'"),
                {"couple_id": couple_id}
            ).all()
        ]
        watched_series_ids = [
            r[0] for r in db.execute(
                sqlalchemy.text("SELECT contenido_id FROM vistas_pareja WHERE pareja_id = :couple_id AND tipo = 'SERIE'"),
                {"couple_id": couple_id}
            ).all()
        ]

    # Obtener vistos individuales del usuario actual
    user_watched_movie_ids = []
    user_watched_series_ids = []
    if usuario_id:
        user_watched_movie_ids = [
            r[0] for r in db.execute(
                sqlalchemy.text("SELECT contenido_id FROM vistas_usuario WHERE usuario_id = :user_id AND tipo = 'MOVIE'"),
                {"user_id": usuario_id}
            ).all()
        ]
        user_watched_series_ids = [
            r[0] for r in db.execute(
                sqlalchemy.text("SELECT contenido_id FROM vistas_usuario WHERE usuario_id = :user_id AND tipo = 'SERIE'"),
                {"user_id": usuario_id}
            ).all()
        ]

    if sala.categoria == "series":
        # Obtener series que tienen LIKE de todos los miembros en esta sala
        matched_series_q = db.query(Serie).join(DecisionSerie, DecisionSerie.serie_id == Serie.id).filter(
            DecisionSerie.sala_id == sala.id,
            DecisionSerie.voto == "like",
            DecisionSerie.usuario_id.in_(member_ids)
        )
        if watched_series_ids:
            matched_series_q = matched_series_q.filter(Serie.id.notin_(watched_series_ids))
        matched_series = matched_series_q.group_by(Serie.id).having(sqlalchemy.func.count(DecisionSerie.usuario_id) == num_members).all()
        
        return [{
            "id": s.id,
            "titulo": s.titulo,
            "sinopsis": s.sinopsis,
            "poster_url": s.poster_url,
            "backdrop_url": s.backdrop_url,
            "rating": s.rating,
            "genero": s.genero,
            "visto": s.id in user_watched_series_ids,
            "tipo": "serie"
        } for s in matched_series]
        
    # Obtener películas que tienen LIKE de todos los miembros en esta sala
    matched_movies_q = db.query(Pelicula).join(Decision, Decision.pelicula_id == Pelicula.id).filter(
        Decision.sala_id == sala.id,
        Decision.voto == "like",
        Decision.usuario_id.in_(member_ids)
    )
    if watched_movie_ids:
        matched_movies_q = matched_movies_q.filter(Pelicula.id.notin_(watched_movie_ids))
    matched_movies = matched_movies_q.group_by(Pelicula.id).having(sqlalchemy.func.count(Decision.usuario_id) == num_members).all()
    
    return [{
        "id": m.id,
        "titulo": m.titulo,
        "sinopsis": m.sinopsis,
        "poster_url": m.poster_url,
        "backdrop_url": m.backdrop_url,
        "rating": m.rating,
        "genero": m.genero,
        "visto": m.id in user_watched_movie_ids,
        "tipo": "pelicula"
    } for m in matched_movies]


# ---------------------------------------------------------------------------
# WebSocket Server (Generalized Room WebSocket)
# ---------------------------------------------------------------------------
class ConnectionManager:
    def __init__(self):
        # Mapea sala_codigo -> Dict[usuario_id, WebSocket]
        self.active_connections: Dict[str, Dict[int, WebSocket]] = {}

    async def connect(self, websocket: WebSocket, sala_codigo: str, usuario_id: int):
        await websocket.accept()
        if sala_codigo not in self.active_connections:
            self.active_connections[sala_codigo] = {}
        self.active_connections[sala_codigo][usuario_id] = websocket

    def disconnect(self, sala_codigo: str, usuario_id: int):
        if sala_codigo in self.active_connections:
            if usuario_id in self.active_connections[sala_codigo]:
                del self.active_connections[sala_codigo][usuario_id]
            if not self.active_connections[sala_codigo]:
                del self.active_connections[sala_codigo]

    async def send_to_user(self, message: dict, sala_codigo: str, usuario_id: int):
        if sala_codigo in self.active_connections:
            ws = self.active_connections[sala_codigo].get(usuario_id)
            if ws:
                try:
                    await ws.send_json(message)
                except Exception:
                    pass

    async def broadcast(self, message: dict, sala_codigo: str):
        if sala_codigo in self.active_connections:
            for ws in list(self.active_connections[sala_codigo].values()):
                try:
                    await ws.send_json(message)
                except Exception:
                    pass

    def get_online_users(self, sala_codigo: str) -> List[int]:
        if sala_codigo in self.active_connections:
            return list(self.active_connections[sala_codigo].keys())
manager = ConnectionManager()

@app.websocket("/ws/room/{sala_codigo}/{usuario_id}")
async def websocket_room_endpoint(websocket: WebSocket, sala_codigo: str, usuario_id: int, db: Session = Depends(get_db)):
    sala = db.query(Sala).filter(Sala.codigo == sala_codigo.upper()).first()
    user = db.query(Usuario).filter(Usuario.id == usuario_id).first()
    if not sala or not user:
        await websocket.close(code=1008)
        return

    await manager.connect(websocket, sala.codigo, usuario_id)

    try:
        # Notificar a todos que un miembro se ha conectado
        online_ids = manager.get_online_users(sala.codigo)
        await manager.broadcast({
            "event": "PARTNER_STATUS",
            "online_users": online_ids,
            "connected": True,
            "user_id": usuario_id
        }, sala.codigo)

        while True:
            data = await websocket.receive_json()
            event_type = data.get("type")
            pelicula_id = data.get("pelicula_id") or data.get("serie_id")
            
            if event_type == "START_VOTING":
                db_session = SessionLocal()
                try:
                    current_sala = db_session.query(Sala).filter(Sala.codigo == sala.codigo).first()
                    if current_sala and current_sala.creador_id == usuario_id:
                        current_sala.voting_started = True
                        db_session.commit()
                        await manager.broadcast({
                            "event": "VOTING_STARTED"
                        }, sala.codigo)
                except Exception as e:
                    print(f"[WS ERROR] Error al iniciar votación: {e}")
                finally:
                    db_session.close()

            elif event_type == "REACTION":
                emoji = data.get("emoji")
                if emoji:
                    for other_user_id, other_ws in manager.active_connections.get(sala.codigo, {}).items():
                        if other_user_id != usuario_id:
                            try:
                                await other_ws.send_json({
                                    "event": "REACTION",
                                    "type": "REACTION",
                                    "emoji": emoji,
                                    "user_id": usuario_id
                                })
                            except Exception:
                                pass

            elif event_type in ["LIKE", "DISLIKE"] and pelicula_id:
                voto = "like" if event_type == "LIKE" else "dislike"

                
                # Crear sesión de DB limpia utilizando SessionLocal
                db_session = SessionLocal()
                try:
                    # check room category
                    current_sala = db_session.query(Sala).filter(Sala.id == sala.id).first()
                    is_tv = (current_sala.categoria == "series") if current_sala else False
                    
                    if is_tv:
                        # Registrar la decisión de serie en la DB
                        existing = db_session.query(DecisionSerie).filter(
                            DecisionSerie.usuario_id == usuario_id,
                            DecisionSerie.serie_id == pelicula_id,
                            DecisionSerie.sala_id == sala.id
                        ).first()
                        
                        if not existing:
                            decision = DecisionSerie(
                                usuario_id=usuario_id,
                                serie_id=pelicula_id,
                                voto=voto,
                                sala_id=sala.id
                            )
                            db_session.add(decision)
                        else:
                            existing.voto = voto
                        db_session.commit()
                        
                        # Confirmar voto al propio cliente
                        await websocket.send_json({
                            "event": "VOTE_ACK",
                            "serie_id": pelicula_id,
                            "voto": voto
                        })
                        
                        # Comprobar si hay MATCH de serie
                        is_match = False
                        serie = db_session.query(Serie).filter(Serie.id == pelicula_id).first()
                        
                        if voto == "like" and serie:
                            members = db_session.query(SalaMiembro.usuario_id).filter(SalaMiembro.sala_id == sala.id).all()
                            member_ids = [m[0] for m in members]
                            num_members = len(member_ids)
                            
                            # Contar cuántos miembros han dado LIKE a esta serie en esta sala
                            likes_count = db_session.query(DecisionSerie).filter(
                                DecisionSerie.sala_id == sala.id,
                                DecisionSerie.serie_id == pelicula_id,
                                DecisionSerie.voto == "like",
                                DecisionSerie.usuario_id.in_(member_ids)
                            ).count()
                            
                            # En sala de pareja o grupo, es Match si todos los miembros votaron LIKE (mínimo 2 integrantes)
                            if likes_count == num_members and num_members >= 2:
                                is_match = True
                                
                                # Registrar en HistorialMatchSerie si es sala tipo pareja
                                if sala.tipo == "pareja" and num_members == 2:
                                    couple_key = min(member_ids[0], member_ids[1])
                                    exists = db_session.query(HistorialMatchSerie).filter(
                                        HistorialMatchSerie.pareja_id == couple_key,
                                        HistorialMatchSerie.serie_id == pelicula_id
                                    ).first()
                                    if not exists:
                                        history_rec = HistorialMatchSerie(
                                            pareja_id=couple_key,
                                            serie_id=pelicula_id,
                                            fecha_match=date.today().isoformat(),
                                            puntuacion_conjunta=0
                                        )
                                        db_session.add(history_rec)
                                        # Guardar como match activo
                                        db_pareja = db_session.query(Pareja).filter(Pareja.id == couple_key).first()
                                        if not db_pareja:
                                            db_pareja = Pareja(id=couple_key)
                                            db_session.add(db_pareja)
                                        db_pareja.match_activo_serie_id = pelicula_id
                                        db_session.commit()
                                
                                # Notificar match vía WebSocket a todos los miembros de la sala
                                match_payload = {
                                    "event": "MATCH_FOUND",
                                    "movie": {
                                        "id": serie.id,
                                        "titulo": serie.titulo,
                                        "sinopsis": serie.sinopsis,
                                        "poster_url": serie.poster_url,
                                        "backdrop_url": serie.backdrop_url,
                                        "rating": serie.rating,
                                        "tipo": "serie"
                                    }
                                }
                                await manager.broadcast(match_payload, sala.codigo)
    
                                # Enviar notificaciones Push nativas a todos los miembros
                                for uid in member_ids:
                                    push_subs = db_session.query(PushSubscription).filter(
                                        PushSubscription.usuario_id == uid
                                    ).all()
                                    for sub in push_subs:
                                        sub_info = {
                                            "endpoint": sub.endpoint,
                                            "keys": {"p256dh": sub.p256dh, "auth": sub.auth}
                                        }
                                        result = send_push_notification(
                                            subscription_info=sub_info,
                                            title="📺 ¡Match en CineVerse!",
                                            body=f"Los dos queréis ver la serie '{serie.titulo}'. ¡Preparad las palomitas!",
                                            icon="/pwa-192x192.png",
                                            data={"serie_id": serie.id, "titulo": serie.titulo, "tipo": "serie"}
                                        )
                                        if result == "expired":
                                            db_session.delete(sub)
                                            db_session.commit()
                    else:
                        # Registrar la decisión de película en la DB
                        existing = db_session.query(Decision).filter(
                            Decision.usuario_id == usuario_id,
                            Decision.pelicula_id == pelicula_id,
                            Decision.sala_id == sala.id
                        ).first()
                        
                        if not existing:
                            decision = Decision(
                                usuario_id=usuario_id,
                                pelicula_id=pelicula_id,
                                voto=voto,
                                sala_id=sala.id
                            )
                            db_session.add(decision)
                        else:
                            existing.voto = voto
                        db_session.commit()
                        
                        # Confirmar voto al propio cliente
                        await websocket.send_json({
                            "event": "VOTE_ACK",
                            "pelicula_id": pelicula_id,
                            "voto": voto
                        })
                        
                        # Comprobar si hay MATCH
                        is_match = False
                        movie = db_session.query(Pelicula).filter(Pelicula.id == pelicula_id).first()
                        
                        if voto == "like" and movie:
                            members = db_session.query(SalaMiembro.usuario_id).filter(SalaMiembro.sala_id == sala.id).all()
                            member_ids = [m[0] for m in members]
                            num_members = len(member_ids)
                            
                            # Contar cuántos miembros han dado LIKE a esta película en esta sala
                            likes_count = db_session.query(Decision).filter(
                                Decision.sala_id == sala.id,
                                Decision.pelicula_id == pelicula_id,
                                Decision.voto == "like",
                                Decision.usuario_id.in_(member_ids)
                            ).count()
                            
                            # En sala de pareja o grupo, es Match si todos los miembros votaron LIKE (mínimo 2 integrantes)
                            if likes_count == num_members and num_members >= 2:
                                is_match = True
                                
                                # Registrar en HistorialMatch si es sala tipo pareja
                                if sala.tipo == "pareja" and num_members == 2:
                                    couple_key = min(member_ids[0], member_ids[1])
                                    exists = db_session.query(HistorialMatch).filter(
                                        HistorialMatch.pareja_id == couple_key,
                                        HistorialMatch.pelicula_id == pelicula_id
                                    ).first()
                                    if not exists:
                                        history_rec = HistorialMatch(
                                            pareja_id=couple_key,
                                            pelicula_id=pelicula_id,
                                            fecha_match=date.today().isoformat(),
                                            puntuacion_conjunta=0
                                        )
                                        db_session.add(history_rec)
                                        # Guardar como match activo
                                        db_pareja = db_session.query(Pareja).filter(Pareja.id == couple_key).first()
                                        if not db_pareja:
                                            db_pareja = Pareja(id=couple_key)
                                            db_session.add(db_pareja)
                                        db_pareja.match_activo_pelicula_id = pelicula_id
                                        db_session.commit()
                                
                                # Notificar match vía WebSocket a todos los miembros de la sala
                                match_payload = {
                                    "event": "MATCH_FOUND",
                                    "movie": {
                                        "id": movie.id,
                                        "titulo": movie.titulo,
                                        "sinopsis": movie.sinopsis,
                                        "poster_url": movie.poster_url,
                                        "backdrop_url": movie.backdrop_url,
                                        "rating": movie.rating,
                                        "tipo": "pelicula"
                                    }
                                }
                                await manager.broadcast(match_payload, sala.codigo)
    
                                # Enviar notificaciones Push nativas a todos los miembros
                                for uid in member_ids:
                                    push_subs = db_session.query(PushSubscription).filter(
                                        PushSubscription.usuario_id == uid
                                    ).all()
                                    for sub in push_subs:
                                        sub_info = {
                                            "endpoint": sub.endpoint,
                                            "keys": {"p256dh": sub.p256dh, "auth": sub.auth}
                                        }
                                        result = send_push_notification(
                                            subscription_info=sub_info,
                                            title="🍿 ¡Match en CineVerse!",
                                            body=f"Los dos queréis ver '{movie.titulo}'. ¡Es una noche de cine!",
                                            icon="/pwa-192x192.png",
                                            data={"movie_id": movie.id, "titulo": movie.titulo, "tipo": "pelicula"}
                                        )
                                        if result == "expired":
                                            db_session.delete(sub)
                                            db_session.commit()
                except Exception as e:
                    print(f"[WS ERROR] Error al procesar voto: {e}")
                finally:
                    db_session.close()

    except WebSocketDisconnect:
        manager.disconnect(sala.codigo, usuario_id)
        # Notificar desconexión
        online_ids = manager.get_online_users(sala.codigo)
        await manager.broadcast({
            "event": "PARTNER_STATUS",
            "online_users": online_ids,
            "connected": False,
            "user_id": usuario_id
        }, sala.codigo)

# Proxy WebSocket compatible con la versión anterior para evitar rotura súbita
@app.websocket("/ws/{pareja_id}/{usuario_id}")
async def websocket_legacy_endpoint(websocket: WebSocket, pareja_id: str, usuario_id: int, db: Session = Depends(get_db)):
    user = db.query(Usuario).filter(Usuario.id == usuario_id).first()
    if not user:
        await websocket.close(code=1008)
        return
        
    # Crear código de sala legacy ficticio basado en IDs
    sala_codigo = f"LEGACY-{min(user.id, int(pareja_id))}"
    await websocket.accept()
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass


# ---------------------------------------------------------------------------
# Endpoints de Notificaciones Push (Web Push / VAPID)
# ---------------------------------------------------------------------------
@app.get("/api/notifications/vapid-public-key")
def get_vapid_public_key():
    """
    Retorna la clave pública VAPID para que el frontend pueda suscribirse a notificaciones push.
    """
    return {"publicKey": VAPID_PUBLIC_KEY}

@app.post("/api/notifications/subscribe")
def subscribe_push(
    req: PushSubscribeRequest,
    current_user: Usuario = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Almacena la suscripción Web Push del navegador del usuario.
    Si ya existe un endpoint igual, lo actualiza con las nuevas claves.
    """
    existing = db.query(PushSubscription).filter(
        PushSubscription.endpoint == req.endpoint
    ).first()
    
    if existing:
        # Actualizar claves si el endpoint ya estaba registrado
        existing.p256dh = req.p256dh
        existing.auth = req.auth
        existing.usuario_id = current_user.id
    else:
        new_sub = PushSubscription(
            usuario_id=current_user.id,
            endpoint=req.endpoint,
            p256dh=req.p256dh,
            auth=req.auth
        )
        db.add(new_sub)
    
    db.commit()
    return {"status": "subscribed", "message": "Suscripción push registrada correctamente."}

@app.delete("/api/notifications/unsubscribe")
def unsubscribe_push(
    endpoint: str,
    current_user: Usuario = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Elimina la suscripción push de un endpoint específico.
    """
    sub = db.query(PushSubscription).filter(
        PushSubscription.endpoint == endpoint,
        PushSubscription.usuario_id == current_user.id
    ).first()
    if sub:
        db.delete(sub)
        db.commit()
    return {"status": "unsubscribed"}

# ---------------------------------------------------------------------------
# Endpoints de Historial de Citas (Timeline)
# ---------------------------------------------------------------------------
@app.get("/api/couples/stats/{usuario_id}")
def get_couples_stats(usuario_id: int, db: Session = Depends(get_db)):
    user = db.query(Usuario).filter(Usuario.id == usuario_id).first()
    if not user or not user.pareja_id:
        return {
            "is_paired": False,
            "compatibility": 84,
            "matches_count": 0,
            "total_likes": 0,
            "top_genres": [
                {"name": "Ciencia Ficción 🤖", "pct": 90, "colorClass": "bg-pink-500 shadow-pink-500/25"},
                {"name": "Acción 💥", "pct": 75, "colorClass": "bg-cyan-500 shadow-cyan-500/25"},
                {"name": "Drama 🎭", "pct": 60, "colorClass": "bg-emerald-500 shadow-emerald-500/25"}
            ]
        }

    user_ids = [user.id, user.pareja_id]

    likes_movies = db.query(Decision).filter(Decision.usuario_id.in_(user_ids), Decision.voto == "like").count()
    likes_series = db.query(DecisionSerie).filter(DecisionSerie.usuario_id.in_(user_ids), DecisionSerie.voto == "like").count()
    total_likes = likes_movies + likes_series

    matched_movies_count = db.query(Decision.pelicula_id).filter(
        Decision.usuario_id.in_(user_ids),
        Decision.voto == "like"
    ).group_by(Decision.pelicula_id).having(sqlalchemy.func.count(Decision.usuario_id) == 2).count()

    matched_series_count = db.query(DecisionSerie.serie_id).filter(
        DecisionSerie.usuario_id.in_(user_ids),
        DecisionSerie.voto == "like"
    ).group_by(DecisionSerie.serie_id).having(sqlalchemy.func.count(DecisionSerie.usuario_id) == 2).count()

    matches_count = matched_movies_count + matched_series_count

    compatibility = 0
    if total_likes > 0:
        compatibility = min(100, int((matches_count / max(1, total_likes / 2)) * 100))
        if matches_count > 0 and compatibility < 15:
            compatibility = 15
    else:
        compatibility = 50

    matched_movies = db.query(Pelicula).join(Decision, Decision.pelicula_id == Pelicula.id).filter(
        Decision.usuario_id.in_(user_ids),
        Decision.voto == "like"
    ).group_by(Pelicula.id).having(sqlalchemy.func.count(Decision.usuario_id) == 2).all()

    matched_series = db.query(Serie).join(DecisionSerie, DecisionSerie.serie_id == Serie.id).filter(
        DecisionSerie.usuario_id.in_(user_ids),
        DecisionSerie.voto == "like"
    ).group_by(Serie.id).having(sqlalchemy.func.count(DecisionSerie.usuario_id) == 2).all()

    genres_count = {}
    for m in matched_movies:
        if m.genero:
            genres_count[m.genero] = genres_count.get(m.genero, 0) + 1
    for s in matched_series:
        if s.genero:
            genres_count[s.genero] = genres_count.get(s.genero, 0) + 1

    total_genres_matches = sum(genres_count.values())
    top_genres = []

    genre_emojis = {
        "Acción": "💥", "Ciencia Ficción": "🤖", "Sci-Fi": "🤖", "Drama": "🎭",
        "Comedia": "😂", "Terror": "😱", "Aventura": "🗺️", "Animación": "🦄",
        "Fantasía": "🔮", "Misterio": "🕵️", "Romance": "💖", "Suspense": "🤫",
        "Thriller": "🔪", "Crimen": "🕵️"
    }

    color_configs = [
        {"colorClass": "bg-pink-500 shadow-pink-500/25"},
        {"colorClass": "bg-cyan-500 shadow-cyan-500/25"},
        {"colorClass": "bg-emerald-500 shadow-emerald-500/25"},
        {"colorClass": "bg-amber-500 shadow-amber-500/25"},
        {"colorClass": "bg-indigo-500 shadow-indigo-500/25"}
    ]

    sorted_genres = sorted(genres_count.items(), key=lambda x: x[1], reverse=True)

    for idx, (gen, count) in enumerate(sorted_genres[:3]):
        emoji = genre_emojis.get(gen, "🎬")
        pct = int((count / total_genres_matches) * 100) if total_genres_matches > 0 else 0
        color_info = color_configs[idx % len(color_configs)]
        top_genres.append({
            "name": f"{gen} {emoji}",
            "pct": pct,
            "colorClass": color_info["colorClass"]
        })

    fallback_genres = [
        {"name": "Ciencia Ficción 🤖", "pct": 85, "colorClass": "bg-pink-500 shadow-pink-500/25"},
        {"name": "Acción 💥", "pct": 65, "colorClass": "bg-cyan-500 shadow-cyan-500/25"},
        {"name": "Drama 🎭", "pct": 50, "colorClass": "bg-emerald-500 shadow-emerald-500/25"}
    ]

    for i in range(len(top_genres), 3):
        top_genres.append(fallback_genres[i])

    return {
        "is_paired": True,
        "compatibility": compatibility,
        "matches_count": matches_count,
        "total_likes": total_likes,
        "top_genres": top_genres
    }

class RateRequest(BaseModel):
    history_id: int
    puntuacion: int

@app.get("/api/history/{pareja_id}")
def get_history(pareja_id: int, categoria: str = "peliculas", db: Session = Depends(get_db)):
    user = db.query(Usuario).filter(Usuario.id == pareja_id).first()
    if user and user.tiene_pareja:
        couple_key = min(user.id, user.pareja_id)
    else:
        couple_key = pareja_id

    if categoria == "series":
        history = db.query(HistorialMatchSerie).filter(
            HistorialMatchSerie.pareja_id == couple_key
        ).all()
        
        result = []
        for h in history:
            result.append({
                "id": h.id,
                "serie_id": h.serie_id,
                "titulo": h.serie.titulo,
                "poster_url": h.serie.poster_url,
                "fecha_match": h.fecha_match,
                "puntuacion_conjunta": h.puntuacion_conjunta,
                "tipo": "serie"
            })
        return result

    history = db.query(HistorialMatch).filter(
        HistorialMatch.pareja_id == couple_key
    ).all()
    
    result = []
    for h in history:
        result.append({
            "id": h.id,
            "pelicula_id": h.pelicula_id,
            "titulo": h.pelicula.titulo,
            "poster_url": h.pelicula.poster_url,
            "fecha_match": h.fecha_match,
            "puntuacion_conjunta": h.puntuacion_conjunta,
            "tipo": "pelicula"
        })
    return result

@app.post("/api/history/rate")
def rate_history(req: RateRequest, categoria: str = "peliculas", db: Session = Depends(get_db)):
    if categoria == "series":
        record = db.query(HistorialMatchSerie).filter(HistorialMatchSerie.id == req.history_id).first()
    else:
        record = db.query(HistorialMatch).filter(HistorialMatch.id == req.history_id).first()
        
    if not record:
        raise HTTPException(status_code=404, detail="Registro de historial no encontrado")
        
    if req.puntuacion < 1 or req.puntuacion > 5:
        raise HTTPException(status_code=400, detail="La puntuación debe estar entre 1 y 5 estrellas")
        
    record.puntuacion_conjunta = req.puntuacion
    db.commit()
    return {"status": "success", "message": "Puntuación de cita guardada correctamente"}


# ---------------------------------------------------------------------------
# Endpoints de Agenda de Calendarios (Google & Apple)
# ---------------------------------------------------------------------------
@app.post("/api/calendar/schedule")
async def schedule_event(req: ScheduleRequest, current_user: Usuario = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Agenda una cita. 
    Si google_token está presente, la añade a Google Calendar.
    En caso contrario, retorna información para descargar un archivo iCal (.ics) en el cliente.
    """
    # Notificar a los demás miembros de la sala por WS y Push
    if req.sala_codigo:
        sala = db.query(Sala).filter(Sala.codigo == req.sala_codigo.upper()).first()
        if sala:
            # Broadcast por WebSocket
            await manager.broadcast({
                "event": "DATE_SCHEDULED",
                "movie_titulo": req.pelicula_titulo,
                "fecha_iso": req.fecha_iso,
                "scheduled_by": current_user.name
            }, sala.codigo)
            
            # Intentar formatear fecha
            try:
                dt = datetime.fromisoformat(req.fecha_iso.replace("Z", ""))
                fecha_legible = dt.strftime("%d/%m/%Y a las %H:%M")
            except:
                fecha_legible = req.fecha_iso
                
            # Buscar otros miembros para mandar push
            members = db.query(SalaMiembro.usuario_id).filter(
                SalaMiembro.sala_id == sala.id,
                SalaMiembro.usuario_id != current_user.id
            ).all()
            
            for m in members:
                push_subs = db.query(PushSubscription).filter(
                    PushSubscription.usuario_id == m.usuario_id
                ).all()
                for sub in push_subs:
                    sub_info = {
                        "endpoint": sub.endpoint,
                        "keys": {"p256dh": sub.p256dh, "auth": sub.auth}
                    }
                    send_push_notification(
                        subscription_info=sub_info,
                        title="📅 ¡Cita de Película!",
                        body=f"{current_user.name} ha propuesto ver '{req.pelicula_titulo}' el {fecha_legible}.",
                        icon="/pwa-192x192.png",
                        data={"movie_title": req.pelicula_titulo}
                    )

    if req.google_token:
        result = await schedule_google_calendar_event(
            titulo_pelicula=req.pelicula_titulo,
            fecha_iso=req.fecha_iso,
            access_token=req.google_token
        )
        return result
        
    # Si no usa Google, el frontend descargará el .ics.
    return {
        "status": "ics",
        "message": "Archivo de calendario listo para descargar.",
        "ics_url": f"/api/calendar/ics?titulo={req.pelicula_titulo}&fecha={req.fecha_iso}"
    }

@app.get("/api/calendar/ics")
def download_ics(titulo: str, fecha: str):
    """
    Genera y sirve el archivo de calendario en formato estándar .ics para Apple Calendar / Outlook.
    """
    content = generate_ics_content(titulo_pelicula=titulo, fecha_iso=fecha)
    return Response(
        content=content,
        media_type="text/calendar",
        headers={
            "Content-Disposition": f"attachment; filename=cita_cinematch_{titulo.replace(' ', '_')}.ics"
        }
    )


# ---------------------------------------------------------------------------
# Endpoint Telemetría (SRE)
# ---------------------------------------------------------------------------
@app.get("/api/admin/telemetry")
def get_telemetry(
    current_user: Usuario = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    total_requests = db.query(SystemLog).count()
    if total_requests == 0:
        pool = engine.pool
        pool_info = {
            "pool_class": pool.__class__.__name__,
            "pool_size": getattr(pool, "_size", 5) if hasattr(pool, "_size") else 5,
            "checkedout": pool.checkedout() if hasattr(pool, "checkedout") else 0,
            "checkedin": pool.checkedin() if hasattr(pool, "checkedin") else 0,
            "overflow": pool.overflow() if hasattr(pool, "overflow") else 0,
        }
        return {
            "total_requests": 0,
            "error_rate": 0.0,
            "error_count": 0,
            "avg_latency_s": 0.0,
            "p95_latency_s": 0.0,
            "max_latency_s": 0.0,
            "database_pool": pool_info,
            "endpoints": {},
            "recent_logs": []
        }

    logs = db.query(SystemLog).order_by(SystemLog.id.desc()).limit(150).all()
    error_count = db.query(SystemLog).filter(SystemLog.status_code >= 400).count()
    error_rate = round((error_count / total_requests * 100), 2)
    
    response_times = [l.response_time for l in logs if l.response_time is not None]
    if response_times:
        avg_latency = sum(response_times) / len(response_times)
        max_latency = max(response_times)
        sorted_times = sorted(response_times)
        p95_idx = int(len(sorted_times) * 0.95)
        p95_latency = sorted_times[p95_idx] if p95_idx < len(sorted_times) else sorted_times[-1]
    else:
        avg_latency = 0.0
        max_latency = 0.0
        p95_latency = 0.0

    endpoint_stats = {}
    for log in logs:
        key = f"{log.method} {log.path}"
        if key not in endpoint_stats:
            endpoint_stats[key] = {"count": 0, "avg_time": 0.0, "times": []}
        endpoint_stats[key]["count"] += 1
        endpoint_stats[key]["times"].append(log.response_time)

    for key, stat in endpoint_stats.items():
        stat["avg_time"] = round(sum(stat["times"]) / len(stat["times"]), 4)
        del stat["times"]

    pool = engine.pool
    pool_info = {
        "pool_class": pool.__class__.__name__,
        "pool_size": getattr(pool, "_size", 5) if hasattr(pool, "_size") else 5,
        "checkedout": pool.checkedout() if hasattr(pool, "checkedout") else 0,
        "checkedin": pool.checkedin() if hasattr(pool, "checkedin") else 0,
        "overflow": pool.overflow() if hasattr(pool, "overflow") else 0,
    }

    return {
        "total_requests": total_requests,
        "error_rate": error_rate,
        "error_count": error_count,
        "avg_latency_s": round(avg_latency, 4),
        "p95_latency_s": round(p95_latency, 4),
        "max_latency_s": round(max_latency, 4),
        "database_pool": pool_info,
        "endpoints": endpoint_stats,
        "recent_logs": [
            {
                "id": l.id,
                "timestamp": l.timestamp,
                "path": l.path,
                "method": l.method,
                "status_code": l.status_code,
                "response_time_s": l.response_time,
                "client_ip": l.client_ip,
                "error_message": l.error_message[:150] + "..." if l.error_message and len(l.error_message) > 150 else l.error_message
            }
            for l in logs[:20]
        ]
    }


# ==========================================================================
# 📍 CINES CERCANOS Y SESIONES (GEOLOCALIZACIÓN)
# ==========================================================================
from typing import List, Optional

class CinemasNearbyRequest(BaseModel):
    latitud: Optional[float] = None
    longitud: Optional[float] = None
    movie_id: Optional[int] = None
    duracion: Optional[int] = None

class SessionTime(BaseModel):
    fecha: str
    hora: str
    version: str = "Estándar"
    compra_url: str
    fuente: str = "FilmAffinity"

class CinemaResponse(BaseModel):
    nombre: str
    distancia: float
    horarios: List[SessionTime]
    mapa_url: str
    cartelera_url: Optional[str] = None
    web_oficial_url: Optional[str] = None
    sesiones_estado: str = "no_sessions"
    actualizado_en: Optional[str] = None
    fecha_estreno: Optional[str] = None

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    import math
    R = 6371.0  # Radio de la Tierra en km
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def get_request_ip(request: Request) -> Optional[str]:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()
    return request.client.host if request.client else None

def geolocate_request_ip(request: Request) -> tuple[float, float]:
    import ipaddress
    import requests

    client_ip = get_request_ip(request)
    lookup_url = "https://ipwho.is/"

    if client_ip:
        try:
            if not ipaddress.ip_address(client_ip).is_private:
                lookup_url = f"https://ipwho.is/{client_ip}"
        except ValueError:
            pass

    response = requests.get(lookup_url, timeout=10)
    response.raise_for_status()
    location = response.json()
    lat = location.get("latitude")
    lon = location.get("longitude")
    if not location.get("success", True) or lat is None or lon is None:
        raise ValueError(location.get("message", "Respuesta de geolocalización no válida"))
    return float(lat), float(lon)

def reverse_geocode_province(lat: float, lon: float) -> str:
    cache_key = f"geo:province:{round(lat, 2)}:{round(lon, 2)}"
    try:
        cached = redis_client.get(cache_key)
        if cached:
            return cached
    except Exception:
        pass

    response = httpx.get(
        "https://nominatim.openstreetmap.org/reverse",
        params={
            "lat": lat,
            "lon": lon,
            "format": "jsonv2",
            "addressdetails": 1,
            "zoom": 8,
        },
        headers={"User-Agent": "CineVerse university project/1.0"},
        timeout=12.0,
    )
    response.raise_for_status()
    address = response.json().get("address", {})
    province_code = address.get("ISO3166-2-lvl6")
    if not province_code:
        province_code = next(
            (
                value
                for key, value in address.items()
                if key.startswith("ISO3166-2") and isinstance(value, str) and value.startswith("ES-")
            ),
            None,
        )
    if not province_code:
        raise ValueError("Nominatim no devolvió un código provincial español")
    try:
        redis_client.setex(cache_key, 86400, province_code)
    except Exception:
        pass
    return province_code

def get_cached_nearby_cinemas(lat: float, lon: float) -> List[dict]:
    import requests

    zone = f"{round(lat, 2)}:{round(lon, 2)}"
    cache_key = f"geo:cinemas:v1:{zone}"
    stale_key = f"{cache_key}:stale"

    def read_cache(key: str) -> Optional[List[dict]]:
        try:
            value = redis_client.get(key)
            return json.loads(value) if value else None
        except Exception as exc:
            print(f"[REDIS] Error leyendo {key}: {exc}")
            return None

    def with_distances(cinemas: List[dict]) -> List[dict]:
        return [
            {
                **cinema,
                "distancia": haversine_distance(
                    lat, lon, cinema["lat"], cinema["lon"]
                ),
            }
            for cinema in cinemas
        ]

    cached = read_cache(cache_key)
    if cached is not None:
        print(f"[OVERPASS] Cache HIT para zona {zone}")
        return with_distances(cached)

    lock = None
    try:
        lock = redis_client.lock(
            f"{cache_key}:lock",
            timeout=90,
            blocking_timeout=65,
        )
        acquired = lock.acquire(blocking=True)
    except Exception as exc:
        print(f"[REDIS] No se pudo crear el bloqueo de Overpass: {exc}")
        acquired = False

    try:
        if acquired:
            cached = read_cache(cache_key)
            if cached is not None:
                print(f"[OVERPASS] Cache HIT tras espera para zona {zone}")
                return with_distances(cached)

        overpass_query = f"""
            [out:json][timeout:12];
            (
              nwr["amenity"="cinema"](around:20000, {lat}, {lon});
            );
            out center;
        """
        overpass_urls = [
            "https://overpass-api.de/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter",
            "https://overpass.private.coffee/api/interpreter",
        ]
        headers = {
            "Accept": "application/json",
            "User-Agent": "CineVerse university project/1.0",
        }
        last_error = None
        cinemas = []
        for overpass_url in overpass_urls:
            try:
                response = requests.get(
                    overpass_url,
                    params={"data": overpass_query},
                    headers=headers,
                    timeout=18,
                )
                response.raise_for_status()
                for elem in response.json().get("elements", []):
                    name = elem.get("tags", {}).get("name")
                    c_lat = elem.get("lat") or elem.get("center", {}).get("lat")
                    c_lon = elem.get("lon") or elem.get("center", {}).get("lon")
                    if name and c_lat is not None and c_lon is not None:
                        cinemas.append({
                            "nombre": name,
                            "lat": float(c_lat),
                            "lon": float(c_lon),
                        })
                last_error = None
                break
            except Exception as exc:
                last_error = exc
                print(f"Error querying Overpass API ({overpass_url}): {exc}")

        if last_error is not None:
            stale = read_cache(stale_key)
            if stale is not None:
                print(f"[OVERPASS] Usando caché de respaldo para zona {zone}")
                return with_distances(stale)
            raise HTTPException(
                status_code=502,
                detail="El servicio de mapas no está disponible temporalmente. Inténtalo de nuevo."
            )

        unique = {}
        for cinema in cinemas:
            normalized_name = " ".join(cinema["nombre"].lower().split())
            current = unique.get(normalized_name)
            distance = haversine_distance(lat, lon, cinema["lat"], cinema["lon"])
            if current is None or distance < current["distance"]:
                unique[normalized_name] = {"cinema": cinema, "distance": distance}
        cinema_data = [item["cinema"] for item in unique.values()]

        try:
            serialized = json.dumps(cinema_data)
            redis_client.setex(cache_key, 86400, serialized)
            redis_client.setex(stale_key, 604800, serialized)
            print(f"[OVERPASS] Cache STORE para zona {zone}")
        except Exception as exc:
            print(f"[REDIS] Error guardando cines para zona {zone}: {exc}")
        return with_distances(cinema_data)
    finally:
        if acquired and lock:
            try:
                lock.release()
            except Exception:
                pass

@app.post("/api/cinemas/nearby", response_model=List[CinemaResponse])
def get_nearby_cinemas(
    req: CinemasNearbyRequest,
    request: Request,
    db: Session = Depends(get_db)
):
    if req.latitud is not None and req.longitud is not None:
        lat = req.latitud
        lon = req.longitud
    else:
        try:
            lat, lon = geolocate_request_ip(request)
        except Exception as e:
            print(f"Error geolocating request IP: {e}")
            raise HTTPException(
                status_code=503,
                detail="No se pudo determinar la ubicación de tu IP pública."
            )
    if req.movie_id is None:
        raise HTTPException(status_code=422, detail="movie_id es obligatorio")
    movie = db.query(Pelicula).filter(Pelicula.id == req.movie_id).first()
    if not movie:
        raise HTTPException(status_code=404, detail="Película no encontrada")
    if not movie.en_cartelera and not movie.proximo_estreno:
        raise HTTPException(status_code=404, detail="SHOWTIMES_NOT_APPLICABLE")
    
    # 1. Obtener cines reales de OpenStreetMap, reutilizando caché geográfica.
    cinemas_found = sorted(
        get_cached_nearby_cinemas(lat, lon),
        key=lambda cinema: cinema["distancia"],
    )[:5]
    
    if not cinemas_found:
        return []

    try:
        province_code = reverse_geocode_province(lat, lon)
    except Exception as e:
        print(f"Error reverse geocoding province: {e}")
        province_code = "ES-AL" if haversine_distance(lat, lon, 36.83407, -2.46372) < 100 else ""

    showtime_cache_key = f"showtimes:{movie.id}:{province_code}:{round(lat, 2)}:{round(lon, 2)}"
    showtime_result = None
    try:
        cached = redis_client.get(showtime_cache_key)
        if cached:
            showtime_result = json.loads(cached)
    except Exception:
        pass

    if showtime_result is None and province_code:
        showtime_result = _post_scraper("/scrape/showtimes", {
            "movie": {
                "id": movie.id,
                "titulo": movie.titulo,
                "titulo_original": movie.titulo_original,
                "fecha_estreno": movie.fecha_estreno,
                "duracion": movie.duracion,
            },
            "province_code": province_code,
            "cinemas": [{"nombre": cinema["nombre"]} for cinema in cinemas_found],
            "days": 3,
        })
        if showtime_result:
            try:
                has_source_error = any(
                    cinema.get("sesiones_estado") == "source_unavailable"
                    for cinema in showtime_result.get("cinemas", [])
                )
                redis_client.setex(
                    showtime_cache_key,
                    120 if has_source_error else 1800,
                    json.dumps(showtime_result),
                )
            except Exception:
                pass

    updated_at = (
        (showtime_result or {}).get("updated_at")
        or datetime.now().astimezone().isoformat()
    )
    scraped_by_name = {
        item["nombre"]: item
        for item in (showtime_result or {}).get("cinemas", [])
    }
    response_data = []
    for cinema in cinemas_found:
        scraped = scraped_by_name.get(cinema["nombre"], {})
        schedules = scraped.get("horarios", [])
        state = scraped.get("sesiones_estado", "source_unavailable")
        if movie.proximo_estreno and not schedules and state == "no_sessions":
            state = "presale_unavailable"
        response_data.append(CinemaResponse(
            nombre=cinema["nombre"],
            distancia=cinema["distancia"],
            horarios=[SessionTime(**schedule) for schedule in schedules],
            mapa_url=(
                "https://www.google.com/maps/search/?api=1"
                f"&query={cinema['lat']},{cinema['lon']}"
            ),
            cartelera_url=scraped.get("cartelera_url"),
            web_oficial_url=scraped.get("web_oficial_url"),
            sesiones_estado=state,
            actualizado_en=updated_at,
            fecha_estreno=movie.fecha_estreno,
        ))
    return response_data
