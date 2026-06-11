import React, { useState, useEffect, useRef } from 'react';

export default function CineVerseWrapped({ user, onClose }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeSlide, setActiveSlide] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  
  const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';
  const slideDuration = 6000; // 6 seconds per slide
  const timerRef = useRef(null);
  const startTimeRef = useRef(null);
  const elapsedRef = useRef(0);
  const [progress, setProgress] = useState(0);

  const totalSlides = 6;

  useEffect(() => {
    const fetchStats = async () => {
      if (!user) return;
      try {
        const res = await fetch(`${API_BASE_URL}/api/wrapped/${user.id}`);
        if (res.ok) {
          const data = await res.json();
          setStats(data);
        }
      } catch (err) {
        console.error("Error al obtener stats de wrapped:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, [user?.id]);

  // Handle slide timing and progress bar
  useEffect(() => {
    if (!isPlaying || loading || !stats) {
      if (timerRef.current) {
        cancelAnimationFrame(timerRef.current);
      }
      return;
    }

    startTimeRef.current = Date.now() - elapsedRef.current;

    const updateProgress = () => {
      const elapsed = Date.now() - startTimeRef.current;
      elapsedRef.current = elapsed;
      
      const pct = Math.min((elapsed / slideDuration) * 100, 100);
      setProgress(pct);

      if (elapsed >= slideDuration) {
        elapsedRef.current = 0;
        setProgress(0);
        setActiveSlide(prev => {
          if (prev < totalSlides - 1) {
            return prev + 1;
          } else {
            setIsPlaying(false); // Stop playing at the end
            return prev;
          }
        });
      } else {
        timerRef.current = requestAnimationFrame(updateProgress);
      }
    };

    timerRef.current = requestAnimationFrame(updateProgress);

    return () => {
      if (timerRef.current) {
        cancelAnimationFrame(timerRef.current);
      }
    };
  }, [isPlaying, activeSlide, loading, stats]);

  const handleNext = () => {
    if (activeSlide < totalSlides - 1) {
      elapsedRef.current = 0;
      setProgress(0);
      setActiveSlide(activeSlide + 1);
      setIsPlaying(true);
    }
  };

  const handlePrev = () => {
    if (activeSlide > 0) {
      elapsedRef.current = 0;
      setProgress(0);
      setActiveSlide(activeSlide - 1);
      setIsPlaying(true);
    }
  };

  const handleTogglePlay = () => {
    setIsPlaying(!isPlaying);
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-[100] bg-slate-950 flex flex-col items-center justify-center text-white space-y-4">
        <div className="w-12 h-12 border-4 border-fuchsia-500/20 border-t-fuchsia-500 rounded-full animate-spin"></div>
        <p className="text-sm font-bold tracking-widest text-fuchsia-400 uppercase animate-pulse">
          Cargando vuestro CineVerse Wrapped... 💫
        </p>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="fixed inset-0 z-[100] bg-slate-950 flex flex-col items-center justify-center text-white p-6 text-center space-y-4">
        <p className="text-slate-400">No hemos podido cargar vuestras estadísticas en este momento.</p>
        <button onClick={onClose} className="px-6 py-2 bg-slate-800 text-white rounded-xl hover:bg-slate-700">
          Cerrar
        </button>
      </div>
    );
  }

  const { total_vistas, genero_rey, mes_mas_cinefilo, ratio_movies_series } = stats;
  const ratioSeries = total_vistas > 0 ? (100 - ratio_movies_series).toFixed(1) : 0;

  return (
    <div className="fixed inset-0 z-[100] bg-gradient-to-tr from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center select-none overflow-hidden font-sans">
      
      {/* Dynamic Animated background blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-40">
        <div className="absolute top-[20%] left-[10%] w-80 h-80 rounded-full bg-fuchsia-500/10 blur-[120px] animate-pulse"></div>
        <div className="absolute bottom-[20%] right-[10%] w-96 h-96 rounded-full bg-violet-600/10 blur-[130px] animate-pulse"></div>
      </div>

      <div className="relative w-full max-w-lg h-full max-h-[850px] bg-slate-950/85 md:rounded-3xl border border-slate-850 shadow-2xl flex flex-col justify-between p-6 overflow-hidden">
        
        {/* TOP CONTROLS & STORIES SEGMENT BAR */}
        <div className="w-full space-y-4 z-10">
          <div className="flex gap-1.5 w-full">
            {Array.from({ length: totalSlides }).map((_, idx) => (
              <div key={idx} className="h-1 flex-1 bg-slate-800 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-fuchsia-500 to-pink-500 transition-all ease-linear"
                  style={{
                    width: idx < activeSlide ? '100%' : idx === activeSlide ? `${progress}%` : '0%',
                    transitionDuration: idx === activeSlide ? '50ms' : '0ms'
                  }}
                ></div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-black tracking-widest text-fuchsia-400">CINEVERSE WRAPPED</span>
            <div className="flex items-center gap-4">
              <button onClick={handleTogglePlay} className="p-1 hover:text-white transition">
                {isPlaying ? (
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
                  </svg>
                )}
              </button>
              <button onClick={onClose} className="p-1 hover:text-white transition">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* MIDDLE SLIDE CONTAINER */}
        <div className="flex-1 flex items-center justify-center my-6 z-10">
          
          {/* SLIDE 0: Welcome */}
          {activeSlide === 0 && (
            <div className="text-center space-y-6 animate-[fadeIn_0.5s_ease-out]">
              <div className="text-6xl animate-bounce">💫</div>
              <h1 className="text-4xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-fuchsia-400 via-pink-400 to-violet-400 uppercase">
                CineVerse<br/>Wrapped
              </h1>
              <p className="text-slate-400 text-sm max-w-xs mx-auto leading-relaxed">
                Preparaos para revivir vuestra historia de amor en la gran pantalla. Analizamos vuestros matches y visualizaciones de este año. 🍿🎬
              </p>
            </div>
          )}

          {/* SLIDE 1: Total Views */}
          {activeSlide === 1 && (
            <div className="text-center space-y-6 px-4 animate-[fadeIn_0.5s_ease-out]">
              <div className="text-5xl">🛋️🍿</div>
              <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Noches de Pelis y Sofá</p>
              <h2 className="text-3xl font-extrabold text-white">
                Habéis compartido
              </h2>
              <div className="inline-block px-8 py-4 bg-fuchsia-500/10 border border-fuchsia-500/20 text-fuchsia-300 font-mono text-7xl font-black rounded-3xl shadow-[0_0_30px_rgba(240,46,170,0.15)] animate-pulse">
                {total_vistas}
              </div>
              <h2 className="text-3xl font-extrabold text-white">
                visualizaciones juntos
              </h2>
              <p className="text-slate-400 text-xs leading-relaxed max-w-xs mx-auto">
                {total_vistas > 10 ? '¡Menudo maratón! Sois una pareja de cine.' : total_vistas > 0 ? '¡Buen comienzo! A seguir sumando matches y palomitas.' : 'Parece que aún no habéis marcado nada como visto.'}
              </p>
            </div>
          )}

          {/* SLIDE 2: Genre King */}
          {activeSlide === 2 && (
            <div className="text-center space-y-6 px-4 animate-[fadeIn_0.5s_ease-out]">
              <div className="text-5xl">👑🎬</div>
              <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Vuestro Estilo Favorito</p>
              <h2 className="text-2xl font-extrabold text-white leading-tight">
                El género rey indiscutible de vuestro salón es...
              </h2>
              <div className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-fuchsia-400 drop-shadow-md">
                {genero_rey}
              </div>
              <p className="text-slate-400 text-xs leading-normal max-w-xs mx-auto">
                {genero_rey !== 'Ninguno' 
                  ? `La mayoría de vuestras citas en el sofá han estado llenas de ${genero_rey.toLowerCase()}. ¡Gran coincidencia!` 
                  : 'Aún no tenemos suficientes datos de género para vuestro perfil.'}
              </p>
            </div>
          )}

          {/* SLIDE 3: Peak Month */}
          {activeSlide === 3 && (
            <div className="text-center space-y-6 px-4 animate-[fadeIn_0.5s_ease-out]">
              <div className="text-5xl">🗓️✨</div>
              <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Vuestra Temporada Dorada</p>
              <h2 className="text-2xl font-extrabold text-white leading-tight">
                Vuestro mes más cinéfilo y seriéfilo fue...
              </h2>
              <div className="text-5xl font-black text-pink-400 tracking-tight">
                {mes_mas_cinefilo}
              </div>
              <p className="text-slate-400 text-xs leading-normal max-w-xs mx-auto">
                {mes_mas_cinefilo !== 'Ninguno' 
                  ? `En ${mes_mas_cinefilo} las palomitas no faltaron ni un solo día. ¡Vuestro mes más activo!` 
                  : 'Pronto descubriremos vuestro mes con más amor al cine.'}
              </p>
            </div>
          )}

          {/* SLIDE 4: Ratio Movie vs Series */}
          {activeSlide === 4 && (
            <div className="w-full max-w-sm px-6 text-center space-y-6 animate-[fadeIn_0.5s_ease-out]">
              <div className="text-5xl">⚖️📺</div>
              <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">¿Cine o Series?</p>
              <h2 className="text-2xl font-extrabold text-white">¿Cuál es vuestro balance?</h2>
              
              <div className="space-y-4 pt-4">
                <div className="flex justify-between text-xs font-black">
                  <span className="text-rose-400 uppercase">🎥 Películas ({ratio_movies_series}%)</span>
                  <span className="text-indigo-400 uppercase">📺 Series ({ratioSeries}%)</span>
                </div>
                
                {/* Horizontal visual progress bar */}
                <div className="w-full h-5 bg-slate-900 rounded-full overflow-hidden border border-slate-800 flex">
                  <div 
                    className="h-full bg-gradient-to-r from-rose-500 to-pink-500 transition-all duration-1000"
                    style={{ width: `${ratio_movies_series}%` }}
                  ></div>
                  <div 
                    className="h-full bg-gradient-to-r from-indigo-500 to-purple-600 transition-all duration-1000"
                    style={{ width: `${ratioSeries}%` }}
                  ></div>
                </div>
              </div>

              <p className="text-slate-400 text-xs leading-relaxed max-w-xs mx-auto">
                {ratio_movies_series > 60 
                  ? 'Os encantan las historias autoconclusivas y las películas espectaculares. 🎬' 
                  : ratio_movies_series < 40 
                  ? 'Sois unos devoradores de series. Os encanta el enganche continuo. 📺' 
                  : 'Tenéis el balance perfecto. Os encantan los maratones de series tanto como una buena peli. 🍿'}
              </p>
            </div>
          )}

          {/* SLIDE 5: Full Summary Card */}
          {activeSlide === 5 && (
            <div className="w-full max-w-sm px-4 text-center animate-[fadeIn_0.5s_ease-out]">
              <div className="bg-slate-900/60 border border-slate-800/80 backdrop-blur-xl rounded-3xl p-6 shadow-2xl space-y-5 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 bg-fuchsia-500/10 rounded-full blur-2xl"></div>
                <div className="absolute bottom-0 left-0 w-24 h-24 bg-violet-500/10 rounded-full blur-2xl"></div>
                
                <h3 className="text-lg font-black text-white tracking-wider border-b border-slate-850 pb-2">
                  💫 NUESTRO CINEVERSE 💫
                </h3>

                <div className="grid grid-cols-2 gap-4 text-left">
                  <div className="bg-slate-950/50 border border-slate-850 p-3 rounded-2xl">
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Vistas totales</p>
                    <p className="text-2xl font-black text-fuchsia-400 mt-1">{total_vistas}</p>
                  </div>
                  
                  <div className="bg-slate-950/50 border border-slate-850 p-3 rounded-2xl">
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Género Rey</p>
                    <p className="text-md font-black text-white mt-1.5 truncate" title={genero_rey}>{genero_rey}</p>
                  </div>

                  <div className="bg-slate-950/50 border border-slate-850 p-3 rounded-2xl">
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Mes Cinéfilo</p>
                    <p className="text-md font-black text-pink-400 mt-1.5 truncate" title={mes_mas_cinefilo}>{mes_mas_cinefilo}</p>
                  </div>

                  <div className="bg-slate-950/50 border border-slate-850 p-3 rounded-2xl">
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Pelis / Series</p>
                    <p className="text-sm font-black text-violet-400 mt-2">
                      {ratio_movies_series}% / {ratioSeries}%
                    </p>
                  </div>
                </div>

                <div className="text-center pt-2">
                  <p className="text-[10px] text-slate-500 italic">
                    ¡Por un año lleno de más momentos juntos en el sofá! ❤️
                  </p>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* BOTTOM CONTROLS & NAVIGATION */}
        <div className="flex items-center justify-between z-10 pt-4 border-t border-slate-900">
          <button 
            onClick={handlePrev} 
            disabled={activeSlide === 0}
            className={`px-5 py-2.5 rounded-xl text-xs font-extrabold uppercase tracking-widest transition ${
              activeSlide === 0 
                ? 'text-slate-600 cursor-not-allowed bg-slate-900/20' 
                : 'text-slate-400 bg-slate-900/60 hover:bg-slate-800 hover:text-white'
            }`}
          >
            Atrás
          </button>
          
          <span className="text-xs font-mono font-bold text-slate-500">
            {activeSlide + 1} / {totalSlides}
          </span>

          {activeSlide === totalSlides - 1 ? (
            <button 
              onClick={onClose}
              className="px-6 py-2.5 bg-gradient-to-r from-fuchsia-600 to-pink-600 hover:from-fuchsia-500 hover:to-pink-500 text-white font-extrabold text-xs uppercase tracking-widest rounded-xl transition shadow-[0_0_15px_rgba(240,46,170,0.3)]"
            >
              Terminar
            </button>
          ) : (
            <button 
              onClick={handleNext}
              className="px-5 py-2.5 bg-slate-900/60 hover:bg-slate-800 text-white font-extrabold text-xs uppercase tracking-widest rounded-xl transition"
            >
              Siguiente
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
