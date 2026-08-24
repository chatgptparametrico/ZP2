import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PANEL = process.env.ZIRKEL_GATE_API || 'https://zirkeldep.com/api_simulator_states.php';

// El pedido de acceso docente lo recibe y guarda zirkeldep, que es donde vive el
// padrón y desde donde se manda el mail a los administradores. Esta ruta existe
// para no exponer el panel al navegador ni pelear con CORS: reenvía y ya.
export async function POST(request: Request) {
  try {
    const datos = await request.json();
    const r = await fetch(`${PANEL}?action=zp_solicitar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'zp_solicitar',
        nombre: String(datos?.nombre || '').slice(0, 120),
        email: String(datos?.email || '').slice(0, 160),
        institucion: String(datos?.institucion || '').slice(0, 160),
        mensaje: String(datos?.mensaje || '').slice(0, 500),
      }),
      cache: 'no-store',
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d?.success !== true) {
      return NextResponse.json({ ok: false, error: d?.error || 'No se pudo enviar el pedido' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, yaAprobado: d?.yaAprobado === true, avisado: d?.avisado === true });
  } catch {
    return NextResponse.json({ ok: false, error: 'No se pudo contactar al servidor' }, { status: 502 });
  }
}
