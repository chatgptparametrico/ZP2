import { cookies } from 'next/headers';
import { COOKIE_PORTON, rolDelToken, type Rol } from '@/lib/gate';

// ── Quién puede entrar al panel de optimización ─────────────────────────────
// El panel gasta crédito de una API paga y toca el material del congreso, así
// que no alcanza con ser «de la casa»: es sólo para administradores. Los
// docentes ven el material pero no administran nada.
//
// Se comprueba SIEMPRE en el servidor, leyendo la cookie firmada. La cookie
// `zirkel_rol` que lee el navegador sirve para dibujar botones y nada más: si
// alguien la edita se le va a ver el enlace y le va a dar 403 igual.

/** El rol de quien hace esta petición, según la cookie firmada. */
export async function rolDeLaPeticion(): Promise<Rol | null> {
  const bolsa = await cookies();
  return rolDelToken(bolsa.get(COOKIE_PORTON)?.value);
}

export async function esAdmin(): Promise<boolean> {
  return (await rolDeLaPeticion()) === 'admin';
}

/**
 * Para las rutas de API: devuelve una respuesta 403 si no es admin, o null si
 * puede seguir. Se usa como primera línea de cada handler.
 *
 *   const veto = await vetoSiNoEsAdmin();
 *   if (veto) return veto;
 */
export async function vetoSiNoEsAdmin(): Promise<Response | null> {
  if (await esAdmin()) return null;
  // Sin detalle: a quien no le corresponde no se le cuenta qué hay del otro
  // lado ni por qué se le negó.
  return new Response(JSON.stringify({ error: 'No autorizado' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}
