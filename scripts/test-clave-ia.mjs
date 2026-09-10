/**
 * El cifrado de la clave de Anthropic, sin tocar Supabase.
 *
 * Se replica exactamente lo que hace src/lib/clave-ia.ts: derivar AES-256 del
 * secreto por SHA-256, cifrar con AES-GCM y un IV de 12 bytes al azar, y volver.
 * Lo que se comprueba es lo que importa: que vuelva igual, que dos cifrados de
 * la misma clave NO sean iguales (si lo fueran, el IV no estaría entrando), y
 * que con otro secreto no se pueda abrir.
 *
 *   node scripts/test-clave-ia.mjs
 */
const POR_OMISION = 'zirkel-porton-2026';

async function claveAes(secreto) {
  const material = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secreto));
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
const aB64 = (b) => Buffer.from(new Uint8Array(b)).toString('base64');
const deB64 = (s) => Uint8Array.from(Buffer.from(s, 'base64'));

async function cifrar(clave, secreto) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const dato = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await claveAes(secreto),
    new TextEncoder().encode(clave));
  return { iv: aB64(iv.buffer), dato: aB64(dato), cola: clave.slice(-4) };
}
async function descifrar(g, secreto) {
  const abierta = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(g.iv) },
    await claveAes(secreto), deB64(g.dato));
  return new TextDecoder().decode(abierta);
}

let fallos = 0;
const ok = (c, q) => { console.log((c ? '  OK     ' : '  FALLA  ') + q); if (!c) fallos++; };

const CLAVE = 'sk-ant-api03-' + 'x'.repeat(80) + 'AB12';
const SECRETO = 'un-secreto-de-verdad-largo-y-propio';

console.log('1) Ida y vuelta');
const g = await cifrar(CLAVE, SECRETO);
ok((await descifrar(g, SECRETO)) === CLAVE, 'la clave vuelve idéntica');
ok(!JSON.stringify(g).includes(CLAVE), 'lo guardado no contiene la clave en claro');
ok(g.cola === 'AB12', 'guarda los últimos cuatro para reconocerla: ' + g.cola);
ok(!g.dato.includes('sk-ant'), 'el cifrado no deja ver el prefijo');

console.log('\n2) El IV entra de verdad');
const g2 = await cifrar(CLAVE, SECRETO);
ok(g.dato !== g2.dato, 'cifrar dos veces la misma clave da resultados distintos');
ok(g.iv !== g2.iv, 'y cada uno con su IV');

console.log('\n3) Con otro secreto no se abre');
let abrio = false;
try { await descifrar(g, 'otro-secreto'); abrio = true; } catch { /* esperado */ }
ok(!abrio, 'cambiar el secreto deja la clave ilegible (hay que volver a pegarla)');

console.log('\n4) El secreto por omisión se detecta');
const debil = (s) => (s || POR_OMISION) === POR_OMISION;
ok(debil(undefined), 'sin variable de entorno se marca como débil');
ok(!debil(SECRETO), 'con un secreto propio, no');

console.log(fallos ? '\n' + fallos + ' FALLO(S)' : '\nTodo bien');
process.exit(fallos ? 1 : 0);
