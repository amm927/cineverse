from sqlalchemy import create_engine, Column, Integer, String, Float, Text, ForeignKey, Boolean, DateTime, func
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship

DATABASE_URL = "sqlite:///./cineverse.db"

engine = create_engine(
    DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

class Pelicula(Base):
    __tablename__ = "peliculas"

    id = Column(Integer, primary_key=True, index=True)
    titulo = Column(String, unique=True, index=True, nullable=False)
    sinopsis = Column(Text, nullable=True)
    poster_url = Column(String, nullable=True)
    backdrop_url = Column(String, nullable=True)
    rating = Column(Float, nullable=True)
    genero = Column(String, nullable=True)
    titulo_original = Column(String, nullable=True)
    fecha_estreno = Column(String, nullable=True)
    duracion = Column(Integer, nullable=True)
    en_cartelera = Column(Boolean, default=False, nullable=False)
    proximo_estreno = Column(Boolean, default=False, nullable=False)

    comentarios = relationship("ComentarioScrapeado", back_populates="pelicula", cascade="all, delete-orphan")

class ComentarioScrapeado(Base):
    __tablename__ = "comentarios_scrapeados"

    id = Column(Integer, primary_key=True, index=True)
    pelicula_id = Column(Integer, ForeignKey("peliculas.id"), nullable=False)
    texto = Column(Text, nullable=False)
    sentimiento = Column(String, nullable=False)
    polaridad = Column(Float, nullable=True, default=0.0)

    pelicula = relationship("Pelicula", back_populates="comentarios")

class Usuario(Base):
    __tablename__ = "usuarios"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=True)
    hashed_password = Column(String, nullable=True)
    google_id = Column(String, unique=True, index=True, nullable=True)
    avatar_url = Column(String, nullable=True)
    role = Column(String, nullable=False, default="user")
    sala_codigo = Column(String, index=True, nullable=True) # Código de sala compartido efímero si aplica
    pareja_id = Column(Integer, ForeignKey("usuarios.id"), nullable=True)
    tiene_pareja = Column(Boolean, default=False)

class PushSubscription(Base):
    """
    Almacena la suscripción Web Push de cada usuario.
    Cada usuario puede tener múltiples suscripciones (distintos dispositivos/navegadores).
    """
    __tablename__ = "push_subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False, index=True)
    endpoint = Column(Text, nullable=False, unique=True)
    p256dh = Column(Text, nullable=False)   # Clave pública del cliente (base64url)
    auth = Column(Text, nullable=False)      # Auth secret del cliente (base64url)

class Sala(Base):
    __tablename__ = "salas"

    id = Column(Integer, primary_key=True, index=True)
    codigo = Column(String, unique=True, index=True, nullable=False)
    creador_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False)
    tipo = Column(String, default="grupo_amigos") # "pareja" o "grupo_amigos"
    activo = Column(Boolean, default=True)
    voting_started = Column(Boolean, default=False)
    categoria = Column(String, default="peliculas") # "peliculas" o "series"

class SalaMiembro(Base):
    __tablename__ = "sala_miembros"

    id = Column(Integer, primary_key=True, index=True)
    sala_id = Column(Integer, ForeignKey("salas.id"), nullable=False)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False)

class Decision(Base):
    __tablename__ = "decisiones"

    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False)
    pelicula_id = Column(Integer, ForeignKey("peliculas.id"), nullable=False)
    voto = Column(String, nullable=False) # 'like' o 'dislike'
    sala_id = Column(Integer, ForeignKey("salas.id"), nullable=True) # Asociado a sala grupal si aplica

class HistorialMatch(Base):
    __tablename__ = "historial_matches"

    id = Column(Integer, primary_key=True, index=True)
    pareja_id = Column(Integer, index=True, nullable=False) # ID unificado min(user_a, user_b)
    pelicula_id = Column(Integer, ForeignKey("peliculas.id"), nullable=False)
    fecha_match = Column(String, nullable=False) # Fecha en formato YYYY-MM-DD
    puntuacion_conjunta = Column(Integer, default=0) # Valor de 1 a 5

    pelicula = relationship("Pelicula")

class Serie(Base):
    __tablename__ = "series"

    id = Column(Integer, primary_key=True, index=True)
    titulo = Column(String, unique=True, index=True, nullable=False)
    sinopsis = Column(Text, nullable=True)
    poster_url = Column(String, nullable=True)
    backdrop_url = Column(String, nullable=True)
    rating = Column(Float, nullable=True)
    genero = Column(String, nullable=True)

    comentarios = relationship("ComentarioSerie", back_populates="serie", cascade="all, delete-orphan")

class ComentarioSerie(Base):
    __tablename__ = "comentarios_series"

    id = Column(Integer, primary_key=True, index=True)
    serie_id = Column(Integer, ForeignKey("series.id"), nullable=False)
    texto = Column(Text, nullable=False)
    sentimiento = Column(String, nullable=False)
    polaridad = Column(Float, nullable=True, default=0.0)

    serie = relationship("Serie", back_populates="comentarios")

class DecisionSerie(Base):
    __tablename__ = "decisiones_series"

    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False)
    serie_id = Column(Integer, ForeignKey("series.id"), nullable=False)
    voto = Column(String, nullable=False) # 'like' o 'dislike'
    sala_id = Column(Integer, ForeignKey("salas.id"), nullable=True)

class HistorialMatchSerie(Base):
    __tablename__ = "historial_matches_series"

    id = Column(Integer, primary_key=True, index=True)
    pareja_id = Column(Integer, index=True, nullable=False)
    serie_id = Column(Integer, ForeignKey("series.id"), nullable=False)
    fecha_match = Column(String, nullable=False)
    puntuacion_conjunta = Column(Integer, default=0)

    serie = relationship("Serie")

class SystemLog(Base):
    __tablename__ = "system_logs"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(String, nullable=False)
    path = Column(String, nullable=False)
    method = Column(String, nullable=False)
    status_code = Column(Integer, nullable=False)
    response_time = Column(Float, nullable=False)
    client_ip = Column(String, nullable=True)
    error_message = Column(Text, nullable=True)

class Pareja(Base):
    __tablename__ = "parejas"

    id = Column(Integer, primary_key=True, index=True) # pareja_id
    match_activo_pelicula_id = Column(Integer, ForeignKey("peliculas.id"), nullable=True)
    match_activo_serie_id = Column(Integer, ForeignKey("series.id"), nullable=True)

class VistasPareja(Base):
    __tablename__ = "vistas_pareja"

    id = Column(Integer, primary_key=True, index=True)
    pareja_id = Column(Integer, index=True, nullable=False)
    contenido_id = Column(Integer, nullable=False)
    tipo = Column(String, nullable=False) # 'MOVIE' o 'SERIE'
    fecha_visualizacion = Column(DateTime, server_default=func.current_timestamp())

class VistasUsuario(Base):
    __tablename__ = "vistas_usuario"

    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False, index=True)
    contenido_id = Column(Integer, nullable=False)
    tipo = Column(String, nullable=False) # 'MOVIE' o 'SERIE'
    fecha_visualizacion = Column(DateTime, server_default=func.current_timestamp())
    duracion = Column(Integer, default=120) # en minutos

def init_db():
    Base.metadata.create_all(bind=engine)
    movie_columns = {
        "titulo_original": "VARCHAR",
        "fecha_estreno": "VARCHAR",
        "duracion": "INTEGER",
        "en_cartelera": "BOOLEAN NOT NULL DEFAULT 0",
        "proximo_estreno": "BOOLEAN NOT NULL DEFAULT 0",
    }
    with engine.begin() as connection:
        existing = {
            row[1]
            for row in connection.exec_driver_sql("PRAGMA table_info(peliculas)").fetchall()
        }
        for column_name, column_type in movie_columns.items():
            if column_name not in existing:
                connection.exec_driver_sql(
                    f"ALTER TABLE peliculas ADD COLUMN {column_name} {column_type}"
                )

        user_columns = {
            row[1]
            for row in connection.exec_driver_sql("PRAGMA table_info(usuarios)").fetchall()
        }
        if "role" not in user_columns:
            connection.exec_driver_sql(
                "ALTER TABLE usuarios ADD COLUMN role VARCHAR NOT NULL DEFAULT 'user'"
            )
