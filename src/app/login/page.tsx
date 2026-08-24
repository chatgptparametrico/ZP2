'use client';

import { useState } from 'react';

// Portada de ZirkelP. La app es de uso público: desde acá se entra a armar una
// presentación propia, o se pide acceso docente para ver además el material del
// congreso. No se pide contraseña a nadie — los administradores entran con su
// ticket desde zirkeldep y los docentes con su enlace personal.
export default function Portada() {
  const [mostrarForm, setMostrarForm] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; error?: boolean } | null>(null);
  const [datos, setDatos] = useState({ nombre: '', email: '', institucion: '', mensaje: '' });

  const entrar = async () => {
    setEnviando(true);
    try {
      await fetch('/api/entrar', { method: 'POST' });
      window.location.href = '/';
    } catch {
      setAviso({ texto: 'No se pudo abrir la aplicación. Probá recargando.', error: true });
      setEnviando(false);
    }
  };

  const solicitar = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setAviso(null);
    try {
      const r = await fetch('/api/solicitar-acceso', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(datos),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'No se pudo enviar el pedido');
      setMostrarForm(false);
      setAviso({
        texto: d.yaAprobado
          ? 'Ese correo ya tiene acceso: revisá tu casilla, el enlace de entrada está ahí.'
          : 'Pedido enviado. Cuando lo habiliten te llega un enlace por correo.',
      });
    } catch (err) {
      setAviso({ texto: err instanceof Error ? err.message : 'No se pudo enviar', error: true });
    } finally {
      setEnviando(false);
    }
  };

  const campo = 'w-full rounded-lg border border-white/10 bg-[#0b0f14] px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400';

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0b0f14] px-4 py-10">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#111827]/80 p-9 shadow-2xl backdrop-blur">
        <h1 className="text-center text-3xl font-bold text-cyan-300">Zirkel P</h1>
        <p className="mt-1 text-center text-sm text-slate-400">Presentaciones en un espacio 3D</p>

        {aviso && (
          <p className={`mt-6 rounded-lg px-4 py-3 text-sm ${aviso.error ? 'bg-red-500/10 text-red-300' : 'bg-emerald-500/10 text-emerald-300'}`}>
            {aviso.texto}
          </p>
        )}

        {!mostrarForm ? (
          <>
            <p className="mt-6 text-sm leading-relaxed text-slate-400">
              Entrá y armá tu propia presentación: cargás tus imágenes y videos en las
              paredes de las salas y las recorrés en 3D. Lo que armes se guarda en tu
              computadora.
            </p>
            <button
              onClick={entrar}
              disabled={enviando}
              className="mt-6 w-full rounded-lg bg-cyan-500 px-6 py-3 font-semibold text-[#04121a] transition hover:bg-cyan-400 disabled:opacity-60"
            >
              Entrar
            </button>

            <div className="mt-8 border-t border-white/10 pt-6">
              <p className="text-sm leading-relaxed text-slate-400">
                ¿Sos docente? La presentación del congreso está reservada. Pedí acceso y
                un administrador lo habilita.
              </p>
              <button
                onClick={() => { setMostrarForm(true); setAviso(null); }}
                className="mt-4 w-full rounded-lg border border-cyan-400/40 px-6 py-2.5 text-sm font-semibold text-cyan-300 transition hover:bg-cyan-400/10"
              >
                Solicitar acceso para docentes
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={solicitar} className="mt-6 flex flex-col gap-3">
            <label className="text-xs text-slate-400">
              Nombre y apellido
              <input
                required value={datos.nombre} className={campo + ' mt-1'}
                onChange={(e) => setDatos({ ...datos, nombre: e.target.value })}
              />
            </label>
            <label className="text-xs text-slate-400">
              Correo
              <input
                required type="email" value={datos.email} className={campo + ' mt-1'}
                onChange={(e) => setDatos({ ...datos, email: e.target.value })}
              />
            </label>
            <label className="text-xs text-slate-400">
              Institución <span className="opacity-60">(opcional)</span>
              <input
                value={datos.institucion} className={campo + ' mt-1'}
                onChange={(e) => setDatos({ ...datos, institucion: e.target.value })}
              />
            </label>
            <label className="text-xs text-slate-400">
              Motivo <span className="opacity-60">(opcional)</span>
              <textarea
                rows={3} value={datos.mensaje} className={campo + ' mt-1 resize-none'}
                onChange={(e) => setDatos({ ...datos, mensaje: e.target.value })}
              />
            </label>
            <div className="mt-2 flex gap-2">
              <button
                type="button" onClick={() => setMostrarForm(false)}
                className="flex-1 rounded-lg border border-white/10 px-4 py-2.5 text-sm text-slate-300 transition hover:bg-white/5"
              >
                Volver
              </button>
              <button
                type="submit" disabled={enviando}
                className="flex-1 rounded-lg bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-[#04121a] transition hover:bg-cyan-400 disabled:opacity-60"
              >
                {enviando ? 'Enviando…' : 'Enviar pedido'}
              </button>
            </div>
          </form>
        )}

        <p className="mt-8 text-center text-xs text-slate-500">
          Administradores: se entra desde{' '}
          <a href="https://zirkeldep.com/" className="text-slate-400 underline hover:text-cyan-300">
            zirkeldep.com
          </a>
        </p>
      </div>
    </div>
  );
}
