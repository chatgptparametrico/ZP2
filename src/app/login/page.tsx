// Pantalla de acceso restringido. No pide nada: el acceso lo maneja
// zirkeldep.com y solo entran los administradores, con un ticket firmado que se
// canjea solo al abrir el enlace desde allá.
export default function AccesoRestringido() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0b0f14] px-4 text-center">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#111827]/80 p-9 shadow-2xl backdrop-blur">
        <h1 className="text-3xl font-bold text-cyan-300">Zirkel</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          Esta aplicación es de uso interno. Se entra desde{' '}
          <strong className="text-slate-200">zirkeldep.com</strong>, con una cuenta de
          administrador: no hace falta ninguna contraseña adicional.
        </p>
        <a
          href="https://zirkeldep.com/"
          className="mt-7 inline-block rounded-lg bg-cyan-500 px-6 py-2.5 font-semibold text-[#04121a] transition hover:bg-cyan-400"
        >
          Ir a zirkeldep.com
        </a>
      </div>
    </div>
  );
}
