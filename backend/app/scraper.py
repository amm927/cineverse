"""
AVISO: Este módulo ha sido migrado al microservicio independiente 'cineverse-scraper-service'.

Toda la lógica de scraping (TMDB, Google News, TextBlob NLP) ahora reside en:
  backend-scraper/main.py

El API Gateway (backend/app/main.py) se comunica con dicho servicio mediante:
  SCRAPER_SERVICE_URL = os.environ.get("SCRAPER_SERVICE_URL", "http://backend-scraper:8001")

Este archivo se conserva únicamente para compatibilidad durante la transición
y no contiene lógica activa.
"""

raise ImportError(
    "scraper.py fue migrado al microservicio 'cineverse-scraper-service'. "
    "No se debe importar directamente. Usa _call_scraper() en main.py."
)
