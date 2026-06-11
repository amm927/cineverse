import React, { useState, useEffect } from 'react';

// Espera las props:
// - userId: ID del usuario actual para registrar sus votos en el backend.
// - fetchUrl: URL de consulta de películas (default: http://localhost:8000/api/movies)
// - decideUrl: URL de decisión (default: http://localhost:8000/api/decide)

export default function MovieSwipeDeck({ 
  userId = 1, 
  fetchUrl = 'http://localhost:8000/api/movies', 
  decideUrl = 'http://localhost:8000/api/decide', 
  onMatchTrigger = null,
  ws = null,
  partnerOnline = false,
  activeRoom = null,
  // Lifting state up (controlled mode)
  catalog = null,
  externalIndex = null,
  setExternalIndex = null,
  onReset = null
}) {
  const [localMovies, setLocalMovies] = useState([]);
  const [localIndex, setLocalIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const movies = catalog && catalog.length > 0 ? catalog : localMovies;
  const currentIndex = externalIndex !== null && externalIndex !== undefined ? externalIndex : localIndex;
  const setCurrentIndex = setExternalIndex || setLocalIndex;
  
  // Estado para controlar la animación de la carta superior ('left' | 'right' | null)
  const [swipeDirection, setSwipeDirection] = useState(null);
  const [isSwiping, setIsSwiping] = useState(false);

  // Estados para arrastre de la carta (Swipe manual)
  const [startX, setStartX] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  // 1. Cargar las películas desde el catálogo
  useEffect(() => {
    if (catalog && catalog.length > 0) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(fetchUrl)
      .then((res) => {
        if (!res.ok) throw new Error('Error al obtener catálogo para emparejar');
        return res.json();
      })
      .then((data) => {
        const shuffled = [...data].sort(() => Math.random() - 0.5);
        setLocalMovies(shuffled);
        setLoading(false);
      })
      .catch((err) => {
        console.warn('Backend desconectado. Usando catálogo de respaldo RAD...', err.message);
        // Respaldo de películas realistas para modo offline RAD
        const mockCatalog = [
          { id: 1, titulo: "Dune: Part Two", sinopsis: "Paul Atreides busca venganza con los Fremen contra los Harkonnen.", poster_url: "https://image.tmdb.org/t/p/w500/xCHmhHeO7aOCMlzcNukGH6Q7EiD.jpg", rating: 8.3 },
          { id: 2, titulo: "Oppenheimer", sinopsis: "La historia del físico Oppenheimer en el desarrollo de la bomba atómica.", poster_url: "https://image.tmdb.org/t/p/w500/ncKCQVXgk4BcQV6XbvesgZ2zLvZ.jpg", rating: 8.1 },
          { id: 3, titulo: "Spider-Man: Across the Spider-Verse", sinopsis: "Miles Morales viaja a través del multiverso arácnido.", poster_url: "https://image.tmdb.org/t/p/w500/37WcNMgNOMxdhT87MFl7tq7FM1.jpg", rating: 8.4 },
          { id: 4, titulo: "Interstellar", sinopsis: "Exploradores espaciales viajan por un agujero de gusano para salvar la Tierra.", poster_url: "https://image.tmdb.org/t/p/w500/9cTfZWP5TfdnmAjiD6ZBXWIJ7O9.jpg", rating: 8.4 }
        ];
        const shuffledMock = [...mockCatalog].sort(() => Math.random() - 0.5);
        setLocalMovies(shuffledMock);
        setLoading(false);
      });
  }, [fetchUrl, catalog]);

  // Manejo de eventos para inicio de arrastre (Mouse & Touch)
  const handleDragStart = (clientX) => {
    if (isSwiping || currentIndex >= movies.length) return;
    setStartX(clientX);
    setIsDragging(true);
    setDragOffset(0);
  };

  const handleDragMove = (clientX) => {
    if (!isDragging || isSwiping) return;
    const offset = clientX - startX;
    setDragOffset(offset);
  };

  const handleDragEnd = () => {
    if (!isDragging) return;
    setIsDragging(false);

    const threshold = 80; // píxeles requeridos para activar el voto
    if (dragOffset > threshold) {
      handleVote('like');
    } else if (dragOffset < -threshold) {
      handleVote('dislike');
    } else {
      // Regresar al centro
      setDragOffset(0);
    }
  };

  // Handlers para Ratón
  const onMouseDown = (e) => {
    handleDragStart(e.clientX);
  };

  const onMouseMove = (e) => {
    handleDragMove(e.clientX);
  };

  const onMouseUp = () => {
    handleDragEnd();
  };

  // Handlers para Pantallas Táctiles (Móvil)
  const onTouchStart = (e) => {
    if (e.touches && e.touches[0]) {
      handleDragStart(e.touches[0].clientX);
    }
  };

  const onTouchMove = (e) => {
    if (e.touches && e.touches[0]) {
      handleDragMove(e.touches[0].clientX);
    }
  };

  const onTouchEnd = () => {
    handleDragEnd();
  };

  // Obtener estilo CSS de transformación dinámica para la carta (Efectos 3D y Aceleración)
  const getCardStyle = () => {
    if (swipeDirection === 'dislike') {
      return {
        transform: 'translateX(-150%) rotate(-25deg) scale(0.9)',
        opacity: 0,
        transition: 'all 0.3s cubic-bezier(0.25, 1, 0.5, 1)',
      };
    }
    if (swipeDirection === 'like') {
      return {
        transform: 'translateX(180%) rotate(25deg) scale(1.15)',
        opacity: 0,
        filter: 'brightness(1.35) drop-shadow(0 0 35px rgba(6, 182, 212, 0.95))', // Estela neón cian
        transition: 'all 0.3s cubic-bezier(0.1, 0.8, 0.1, 1.05)', // Aceleración instantánea
      };
    }
    if (isDragging) {
      const rotY = dragOffset * 0.08;
      const rotX = Math.abs(dragOffset) * -0.04;
      return {
        transform: `perspective(1000px) translateX(${dragOffset}px) rotateY(${rotY}deg) rotateX(${rotX}deg) rotateZ(${dragOffset * 0.05}deg)`,
        transition: 'none',
        cursor: 'grabbing',
      };
    }
    return {
      transform: 'perspective(1000px) translateX(0) rotateY(0) rotateX(0) rotateZ(0) scale(1)',
      transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
      cursor: 'grab',
    };
  };


  // 2. Procesar voto (Me gusta / Pasar)
  const handleVote = async (voteType) => {
    if (isSwiping || currentIndex >= movies.length) return;

    const currentMovie = movies[currentIndex];
    setIsSwiping(true);
    setSwipeDirection(voteType); // 'like' o 'dislike'

    const isSeries = activeRoom?.categoria === 'series';

    // Si la conexión WebSocket está abierta y activa, enviar el voto por el socket
    if (ws && ws.readyState === WebSocket.OPEN) {
      console.log(`[WebSocket] Enviando decisión: ${voteType.toUpperCase()} para ${isSeries ? 'serie' : 'película'} ${currentMovie.id}`);
      ws.send(JSON.stringify({
        type: voteType.toUpperCase(),
        [isSeries ? 'serie_id' : 'pelicula_id']: currentMovie.id
      }));
      // Dar un pequeño tiempo para procesar en el servidor y actualizar localmente
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('match-status-changed'));
      }, 200);
    } else {
      // Fallback: Petición HTTP POST tradicional
      try {
        const payload = {
          usuario_id: userId,
          sala_codigo: activeRoom?.codigo || '',
          voto: voteType,
          [isSeries ? 'serie_id' : 'pelicula_id']: currentMovie.id,
          [isSeries ? 'pelicula_id' : 'serie_id']: null
        };
        const response = await fetch(decideUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          const data = await response.json();
          // Disparar evento de actualización de estadísticas
          window.dispatchEvent(new CustomEvent('match-status-changed'));
          // Disparar celebración si hay match
          if (data.match && onMatchTrigger) {
            onMatchTrigger(data.movie || currentMovie);
          }
        }
      } catch (err) {
        console.warn('Backend no disponible para registrar voto. Registrado localmente (RAD).');
      }
    }

    // Esperar a que la transición finalice
    setTimeout(() => {
      setCurrentIndex((prevIndex) => prevIndex + 1);
      setSwipeDirection(null);
      setDragOffset(0);
      setIsDragging(false);
      setIsSwiping(false);
    }, 300);
  };

  const currentMovie = movies[currentIndex];
  // Cartas restantes
  const remainingCount = movies.length - currentIndex;

  return (
    <div className="w-full max-w-sm mx-auto flex flex-col items-center justify-center min-h-[70vh] px-4 space-y-8 select-none">
      
      {loading && (
        <div className="flex flex-col items-center space-y-3 py-20 text-slate-500">
          <div className="w-8 h-8 border-3 border-pink-500/30 border-t-pink-500 rounded-full animate-spin"></div>
          <p className="text-xs uppercase tracking-widest font-bold">
            {activeRoom?.categoria === 'series' ? 'Barajando series...' : 'Barajando películas...'}
          </p>
        </div>
      )}

      {!loading && remainingCount === 0 && (
        <div className="text-center py-20 space-y-4 bg-slate-900/40 border border-slate-900 rounded-3xl p-8 backdrop-blur-md">
          <span className="text-3xl">🍿</span>
          <h3 className="text-lg font-black text-white uppercase tracking-wider">¡Mazo Terminado!</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            {activeRoom?.tipo === "grupo_amigos" 
              ? "Has votado por todo el catálogo disponible. Espera a que tus amigos voten para encontrar coincidencias." 
              : "Has votado por todo el catálogo disponible. Espere a que su pareja vote para encontrar coincidencias."}
          </p>
          <button
            onClick={() => {
              if (onReset) onReset();
              else setCurrentIndex(0);
            }}
            className="px-6 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:brightness-110 text-slate-950 font-black text-xs uppercase tracking-wider rounded-xl transition duration-200 active:scale-95 shadow-lg shadow-cyan-500/20"
          >
            🔄 Reiniciar Mazo
          </button>
        </div>
      )}

      {!loading && remainingCount > 0 && currentMovie && (
        <div className="relative w-full aspect-[2/3] max-w-[280px] sm:max-w-[320px]">
          
          {/* CARTAS INFERIORES (Efecto de pila 3D y profundidad) */}
          {remainingCount > 2 && (
            <div className="absolute inset-0 rounded-3xl bg-slate-900/30 border border-slate-950 shadow-2xl scale-[0.9] translate-y-6 rotate-2 filter blur-[0.5px] pointer-events-none z-0" />
          )}
          {remainingCount > 1 && (
            <div className="absolute inset-0 rounded-3xl bg-slate-900/60 border border-slate-950 shadow-2xl scale-[0.95] translate-y-3 -rotate-1 pointer-events-none z-10" />
          )}

          {/* CARTA ACTIVA SUPERIOR */}
          <div
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            style={getCardStyle()}
            className={`absolute inset-0 rounded-3xl overflow-hidden bg-slate-900 border border-slate-800 shadow-2xl select-none z-20 ${
              swipeDirection === 'dislike' ? 'animate-vhs-glitch' : ''
            }`}

          >
            {/* Indicadores flotantes de Swipe (GUSTA/PASAR) */}
            {dragOffset > 20 && (
              <div 
                style={{ opacity: Math.min(dragOffset / 80, 1) }}
                className="absolute top-10 left-6 z-30 border-4 border-emerald-500 text-emerald-500 bg-slate-950/80 text-lg font-black uppercase tracking-widest px-4 py-2 rounded-xl rotate-[-12deg] pointer-events-none"
              >
                GUSTA
              </div>
            )}
            {dragOffset < -20 && (
              <div 
                style={{ opacity: Math.min(-dragOffset / 80, 1) }}
                className="absolute top-10 right-6 z-30 border-4 border-rose-500 text-rose-500 bg-slate-950/80 text-lg font-black uppercase tracking-widest px-4 py-2 rounded-xl rotate-[12deg] pointer-events-none"
              >
                PASAR
              </div>
            )}

            {/* Póster */}
            <img
              src={currentMovie.poster_url || "https://images.unsplash.com/photo-1440404653325-ab127d49abc1?q=80&w=500&auto=format&fit=crop"}
              alt={currentMovie.titulo}
              className="w-full h-full object-cover pointer-events-none"
              draggable="false"
            />

            {/* Capa de Información Revelable (Hover) */}
            <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md opacity-0 hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-6 space-y-4 pointer-events-none">
              <div className="space-y-1">
                <span className="text-yellow-400 font-bold text-xs">★ {currentMovie.rating || 'N/A'}</span>
                <h4 className="text-lg font-black text-white uppercase tracking-tight">{currentMovie.titulo}</h4>
              </div>
              
              <div className="h-px bg-slate-800" />
              
              <div className="space-y-1">
                <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Sinopsis</p>
                <p className="text-xs text-slate-300 leading-relaxed line-clamp-6 font-light">{currentMovie.sinopsis}</p>
              </div>
            </div>

            {/* Puntuación Flotante en la esquina */}
            <div className="absolute top-4 right-4 bg-slate-950/80 backdrop-blur-md px-2.5 py-1 rounded-xl text-yellow-400 text-xs font-bold border border-slate-800 pointer-events-none">
              ★ {currentMovie.rating || 'N/A'}
            </div>
          </div>

          {/* Panel Lateral Flotante de Reacciones Rápidas */}
          {ws && ws.readyState === WebSocket.OPEN && (
            <div className="absolute -right-12 top-1/2 transform -translate-y-1/2 flex flex-col gap-2.5 z-30">
              {['🔥', '😍', '😂', '😱'].map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => {
                    ws.send(JSON.stringify({ type: 'REACTION', emoji }));
                    window.dispatchEvent(new CustomEvent('show-reaction', { detail: { emoji } }));
                  }}
                  className="w-9 h-9 bg-slate-950/95 hover:bg-slate-900 border border-slate-850 hover:border-cyan-500/40 rounded-full flex items-center justify-center text-base transition-all duration-200 active:scale-90 shadow-lg shadow-slate-950/60"
                  title={`Reaccionar con ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}

        </div>
      )}


      {/* BOTONES FLOTANTES INFERIORES */}
      {!loading && remainingCount > 0 && (
        <div className="flex items-center gap-6">
          
          {/* Botón PASAR */}
          <button
            onClick={() => handleVote('dislike')}
            disabled={isSwiping}
            className="w-14 h-14 bg-slate-900 border border-pink-500/30 hover:border-pink-500 text-pink-500 rounded-full flex items-center justify-center transition-all duration-300 hover:scale-110 active:scale-95 shadow-lg btn-neon-glow"
            title={activeRoom?.categoria === 'series' ? 'Descartar Serie (Pasar)' : 'Descartar Película (Pasar)'}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Botón GUSTAR */}
          <button
            onClick={() => handleVote('like')}
            disabled={isSwiping}
            className="w-14 h-14 bg-slate-900 border border-cyan-500/30 hover:border-cyan-500 text-cyan-400 rounded-full flex items-center justify-center transition-all duration-300 hover:scale-110 active:scale-95 shadow-lg btn-neon-glow"
            title="Me Gusta"
          >
            <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
          </button>


        </div>
      )}

    </div>
  );
}
