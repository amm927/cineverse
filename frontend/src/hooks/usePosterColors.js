import { useEffect, useState } from 'react';
import { getPaletteSync } from 'colorthief';

export function usePosterColors(imageUrl) {
  const [colors, setColors] = useState({
    dominant: '#06b6d4', // Fallback cian neón
    primary: '#06b6d4',
    accent: '#ec4899',   // Fallback fucsia neón
    glow: 'rgba(6, 182, 212, 0.4)'
  });

  useEffect(() => {
    if (!imageUrl) return;

    // Crear objeto Image en memoria para extraer los colores
    const img = new Image();
    img.crossOrigin = 'Anonymous'; // Habilitar CORS para URLs externas como TMDB
    img.src = imageUrl;

    img.onload = () => {
      try {
        const palette = getPaletteSync(img, { colorCount: 4 });
        
        if (palette && palette.length >= 2) {
          const dominantColor = palette[0];
          const accentColor = palette[1];

          const dominantHex = dominantColor.hex();
          const accentHex = accentColor.hex();
          const [r, g, b] = dominantColor.array();
          const glowVal = `rgba(${r}, ${g}, ${b}, 0.35)`;

          setColors({
            dominant: dominantHex,
            primary: dominantHex,
            accent: accentHex,
            glow: glowVal
          });

          // Actualizar variables de CSS globales
          document.documentElement.style.setProperty('--movie-dominant', dominantHex);
          document.documentElement.style.setProperty('--movie-accent', accentHex);
          document.documentElement.style.setProperty('--movie-glow', glowVal);
        }
      } catch (err) {
        console.warn('[ColorThief] Error extrayendo colores del poster:', err);
      }
    };

    img.onerror = () => {
      console.warn('[ColorThief] Error al cargar la imagen para extracción:', imageUrl);
    };
  }, [imageUrl]);

  return colors;
}
