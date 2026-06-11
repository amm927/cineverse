import React, { useState, useEffect } from 'react';

/**
 * CouplesHistoryTimeline Component
 * 
 * Diseña una línea de tiempo vertical (Timeline) premium para el historial de citas.
 * Cada nodo contiene una película coincidida, su fecha y estrellas interactivas para
 * puntuar la película/cita.
 * 
 * Props:
 * - user: El usuario autenticado (opcional).
 */
export default function CouplesHistoryTimeline({ user = null, categoria = "peliculas" }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const isPaired = user && user.tiene_pare_ja || user && user.tiene_pareja; // safety
  const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

  // Mock de Historial de Citas para modo de demostración (Invitados/Sin pareja)
  const MOCK_HISTORY = categoria === "series" ? [
    {
      id: -1,
      serie_id: 1396,
      titulo: "Breaking Bad",
      poster_url: "https://image.tmdb.org/t/p/w500/ztkUQFLlC19CCMYHW9o1zWhJRNq.jpg",
      fecha_match: new Date().toISOString().split('T')[0],
      puntuacion_conjunta: 5
    },
    {
      id: -2,
      serie_id: 66732,
      titulo: "Stranger Things",
      poster_url: "https://image.tmdb.org/t/p/w500/1sRJ8D1vpXE5WQBGrUBky3uUwvX.jpg",
      fecha_match: "2026-06-08",
      puntuacion_conjunta: 4
    }
  ] : [
    {
      id: -1,
      pelicula_id: 278,
      titulo: "Cadena perpetua",
      poster_url: "https://image.tmdb.org/t/p/w500/uRRTV7p6l2ivtODWJVVAMRrwTn2.jpg",
      fecha_match: new Date().toISOString().split('T')[0],
      puntuacion_conjunta: 5
    },
    {
      id: -2,
      pelicula_id: 157336,
      titulo: "Interstellar",
      poster_url: "https://image.tmdb.org/t/p/w500/9cTfZWP5TfdnmAjiD6ZBXWIJ7O9.jpg",
      fecha_match: "2026-06-08",
      puntuacion_conjunta: 4
    }
  ];

  // Cargar historial
  useEffect(() => {
    if (user && user.tiene_pareja) {
      loadHistoryData();
    } else {
      setHistory(MOCK_HISTORY);
    }
  }, [user, categoria]);

  useEffect(() => {
    const handleRefreshHistory = () => {
      if (user && user.tiene_pareja) {
        fetch(`${API_BASE_URL}/api/history/${user.id}?categoria=${categoria}`)
          .then((res) => {
            if (!res.ok) throw new Error();
            return res.json();
          })
          .then((data) => {
            setHistory(data);
          })
          .catch(() => {});
      }
    };

    window.addEventListener('watch-stats-updated', handleRefreshHistory);
    window.addEventListener('match-status-changed', handleRefreshHistory);
    return () => {
      window.removeEventListener('watch-stats-updated', handleRefreshHistory);
      window.removeEventListener('match-status-changed', handleRefreshHistory);
    };
  }, [user, categoria, API_BASE_URL]);

  const loadHistoryData = () => {
    setLoading(true);
    setError(null);
    fetch(`${API_BASE_URL}/api/history/${user.id}?categoria=${categoria}`)
      .then((res) => {
        if (!res.ok) throw new Error("Error al obtener historial de citas.");
        return res.json();
      })
      .then((data) => {
        setHistory(data);
        setLoading(false);
      })
      .catch((err) => {
        console.warn("Fallo al conectar con la API de historial. Usando mock RAD...", err.message);
        setHistory(MOCK_HISTORY);
        setLoading(false);
      });
  };

  // Enviar puntuación al backend
  const handleRate = async (historyId, stars) => {
    // Si no está emparejado, es modo demo. Solo actualizamos el estado local.
    if (!user || !user.tiene_pareja) {
      setHistory((prev) =>
        prev.map((item) =>
          item.id === historyId ? { ...item, puntuacion_conjunta: stars } : item
        )
      );
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/history/rate?categoria=${categoria}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          history_id: historyId,
          puntuacion: stars
        })
      });

      if (response.ok) {
        // Actualizar localmente para respuesta instantánea sin recargar
        setHistory((prev) =>
          prev.map((item) =>
            item.id === historyId ? { ...item, puntuacion_conjunta: stars } : item
          )
        );
      } else {
        throw new Error();
      }
    } catch (err) {
      console.warn("No se pudo guardar la puntuación en red. Actualizando de forma local...");
      setHistory((prev) =>
        prev.map((item) =>
          item.id === historyId ? { ...item, puntuacion_conjunta: stars } : item
        )
      );
    }
  };

  return (
    <div className="w-full bg-slate-900/40 border border-slate-900/60 backdrop-blur-md p-6 md:p-8 rounded-3xl shadow-xl space-y-6 relative overflow-hidden">
      
      {/* Luz ambiental de fondo */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[350px] h-[350px] bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Cabecera del Timeline */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10 border-b border-slate-800/60 pb-5">
        <div className="space-y-1 text-left">
          <span className="text-[10px] font-black uppercase tracking-widest text-cyan-400 bg-cyan-950/40 border border-cyan-800/30 px-2.5 py-0.5 rounded-full">
            {categoria === "series" ? "📺 Diario de Series" : "🍿 Diario de Pelis"}
          </span>
          <h3 className="text-xl font-extrabold text-white uppercase tracking-tight">
            Historial de Citas y Coincidencias
          </h3>
          <p className="text-xs text-slate-400 font-light">
            {user && user.tiene_pareja
              ? `Registro cronológico de ${categoria === "series" ? "vuestras noches de series" : "vuestras noches de cine"} en la sala ${user.sala_codigo}.`
              : `Previsualiza cómo lucirá vuestro diario de citas una vez que juguéis a ${categoria === "series" ? "SerieMatch" : "CineMatch"}.`}
          </p>
        </div>

        {(user && user.tiene_pareja) && (
          <button
            onClick={loadHistoryData}
            className="self-start sm:self-center px-4 py-2 bg-slate-900 hover:bg-slate-850 text-cyan-400 font-bold border border-slate-800 rounded-full transition transform hover:scale-105 active:scale-95 text-xs flex items-center gap-1.5"
          >
            🔄 Actualizar Diario
          </button>
        )}
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center py-12 text-slate-500 space-y-3">
          <div className="w-6 h-6 border-2 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin"></div>
          <p className="text-[10px] uppercase font-bold tracking-widest">Cargando vuestro historial...</p>
        </div>
      )}

      {!loading && history.length === 0 && (
        <div className="text-center py-16 bg-slate-950/20 border border-slate-900 rounded-2xl p-6 space-y-3">
          <span className="text-3xl">📅</span>
          <h4 className="text-xs font-bold text-slate-300 uppercase tracking-widest">El diario está en blanco</h4>
          <p className="text-xs text-slate-500 leading-relaxed max-w-xs mx-auto font-light">
            Aún no habéis tenido ninguna coincidencia en la sala. ¡Id a {categoria === "series" ? "**SerieMatch**" : "**CineMatch**"} y dadle Like a las mismas {categoria === "series" ? "series" : "pelis"} para empezar vuestro diario de citas!
          </p>
        </div>
      )}

      {/* Línea de tiempo vertical */}
      {!loading && history.length > 0 && (
        <div className="relative border-l border-slate-800/80 ml-4 md:ml-6 space-y-8 py-2 text-left">
          {history.map((item) => (
            <div key={item.id} className="relative pl-8 md:pl-10 group">
              
              {/* Nodo indicador en la línea de tiempo */}
              <span className="absolute -left-[9px] top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-slate-950 border border-cyan-500/50 group-hover:border-cyan-400 transition-colors shadow-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
              </span>

              {/* Contenedor del ítem (Ficha de la cita) */}
              <div className="flex flex-row gap-4 items-start p-4 bg-slate-900/30 border border-slate-900/60 hover:border-slate-800/80 rounded-2xl transition duration-300 backdrop-blur-sm relative">
                
                {/* Miniatura de la Película */}
                <img
                  src={item.poster_url || "https://images.unsplash.com/photo-1440404653325-ab127d49abc1?q=80&w=500&auto=format&fit=crop"}
                  alt={item.titulo}
                  className="w-16 md:w-20 aspect-[2/3] object-cover rounded-xl border border-slate-800 shrink-0 shadow-md transform group-hover:scale-105 transition duration-300"
                />

                {/* Detalles de la cita */}
                <div className="flex-1 flex flex-col justify-between py-0.5 space-y-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <h4 className="font-extrabold text-sm text-white group-hover:text-cyan-400 transition-colors uppercase tracking-tight">
                        {item.titulo}
                      </h4>
                      <span className="text-[10px] font-bold text-slate-500 font-mono">
                        {item.fecha_match}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 font-light leading-relaxed">
                      💡 ¡Coincidencia confirmada! Habéis guardado esta {categoria === "series" ? "serie" : "película"} en vuestro diario. Puntúa qué tal estuvo la noche de {categoria === "series" ? "series" : "cine"} para recordarlo siempre.
                    </p>
                  </div>

                  {/* Valoración conjunta interactiva con estrellas */}
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      Nota de la cita:
                    </span>
                    <div className="flex gap-1.5">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          onClick={() => handleRate(item.id, star)}
                          className={`text-lg transition-transform duration-200 hover:scale-125 focus:outline-none ${
                            star <= item.puntuacion_conjunta
                              ? 'text-yellow-400'
                              : 'text-slate-700 hover:text-yellow-500/40'
                          }`}
                        >
                          ★
                        </button>
                      ))}
                    </div>
                    {item.puntuacion_conjunta > 0 && (
                      <span className="text-[10px] font-black text-yellow-500 uppercase tracking-widest">
                        {item.puntuacion_conjunta} / 5
                      </span>
                    )}
                  </div>
                </div>

              </div>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}
