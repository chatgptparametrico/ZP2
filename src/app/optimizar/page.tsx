import { notFound } from 'next/navigation';
import { esAdmin } from '@/lib/admin';
import PanelOptimizar from '@/components/PanelOptimizar';

export const dynamic = 'force-dynamic';

// ── /optimizar — el panel de material ───────────────────────────────────────
// Sólo administradores. A los demás se les devuelve 404 y no 403: un 403
// confirma que la página existe, y no hace falta contarlo. El middleware ya
// corta antes; esto es la segunda cerradura, por si algún día cambia el
// matcher y esta ruta queda afuera sin que nadie lo note.

export default async function Pagina() {
  if (!(await esAdmin())) notFound();
  return <PanelOptimizar />;
}
