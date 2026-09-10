import { NextResponse } from 'next/server';
import { vetoSiNoEsAdmin } from '@/lib/admin';
import { leerClave } from '@/lib/clave-ia';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// ── La revisión de Claude ───────────────────────────────────────────────────
// Acá NO se optimiza nada: eso lo hace el navegador, con canvas y ffmpeg, y es
// aritmética. Lo que aporta el modelo es el criterio que no está en los
// píxeles: si esa lámina se va a LEER proyectada en un aula, desde el fondo.
//
// El navegador manda miniaturas (unos 800 px), no los originales: alcanzan de
// sobra para juzgar tamaño de letra y contraste, y mandar el original sería
// pagar por resolución que no cambia el veredicto.
//
// La clave nunca sale del servidor: llega acá desde el bucket, se usa, y no se
// devuelve ni se registra.

const MODELO = 'claude-sonnet-5';
const TOPE_LAMINAS = 12;   // por llamada; el panel corta en tandas

const INSTRUCCIONES = `Sos un asistente de un profesor de estructuras que va a proyectar estas
láminas en el aula, sobre una pantalla, con un proyector común. La gente del fondo está a unos
diez metros.

Para CADA lámina que te paso, decidí si se va a leer y si se va a ver bien proyectada. Mirá:

- Tamaño de la letra. Es el problema más frecuente: texto pensado para mirar en un monitor a 50 cm
  que proyectado no se lee desde atrás. Si el texto más chico ocupa menos de ~2% del alto de la
  lámina, no se lee.
- Contraste. Un proyector de aula con luz ambiente lava los grises y los colores claros sobre
  blanco. Gris sobre blanco, amarillo sobre blanco o azul oscuro sobre negro desaparecen.
- Trazos finos. Las líneas de un plano CAD de un píxel se cortan al proyectar.
- Saturación y fondos oscuros: una lámina de fondo negro con mucha tinta se ve sucia y consume
  lámpara; una foto muy oscura se pierde entera.
- Densidad: demasiada información en una sola lámina.

Respondé SOLO con un JSON válido, sin texto alrededor, con esta forma exacta:

{"laminas":[{"n":1,"veredicto":"bien|revisar|rehacer","motivo":"una frase corta y concreta",
"nitidez":"foto|diagrama|texto","sugerencia":"qué hacer, una frase; vacío si está bien"}]}

- "n" es el número de lámina que te di.
- "veredicto": "bien" si se proyecta sin problema; "revisar" si tiene un defecto que se puede
  compensar al optimizar (por ejemplo, subirle el contraste); "rehacer" si el problema es de
  autoría y ninguna recompresión lo arregla (letra demasiado chica, por ejemplo).
- "nitidez" dice qué tipo de imagen es, porque de eso depende cómo conviene comprimirla: "foto"
  admite compresión fuerte, "diagrama" y "texto" necesitan más calidad para que no se ensucien
  los bordes.
Sé breve y concreto. Nada de elogios ni de rodeos.`;

type Lamina = { n: number; medio: string; datos: string };

export async function POST(request: Request) {
  const veto = await vetoSiNoEsAdmin();
  if (veto) return veto;

  const clave = await leerClave();
  if (!clave) {
    return NextResponse.json(
      { error: 'No hay clave de Anthropic guardada, o el secreto de cifrado cambió y hay que volver a pegarla.' },
      { status: 400 }
    );
  }

  let laminas: Lamina[] = [];
  try {
    laminas = (((await request.json()) || {}).laminas || []) as Lamina[];
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }
  if (!laminas.length) return NextResponse.json({ laminas: [] });
  if (laminas.length > TOPE_LAMINAS) {
    return NextResponse.json(
      { error: `Máximo ${TOPE_LAMINAS} láminas por llamada; el panel las manda por tandas.` },
      { status: 400 }
    );
  }

  // Cada lámina va precedida de su número, para que el modelo no tenga que
  // deducir el orden: cuando se le pide inferirlo, se equivoca.
  const contenido: unknown[] = [];
  for (const l of laminas) {
    contenido.push({ type: 'text', text: `Lámina ${l.n}:` });
    contenido.push({
      type: 'image',
      source: { type: 'base64', media_type: l.medio || 'image/jpeg', data: l.datos },
    });
  }

  let r: Response;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': clave,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 2000,
        system: INSTRUCCIONES,
        messages: [{ role: 'user', content: contenido }],
      }),
    });
  } catch {
    return NextResponse.json({ error: 'No se pudo conectar con Anthropic.' }, { status: 502 });
  }

  if (!r.ok) {
    // El detalle del proveedor se pasa tal cual porque distingue lo que el
    // usuario tiene que hacer: sin crédito, clave revocada o pasada de cuota
    // son tres arreglos distintos. No lleva la clave adentro.
    let detalle = '';
    try {
      detalle = (await r.json())?.error?.message || '';
    } catch { /* el cuerpo puede no ser JSON */ }
    const humano =
      r.status === 401 ? 'La clave no es válida o fue revocada.' :
      r.status === 429 ? 'Anthropic devolvió «demasiadas peticiones»: esperá un momento y reintentá.' :
      r.status === 400 && /credit/i.test(detalle) ? 'La cuenta no tiene crédito.' :
      `Anthropic devolvió ${r.status}.`;
    return NextResponse.json({ error: humano + (detalle ? ' ' + detalle : '') }, { status: 502 });
  }

  const d = await r.json();
  const texto: string = (d?.content || [])
    .filter((c: { type?: string }) => c?.type === 'text')
    .map((c: { text?: string }) => c.text || '')
    .join('');

  // El modelo a veces envuelve el JSON en un bloque de código aunque se le pida
  // que no: se busca el objeto en vez de confiar en que venga pelado.
  const desde = texto.indexOf('{');
  const hasta = texto.lastIndexOf('}');
  if (desde < 0 || hasta <= desde) {
    return NextResponse.json({ error: 'La respuesta no trajo un JSON legible.', crudo: texto.slice(0, 400) }, { status: 502 });
  }
  try {
    const parsed = JSON.parse(texto.slice(desde, hasta + 1));
    return NextResponse.json({
      laminas: parsed.laminas || [],
      uso: d?.usage || null,   // para que el panel muestre cuánto se gastó
    });
  } catch {
    return NextResponse.json({ error: 'La respuesta no era JSON válido.', crudo: texto.slice(0, 400) }, { status: 502 });
  }
}
