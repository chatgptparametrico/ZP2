import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { COOKIE_PORTON, HORAS_VALIDEZ, emitirToken, estadoPorton, ticketValido, tokenValido } from '@/lib/gate';

// Acceso unificado: no hay contraseña propia. Se entra desde zirkeldep.com, que
// solo le da ticket a los administradores; el resto ve la pantalla de acceso
// restringido. Corre en el server (Edge), así que no se puede saltear desde el
// navegador.
export async function middleware(request: NextRequest) {
  // Desactivado desde el panel: pasa todo el mundo.
  if (!(await estadoPorton()).activo) return NextResponse.next();

  // Ya tiene la cookie de esta app.
  if (await tokenValido(request.cookies.get(COOKIE_PORTON)?.value)) return NextResponse.next();

  // Llegó con ticket de zirkeldep: se canjea por la cookie.
  const ticket = request.nextUrl.searchParams.get('t');
  if (ticket && (await ticketValido(ticket))) {
    const limpia = request.nextUrl.clone();
    limpia.searchParams.delete('t');   // que no quede en el historial ni al copiar el enlace
    const respuesta = NextResponse.redirect(limpia);
    respuesta.cookies.set(COOKIE_PORTON, await emitirToken(), {
      httpOnly: true,
      // 'none' en producción: la app puede abrirse embebida desde zirkeldep.
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: HORAS_VALIDEZ * 3600,
    });
    return respuesta;
  }

  // Sin cookie ni ticket: pantalla de acceso restringido, sin pedir nada.
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|login|favicon.ico).*)'],
};
