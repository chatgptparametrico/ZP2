// ── Optimizar el material para proyectarlo en un aula ───────────────────────
// Todo esto corre en el NAVEGADOR, en la máquina del administrador. No hace
// falta ninguna IA para redimensionar: es aritmética, sale gratis y da siempre
// el mismo resultado. Lo que sí se le pregunta a Claude —en otra ruta— es qué
// láminas no se van a leer proyectadas; su respuesta entra acá como el
// parámetro `nitidez`, que decide cuánto se puede comprimir cada una.
//
// Vercel no sirve para esto: es serverless, no trae ffmpeg y una función se
// corta mucho antes de recodificar un video. Por eso el trabajo pesado va del
// lado del cliente.

export const ANCHO_MAX = 1920;
export const ALTO_MAX = 1080;

// Los videos van a 1280 y no a 1920, y no es un descuido: medido sobre este
// mismo material, en una pared que ocupa el 80% de la pantalla no se distingue,
// y a 1920 el más pesado trepaba a 2,4 Mbps — en la red de un congreso eso se
// corta, y decodificar 1080p mientras se renderiza la escena tampoco es gratis.
export const ANCHO_VIDEO = 1280;

/** Cuánta calidad merece cada tipo de lámina al recomprimirla. */
export const CALIDAD: Record<string, number> = {
  foto: 0.72,       // una foto aguanta compresión fuerte sin que se note
  diagrama: 0.86,   // los bordes de un plano se ensucian enseguida
  texto: 0.9,       // y el texto, más todavía
};

export type Nitidez = keyof typeof CALIDAD;

export type Resultado = {
  nombre: string;
  antes: number;
  despues: number;
  ancho?: number;
  alto?: number;
  seDejoElOriginal?: boolean;
  nota?: string;
  blob: Blob;
};

/** Lee un archivo como imagen, sin pasar por el DOM. */
async function comoImagen(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file);
}

/**
 * Una imagen ajustada a la pantalla de proyección.
 *
 * Nunca AGRANDA: una lámina de 900 px se deja como está. Estirarla a 1920 la
 * haría pesar el triple sin agregar un solo detalle, que es exactamente lo que
 * el usuario notó cuando el plano importado se veía peor al escalarlo.
 */
export async function optimizarImagen(
  file: File | Blob,
  nombre: string,
  nitidez: Nitidez = 'diagrama'
): Promise<Resultado> {
  const bmp = await comoImagen(file);
  const escala = Math.min(1, ANCHO_MAX / bmp.width, ALTO_MAX / bmp.height);
  const ancho = Math.round(bmp.width * escala);
  const alto = Math.round(bmp.height * escala);

  const lienzo = document.createElement('canvas');
  lienzo.width = ancho;
  lienzo.height = alto;
  const ctx = lienzo.getContext('2d');
  if (!ctx) throw new Error('El navegador no dio un contexto 2D');
  // Sin esto, reducir a la mitad deja los bordes dentados: el navegador
  // muestrea en vez de promediar.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, ancho, alto);
  bmp.close();

  const blob: Blob = await new Promise((res, rej) =>
    lienzo.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo generar el JPEG'))), 'image/jpeg', CALIDAD[nitidez] ?? 0.86)
  );

  // Si comprimir la dejó MÁS pesada —pasa con láminas ya optimizadas o con
  // PNG de pocos colores— se devuelve el original. Es la misma regla que ya
  // valía para los videos de este material.
  if (blob.size >= file.size && escala === 1) {
    return {
      nombre, antes: file.size, despues: file.size, ancho, alto,
      seDejoElOriginal: true,
      nota: 'Ya estaba optimizada: recomprimirla la dejaba más pesada.',
      blob: file,
    };
  }
  return { nombre, antes: file.size, despues: blob.size, ancho, alto, blob };
}

/** Una miniatura chica para mandarle a Claude. No se guarda: es sólo para mirar. */
export async function miniatura(file: File | Blob, lado = 800): Promise<string> {
  const bmp = await comoImagen(file);
  const escala = Math.min(1, lado / Math.max(bmp.width, bmp.height));
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.round(bmp.width * escala);
  lienzo.height = Math.round(bmp.height * escala);
  const ctx = lienzo.getContext('2d');
  if (!ctx) throw new Error('El navegador no dio un contexto 2D');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, lienzo.width, lienzo.height);
  bmp.close();
  // Sin el prefijo «data:...;base64,»: la API quiere los bytes pelados.
  return lienzo.toDataURL('image/jpeg', 0.72).split(',')[1];
}

// ── Video y audio, con ffmpeg compilado a WebAssembly ───────────────────────
// Se carga el núcleo de UN SOLO HILO a propósito. El multihilo necesita
// SharedArrayBuffer, y eso obliga a servir el sitio con cabeceras COOP/COEP
// que romperían las imágenes y los iframes que la app trae de Supabase y de
// zirkeldep. Un hilo es más lento pero no toca nada más.

type Ffmpeg = {
  loaded: boolean;
  load: (o?: Record<string, string>) => Promise<void>;
  writeFile: (n: string, d: Uint8Array) => Promise<void>;
  readFile: (n: string) => Promise<Uint8Array>;
  deleteFile: (n: string) => Promise<void>;
  exec: (a: string[]) => Promise<number>;
  on: (e: string, cb: (x: { progress?: number; message?: string }) => void) => void;
};

let motor: Ffmpeg | null = null;

const NUCLEO = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd';

/** Enciende ffmpeg una sola vez. Son unos 30 MB: se avisa afuera. */
export async function motorFfmpeg(alProgresar?: (p: number) => void): Promise<Ffmpeg> {
  if (motor && motor.loaded) return motor;
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const { toBlobURL } = await import('@ffmpeg/util');
  const f = new FFmpeg() as unknown as Ffmpeg;
  if (alProgresar) f.on('progress', (x) => alProgresar(x.progress ?? 0));
  await f.load({
    coreURL: await toBlobURL(`${NUCLEO}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${NUCLEO}/ffmpeg-core.wasm`, 'application/wasm'),
  });
  motor = f;
  return f;
}

/**
 * Un video listo para proyectar: 1280 de ancho, H.264, audio mono.
 *
 * `+faststart` mueve el índice al principio del archivo, que es lo que permite
 * empezar a reproducir sin bajarlo entero. En una presentación que carga los
 * medios por red, sin eso el primer video tarda en arrancar.
 */
export async function optimizarVideo(
  file: File | Blob,
  nombre: string,
  alProgresar?: (p: number) => void
): Promise<Resultado> {
  const f = await motorFfmpeg(alProgresar);
  const ent = 'ent-' + Date.now() + '.bin';
  const sal = 'sal-' + Date.now() + '.mp4';
  await f.writeFile(ent, new Uint8Array(await file.arrayBuffer()));
  await f.exec([
    '-i', ent,
    // min() y no un valor fijo: un video que ya viene angosto no se agranda.
    '-vf', `scale='min(${ANCHO_VIDEO},iw)':-2`,
    '-c:v', 'libx264', '-crf', '26', '-preset', 'medium',
    // 'slow' da unos pocos por ciento más de compresión y en WebAssembly puede
    // duplicar el tiempo. En el navegador no compensa.
    '-c:a', 'aac', '-ac', '1', '-b:a', '64k',
    '-movflags', '+faststart',
    sal,
  ]);
  const datos = await f.readFile(sal);
  await f.deleteFile(ent);
  await f.deleteFile(sal);
  const blob = new Blob([datos as unknown as BlobPart], { type: 'video/mp4' });

  // Un video del mazo puede CRECER al recomprimirlo, sobre todo si ya venía
  // comprimido con un codificador mejor. Se compara y gana el más chico.
  if (blob.size >= file.size) {
    return {
      nombre, antes: file.size, despues: file.size,
      seDejoElOriginal: true,
      // Se dice CUÁNTO dio el recomprimido: sin ese número, «se dejó el
      // original» parece que el codificador no hizo nada, y en realidad hizo
      // el trabajo y perdió por poco o por mucho. Cambia lo que uno decide
      // después.
      nota: `Ya estaba bien comprimido: recomprimirlo daba ${enMB(blob.size)}, más que el original.`,
      blob: file,
    };
  }
  return { nombre, antes: file.size, despues: blob.size, blob };
}

/** Audio suelto: mono a 64 kbps, que para voz en un aula sobra. */
export async function optimizarAudio(
  file: File | Blob,
  nombre: string,
  alProgresar?: (p: number) => void
): Promise<Resultado> {
  const f = await motorFfmpeg(alProgresar);
  const ent = 'aent-' + Date.now() + '.bin';
  const sal = 'asal-' + Date.now() + '.m4a';
  await f.writeFile(ent, new Uint8Array(await file.arrayBuffer()));
  await f.exec(['-i', ent, '-vn', '-c:a', 'aac', '-ac', '1', '-b:a', '64k', sal]);
  const datos = await f.readFile(sal);
  await f.deleteFile(ent);
  await f.deleteFile(sal);
  const blob = new Blob([datos as unknown as BlobPart], { type: 'audio/mp4' });
  if (blob.size >= file.size) {
    return {
      nombre, antes: file.size, despues: file.size,
      seDejoElOriginal: true,
      nota: `Ya estaba bien comprimido: recomprimirlo daba ${enMB(blob.size)}, más que el original.`,
      blob: file,
    };
  }
  return { nombre, antes: file.size, despues: blob.size, blob };
}

export const enMB = (b: number) => (b / 1048576).toFixed(2) + ' MB';

/** Ordena «lamina2.jpg» antes que «lamina10.jpg», que es como los numera la gente. */
export function porNumero(a: string, b: string): number {
  const n = (s: string) => {
    const m = s.match(/(\d+)/);
    return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
  };
  const d = n(a) - n(b);
  return d !== 0 ? d : a.localeCompare(b, 'es');
}
