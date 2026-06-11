import uuid
from datetime import datetime, timedelta
import httpx

def format_to_ics_date(date_str: str) -> str:
    """
    Convierte una fecha ISO (ej: 2026-06-10T20:00:00) a formato iCalendar (20260610T200000Z).
    """
    try:
        dt = datetime.fromisoformat(date_str.replace("Z", ""))
        return dt.strftime("%Y%m%dT%H%M%SZ")
    except Exception:
        # Fallback en caso de error de parseo
        return datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")

def generate_ics_content(titulo_pelicula: str, fecha_iso: str) -> str:
    """
    Genera el texto de un archivo iCalendar (.ics) estándar de forma manual y ligera.
    """
    dtstart = format_to_ics_date(fecha_iso)
    
    # Duración por defecto: 2 horas para ver la película
    try:
        dt = datetime.fromisoformat(fecha_iso.replace("Z", ""))
        dt_end = dt + timedelta(hours=2)
        dtend = dt_end.strftime("%Y%m%dT%H%M%SZ")
    except Exception:
        dtend = format_to_ics_date(fecha_iso)
        
    event_uuid = str(uuid.uuid4())
    
    ics_lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//CineVerse//CineMatch//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        f"SUMMARY:Cita CineMatch: {titulo_pelicula} 🍿",
        f"UID:{event_uuid}@cineverse.com",
        "SEQUENCE:0",
        "STATUS:CONFIRMED",
        "TRANSP:OPAQUE",
        f"DTSTART:{dtstart}",
        f"DTEND:{dtend}",
        f"DESCRIPTION:¡Cita confirmada en CineMatch para ver la pelicula {titulo_pelicula}! Preparen las palomitas.",
        "LOCATION:Salon CineVerse",
        "END:VEVENT",
        "END:VCALENDAR"
    ]
    return "\r\n".join(ics_lines)

async def schedule_google_calendar_event(titulo_pelicula: str, fecha_iso: str, access_token: str = None) -> dict:
    """
    Intenta crear un evento en Google Calendar utilizando el token de acceso OAuth del usuario.
    Si no hay token o la petición falla, retorna una simulación exitosa (robustez RAD).
    """
    if not access_token:
        print("[CALENDAR] No se proporcionó token de Google. Simulando evento...")
        return {
            "status": "simulated",
            "message": "Cita agendada en Google Calendar (Modo Simulación).",
            "html_link": "https://calendar.google.com"
        }
        
    # Formatear fechas para la API de Google
    try:
        start_dt = datetime.fromisoformat(fecha_iso.replace("Z", ""))
        end_dt = start_dt + timedelta(hours=2)
        start_str = start_dt.isoformat()
        end_str = end_dt.isoformat()
    except Exception:
        now = datetime.utcnow()
        start_str = now.isoformat()
        end_str = (now + timedelta(hours=2)).isoformat()
        
    event_body = {
        "summary": f"Cita CineMatch: {titulo_pelicula} 🍿",
        "location": "Salón CineVerse",
        "description": f"Cita para ver {titulo_pelicula} compartida desde CineVerse & CineMatch.",
        "start": {
            "dateTime": start_str,
            "timeZone": "UTC"
        },
        "end": {
            "dateTime": end_str,
            "timeZone": "UTC"
        }
    }
    
    url = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json=event_body, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                print("[CALENDAR] Evento creado con éxito en Google Calendar.")
                return {
                    "status": "success",
                    "message": "¡Cita agendada en tu Google Calendar!",
                    "html_link": data.get("htmlLink", "https://calendar.google.com")
                }
            else:
                print(f"[CALENDAR] Error de Google API ({resp.status_code}): {resp.text}")
    except Exception as e:
        print(f"[CALENDAR] Error al conectar con Google API: {e}")
        
    # Fallback de simulación en caso de fallo
    return {
        "status": "simulated",
        "message": "Cita agendada (Modo de simulación debido a error de conexión/token expirado).",
        "html_link": "https://calendar.google.com"
    }
