import { NextResponse } from 'next/server';
import { vetoSiNoEsAdmin } from '@/lib/admin';
import { borrarClave, estadoClave, guardarClave } from '@/lib/clave-ia';

export const dynamic = 'force-dynamic';

// ── La clave de Anthropic: ponerla, ver si está, sacarla ────────────────────
// Las tres operaciones son de administrador. El GET no devuelve la clave nunca,
// ni siquiera al admin: devuelve si hay una y sus últimos cuatro caracteres,
// que es lo único que hace falta para saber cuál está puesta.

export async function GET() {
  const veto = await vetoSiNoEsAdmin();
  if (veto) return veto;
  return NextResponse.json(await estadoClave());
}

export async function POST(request: Request) {
  const veto = await vetoSiNoEsAdmin();
  if (veto) return veto;

  let clave = '';
  try {
    clave = String(((await request.json()) || {}).clave || '').trim();
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }

  // Se comprueba la forma antes de gastar una llamada: las claves de Anthropic
  // empiezan con sk-ant-. Que empiece bien no garantiza que sirva, pero
  // descarta el error más común, que es pegar cualquier otra cosa.
  if (!clave.startsWith('sk-ant-') || clave.length < 30) {
    return NextResponse.json(
      { error: 'No parece una clave de Anthropic: tienen que empezar con «sk-ant-».' },
      { status: 400 }
    );
  }

  if (!(await guardarClave(clave))) {
    return NextResponse.json(
      { error: 'No se pudo guardar: falta la configuración de Supabase en el servidor.' },
      { status: 500 }
    );
  }
  return NextResponse.json(await estadoClave());
}

export async function DELETE() {
  const veto = await vetoSiNoEsAdmin();
  if (veto) return veto;
  await borrarClave();
  return NextResponse.json(await estadoClave());
}
