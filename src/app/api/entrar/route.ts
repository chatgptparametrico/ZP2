import { NextResponse } from 'next/server';
import { COOKIE_PORTON, HORAS_VALIDEZ, emitirToken } from '@/lib/gate';
import { COOKIE_ROL } from '@/lib/rol';

export const dynamic = 'force-dynamic';

// Entrar como visitante. No pide nada: la app es de uso público y esto solo
// abre la sesión con rol 'publico', que es la que después mira el middleware
// para negarle el material del congreso. La cookie va firmada igual que las de
// admin y docente, así que nadie se asciende de rol editándola.
export async function POST() {
  const respuesta = NextResponse.json({ ok: true, rol: 'publico' });
  const produccion = process.env.NODE_ENV === 'production';
  respuesta.cookies.set(COOKIE_PORTON, await emitirToken('publico'), {
    httpOnly: true,
    sameSite: produccion ? 'none' : 'lax',
    secure: produccion,
    path: '/',
    maxAge: HORAS_VALIDEZ * 3600,
  });
  respuesta.cookies.set(COOKIE_ROL, 'publico', {
    httpOnly: false,
    sameSite: produccion ? 'none' : 'lax',
    secure: produccion,
    path: '/',
    maxAge: HORAS_VALIDEZ * 3600,
  });
  return respuesta;
}
