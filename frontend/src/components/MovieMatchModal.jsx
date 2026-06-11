import React, { useState, useEffect } from 'react';
import ScheduleDateModal from './ScheduleDateModal';
import confetti from 'canvas-confetti';

// Props:
// - isOpen: booleano que abre/cierra el modal de celebración.
// - matchedMovie: objeto con la información de la película coincidente.
//   { titulo: string, poster_url: string, rating: number, sinopsis: string }
// - onClose: callback para reanudar la búsqueda y cerrar el modal.

export default function MovieMatchModal({ isOpen, matchedMovie, onClose }) {
  const [isScheduleOpen, setIsScheduleOpen] = useState(false);

  useEffect(() => {
    if (isOpen && matchedMovie) {
      // Lanzar celebración de 3 segundos
      const duration = 3000;
      const end = Date.now() + duration;

      // Definir la forma personalizada de Corazón vía path SVG
      const heart = confetti.shapeFromPath({
        path: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z'
      });

      let frameId;
      const frame = () => {
        // Disparar confeti lateral desde la izquierda
        confetti({
          particleCount: 2,
          angle: 60,
          spread: 55,
          origin: { x: 0, y: 0.8 },
          colors: ['#00f0ff', '#ff007f', '#ffea00'], // cian neón, fucsia neón, oro neón
          shapes: [heart, 'star', 'circle']
        });
        
        // Disparar confeti lateral desde la derecha
        confetti({
          particleCount: 2,
          angle: 120,
          spread: 55,
          origin: { x: 1, y: 0.8 },
          colors: ['#00f0ff', '#ff007f', '#ffea00'],
          shapes: [heart, 'star', 'circle']
        });

        if (Date.now() < end) {
          frameId = requestAnimationFrame(frame);
        }
      };

      // 1. Explosión central masiva inicial
      confetti({
        particleCount: 120,
        spread: 90,
        origin: { y: 0.6 },
        colors: ['#00f0ff', '#ff007f', '#ffea00'],
        shapes: [heart, 'star', 'circle'],
        gravity: 1.1,
        scalar: 1.25
      });

      // 2. Iniciar ráfagas continuas en bucle
      frame();

      return () => {
        if (frameId) {
          cancelAnimationFrame(frameId);
        }
      };
    }
  }, [isOpen, matchedMovie]);

  if (!isOpen || !matchedMovie) return null;


  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-hidden">
        
        {/* 1. Fondo de Glassmorphism Avanzado */}
        <div 
          onClick={onClose}
          className="absolute inset-0 bg-slate-950/80 backdrop-blur-2xl transition-all duration-700 animate-fade-in"
        />

        {/* 2. Efectos de Celebración de Fondo (Ondas de Choque Concéntricas) */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          {/* Onda 1 (Cian) */}
          <div className="absolute w-[600px] h-[600px] rounded-full border border-cyan-500/20 animate-ping opacity-40 duration-1000" />
          {/* Onda 2 (Fucsia con retardo) */}
          <div className="absolute w-[800px] h-[800px] rounded-full border border-fuchsia-500/10 animate-ping opacity-30 [animation-delay:400ms]" />
          {/* Onda 3 (Amarillo/Oro) */}
          <div className="absolute w-[400px] h-[400px] rounded-full border border-amber-500/25 animate-ping opacity-50 [animation-delay:800ms]" />

          {/* Destellos flotantes (Partículas doradas) */}
          <div className="absolute top-1/4 left-1/3 w-3 h-3 bg-amber-400 rounded-full animate-bounce blur-xs" />
          <div className="absolute top-2/3 right-1/4 w-2 h-2 bg-yellow-300 rounded-full animate-pulse blur-xs" />
          <div className="absolute bottom-1/4 left-1/4 w-3.5 h-3.5 bg-cyan-400 rounded-full animate-ping opacity-30" />
        </div>

        {/* 3. Panel Central de Celebración */}
        <div className="relative w-full max-w-md bg-slate-900/40 border border-white/10 backdrop-blur-xl rounded-3xl p-8 text-center shadow-[0_0_80px_rgba(6,182,212,0.15)] transform scale-100 animate-zoom-in space-y-5 z-10">
          
          {/* Texto Gigante con Gradiente Animado */}
          <div className="space-y-1">
            <h2 className="text-4xl font-extrabold tracking-black bg-gradient-to-r from-cyan-400 via-amber-400 to-rose-500 bg-clip-text text-transparent uppercase animate-pulse select-none">
              {matchedMovie.tipo === "serie" ? "¡TENEMOS SERIE! 📺" : "¡TENEMOS CINE! 🍿"}
            </h2>
            <p className="text-[10px] tracking-widest uppercase text-cyan-400 font-black">
              {matchedMovie.tipo === "serie" ? "SerieMatch Encontrado" : "CineMatch Encontrado"}
            </p>
          </div>

          {/* 4. Marco de Póster con Luces de Neón Parpadeantes y Sombra */}
          <div className="relative w-44 aspect-[2/3] mx-auto rounded-2xl overflow-hidden border border-white/20 shadow-[0_0_40px_rgba(244,63,94,0.4)] group">
            {/* Luz de neón trasera palpitante */}
            <div className="absolute inset-0 bg-gradient-to-t from-rose-500 to-cyan-500 opacity-20 filter blur-xl animate-pulse" />
            
            <img
              src={matchedMovie.poster_url || "https://images.unsplash.com/photo-1440404653325-ab127d49abc1?q=80&w=500&auto=format&fit=crop"}
              alt={matchedMovie.titulo}
              className="w-full h-full object-cover relative z-10 transition duration-500 group-hover:scale-105"
            />
          </div>

          {/* 5. Título y Subtítulo Dinámico */}
          <div className="space-y-1.5">
            <h3 className="text-xl font-black text-white uppercase tracking-tight line-clamp-1 text-center">
              {matchedMovie.titulo}
            </h3>
            <div className="flex justify-center items-center gap-3">
              <span className="text-xs font-bold px-3 py-1 bg-yellow-500 text-slate-950 rounded-full flex items-center gap-0.5">
                ★ {matchedMovie.rating || 'N/A'}
              </span>
              <span className="text-[10px] font-bold px-3 py-1 bg-slate-950 border border-slate-800 rounded-full text-slate-400">
                MATCH PERFECTO
              </span>
            </div>
          </div>

          {/* 6. Botones de Acción */}
          <div className="space-y-2.5 pt-2">
            {/* CTA principal: agendar la cita */}
            <button
              onClick={() => setIsScheduleOpen(true)}
              className="w-full py-3 bg-gradient-to-r from-pink-500 via-rose-500 to-orange-500 hover:brightness-110 text-white font-black rounded-xl text-sm transition shadow-lg shadow-rose-500/20 transform active:scale-95 duration-200 flex items-center justify-center gap-2"
            >
              {matchedMovie.tipo === "serie" ? "📅 Agendar el Maratón de Serie" : "📅 Agendar la Cita de Cine"}
            </button>

            <button
              onClick={onClose}
              className="w-full py-2.5 bg-slate-900/60 hover:bg-slate-900 border border-slate-800 text-slate-300 hover:text-white font-bold rounded-xl text-xs transition transform active:scale-95 duration-200"
            >
              Cerrar y seguir buscando
            </button>
            
            <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">
              Votos sincronizados mediante {matchedMovie.tipo === "serie" ? "SerieMatch AI" : "CineMatch AI"}
            </p>
          </div>

        </div>
      </div>

      {/* Modal de agendado (se monta sobre el modal de match) */}
      <ScheduleDateModal
        isOpen={isScheduleOpen}
        onClose={() => setIsScheduleOpen(false)}
        movieTitle={matchedMovie.titulo}
      />
    </>
  );
}
