import React, { useState, useEffect } from 'react';

export default function PendingWatchList({ user, onMovieClick = null }) {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fadingIds, setFadingIds] = useState(new Set());
  
  const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

  const fetchPendingMatches = async () => {
    if (!user || !user.pareja_id) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/matches/${user.id}?pending_only=true`);
      if (res.ok) {
        const data = await res.json();
        setMatches(data);
      }
    } catch (err) {
      console.error("Error al obtener pendientes:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPendingMatches();
    // Poll every 10 seconds to sync matches in real time if any new match occurs
    const interval = setInterval(fetchPendingMatches, 10000);
    return () => clearInterval(interval);
  }, [user?.id, user?.pareja_id]);

  const handleMarkAsWatched = async (item) => {
    if (fadingIds.has(item.id)) return;

    // Trigger fade-out animation first
    setFadingIds(prev => {
      const next = new Set(prev);
      next.add(`${item.tipo}-${item.id}`);
      return next;
    });

    try {
      const payload = {
        pareja_id: user.id,
        contenido_id: item.id,
        tipo: item.tipo === 'serie' ? 'SERIE' : 'MOVIE'
      };

      const res = await fetch(`${API_BASE_URL}/api/watched`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        // Wait for animation to finish (300ms) then remove from list
        setTimeout(() => {
          setMatches(prev => prev.filter(m => !(m.id === item.id && m.tipo === item.tipo)));
          setFadingIds(prev => {
            const next = new Set(prev);
            next.delete(`${item.tipo}-${item.id}`);
            return next;
          });
        }, 300);
      } else {
        // Revert if error
        setFadingIds(prev => {
          const next = new Set(prev);
          next.delete(`${item.tipo}-${item.id}`);
          return next;
        });
        alert("Error al marcar como visto. Inténtalo de nuevo.");
      }
    } catch (err) {
      console.error(err);
      setFadingIds(prev => {
        const next = new Set(prev);
        next.delete(`${item.tipo}-${item.id}`);
        return next;
      });
    }
  };

  // If user doesn't have a partner, don't show the list
  if (!user || !user.pareja_id) return null;

  return (
    <div className="w-full max-w-md mx-auto mt-6 bg-slate-900/60 border border-slate-800 backdrop-blur-xl rounded-3xl p-6 shadow-xl space-y-4">
      <div className="flex items-center justify-between border-b border-slate-800/60 pb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">📌</span>
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Nuestra Lista de Pendientes</h3>
        </div>
        <span className="text-[10px] font-semibold text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full">
          {matches.length} {matches.length === 1 ? 'pendiente' : 'pendientes'}
        </span>
      </div>

      {loading && matches.length === 0 ? (
        <div className="flex justify-center py-6">
          <div className="w-5 h-5 border-2 border-emerald-500/20 border-t-emerald-400 rounded-full animate-spin"></div>
        </div>
      ) : matches.length === 0 ? (
        <p className="text-xs text-slate-500 text-center py-6 italic">
          ¡No tenéis matches pendientes! Deslizad más arriba para encontrar películas o series juntos. 🍿
        </p>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-3 pt-1 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
          {matches.map((item) => {
            const key = `${item.tipo}-${item.id}`;
            const isFading = fadingIds.has(key);
            
            return (
              <div
                key={key}
                className={`relative flex-shrink-0 w-24 transition-all duration-300 transform ${
                  isFading ? 'scale-95 opacity-0 -translate-y-4 duration-300' : 'scale-100 opacity-100'
                }`}
              >
                <div className="relative group overflow-hidden rounded-xl border border-slate-800 bg-slate-950 aspect-[2/3] shadow-md">
                  {item.poster_url ? (
                    <img
                      src={item.poster_url}
                      alt={item.titulo}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105 cursor-pointer"
                      onClick={() => onMovieClick && onMovieClick(item)}
                      loading="lazy"
                    />
                  ) : (
                    <div 
                      onClick={() => onMovieClick && onMovieClick(item)}
                      className="w-full h-full flex items-center justify-center bg-slate-900 text-center p-1 text-[10px] text-slate-400 cursor-pointer"
                    >
                      Sin portada
                    </div>
                  )}

                  {/* Emerald Neon Floating Action Button */}
                  <button
                    onClick={() => handleMarkAsWatched(item)}
                    title="Marcar como vista"
                    className="absolute inset-0 m-auto w-10 h-10 rounded-full flex items-center justify-center bg-emerald-950/80 text-emerald-400 border border-emerald-500/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 shadow-[0_0_15px_rgba(16,185,129,0.4)] hover:bg-emerald-500/30 hover:text-white"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-5 w-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </button>
                  
                  {/* Tipo badge */}
                  <span className={`absolute top-1 left-1 px-1 py-0.5 rounded text-[8px] font-bold text-white uppercase tracking-wider ${
                    item.tipo === 'serie' ? 'bg-indigo-600/90' : 'bg-rose-600/90'
                  }`}>
                    {item.tipo === 'serie' ? 'TV' : 'Cine'}
                  </span>
                </div>
                
                <p 
                  onClick={() => onMovieClick && onMovieClick(item)}
                  className="text-[10px] font-bold text-slate-200 mt-1.5 truncate text-center w-full px-1 cursor-pointer hover:text-cyan-400 transition" 
                  title={item.titulo}
                >
                  {item.titulo}
                </p>
                {item.rating && (
                  <p className="text-[9px] text-amber-400 text-center flex items-center justify-center gap-0.5">
                    ★ {item.rating.toFixed(1)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
