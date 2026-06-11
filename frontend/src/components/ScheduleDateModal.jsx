import React, { useState, useEffect } from 'react';

/**
 * ScheduleDateModal — Modal para agendar la cita de película
 *
 * Estrategias:
 * 1. Google Calendar: abre una URL pre-rellenada de Google Calendar (no requiere OAuth).
 *    El usuario solo tiene que hacer clic en "Guardar" en el formulario de Google.
 * 2. .ics (Apple / Outlook): descarga el archivo usando un <a> temporal para no
 *    navegar fuera de la SPA.
 *
 * Props:
 * - isOpen: boolean
 * - onClose: () => void
 * - movieTitle: string
 */
export default function ScheduleDateModal({ isOpen, onClose, movieTitle, activeRoom = null }) {
  const [dateTime, setDateTime] = useState('');
  const [status, setStatus] = useState(null); // null | 'loading' | 'success_google' | 'success_ics' | 'error'
  const [errorMsg, setErrorMsg] = useState('');

  const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

  // Resetear estado cada vez que se abre el modal
  useEffect(() => {
    if (isOpen) {
      setDateTime('');
      setStatus(null);
      setErrorMsg('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // --- Helpers ---

  /**
   * Construye la URL de Google Calendar para crear un evento pre-rellenado.
   * No requiere OAuth — abre directamente el formulario de Google.
   */
  const buildGoogleCalendarUrl = (title, startISO) => {
    // Google Calendar usa formato: YYYYMMDDTHHmmss / YYYYMMDDTHHmmssZ
    const toGoogleDate = (isoStr) =>
      isoStr.replace(/[-:]/g, '').replace(/\.\d{3}/, '');

    const start = new Date(startISO);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000); // +2 horas

    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: `🍿 Cita CineMatch: ${title}`,
      dates: `${toGoogleDate(start.toISOString())}/${toGoogleDate(end.toISOString())}`,
      details: `¡Cita confirmada en CineVerse & CineMatch para ver "${title}"! Preparad las palomitas. 🎬`,
      location: 'Casa',
    });

    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  };

  /** Convierte la hora local del input (sin zona horaria) a ISO respetando la hora local */
  const localDateTimeToISO = (localStr) => {
    if (!localStr) return new Date().toISOString();
    // localStr = "2026-06-15T20:00"
    const [datePart, timePart] = localStr.split('T');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hours, minutes] = timePart.split(':').map(Number);
    // Crear objeto Date local
    const date = new Date(year, month - 1, day, hours, minutes);
    return date.toISOString();
  };

  const notifyBackendOfSchedule = async (isoStr) => {
    const token = localStorage.getItem('cinematch_token');
    if (!token) return;

    try {
      await fetch(`${API_BASE_URL}/api/calendar/schedule`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          pelicula_titulo: movieTitle,
          fecha_iso: isoStr,
          sala_codigo: activeRoom?.codigo || null
        })
      });
    } catch (err) {
      console.warn('Error al notificar cita al backend:', err);
    }
  };

  // --- Handlers ---

  const handleGoogleCalendar = () => {
    if (!dateTime) {
      setErrorMsg('Por favor selecciona una fecha y hora primero.');
      return;
    }
    setErrorMsg('');
    setStatus('loading');

    try {
      const isoStr = localDateTimeToISO(dateTime);
      const url = buildGoogleCalendarUrl(movieTitle, isoStr);
      window.open(url, '_blank', 'noopener,noreferrer');
      notifyBackendOfSchedule(isoStr);
      setStatus('success_google');
    } catch (err) {
      setStatus('error');
      setErrorMsg('No se pudo abrir Google Calendar. Intenta con la descarga .ics.');
    }
  };

  const handleDownloadICS = async () => {
    if (!dateTime) {
      setErrorMsg('Por favor selecciona una fecha y hora primero.');
      return;
    }
    setErrorMsg('');
    setStatus('loading');

    try {
      const isoStr = localDateTimeToISO(dateTime);
      const downloadUrl = `${API_BASE_URL}/api/calendar/ics?titulo=${encodeURIComponent(movieTitle)}&fecha=${encodeURIComponent(isoStr)}`;

      // Descarga sin navegar fuera de la SPA usando un <a> temporal
      const response = await fetch(downloadUrl);
      if (!response.ok) throw new Error('Error al generar el archivo .ics');

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `cita_${movieTitle.replace(/\s+/g, '_').toLowerCase()}.ics`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);

      notifyBackendOfSchedule(isoStr);
      setStatus('success_ics');
    } catch (err) {
      setStatus('error');
      setErrorMsg('No se pudo descargar el archivo .ics. Inténtalo de nuevo.');
    }
  };

  // --- Fecha mínima: ahora mismo ---
  const now = new Date();
  const minDateTime = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/85 backdrop-blur-md px-4 pb-4 sm:pb-0">
      <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-3xl shadow-[0_0_60px_rgba(6,182,212,0.15)] overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">

        {/* Cabecera con gradiente */}
        <div className="relative px-6 pt-6 pb-4 border-b border-slate-800">
          <div className="absolute inset-0 bg-gradient-to-br from-cyan-950/40 to-slate-900 pointer-events-none" />
          <div className="relative flex items-start justify-between gap-3">
            <div className="space-y-1">
              <span className="inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-cyan-400 bg-cyan-950/50 border border-cyan-800/40 px-2.5 py-1 rounded-full">
                📅 Agendar Cita de Cine
              </span>
              <h3 className="text-base font-black text-white leading-tight pr-4 line-clamp-2">
                {movieTitle}
              </h3>
              <p className="text-[11px] text-slate-400 font-light">
                Elige cuándo verla y añádela a tu calendario
              </p>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition text-sm font-bold"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Cuerpo del modal */}
        <div className="p-6 space-y-5">

          {/* Input de fecha y hora */}
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
              <span className="text-cyan-500">⏰</span> Día y Hora de la Película
            </label>
            <input
              type="datetime-local"
              value={dateTime}
              min={minDateTime}
              onChange={(e) => {
                setDateTime(e.target.value);
                setErrorMsg('');
                setStatus(null);
              }}
              className="w-full bg-slate-950 text-slate-200 px-4 py-3 rounded-xl border border-slate-800 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/20 transition-all text-sm font-medium cursor-pointer [color-scheme:dark]"
            />
          </div>

          {/* Feedback de estado */}
          {errorMsg && (
            <div className="flex items-start gap-2 text-[11px] text-red-300 bg-red-950/40 border border-red-900/30 px-3 py-2.5 rounded-xl">
              <span className="shrink-0 mt-0.5">⚠️</span>
              <span>{errorMsg}</span>
            </div>
          )}

          {status === 'success_google' && (
            <div className="flex items-start gap-2 text-[11px] text-emerald-300 bg-emerald-950/40 border border-emerald-900/30 px-3 py-2.5 rounded-xl">
              <span className="shrink-0">✅</span>
              <span>¡Se ha abierto Google Calendar con la cita pre-rellenada! Solo tienes que pulsar <strong>"Guardar"</strong> allí.</span>
            </div>
          )}

          {status === 'success_ics' && (
            <div className="flex items-start gap-2 text-[11px] text-emerald-300 bg-emerald-950/40 border border-emerald-900/30 px-3 py-2.5 rounded-xl">
              <span className="shrink-0">✅</span>
              <span>¡Archivo <strong>.ics descargado!</strong> Ábrelo para añadir la cita a tu Apple Calendar, Outlook o cualquier app de calendario.</span>
            </div>
          )}

          {/* Botones de acción */}
          <div className="space-y-2.5 pt-1">

            {/* Google Calendar — abre URL pre-rellenada, sin OAuth */}
            <button
              type="button"
              disabled={status === 'loading'}
              onClick={handleGoogleCalendar}
              className="w-full py-3.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:brightness-110 disabled:opacity-60 text-slate-950 font-black rounded-xl text-xs flex items-center justify-center gap-2.5 shadow-lg shadow-cyan-500/15 active:scale-98 transition-all transform"
            >
              {status === 'loading' ? (
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z"/>
                </svg>
              )}
              Añadir a Google Calendar
            </button>

            {/* Apple / Outlook — descarga .ics */}
            <button
              type="button"
              disabled={status === 'loading'}
              onClick={handleDownloadICS}
              className="w-full py-3.5 bg-slate-800 hover:bg-slate-750 disabled:opacity-60 text-slate-200 font-bold rounded-xl text-xs border border-slate-700 flex items-center justify-center gap-2.5 active:scale-98 transition-all transform"
            >
              <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
              </svg>
              Descargar .ics (Apple / Outlook)
            </button>

            {/* Cerrar */}
            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 text-slate-500 hover:text-slate-300 font-semibold text-xs transition-colors duration-200"
            >
              Cancelar
            </button>
          </div>

          {/* Nota informativa */}
          <p className="text-[10px] text-slate-600 text-center leading-relaxed">
            Google Calendar se abre en una nueva pestaña con la cita lista para guardar.<br/>
            El .ics es compatible con Apple Calendar, Outlook y cualquier app de calendario.
          </p>
        </div>
      </div>
    </div>
  );
}
