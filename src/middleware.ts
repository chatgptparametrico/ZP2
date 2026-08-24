import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  COOKIE_PORTON, HORAS_VALIDEZ, emitirToken, estadoPorton, rolDelTicket, rolDelToken,
  type Rol,
} from '@/lib/gate';
import { COOKIE_ROL } from '@/lib/rol';

// ── Quién entra y qué ve ────────────────────────────────────────────────────
// La app es de uso público: cualquiera pasa y arma su propia presentación. Lo
// que se protege es el MATERIAL del congreso, que vive en /presentacion-rev3.
//   · admin   — llega con ticket desde zirkeldep.com
//   · docente — llega con su enlace personal, habilitado desde el panel
//   · publico — todos los demás; ven la app vacía
// Esto corre en el servidor (Edge), así que el bloqueo del material no se puede
// saltear tocando cookies desde el navegador: la cookie de sesión va firmada.

const MATERIAL_RESERVADO = '/presentacion-rev3';

/** Cookie de sesión (firmada) + cookie de rol (legible, solo para la interfaz). */
function sellar(respuesta: NextResponse, token: string, rol: Rol) {
  const produccion = process.env.NODE_ENV === 'production';
  respuesta.cookies.set(COOKIE_PORTON, token, {
    httpOnly: true,
    // 'none' en producción: la app puede abrirse embebida desde zirkeldep.
    sameSite: produccion ? 'none' : 'lax',
    secure: produccion,
    path: '/',
    maxAge: HORAS_VALIDEZ * 3600,
  });
  respuesta.cookies.set(COOKIE_ROL, rol, {
    httpOnly: false,
    sameSite: produccion ? 'none' : 'lax',
    secure: produccion,
    path: '/',
    maxAge: HORAS_VALIDEZ * 3600,
  });
  return respuesta;
}

export async function middleware(request: NextRequest) {
  // Desactivado desde el panel: pasa todo el mundo, con acceso completo.
  if (!(await estadoPorton()).activo) return NextResponse.next();

  const pideMaterial = request.nextUrl.pathname.startsWith(MATERIAL_RESERVADO);

  // Llegó con ticket: admin desde zirkeldep, o docente con su enlace personal.
  const ticket = request.nextUrl.searchParams.get('t');
  if (ticket) {
    const rolTicket = await rolDelTicket(ticket);
    if (rolTicket) {
      const limpia = request.nextUrl.clone();
      limpia.searchParams.delete('t');   // que no quede en el historial ni al copiar el enlace
      return sellar(NextResponse.redirect(limpia), await emitirToken(rolTicket), rolTicket);
    }
  }

  const rol = await rolDelToken(request.cookies.get(COOKIE_PORTON)?.value);

  // Ya tiene sesión: pasa. El material, solo si es de la casa.
  if (rol) {
    if (pideMaterial && rol === 'publico') return new NextResponse(null, { status: 404 });
    return NextResponse.next();
  }

  // Sin sesión: el material ni se asoma.
  if (pideMaterial) return new NextResponse(null, { status: 404 });

  // Primera visita: la portada cuenta de qué se trata, deja entrar a mirar y
  // ofrece pedir acceso docente. No pide nada para pasar.
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  return NextResponse.rewrite(url);
}

export const config = {
  // 'entrar' y 'solicitar-acceso' quedan afuera a propósito: son las dos puertas
  // de la portada. Si pasaran por acá se bloquearían a sí mismas, porque quien
  // las llama todavía no tiene sesión.
  matcher: ['/((?!_next/static|_next/image|login|api/entrar|api/solicitar-acceso|favicon.ico).*)'],
};
