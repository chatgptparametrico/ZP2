from PIL import Image, ImageDraw, ImageFilter
import numpy as np, math

S = 2048
LOGO = Image.open(r'C:\xampp\htdocs\zp2-real\public\zirkel\zirkel-logo.png').convert('RGBA')
CYAN = (79, 216, 232)

def ruido_fractal(n, octavas=6, semilla=7):
    rng = np.random.default_rng(semilla)
    acum = np.zeros((n, n), np.float32); amp = 1.0; tot = 0.0
    for o in range(octavas):
        lado = max(2, 2 ** (o + 2))
        base = rng.random((lado, lado)).astype(np.float32)
        capa = np.asarray(Image.fromarray((base * 255).astype(np.uint8)).resize((n, n), Image.BICUBIC), np.float32) / 255
        acum += capa * amp; tot += amp; amp *= 0.5
    return acum / tot

# ── PISO ──────────────────────────────────────────────────────────────────────
def piso():
    y, x = np.mgrid[0:S, 0:S].astype(np.float32)
    cx = cy = S / 2
    r = np.sqrt((x - cx) ** 2 + (y - cy) ** 2) / (S / 2)
    base = np.zeros((S, S, 3), np.float32)
    base[..., 0] = 11 + 10 * np.clip(1 - r, 0, 1)      # casi negro, apenas azulado al centro
    base[..., 1] = 15 + 16 * np.clip(1 - r, 0, 1)
    base[..., 2] = 20 + 24 * np.clip(1 - r, 0, 1)
    im = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8))

    # Transportador: anillos concéntricos + marcas cada 5°, más largas cada 45°.
    cap = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(cap)
    for rad, op, gr in [(0.30, 45, 2), (0.46, 70, 3), (0.62, 45, 2), (0.78, 26, 2)]:
        R = rad * S / 2
        d.ellipse([cx - R, cy - R, cx + R, cy + R], outline=CYAN + (op,), width=gr)
    for a in range(0, 360, 5):
        largo = 0.055 if a % 45 else 0.10
        op = 90 if a % 45 == 0 else 40
        r0, r1 = 0.46 * S / 2, (0.46 + largo) * S / 2
        t = math.radians(a)
        d.line([cx + r0 * math.cos(t), cy + r0 * math.sin(t),
                cx + r1 * math.cos(t), cy + r1 * math.sin(t)], fill=CYAN + (op,), width=3)
    cap = cap.filter(ImageFilter.GaussianBlur(0.6))
    im = Image.alpha_composite(im.convert('RGBA'), cap)

    # Un logo por borde, girado para que se lea desde la pared que estás mirando.
    ancho = round(S * 0.40)
    lg = LOGO.resize((ancho, max(1, round(LOGO.height * ancho / LOGO.width))), Image.LANCZOS)
    margen = round(S * 0.045)
    # El plano del piso va rotado -90° en X, así que el ARRIBA de la textura (borde
    # superior de la imagen) apunta al fondo de la sala. Parado en el centro y
    # mirando una pared, el logo de ese borde tiene que tener su "arriba" hacia la
    # pared, o sea alejándose de vos: por eso el borde superior va derecho y el
    # inferior girado 180°, y no al revés.
    for giro in (0, 90, 180, 270):
        l = lg.rotate(giro, expand=True, resample=Image.BICUBIC)
        if giro == 0:     pos = ((S - l.width) // 2, margen)                 # borde de arriba = fondo
        elif giro == 180: pos = ((S - l.width) // 2, S - margen - l.height)  # borde de abajo = a tus espaldas
        elif giro == 90:  pos = (margen, (S - l.height) // 2)                # borde izquierdo
        else:             pos = (S - margen - l.width, (S - l.height) // 2)  # borde derecho
        im.alpha_composite(l, pos)
    return im.convert('RGB')

# ── TECHO: lucarna ────────────────────────────────────────────────────────────
def techo():
    y, x = np.mgrid[0:S, 0:S].astype(np.float32)
    # Cielo: degradé cenital + nubes fractales + un sol tenue fuera de eje.
    v = y / S
    cielo = np.zeros((S, S, 3), np.float32)
    cielo[..., 0] = 26 + 150 * v ** 1.6
    cielo[..., 1] = 78 + 130 * v ** 1.3
    cielo[..., 2] = 160 + 70 * v ** 0.8
    n = ruido_fractal(S, 6, 11)
    nubes = np.clip((n - 0.52) * 3.4, 0, 1) ** 1.25
    nubes *= np.clip(0.35 + 0.9 * v, 0, 1)
    for c, val in enumerate((252, 250, 248)):
        cielo[..., c] = cielo[..., c] * (1 - nubes) + val * nubes
    sx, sy = S * 0.34, S * 0.30
    dsol = np.sqrt((x - sx) ** 2 + (y - sy) ** 2) / S
    halo = np.clip(1 - dsol / 0.42, 0, 1) ** 2.4
    for c, val in enumerate((255, 246, 214)):
        cielo[..., c] = cielo[..., c] * (1 - halo * 0.75) + val * halo * 0.75
    cielo_im = Image.fromarray(np.clip(cielo, 0, 255).astype(np.uint8))

    # Losa oscura con la abertura octogonal calada.
    losa = Image.new('RGB', (S, S), (12, 15, 20))
    cx = cy = S / 2
    R = S * 0.335
    oct_pts = [(cx + R * math.cos(math.radians(a + 22.5)), cy + R * math.sin(math.radians(a + 22.5)))
               for a in range(0, 360, 45)]
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).polygon(oct_pts, fill=255)

    # Derrame de luz: la abertura ilumina la losa alrededor.
    resp = mask.filter(ImageFilter.GaussianBlur(S * 0.055))
    arr = np.asarray(losa, np.float32) + np.asarray(resp, np.float32)[..., None] * np.array([0.30, 0.36, 0.44])
    losa = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))

    im = Image.composite(cielo_im, losa, mask)

    # Carpintería: marco del octógono + parteluces radiales y un anillo interior.
    d = ImageDraw.Draw(im)
    d.polygon(oct_pts, outline=(232, 236, 240), width=round(S * 0.011))
    for i in range(8):
        a = math.radians(i * 45 + 22.5)
        d.line([cx, cy, cx + R * math.cos(a), cy + R * math.sin(a)], fill=(225, 230, 236), width=round(S * 0.006))
    r2 = R * 0.5
    d.ellipse([cx - r2, cy - r2, cx + r2, cy + r2], outline=(225, 230, 236), width=round(S * 0.006))
    d.ellipse([cx - S * 0.028, cy - S * 0.028, cx + S * 0.028, cy + S * 0.028], fill=(238, 242, 246))
    return im
