import React, { useState, useEffect } from 'react';

/**
 * CouplesMetricsWidget Component
 * 
 * Un widget de métricas de pareja con diseño premium (Glassmorphism),
 * círculo animado de compatibilidad y barras de progreso de géneros más votados.
 * 
 * Props:
 * - user: El objeto del usuario autenticado (opcional).
 * - onConnectClick: Callback al hacer clic en "Activar CineMatch" cuando es invitado (opcional).
 */
export default function CouplesMetricsWidget({ 
  user = null, 
  onConnectClick = null 
}) {
  const [stats, setStats] = useState({
    compatibility: 84,
    matches_count: 0,
    total_likes: 0,
    top_genres: [
      { name: "Ciencia Ficción 🤖", pct: 90, colorClass: "bg-pink-500 shadow-pink-500/25" },
      { name: "Acción 💥", pct: 75, colorClass: "bg-cyan-500 shadow-cyan-500/25" },
      { name: "Drama 🎭", pct: 60, colorClass: "bg-emerald-500 shadow-emerald-500/25" }
    ]
  });
  const [loading, setLoading] = useState(false);

  const isPaired = user && user.tiene_pareja;
  const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

  const fetchStats = () => {
    if (user && user.id) {
      setLoading(true);
      fetch(`${API_BASE_URL}/api/couples/stats/${user.id}`)
        .then((res) => {
          if (!res.ok) throw new Error();
          return res.json();
        })
        .then((data) => {
          setStats(data);
          setLoading(false);
        })
        .catch((err) => {
          console.warn("Fallo al obtener estadísticas dinámicas de la pareja:", err);
          setLoading(false);
        });
    }
  };

  useEffect(() => {
    if (user && user.id) {
      fetchStats();
    } else {
      setStats({
        compatibility: 84,
        matches_count: 0,
        total_likes: 0,
        top_genres: [
          { name: "Ciencia Ficción 🤖", pct: 90, colorClass: "bg-pink-500 shadow-pink-500/25" },
          { name: "Acción 💥", pct: 75, colorClass: "bg-cyan-500 shadow-cyan-500/25" },
          { name: "Drama 🎭", pct: 60, colorClass: "bg-emerald-500 shadow-emerald-500/25" }
        ]
      });
    }
  }, [user, API_BASE_URL]);

  useEffect(() => {
    const handleRefreshStats = () => {
      if (user && user.id) {
        fetch(`${API_BASE_URL}/api/couples/stats/${user.id}`)
          .then((res) => res.json())
          .then((data) => setStats(data))
          .catch(() => {});
      }
    };

    window.addEventListener('watch-stats-updated', handleRefreshStats);
    window.addEventListener('match-status-changed', handleRefreshStats);
    return () => {
      window.removeEventListener('watch-stats-updated', handleRefreshStats);
      window.removeEventListener('match-status-changed', handleRefreshStats);
    };
  }, [user, API_BASE_URL]);

  const compatibility = stats.compatibility;
  const matchesCount = stats.matches_count;
  const totalLikes = stats.total_likes;
  const topGenres = stats.top_genres;

  // Textos descriptivos divertidos según rango de compatibilidad
  let funLabel = "";
  let tagColorClass = "";
  let gradientRing = "";

  if (compatibility >= 80) {
    funLabel = "Almas gemelas de sofá 🛋️";
    tagColorClass = "text-pink-400 bg-pink-950/40 border-pink-500/20";
    gradientRing = "from-pink-500 to-rose-500";
  } else if (compatibility >= 50) {
    funLabel = "Negociadores de palomitas 🍿";
    tagColorClass = "text-cyan-400 bg-cyan-950/40 border-cyan-500/20";
    gradientRing = "from-cyan-400 to-blue-500";
  } else {
    funLabel = "Guerra por el mando a distancia ⚡";
    tagColorClass = "text-rose-400 bg-rose-950/40 border-rose-500/20";
    gradientRing = "from-rose-500 to-orange-500";
  }

  // Parámetros para círculo de progreso SVG
  const radius = 60;
  const strokeWidth = 10;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (compatibility / 100) * circumference;

  return (
    <div className="w-full bg-slate-900/60 border border-slate-800 backdrop-blur-md p-6 rounded-3xl shadow-2xl relative overflow-hidden group transition-all duration-300 hover:border-slate-700/80">
      
      {/* Luz ambiental decorativa interna */}
      <div className="absolute -top-12 -right-12 w-28 h-28 rounded-full bg-pink-500/10 blur-2xl group-hover:bg-pink-500/15 transition-all duration-500" />
      
      {/* Header del Widget */}
      <div className="flex items-center justify-between mb-5">
        <div className="space-y-0.5">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
            <span>💞 Métricas de Pareja</span>
            {!isPaired && (
              <span className="text-[9px] font-black text-cyan-400 bg-cyan-950 border border-cyan-900 px-1.5 py-0.5 rounded-full uppercase tracking-widest animate-pulse">
                Demo
              </span>
            )}
          </h3>
          <p className="text-[11px] text-slate-400 font-light">
            {isPaired 
              ? `Afinidad en tiempo real en la sala ${user.sala_codigo}` 
              : "Sincroniza tus gustos con tu pareja"}
          </p>
        </div>
      </div>

      {/* Compatibilidad y diagnóstico en una composición vertical */}
      <div className="flex flex-col items-center gap-5 mb-6">
        
        {/* Círculo de Progreso SVG */}
        <div className="relative w-36 h-36 shrink-0 flex items-center justify-center">
          <svg className="w-full h-full transform -rotate-90">
            {/* Círculo de Fondo */}
            <circle
              cx="72"
              cy="72"
              r={radius}
              className="stroke-slate-950 fill-transparent"
              strokeWidth={strokeWidth}
            />
            {/* Círculo de Progreso */}
            <circle
              cx="72"
              cy="72"
              r={radius}
              className="stroke-cyan-500 fill-transparent transition-all duration-1000 ease-out"
              strokeWidth={strokeWidth}
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              style={{
                filter: 'drop-shadow(0 0 4px rgba(6, 182, 212, 0.4))'
              }}
            />
          </svg>

          {/* Texto central con micro-animación de corazón */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-black text-white leading-none tracking-tight">
              {compatibility}%
            </span>
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1 flex items-center gap-0.5">
              Afinidad 
              <span className="text-pink-500 animate-ping inline-block absolute ml-12">❤️</span>
              <span className="text-pink-500">❤️</span>
            </span>
          </div>
        </div>

        {/* Sección de Texto Dinámico y Calificación */}
        <div className="w-full space-y-3 text-center">
          <div className="space-y-2">
            <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest">
              Diagnóstico actual
            </span>
            <div className={`w-full px-4 py-3 rounded-xl border font-bold text-xs leading-relaxed ${tagColorClass}`}>
              {funLabel}
            </div>
          </div>

          <p className="max-w-sm mx-auto text-xs text-slate-400 font-light leading-relaxed">
            {isPaired 
              ? `Habéis coincidido en ${matchesCount} películas. ¡Seguid votando en Tinder para desbloquear más matches!`
              : "Conéctate con tu pareja mediante un código de sala compartido para calcular vuestra compatibilidad real en directo."}
          </p>
        </div>

      </div>

      {/* Sección de Géneros más votados */}
      <div className="space-y-3.5 pt-4 border-t border-slate-800">
        <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
          Géneros Más Afines
        </h4>

        <div className="space-y-3">
          {topGenres.map((g, idx) => (
            <div key={idx} className="space-y-1">
              <div className="flex justify-between text-xs font-semibold">
                <span className="text-slate-300 font-medium">{g.name}</span>
                <span className="text-slate-400 font-bold">{g.pct}%</span>
              </div>
              
              {/* Barra de progreso de fondo */}
              <div className="h-1.5 w-full bg-slate-950 rounded-full overflow-hidden">
                <div 
                  className={`h-full rounded-full transition-all duration-1000 ease-out shadow-sm ${g.colorClass}`} 
                  style={{ width: `${g.pct}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Botón Call To Action si es Modo Demo */}
      {!isPaired && (
        <div className="mt-6 pt-4 border-t border-slate-800">
          <button
            onClick={onConnectClick}
            className="w-full py-2.5 bg-gradient-to-r from-pink-500 to-rose-600 hover:brightness-110 text-white font-bold rounded-xl text-xs transition duration-200 transform active:scale-95 shadow-md shadow-pink-500/10 flex items-center justify-center gap-1.5"
          >
            <span>🔗 Conectar Pareja con CineMatch</span>
          </button>
        </div>
      )}

    </div>
  );
}
