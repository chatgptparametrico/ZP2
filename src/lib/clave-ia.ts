import { createClient } from '@supabase/supabase-js';

// ── La clave de la API de Anthropic ─────────────────────────────────────────
// Es una clave CON CRÉDITO: si se filtra, alguien gasta plata ajena. De ahí
// todo lo que sigue.
//
//   · Vive cifrada (AES-GCM) en el bucket privado, fuera de cualquier ruta
//     pública. En Vercel no hay disco donde escribir, así que el bucket que ya
//     usa la app es el único lugar durable.
//   · NUNCA vuelve al navegador. El panel pregunta «¿hay clave?» y recibe sí o
//     no, más los últimos cuatro caracteres para reconocerla. Las llamadas a
//     Anthropic las hace el servidor.
//   · Sólo la escribe y la borra un administrador (lo comprueba la ruta).
//
// ⚠️ El secreto de cifrado sale de ZIRKEL_IA_SECRET, o de ZIRKEL_GATE_SECRET
// si aquél falta. Si NINGUNO está puesto en Vercel, `secretoDebil()` avisa: el
// valor por omisión está escrito en el repositorio y cifrar con él es apenas
// mejor que guardarla en claro.

const BUCKET = 'zirkelp-storage';
const RUTA = 'privado/clave-ia.json';
const POR_OMISION = 'zirkel-porton-2026';

function secretoCrudo(): string {
  return process.env.ZIRKEL_IA_SECRET || process.env.ZIRKEL_GATE_SECRET || POR_OMISION;
}

/** True si se está cifrando con el valor que está escrito en el repositorio. */
export function secretoDebil(): boolean {
  return secretoCrudo() === POR_OMISION;
}

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/** Una clave AES-256 derivada del secreto, para no depender de su largo. */
async function claveAes(): Promise<CryptoKey> {
  const material = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(secretoCrudo())
  );
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

const aB64 = (b: ArrayBuffer) => Buffer.from(new Uint8Array(b)).toString('base64');
const deB64 = (s: string) => Uint8Array.from(Buffer.from(s, 'base64'));

export type EstadoClave = {
  hay: boolean; cola?: string; guardadaEn?: string; debil?: boolean;
  // `sinDonde` distingue «todavía no pegaste ninguna» de «no hay dónde
  // guardarla»: sin esto el panel decía lo mismo en los dos casos y el usuario
  // pegaba la clave una y otra vez sin entender por qué no quedaba.
  sinDonde?: boolean;
};

/** Qué se le puede contar al panel: si hay clave y cómo reconocerla. Nunca la clave. */
export async function estadoClave(): Promise<EstadoClave> {
  const s = supa();
  if (!s) return { hay: false, sinDonde: true };
  const { data, error } = await s.storage.from(BUCKET).download(RUTA);
  if (error || !data) return { hay: false, debil: secretoDebil() };
  try {
    const guardado = JSON.parse(await data.text());
    return {
      hay: true,
      cola: guardado.cola || '',
      guardadaEn: guardado.guardadaEn || '',
      debil: secretoDebil(),
    };
  } catch {
    return { hay: false, debil: secretoDebil() };
  }
}

/** Guarda la clave cifrada. Devuelve false si no hay dónde guardarla. */
export async function guardarClave(clave: string): Promise<boolean> {
  const s = supa();
  if (!s) return false;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cifrada = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await claveAes(),
    new TextEncoder().encode(clave)
  );
  const cuerpo = JSON.stringify({
    v: 1,
    iv: aB64(iv.buffer as ArrayBuffer),
    dato: aB64(cifrada),
    // Los últimos cuatro caracteres son para que el usuario reconozca cuál
    // puso, como hacen los paneles de cualquier proveedor. No sirven para
    // reconstruirla.
    cola: clave.slice(-4),
    guardadaEn: new Date().toISOString(),
  });
  const { error } = await s.storage
    .from(BUCKET)
    .upload(RUTA, new Blob([cuerpo], { type: 'application/json' }), { upsert: true });
  return !error;
}

/** La clave en claro, sólo para uso del servidor. Null si no hay o no se pudo. */
export async function leerClave(): Promise<string | null> {
  const s = supa();
  if (!s) return null;
  const { data, error } = await s.storage.from(BUCKET).download(RUTA);
  if (error || !data) return null;
  try {
    const g = JSON.parse(await data.text());
    const abierta = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: deB64(g.iv) },
      await claveAes(),
      deB64(g.dato)
    );
    return new TextDecoder().decode(abierta);
  } catch {
    // Pasa si cambió el secreto de cifrado: la clave vieja ya no se puede
    // abrir y hay que volver a pegarla. Es lo correcto, no un error a tapar.
    return null;
  }
}

export async function borrarClave(): Promise<boolean> {
  const s = supa();
  if (!s) return false;
  const { error } = await s.storage.from(BUCKET).remove([RUTA]);
  return !error;
}
