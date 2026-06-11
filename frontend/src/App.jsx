import React, { useState, useEffect } from 'react';
import MoviesMaster from './components/MoviesMaster';
import MovieDetailDrawer from './components/MovieDetailDrawer';
import CineMatchAuth from './components/CineMatchAuth';
import CineMatchDashboard from './components/CineMatchDashboard';
import MovieMatchModal from './components/MovieMatchModal';
import TelemetryDashboard from './components/TelemetryDashboard';
import CineVerseWrapped from './components/CineVerseWrapped';
import { usePosterColors } from './hooks/usePosterColors';

export default function App() {

  const [user, setUser] = useState(null);
  const [activeRoomObj, setActiveRoomObj] = useState(null);
  const [activeRoomSeriesObj, setActiveRoomSeriesObj] = useState(null);
  const [activeTab, setActiveTab] = useState('explorer');

  // Estados de CineVerse AI (Explorador)
  const [explorerMovies, setExplorerMovies] = useState(null);
  const [selectedMovie, setSelectedMovie] = useState(null);
  const [loadingMovies, setLoadingMovies] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Estados Independientes en Memoria para Swipe
  const [movies, setMovies] = useState([]);
  const [series, setSeries] = useState([]);
  const [movieIndex, setMovieIndex] = useState(0);
  const [seriesIndex, setSeriesIndex] = useState(0);
  const [activeRoom, setActiveRoom] = useState('movies'); // 'movies' o 'series' controlado por el Tab Switch superior

  // Estados de CineMatch (Celebración)
  const [matchedMovie, setMatchedMovie] = useState(null);
  const [isMatchOpen, setIsMatchOpen] = useState(false);
  const [isWrappedOpen, setIsWrappedOpen] = useState(false);
  const [celebratedMovieIds, setCelebratedMovieIds] = useState([]); // Evita duplicar el modal para un mismo match
  const [celebratedSeriesIds, setCelebratedSeriesIds] = useState([]); // Evita duplicar el modal para un mismo match de serie
  const [partnerOnline, setPartnerOnline] = useState(false);
  const [partnerOnlineSeries, setPartnerOnlineSeries] = useState(false);
  const [ws, setWs] = useState(null);
  const [wsSeries, setWsSeries] = useState(null);
  const [matchesRefreshTrigger, setMatchesRefreshTrigger] = useState(0);
  const [matchesRefreshTriggerSeries, setMatchesRefreshTriggerSeries] = useState(0);
  const [activeReactions, setActiveReactions] = useState([]);

  // Escuchar y gestionar reacciones flotantes en vivo
  useEffect(() => {
    const handleShowReaction = (e) => {
      const { emoji } = e.detail;
      const id = Date.now() + Math.random();
      const xPosition = 15 + Math.random() * 70; // Posicionamiento aleatorio entre 15% y 85% de la pantalla
      setActiveReactions((prev) => [...prev, { id, emoji, x: xPosition }]);
      setTimeout(() => {
        setActiveReactions((prev) => prev.filter(r => r.id !== id));
      }, 3200); // Duración sincronizada con la animación CSS (3.2s)
    };

    window.addEventListener('show-reaction', handleShowReaction);
    return () => {
      window.removeEventListener('show-reaction', handleShowReaction);
    };
  }, []);


  // Estados de edición de perfil global (desde el Header)
  const [isGlobalProfileOpen, setIsGlobalProfileOpen] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profileAvatarUrl, setProfileAvatarUrl] = useState('');
  const [profilePassword, setProfilePassword] = useState('');
  const [profileFile, setProfileFile] = useState(null);
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');
  const [profileLoading, setProfileLoading] = useState(false);

  // Estados de notificaciones push
  const [pushPermission, setPushPermission] = useState('default'); // 'default' | 'granted' | 'denied'
  const [pushSubscribed, setPushSubscribed] = useState(false);

  const [toastMessage, setToastMessage] = useState(null);
  const showToast = (message) => {
    setToastMessage(message);
    setTimeout(() => {
      setToastMessage((curr) => curr === message ? null : curr);
    }, 6000);
  };

  const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';
  const FETCH_URL = `${API_BASE_URL}/api/movies`;
  const DECIDE_URL = `${API_BASE_URL}/api/decide`;

  // Obtener la URL del poster de la película/serie activa en pantalla
  let currentPosterUrl = null;
  if (activeTab === 'cinematch' && movies && movies[movieIndex]) {
    currentPosterUrl = movies[movieIndex].poster_url;
  } else if (activeTab === 'seriesmatch' && series && series[seriesIndex]) {
    currentPosterUrl = series[seriesIndex].poster_url;
  } else if (selectedMovie) {
    currentPosterUrl = selectedMovie.poster_url;
  }

  // Activar la extracción y transición automática de colores
  usePosterColors(currentPosterUrl);


  // Helper: convierte una clave pública VAPID Base64URL a Uint8Array
  const urlBase64ToUint8Array = (base64String) => {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
  };

  // Suscribir al usuario a notificaciones push
  const subscribeToPushNotifications = async () => {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      console.warn('[PUSH] Notificaciones push no soportadas en este navegador.');
      return;
    }

    try {
      // 1. Pedir permiso al usuario
      const permission = await Notification.requestPermission();
      setPushPermission(permission);

      if (permission !== 'granted') {
        console.warn('[PUSH] Permiso de notificaciones denegado.');
        return;
      }

      // 2. Obtener el SW activo
      const registration = await navigator.serviceWorker.ready;

      // 3. Obtener la clave pública VAPID del backend
      const vapidRes = await fetch(`${API_BASE_URL}/api/notifications/vapid-public-key`);
      const { publicKey: vapidPublicKey } = await vapidRes.json();

      // 4. Crear la suscripción push con el navegador
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
      });

      // 5. Enviar la suscripción al backend para almacenarla
      const subJSON = subscription.toJSON();
      const token = localStorage.getItem('cinematch_token');

      const res = await fetch(`${API_BASE_URL}/api/notifications/subscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          p256dh: subJSON.keys?.p256dh || '',
          auth: subJSON.keys?.auth || ''
        })
      });

      if (res.ok) {
        setPushSubscribed(true);
        console.log('[PUSH] Suscripción push registrada correctamente.');
      }
    } catch (err) {
      console.error('[PUSH] Error al suscribirse a notificaciones push:', err);
    }
  };

  // Desactivar notificaciones push
  const unsubscribeFromPushNotifications = async () => {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        // 1. Eliminar del backend
        const token = localStorage.getItem('cinematch_token');
        await fetch(
          `${API_BASE_URL}/api/notifications/unsubscribe?endpoint=${encodeURIComponent(subscription.endpoint)}`,
          {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
          }
        );

        // 2. Cancelar la suscripción en el navegador
        await subscription.unsubscribe();
      }

      setPushSubscribed(false);
      console.log('[PUSH] Suscripción push cancelada.');
    } catch (err) {
      console.error('[PUSH] Error al cancelar la suscripción:', err);
      // Forzar el estado local aunque falle el backend
      setPushSubscribed(false);
    }
  };

  // Catálogo de respaldo local para asegurar funcionamiento sin backend (RAD)
  const FALLBACK_CATALOG = [
    {
      id: 278,
      titulo: "Cadena perpetua",
      sinopsis: "Dos hombres encarcelados entablan una estrecha amistad a lo largo de los años, encontrando consuelo y redención final a través de la decencia común.",
      poster_url: "https://image.tmdb.org/t/p/w500/uRRTV7p6l2ivtODWJVVAMRrwTn2.jpg",
      backdrop_url: "https://image.tmdb.org/t/p/original/dqK15n4vKmedxKIGEF6Y14R86OI.jpg",
      rating: 8.7,
      comentarios: [
        { id: 101, texto: "Una película inolvidable, humana y sumamente emocionante. La mejor de la historia.", sentimiento: "98% Positivo" }
      ]
    },
    {
      id: 603,
      titulo: "Matrix",
      sinopsis: "Un programador de computadoras descubre que la realidad es una simulación creada por máquinas para someter a la humanidad.",
      poster_url: "https://image.tmdb.org/t/p/w500/8rT9kG2EYkZpJmYCuTJNnPDEube.jpg",
      backdrop_url: "https://image.tmdb.org/t/p/original/o56GgcH5tZBr4stRQL7Eq36FO7H.jpg",
      rating: 8.2,
      comentarios: [
        { id: 201, texto: "Revolucionaria en efectos especiales e historia. Una joya indiscutible de la ciencia ficción.", sentimiento: "95% Positivo" }
      ]
    },
    {
      id: 299536,
      titulo: "Vengadores: Infinity War",
      sinopsis: "Los Vengadores y sus aliados deben estar dispuestos a sacrificarlo todo en un intento de derrotar al poderoso Thanos antes de que destruya el universo.",
      poster_url: "https://image.tmdb.org/t/p/w500/ksBQ4oHQDdJwND8H90ay8CbMihU.jpg",
      backdrop_url: "https://image.tmdb.org/t/p/original/bOGkgQAJSndZ16iUR42614fbEw7.jpg",
      rating: 8.2,
      comentarios: [
        { id: 301, texto: "El mejor crossover de la historia del cine. Épica de principio a fin.", sentimiento: "94% Positivo" }
      ]
    },
    {
      id: 157336,
      titulo: "Interstellar",
      sinopsis: "Un grupo de científicos y exploradores espaciales se embarca en un viaje a través de un agujero de gusano para encontrar un nuevo hogar para la humanidad.",
      poster_url: "https://image.tmdb.org/t/p/w500/9cTfZWP5TfdnmAjiD6ZBXWIJ7O9.jpg",
      backdrop_url: "https://image.tmdb.org/t/p/original/xJHopt2uZ4Xh4fb060H4CjQJmTF.jpg",
      rating: 8.5,
      comentarios: [
        { id: 401, texto: "Una historia conmovedora con un guion brillante. La banda sonora es una obra de arte.", sentimiento: "96% Positivo" }
      ]
    }
  ];

  const FALLBACK_SERIES_CATALOG = [
    {
      id: 1396,
      titulo: "Breaking Bad",
      sinopsis: "Un profesor de química de secundaria con diagnóstico de cáncer de pulmón terminal se asocia con un exalumno para asegurar el futuro financiero de su familia fabricando metanfetamina.",
      poster_url: "https://image.tmdb.org/t/p/w500/ztkUQFLlC19CCMYHW9o1zWhJRNq.jpg",
      backdrop_url: "https://image.tmdb.org/t/p/original/ts56B1scA9745Y32w92l9rrsc65.jpg",
      rating: 8.9
    },
    {
      id: 1398,
      titulo: "Los Soprano",
      sinopsis: "Retrato de una familia de la mafia italoamericana de Nueva Jersey, cuyo jefe, Tony Soprano, sufre de ataques de pánico y comienza terapia psicológica.",
      poster_url: "https://image.tmdb.org/t/p/w500/p7XPjx5jTFl32TGbbIW8exdY8QW.jpg",
      backdrop_url: "https://image.tmdb.org/t/p/original/4g5w31l12s3wD1fC49aD1A.jpg",
      rating: 8.7
    },
    {
      id: 66732,
      titulo: "Stranger Things",
      sinopsis: "Tras la misteriosa desaparición de un niño en un pequeño pueblo, sus amigos, su familia y la policía se ven envueltos en un enigma que involucra experimentos gubernamentales secretos.",
      poster_url: "https://image.tmdb.org/t/p/w500/1sRJ8D1vpXE5WQBGrUBky3uUwvX.jpg",
      backdrop_url: "https://image.tmdb.org/t/p/original/56v2DnL5a1IM13U4ewga8zL24R8.jpg",
      rating: 8.6
    },
    {
      id: 246,
      titulo: "Avatar: La leyenda de Aang",
      sinopsis: "En un mundo dividido en cuatro naciones correspondientes a los cuatro elementos, un niño debe dominar todos los elementos para traer la paz al mundo.",
      poster_url: "https://image.tmdb.org/t/p/w500/ucNtkZfpZ6KgxqPo039nN4LAyFR.jpg",
      backdrop_url: "https://image.tmdb.org/t/p/original/5R0330740924X8392094.jpg",
      rating: 8.8
    },
    {
      id: 94605,
      titulo: "Arcane",
      sinopsis: "En medio del conflicto entre las ciudades gemelas de Piltóver y Zaun, dos hermanas luchan en bandos opuestos de una guerra por tecnologías mágicas y convicciones opuestas.",
      poster_url: "https://image.tmdb.org/t/p/w500/i1vSPUbiBe2iK2HapGDfHItBFlC.jpg",
      backdrop_url: "https://image.tmdb.org/t/p/original/7rM3X3jY5A70A98D203wQ.jpg",
      rating: 8.8
    }
  ];

  // Cargar y barajar catálogos de swipes al arranque
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/movies`)
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((data) => {
        const shuffled = [...data].sort(() => Math.random() - 0.5);
        setMovies(shuffled);
      })
      .catch(() => {
        const shuffled = [...FALLBACK_CATALOG].sort(() => Math.random() - 0.5);
        setMovies(shuffled);
      });
  }, []);

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/series`)
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((data) => {
        const shuffled = [...data].sort(() => Math.random() - 0.5);
        setSeries(shuffled);
      })
      .catch(() => {
        const shuffled = [...FALLBACK_SERIES_CATALOG].sort(() => Math.random() - 0.5);
        setSeries(shuffled);
      });
  }, []);

  // Recarga proactiva si cambias de pestaña y el catálogo quedó vacío por un reinicio de DB
  useEffect(() => {
    if (activeTab === 'cinematch' && movies.length === 0) {
      fetch(`${API_BASE_URL}/api/movies`)
        .then((res) => {
          if (res.ok) return res.json();
          throw new Error();
        })
        .then((data) => {
          if (data && data.length > 0) {
            const shuffled = [...data].sort(() => Math.random() - 0.5);
            setMovies(shuffled);
          }
        })
        .catch((err) => console.log("Error recargando películas:", err));
    }
  }, [activeTab, movies.length]);

  useEffect(() => {
    if (activeTab === 'seriesmatch' && series.length === 0) {
      fetch(`${API_BASE_URL}/api/series`)
        .then((res) => {
          if (res.ok) return res.json();
          throw new Error();
        })
        .then((data) => {
          if (data && data.length > 0) {
            const shuffled = [...data].sort(() => Math.random() - 0.5);
            setSeries(shuffled);
          }
        })
        .catch((err) => console.log("Error recargando series:", err));
    }
  }, [activeTab, series.length]);

  // 1. Cargar datos iniciales y comprobar sesión en LocalStorage
  useEffect(() => {
    fetchMoviesList();
    const savedUser = localStorage.getItem('cinematch_user');
    if (savedUser) {
      setUser(JSON.parse(savedUser));
    }
    
    // Restaurar sala de Películas (CineMatch)
    const savedRoom = localStorage.getItem('cinematch_room_movie');
    if (savedRoom) {
      const parsedRoom = JSON.parse(savedRoom);
      fetch(`${API_BASE_URL}/api/rooms/members/${parsedRoom.codigo}`)
        .then((res) => {
          if (!res.ok) {
            localStorage.removeItem('cinematch_room_movie');
            setActiveRoomObj(null);
          } else {
            setActiveRoomObj(parsedRoom);
          }
        })
        .catch(() => {
          setActiveRoomObj(parsedRoom);
        });
    }

    // Restaurar sala de Series (SeriesMatch)
    const savedRoomSeries = localStorage.getItem('cinematch_room_series');
    if (savedRoomSeries) {
      const parsedRoomSeries = JSON.parse(savedRoomSeries);
      fetch(`${API_BASE_URL}/api/rooms/members/${parsedRoomSeries.codigo}`)
        .then((res) => {
          if (!res.ok) {
            localStorage.removeItem('cinematch_room_series');
            setActiveRoomSeriesObj(null);
          } else {
            setActiveRoomSeriesObj(parsedRoomSeries);
          }
        })
        .catch(() => {
          setActiveRoomSeriesObj(parsedRoomSeries);
        });
    }
  }, []);

  // 2. Comprobar estado de permiso de notificaciones al arrancar
  useEffect(() => {
    if ('Notification' in window) {
      setPushPermission(Notification.permission);
      if (Notification.permission === 'granted') {
        // Si ya tenemos permiso, comprobar si hay suscripción activa
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.ready.then((reg) => {
            reg.pushManager.getSubscription().then((sub) => {
              if (sub) setPushSubscribed(true);
            });
          }).catch(() => {});
        }
      }
    }
  }, []);


  // WebSocket para Películas (CineMatch)
  useEffect(() => {
    if (!user || !activeRoomObj) {
      if (ws) {
        ws.close();
        setWs(null);
      }
      setPartnerOnline(false);
      return;
    }

    const wsBaseUrl = API_BASE_URL.replace(/^http/, 'ws');
    const socket = new WebSocket(`${wsBaseUrl}/ws/room/${activeRoomObj.codigo}/${user.id}`);

    socket.onopen = () => {
      console.log("[WebSocket Movies] Conectado al canal de la sala: " + activeRoomObj.codigo);
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("[WebSocket Movies] Mensaje recibido:", data);

        if (data.event === "PARTNER_STATUS") {
          const onlineUsers = data.online_users || [];
          const otherUsersOnline = onlineUsers.filter(id => id !== user.id).length > 0;
          setPartnerOnline(otherUsersOnline);
        } 
        
        else if (data.event === "REACTION" || data.type === "REACTION") {
          window.dispatchEvent(new CustomEvent('show-reaction', { detail: { emoji: data.emoji } }));
        }

        else if (data.event === "MATCH_FOUND") {

          const movie = data.movie;
          if (movie && !celebratedMovieIds.includes(movie.id)) {
            setCelebratedMovieIds((prev) => [...prev, movie.id]);
            handleMatchTrigger(movie);
            setMatchesRefreshTrigger((prev) => prev + 1);
          }
        } 
        
        else if (data.event === "ROOM_CLOSED") {
          console.log("[WebSocket Movies] Sala cerrada por el otro usuario");
          handleLeaveRoom('peliculas');
        }

        else if (data.event === "PARTNER_LEFT") {
          console.log("[WebSocket Movies] Pareja salió temporalmente de la sala");
          setPartnerOnline(false);
        }
        
        else if (data.event === "MEMBER_JOINED") {
          console.log("[WebSocket Movies] Un nuevo miembro se unió a la sala: ", data.user?.name);
          setPartnerOnline(true);
          showToast(`${data.user?.name} se ha unido a la sala de películas.`);
        }

        else if (data.event === "DATE_SCHEDULED") {
          console.log("[WebSocket Movies] Cita agendada:", data);
          try {
            const dt = new Date(data.fecha_iso);
            const dateLegible = dt.toLocaleString([], { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
            showToast(`${data.scheduled_by} propuso ver "${data.movie_titulo}" el ${dateLegible}.`);
          } catch (e) {
            showToast(`${data.scheduled_by} propuso ver "${data.movie_titulo}".`);
          }
        }

        else if (data.event === "VOTING_STARTED") {
          console.log("[WebSocket Movies] Votaciones iniciadas");
          setActiveRoomObj((prev) => {
            if (!prev) return null;
            const updated = { ...prev, voting_started: true };
            localStorage.setItem('cinematch_room_movie', JSON.stringify(updated));
            return updated;
          });
          showToast("¡Las votaciones en la sala de películas han comenzado!");
        }

      } catch (err) {
        console.error("[WebSocket Movies] Error al procesar mensaje:", err);
      }
    };

    socket.onclose = (e) => {
      console.log("[WebSocket Movies] Conexión cerrada de sala:", e.reason);
      setPartnerOnline(false);
    };

    socket.onerror = (err) => {
      console.error("[WebSocket Movies] Error:", err);
    };

    setWs(socket);

    return () => {
      socket.close();
    };
  }, [user?.id, activeRoomObj?.codigo]);

  // WebSocket para Series (SeriesMatch)
  useEffect(() => {
    if (!user || !activeRoomSeriesObj) {
      if (wsSeries) {
        wsSeries.close();
        setWsSeries(null);
      }
      setPartnerOnlineSeries(false);
      return;
    }

    const wsBaseUrl = API_BASE_URL.replace(/^http/, 'ws');
    const socket = new WebSocket(`${wsBaseUrl}/ws/room/${activeRoomSeriesObj.codigo}/${user.id}`);

    socket.onopen = () => {
      console.log("[WebSocket Series] Conectado al canal de la sala: " + activeRoomSeriesObj.codigo);
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("[WebSocket Series] Mensaje recibido:", data);

        if (data.event === "PARTNER_STATUS") {
          const onlineUsers = data.online_users || [];
          const otherUsersOnline = onlineUsers.filter(id => id !== user.id).length > 0;
          setPartnerOnlineSeries(otherUsersOnline);
        } 
        
        else if (data.event === "REACTION" || data.type === "REACTION") {
          window.dispatchEvent(new CustomEvent('show-reaction', { detail: { emoji: data.emoji } }));
        }

        else if (data.event === "MATCH_FOUND") {

          const movie = data.movie;
          if (movie && !celebratedSeriesIds.includes(movie.id)) {
            setCelebratedSeriesIds((prev) => [...prev, movie.id]);
            handleMatchTrigger(movie);
            setMatchesRefreshTriggerSeries((prev) => prev + 1);
          }
        } 
        
        else if (data.event === "ROOM_CLOSED") {
          console.log("[WebSocket Series] Sala cerrada por el otro usuario");
          handleLeaveRoom('series');
        }

        else if (data.event === "PARTNER_LEFT") {
          console.log("[WebSocket Series] Pareja salió temporalmente de la sala");
          setPartnerOnlineSeries(false);
        }
        
        else if (data.event === "MEMBER_JOINED") {
          console.log("[WebSocket Series] Un nuevo miembro se unió a la sala: ", data.user?.name);
          setPartnerOnlineSeries(true);
          showToast(`${data.user?.name} se ha unido a la sala de series.`);
        }

        else if (data.event === "DATE_SCHEDULED") {
          console.log("[WebSocket Series] Quedada de serie agendada:", data);
          try {
            const dt = new Date(data.fecha_iso);
            const dateLegible = dt.toLocaleString([], { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
            showToast(`${data.scheduled_by} propuso ver "${data.movie_titulo}" el ${dateLegible}.`);
          } catch (e) {
            showToast(`${data.scheduled_by} propuso ver "${data.movie_titulo}".`);
          }
        }

        else if (data.event === "VOTING_STARTED") {
          console.log("[WebSocket Series] Votaciones de series iniciadas");
          setActiveRoomSeriesObj((prev) => {
            if (!prev) return null;
            const updated = { ...prev, voting_started: true };
            localStorage.setItem('cinematch_room_series', JSON.stringify(updated));
            return updated;
          });
          showToast("¡Las votaciones en la sala de series han comenzado!");
        }

      } catch (err) {
        console.error("[WebSocket Series] Error al procesar mensaje:", err);
      }
    };

    socket.onclose = (e) => {
      console.log("[WebSocket Series] Conexión cerrada de sala:", e.reason);
      setPartnerOnlineSeries(false);
    };

    socket.onerror = (err) => {
      console.error("[WebSocket Series] Error:", err);
    };

    setWsSeries(socket);

    return () => {
      socket.close();
    };
  }, [user?.id, activeRoomSeriesObj?.codigo]);

  const [userStats, setUserStats] = useState(null);

  const fetchUserStats = async () => {
    if (!user) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/watched/stats/${user.id}`);
      if (res.ok) {
        const data = await res.json();
        setUserStats(data);
      }
    } catch (err) {
      console.error("Error al obtener estadísticas de usuario:", err);
    }
  };

  useEffect(() => {
    const handleStatsUpdate = () => {
      fetchUserStats();
    };
    window.addEventListener('watch-stats-updated', handleStatsUpdate);
    return () => {
      window.removeEventListener('watch-stats-updated', handleStatsUpdate);
    };
  }, [user?.id]);

  const startGlobalProfileEditing = () => {
    if (user) {
      setProfileName(user.name);
      setProfileAvatarUrl(user.avatar_url || '');
      setProfilePassword('');
      setProfileFile(null);
      setProfileError('');
      setProfileSuccess('');
      setIsGlobalProfileOpen(true);
      fetchUserStats();
    }
  };

  const handleGlobalProfileUpdate = async (e) => {
    e.preventDefault();
    setProfileError('');
    setProfileSuccess('');
    setProfileLoading(true);

    try {
      const activeToken = localStorage.getItem('cinematch_token');
      if (!activeToken) return;

      let updatedUser = user;

      // 1. Subir archivo de avatar si existe
      if (profileFile) {
        const formData = new FormData();
        formData.append('file', profileFile);

        const uploadRes = await fetch(`${API_BASE_URL}/api/users/upload-avatar`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${activeToken}`
          },
          body: formData
        });

        if (!uploadRes.ok) {
          const errData = await uploadRes.json();
          throw new Error(errData.detail || 'Fallo al subir el avatar.');
        }

        const uploadData = await uploadRes.json();
        updatedUser = uploadData.user;
      }

      // 2. Actualizar nombre, avatar_url (manual) o contraseña
      const body = {
        name: profileName.trim()
      };
      if (profileAvatarUrl.trim()) {
        body.avatar_url = profileAvatarUrl.trim();
      } else if (!profileFile) {
        body.avatar_url = "";
      }
      
      if (profilePassword.trim()) {
        body.password = profilePassword.trim();
      }

      const updateRes = await fetch(`${API_BASE_URL}/api/users/me`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${activeToken}`
        },
        body: JSON.stringify(body)
      });

      const updateData = await updateRes.json();
      if (updateRes.ok) {
        updatedUser = updateData.user;
        setProfileSuccess('¡Perfil actualizado correctamente!');
        setUser(updatedUser);
        localStorage.setItem('cinematch_user', JSON.stringify(updatedUser));
        
        setTimeout(() => {
          setIsGlobalProfileOpen(false);
          setProfilePassword('');
          setProfileFile(null);
        }, 1500);
      } else {
        throw new Error(updateData.detail || 'Fallo al actualizar el perfil.');
      }

    } catch (err) {
      setProfileError(err.message || 'Error de conexión.');
    } finally {
      setProfileLoading(false);
    }
  };

  const fetchMoviesList = (forceRefresh = false) => {
    if (forceRefresh) {
      setIsRefreshing(true);
    } else {
      setLoadingMovies(true);
    }
    setError(null);

    const url = forceRefresh ? `${FETCH_URL}?refresh=true` : FETCH_URL;

    fetch(url)
      .then((res) => {
        if (!res.ok) {
          throw new Error('No se pudo establecer conexión con el backend de CineVerse');
        }
        return res.json();
      })
      .then((data) => {
        setExplorerMovies(data);
        setLoadingMovies(false);
        setIsRefreshing(false);
        if (selectedMovie) {
          const updated = data.find(m => m.id === selectedMovie.id);
          if (updated) {
            handleMovieClick(updated);
          } else {
            setSelectedMovie(null);
          }
        }
      })
      .catch((err) => {
        console.warn('Error al cargar catálogo, usando fallback offline:', err);
        setError('Aviso: El backend de FastAPI no responde. Se cargará el catálogo de respaldo local (RAD).');
        setExplorerMovies(FALLBACK_CATALOG);
        setLoadingMovies(false);
        setIsRefreshing(false);
      });
  };

  // Traer detalle de película/serie + comentarios scrapeados para CineVerse AI
  const handleMovieClick = (movieSummary) => {
    setLoadingDetail(true);
    const isTv = movieSummary.tipo === 'serie' || movieSummary.tipo === 'SERIE';
    const baseUrl = isTv ? `${API_BASE_URL}/api/series` : `${API_BASE_URL}/api/movies`;
    fetch(`${baseUrl}/${movieSummary.id}`)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Error al traer detalles para: ${movieSummary.titulo}`);
        }
        return res.json();
      })
      .then((detailData) => {
        setSelectedMovie({
          ...detailData,
          en_cartelera: movieSummary.en_cartelera ?? detailData.en_cartelera,
          proximo_estreno: movieSummary.proximo_estreno ?? detailData.proximo_estreno,
          fecha_estreno: movieSummary.fecha_estreno ?? detailData.fecha_estreno,
          tipo: isTv ? 'serie' : 'pelicula'
        });
        setLoadingDetail(false);
      })
      .catch((err) => {
        console.warn('Error al traer detalles del backend, usando fallback offline:', err);
        const offlineMovie = FALLBACK_CATALOG.find(m => m.id === movieSummary.id);
        setSelectedMovie(offlineMovie || {
          ...movieSummary,
          tipo: isTv ? 'serie' : 'pelicula',
          comentarios: [
            {
              id: -1,
              texto: "No se pudieron cargar opiniones en línea. Intenta refrescar.",
              sentimiento: "0% Neutro"
            }
          ]
        });
        setLoadingDetail(false);
      });
  };

  const handleMatchTrigger = (movie) => {
    if (movie && movie.tipo === 'serie') {
      setCelebratedSeriesIds((prev) => {
        if (!prev.includes(movie.id)) {
          return [...prev, movie.id];
        }
        return prev;
      });
    } else if (movie) {
      setCelebratedMovieIds((prev) => {
        if (!prev.includes(movie.id)) {
          return [...prev, movie.id];
        }
        return prev;
      });
    }
    setMatchedMovie(movie);
    setIsMatchOpen(true);
    window.dispatchEvent(new CustomEvent('match-status-changed'));
  };

  // Salir de la sala de votación activa (limpieza local del estado)
  const handleLeaveRoom = async (categoria = 'peliculas') => {
    const activeToken = localStorage.getItem('cinematch_token');
    const targetRoom = categoria === 'series' ? activeRoomSeriesObj : activeRoomObj;
    if (activeToken && targetRoom) {
      try {
        await fetch(`${API_BASE_URL}/api/rooms/leave?categoria=${categoria}`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${activeToken}` }
        });
      } catch (err) {
        console.warn('Error al informar salida de sala al backend:', err);
      }
    }
    
    if (categoria === 'series') {
      localStorage.removeItem('cinematch_room_series');
      setActiveRoomSeriesObj(null);
      setPartnerOnlineSeries(false);
    } else {
      localStorage.removeItem('cinematch_room_movie');
      setActiveRoomObj(null);
      setPartnerOnline(false);
    }
    
    setMatchedMovie(null);
    setIsMatchOpen(false);
    setCelebratedMovieIds([]);
    setActiveTab('explorer'); // Devolver al explorador
  };

  const handleUserChange = (updatedUser) => {
    setUser(updatedUser);
  };

  // Analizar la temática de la película seleccionada para adaptar colores dinámicamente en el Drawer
  const getMovieTheme = () => {
    if (!selectedMovie) return null;
    const contentText = `${selectedMovie.titulo} ${selectedMovie.sinopsis}`.toLowerCase();
    
    if (
      contentText.includes('dune') || 
      contentText.includes('spider-man') || 
      contentText.includes('interstellar') || 
      contentText.includes('inception') || 
      contentText.includes('multiverso') || 
      contentText.includes('espacio') || 
      contentText.includes('universo')
    ) {
      return {
        themeName: 'sci-fi',
        borderClass: 'border-fuchsia-500/30',
        shadowClass: 'shadow-lg shadow-fuchsia-500/20',
        badgeClass: 'text-fuchsia-400 bg-fuchsia-950/40 border-fuchsia-800/50',
        badgeText: '🤖 CIENCIA FICCIÓN',
        ambientColor: 'rgba(217, 70, 239, 0.15)'
      };
    }
    if (
      contentText.includes('batman') || 
      contentText.includes('dark knight') || 
      contentText.includes('joker') || 
      contentText.includes('asesinato') || 
      contentText.includes('venganza') || 
      contentText.includes('caos') || 
      contentText.includes('muerte')
    ) {
      return {
        themeName: 'action',
        borderClass: 'border-rose-500/30',
        shadowClass: 'shadow-lg shadow-rose-500/20',
        badgeClass: 'text-rose-400 bg-rose-950/40 border-rose-800/50',
        badgeText: '💥 ACCIÓN / SUSPENSO',
        ambientColor: 'rgba(244, 63, 94, 0.15)'
      };
    }
    return {
      themeName: 'drama',
      borderClass: 'border-amber-500/30',
      shadowClass: 'shadow-lg shadow-amber-500/20',
      badgeClass: 'text-amber-400 bg-amber-950/40 border-amber-800/50',
      badgeText: '🎭 DRAMA / CINE DE AUTOR',
      ambientColor: 'rgba(245, 158, 11, 0.15)'
    };
  };

  const activeTheme = getMovieTheme();
  const isAuthenticated = !!user;
  const isPaired = user?.tiene_pareja === true;

  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-100 font-sans overflow-x-hidden">
      
      {/* Estilos CSS para luces ambientales de fondo */}
      <style>{`
        @keyframes float-slow {
          0% { transform: translate(0px, 0px) scale(1); }
          50% { transform: translate(40px, -60px) scale(1.1); }
          100% { transform: translate(0px, 0px) scale(1); }
        }
        @keyframes float-delayed {
          0% { transform: translate(0px, 0px) scale(1.1); }
          50% { transform: translate(-50px, 50px) scale(0.95); }
          100% { transform: translate(0px, 0px) scale(1.1); }
        }
        .animate-float-slow {
          animation: float-slow 22s infinite ease-in-out;
        }
        .animate-float-delayed {
          animation: float-delayed 26s infinite ease-in-out;
        }
      `}</style>

      {/* Luces de Fondo y Degradado Mimetizador (WOW Effect) */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        <div 
          style={{
            backgroundImage: 'radial-gradient(circle at 50% 0%, var(--movie-glow) 0%, transparent 65%)',
          }}
          className="absolute inset-0 z-0 transition-all duration-500 ease-in-out"
        />
        <div 
          style={{
            backgroundColor: activeTheme && activeTab === 'explorer' ? activeTheme.ambientColor : 'rgba(6, 182, 212, 0.08)'
          }}
          className="absolute -top-20 -left-20 w-[600px] h-[600px] rounded-full blur-3xl mix-blend-screen animate-float-slow opacity-60 transition-colors duration-1000"
        />
        <div className="absolute -bottom-40 -right-20 w-[700px] h-[700px] rounded-full bg-indigo-900/10 blur-3xl mix-blend-screen animate-float-delayed opacity-50" />
      </div>


      {/* Banner de error de red */}
      {error && !explorerMovies && (
        <div className="relative z-50 bg-red-950/70 border-b border-red-800/40 px-6 py-2.5 text-center text-xs text-red-300 backdrop-blur-md flex items-center justify-center gap-2">
          <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>Aviso: El backend de FastAPI no responde. Se usará el simulador local (RAD).</span>
          <button onClick={() => fetchMoviesList()} className="ml-3 px-2 py-0.5 bg-red-900/40 border border-red-700/50 rounded text-[10px] font-bold">Reintentar</button>
        </div>
      )}

      {/* ================= INTERFAZ PRINCIPAL ACCESIBLE PARA TODOS ================= */}
      <>
        {/* Navbar Superior Unificada */}
        <header className="sticky top-0 z-40 bg-slate-950/80 backdrop-blur-md border-b border-slate-900 px-4 py-3 md:px-6 md:py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 md:gap-3">
            <span className="text-xl md:text-2xl font-black tracking-wider bg-gradient-to-r from-cyan-400 via-pink-500 to-rose-500 bg-clip-text text-transparent uppercase select-none">
              CINEVERSE
            </span>
          </div>

          {/* Selector de Vistas / Pestañas (Visible en Escritorio) */}
          <div className="hidden md:flex bg-slate-900 border border-slate-800 rounded-full p-1 max-w-md">
            <button
              onClick={() => setActiveTab('explorer')}
              className={`px-4 py-1.5 rounded-full text-xs font-bold transition duration-200 ${
                activeTab === 'explorer'
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 shadow-md btn-neon-glow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              🎬 Explora
            </button>
            <button
              onClick={() => { setActiveTab('cinematch'); setActiveRoom('movies'); }}
              className={`px-4 py-1.5 rounded-full text-xs font-bold transition duration-200 ${
                activeTab === 'cinematch'
                  ? 'bg-gradient-to-r from-pink-500 to-rose-600 text-white shadow-md btn-neon-glow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              💖 CineMatch
            </button>
            <button
              onClick={() => { setActiveTab('seriesmatch'); setActiveRoom('series'); }}
              className={`px-4 py-1.5 rounded-full text-xs font-bold transition duration-200 ${
                activeTab === 'seriesmatch'
                  ? 'bg-gradient-to-r from-indigo-500 to-pink-500 text-white shadow-md btn-neon-glow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              📺 SeriesMatch
            </button>
            <button
              onClick={() => setActiveTab('telemetry')}
              className={`px-4 py-1.5 rounded-full text-xs font-bold transition duration-200 ${
                activeTab === 'telemetry'
                  ? 'bg-gradient-to-r from-indigo-500 to-cyan-500 text-slate-950 shadow-md btn-neon-glow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              📊 Telemetría
            </button>
          </div>


          {/* Panel de Perfil de Usuario Unificado (Dinámico si está Autenticado) */}
          {user ? (
            <div className="flex items-center gap-2 md:gap-3 text-xs">
              <div 
                onClick={startGlobalProfileEditing}
                className="flex items-center gap-2 cursor-pointer group hover:bg-slate-900/60 p-1 md:p-1.5 px-2 md:px-3.5 rounded-full border border-slate-900 hover:border-cyan-500/30 transition-all duration-300 shadow-[0_0_15px_rgba(6,182,212,0.02)] hover:shadow-[0_0_15px_rgba(6,182,212,0.1)]"
                title="Ver y Editar Perfil"
              >
                <div className="flex flex-col text-right items-end text-[10px] md:text-xs">
                  {activeRoomObj && (
                    <div className="flex items-center gap-2 text-right flex-col items-end">
                      <span className="text-slate-300 font-bold group-hover:text-cyan-400 transition-colors max-w-[80px] md:max-w-[120px] truncate">
                        {user.name}
                      </span>
                      <div className="flex items-center gap-1 justify-end mt-0.5">
                        <span className={`w-1 h-1 rounded-full ${partnerOnline ? 'bg-emerald-500 animate-pulse shadow-[0_0_6px_#10b981]' : 'bg-slate-600'}`} />
                        <span className="text-[7px] font-bold uppercase tracking-wider text-cyan-400">
                          🍿 {activeRoomObj.codigo}
                        </span>
                      </div>
                    </div>
                  )}
                  {activeRoomSeriesObj && (
                    <div className="flex items-center gap-2 text-right flex-col items-end">
                      <span className="text-slate-300 font-bold group-hover:text-cyan-400 transition-colors max-w-[80px] md:max-w-[120px] truncate">
                        {user.name}
                      </span>
                      <div className="flex items-center gap-1 justify-end mt-0.5">
                        <span className={`w-1 h-1 rounded-full ${partnerOnlineSeries ? 'bg-emerald-500 animate-pulse shadow-[0_0_6px_#10b981]' : 'bg-slate-600'}`} />
                        <span className="text-[7px] font-bold uppercase tracking-wider text-indigo-400">
                          📺 {activeRoomSeriesObj.codigo}
                        </span>
                      </div>
                    </div>
                  )}
                  {!activeRoomObj && !activeRoomSeriesObj && (
                    <span className="text-slate-300 font-bold group-hover:text-cyan-400 transition-colors max-w-[80px] md:max-w-[120px] truncate">
                      {user.name}
                    </span>
                  )}
                </div>
                <img
                  src={user.avatar_url ? (user.avatar_url.startsWith('/') ? `${API_BASE_URL}${user.avatar_url}` : user.avatar_url) : 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?q=80&w=150'}
                  alt="Avatar"
                  className="w-8 h-8 md:w-10 md:h-10 shrink-0 rounded-full border border-slate-800 object-cover group-hover:border-cyan-400 transition-colors"
                />
              </div>

              {/* Botón de Wrapped */}
              {user.pareja_id && (
                <button
                  onClick={() => setIsWrappedOpen(true)}
                  className="flex items-center justify-center h-8 px-3.5 bg-gradient-to-r from-fuchsia-600/20 via-pink-600/20 to-violet-600/20 hover:from-fuchsia-600/40 hover:to-violet-600/40 text-fuchsia-300 font-extrabold border border-fuchsia-500/30 rounded-full transition transform hover:scale-105 active:scale-95 duration-200 shadow-[0_0_15px_rgba(240,46,170,0.1)]"
                  title="Ver nuestro CineVerse Wrapped 💫"
                >
                  <span>Wrapped 💫</span>
                </button>
              )}
              
              {activeTab === 'explorer' && (
                <button
                  onClick={() => fetchMoviesList(true)}
                  disabled={isRefreshing || loadingMovies}
                  className="flex items-center justify-center w-8 h-8 shrink-0 md:w-auto md:px-3 md:py-1.5 bg-slate-900 hover:bg-slate-850 disabled:opacity-50 text-cyan-400 font-bold border border-slate-800 rounded-full transition transform hover:scale-105 active:scale-95 duration-200"
                  title="Actualizar catálogo (Scraper)"
                >
                  <svg className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-indigo-400' : 'hover:rotate-180 transition-transform duration-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 7.89M9 11l3-3 3 3m-3-3v12" />
                  </svg>
                  <span className="hidden md:inline ml-1.5">{isRefreshing ? 'Scrapeando...' : 'Scraper'}</span>
                </button>
              )}

              {/* Botón de Notificaciones Push — Toggle ON/OFF */}
              {'Notification' in window && pushPermission !== 'denied' && (
                <div className="relative group/bell">
                  <button
                    onClick={pushSubscribed ? unsubscribeFromPushNotifications : subscribeToPushNotifications}
                    title={
                      pushSubscribed
                        ? 'Desactivar notificaciones'
                        : 'Activar notificaciones de matches'
                    }
                    className={`relative flex items-center justify-center w-8 h-8 shrink-0 rounded-full border transition-all duration-300 transform hover:scale-110 active:scale-95 ${
                      pushSubscribed
                        ? 'bg-emerald-950/60 border-emerald-700/50 text-emerald-400 hover:bg-rose-950/50 hover:border-rose-700/50 hover:text-rose-400'
                        : 'bg-slate-900 border-slate-800 text-amber-400 hover:border-amber-500/50 hover:bg-amber-950/30'
                    }`}
                  >
                    {/* Icono campana: activa → llena, inactiva → outline */}
                    {pushSubscribed ? (
                      <svg className="w-3.5 h-3.5 group-hover/bell:hidden" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/>
                      </svg>
                    ) : (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />
                      </svg>
                    )}
                    {/* Al hacer hover sobre una campana activa, mostrar icono de tachado */}
                    {pushSubscribed && (
                      <svg className="w-3.5 h-3.5 hidden group-hover/bell:block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.73 21a2 2 0 0 1-3.46 0M18.63 13A17.89 17.89 0 0118 8M6.26 6.26A5.86 5.86 0 006 8c0 7-3 9-3 9h14M18 8a6 6 0 00-9.33-4.99M1 1l22 22" />
                      </svg>
                    )}
                    {/* Punto verde si está suscrito */}
                    {pushSubscribed && (
                      <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-emerald-500 rounded-full group-hover/bell:bg-rose-500 animate-pulse shadow-[0_0_6px_#10b981] group-hover/bell:shadow-[0_0_6px_#f43f5e] transition-colors" />
                    )}
                  </button>

                  {/* Tooltip flotante con estado y acción */}
                  <div className="absolute right-0 top-10 z-50 hidden group-hover/bell:block pointer-events-none">
                    <div className={`px-2.5 py-1.5 rounded-lg text-[10px] font-semibold whitespace-nowrap shadow-xl border ${
                      pushSubscribed
                        ? 'bg-rose-950/90 border-rose-800/50 text-rose-300'
                        : 'bg-slate-900/95 border-slate-700/50 text-amber-300'
                    }`}>
                      {pushSubscribed ? '🔕 Desactivar notificaciones' : '🔔 Activar notificaciones'}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'cinematch' && activeRoomObj && (
                <button
                  onClick={() => handleLeaveRoom('peliculas')}
                  className="px-2 md:px-2.5 py-1 md:py-1.5 bg-slate-900 border border-slate-850 hover:bg-slate-850 text-rose-400 hover:text-rose-300 text-[10px] md:text-xs rounded-lg transition font-bold animate-fade-in"
                >
                  Salir CineMatch
                </button>
              )}
              {activeTab === 'seriesmatch' && activeRoomSeriesObj && (
                <button
                  onClick={() => handleLeaveRoom('series')}
                  className="px-2 md:px-2.5 py-1 md:py-1.5 bg-slate-900 border border-slate-850 hover:bg-slate-850 text-rose-400 hover:text-rose-300 text-[10px] md:text-xs rounded-lg transition font-bold animate-fade-in"
                >
                  Salir SeriesMatch
                </button>
              )}
            </div>

          ) : (
            <div className="flex items-center gap-2 md:gap-4 text-xs">
              {activeTab === 'explorer' && (
                <button
                  onClick={() => fetchMoviesList(true)}
                  disabled={isRefreshing || loadingMovies}
                  className="flex items-center justify-center w-8 h-8 shrink-0 md:w-auto md:px-3 md:py-1.5 bg-slate-900 hover:bg-slate-850 disabled:opacity-50 text-cyan-400 font-bold border border-slate-800 rounded-full transition transform hover:scale-105 active:scale-95 duration-200"
                  title="Actualizar catálogo (Scraper)"
                >
                  <svg className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-indigo-400' : 'hover:rotate-180 transition-transform duration-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 7.89M9 11l3-3 3 3m-3-3v12" />
                  </svg>
                  <span className="hidden md:inline ml-1.5">{isRefreshing ? 'Scrapeando...' : 'Scraper'}</span>
                </button>
              )}

              <button
                onClick={() => setActiveTab('cinematch')}
                className="px-2.5 py-1 md:px-3 md:py-1.5 bg-pink-950/40 border border-pink-900 hover:bg-pink-900/40 text-pink-400 hover:text-pink-300 text-[10px] md:text-xs rounded-full transition font-bold"
              >
                💕 Entrar
              </button>
            </div>
          )}
        </header>

        {/* ================= CONTENIDO DE LA APLICACIÓN ================= */}
        <div className="relative z-10 pb-20 md:pb-0">
          
          {/* PESTAÑA 1: EXPLORADOR DE PELÍCULAS (CineVerse AI) */}
          {activeTab === 'explorer' && (
            <main>
              <MoviesMaster
                initialMovies={explorerMovies}
                fetchUrl={FETCH_URL}
                onMovieClick={handleMovieClick}
                showNavbar={false}
                user={user}
                matchesCount={celebratedMovieIds.length}
                totalLikes={celebratedMovieIds.length * 2 + (user ? 3 : 0)}
                onConnectClick={() => { setActiveTab('cinematch'); setActiveRoom('movies'); }}
                matches={explorerMovies ? explorerMovies.filter(m => celebratedMovieIds.includes(m.id)) : []}
              />
            </main>
          )}

          {/* PESTAÑA 2: JUEGO EN PAREJA / AMIGOS (CineMatch) */}
          {activeTab === 'cinematch' && (
            <main className="min-h-[80vh] flex items-center justify-center py-6">
              {!user ? (
                // Si no hay usuario permanente, se fuerza login/registro
                <CineMatchAuth 
                  onUserChange={(u) => setUser(u)} 
                  onRoomChange={(r) => {
                    setActiveRoomObj(r);
                    if (r) localStorage.setItem('cinematch_room_movie', JSON.stringify(r));
                    else localStorage.removeItem('cinematch_room_movie');
                  }} 
                  activeRoom={activeRoomObj}
                  categoria="peliculas"
                />
              ) : !activeRoomObj ? (
                // Si hay usuario pero no hay sala activa, mostramos el panel de salas/vinculación
                <CineMatchAuth 
                  onUserChange={(u) => setUser(u)} 
                  onRoomChange={(r) => {
                    setActiveRoomObj(r);
                    if (r) localStorage.setItem('cinematch_room_movie', JSON.stringify(r));
                    else localStorage.removeItem('cinematch_room_movie');
                  }} 
                  activeRoom={activeRoomObj}
                  categoria="peliculas"
                />
              ) : (
                // Si hay sala activa de votación, mostramos el mazo y matches
                <CineMatchDashboard 
                  user={user}
                  activeRoom={activeRoomObj}
                  fetchUrl={
                    activeRoomObj.tipo === "grupo_amigos"
                      ? `${API_BASE_URL}/api/rooms/movies/${activeRoomObj.codigo}`
                      : `${API_BASE_URL}/api/movies`
                  }
                  decideUrl={`${API_BASE_URL}/api/movies/decide`}
                  onMatchTrigger={handleMatchTrigger}
                  ws={ws}
                  partnerOnline={partnerOnline}
                  matchesRefreshTrigger={matchesRefreshTrigger}
                  onLeaveRoom={() => handleLeaveRoom('peliculas')}
                  catalog={movies}
                  externalIndex={movieIndex}
                  setExternalIndex={setMovieIndex}
                  onReset={() => setMovieIndex(0)}
                  onMovieClick={handleMovieClick}
                />
              )}
            </main>
          )}

          {/* PESTAÑA 2.5: JUEGO DE SERIES (SeriesMatch) */}
          {activeTab === 'seriesmatch' && (
            <main className="min-h-[80vh] flex items-center justify-center py-6">
              {!user ? (
                // Si no hay usuario permanente, se fuerza login/registro
                <CineMatchAuth 
                  onUserChange={(u) => setUser(u)} 
                  onRoomChange={(r) => {
                    setActiveRoomSeriesObj(r);
                    if (r) localStorage.setItem('cinematch_room_series', JSON.stringify(r));
                    else localStorage.removeItem('cinematch_room_series');
                  }} 
                  activeRoom={activeRoomSeriesObj}
                  categoria="series"
                />
              ) : !activeRoomSeriesObj ? (
                // Si hay usuario pero no hay sala activa, mostramos el panel de salas/vinculación
                <CineMatchAuth 
                  onUserChange={(u) => setUser(u)} 
                  onRoomChange={(r) => {
                    setActiveRoomSeriesObj(r);
                    if (r) localStorage.setItem('cinematch_room_series', JSON.stringify(r));
                    else localStorage.removeItem('cinematch_room_series');
                  }} 
                  activeRoom={activeRoomSeriesObj}
                  categoria="series"
                />
              ) : (
                // Si hay sala activa de votación, mostramos el mazo y matches
                <CineMatchDashboard 
                  user={user}
                  activeRoom={activeRoomSeriesObj}
                  fetchUrl={
                    activeRoomSeriesObj.tipo === "grupo_amigos"
                      ? `${API_BASE_URL}/api/rooms/movies/${activeRoomSeriesObj.codigo}`
                      : `${API_BASE_URL}/api/series`
                  }
                  decideUrl={`${API_BASE_URL}/api/series/decide`}
                  onMatchTrigger={handleMatchTrigger}
                  ws={wsSeries}
                  partnerOnline={partnerOnlineSeries}
                  matchesRefreshTrigger={matchesRefreshTriggerSeries}
                  onLeaveRoom={() => handleLeaveRoom('series')}
                  catalog={series}
                  externalIndex={seriesIndex}
                  setExternalIndex={setSeriesIndex}
                  onReset={() => setSeriesIndex(0)}
                  onMovieClick={handleMovieClick}
                />
              )}
            </main>
          )}

          {/* PESTAÑA 3: OBSERVABILIDAD Y TELEMETRÍA (SRE) */}
          {activeTab === 'telemetry' && (
            <main className="min-h-[80vh] py-6">
              <TelemetryDashboard />
            </main>
          )}

        </div>
      </>

      {/* Modal global de Match de Películas */}
      <MovieMatchModal
        isOpen={isMatchOpen}
        matchedMovie={matchedMovie}
        onClose={() => {
          setIsMatchOpen(false);
          setMatchedMovie(null);
        }}
      />

      {/* Modal de CineVerse Wrapped */}
      {isWrappedOpen && user && (
        <CineVerseWrapped
          user={user}
          onClose={() => setIsWrappedOpen(false)}
        />
      )}

      {/* Drawer global de Detalle de Película / Serie */}
      <MovieDetailDrawer
        movieId={selectedMovie?.id}
        movieData={selectedMovie}
        isOpen={!!selectedMovie}
        onClose={() => setSelectedMovie(null)}
        theme={activeTheme}
        fetchUrlBase={
          selectedMovie?.tipo === 'serie' || selectedMovie?.tipo === 'SERIE'
            ? `${API_BASE_URL}/api/series`
            : `${API_BASE_URL}/api/movies`
        }
        user={user}
      />

      {/* Modal global de Perfil de Usuario */}
      {isGlobalProfileOpen && user && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-[0_0_30px_rgba(6,182,212,0.15)] animate-in fade-in zoom-in-95 duration-200">
            {/* Cabecera */}
            <div className="p-6 pb-4 border-b border-slate-850 flex items-center justify-between">
              <h3 className="text-base font-extrabold text-white">Editar Perfil</h3>
              <button 
                onClick={() => setIsGlobalProfileOpen(false)}
                className="text-slate-400 hover:text-slate-200 text-lg"
              >
                ✕
              </button>
            </div>

            {/* Formulario */}
            <form onSubmit={handleGlobalProfileUpdate} className="p-6 space-y-4">
              {profileError && (
                <div className="bg-red-950/50 border border-red-900/30 text-red-300 text-xs px-4 py-3 rounded-xl text-left">
                  ⚠️ {profileError}
                </div>
              )}
              {profileSuccess && (
                <div className="bg-emerald-950/50 border border-emerald-900/30 text-emerald-300 text-xs px-4 py-3 rounded-xl text-left">
                  ✓ {profileSuccess}
                </div>
              )}

              {/* Estadísticas de tiempo de vida viendo pelis/series */}
              {userStats && (
                <div className="p-4 bg-slate-950/50 border border-slate-850 rounded-2xl space-y-3 text-left">
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-850 pb-1.5 flex items-center justify-between">
                    <span>⏱️ Mi Tiempo de CineVerse</span>
                    <span className="text-[9px] font-mono text-cyan-400 font-bold bg-cyan-950/40 border border-cyan-900/30 px-2.5 py-0.5 rounded-full">
                      Stats Personales
                    </span>
                  </h4>
                  
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-850">
                      <p className="text-[9px] text-slate-400 uppercase font-semibold">Películas</p>
                      <p className="text-lg font-black text-white mt-0.5">{userStats.total_peliculas}</p>
                    </div>
                    <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-850">
                      <p className="text-[9px] text-slate-400 uppercase font-semibold">Series</p>
                      <p className="text-lg font-black text-white mt-0.5">{userStats.total_series}</p>
                    </div>
                    <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-850">
                      <p className="text-[9px] text-slate-400 uppercase font-semibold">Horas</p>
                      <p className="text-lg font-black text-cyan-400 mt-0.5">{userStats.tiempo_total_horas}</p>
                    </div>
                  </div>

                  <div className="text-center pt-1">
                    <p className="text-[9px] text-slate-500 italic">
                      Equivale a aproximadamente <span className="font-bold text-slate-400">{userStats.tiempo_total_dias} días</span> completos de tu vida viendo cine y series. 🍿
                    </p>
                  </div>
                </div>
              )}

              {/* Vista previa y subida de avatar */}
              <div className="flex flex-col items-center gap-2 pb-2">
                <div className="relative group w-20 h-20">
                  <img
                    src={
                      profileFile 
                        ? URL.createObjectURL(profileFile) 
                        : (user.avatar_url ? (user.avatar_url.startsWith('/') ? `${API_BASE_URL}${user.avatar_url}` : user.avatar_url) : 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?q=80&w=150')
                    }
                    alt="Previsualización de Avatar"
                    className="w-20 h-20 rounded-full border border-slate-800 object-cover shadow-md group-hover:brightness-75 transition duration-200"
                  />
                  <label className="absolute inset-0 flex items-center justify-center bg-slate-950/40 rounded-full opacity-0 group-hover:opacity-100 cursor-pointer transition text-[10px] text-white font-bold uppercase">
                    Subir foto
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          setProfileFile(e.target.files[0]);
                          setProfileAvatarUrl(''); // Limpiar campo manual si sube archivo
                        }
                      }}
                      className="hidden"
                    />
                  </label>
                </div>
                
                {/* Selector de Archivo Nativo */}
                <div className="text-center">
                  <label className="text-[10px] bg-slate-850 hover:bg-slate-800 border border-slate-800 text-slate-300 px-3 py-1.5 rounded-lg cursor-pointer transition font-semibold inline-block">
                    {profileFile ? '📷 Cambiar archivo' : '📁 Seleccionar Imagen'}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          setProfileFile(e.target.files[0]);
                          setProfileAvatarUrl(''); // Limpiar campo manual si sube archivo
                        }
                      }}
                      className="hidden"
                    />
                  </label>
                  {profileFile && (
                    <p className="text-[9px] text-cyan-400 mt-1 truncate max-w-[200px] mx-auto">
                      {profileFile.name}
                    </p>
                  )}
                </div>
              </div>

              {/* Input: Nombre */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block text-left">Nombre / Apodo</label>
                <input
                  type="text"
                  required
                  placeholder="Tu nombre"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  className="w-full bg-slate-950 text-xs text-slate-200 px-4 py-2.5 rounded-xl border border-slate-850 focus:outline-none focus:border-cyan-500 placeholder:text-slate-700"
                />
              </div>

              {/* Input: URL del Avatar (Opcional, si prefiere pegar URL) */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block text-left">O pegar URL de Imagen</label>
                <input
                  type="url"
                  placeholder="https://..."
                  value={profileAvatarUrl}
                  onChange={(e) => {
                    setProfileAvatarUrl(e.target.value);
                    if (e.target.value.trim()) setProfileFile(null); // Limpiar archivo si escribe URL
                  }}
                  className="w-full bg-slate-950 text-xs text-slate-200 px-4 py-2.5 rounded-xl border border-slate-850 focus:outline-none focus:border-cyan-500 placeholder:text-slate-700"
                />
              </div>

              {/* Input: Nueva Contraseña */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block text-left">Nueva Contraseña (Opcional)</label>
                <input
                  type="password"
                  placeholder="Dejar en blanco para conservar contraseña"
                  value={profilePassword}
                  onChange={(e) => setProfilePassword(e.target.value)}
                  className="w-full bg-slate-950 text-xs text-slate-200 px-4 py-2.5 rounded-xl border border-slate-850 focus:outline-none focus:border-cyan-500 placeholder:text-slate-700"
                />
              </div>

              {/* Botonera de control */}
              <div className="flex gap-3 pt-3 border-t border-slate-850">
                <button
                  type="submit"
                  disabled={profileLoading}
                  className="flex-1 py-3 bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 font-bold rounded-xl text-xs hover:brightness-110 active:scale-98 transition transform"
                >
                  {profileLoading ? 'Guardando...' : 'Guardar Cambios ✓'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsGlobalProfileOpen(false)}
                  className="px-4 py-3 bg-slate-850 hover:bg-slate-800 border border-slate-800 text-xs text-slate-400 rounded-xl transition"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Barra de Navegación Inferior para Móvil (PWA) */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-950/90 backdrop-blur-lg border-t border-slate-900 p-2 pb-safe flex items-center justify-around shadow-[0_-4px_20px_rgba(0,0,0,0.5)]">
        <button
          onClick={() => setActiveTab('explorer')}
          className={`flex flex-col items-center gap-1 py-1 px-2 rounded-xl transition duration-200 ${
            activeTab === 'explorer' ? 'text-cyan-400 font-extrabold shadow-[0_0_15px_rgba(6,182,212,0.1)]' : 'text-slate-500 hover:text-slate-350'
          }`}
        >
          <span className="text-xl">🎬</span>
          <span className="text-[10px] tracking-wide">Explora</span>
        </button>
        <button
          onClick={() => { setActiveTab('cinematch'); setActiveRoom('movies'); }}
          className={`flex flex-col items-center gap-1 py-1 px-2 rounded-xl transition duration-200 ${
            activeTab === 'cinematch' ? 'text-pink-400 font-extrabold shadow-[0_0_15px_rgba(236,72,153,0.1)]' : 'text-slate-500 hover:text-slate-350'
          }`}
        >
          <span className="text-xl">💖</span>
          <span className="text-[10px] tracking-wide">CineMatch</span>
        </button>
        <button
          onClick={() => { setActiveTab('seriesmatch'); setActiveRoom('series'); }}
          className={`flex flex-col items-center gap-1 py-1 px-2 rounded-xl transition duration-200 ${
            activeTab === 'seriesmatch' ? 'text-indigo-400 font-extrabold shadow-[0_0_15px_rgba(99,102,241,0.1)]' : 'text-slate-500 hover:text-slate-350'
          }`}
        >
          <span className="text-xl">📺</span>
          <span className="text-[10px] tracking-wide">SeriesMatch</span>
        </button>
        <button
          onClick={() => setActiveTab('telemetry')}
          className={`flex flex-col items-center gap-1 py-1 px-2 rounded-xl transition duration-200 ${
            activeTab === 'telemetry' ? 'text-indigo-400 font-extrabold shadow-[0_0_15px_rgba(99,102,241,0.1)]' : 'text-slate-500 hover:text-slate-350'
          }`}
        >
          <span className="text-xl">📊</span>
          <span className="text-[10px] tracking-wide">Telemetría</span>
        </button>
      </div>

      {/* Toast de Notificaciones en Tiempo Real */}
      {toastMessage && (
        <div className="fixed bottom-20 md:bottom-6 right-6 z-50 max-w-sm bg-slate-900 border border-cyan-500/30 text-white p-4 rounded-2xl shadow-[0_10px_30px_rgba(6,182,212,0.15)] flex items-center gap-3 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <span className="text-xl">📅</span>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-cyan-400 font-bold uppercase tracking-wider">CineVerse</p>
            <p className="text-xs text-slate-300 font-medium leading-relaxed mt-0.5">{toastMessage}</p>
          </div>
          <button 
            onClick={() => setToastMessage(null)} 
            className="text-slate-500 hover:text-slate-300 text-xs font-bold pl-2"
          >
            ✕
          </button>
        </div>
      )}
      {/* Contenedor Global de Reacciones Flotantes en Vivo */}
      <div className="fixed inset-x-0 bottom-0 pointer-events-none z-50 h-screen overflow-hidden">
        {activeReactions.map((reaction) => (
          <div
            key={reaction.id}
            style={{ left: `${reaction.x}%` }}
            className="absolute bottom-10 text-4xl animate-float-up pointer-events-none"
          >
            {reaction.emoji}
          </div>
        ))}
      </div>
    </div>
  );
}

