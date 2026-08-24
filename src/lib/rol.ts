// ── Quién está usando la app ────────────────────────────────────────────────
// ZirkelP es de uso público: cualquiera entra y arma su propia presentación.
// Lo que NO es público es el material del congreso, que solo ven los
// administradores y los docentes habilitados desde el panel de zirkeldep.
//
// El rol viaja en dos cookies distintas y eso es a propósito:
//   · `zirkel_gate` es httpOnly y firmada — es la que manda de verdad, y la
//     valida el middleware en el servidor.
//   · `zirkel_rol` es legible por el navegador y sirve SOLO para dibujar la
//     interfaz (qué botones mostrar). Si alguien la edita a mano se le van a
//     ver botones que no funcionan: el material sigue bloqueado en el servidor.

export type Rol = 'admin' | 'docente' | 'publico';

export const COOKIE_ROL = 'zirkel_rol';

/** Los que ven el material del congreso y pueden guardar en el servidor. */
export const esDeLaCasa = (rol: Rol): boolean => rol === 'admin' || rol === 'docente';

/** Lee el rol en el navegador. Fuera del navegador asume público, que es lo prudente. */
export function rolActual(): Rol {
  if (typeof document === 'undefined') return 'publico';
  const par = document.cookie.split('; ').find((c) => c.startsWith(COOKIE_ROL + '='));
  const valor = par ? decodeURIComponent(par.slice(COOKIE_ROL.length + 1)) : '';
  return valor === 'admin' || valor === 'docente' ? valor : 'publico';
}
