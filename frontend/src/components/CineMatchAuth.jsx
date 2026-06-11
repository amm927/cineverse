import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';

export default function CineMatchAuth({ onUserChange, onRoomChange, activeRoom, categoria = null }) {
  const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';
  
  // Estados de sesión
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  
  // Navegación interna: 'login' | 'register' | 'panel' | 'lobby'
  const [step, setStep] = useState('login');
  
  // Inputs de Auth
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
  // Inputs de vinculación
  const [partnerEmail, setPartnerEmail] = useState('');
  const [partnerInfo, setPartnerInfo] = useState(null);
  
  // Inputs de salas
  const [salaCodigo, setSalaCodigo] = useState('');
  const [roomMembers, setRoomMembers] = useState([]);
  const [activeRoomState, setActiveRoomState] = useState(activeRoom || null);
  
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedCategoria, setSelectedCategoria] = useState(categoria || 'peliculas'); // 'peliculas' or 'series'

  useEffect(() => {
    if (categoria) {
      setSelectedCategoria(categoria);
    }
  }, [categoria]);

  useEffect(() => {
    setActiveRoomState(activeRoom || null);
    if (activeRoom) {
      setStep('lobby');
    } else {
      setStep(token ? 'panel' : 'login');
    }
  }, [activeRoom, token]);

  // Inputs de edición de perfil
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editName, setEditName] = useState('');
  const [editAvatarUrl, setEditAvatarUrl] = useState('');
  const [editPassword, setEditPassword] = useState('');

  useEffect(() => {
    const savedUser = localStorage.getItem('cinematch_user');
    const savedToken = localStorage.getItem('cinematch_token');
    if (savedUser && savedToken) {
      const parsedUser = JSON.parse(savedUser);
      setUser(parsedUser);
      setToken(savedToken);
      setStep('panel');
      checkPartnerStatus(savedToken);
      checkActiveRoom(savedToken);

      // Auto-vincular si viene por URL y ya está logueado
      const params = new URLSearchParams(window.location.search);
      const partnerFromUrl = params.get('link_partner');
      if (partnerFromUrl && partnerFromUrl.toLowerCase() !== parsedUser.email.toLowerCase()) {
        setTimeout(() => linkPartnerByEmail(partnerFromUrl, savedToken), 500);
      }
    }
    
    // Auto-unión por URL
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get('sala') || params.get('sala_codigo');
    if (roomFromUrl) {
      setSalaCodigo(roomFromUrl.toUpperCase());
    }
  }, []);

  // Polling para unirse automáticamente a una sala creada por la pareja (si estamos en el panel central)
  useEffect(() => {
    let intervalId = null;
    if (step === 'panel' && token) {
      const checkRoom = () => {
        const queryCat = categoria || selectedCategoria;
        fetch(`${API_BASE_URL}/api/rooms/active?categoria=${queryCat}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
          .then((res) => {
            if (!res.ok) throw new Error();
            return res.json();
          })
          .then((data) => {
            if (data.active && data.room.categoria === queryCat) {
              setActiveRoomState(data.room);
              onRoomChange(data.room);
              setStep('lobby');
            }
          })
          .catch((err) => {
            // Silencioso
          });
      };
      checkRoom();
      intervalId = setInterval(checkRoom, 4000);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [step, token, categoria, selectedCategoria]);

  // 2. Inicializar Google Sign-In
  useEffect(() => {
    if (step === 'login' || step === 'register') {
      const initGoogle = () => {
        if (window.google) {
          window.google.accounts.id.initialize({
            client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID || '1088378676-mockclientid.apps.googleusercontent.com', // Client ID real o fallback de desarrollo
            callback: handleGoogleCredentialResponse,
          });
          const btnParent = document.getElementById('google-btn');
          if (btnParent) {
            window.google.accounts.id.renderButton(btnParent, {
              theme: 'outline',
              size: 'large',
              width: 320,
            });
          }
        }
      };
      
      // Esperar brevemente a que el script se cargue
      const timer = setTimeout(initGoogle, 500);
      return () => clearTimeout(timer);
    }
  }, [step]);

  // 3. Polling en Lobby para salas activas
  useEffect(() => {
    let intervalId = null;
    if (step === 'lobby' && activeRoomState) {
      const fetchMembers = () => {
        fetch(`${API_BASE_URL}/api/rooms/members/${activeRoomState.codigo}`)
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
  }, [step, activeRoomState]);

  // Decodificar JWT de Google
  const decodeJwt = (token) => {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(window.atob(base64));
    } catch (e) {
      return null;
    }
  };

  const handleGoogleCredentialResponse = async (response) => {
    setError('');
    setLoading(true);
    const payload = decodeJwt(response.credential);
    if (!payload) {
      setError('Error al procesar la cuenta de Google.');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/google-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: payload.name,
          email: payload.email,
          google_id: payload.sub,
          avatar_url: payload.picture
        })
      });

      if (res.ok) {
        const data = await res.json();
        saveSession(data.user, data.access_token);
      } else {
        throw new Error();
      }
    } catch (err) {
      setError('Fallo al iniciar sesión con Google.');
    }
    setLoading(false);
  };

  const linkPartnerByEmail = async (emailVal, activeToken = null) => {
    if (!emailVal || !emailVal.trim()) return;
    setError('');
    setSuccess('');
    try {
      const currentToken = activeToken || token || localStorage.getItem('cinematch_token');
      if (!currentToken) return;
      const res = await fetch(`${API_BASE_URL}/api/partner/link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentToken}`
        },
        body: JSON.stringify({ email: emailVal.trim() })
      });
      const data = await res.json();
      if (res.ok) {
        setSuccess(data.message);
        setPartnerInfo(data.partner);
        setPartnerEmail('');
        // Limpiar query params de la URL
        const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
        window.history.pushState({ path: newUrl }, '', newUrl);
      } else {
        setError(data.detail || 'No se pudo vincular la cuenta.');
      }
    } catch (err) {
      setError('Error de conexión.');
    }
  };

  const startEditingProfile = () => {
    if (user) {
      setEditName(user.name);
      setEditAvatarUrl(user.avatar_url || '');
      setEditPassword('');
      setIsEditingProfile(true);
      setError('');
      setSuccess('');
    }
  };

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const activeToken = token || localStorage.getItem('cinematch_token');
      if (!activeToken) return;
      
      const body = {
        name: editName.trim()
      };
      if (editAvatarUrl.trim()) {
        body.avatar_url = editAvatarUrl.trim();
      } else {
        body.avatar_url = "";
      }
      if (editPassword.trim()) {
        body.password = editPassword.trim();
      }
      
      const res = await fetch(`${API_BASE_URL}/api/users/me`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${activeToken}`
        },
        body: JSON.stringify(body)
      });
      
      const data = await res.json();
      if (res.ok) {
        setSuccess('¡Perfil actualizado con éxito!');
        setUser(data.user);
        localStorage.setItem('cinematch_user', JSON.stringify(data.user));
        onUserChange(data.user);
        setIsEditingProfile(false);
        setEditPassword('');
      } else {
        setError(data.detail || 'No se pudo actualizar el perfil.');
      }
    } catch (err) {
      setError('Error de conexión.');
    }
    setLoading(false);
  };

  const saveSession = (userData, accessToken) => {
    setUser(userData);
    setToken(accessToken);
    localStorage.setItem('cinematch_user', JSON.stringify(userData));
    localStorage.setItem('cinematch_token', accessToken);
    onUserChange(userData);
    setStep('panel');
    checkPartnerStatus(accessToken);
    checkActiveRoom(accessToken);

    // Intentar vincular automáticamente si viene por URL
    const params = new URLSearchParams(window.location.search);
    const partnerFromUrl = params.get('link_partner');
    if (partnerFromUrl && partnerFromUrl.toLowerCase() !== userData.email.toLowerCase()) {
      setTimeout(() => linkPartnerByEmail(partnerFromUrl, accessToken), 500);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password })
      });
      const data = await res.json();
      if (res.ok) {
        saveSession(data.user, data.access_token);
      } else {
        setError(data.detail || 'Fallo en el registro de cuenta.');
      }
    } catch (err) {
      setError('Error de conexión con el backend.');
    }
    setLoading(false);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (res.ok) {
        saveSession(data.user, data.access_token);
      } else {
        setError(data.detail || 'Credenciales de acceso incorrectas.');
      }
    } catch (err) {
      setError('Error de conexión con el backend.');
    }
    setLoading(false);
  };

  const checkPartnerStatus = (authToken) => {
    fetch(`${API_BASE_URL}/api/partner/status`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.linked) {
          setPartnerInfo(data.partner);
        } else {
          setPartnerInfo(null);
        }
      })
      .catch((err) => console.log('Error al consultar vinculación: ', err));
  };

  const checkActiveRoom = (authToken) => {
    const queryCat = categoria || selectedCategoria;
    fetch(`${API_BASE_URL}/api/rooms/active?categoria=${queryCat}`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    })
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((data) => {
        if (data.active) {
          setActiveRoomState(data.room);
          onRoomChange(data.room);
          setStep('lobby');
        }
      })
      .catch((err) => {
        // Silencioso
      });
  };

  const handleLinkPartner = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!partnerEmail.trim()) return;

    try {
      const res = await fetch(`${API_BASE_URL}/api/partner/link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ email: partnerEmail.trim() })
      });
      const data = await res.json();
      if (res.ok) {
        setSuccess(data.message);
        setPartnerInfo(data.partner);
        setPartnerEmail('');
      } else {
        setError(data.detail || 'No se pudo vincular la cuenta.');
      }
    } catch (err) {
      setError('Error de conexión.');
    }
  };

  const handleSharePartnerLink = async () => {
    const shareUrl = `${window.location.origin}/?link_partner=${user.email}`;
    const shareData = {
      title: 'CineVerse & CineMatch 🍿',
      text: `¡Únete a mi CineVerse! Vincula tu cuenta conmigo para empezar a jugar y encontrar nuestras películas perfectas juntos. 💖`,
      url: shareUrl
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Error al compartir:', err);
        }
      }
    } else {
      try {
        await navigator.clipboard.writeText(shareUrl);
        setSuccess('¡Enlace de vinculación copiado al portapapeles! 📋');
        setTimeout(() => setSuccess(''), 3000);
      } catch (err) {
        setError('No se pudo copiar el enlace al portapapeles.');
      }
    }
  };

  const handleUnlinkPartner = async () => {
    if (!confirm('¿Seguro que deseas disolver tu vinculación de pareja?')) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/partner/unlink`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        setPartnerInfo(null);
        setSuccess('Pareja desvinculada con éxito.');
      }
    } catch (err) {
      setError('Error de conexión.');
    }
  };

  const handleCreateRoom = async (tipo) => {
    setError('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/rooms/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ tipo, categoria: selectedCategoria })
      });
      const data = await res.json();
      if (res.ok) {
        setActiveRoomState(data);
        onRoomChange(data);
        setStep('lobby');
      } else {
        setError('No se pudo crear la sala de votaciones.');
      }
    } catch (err) {
      setError('Error de conexión.');
    }
  };

  const handleJoinRoom = async (e) => {
    e.preventDefault();
    if (!salaCodigo.trim()) return;
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE_URL}/api/rooms/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ sala_codigo: salaCodigo.trim().toUpperCase() })
      });
      const data = await res.json();
      if (res.ok) {
        setActiveRoomState(data);
        onRoomChange(data);
        setStep('lobby');
      } else {
        setError(data.detail || 'Código de sala inválido o expirado.');
      }
    } catch (err) {
      setError('Error de conexión.');
    }
    setLoading(false);
  };

  const handleStartVoting = () => {
    // Al empezar a votar, cerramos la autenticación y cargamos la sala
    if (activeRoomState) {
      onRoomChange(activeRoomState);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('cinematch_user');
    localStorage.removeItem('cinematch_token');
    setUser(null);
    setToken(null);
    setPartnerInfo(null);
    setActiveRoomState(null);
    onUserChange(null);
    onRoomChange(null);
    setStep('login');
  };

  return (
    <div className="w-full max-w-md bg-slate-900/60 border border-slate-850 backdrop-blur-xl rounded-3xl p-8 shadow-2xl space-y-6">
      
      {/* Header */}
      <div className="text-center space-y-1.5">
        <span className="text-[10px] font-bold uppercase tracking-widest text-pink-400 bg-pink-950/40 border border-pink-850 px-2.5 py-0.5 rounded-full">
          💖 CineMatch Hub
        </span>
        <h2 className="text-2xl font-black bg-gradient-to-r from-cyan-400 via-pink-500 to-rose-500 bg-clip-text text-transparent uppercase tracking-wide">
          {step === 'lobby' ? 'Lobby de Espera' : 'Cuentas y Salas'}
        </h2>
        <p className="text-xs text-slate-400">
          {step === 'lobby' ? 'Sincronizando miembros en tiempo real' : 'Encuentra las mejores películas en pareja o con amigos'}
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-950/30 border border-red-500/30 text-red-400 rounded-xl text-xs text-center font-bold">
          {error}
        </div>
      )}

      {success && (
        <div className="p-3 bg-emerald-950/30 border border-emerald-500/30 text-emerald-400 rounded-xl text-xs text-center font-bold">
          {success}
        </div>
      )}

      {/* ================= ESTADO: LOGIN ================= */}
      {step === 'login' && (
        <div className="space-y-4">
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Correo Electrónico</label>
              <input
                type="email"
                required
                placeholder="Ej. adrian@gmail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-slate-950/80 text-sm text-slate-200 px-4 py-2.5 rounded-xl border border-slate-850 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all placeholder:text-slate-650"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Contraseña</label>
              <input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-950/80 text-sm text-slate-200 px-4 py-2.5 rounded-xl border border-slate-850 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all placeholder:text-slate-650"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 font-bold rounded-xl text-xs hover:brightness-110 active:scale-98 transition transform shadow-lg shadow-cyan-500/10"
            >
              {loading ? 'Accediendo...' : 'Iniciar Sesión 🎬'}
            </button>
          </form>

          <div className="relative flex py-2 items-center">
            <div className="flex-grow border-t border-slate-850"></div>
            <span className="flex-shrink mx-4 text-[9px] text-slate-500 font-bold uppercase tracking-wider">O entra con</span>
            <div className="flex-grow border-t border-slate-850"></div>
          </div>

          <div id="google-btn" className="flex justify-center"></div>

          <p className="text-center text-xs text-slate-400 pt-2">
            ¿No tienes una cuenta?{' '}
            <button onClick={() => setStep('register')} className="text-cyan-400 font-bold hover:underline">
              Regístrate aquí
            </button>
          </p>
        </div>
      )}

      {/* ================= ESTADO: REGISTRO ================= */}
      {step === 'register' && (
        <div className="space-y-4">
          <form onSubmit={handleRegister} className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Nombre / Apodo</label>
              <input
                type="text"
                required
                placeholder="Ej. Adrián"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-slate-950/80 text-sm text-slate-200 px-4 py-2.5 rounded-xl border border-slate-850 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all placeholder:text-slate-650"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Correo Electrónico</label>
              <input
                type="email"
                required
                placeholder="Ej. adrian@gmail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-slate-950/80 text-sm text-slate-200 px-4 py-2.5 rounded-xl border border-slate-850 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all placeholder:text-slate-650"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Contraseña</label>
              <input
                type="password"
                required
                placeholder="Mínimo 6 caracteres"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-950/80 text-sm text-slate-200 px-4 py-2.5 rounded-xl border border-slate-850 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all placeholder:text-slate-650"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-gradient-to-r from-pink-500 to-rose-600 text-white font-bold rounded-xl text-xs hover:brightness-110 active:scale-98 transition transform shadow-lg shadow-pink-500/10"
            >
              {loading ? 'Creando cuenta...' : 'Registrar Cuenta 💖'}
            </button>
          </form>

          <p className="text-center text-xs text-slate-400 pt-2">
            ¿Ya tienes una cuenta?{' '}
            <button onClick={() => setStep('login')} className="text-cyan-400 font-bold hover:underline">
              Inicia sesión
            </button>
          </p>
        </div>
      )}

      {/* ================= ESTADO: PANEL CENTRAL (USUARIO CONECTADO) ================= */}
      {step === 'panel' && user && (
        <div className="space-y-6">
          {/* Perfil de Usuario */}
          {isEditingProfile ? (
            <form onSubmit={handleUpdateProfile} className="bg-slate-950/80 p-4 rounded-2xl border border-slate-850 space-y-3">
              <h4 className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest text-left">
                Editar Perfil
              </h4>
              
              <div className="space-y-1">
                <label className="text-[9px] font-bold text-slate-400 uppercase block text-left">Nombre / Apodo</label>
                <input
                  type="text"
                  required
                  placeholder="Tu nombre"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-slate-900 text-xs text-slate-200 px-3 py-2 rounded-xl border border-slate-800 focus:outline-none focus:border-cyan-500 placeholder:text-slate-700"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[9px] font-bold text-slate-400 uppercase block text-left">URL del Avatar (Opcional)</label>
                <input
                  type="url"
                  placeholder="https://..."
                  value={editAvatarUrl}
                  onChange={(e) => setEditAvatarUrl(e.target.value)}
                  className="w-full bg-slate-900 text-xs text-slate-200 px-3 py-2 rounded-xl border border-slate-800 focus:outline-none focus:border-cyan-500 placeholder:text-slate-700"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[9px] font-bold text-slate-400 uppercase block text-left">Nueva Contraseña (Opcional)</label>
                <input
                  type="password"
                  placeholder="Dejar en blanco para no cambiar"
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  className="w-full bg-slate-900 text-xs text-slate-200 px-3 py-2 rounded-xl border border-slate-800 focus:outline-none focus:border-cyan-500 placeholder:text-slate-700"
                />
              </div>

              <div className="flex gap-2 pt-1.5">
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 font-bold rounded-lg text-[10px] hover:brightness-110 transition"
                >
                  {loading ? 'Guardando...' : 'Guardar Cambios ✓'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingProfile(false)}
                  className="px-3 py-2 bg-slate-900 hover:bg-slate-850 border border-slate-800 text-[10px] text-slate-400 rounded-lg transition"
                >
                  Cancelar
                </button>
              </div>
            </form>
          ) : (
            <div className="bg-slate-950/80 p-4 rounded-2xl border border-slate-850 flex items-center gap-4">
              <img
                src={user.avatar_url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?q=80&w=150'}
                alt="Avatar"
                className="w-12 h-12 rounded-full border border-slate-800 object-cover"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <h3 className="font-extrabold text-sm text-white truncate text-left">{user.name}</h3>
                  <button 
                    onClick={startEditingProfile}
                    className="text-slate-500 hover:text-cyan-400 text-xs transition-colors"
                    title="Editar Perfil"
                  >
                    ✏️
                  </button>
                </div>
                <p className="text-[10px] text-slate-500 truncate text-left">{user.email}</p>
              </div>
              <button
                onClick={handleLogout}
                className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-850 border border-slate-800 text-[10px] text-slate-400 rounded-lg transition"
              >
                Cerrar Sesión
              </button>
            </div>
          )}

          {/* Estado de Pareja Persistente */}
          <div className="space-y-3 bg-slate-950/40 p-4 rounded-2xl border border-slate-900">
            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-left">
              Vinculación Permanente
            </h4>
            
            {partnerInfo ? (
              <div className="flex items-center justify-between bg-pink-950/20 border border-pink-900/20 p-3 rounded-xl">
                <div className="flex items-center gap-2">
                  <span className="text-xs">👫</span>
                  <div className="text-left">
                    <p className="text-xs font-bold text-white">{partnerInfo.name}</p>
                    <p className="text-[9px] text-slate-500">{partnerInfo.email}</p>
                  </div>
                </div>
                <button
                  onClick={handleUnlinkPartner}
                  className="text-[9px] font-bold text-rose-400 hover:underline"
                >
                  Desvincular
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <form onSubmit={handleLinkPartner} className="flex gap-2">
                  <input
                    type="email"
                    required
                    placeholder="Email de tu pareja"
                    value={partnerEmail}
                    onChange={(e) => setPartnerEmail(e.target.value)}
                    className="flex-1 bg-slate-950 text-xs text-slate-200 px-3 py-2 rounded-xl border border-slate-850 focus:outline-none focus:border-pink-500 placeholder:text-slate-700"
                  />
                  <button
                    type="submit"
                    className="px-4 bg-gradient-to-r from-pink-500 to-rose-600 hover:brightness-110 text-white text-[10px] font-bold rounded-xl transition"
                  >
                    Vincular
                  </button>
                </form>

                <div className="pt-3 border-t border-slate-900/50 space-y-3">
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider text-center">
                    O comparte tu QR de Vinculación
                  </p>
                  <div className="w-36 h-36 bg-white p-3 rounded-2xl mx-auto flex items-center justify-center shadow-[0_0_15px_rgba(236,72,153,0.35)] border-2 border-pink-400/70 transition-transform duration-300 hover:scale-105">
                    <QRCodeSVG 
                      value={`${window.location.origin}/?link_partner=${user.email}`} 
                      size={120}
                      level="M"
                      fgColor="#090d16"
                      includeMargin={false}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleSharePartnerLink}
                    className="w-full max-w-[220px] mx-auto py-2 bg-gradient-to-r from-pink-500/20 to-rose-600/20 hover:from-pink-500 hover:to-rose-600 border border-pink-500/30 text-pink-400 hover:text-white text-[10px] font-bold rounded-xl transition-all duration-300 active:scale-98 flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    <span>🔗 Compartir enlace de pareja</span>
                  </button>

                  <p className="text-[9px] text-slate-500 text-center leading-normal">
                    Tu pareja puede escanear este código o abrir tu enlace de invitación para vincularse de inmediato.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Opciones de Salas */}
          <div className="space-y-4 pt-2">
            {/* Selector de Categoría (Películas / Series) */}
            {!categoria && (
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">
                  Elige tu Categoría de Juego
                </p>
                <div className="flex bg-slate-950 p-1 border border-slate-900 rounded-xl space-x-2 w-full mx-auto">
                  <button
                    type="button"
                    onClick={() => setSelectedCategoria('peliculas')}
                    className={`flex-1 py-2 rounded-lg text-xs font-bold transition duration-200 ${
                      selectedCategoria === 'peliculas'
                        ? 'bg-slate-905 text-cyan-400 border border-cyan-500/20 shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    🍿 Películas
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedCategoria('series')}
                    className={`flex-1 py-2 rounded-lg text-xs font-bold transition duration-200 ${
                      selectedCategoria === 'series'
                        ? 'bg-slate-905 text-indigo-400 border border-indigo-500/20 shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    📺 Series de TV
                  </button>
                </div>
              </div>
            )}

            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">
              Comenzar a Jugar
            </h4>
            
            <div className="grid grid-cols-1 gap-2.5">
              {partnerInfo ? (
                <button
                  onClick={() => handleCreateRoom('pareja')}
                  className="py-3 bg-gradient-to-r from-pink-500 to-rose-600 text-white font-bold rounded-xl text-xs hover:brightness-110 transition active:scale-98 transform"
                >
                  💕 Jugar con mi Pareja ({partnerInfo.name})
                </button>
              ) : (
                <div className="py-2.5 text-center text-slate-600 text-[10px] uppercase font-bold tracking-wider bg-slate-950/20 rounded-xl border border-dashed border-slate-850">
                  Vincula a tu pareja para jugar en modo 2 personas
                </div>
              )}

              <button
                onClick={() => handleCreateRoom('grupo_amigos')}
                className="py-3 bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 font-bold rounded-xl text-xs hover:brightness-110 transition active:scale-98 transform shadow-md shadow-cyan-500/5"
              >
                👥 Crear Sala de Grupo (Amigos)
              </button>
            </div>
          </div>

          {/* Unirse por Código */}
          <div className="pt-2">
            <form onSubmit={handleJoinRoom} className="flex gap-2">
              <input
                type="text"
                required
                placeholder="Código de Sala (CINE-XXXXX)"
                value={salaCodigo}
                onChange={(e) => setSalaCodigo(e.target.value)}
                className="flex-1 bg-slate-950 text-xs text-slate-200 px-3 py-2 rounded-xl border border-slate-850 focus:outline-none focus:border-cyan-550 placeholder:text-slate-700 uppercase font-mono tracking-wider"
              />
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 bg-slate-950 border border-slate-850 hover:bg-slate-900 text-cyan-400 text-[10px] font-black rounded-xl transition"
              >
                Unirse
              </button>
            </form>
          </div>

        </div>
      )}

      {/* ================= ESTADO: LOBBY DE ESPERA EN TIEMPO REAL ================= */}
      {step === 'lobby' && activeRoomState && (
        <div className="space-y-6 text-center">
          
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-widest text-slate-400 font-bold">Código de la Sala</p>
            
            <div className="text-cyan-400 bg-slate-950 border border-cyan-500/20 px-6 py-4 rounded-2xl text-center text-3xl font-mono font-black tracking-widest animate-pulse shadow-[0_0_15px_rgba(6,182,212,0.1)]">
              {activeRoomState.codigo}
            </div>

            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(activeRoomState.codigo);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="mt-2 text-xs font-bold text-cyan-400 hover:text-cyan-300 flex items-center justify-center gap-1.5 mx-auto"
            >
              {copied ? '¡Copiado! ✓' : '📋 Copiar código'}
            </button>
          </div>

          {/* CÓDIGO QR DINÁMICO PREMIUM */}
          <div className="space-y-3 pt-2">
            <p className="text-xs uppercase tracking-widest text-slate-400 font-bold">Escanea para Unirte</p>
            <div className="w-44 h-44 bg-white p-3.5 rounded-2xl mx-auto flex items-center justify-center shadow-[0_0_20px_rgba(6,182,212,0.45)] border-2 border-cyan-400/80 transition-transform duration-300 hover:scale-105">
              <QRCodeSVG 
                value={`${window.location.origin}/?sala=${activeRoomState.codigo}`} 
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
                  {member.id === activeRoomState.creador_id && (
                    <span className="text-[8px] bg-cyan-950 text-cyan-400 border border-cyan-900 px-1 py-0.5 rounded font-black uppercase">
                      Creador
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="py-2 space-y-4">
            {/* Botón de compartir — solo para salas de grupo */}
            {activeRoomState.tipo === 'grupo_amigos' && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={async () => {
                    const joinUrl = `${window.location.origin}/?sala=${activeRoomState.codigo}`;
                    const shareData = {
                      title: '🍿 ¡Únete a mi sala en CINEVERSE!',
                      text: `Entra a votar películas conmigo. Código: ${activeRoomState.codigo}`,
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
                      Invitar amigos a la sala
                    </>
                  )}
                </button>
                <p className="text-[9px] text-slate-600 text-center">
                  En móvil abre el menú de compartir · En escritorio copia el enlace
                </p>
              </div>
            )}

            <button
              onClick={handleStartVoting}
              className="w-full py-3 bg-gradient-to-r from-pink-500 to-rose-600 text-white font-bold rounded-xl text-xs hover:brightness-110 active:scale-98 transition transform shadow-lg shadow-pink-500/10"
            >
              🚀 Iniciar Juego de Votación
            </button>
            
            <button
              onClick={() => {
                setActiveRoomState(null);
                onRoomChange(null);
                setStep('panel');
              }}
              className="w-full py-2 bg-slate-950 hover:bg-slate-900 text-slate-500 rounded-xl text-xs border border-slate-850 transition"
            >
              ← Salir al Panel Central
            </button>
          </div>


        </div>
      )}

    </div>
  );
}
