import React, { useState, useEffect } from 'react';
import CouplesMetricsWidget from './CouplesMetricsWidget';
import IndecisionRoulette from './IndecisionRoulette';
import CouplesHistoryTimeline from './CouplesHistoryTimeline';

function SectionPaginator({ title, subtitle, items, onMovieClick, onSelectHero, showReleaseDate = false }) {
  const [currentPage, setCurrentPage] = useState(0);
  const itemsPerPage = 6;
  const totalPages = Math.ceil(items.length / itemsPerPage);

  // Reset page when items change
  useEffect(() => {
    setCurrentPage(0);
  }, [items]);

  if (!items || items.length === 0) return null;

  const currentItems = items.slice(currentPage * itemsPerPage, (currentPage + 1) * itemsPerPage);

  return (
    <div className="space-y-4 text-left">
      <div className="flex items-center justify-between border-b border-slate-900 pb-2">
        <div>
          <h3 className="text-lg font-extrabold tracking-wide text-white uppercase flex items-center gap-2">
            <span className="w-2 h-5 bg-gradient-to-b from-cyan-400 to-blue-500 rounded-full inline-block"></span>
            {title}
          </h3>
          {subtitle && <p className="text-[11px] text-slate-400 font-light mt-0.5">{subtitle}</p>}
        </div>
        
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 0))}
              disabled={currentPage === 0}
              className="w-7 h-7 rounded-full bg-slate-900 border border-slate-800 hover:border-cyan-500 disabled:opacity-30 disabled:hover:border-slate-800 flex items-center justify-center transition active:scale-95"
            >
              <svg className="w-3.5 h-3.5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="text-[11px] text-slate-400 font-mono">
              {currentPage + 1} / {totalPages}
            </span>
            <button 
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages - 1))}
              disabled={currentPage === totalPages - 1}
              className="w-7 h-7 rounded-full bg-slate-900 border border-slate-800 hover:border-cyan-500 disabled:opacity-30 disabled:hover:border-slate-800 flex items-center justify-center transition active:scale-95"
            >
              <svg className="w-3.5 h-3.5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        )}
      </div>
      
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
        {currentItems.map((item) => (
          <div
            key={item.id}
            onClick={() => {
              onSelectHero(item);
              if (onMovieClick) onMovieClick(item);
            }}
            className="group relative aspect-[2/3] w-full rounded-2xl overflow-hidden bg-slate-900 border border-slate-900 hover:border-slate-850 cursor-pointer transition-all duration-300 hover:scale-105 hover:border-cyan-500/30 hover:shadow-lg hover:shadow-cyan-500/10"
          >
            <img
              src={item.poster_url || "https://images.unsplash.com/photo-1440404653325-ab127d49abc1?q=80&w=500&auto=format&fit=crop"}
              alt={item.titulo}
              className="w-full h-full object-cover transition-all duration-500 group-hover:scale-110"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-2">
              <div className="bg-slate-950/85 backdrop-blur-md border border-white/10 rounded-xl p-2 text-left">
                <h4 className="font-bold text-[11px] text-white truncate drop-shadow-md">{item.titulo}</h4>
                <div className="flex items-center justify-between mt-1 text-[10px] text-yellow-400 font-semibold">
                  <span>★ {item.rating || 'N/A'}</span>
                  {showReleaseDate && item.fecha_estreno && (
                    <span className="text-cyan-300">{new Date(`${item.fecha_estreno}T00:00:00`).toLocaleDateString('es-ES')}</span>
                  )}
                </div>
              </div>
            </div>
            <div className="absolute top-2 right-2 bg-slate-950/80 backdrop-blur-md border border-slate-800 text-yellow-400 text-[9px] font-bold px-1.5 py-0.5 rounded-md flex items-center gap-0.5 shadow-md group-hover:opacity-0 transition-opacity">
              ★ {item.rating || 'N/A'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function MoviesMaster({ 
  initialMovies = null, 
  fetchUrl = 'http://localhost:8000/api/movies', 
  onMovieClick = null, 
  onRefresh = null, 
  isRefreshing = false, 
  showNavbar = true,
  user = null,
  matchesCount = 0,
  totalLikes = 0,
  onConnectClick = null,
  matches = []
}) {
  const [movies, setMovies] = useState([]);
  const [series, setSeries] = useState([]);
  const [cinemaCatalog, setCinemaCatalog] = useState({ now_playing: [], upcoming: [] });
  const [contentRecommendations, setContentRecommendations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('movies'); // 'movies' or 'series'
  const [selectedHero, setSelectedHero] = useState(null);

  const API_BASE = fetchUrl.includes('/api/movies') ? fetchUrl.split('/api/movies')[0] : 'http://localhost:8000';
  const fetchMoviesUrl = `${API_BASE}/api/movies`;
  const fetchSeriesUrl = `${API_BASE}/api/series`;
  const fetchCinemaUrl = `${API_BASE}/api/movies/cinema`;

  const loadCinemaCatalog = (forceRefresh = false) => {
    const url = forceRefresh ? `${fetchCinemaUrl}?refresh=true` : fetchCinemaUrl;
    return fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error('Error al cargar cartelera de cine');
        return res.json();
      })
      .then((data) => {
        setCinemaCatalog({
          now_playing: data.now_playing || [],
          upcoming: data.upcoming || []
        });
      });
  };

  const loadAllData = (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    
    const mUrl = forceRefresh ? `${fetchMoviesUrl}?refresh=true` : fetchMoviesUrl;
    const sUrl = forceRefresh ? `${fetchSeriesUrl}?refresh=true` : fetchSeriesUrl;

    Promise.all([
      fetch(mUrl).then((res) => {
        if (!res.ok) throw new Error('Error al conectar con la API de Películas');
        return res.json();
      }),
      fetch(sUrl).then((res) => {
        if (!res.ok) throw new Error('Error al conectar con la API de Series');
        return res.json();
      }),
      loadCinemaCatalog(forceRefresh)
    ])
      .then(([moviesData, seriesData]) => {
        setMovies(moviesData);
        setSeries(seriesData);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  };

  useEffect(() => {
    if (initialMovies) {
      setMovies(initialMovies);
      
      // Cargar series cuando initialMovies está definido pero las series no se han pasado
      fetch(fetchSeriesUrl)
        .then((res) => {
          if (!res.ok) throw new Error('Error al conectar con la API de Series');
          return res.json();
        })
        .then((seriesData) => {
          setSeries(seriesData);
        })
        .catch((err) => console.warn('Error al cargar series:', err.message));

      setLoading(false);
      loadCinemaCatalog(false).catch((err) => console.warn(err.message));
      if (initialMovies.length > 0) {
        setSelectedHero(initialMovies[0]);
      }
    } else {
      loadAllData(false);
    }
  }, [initialMovies, fetchUrl]);

  useEffect(() => {
    const activeItems = activeTab === 'series' ? series : movies;
    if (activeItems && activeItems.length > 0) {
      setSelectedHero(activeItems[0]);
    } else {
      setSelectedHero(null);
    }
  }, [activeTab, movies, series]);

  useEffect(() => {
    if (user && user.id) {
      const recUrl = `${API_BASE}/api/recommendations/${user.id}`;
      fetch(recUrl)
        .then((res) => {
          if (!res.ok) throw new Error('Error al conectar con la API de Recomendaciones');
          return res.json();
        })
        .then((recData) => {
          setContentRecommendations(recData || []);
        })
        .catch((err) => console.warn('Error al cargar recomendaciones:', err.message));
    } else {
      setContentRecommendations([]);
    }
  }, [user, fetchUrl]);

  const handleRefresh = () => {
    if (initialMovies) {
      loadCinemaCatalog(true).catch((err) => setError(err.message));
      
      // Refrescar series al actualizar cuando initialMovies está definido
      fetch(`${fetchSeriesUrl}?refresh=true`)
        .then((res) => {
          if (!res.ok) throw new Error('Error al conectar con la API de Series');
          return res.json();
        })
        .then((seriesData) => {
          setSeries(seriesData);
        })
        .catch((err) => setError(err.message));
    } else {
      loadAllData(true);
    }

    if (user && user.id) {
      const recUrl = `${API_BASE}/api/recommendations/${user.id}`;
      fetch(recUrl)
        .then((res) => res.json())
        .then((recData) => setContentRecommendations(recData || []))
        .catch((err) => console.warn('Error al refrescar recomendaciones:', err.message));
    }

    if (onRefresh) onRefresh();
  };

  // Filtrado para búsqueda
  const activeItems = activeTab === 'series' ? series : movies;
  const filteredItems = activeItems.filter((item) =>
    item.titulo.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Secciones de películas
  const moviesTrending = movies.slice(0, 18);
  const moviesNowPlaying = cinemaCatalog.now_playing;
  const nowPlayingIds = new Set(moviesNowPlaying.map((movie) => movie.id));
  const moviesUpcoming = cinemaCatalog.upcoming.filter((movie) => !nowPlayingIds.has(movie.id));
  const moviesTopRated = [...movies].sort((a, b) => (b.rating || 0) - (a.rating || 0)).slice(0, 18);

  // Secciones de series
  const seriesTrending = series.slice(0, 18);
  const seriesTopRated = [...series].sort((a, b) => (b.rating || 0) - (a.rating || 0)).slice(0, 18);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-cyan-500 selection:text-slate-900">
      
      {/* 1. Navbar Superior Minimalista Premium */}
      {showNavbar && (
        <nav className="sticky top-0 z-50 bg-slate-950/80 backdrop-blur-md border-b border-slate-900 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl font-black tracking-wider bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 bg-clip-text text-transparent hover:brightness-110 transition cursor-pointer">
              CINEVERSE
            </span>
            <span className="px-2 py-0.5 text-[10px] font-bold tracking-widest text-cyan-400 bg-cyan-950/50 border border-cyan-800 rounded">
              PRO
            </span>
          </div>

          {/* Buscador y Botón de Refrescar */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleRefresh}
              disabled={isRefreshing || loading}
              className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-850 disabled:opacity-50 text-cyan-400 hover:text-cyan-300 font-bold text-xs border border-slate-800 rounded-full transition transform hover:scale-105 active:scale-95 duration-200"
            >
              <svg className={`w-3.5 h-3.5 ${isRefreshing || loading ? 'animate-spin text-indigo-400' : 'hover:rotate-180 transition-transform duration-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 7.89M9 11l3-3 3 3m-3-3v12" />
              </svg>
              <span>{isRefreshing || loading ? 'Scrapeando...' : 'Actualizar'}</span>
            </button>
            <div className="relative w-48 md:w-64">
              <input
                type="text"
                placeholder={activeTab === 'series' ? "Buscar serie..." : "Buscar película..."}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-900/80 text-sm text-slate-200 pl-10 pr-4 py-2 rounded-full border border-slate-800 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all placeholder:text-slate-500"
              />
              <svg
                className="absolute left-3.5 top-2.5 h-4.5 w-4.5 text-slate-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
          </div>
        </nav>
      )}

      {/* 2. Hero Section */}
      {!loading && selectedHero && (
        <div className="relative w-full h-[45vh] md:h-[60vh] overflow-hidden border-b border-slate-900">
          <div className="absolute inset-0">
            <img
              src={selectedHero.backdrop_url || "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?q=80&w=1200&auto=format&fit=crop"}
              alt={selectedHero.titulo}
              className="w-full h-full object-cover object-top filter brightness-[0.45] contrast-[1.05]"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-r from-slate-950/90 via-transparent to-transparent" />
          </div>

          <div className="absolute bottom-10 left-6 md:left-12 max-w-2xl z-10 space-y-4 text-left">
            <div className="flex items-center gap-3">
              <span className={`px-3 py-1 text-xs font-semibold rounded-full backdrop-blur-sm border ${
                activeTab === 'series' 
                  ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30' 
                  : 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30'
              }`}>
                {activeTab === 'series' ? 'Serie Destacada' : 'Película Destacada'}
              </span>
              <div className="flex items-center gap-1 text-yellow-400 font-bold text-sm">
                ★ {selectedHero.rating || 'N/A'}
              </div>
            </div>
            <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight text-white drop-shadow-lg uppercase">
              {selectedHero.titulo}
            </h1>
            <p className="text-sm md:text-base text-slate-300 drop-shadow line-clamp-3 leading-relaxed">
              {selectedHero.sinopsis}
            </p>
            <div className="pt-2">
              <button 
                onClick={() => { if (onMovieClick) onMovieClick(selectedHero); }} 
                className={`px-6 py-2.5 text-slate-950 font-bold rounded-lg shadow-lg transition duration-300 flex items-center gap-2 transform active:scale-95 ${
                  activeTab === 'series'
                    ? 'bg-gradient-to-r from-indigo-400 to-purple-500 hover:from-indigo-300 hover:to-purple-400 shadow-indigo-500/20'
                    : 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 shadow-cyan-500/20'
                }`}
              >
                <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                Ver Detalles
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cuerpo Principal */}
      <main className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          
          {/* Columna Principal: Listado de Películas / Series */}
          <div className="lg:col-span-3 space-y-8">
            
            {/* Tabs de Selección */}
            <div className="flex items-center gap-3 border-b border-slate-900 pb-4">
              <button
                onClick={() => { setActiveTab('movies'); setSearchQuery(''); }}
                className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-extrabold uppercase tracking-wide border transition duration-300 ${
                  activeTab === 'movies'
                    ? 'bg-gradient-to-r from-cyan-500/10 to-blue-600/10 text-cyan-400 border-cyan-500/35 shadow-lg shadow-cyan-500/5'
                    : 'bg-slate-950 border-slate-900 text-slate-400 hover:text-slate-200 hover:border-slate-800'
                }`}
              >
                🍿 Películas
              </button>
              <button
                onClick={() => { setActiveTab('series'); setSearchQuery(''); }}
                className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-extrabold uppercase tracking-wide border transition duration-300 ${
                  activeTab === 'series'
                    ? 'bg-gradient-to-r from-indigo-500/10 to-purple-600/10 text-indigo-400 border-indigo-500/35 shadow-lg shadow-indigo-500/5'
                    : 'bg-slate-950 border-slate-900 text-slate-400 hover:text-slate-200 hover:border-slate-800'
                }`}
              >
                📺 Series
              </button>
            </div>

            {error && (
              <div className="p-4 bg-red-950/30 border border-red-500/30 text-red-300 rounded-xl flex items-center gap-3">
                <svg className="w-5 h-5 text-red-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div className="text-left">
                  <p className="font-bold">Error de Conexión</p>
                  <p className="text-xs text-red-400/90">{error}. Verifica que el backend esté ejecutándose.</p>
                </div>
              </div>
            )}

            {loading && (
              <div className="space-y-12 animate-pulse">
                {[...Array(2)].map((_, sIdx) => (
                  <div key={sIdx} className="space-y-4">
                    <div className="h-6 bg-slate-900 rounded-md w-1/4" />
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
                      {[...Array(6)].map((_, i) => (
                        <div key={i} className="space-y-3">
                          <div className="aspect-[2/3] w-full bg-slate-900 rounded-2xl border border-slate-850" />
                          <div className="h-3.5 bg-slate-900 rounded-md w-3/4" />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Listado con Paginación Horizontal */}
            {!loading && !error && !searchQuery && (
              <div className="space-y-10">
                {activeTab === 'movies' ? (
                  <>
                    {/* Recomendaciones por afinidad de contenido */}
                    {contentRecommendations && contentRecommendations.length > 0 && (
                      <div className="p-6 bg-gradient-to-r from-slate-900/60 via-indigo-950/20 to-slate-900/60 rounded-3xl border border-indigo-500/10 shadow-xl shadow-indigo-500/5 relative overflow-hidden group/rec">
                        <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500/5 to-indigo-500/5 blur-xl opacity-70 transition duration-1000 group-hover/rec:opacity-100 pointer-events-none" />
                        <SectionPaginator 
                          title={user?.tiene_pareja ? "Recomendaciones para parejas" : "Películas mejor valoradas"}
                          subtitle={user?.tiene_pareja 
                            ? "Comparamos los títulos y las sinopsis de vuestros likes comunes para encontrar películas afines"
                            : "Una selección de las películas con mejor valoración del catálogo"}
                          items={contentRecommendations}
                          onMovieClick={onMovieClick}
                          onSelectHero={setSelectedHero}
                        />
                      </div>
                    )}

                    <SectionPaginator 
                      title="Películas en Tendencia" 
                      subtitle="Los títulos más comentados y vistos en la plataforma"
                      items={moviesTrending} 
                      onMovieClick={onMovieClick}
                      onSelectHero={setSelectedHero}
                    />
                    <SectionPaginator 
                      title="Ahora en Cartelera"
                      subtitle="Películas disponibles actualmente en cines"
                      items={moviesNowPlaying}
                      onMovieClick={onMovieClick}
                      onSelectHero={setSelectedHero}
                    />
                    <SectionPaginator 
                      title="Próximos Estrenos" 
                      subtitle="Próximos lanzamientos y preventas de cine"
                      items={moviesUpcoming} 
                      onMovieClick={onMovieClick}
                      onSelectHero={setSelectedHero}
                      showReleaseDate
                    />
                    <SectionPaginator 
                      title="Mejor Valoradas" 
                      subtitle="Joyas del cine con la puntuación más alta del público"
                      items={moviesTopRated} 
                      onMovieClick={onMovieClick}
                      onSelectHero={setSelectedHero}
                    />
                  </>
                ) : (
                  <>
                    <SectionPaginator 
                      title="Series Populares" 
                      subtitle="Las series más virales que están arrasando en las pantallas"
                      items={seriesTrending} 
                      onMovieClick={onMovieClick}
                      onSelectHero={setSelectedHero}
                    />
                    <SectionPaginator 
                      title="Series Mejor Valoradas" 
                      subtitle="Grandes producciones televisivas aclamadas por la crítica"
                      items={seriesTopRated} 
                      onMovieClick={onMovieClick}
                      onSelectHero={setSelectedHero}
                    />
                  </>
                )}
              </div>
            )}

            {/* Vista de Búsqueda Activa */}
            {!loading && !error && searchQuery && (
              <div className="space-y-6 text-left">
                <div className="flex items-center justify-between border-b border-slate-900 pb-2">
                  <h2 className="text-xl font-extrabold text-white uppercase flex items-center gap-2">
                    <span className="w-2.5 h-6 bg-cyan-500 rounded-full inline-block"></span>
                    Resultados de búsqueda
                  </h2>
                  <span className="text-xs font-semibold px-3 py-1 bg-slate-900 border border-slate-800 rounded-full text-slate-400">
                    {filteredItems.length} {activeTab === 'series' ? 'series' : 'películas'} encontradas
                  </span>
                </div>
                
                {filteredItems.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
                    {filteredItems.map((item) => (
                      <div
                        key={item.id}
                        onClick={() => {
                          setSelectedHero(item);
                          if (onMovieClick) onMovieClick(item);
                        }}
                        className="group relative aspect-[2/3] w-full rounded-2xl overflow-hidden bg-slate-900 border border-slate-900 hover:border-slate-850 cursor-pointer transition-all duration-300 hover:scale-105 hover:border-cyan-500/30 hover:shadow-lg hover:shadow-cyan-500/10"
                      >
                        <img
                          src={item.poster_url || "https://images.unsplash.com/photo-1440404653325-ab127d49abc1?q=80&w=500&auto=format&fit=crop"}
                          alt={item.titulo}
                          className="w-full h-full object-cover transition-all duration-500 group-hover:scale-110"
                          loading="lazy"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-2">
                          <div className="bg-slate-950/80 backdrop-blur-md border border-white/10 rounded-xl p-2 text-left">
                            <h4 className="font-bold text-xs text-white truncate">{item.titulo}</h4>
                            <div className="flex items-center justify-between mt-1 text-[10px] text-yellow-400 font-semibold">
                              <span>★ {item.rating || 'N/A'}</span>
                            </div>
                          </div>
                        </div>
                        <div className="absolute top-2 right-2 bg-slate-950/80 backdrop-blur-md border border-slate-800 text-yellow-400 text-[10px] font-bold px-1.5 py-0.5 rounded-md flex items-center gap-0.5 shadow-md group-hover:opacity-0 transition-opacity">
                          ★ {item.rating || 'N/A'}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-20 text-slate-500">
                    <svg className="w-12 h-12 mx-auto mb-4 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 13.5a3 3 0 100-6 3 3 0 000 6z" />
                    </svg>
                    <p className="text-lg font-medium">No se encontraron {activeTab === 'series' ? 'series' : 'películas'} para "{searchQuery}"</p>
                    <p className="text-sm mt-1">Intenta con otro término de búsqueda.</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Columna Lateral: Azar y Métricas de Pareja */}
          <div className="lg:col-span-1">
            <div className="sticky top-24 space-y-6">
              <IndecisionRoulette 
                movies={activeTab === 'series' ? series : movies}
                matches={matches || []}
              />
              <CouplesMetricsWidget 
                user={user}
                matchesCount={matchesCount}
                totalLikes={totalLikes}
                onConnectClick={onConnectClick}
              />
            </div>
          </div>

        </div>

        {/* Línea de Tiempo de Citas (Historial) */}
        <div className="mt-16">
          <CouplesHistoryTimeline user={user} categoria={activeTab} />
        </div>
      </main>
    </div>
  );
}
