'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ALTO_MAX, ANCHO_MAX, ANCHO_VIDEO, enMB, miniatura, motorFfmpeg,
  optimizarAudio, optimizarImagen, optimizarVideo, porNumero,
  type Nitidez, type Resultado,
} from '@/lib/optimizar';

// ── Panel de optimización del material ──────────────────────────────────────
// Dos cosas distintas que conviene no confundir:
//
//   1. OPTIMIZAR. Lo hace este navegador, con canvas para las imágenes y con
//      ffmpeg compilado a WebAssembly para el video y el audio. Es aritmética:
//      no interviene ninguna IA, no cuesta nada y da siempre lo mismo.
//   2. REVISAR. Eso sí se le pregunta a Claude, y es lo que gasta crédito:
//      mirar cada lámina y decir si se va a leer proyectada en un aula. Su
//      respuesta vuelve como «foto / diagrama / texto» y decide cuánta
//      compresión aguanta cada una.
//
// Se puede optimizar sin revisar. Al revés no: revisar sin optimizar sirve
// como diagnóstico, y también está permitido.

type Estado = { hay: boolean; cola?: string; guardadaEn?: string; debil?: boolean; sinDonde?: boolean };
type Veredicto = { n: number; veredicto: string; motivo: string; nitidez: Nitidez; sugerencia: string };
type Fila = { archivo: File; n: number; res?: Resultado; ver?: Veredicto; estado: string };

const TANDA = 12;   // láminas por llamada, igual que el tope de la ruta

export default function PanelOptimizar() {
  const [clave, setClave] = useState<Estado | null>(null);
  const [pegando, setPegando] = useState('');
  const [aviso, setAviso] = useState<{ txt: string; mal?: boolean } | null>(null);
  const [filas, setFilas] = useState<Fila[]>([]);
  const [trabajando, setTrabajando] = useState('');
  const [progreso, setProgreso] = useState(0);
  const [jsonOriginal, setJsonOriginal] = useState<unknown>(null);
  const entrada = useRef<HTMLInputElement>(null);

  const cargarEstado = useCallback(async () => {
    const r = await fetch('/api/clave-ia', { cache: 'no-store' });
    if (r.ok) setClave(await r.json());
  }, []);
  useEffect(() => { cargarEstado(); }, [cargarEstado]);

  // ── La clave ──────────────────────────────────────────────────────────────
  async function guardarClave() {
    setAviso(null);
    const r = await fetch('/api/clave-ia', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clave: pegando }),
    });
    const d = await r.json();
    if (!r.ok) { setAviso({ txt: d.error || 'No se pudo guardar.', mal: true }); return; }
    setPegando('');
    setClave(d);
    setAviso({ txt: 'Clave guardada. No vuelve a mostrarse: si la perdés, pegá una nueva.' });
  }

  async function borrarClave() {
    const r = await fetch('/api/clave-ia', { method: 'DELETE' });
    if (r.ok) { setClave(await r.json()); setAviso({ txt: 'Clave borrada.' }); }
  }

  // ── Qué se va a optimizar ─────────────────────────────────────────────────
  function tomarArchivos(lista: FileList | null) {
    if (!lista || !lista.length) return;
    const todos = Array.from(lista);

    // Un JSON exportado de ZirkelP: se guarda para reescribirlo al final con
    // los medios nuevos, y se avisa qué trae.
    const json = todos.find((f) => /\.json$/i.test(f.name));
    if (json) {
      json.text().then((t) => {
        try {
          const d = JSON.parse(t);
          setJsonOriginal(d);
          const cuantas = (d.boxes || []).reduce(
            (n: number, b: { slides?: unknown[] }) => n + (b.slides?.length || 0), 0);
          setAviso({ txt: `JSON de ZirkelP leído: ${(d.boxes || []).length} sala(s) y ${cuantas} lámina(s). ` +
            'Los medios que estén como enlace hay que bajarlos aparte; los que vengan incrustados se optimizan acá.' });
        } catch {
          setAviso({ txt: 'Ese .json no se pudo leer.', mal: true });
        }
      });
    }

    const medios = todos
      .filter((f) => /^(image|video|audio)\//.test(f.type))
      .sort((a, b) => porNumero(a.name, b.name));
    if (!medios.length && !json) { setAviso({ txt: 'No hay imágenes, videos ni audio en lo que elegiste.', mal: true }); return; }
    setFilas(medios.map((f, i) => ({ archivo: f, n: i + 1, estado: 'esperando' })));
  }

  // ── Revisar con Claude ────────────────────────────────────────────────────
  async function revisar() {
    const imgs = filas.filter((f) => f.archivo.type.startsWith('image/'));
    if (!imgs.length) { setAviso({ txt: 'No hay imágenes para revisar.', mal: true }); return; }
    if (!clave?.hay) { setAviso({ txt: 'Primero pegá la clave de Anthropic.', mal: true }); return; }

    setTrabajando('Revisando con Claude…');
    setAviso(null);
    try {
      for (let i = 0; i < imgs.length; i += TANDA) {
        const tanda = imgs.slice(i, i + TANDA);
        setProgreso(Math.round((i / imgs.length) * 100));
        const laminas = await Promise.all(tanda.map(async (f) => ({
          n: f.n, medio: 'image/jpeg', datos: await miniatura(f.archivo),
        })));
        const r = await fetch('/api/revisar-laminas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ laminas }),
        });
        const d = await r.json();
        if (!r.ok) { setAviso({ txt: d.error || 'Falló la revisión.', mal: true }); break; }
        setFilas((prev) => prev.map((f) => {
          const v = (d.laminas || []).find((x: Veredicto) => x.n === f.n);
          return v ? { ...f, ver: v } : f;
        }));
      }
      setProgreso(100);
    } finally {
      setTrabajando('');
    }
  }

  // ── Optimizar ─────────────────────────────────────────────────────────────
  async function optimizar() {
    if (!filas.length) return;
    setAviso(null);
    const hayPesados = filas.some((f) => /^(video|audio)\//.test(f.archivo.type));
    if (hayPesados) {
      setTrabajando('Cargando ffmpeg (unos 30 MB, la primera vez)…');
      await motorFfmpeg();
    }
    for (let i = 0; i < filas.length; i++) {
      const f = filas[i];
      setTrabajando(`Optimizando ${f.archivo.name} (${i + 1} de ${filas.length})…`);
      setProgreso(Math.round((i / filas.length) * 100));
      try {
        let res: Resultado;
        if (f.archivo.type.startsWith('image/')) {
          res = await optimizarImagen(f.archivo, f.archivo.name, f.ver?.nitidez || 'diagrama');
        } else if (f.archivo.type.startsWith('video/')) {
          res = await optimizarVideo(f.archivo, f.archivo.name, (p) => setProgreso(Math.round(p * 100)));
        } else {
          res = await optimizarAudio(f.archivo, f.archivo.name, (p) => setProgreso(Math.round(p * 100)));
        }
        setFilas((prev) => prev.map((x, j) => (j === i ? { ...x, res, estado: 'listo' } : x)));
      } catch (e) {
        setFilas((prev) => prev.map((x, j) =>
          (j === i ? { ...x, estado: 'falló: ' + (e as Error).message } : x)));
      }
    }
    setProgreso(100);
    setTrabajando('');
  }

  function bajar(f: Fila) {
    if (!f.res) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f.res.blob);
    // El nombre lleva el número delante para que el orden se conserve al
    // volver a subirlas: ZirkelP las ordena por nombre.
    const ext = f.res.blob.type.split('/')[1]?.replace('mpeg', 'mp3') || 'bin';
    a.download = String(f.n).padStart(3, '0') + '-' + f.archivo.name.replace(/\.[^.]+$/, '') + '.' + ext;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function bajarTodo() {
    filas.filter((f) => f.res).forEach((f, i) => setTimeout(() => bajar(f), i * 250));
  }

  const listos = filas.filter((f) => f.res);
  const antes = listos.reduce((t, f) => t + (f.res?.antes || 0), 0);
  const despues = listos.reduce((t, f) => t + (f.res?.despues || 0), 0);

  return (
    <main style={S.pagina}>
      <h1 style={S.h1}>Optimizar material</h1>
      <p style={S.bajada}>
        Ajusta las imágenes a {ANCHO_MAX}×{ALTO_MAX} y los videos a {ANCHO_VIDEO} de ancho, que es
        lo que hace falta para proyectar en un aula. El trabajo lo hace tu navegador: no se sube
        nada a ningún lado.
      </p>

      {/* ── La clave ─────────────────────────────────────────────────────── */}
      <section style={S.caja}>
        <h2 style={S.h2}>Clave de Anthropic</h2>
        <p style={S.ayuda}>
          Sirve <strong>sólo para la revisión</strong>: que Claude mire cada lámina y diga si se va
          a leer proyectada. Redimensionar y recomprimir no la necesita y no gasta crédito.
        </p>
        {clave?.hay ? (
          <div style={S.fila}>
            <span style={S.ok}>Hay una clave guardada (termina en …{clave.cola})</span>
            <button style={S.botonFlojo} onClick={borrarClave}>Sacarla</button>
          </div>
        ) : (
          <div style={S.fila}>
            <input
              type="password" placeholder="sk-ant-…" value={pegando}
              onChange={(e) => setPegando(e.target.value)} style={S.input}
              autoComplete="off" spellCheck={false}
            />
            <button style={S.boton} onClick={guardarClave} disabled={!pegando.trim()}>Guardar</button>
          </div>
        )}
        {clave?.sinDonde && (
          <p style={S.alerta}>
            No hay dónde guardarla: falta la configuración de Supabase en el servidor
            (<code>NEXT_PUBLIC_SUPABASE_URL</code> y <code>SUPABASE_SERVICE_ROLE_KEY</code>).
            Hasta que estén, la revisión con Claude no va a funcionar; optimizar sí.
          </p>
        )}
        {clave?.debil && (
          <p style={S.alerta}>
            Ojo: falta <code>ZIRKEL_IA_SECRET</code> en Vercel, así que la clave se cifra con el
            valor por omisión, que está escrito en el repositorio. Poné esa variable y volvé a
            pegar la clave.
          </p>
        )}
      </section>

      {/* ── El material ──────────────────────────────────────────────────── */}
      <section style={S.caja}>
        <h2 style={S.h2}>El material</h2>
        <p style={S.ayuda}>
          Elegí las imágenes numeradas (lamina1.jpg, lamina2.jpg…), los videos y el audio. También
          podés sumar el .json que exportaste de ZirkelP para tenerlo de referencia.
        </p>
        <input
          ref={entrada} type="file" multiple
          accept="image/*,video/*,audio/*,application/json"
          onChange={(e) => tomarArchivos(e.target.files)} style={S.input}
        />
        {filas.length > 0 && (
          <div style={{ ...S.fila, marginTop: 12 }}>
            <button style={S.boton} onClick={optimizar} disabled={!!trabajando}>
              Optimizar {filas.length} archivo(s)
            </button>
            <button style={S.botonFlojo} onClick={revisar} disabled={!!trabajando || !clave?.hay}>
              Revisar con Claude
            </button>
            {listos.length > 0 && (
              <button style={S.botonFlojo} onClick={bajarTodo}>Bajar los {listos.length} optimizados</button>
            )}
          </div>
        )}
      </section>

      {trabajando && (
        <div style={S.caja}>
          <p style={{ margin: 0 }}>{trabajando}</p>
          <div style={S.barra}><div style={{ ...S.barraDentro, width: progreso + '%' }} /></div>
        </div>
      )}
      {aviso && <p style={aviso.mal ? S.alerta : S.nota}>{aviso.txt}</p>}
      {jsonOriginal != null && (
        <p style={S.nota}>Hay un JSON de ZirkelP cargado como referencia.</p>
      )}

      {/* ── Resultados ───────────────────────────────────────────────────── */}
      {filas.length > 0 && (
        <section style={S.caja}>
          <h2 style={S.h2}>
            Resultado
            {listos.length > 0 && (
              <span style={S.resumen}>
                {' '}— {enMB(antes)} → {enMB(despues)}
                {antes > 0 && ` (${Math.round((1 - despues / antes) * 100)}% menos)`}
              </span>
            )}
          </h2>
          <table style={S.tabla}>
            <thead>
              <tr>
                <th style={S.th}>#</th><th style={S.th}>Archivo</th><th style={S.th}>Antes</th>
                <th style={S.th}>Después</th><th style={S.th}>Medidas</th>
                <th style={S.th}>Claude</th><th style={S.th}></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.n}>
                  <td style={S.td}>{f.n}</td>
                  <td style={S.td}>{f.archivo.name}</td>
                  <td style={S.td}>{enMB(f.archivo.size)}</td>
                  <td style={S.td}>
                    {f.res ? enMB(f.res.despues) : f.estado}
                    {f.res?.seDejoElOriginal && (
                      <span style={S.chico} title={f.res.nota || ''}> · original</span>
                    )}
                  </td>
                  <td style={S.td}>{f.res?.ancho ? `${f.res.ancho}×${f.res.alto}` : '—'}</td>
                  <td style={S.td}>
                    {f.ver ? (
                      <span title={f.ver.motivo + (f.ver.sugerencia ? ' — ' + f.ver.sugerencia : '')}
                            style={f.ver.veredicto === 'rehacer' ? S.mal
                                 : f.ver.veredicto === 'revisar' ? S.medio : S.bien}>
                        {f.ver.veredicto} · {f.ver.nitidez}
                      </span>
                    ) : '—'}
                  </td>
                  <td style={S.td}>
                    {f.res && <button style={S.botonChico} onClick={() => bajar(f)}>Bajar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filas.some((f) => f.res?.nota) && (
            <div style={{ marginTop: 12 }}>
              {filas.filter((f) => f.res?.nota).map((f) => (
                <p key={'n' + f.n} style={S.nota}>
                  <strong>{f.n}. {f.archivo.name}</strong> — {f.res!.nota}
                </p>
              ))}
            </div>
          )}
          {filas.some((f) => f.ver?.motivo) && (
            <div style={{ marginTop: 14 }}>
              <h3 style={S.h3}>Lo que dijo Claude</h3>
              {filas.filter((f) => f.ver?.motivo).map((f) => (
                <p key={f.n} style={S.dictamen}>
                  <strong>{f.n}. {f.archivo.name}</strong> — {f.ver!.motivo}
                  {f.ver!.sugerencia ? <em> {f.ver!.sugerencia}</em> : null}
                </p>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}

// Estilos en línea a propósito: el panel es una herramienta interna de una sola
// página y no vale la pena sumarle una hoja de estilos al proyecto.
const S: Record<string, React.CSSProperties> = {
  pagina: { maxWidth: 1000, margin: '0 auto', padding: '32px 20px 80px', color: '#dbeafe',
            background: '#050b18', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' },
  h1: { fontSize: '1.7rem', margin: '0 0 6px' },
  h2: { fontSize: '1rem', margin: '0 0 8px', color: '#7dd3fc' },
  h3: { fontSize: '.9rem', margin: '0 0 6px', color: '#7dd3fc' },
  bajada: { color: '#93b4d6', margin: '0 0 22px', lineHeight: 1.5 },
  caja: { background: 'rgba(12,26,48,.75)', border: '1px solid rgba(69,224,255,.2)',
          borderRadius: 12, padding: 16, marginBottom: 16 },
  ayuda: { color: '#93b4d6', fontSize: '.85rem', margin: '0 0 10px', lineHeight: 1.5 },
  fila: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
  input: { flex: 1, minWidth: 240, padding: '9px 11px', borderRadius: 8,
           border: '1px solid rgba(69,224,255,.3)', background: '#08152b', color: '#dbeafe' },
  boton: { padding: '9px 16px', borderRadius: 8, border: 0, background: '#0ea5e9',
           color: '#04101f', fontWeight: 700, cursor: 'pointer' },
  botonFlojo: { padding: '9px 16px', borderRadius: 8, cursor: 'pointer',
                border: '1px solid rgba(69,224,255,.35)', background: 'transparent', color: '#7dd3fc' },
  botonChico: { padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: '.75rem',
                border: '1px solid rgba(69,224,255,.35)', background: 'transparent', color: '#7dd3fc' },
  ok: { color: '#4ade80', flex: 1 },
  nota: { color: '#93b4d6', fontSize: '.85rem', lineHeight: 1.5 },
  alerta: { color: '#fca5a5', fontSize: '.85rem', lineHeight: 1.5 },
  barra: { height: 6, background: 'rgba(69,224,255,.15)', borderRadius: 4, marginTop: 10 },
  barraDentro: { height: '100%', background: '#0ea5e9', borderRadius: 4, transition: 'width .2s' },
  tabla: { width: '100%', borderCollapse: 'collapse', fontSize: '.82rem' },
  th: { textAlign: 'left', padding: '6px 8px', color: '#7dd3fc',
        borderBottom: '1px solid rgba(69,224,255,.25)' },
  td: { padding: '6px 8px', borderBottom: '1px solid rgba(69,224,255,.08)' },
  chico: { fontSize: '.7rem', color: '#93b4d6' },
  bien: { color: '#4ade80' },
  medio: { color: '#fbbf24' },
  mal: { color: '#fca5a5' },
  resumen: { color: '#93b4d6', fontWeight: 400, fontSize: '.85rem' },
  dictamen: { color: '#c7dcf0', fontSize: '.82rem', margin: '0 0 5px', lineHeight: 1.5 },
};
