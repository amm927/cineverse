import React, { useState, useEffect } from 'react';
import MovieSwipeDeck from './MovieSwipeDeck';
import ScheduleDateModal from './ScheduleDateModal';
import { QRCodeSVG } from 'qrcode.react';
import PendingWatchList from './PendingWatchList';

export default function CineMatchDashboard({ 
  user, 
  activeRoom, 
  fetchUrl, 
  decideUrl, 
  onMatchTrigger, 
  ws = null, 
  partnerOnline = false,
  matchesRefreshTrigger = 0,
  onLeaveRoom,
  // Props for lifting state up
  catalog = null,
  externalIndex = null,
  setExternalIndex = null,
  onReset = null,
  onMovieClick = null
}) {
  const [subTab, setSubTab] = useState('swipe'); // 'swipe' | 'matches'
  const [matches, setMatches] = useState([]);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [matchesError, setMatchesError] = useState(null);
  const [schedulingMovie, setSchedulingMovie] = useState(null);
  const [roomMembers, setRoomMembers] = useState([]);
  const [copied, setCopied] = useState(false);

  const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

  const loadMatchesList = () => {
    setLoadingMatches(true);
    setMatchesError(null);
    
    const url = activeRoom 
      ? `${API_BASE_URL}/api/rooms/matches/${activeRoom.codigo}?usuario_id=${user.id}`
      : `${API_BASE_URL}/api/matches/${user.id}`;

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error('Error al conectar con la lista de coincidencias.');
        return res.json();
      })
      .then((data) => {
        setMatches(data);
        setLoadingMatches(false);
      })
      .catch((err) => {
        console.warn('Backend desconectado. Usando matches locales simulados para demostración (RAD)...', err.message);
        setMatches([
          {
            id: 1,
            titulo: "Dune: Part Two",
            sinopsis: "Paul Atreides busca venganza con los Fremen contra los Harkonnen.",
            poster_url: "https://image.tmdb.org/t/p/w500/xCHmhHeO7aOCMlzcNukGH6Q7EiD.jpg",
            rating: 8.3
          }
        ]);
        setLoadingMatches(false);
      });
  };
  const handleToggleMatchWatched = async (movieItem, isCurrentlyWatched) => {
    try {
      const endpoint = isCurrentlyWatched ? '/api/watched/user/unmark' : '/api/watched/user';
      const payload = {
        usuario_id: user.id,
        contenido_id: movieItem.id,
        tipo: movieItem.tipo === 'serie' ? 'SERIE' : 'MOVIE',
        para_pareja: false
      };

      const res = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        loadMatchesList();
        window.dispatchEvent(new CustomEvent('watch-stats-updated'));
      }
    } catch (err) {
      console.error("Error toggling watched match:", err);
    }
  };

  const handleDeleteMatch = async (movieItem) => {
    const isConfirmed = window.confirm(
      `¿Estás seguro de que quieres borrar el match de "${movieItem.titulo}"? Esto eliminará los likes de ambos usuarios para este contenido.`
    );
    if (!isConfirmed) return;

    try {
      const queryParams = activeRoom ? `?sala_codigo=${activeRoom.codigo}` : '';
      const res = await fetch(
        `${API_BASE_URL}/api/matches/${user.id}/${movieItem.tipo === 'serie' ? 'SERIE' : 'MOVIE'}/${movieItem.id}${queryParams}`,
        { method: 'DELETE' }
      );

      if (res.ok) {
        setMatches(prev => prev.filter(m => !(m.id === movieItem.id && m.tipo === movieItem.tipo)));
        window.dispatchEvent(new CustomEvent('watch-stats-updated'));
      } else {
        alert("Error al borrar el match. Inténtalo de nuevo.");
      }
    } catch (err) {
      console.error("Error deleting match:", err);
      alert("Error de conexión al borrar el match.");
    }
  };

  useEffect(() => {
    if (subTab === 'matches') {
      loadMatchesList();
    }
  }, [subTab, matchesRefreshTrigger, activeRoom?.codigo, activeRoom?.categoria]);

  useEffect(() => {
    const handleStatsUpdated = () => {
      loadMatchesList();
    };
    window.addEventListener('watch-stats-updated', handleStatsUpdated);
    return () => {
      window.removeEventListener('watch-stats-updated', handleStatsUpdated);
    };
  }, [activeRoom?.codigo]);

  // Sincronizar integrantes del lobby mediante polling
  useEffect(() => {
    let intervalId = null;
    if (activeRoom && activeRoom.tipo === 'grupo_amigos' && !activeRoom.voting_started) {
      const fetchMembers = () => {
        fetch(`${API_BASE_URL}/api/rooms/members/${activeRoom.codigo}`)
          .then((res) => res.json())
          .then((data) => {
            if (Array.isArray(data)) {
              setRoomMembers(data);
            }
          })
          .catch((err) => console.log("Error al sincronizar integrantes: ", err));
      };
      fetchMembers();
      intervalId = setInterval(fetchMembers, 3000);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [activeRoom?.codigo, activeRoom?.voting_started]);

  const handleStartVoting = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "START_VOTING" }));
    }
  };

  // Renderizar Lobby si es sala de amigos y no se ha iniciado la votación
  const isTv = activeRoom?.categoria === 'series';

  if (activeRoom && activeRoom.tipo === 'grupo_amigos' && !activeRoom.voting_started) {
    return (
      <div className="w-full max-w-md mx-auto bg-slate-900/60 border border-slate-850 backdrop-blur-xl rounded-3xl p-8 shadow-2xl space-y-6">
        
        {/* Header */}
        <div className="text-center space-y-1.5">
          <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-400 bg-cyan-950/40 border border-cyan-850 px-2.5 py-0.5 rounded-full">
            {isTv ? "📺 Cineverse Lobby" : "🍿 Cineverse Lobby"}
          </span>
          <h2 className="text-xl font-black text-white uppercase tracking-tight">Sala de Amigos</h2>
          <p className="text-[11px] text-slate-400 leading-normal max-w-xs mx-auto">
            {isTv 
              ? "Invita a tus amigos para votar en grupo y encontrar la serie perfecta."
              : "Invita a tus amigos para votar en grupo y encontrar la película perfecta."}
          </p>
        </div>

        <div className="space-y-6 text-center">
          
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-widest text-slate-400 font-bold">Código de la Sala</p>
            
            <div className="text-cyan-400 bg-slate-950 border border-cyan-500/20 px-6 py-4 rounded-2xl text-center text-3xl font-mono font-black tracking-widest animate-pulse shadow-[0_0_15px_rgba(6,182,212,0.1)]">
              {activeRoom.codigo}
            </div>

            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(activeRoom.codigo);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="mt-2 text-xs font-bold text-cyan-400 hover:text-cyan-300 flex items-center justify-center gap-1.5 mx-auto"
            >
              {copied ? '¡Copiado! ✓' : '📋 Copiar código'}
            </button>
          </div>

          {/* CÓDIGO QR DINÁMICO */}
          <div className="space-y-3 pt-2">
            <p className="text-xs uppercase tracking-widest text-slate-400 font-bold">Escanea para Unirte</p>
            <div className="w-44 h-44 bg-white p-3.5 rounded-2xl mx-auto flex items-center justify-center shadow-[0_0_20px_rgba(6,182,212,0.45)] border-2 border-cyan-400/80 transition-transform duration-300 hover:scale-105">
              <QRCodeSVG 
                value={`${window.location.origin}/?sala=${activeRoom.codigo}`} 
                size={144}
                level="M"
                fgColor="#090d16"
                includeMargin={false}
              />
            </div>
            <p className="text-[10px] text-slate-500 leading-normal max-w-xs mx-auto">
              Abre la cámara de tu móvil para escanear y acceder directamente.
            </p>
          </div>

          {/* Integrantes Conectados */}
          <div className="bg-slate-950/50 p-4 rounded-2xl border border-slate-900 text-left space-y-3">
            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Participantes en el Lobby ({roomMembers.length})
            </h4>
            <div className="space-y-2 max-h-32 overflow-y-auto pr-1">
              {roomMembers.map((member) => (
                <div key={member.id} className="flex items-center gap-2.5 py-1">
                  <img
                    src={member.avatar_url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?q=80&w=150'}
                    alt={member.name}
                    className="w-6 h-6 rounded-full border border-slate-800 object-cover"
                  />
                  <span className="text-xs text-white font-bold">{member.name}</span>
                  {member.id === activeRoom.creador_id && (
                    <span className="text-[8px] bg-cyan-950 text-cyan-400 border border-cyan-900 px-1 py-0.5 rounded font-black uppercase">
                      Creador
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="py-2 space-y-4">
            {/* Botón de compartir */}
            <div className="space-y-2">
              <button
                type="button"
                onClick={async () => {
                  const joinUrl = `${window.location.origin}/?sala=${activeRoom.codigo}`;
                  const shareData = {
                    title: isTv ? '📺 ¡Únete a mi sala en CINEVERSE!' : '🍿 ¡Únete a mi sala en CINEVERSE!',
                    text: isTv ? `Entra a votar series conmigo. Código: ${activeRoom.codigo}` : `Entra a votar películas conmigo. Código: ${activeRoom.codigo}`,
                    url: joinUrl,
                  };
                  if (navigator.share) {
                    try {
                      await navigator.share(shareData);
                    } catch (err) {
                      if (err.name !== 'AbortError') {
                        await navigator.clipboard.writeText(`${shareData.text}\n${joinUrl}`);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2500);
                      }
                    }
                  } else {
                    await navigator.clipboard.writeText(`${shareData.text}\n${joinUrl}`);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2500);
                  }
                }}
                className="w-full py-3 bg-gradient-to-r from-cyan-500/20 to-blue-600/20 hover:from-cyan-500 hover:to-blue-600 border border-cyan-500/30 hover:border-transparent text-cyan-400 hover:text-slate-950 font-black rounded-xl text-xs transition-all duration-300 active:scale-98 transform flex items-center justify-center gap-2 shadow-md shadow-cyan-500/5"
              >
                {copied ? (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"/>
                    </svg>
                    ¡Enlace copiado al portapapeles!
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/>
                    </svg>
                    {isTv ? "Invitar amigos para votar series" : "Invitar amigos a la sala"}
                  </>
                )}
              </button>
              <p className="text-[9px] text-slate-600 text-center">
                En móvil abre el menú de compartir · En escritorio copia el enlace
              </p>
            </div>

            {activeRoom.creador_id === user.id ? (
              <button
                onClick={handleStartVoting}
                disabled={roomMembers.length < 2}
                className={`w-full py-3 text-white font-bold rounded-xl text-xs transition transform shadow-lg ${
                  roomMembers.length < 2
                    ? 'bg-slate-850 border border-slate-800 text-slate-500 cursor-not-allowed shadow-none'
                    : 'bg-gradient-to-r from-pink-500 to-rose-600 hover:brightness-110 active:scale-98 shadow-pink-500/10'
                }`}
              >
                {roomMembers.length < 2 ? '⏱ Esperando a tus amigos (mínimo 2 participantes)' : '🚀 Iniciar Juego de Votación'}
              </button>
            ) : (
              <div className="w-full py-3 bg-slate-950/50 border border-slate-900 text-slate-400 rounded-xl text-xs text-center font-bold flex items-center justify-center gap-2 animate-pulse">
                <span className="w-2 h-2 rounded-full bg-cyan-400" />
                Esperando a que el creador inicie la votación...
              </div>
            )}
            
            {onLeaveRoom && (
              <button
                onClick={onLeaveRoom}
                className="w-full py-2 bg-slate-950 hover:bg-slate-900 text-slate-500 rounded-xl text-xs border border-slate-850 transition"
              >
                ← Salir al Panel Central
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-lg mx-auto flex flex-col space-y-6">
      
      {/* Selector de Subpestañas del Dashboard */}
      <div className="flex justify-center border-b border-slate-900 pb-2">
        <div className="flex bg-slate-900/60 p-1 border border-slate-850 rounded-xl space-x-2 w-full max-w-xs">
          <button
            onClick={() => setSubTab('swipe')}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition duration-200 ${
              subTab === 'swipe'
                ? 'bg-slate-950 text-cyan-400 border border-cyan-500/20 shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            🔥 Deslizar
          </button>
          <button
            onClick={() => setSubTab('matches')}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition duration-200 flex items-center justify-center gap-1.5 ${
              subTab === 'matches'
                ? 'bg-slate-950 text-pink-400 border border-pink-500/20 shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            🍿 Matches
            {matches.length > 0 && (
              <span className="w-2 h-2 rounded-full bg-pink-500 animate-ping"></span>
            )}
          </button>
        </div>
      </div>

      {/* Banner de Estado de Conexión en Tiempo Real */}
      <div className="px-4 relative z-10">
        {partnerOnline ? (
          <div className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest text-center flex items-center justify-center gap-1.5 bg-emerald-950/20 border border-emerald-900/10 py-2 px-4 rounded-full shadow-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]" />
            {activeRoom?.tipo === "grupo_amigos" ? "Amigos activos en línea - Sincronizado por WebSocket" : "Pareja activa en línea - Sincronizado por WebSocket"}
          </div>
        ) : (
          <div className="text-[10px] text-amber-500 font-bold uppercase tracking-widest text-center flex items-center justify-center gap-1.5 bg-amber-950/20 border border-amber-900/10 py-2 px-4 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            {activeRoom?.tipo === "grupo_amigos" ? "Esperando a que tus amigos se conecten..." : "Esperando a que tu pareja se conecte..."}
          </div>
        )}
      </div>

      {/* RENDERIZADO DE SUBPESTAÑA */}
      <div className="flex-1">
        
        {/* A. Mazo de Swipe */}
        {subTab === 'swipe' && (
          <>
            <MovieSwipeDeck
              userId={user.id}
              fetchUrl={fetchUrl}
              decideUrl={decideUrl}
              onMatchTrigger={onMatchTrigger}
              ws={ws}
              partnerOnline={partnerOnline}
              activeRoom={activeRoom}
              catalog={catalog}
              externalIndex={externalIndex}
              setExternalIndex={setExternalIndex}
              onReset={onReset}
            />
            <PendingWatchList user={user} onMovieClick={onMovieClick} />
          </>
        )}

        {/* B. Coincidencias Guardadas Persistentes */}
        {subTab === 'matches' && (
          <div className="space-y-4 px-2">
            
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">Historial de Coincidencias</h3>
              <button
                onClick={loadMatchesList}
                className="text-[10px] text-cyan-400 font-bold hover:underline"
              >
                Actualizar lista
              </button>
            </div>

            {loadingMatches && (
              <div className="flex flex-col items-center justify-center py-20 text-slate-500 space-y-2">
                <div className="w-6 h-6 border-2 border-pink-500/20 border-t-pink-500 rounded-full animate-spin"></div>
                <p className="text-[10px] uppercase font-bold tracking-widest">
                  {activeRoom?.tipo === "grupo_amigos" ? "Sincronizando con el grupo..." : "Sincronizando con tu pareja..."}
                </p>
              </div>
            )}

            {!loadingMatches && matchesError && (
              <p className="text-xs text-red-400 text-center py-8">{matchesError}</p>
            )}

            {!loadingMatches && !matchesError && matches.length === 0 && (
              <div className="text-center py-16 bg-slate-900/40 border border-slate-900 rounded-2xl p-6 space-y-3">
                <span className="text-2xl">💔</span>
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-widest">Sin coincidencias todavía</h4>
                <p className="text-xs text-slate-500 leading-relaxed max-w-xs mx-auto">
                  {activeRoom?.tipo === "grupo_amigos" 
                    ? `Aún no hay coincidencias de ${isTv ? "series" : "películas"} en el grupo. ¡Seguid deslizando cartas para encontrar la ideal!`
                    : `Tú o tu pareja aún no habéis coincidido en vuestros likes. ¡Seguid deslizando cartas para encontrar el match perfecto de ${isTv ? "series" : "películas"}!`}
                </p>
              </div>
            )}

            {!loadingMatches && !matchesError && matches.length > 0 && (
              <div className="grid grid-cols-1 gap-3">
                {matches.map((movie) => (
                  <div
                    key={movie.id}
                    className={`relative p-3 bg-slate-900/40 border ${
                      movie.visto ? 'border-emerald-500/20 bg-emerald-950/5' : 'border-slate-900'
                    } rounded-2xl flex gap-4 hover:border-slate-850 transition duration-300`}
                  >
                    {/* Poster miniatura */}
                    <div 
                      onClick={() => onMovieClick && onMovieClick(movie)}
                      className="cursor-pointer transition hover:scale-105 shrink-0"
                    >
                      <img
                        src={movie.poster_url || "https://images.unsplash.com/photo-1440404653325-ab127d49abc1?q=80&w=500&auto=format&fit=crop"}
                        alt={movie.titulo}
                        className="w-14 aspect-[2/3] object-cover rounded-lg border border-slate-800 shadow-md"
                      />
                    </div>

                    {/* Información resumida */}
                    <div className="flex flex-col justify-between py-1 min-w-0 flex-1 text-left">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <h4 
                            onClick={() => onMovieClick && onMovieClick(movie)}
                            className="font-extrabold text-sm text-white truncate uppercase tracking-tight max-w-[180px] cursor-pointer hover:text-cyan-400 transition"
                          >
                            {movie.titulo}
                          </h4>
                          <span className="bg-yellow-500/20 text-yellow-400 text-[9px] font-black px-1.5 py-0.5 rounded border border-yellow-500/10 shrink-0">
                            ★ {movie.rating || 'N/A'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 font-light line-clamp-2 leading-relaxed text-left">
                          {movie.sinopsis}
                        </p>
                      </div>
                      <div className="flex items-center justify-between mt-2 gap-2 flex-wrap sm:flex-nowrap">
                        <span className="text-[9px] font-black text-emerald-400 tracking-wider flex items-center gap-1.5">
                          {isTv 
                            ? (activeRoom?.tipo === "grupo_amigos" ? "📺 COINCIDENCIA GRUPAL" : "👫 MATCH DE SERIE")
                            : (activeRoom?.tipo === "grupo_amigos" ? "🍿 COINCIDENCIA GRUPAL" : "👫 MATCH PERFECTO")}
                          {movie.visto && (
                            <span className="text-[8px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.5 rounded font-extrabold uppercase">
                              ✓ Visto
                            </span>
                          )}
                        </span>
                        
                        <div className="flex items-center gap-1.5 ml-auto">
                          {/* Botón de borrar match */}
                          <button
                            onClick={() => handleDeleteMatch(movie)}
                            title="Borrar match"
                            className="px-2 py-1 bg-slate-950 hover:bg-red-950/45 border border-slate-850 hover:border-red-900/40 text-[9px] text-slate-500 hover:text-red-400 font-extrabold rounded-lg flex items-center justify-center transition transform active:scale-95 duration-200"
                          >
                            🗑️
                          </button>

                          {movie.visto ? (
                            <button
                              onClick={() => handleToggleMatchWatched(movie, true)}
                              className="px-2 py-1 bg-rose-950/30 hover:bg-rose-950/60 border border-rose-500/30 hover:border-rose-500/50 text-[9px] text-rose-400 font-extrabold rounded-lg flex items-center gap-1 transition transform active:scale-95 duration-200"
                            >
                              🚫 Desmarcar como vista
                            </button>
                          ) : (
                            <button
                              onClick={() => handleToggleMatchWatched(movie, false)}
                              className="px-2 py-1 bg-emerald-950/30 hover:bg-emerald-950/60 border border-emerald-500/30 hover:border-emerald-500/50 text-[9px] text-emerald-400 font-extrabold rounded-lg flex items-center gap-1 transition transform active:scale-95 duration-200"
                            >
                              👁️ Marcar como vista
                            </button>
                          )}

                          <button
                            onClick={() => setSchedulingMovie(movie.titulo)}
                            className="px-2.5 py-1 bg-slate-950 hover:bg-slate-900 border border-slate-850 hover:border-slate-800 text-[9px] text-cyan-400 font-extrabold rounded-lg flex items-center gap-1 transition transform active:scale-95"
                          >
                            {isTv
                              ? (activeRoom?.tipo === "grupo_amigos" ? "📅 Organizar Maratón" : "📅 Cita de Serie")
                              : (activeRoom?.tipo === "grupo_amigos" ? "📅 Organizar Quedada" : "📅 Agendar Cita")}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

          </div>
        )}

      </div>

      {/* Modal para agendar cita */}
      <ScheduleDateModal
        isOpen={!!schedulingMovie}
        onClose={() => setSchedulingMovie(null)}
        movieTitle={schedulingMovie}
        activeRoom={activeRoom}
      />
    </div>
  );
}
