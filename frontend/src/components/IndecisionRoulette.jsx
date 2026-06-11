import React, { useState, useEffect, useRef } from 'react';

/**
 * IndecisionRoulette Component
 * 
 * Un componente interactivo premium que abre un modal con una ruleta animada.
 * Gira y frena suavemente hasta detenerse en una película seleccionada al azar
 * de los matches de la pareja (o del catálogo principal como fallback).
 * 
 * Props:
 * - movies: Catálogo de películas general para fallback (Array).
 * - matches: Coincidencias de la pareja (Array).
 */
export default function IndecisionRoulette({ movies = [], matches = [] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSpinning, setIsSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [winner, setWinner] = useState(null);
  const [selectedMovies, setSelectedMovies] = useState([]);
  const [showWinnerCard, setShowWinnerCard] = useState(false);
  const [usingFallback, setUsingFallback] = useState(false);

  const wheelRef = useRef(null);

  // Determinar qué películas entran a la ruleta al abrir el modal
  useEffect(() => {
    if (isOpen) {
      // Priorizar matches. Si no hay matches, usar el catálogo general de películas como fallback.
      const sourceList = matches.length > 0 ? matches : movies;
      setUsingFallback(matches.length === 0);

      // Limitar a máximo 8 películas para que la ruleta sea legible
      const list = sourceList.slice(0, 8);
      setSelectedMovies(list);
      
      // Resetear estado del juego
      setWinner(null);
      setShowWinnerCard(false);
      setRotation(0);
    }
  }, [isOpen, matches, movies]);

  // Dibujar cuñas de ruleta dinámicamente
  const radius = 150;
  const numSlices = Math.max(1, selectedMovies.length);
  const sliceAngle = 360 / numSlices;

  const getSlicePath = (r, startAngle, endAngle) => {
    const startRad = ((startAngle - 90) * Math.PI) / 180;
    const endRad = ((endAngle - 90) * Math.PI) / 180;

    const x1 = r + r * Math.cos(startRad);
    const y1 = r + r * Math.sin(startRad);
    const x2 = r + r * Math.cos(endRad);
    const y2 = r + r * Math.sin(endRad);

    const largeArcFlag = endAngle - startAngle <= 180 ? 0 : 1;

    return `M ${r} ${r} L ${x1} ${y1} A ${r} ${r} 0 ${largeArcFlag} 1 ${x2} ${y2} Z`;
  };

  const handleSpin = () => {
    if (isSpinning || selectedMovies.length === 0) return;

    setIsSpinning(true);
    setShowWinnerCard(false);
    setWinner(null);

    // Calcular el ganador al azar
    const winnerIndex = Math.floor(Math.random() * selectedMovies.length);
    const winningMovie = selectedMovies[winnerIndex];

    // Calcular la rotación objetivo:
    // 1. Al menos 5 giros completos (1800 grados)
    // 2. Apuntar al centro del segmento ganador.
    // Como el puntero está arriba (a 0 / 360 grados), el segmento del ganador i debe quedar arriba.
    // El segmento i abarca desde (i * sliceAngle) hasta ((i+1) * sliceAngle) grados.
    // Para que quede arriba, debemos rotar la ruleta un ángulo de: 360 - (centro del segmento).
    const segmentCenter = winnerIndex * sliceAngle + sliceAngle / 2;
    const alignAngle = 360 - segmentCenter;

    const extraSpins = 5 * 360; // 5 vueltas completas
    const targetRotation = extraSpins + alignAngle;

    setRotation(targetRotation);

    // Esperar a que la transición termine (4 segundos de animación cubic-bezier)
    setTimeout(() => {
      setWinner(winningMovie);
      setIsSpinning(false);
      setShowWinnerCard(true);
    }, 4000);
  };

  return (
    <>
      {/* Botón Disparador del Widget */}
      <button
        onClick={() => setIsOpen(true)}
        className="w-full py-3.5 bg-gradient-to-r from-pink-500/10 via-purple-500/10 to-cyan-500/10 hover:from-pink-500/20 hover:via-purple-500/20 hover:to-cyan-500/20 border border-slate-800 hover:border-slate-700 text-slate-200 font-bold rounded-2xl transition duration-300 shadow-xl flex items-center justify-center gap-2.5 transform hover:scale-[1.01] active:scale-[0.99] group"
      >
        <span className="text-lg group-hover:animate-bounce">🎡</span>
        <div className="text-left">
          <p className="text-xs font-black uppercase tracking-wider text-transparent bg-gradient-to-r from-pink-400 to-cyan-400 bg-clip-text">
            Ruleta de la Elección
          </p>
          <p className="text-[10px] text-slate-400 font-normal">
            ¿Indecisos? Dejad que el azar decida vuestra película hoy
          </p>
        </div>
      </button>

      {/* Modal de la Ruleta */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-lg animate-fade-in">
          
          <div className="relative w-full max-w-lg bg-slate-900/90 border border-slate-800 rounded-3xl p-6 md:p-8 shadow-2xl flex flex-col items-center space-y-6 overflow-hidden">
            
            {/* Botón Cerrar */}
            <button
              onClick={() => { if (!isSpinning) setIsOpen(false); }}
              disabled={isSpinning}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white disabled:opacity-30 transition"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Encabezado */}
            <div className="text-center space-y-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-cyan-400">
                ⚡ DECISOR VELOZ
              </span>
              <h3 className="text-xl font-extrabold text-white uppercase tracking-tight">
                La Ruleta de la Indecisión
              </h3>
              <p className="text-xs text-slate-400 font-light">
                {usingFallback 
                  ? "⚠️ No hay matches en la sala. Seleccionando del catálogo general." 
                  : "🎉 Girando sobre vuestros matches en común."}
              </p>
            </div>

            {/* Contenedor de la Ruleta Física */}
            <div className="relative w-[320px] h-[320px] shrink-0 flex items-center justify-center">
              
              {/* Puntero Indicador */}
              <div 
                className="absolute top-0 left-1/2 -translate-x-1/2 -mt-2.5 w-6 h-7 bg-yellow-500 z-20 shadow-md"
                style={{
                  clipPath: 'polygon(50% 100%, 0 0, 100% 0)'
                }}
              />

              {/* Anillo de Luces Decorativo */}
              <div className="absolute inset-0 rounded-full border-[10px] border-slate-950 shadow-[0_0_20px_rgba(6,182,212,0.15)] z-10 pointer-events-none" />

              {/* Rueda Svg Rotable */}
              <div
                ref={wheelRef}
                className="w-[300px] h-[300px] rounded-full overflow-hidden shadow-2xl"
                style={{
                  transform: `rotate(-${rotation}deg)`,
                  transition: isSpinning 
                    ? 'transform 4s cubic-bezier(0.15, 0.85, 0.2, 1)' 
                    : 'none'
                }}
              >
                {selectedMovies.length > 0 ? (
                  <svg className="w-full h-full">
                    {selectedMovies.map((movie, idx) => {
                      const startAngle = idx * sliceAngle;
                      const endAngle = (idx + 1) * sliceAngle;
                      
                      // Alternar colores
                      const color = idx % 2 === 0 ? '#d946ef' : '#06b6d4';
                      const pathStr = getSlicePath(radius, startAngle, endAngle);

                      // Coordenadas para el texto
                      const midAngle = startAngle + sliceAngle / 2;
                      const midRad = ((midAngle - 90) * Math.PI) / 180;
                      const textX = radius + radius * 0.55 * Math.cos(midRad);
                      const textY = radius + radius * 0.55 * Math.sin(midRad);

                      return (
                        <g key={movie.id}>
                          {/* Segmento */}
                          <path
                            d={pathStr}
                            fill={color}
                            stroke="#0f172a"
                            strokeWidth="1.5"
                            className="transition duration-300"
                            opacity={winner && winner.id !== movie.id ? 0.35 : 0.9}
                          />
                          {/* Número o Texto Rotado */}
                          <text
                            x={textX}
                            y={textY}
                            fill="#0f172a"
                            className="font-black text-xs select-none pointer-events-none"
                            textAnchor="middle"
                            dominantBaseline="central"
                            transform={`rotate(${midAngle + 90}, ${textX}, ${textY})`}
                          >
                            {idx + 1}
                          </text>
                        </g>
                      );
                    })}
                    {/* Botón Central Fijo */}
                    <circle cx="150" cy="150" r="18" fill="#0f172a" stroke="#1e293b" strokeWidth="3" />
                  </svg>
                ) : (
                  <div className="w-full h-full bg-slate-950 flex items-center justify-center text-slate-600 text-xs">
                    Sin películas
                  </div>
                )}
              </div>

            </div>

            {/* Listado / Índice de números */}
            {selectedMovies.length > 0 && !winner && (
              <div className="grid grid-cols-4 gap-2 w-full">
                {selectedMovies.map((m, idx) => (
                  <div
                    key={m.id}
                    className="p-1.5 bg-slate-950/60 border border-slate-850 rounded-lg text-center text-[10px] truncate"
                  >
                    <span className="font-bold text-cyan-400 block">{idx + 1}</span>
                    <span className="text-slate-400 font-light truncate">{m.titulo}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Botón de Acción Principal */}
            {!winner && (
              <button
                onClick={handleSpin}
                disabled={isSpinning || selectedMovies.length === 0}
                className="w-full max-w-xs py-3 bg-gradient-to-r from-cyan-500 to-fuchsia-500 hover:brightness-110 disabled:opacity-50 text-slate-950 font-black rounded-xl text-sm transition transform active:scale-95 shadow-lg tracking-wider"
              >
                {isSpinning ? '💥 GIRANDO...' : '🎲 GIRAR LA RUEDA'}
              </button>
            )}

            {/* Tarjeta del Ganador con efecto de escala y glow neón */}
            {showWinnerCard && winner && (
              <div className="w-full max-w-sm p-4 bg-slate-950 border-2 border-yellow-500/80 rounded-2xl flex gap-4 animate-scale-up shadow-[0_0_25px_rgba(234,179,8,0.25)] relative overflow-hidden">
                
                {/* Banner de victoria */}
                <div className="absolute top-0 right-0 bg-yellow-500 text-slate-950 text-[8px] font-black px-2 py-0.5 rounded-bl uppercase tracking-widest">
                  Ganadora 🏆
                </div>

                {/* Poster miniatura */}
                <img
                  src={winner.poster_url || "https://images.unsplash.com/photo-1440404653325-ab127d49abc1?q=80&w=500&auto=format&fit=crop"}
                  alt={winner.titulo}
                  className="w-16 aspect-[2/3] object-cover rounded-lg border border-slate-800 shrink-0 shadow-md"
                />

                {/* Información de la película */}
                <div className="flex flex-col justify-between py-1 min-w-0">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-extrabold text-sm text-white truncate uppercase tracking-tight">
                        {winner.titulo}
                      </h4>
                      <span className="bg-yellow-500/20 text-yellow-400 text-[9px] font-black px-1.5 py-0.5 rounded border border-yellow-500/10">
                        ★ {winner.rating || 'N/A'}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 leading-normal line-clamp-2">
                      {winner.sinopsis}
                    </p>
                  </div>
                  
                  {/* Botones de acción */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setIsOpen(false)}
                      className="px-3 py-1 bg-yellow-500 hover:bg-yellow-400 text-slate-950 text-[10px] font-black rounded-md transition"
                    >
                      🍿 ¡A VERLA!
                    </button>
                    <button
                      onClick={() => {
                        setWinner(null);
                        setShowWinnerCard(false);
                        setRotation(0);
                      }}
                      className="px-2 py-1 bg-slate-900 border border-slate-800 hover:bg-slate-850 text-slate-400 text-[10px] font-semibold rounded-md transition"
                    >
                      Girar otra vez
                    </button>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      )}
    </>
  );
}
