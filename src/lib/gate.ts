// ── Acceso ───────────────────────────────────────────────────────────────────
// Esta app no tiene contraseña propia. El acceso lo maneja zirkeldep.com: al
// hacer click en el enlace desde allá, si sos administrador te dan un ticket
// firmado de vida corta que llega en la URL (?t=). Acá se valida contra
// zirkeldep —que es quien sabe quién es admin— y se deja una cookie propia.
// Cualquiera que llegue sin ticket ve la pantalla de acceso restringido.
export const COOKIE_PORTON = 'zirkel_gate';
export const HORAS_VALIDEZ = 12;

const PANEL = process.env.ZIRKEL_GATE_API || 'https://zirkeldep.com/api_simulator_states.php';
const SECRETO = process.env.ZIRKEL_GATE_SECRET || 'zirkel-porton-2026';

// `desdePanel` dice si la version que traemos es la de verdad o un relleno
// porque el panel no contesto. Es la diferencia entre caducar sesiones a
// proposito y echar a alguien por un hipo de red.
type Estado = { activo: boolean; version: string; desdePanel: boolean };
let cache: { estado: Estado; hasta: number } | null = null;
let ultimoBueno: Estado | null = null;

/** ¿Hay que exigir acceso? Se administra desde el panel de zirkeldep. */
export async function estadoPorton(): Promise<Estado> {
  if (cache && cache.hasta > Date.now()) return cache.estado;
  try {
    const r = await fetch(`${PANEL}?action=gate_estado`, { cache: 'no-store' });
    const d = await r.json();
    if (typeof d?.activo === 'boolean') {
      const estado: Estado = {
        activo: d.activo,
        version: String(d.version || 'sin-version'),
        desdePanel: true,
      };
      ultimoBueno = estado;
      cache = { estado, hasta: Date.now() + 60_000 };
      return estado;
    }
  } catch {
    /* sin respuesta: se resuelve abajo */
  }
  // El panel no contesto. Se conserva lo ultimo que si supimos; si nunca
  // supimos nada, se exige acceso igual (lado prudente) pero SIN afirmar una
  // version, para no invalidar cookies legitimas. Se reintenta antes.
  const estado: Estado = ultimoBueno ?? { activo: true, version: 'sin-panel', desdePanel: false };
  cache = { estado, hasta: Date.now() + 15_000 };
  return estado;
}

/** Valida contra zirkeldep el ticket que llegó por la URL. */
export async function ticketValido(ticket: string): Promise<boolean> {
  if (!ticket) return false;
  try {
    const r = await fetch(`${PANEL}?action=gate_ticket_check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'gate_ticket_check', ticket }),
      cache: 'no-store',
    });
    const d = await r.json();
    return d?.ok === true;
  } catch {
    return false;
  }
}

const aHex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

async function firmar(payload: string): Promise<string> {
  const clave = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRETO),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return aHex(await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(payload)));
}

/** Cookie opaca `vencimiento~version.firma`; el navegador no puede fabricarla. */
export async function emitirToken(): Promise<string> {
  const { version } = await estadoPorton();
  const cuerpo = `${Date.now() + HORAS_VALIDEZ * 3600 * 1000}~${version}`;
  return `${cuerpo}.${await firmar(cuerpo)}`;
}

export async function tokenValido(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const corte = token.lastIndexOf('.');
  if (corte < 1) return false;
  const cuerpo = token.slice(0, corte);
  const firma = token.slice(corte + 1);

  const [vence, version] = cuerpo.split('~');
  if (!/^\d+$/.test(vence || '') || Number(vence) < Date.now()) return false;

  // Si en el panel cambiaron la configuración, este token quedó viejo. Pero
  // esto solo se exige cuando la version viene del panel de verdad: si el
  // panel no contesto, invalidar la cookie echaria de la app a quien esta
  // adentro —en plena presentacion— por una caida ajena.
  const actual = await estadoPorton();
  if (actual.desdePanel && version !== actual.version) return false;

  const esperada = await firmar(cuerpo);
  if (firma.length !== esperada.length) return false;
  let dif = 0;
  for (let i = 0; i < firma.length; i += 1) dif |= firma.charCodeAt(i) ^ esperada.charCodeAt(i);
  return dif === 0;
}
