'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { usePresentationStore, crearSalasIniciales, crearSalasVacias } from '@/lib/presentation-store';

// ── Control de reproducción de los videos ───────────────────────────────────
// Cada cara con video crea su propio elemento <video> para la textura. Si todos
// se reproducen a la vez (una sala puede tener varios) el decodificado satura la
// máquina y en una notebook con proyector se traba. Acá se lleva un registro y
// SOLO suena el de la lámina que se está viendo; el resto queda pausado en su
// primer cuadro (la textura igual se ve, three.js toma el fotograma actual).
type VideoDeTextura = { url: string; el: HTMLVideoElement };
const videosDeTexturas: VideoDeTextura[] = [];
const TOPE_VIDEOS_REGISTRADOS = 80;   // cota: cada rearmado de la escena crea nuevos

// URL del video que debe estar sonando. Es una variable de módulo porque los
// <video> se crean de a poco, después del efecto que decide cuál va: cada uno
// consulta esto al nacer para arrancar solo si le toca.
let urlVideoActivo = '';

// Reproduce con sonido. Si el navegador lo bloquea (política de autoplay: hace
// falta una interacción previa del usuario), reintenta en mudo: mejor que suene
// nada antes que no se vea el video.
const reproducirConAudio = (el: HTMLVideoElement) => {
  el.muted = false;
  const promesa = el.play();
  if (promesa && typeof promesa.catch === 'function') {
    promesa.catch(() => {
      el.muted = true;
      el.play().catch(() => { /* ni así: queda en su primer cuadro */ });
    });
  }
};

const sincronizarVideos = (activa: string, precargar: string[] = []) => {
  urlVideoActivo = activa || '';
  for (const { url, el } of videosDeTexturas) {
    if (url === urlVideoActivo) {
      // Sólo suena la lámina que se está viendo.
      if (el.paused) reproducirConAudio(el);
      else if (el.muted) el.muted = false;   // ya venía en mudo: se le da sonido
    } else {
      if (!el.paused) el.pause();
      el.muted = true;
      // Las vecinas se descargan igual para que el cambio de lámina sea
      // inmediato: bajar el archivo es barato, decodificarlo es lo que pesa.
      if (precargar.includes(url) && el.preload !== 'auto') el.preload = 'auto';
    }
  }
};

// Cielo nocturno animado: estrellas que titilan y fugaces que cruzan dejando
// estela. Va como objetos 3D y no dibujado en el fondo, porque el fondo es una
// textura estática y redibujarla en cada cuadro (2048x1024) sería carísimo.
const crearCieloAnimado = (): THREE.Group => {
  const grupo = new THREE.Group();
  grupo.name = 'cieloAnimado';

  // ── Estrellas ──
  const cantidad = 700;
  const posiciones = new Float32Array(cantidad * 3);
  const fases = new Float32Array(cantidad);
  const tamanios = new Float32Array(cantidad);
  for (let i = 0; i < cantidad; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random());      // hemisferio de arriba
    const radio = 380;
    posiciones[i * 3] = radio * Math.sin(phi) * Math.cos(theta);
    posiciones[i * 3 + 1] = radio * Math.cos(phi) * 0.85 + 12;
    posiciones[i * 3 + 2] = radio * Math.sin(phi) * Math.sin(theta);
    fases[i] = Math.random() * Math.PI * 2;    // cada una titila a su tiempo
    tamanios[i] = 1.5 + Math.random() * 3.5;
  }
  const geoEstrellas = new THREE.BufferGeometry();
  geoEstrellas.setAttribute('position', new THREE.Float32BufferAttribute(posiciones, 3));
  geoEstrellas.setAttribute('fase', new THREE.Float32BufferAttribute(fases, 1));
  geoEstrellas.setAttribute('tam', new THREE.Float32BufferAttribute(tamanios, 1));
  const matEstrellas = new THREE.ShaderMaterial({
    uniforms: { tiempo: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float fase;
      attribute float tam;
      uniform float tiempo;
      varying float vAlfa;
      void main() {
        vAlfa = 0.30 + 0.70 * (0.5 + 0.5 * sin(tiempo * 1.7 + fase));
        gl_PointSize = tam;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying float vAlfa;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        gl_FragColor = vec4(vec3(1.0), vAlfa * smoothstep(0.5, 0.0, d));
      }`,
  });
  grupo.add(new THREE.Points(geoEstrellas, matEstrellas));
  grupo.userData.matEstrellas = matEstrellas;

  // ── Fugaces ── el objeto mira hacia -Z, así que la estela va hacia +Z.
  const fugaces: THREE.Line[] = [];
  for (let i = 0; i < 3; i++) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 26),
    ]);
    const mat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      fog: false,
      blending: THREE.AdditiveBlending,
    });
    const linea = new THREE.Line(geo, mat);
    linea.userData = { activa: false, espera: 2 + Math.random() * 8, vida: 0, dir: new THREE.Vector3() };
    fugaces.push(linea);
    grupo.add(linea);
  }
  grupo.userData.fugaces = fugaces;
  return grupo;
};

// Avanza la animación del cielo. dt en segundos.
const animarCielo = (grupo: THREE.Group, tiempo: number, dt: number) => {
  const mat = grupo.userData.matEstrellas as THREE.ShaderMaterial | undefined;
  if (mat) mat.uniforms.tiempo.value = tiempo;

  const fugaces = (grupo.userData.fugaces || []) as THREE.Line[];
  for (const f of fugaces) {
    const d = f.userData;
    if (!d.activa) {
      d.espera -= dt;
      if (d.espera <= 0) {
        const ang = Math.random() * Math.PI * 2;
        f.position.set(Math.cos(ang) * 280, 130 + Math.random() * 130, Math.sin(ang) * 280);
        d.dir.set(-Math.cos(ang) * 0.7 + (Math.random() - 0.5) * 0.6, -0.45 - Math.random() * 0.35, -Math.sin(ang) * 0.7)
          .normalize()
          .multiplyScalar(150);          // unidades por segundo
        f.lookAt(f.position.clone().add(d.dir));
        d.vida = 0;
        d.activa = true;
      }
      continue;
    }
    f.position.addScaledVector(d.dir, dt);
    d.vida += dt;
    const material = f.material as THREE.LineBasicMaterial;
    material.opacity = Math.max(0, Math.sin(Math.min(d.vida / 1.3, 1) * Math.PI));
    if (d.vida > 1.3) {
      d.activa = false;
      d.espera = 3 + Math.random() * 11;
      material.opacity = 0;
    }
  }
};

// Cache de texturas por archivo. La escena se rearma entera en CADA cambio de
// lámina; sin esto cada rearmado subía otra copia de la misma imagen a la GPU y
// la anterior quedaba colgada (nunca se liberaba). Ahí estaba el "arranca bien y
// después se va poniendo lento": a las 15 láminas había ~90 texturas de 720p
// vivas. Con el cache hay UNA textura por archivo y los rearmados salen gratis.
const texturasPorUrl = new Map<string, THREE.Texture>();

// Libera un grupo que se saca de la escena: geometrías y materiales, que sí son
// nuevos en cada rearmado. Las texturas NO se tocan, viven en el cache y se
// reutilizan; liberarlas obligaría a volver a decodificar cada archivo.
const liberarGrupo = (raiz: THREE.Object3D) => {
  raiz.traverse((obj) => {
    const malla = obj as THREE.Mesh;
    if (malla.geometry) malla.geometry.dispose();
    const material = malla.material;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else if (material) (material as THREE.Material).dispose();
  });
};

const loadMediaAsTexture = (url: string, onLoad: (texture: THREE.Texture) => void) => {
  if (!url) return;
  const enCache = texturasPorUrl.get(url);
  if (enCache) { onLoad(enCache); return; }
  const isVideo = url.startsWith('data:video/') || url.endsWith('.mp4');
  if (isVideo) {
    // Un mismo archivo aparece en varias mallas (cara interior, exterior, la
    // vista de galería). Se reutiliza UN elemento por archivo: varias
    // VideoTextures pueden compartirlo y así se decodifica una sola vez, en vez
    // de abrir cinco decodificadores del mismo video.
    let video = videosDeTexturas.find((v) => v.url === url)?.el;
    if (!video) {
      video = document.createElement('video');
      video.src = url;
      video.crossOrigin = 'anonymous';
      video.loop = true;
      // Nace en mudo: hace falta para poder cargar el primer cuadro sin que el
      // navegador bloquee nada. Si le toca ser la lámina activa, se le da sonido.
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      // Nace pausado: arranca solo si es la lámina activa. Sin el load() la
      // textura no tendría ningún cuadro y la cara se vería negra.
      video.load();
      if (url === urlVideoActivo) {
        reproducirConAudio(video);
      }
      if (videosDeTexturas.length >= TOPE_VIDEOS_REGISTRADOS) {
        const viejo = videosDeTexturas.shift();
        if (viejo && !viejo.el.paused) viejo.el.pause();
      }
      videosDeTexturas.push({ url, el: video });
    }
    const texture = new THREE.VideoTexture(video);
    texturasPorUrl.set(url, texture);
    onLoad(texture);
  } else {
    new THREE.TextureLoader().load(url, (texture) => {
      texturasPorUrl.set(url, texture);
      onLoad(texture);
    });
  }
};

// Miniaturas del panel de edición. NO se reproducen: son previsualizaciones, y
// con una presentación de varios videos todas sonando a la vez el decodificado
// satura la máquina (era la causa real de que se trabara, no las texturas).
// Se muestra un cuadro fijo: sin el salto a currentTime la miniatura sale negra.
const MediaPreview = ({ src, alt, className }: { src: string; alt?: string; className?: string }) => {
  const isVideo = src?.startsWith('data:video/') || src?.endsWith('.mp4');
  if (isVideo) {
    return (
      <video
        src={src}
        className={className}
        loop
        muted
        playsInline
        preload="metadata"
        ref={(el) => { if (el && el.currentTime === 0) el.currentTime = 0.1; }}
      />
    );
  }
  return <img src={src} alt={alt || 'Media'} className={className} />;
};


// A donde vuelve el boton "Volver a Zirkel": a la copia del sitio desde la que
// se abrio la app. Entrando desde /gitnew120/ tiene que devolver ahi y no a la
// raiz. Orden: parametro ?back= (lo agrega el sitio al abrir la app) → referrer
// → raiz. Se acepta SOLO zirkeldep.com y el espejo: sin ese filtro el boton
// seria un redirector abierto (cualquiera podria pasar ?back=sitio-ajeno).
function resolverUrlDeVuelta(): string {
  const PORDEFECTO = 'https://zirkeldep.com';
  const admitida = (valor: string | null): string | null => {
    if (!valor) return null;
    try {
      const url = new URL(valor);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
      const host = url.hostname.toLowerCase();
      const propio = /(^|\.)zirkeldep\.com$/.test(host) || host === 'zirkeldep-zmc.vercel.app';
      return propio ? url.toString() : null;
    } catch {
      return null;
    }
  };
  const back = new URLSearchParams(window.location.search).get('back');
  return admitida(back) || admitida(document.referrer) || PORDEFECTO;
}

export default function Presentation3D() {
  // Se resuelve despues del montaje: en el prerender de Next no hay window y
  // calcularlo en el render daria un HTML distinto al del cliente (hidratacion).
  const [urlVolver, setUrlVolver] = useState('https://zirkeldep.com');
  useEffect(() => { setUrlVolver(resolverUrlDeVuelta()); }, []);
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const boxesRef = useRef<THREE.Group[]>([]);
  const insideBoxGroupRef = useRef<THREE.Group | null>(null);
  // Cielo nocturno animado (estrellas que titilan y fugaces). Vive aparte del
  // fondo estático porque necesita actualizarse en cada cuadro.
  const cieloAnimadoRef = useRef<THREE.Group | null>(null);
  const ultimoCuadroRef = useRef<number>(0);
  const cameraTargetRef = useRef(new THREE.Vector3(0, 4, 0));
  const targetCameraPositionRef = useRef(new THREE.Vector3(0, 15, 30));
  const mouseRef = useRef({ x: 0, y: 0, isDown: false });
  const animationFrameRef = useRef<number>(0);
  const insideRotationRef = useRef(0);
  const cameraAngleRef = useRef(0);
  const targetCameraAngleRef = useRef(0);
  const cameraPitchRef = useRef(0); // For floor/ceiling look
  const targetCameraPitchRef = useRef(0);
  const fovRef = useRef(75);
  const targetFovRef = useRef(75);
  const batchInputRef = useRef<HTMLInputElement>(null);
  
  const [showControls, setShowControls] = useState(true);
  // La tecla H cicla por tres niveles de interfaz:
  //   0 · todo visible (editor + navegación)
  //   1 · sin editor: quedan los cubitos de salas, la barra de láminas y las flechas
  //   2 · proyección limpia: sin nada encima de la lámina
  const [nivelUI, setNivelUI] = useState(0);
  const showAllUI = nivelUI === 0;          // el editor y sus paneles
  const mostrarNavegacion = nivelUI < 2;    // cubitos, barra inferior y flechas
  // El bucle de animación no se rearma al cambiar de nivel (sus deps son otras),
  // así que leería un valor viejo: se le pasa por ref.
  const mostrarNavegacionRef = useRef(true);
  useEffect(() => { mostrarNavegacionRef.current = mostrarNavegacion; }, [mostrarNavegacion]);
  const [isDarkMode, setIsDarkMode] = useState(true); // Theme toggle

  // Modals state
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveFilename, setSaveFilename] = useState('');
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [availableBlobs, setAvailableBlobs] = useState<any[]>([]);
  const [isLoadingBlobs, setIsLoadingBlobs] = useState(false);
  // Upload progress
  const [isSaving, setIsSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState({ current: 0, total: 0, label: '' });
  // Download progress
  const [isLoading, setIsLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState({ current: 0, total: 0, label: '' });

  const {
    boxes,
    currentBoxIndex,
    isInsideBox,
    mouseEnabled,
    currentSlideIndex,
    addBox,
    removeBox,
    updateSlide,
    updateFloor,
    updateCeiling,
    setCurrentBox,
    setInsideBox,
    setMouseEnabled,
    setCurrentSlide,
    loadPresentation,
    getExportData,
    addSlide,
    removeSlide,
    removeSlideAt,
    setSlides,
    version,
    incrementVersion
  } = usePresentationStore();

  // Solo suena el video de la lámina que se está viendo. Adentro del cubo es la
  // cara actual; desde la galería, la primera de la sala enfocada (que es la que
  // se ve en el exterior). Las vecinas quedan precargadas para que el cambio no
  // tenga espera.
  useEffect(() => {
    const sala = boxes[currentBoxIndex];
    if (!sala) { sincronizarVideos(''); return; }
    const urlDe = (i: number) => sala.slides[i]?.imageUrl || '';
    if (isInsideBox) {
      const cantidad = sala.slides.length;
      const anterior = urlDe((currentSlideIndex - 1 + cantidad) % cantidad);
      const siguiente = urlDe((currentSlideIndex + 1) % cantidad);
      sincronizarVideos(urlDe(currentSlideIndex), [anterior, siguiente]);
    } else {
      sincronizarVideos(urlDe(0));
    }
  }, [boxes, currentBoxIndex, currentSlideIndex, isInsideBox]);

  // Theme colors - memoized to prevent unnecessary re-renders
  const currentTheme = useMemo(() => {
    const themes = {
      dark: {
        bg: 'bg-black',
        panelBg: 'bg-black/80',
        text: 'text-white',
        textMuted: 'text-gray-400',
        border: 'border-cyan-500/20',
        accent: '#00ffff',
        gradient: 'from-cyan-400 via-purple-400 to-pink-400',
        sceneBg: 0x0a0a0f,
        gridColor: 0x1a1a2e,
      },
      light: {
        bg: 'bg-gradient-to-b from-[#E0F4FF] to-white',
        panelBg: 'bg-white/95',
        text: 'text-gray-800',
        textMuted: 'text-gray-500',
        border: 'border-[#22C55E]/30',
        accent: '#22C55E',
        gradient: 'from-[#22C55E] via-[#16A34A] to-[#4ADE80]',
        sceneBg: 0xE0F4FF,
        gridColor: 0xE0E0E0,
      }
    };
    return isDarkMode ? themes.dark : themes.light;
  }, [isDarkMode]);

  // Create box geometry for bird view
  const createBoxGeometry = useCallback((boxData: { 
    id: string; 
    name: string; 
    slides: { id: string; imageUrl: string; subtitle: string }[]; 
    floorImageUrl: string; 
    ceilingImageUrl: string;
    floorSubtitle: string;
    ceilingSubtitle: string;
  }, index: number) => {
    const group = new THREE.Group();
    group.userData = { boxId: boxData.id, boxIndex: index };
    
    const boxSize = 8;
    const aspect = 4 / 3;
    const wallHeight = boxSize * (2/3);
    const wallWidth = boxSize * aspect;
    
    // texture loader replaced with hook
    const fallbackUrl = '/zirkel/zirkel-logo.png';

    const wallMapping = [
      { pos: [0, wallHeight / 2, wallWidth / 2], rot: [0, 0, 0], offset: 0, name: 'front' },      
      { pos: [wallWidth / 2, wallHeight / 2, 0], rot: [0, -Math.PI / 2, 0], offset: 1, name: 'right' }, 
      { pos: [0, wallHeight / 2, -wallWidth / 2], rot: [0, Math.PI, 0], offset: 2, name: 'back' },    
      { pos: [-wallWidth / 2, wallHeight / 2, 0], rot: [0, Math.PI / 2, 0], offset: 3, name: 'left' },  
    ];

    wallMapping.forEach((wall) => {
      const slide = boxData.slides[wall.offset] || boxData.slides[0];
      const imageUrl = slide?.imageUrl || fallbackUrl;
      
      const outerGeometry = new THREE.PlaneGeometry(wallWidth, wallHeight);
      const outerMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.FrontSide,
        toneMapped: false,
      });
      
      loadMediaAsTexture(imageUrl, (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.toneMapped = false;
        outerMaterial.map = texture;
        outerMaterial.needsUpdate = true;
      });
      
      const outerMesh = new THREE.Mesh(outerGeometry, outerMaterial);
      outerMesh.position.set(wall.pos[0], wall.pos[1], wall.pos[2]);
      outerMesh.rotation.set(wall.rot[0], wall.rot[1], wall.rot[2]);
      outerMesh.userData = { isWall: true, slideIndex: wall.offset, boxId: boxData.id };
      group.add(outerMesh);
      
      const innerGeometry = new THREE.PlaneGeometry(wallWidth, wallHeight);
      // Esta es la cara interior del cubo vista DESDE AFUERA: hay que espejarla
      // para que se lea bien. Se invierte la UV de ESTA geometría y no la
      // textura: las texturas se comparten entre mallas (cache por archivo), así
      // que tocarle repeat/offset espejaba también las paredes de adentro.
      const uvInterior = innerGeometry.attributes.uv;
      for (let i = 0; i < uvInterior.count; i++) {
        uvInterior.setX(i, 1 - uvInterior.getX(i));
      }
      uvInterior.needsUpdate = true;

      const innerMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.FrontSide,
        toneMapped: false,
      });

      loadMediaAsTexture(imageUrl, (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.toneMapped = false;
        innerMaterial.map = texture;
        innerMaterial.needsUpdate = true;
      });
      
      const innerMesh = new THREE.Mesh(innerGeometry, innerMaterial);
      const offset = 0.05;
      const normalDir = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(wall.rot[0], wall.rot[1], wall.rot[2]));
      innerMesh.position.set(
        wall.pos[0] - normalDir.x * offset,
        wall.pos[1],
        wall.pos[2] - normalDir.z * offset
      );
      innerMesh.rotation.set(wall.rot[0], wall.rot[1] + Math.PI, wall.rot[2]);
      group.add(innerMesh);

      const frameGeometry = new THREE.EdgesGeometry(outerGeometry);
      const frameMaterial = new THREE.LineBasicMaterial({ color: parseInt(currentTheme.accent.replace('#', '0x')) });
      const frame = new THREE.LineSegments(frameGeometry, frameMaterial);
      frame.position.copy(outerMesh.position);
      frame.rotation.copy(outerMesh.rotation);
      group.add(frame);
    });

    const floorGeometry = new THREE.PlaneGeometry(wallWidth, wallWidth);
    const floorMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xffffff,
      side: THREE.DoubleSide 
    });
    loadMediaAsTexture(boxData.floorImageUrl || fallbackUrl, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      floorMaterial.map = texture;
      floorMaterial.needsUpdate = true;
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    group.add(floor);
    
    const shadowGeometry = new THREE.PlaneGeometry(wallWidth * 1.2, wallWidth * 1.2);
    const shadowMaterial = new THREE.MeshBasicMaterial({ 
      color: 0x000000,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide 
    });
    const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -0.05;
    shadow.position.x = wallWidth * 0.1;
    shadow.position.z = wallWidth * 0.1;
    group.add(shadow);

    const ceilingGeometry = new THREE.PlaneGeometry(wallWidth, wallWidth);
    const ceilingMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xffffff,
      side: THREE.DoubleSide 
    });
    loadMediaAsTexture(boxData.ceilingImageUrl || fallbackUrl, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      ceilingMaterial.map = texture;
      ceilingMaterial.needsUpdate = true;
    });
    const ceiling = new THREE.Mesh(ceilingGeometry, ceilingMaterial);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = wallHeight;
    group.add(ceiling);

    // Sólo las 12 aristas del cubo. Con `wireframe: true` se dibujaban los
    // triángulos de cada cara, y por eso aparecía una diagonal cruzando cada
    // lado; EdgesGeometry deja únicamente los bordes reales.
    const cajaAristas = new THREE.BoxGeometry(wallWidth, wallHeight, wallWidth);
    const wireframeGeometry = new THREE.EdgesGeometry(cajaAristas);
    cajaAristas.dispose();
    const wireframeMaterial = new THREE.LineBasicMaterial({
      color: parseInt(currentTheme.accent.replace('#', '0x')),
      transparent: true,
      opacity: 0.5,
    });
    const wireframe = new THREE.LineSegments(wireframeGeometry, wireframeMaterial);
    wireframe.position.y = wallHeight / 2;
    group.add(wireframe);

    const pointLight = new THREE.PointLight(0xffffff, 0.8, 30);
    pointLight.position.set(0, wallHeight / 2, 0);
    group.add(pointLight);

    return group;
  }, [isDarkMode, currentTheme.accent, currentSlideIndex, boxes]);

  // Create inside view for a box
  const createInsideView = useCallback((boxData: { 
    id: string; 
    slides: { id: string; imageUrl: string; subtitle: string }[];
    floorImageUrl: string;
    ceilingImageUrl: string;
  }) => {
    const group = new THREE.Group();
    
    const boxSize = 8;
    const aspect = 4 / 3;
    const wallHeight = boxSize * (2/3);
    const wallWidth = boxSize * aspect;
    
    // texture loader replaced with hook
    const fallbackUrl = '/zirkel/zirkel-logo.png';
    const numSlides = boxData.slides.length;

    const wallMapping = [
      { pos: [0, wallHeight / 2, wallWidth / 2], rot: [0, Math.PI, 0], offset: 0, name: 'front' },     
      { pos: [wallWidth / 2, wallHeight / 2, 0], rot: [0, -Math.PI / 2, 0], offset: 1, name: 'right' },
      { pos: [0, wallHeight / 2, -wallWidth / 2], rot: [0, 0, 0], offset: 2, name: 'back' },   
      { pos: [-wallWidth / 2, wallHeight / 2, 0], rot: [0, Math.PI / 2, 0], offset: 3, name: 'left' },
    ];

    wallMapping.forEach((wall) => {
      const baseIndex = currentSlideIndex < numSlides ? currentSlideIndex : 0;
      let slideIdx = -1;
      for (let s = 0; s < numSlides; s++) {
        if (s % 4 === wall.offset) {
          if (slideIdx === -1 || Math.abs(s - baseIndex) < Math.abs(slideIdx - baseIndex)) {
            slideIdx = s;
          }
        }
      }
      if (slideIdx === -1) slideIdx = wall.offset % numSlides;

      const slide = boxData.slides[slideIdx];
      const imageUrl = slide?.imageUrl || fallbackUrl;
      
      const geometry = new THREE.PlaneGeometry(wallWidth, wallHeight);
      const material = new THREE.MeshBasicMaterial({
        side: THREE.DoubleSide,
        toneMapped: false,
        color: slide?.imageUrl ? 0xffffff : 0x222222
      });
      
      loadMediaAsTexture(imageUrl, (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.toneMapped = false;
        texture.needsUpdate = true;
        material.map = texture;
        material.needsUpdate = true;
      });
      
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(wall.pos[0], wall.pos[1], wall.pos[2]);
      mesh.rotation.set(wall.rot[0], wall.rot[1], wall.rot[2]);
      mesh.userData = { isWall: true, slideIndex: slideIdx, boxId: boxData.id, wallName: wall.name };
      group.add(mesh);

      const frameGeometry = new THREE.EdgesGeometry(geometry);
      const frameMaterial = new THREE.LineBasicMaterial({ color: parseInt(currentTheme.accent.replace('#', '0x')), linewidth: 2 });
      const frame = new THREE.LineSegments(frameGeometry, frameMaterial);
      frame.position.copy(mesh.position);
      frame.rotation.copy(mesh.rotation);
      group.add(frame);
    });

    const floorGeometry = new THREE.PlaneGeometry(wallWidth, wallWidth);
    const floorMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xffffff,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    loadMediaAsTexture(boxData.floorImageUrl || fallbackUrl, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.toneMapped = false;
      texture.needsUpdate = true;
      floorMaterial.map = texture;
      floorMaterial.needsUpdate = true;
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.userData = { isFloor: true };
    group.add(floor);

    const ceilingGeometry = new THREE.PlaneGeometry(wallWidth, wallWidth);
    const ceilingMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xffffff,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    loadMediaAsTexture(boxData.ceilingImageUrl || fallbackUrl, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.toneMapped = false;
      texture.needsUpdate = true;
      ceilingMaterial.map = texture;
      ceilingMaterial.needsUpdate = true;
    });
    const ceiling = new THREE.Mesh(ceilingGeometry, ceilingMaterial);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = wallHeight;
    ceiling.userData = { isCeiling: true };
    group.add(ceiling);

    const ambientLight = new THREE.AmbientLight(0xffffff, 1);
    group.add(ambientLight);

    // Barra de avance para las láminas de video: una línea fina al pie de la
    // pared. Es un pivote que se coloca sobre la pared que mira la cámara y una
    // barra hija anclada al borde izquierdo, que crece hacia la derecha. Se
    // actualiza en el bucle de animación; acá sólo se arma.
    const pivoteBarra = new THREE.Group();
    pivoteBarra.name = 'barraProgreso';
    pivoteBarra.visible = false;
    pivoteBarra.userData = {
      paredes: wallMapping.map((w) => ({ pos: [...w.pos], rot: [...w.rot] })),
      ancho: wallWidth,
    };
    const geoBarra = new THREE.PlaneGeometry(1, 1);
    geoBarra.translate(0.5, 0, 0);       // origen en el extremo izquierdo
    const barra = new THREE.Mesh(
      geoBarra,
      new THREE.MeshBasicMaterial({
        color: parseInt(currentTheme.accent.replace('#', '0x')),
        transparent: true,
        opacity: 0.85,
        fog: false,
        depthTest: false,
      })
    );
    barra.position.set(-wallWidth / 2, 0.07, 0);
    barra.scale.set(0.001, 0.05, 1);
    barra.renderOrder = 10;
    pivoteBarra.add(barra);
    group.add(pivoteBarra);

    // Cubitos de navegación: más chicos que antes (0.4) para que no tapen la
    // lámina. El contenedor se reubica en cada cuadro delante de la cámara
    // (ver el bucle de animación), así se ven mirando cualquier pared.
    const miniCubeSize = 0.26;
    const miniCubeGap = 0.62;
    const totalWidth = boxes.length * miniCubeGap;
    const startX = -totalWidth / 2 + miniCubeGap / 2;

    const miniCubesContainer = new THREE.Group();
    miniCubesContainer.name = 'miniCubesContainer';

    boxes.forEach((box, index) => {
      const miniCubeGroup = new THREE.Group();
      const geometry = new THREE.BoxGeometry(miniCubeSize, miniCubeSize, miniCubeSize);
      // texture loader replaced
      const firstSlideUrl = box.slides[0]?.imageUrl || fallbackUrl;
      const cubeMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
      loadMediaAsTexture(firstSlideUrl, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        cubeMaterial.map = tex;
        cubeMaterial.needsUpdate = true;
      });
      const materials = Array(6).fill(cubeMaterial);
      const miniCube = new THREE.Mesh(geometry, materials);
      miniCube.userData = {
        isMiniNavCube: true,
        targetBoxIndex: index,
        boxId: box.id,
        rotationSpeed: 0.015 + Math.random() * 0.01,
        floatOffset: Math.random() * Math.PI * 2,
        // Altura de reposo del flotado. Antes se sumaba el seno a la posición
        // actual en cada cuadro, así que en vez de oscilar la iba corriendo.
        baseY: 0
      };
      miniCubeGroup.add(miniCube);
      // Sin aristas: iban como objeto aparte y la animación sólo gira la malla
      // del cubo, así que quedaba una jaula de líneas quieta alrededor del cubo
      // que giraba adentro.
      // Posición LOCAL dentro del contenedor: una fila centrada. El contenedor
      // es el que se coloca delante de la cámara en cada cuadro.
      miniCubeGroup.position.set(startX + index * miniCubeGap, 0, 0);
      miniCubesContainer.add(miniCubeGroup);
    });
    group.add(miniCubesContainer);

    return group;
  }, [isDarkMode, currentTheme.accent, currentBoxIndex, currentSlideIndex, boxes]);

  const focusOnBox = useCallback((index: number) => {
    const box = boxesRef.current[index];
    if (!box) return;

    targetCameraPositionRef.current.set(
      box.position.x,
      10,
      box.position.z + 20
    );
    cameraTargetRef.current.set(box.position.x, 4, box.position.z);
  }, []);

  const enterBox = useCallback((index: number) => {
    if (!sceneRef.current || !cameraRef.current) return;

    const boxData = boxes[index];
    if (!boxData) return;

    setInsideBox(true);
    setCurrentBox(index);
    setCurrentSlide(0);
    insideRotationRef.current = 0;
    cameraAngleRef.current = 0;
    targetCameraAngleRef.current = 0;
    cameraPitchRef.current = 0;
    targetCameraPitchRef.current = 0;
    fovRef.current = 75;
    targetFovRef.current = 75;

    boxesRef.current.forEach(box => {
      box.visible = false;
    });

    if (insideBoxGroupRef.current) {
      sceneRef.current.remove(insideBoxGroupRef.current);
      liberarGrupo(insideBoxGroupRef.current);
    }
    
    const insideGroup = createInsideView(boxData);
    insideBoxGroupRef.current = insideGroup;
    sceneRef.current.add(insideGroup);

    targetCameraPositionRef.current.set(0, 2.67, 0);
    cameraTargetRef.current.set(0, 2.67, -1);
  }, [boxes, setInsideBox, setCurrentBox, setCurrentSlide, createInsideView]);

  const exitBox = useCallback(() => {
    if (!sceneRef.current) return;

    setInsideBox(false);
    setCurrentSlide(0);

    if (insideBoxGroupRef.current) {
      sceneRef.current.remove(insideBoxGroupRef.current);
      liberarGrupo(insideBoxGroupRef.current);
      insideBoxGroupRef.current = null;
    }

    boxesRef.current.forEach(box => {
      box.visible = true;
    });

    focusOnBox(currentBoxIndex);
  }, [currentBoxIndex, setInsideBox, setCurrentSlide, focusOnBox]);

  // Load latest presentation from local storage on mount
  useEffect(() => {
    let isMounted = true;
    const loadLocal = () => {
      try {
        const localData = localStorage.getItem('zirkel_latest_presentation');
        if (localData && isMounted) {
          const presentationData = JSON.parse(localData);
          loadPresentation(presentationData);
          incrementVersion();
        }
      } catch (err) {
        console.error('Error loading latest presentation from local storage on startup:', err);
      }
    };
    loadLocal();
    return () => {
      isMounted = false;
    };
  }, [loadPresentation, incrementVersion]);

  // Initialize scene (only once)
  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.set(0, 15, 30);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight.position.set(10, 20, 10);
    scene.add(directionalLight);

    const gridHelper = new THREE.GridHelper(100, 50, 0x1a1a2e, 0x1a1a2e);
    gridHelper.name = 'gridHelper';
    scene.add(gridHelper);

    const handleResize = () => {
      if (!camera || !renderer) return;
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameRef.current);
      renderer.dispose();
      if (containerRef.current && renderer.domElement) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, []); // Empty deps - only run once

  // Update scene theme (background, fog, grid)
  useEffect(() => {
    if (!sceneRef.current) return;

    const scene = sceneRef.current;

    // Cielo del fondo. Se dibuja en un canvas y se mapea como equirectangular,
    // así envuelve la escena y da sensación de lejanía al girar (con una imagen
    // plana el fondo queda pegado a la pantalla y no se percibe profundidad).
    const cielo = document.createElement('canvas');
    cielo.width = 2048;
    cielo.height = 1024;
    const g = cielo.getContext('2d');
    if (g) {
      if (isDarkMode) {
        // Noche espacial: degradado, nebulosas tenues y estrellas.
        const grad = g.createLinearGradient(0, 0, 0, 1024);
        grad.addColorStop(0, '#04050d');
        grad.addColorStop(0.55, '#0b1026');
        grad.addColorStop(1, '#161d3a');
        g.fillStyle = grad;
        g.fillRect(0, 0, 2048, 1024);

        for (let i = 0; i < 14; i++) {
          const x = Math.random() * 2048;
          const y = Math.random() * 620;
          const r = 130 + Math.random() * 280;
          const tono = Math.random() > 0.5 ? '90,130,255' : '150,80,220';
          const neb = g.createRadialGradient(x, y, 0, x, y, r);
          neb.addColorStop(0, `rgba(${tono},0.11)`);
          neb.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = neb;
          g.beginPath();
          g.arc(x, y, r, 0, Math.PI * 2);
          g.fill();
        }

        // ── Vía Láctea ── banda diagonal: resplandor, cúmulos, polvo oscuro y
        // estrellas apretadas. Dibujada y no fotográfica: una foto de fondo
        // pesaría más que todo el resto junto y habría que resolver su licencia.
        g.save();
        g.translate(1024, 430);
        g.rotate(-0.32);
        const banda = g.createLinearGradient(0, -200, 0, 200);
        banda.addColorStop(0, 'rgba(180,200,255,0)');
        banda.addColorStop(0.42, 'rgba(200,210,255,0.10)');
        banda.addColorStop(0.5, 'rgba(230,226,255,0.17)');
        banda.addColorStop(0.58, 'rgba(200,210,255,0.10)');
        banda.addColorStop(1, 'rgba(180,200,255,0)');
        g.fillStyle = banda;
        g.fillRect(-1500, -200, 3000, 400);

        for (let i = 0; i < 130; i++) {          // cúmulos luminosos
          const x = (Math.random() - 0.5) * 2700;
          const y = (Math.random() - 0.5) * 200;
          const r = 40 + Math.random() * 110;
          const cum = g.createRadialGradient(x, y, 0, x, y, r);
          cum.addColorStop(0, 'rgba(238,232,255,0.10)');
          cum.addColorStop(1, 'rgba(238,232,255,0)');
          g.fillStyle = cum;
          g.beginPath();
          g.arc(x, y, r, 0, Math.PI * 2);
          g.fill();
        }
        for (let i = 0; i < 45; i++) {           // vetas de polvo
          const x = (Math.random() - 0.5) * 2600;
          const y = (Math.random() - 0.5) * 150;
          const r = 30 + Math.random() * 95;
          const polvo = g.createRadialGradient(x, y, 0, x, y, r);
          polvo.addColorStop(0, 'rgba(6,8,20,0.38)');
          polvo.addColorStop(1, 'rgba(6,8,20,0)');
          g.fillStyle = polvo;
          g.beginPath();
          g.arc(x, y, r, 0, Math.PI * 2);
          g.fill();
        }
        for (let i = 0; i < 2200; i++) {         // estrellas de la banda
          const x = (Math.random() - 0.5) * 2800;
          const y = (Math.random() + Math.random() + Math.random() - 1.5) * 110;
          g.globalAlpha = 0.18 + Math.random() * 0.5;
          g.fillStyle = Math.random() > 0.85 ? '#ffe9c8' : '#ffffff';
          g.beginPath();
          g.arc(x, y, Math.random() * 0.9 + 0.15, 0, Math.PI * 2);
          g.fill();
        }
        g.globalAlpha = 1;
        g.restore();

        // ── Galaxia lejana ── halo, disco elíptico inclinado y dos brazos.
        const gx = 520;
        const gy = 235;
        const halo = g.createRadialGradient(gx, gy, 0, gx, gy, 155);
        halo.addColorStop(0, 'rgba(255,240,220,0.50)');
        halo.addColorStop(0.18, 'rgba(215,200,255,0.18)');
        halo.addColorStop(1, 'rgba(160,150,255,0)');
        g.fillStyle = halo;
        g.beginPath();
        g.arc(gx, gy, 155, 0, Math.PI * 2);
        g.fill();

        g.save();
        g.translate(gx, gy);
        g.rotate(-0.5);
        g.scale(1, 0.38);                        // inclinación del disco
        const disco = g.createRadialGradient(0, 0, 0, 0, 0, 108);
        disco.addColorStop(0, 'rgba(255,246,226,0.85)');
        disco.addColorStop(0.22, 'rgba(234,224,255,0.32)');
        disco.addColorStop(1, 'rgba(180,170,255,0)');
        g.fillStyle = disco;
        g.beginPath();
        g.arc(0, 0, 108, 0, Math.PI * 2);
        g.fill();
        g.lineWidth = 9;
        for (let brazo = 0; brazo < 2; brazo++) {
          g.strokeStyle = 'rgba(226,220,255,0.13)';
          g.beginPath();
          for (let t = 0; t < 3.1; t += 0.06) {
            const rad = 16 + t * 30;
            const ang = t * 1.5 + brazo * Math.PI;
            const px = Math.cos(ang) * rad;
            const py = Math.sin(ang) * rad;
            if (t === 0) g.moveTo(px, py); else g.lineTo(px, py);
          }
          g.stroke();
        }
        g.restore();

        for (let i = 0; i < 1500; i++) {
          const x = Math.random() * 2048;
          // Se concentran arriba: cerca del horizonte casi no se ven.
          const y = Math.pow(Math.random(), 1.4) * 900;
          const r = Math.random() * 1.4 + 0.25;
          g.globalAlpha = 0.25 + Math.random() * 0.75;
          g.fillStyle = '#ffffff';
          g.beginPath();
          g.arc(x, y, r, 0, Math.PI * 2);
          g.fill();
        }
        g.globalAlpha = 1;

        // Nubes de noche: apenas iluminadas y bajas, cerca del horizonte, para
        // que no tapen el campo de estrellas.
        const nubeNocturna = (cx: number, cy: number, escala: number) => {
          for (let i = 0; i < 16; i++) {
            const ang = Math.random() * Math.PI * 2;
            const dist = Math.random() * 95 * escala;
            const x = cx + Math.cos(ang) * dist * 2.4;
            const y = cy + Math.sin(ang) * dist * 0.45;
            const r = (34 + Math.random() * 60) * escala;
            const gr = g.createRadialGradient(x, y, 0, x, y, r);
            gr.addColorStop(0, 'rgba(120,140,200,0.16)');
            gr.addColorStop(1, 'rgba(120,140,200,0)');
            g.fillStyle = gr;
            g.beginPath();
            g.arc(x, y, r, 0, Math.PI * 2);
            g.fill();
          }
        };
        for (let i = 0; i < 6; i++) {
          nubeNocturna(Math.random() * 2048, 620 + Math.random() * 300, 0.7 + Math.random() * 0.7);
        }
      } else {
        // Día soleado: cielo azul, sol con halo y cúmulos de nubes.
        const grad = g.createLinearGradient(0, 0, 0, 1024);
        grad.addColorStop(0, '#2f83d6');
        grad.addColorStop(0.6, '#93cbf2');
        grad.addColorStop(1, '#eaf6ff');
        g.fillStyle = grad;
        g.fillRect(0, 0, 2048, 1024);

        const sx = 1480;
        const sy = 230;
        const sol = g.createRadialGradient(sx, sy, 0, sx, sy, 330);
        sol.addColorStop(0, 'rgba(255,251,225,0.95)');
        sol.addColorStop(0.14, 'rgba(255,245,195,0.5)');
        sol.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = sol;
        g.fillRect(sx - 340, sy - 340, 680, 680);

        const nube = (cx: number, cy: number, escala: number) => {
          for (let i = 0; i < 18; i++) {
            const ang = Math.random() * Math.PI * 2;
            const dist = Math.random() * 90 * escala;
            const x = cx + Math.cos(ang) * dist * 2.2;
            const y = cy + Math.sin(ang) * dist * 0.5;
            const r = (30 + Math.random() * 55) * escala;
            const gr = g.createRadialGradient(x, y, 0, x, y, r);
            gr.addColorStop(0, 'rgba(255,255,255,0.85)');
            gr.addColorStop(1, 'rgba(255,255,255,0)');
            g.fillStyle = gr;
            g.beginPath();
            g.arc(x, y, r, 0, Math.PI * 2);
            g.fill();
          }
        };
        for (let i = 0; i < 10; i++) {
          nube(Math.random() * 2048, 200 + Math.random() * 460, 0.6 + Math.random() * 0.85);
        }
      }
    }
    const texturaCielo = new THREE.CanvasTexture(cielo);
    texturaCielo.colorSpace = THREE.SRGBColorSpace;
    texturaCielo.mapping = THREE.EquirectangularReflectionMapping;
    scene.background?.dispose?.();
    scene.background = texturaCielo;

    // La niebla toma el color del horizonte del cielo: es lo que hace que la
    // grilla y lo lejano se disuelvan ahí en vez de cortarse de golpe.
    const colorHorizonte = isDarkMode ? 0x161d3a : 0xeaf6ff;
    scene.fog = new THREE.Fog(colorHorizonte, 45, 150);

    // Estrellas que titilan y fugaces: sólo de noche. Se rehacen al cambiar
    // de tema y se liberan las anteriores.
    if (cieloAnimadoRef.current) {
      scene.remove(cieloAnimadoRef.current);
      liberarGrupo(cieloAnimadoRef.current);
      cieloAnimadoRef.current = null;
    }
    if (isDarkMode) {
      const animado = crearCieloAnimado();
      cieloAnimadoRef.current = animado;
      scene.add(animado);
    }

    // Update grid color and opacity
    const existingGrid = scene.getObjectByName('gridHelper');
    if (existingGrid) {
      scene.remove(existingGrid);
      liberarGrupo(existingGrid);
    }

    // Piso CIRCULAR: con una grilla cuadrada se veían las esquinas recortadas
    // contra el horizonte. Se arma a mano con las mismas líneas rectas, pero
    // cortando cada una contra un círculo, así el borde es siempre redondo y la
    // niebla lo disuelve parejo en todas las direcciones.
    const radioPiso = 150;
    const pasoGrilla = 2.5;
    const puntos: number[] = [];
    for (let c = -radioPiso; c <= radioPiso + 0.001; c += pasoGrilla) {
      const medio = Math.sqrt(Math.max(0, radioPiso * radioPiso - c * c));
      if (medio <= 0.01) continue;
      puntos.push(-medio, 0, c, medio, 0, c);   // líneas en el eje X
      puntos.push(c, 0, -medio, c, 0, medio);   // líneas en el eje Z
    }
    const geometriaGrilla = new THREE.BufferGeometry();
    geometriaGrilla.setAttribute('position', new THREE.Float32BufferAttribute(puntos, 3));
    const materialGrilla = new THREE.LineBasicMaterial({
      color: isDarkMode ? 0x2a3566 : 0xc9d6e4,
      transparent: true,
      opacity: isDarkMode ? 0.55 : 0.5,
      fog: true,
    });
    const newGrid = new THREE.LineSegments(geometriaGrilla, materialGrilla);
    newGrid.name = 'gridHelper';
    scene.add(newGrid);
  }, [isDarkMode]);

  // Create/update boxes for bird view
  useEffect(() => {
    if (!sceneRef.current || isInsideBox) return;

    boxesRef.current.forEach(box => {
      sceneRef.current?.remove(box);
      liberarGrupo(box);   // sin esto, cada rearmado dejaba las mallas viejas en la GPU
    });
    boxesRef.current = [];

    boxes.forEach((boxData, index) => {
      const box = createBoxGeometry(boxData, index);
      const spacing = 18;
      box.position.x = (index - (boxes.length - 1) / 2) * spacing;
      sceneRef.current?.add(box);
      boxesRef.current.push(box);
    });
  }, [boxes, createBoxGeometry, isInsideBox, isDarkMode]);

  // Update inside view when slides change
  useEffect(() => {
    if (!isInsideBox || !sceneRef.current || !boxes[currentBoxIndex]) return;

    if (insideBoxGroupRef.current) {
      sceneRef.current.remove(insideBoxGroupRef.current);
      // Este efecto corre en CADA cambio de lamina: sin liberar, la sala vieja
      // quedaba entera en memoria y la app se iba frenando lamina tras lamina.
      liberarGrupo(insideBoxGroupRef.current);
    }

    const insideGroup = createInsideView(boxes[currentBoxIndex]);
    insideBoxGroupRef.current = insideGroup;
    sceneRef.current.add(insideGroup);
  }, [isInsideBox, currentBoxIndex, boxes, createInsideView, currentSlideIndex, isDarkMode]);

  // Animation loop
  useEffect(() => {
    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate);

      if (!sceneRef.current || !cameraRef.current || !rendererRef.current) return;

      // Titileo de las estrellas y estrellas fugaces (sólo de noche).
      const ahora = performance.now();
      const dt = Math.min((ahora - (ultimoCuadroRef.current || ahora)) / 1000, 0.1);
      ultimoCuadroRef.current = ahora;
      if (cieloAnimadoRef.current) animarCielo(cieloAnimadoRef.current, ahora * 0.001, dt);

      const camera = cameraRef.current;

      camera.position.lerp(targetCameraPositionRef.current, 0.08);

      if (!isInsideBox) {
        boxesRef.current.forEach((box) => {
          box.rotation.y += 0.003;
        });
      }

      if (isInsideBox) {
        // Animate mini navigation cubes inside the box
        if (insideBoxGroupRef.current) {
          const time = Date.now() * 0.001;

          // El menú de cubitos acompaña a la cámara: antes vivía en un punto fijo
          // de la sala (z=3) y al girar hacia otra pared quedaba a la espalda.
          // Se lo recoloca en cada cuadro delante de la vista, abajo, para que
          // esté siempre a mano sin tapar la lámina.
          const contenedorCubitos = insideBoxGroupRef.current.getObjectByName('miniCubesContainer');
          if (contenedorCubitos && cameraRef.current) {
            // En el nivel 2 (proyección limpia) los cubitos también desaparecen.
            contenedorCubitos.visible = mostrarNavegacionRef.current;
            const camara = cameraRef.current;
            // Offset en el espacio de la cámara (mira hacia -Z): centrados y
            // ARRIBA. Al ir pegados a la cámara no giran con el carrusel: quedan
            // flotando siempre en el mismo lugar de la pantalla, como la barra
            // de láminas de abajo.
            // y=1.65: cerca del borde superior del encuadre (a 2.8 de distancia y
            // con el FOV por defecto, la mitad visible es ~2.1), para no tapar la
            // lámina que va en el centro.
            const destino = new THREE.Vector3(0, 1.65, -2.8).applyMatrix4(camara.matrixWorld);
            // El grupo de la sala está en el origen, pero por si acaso se pasa
            // de coordenadas del mundo a las locales del contenedor.
            insideBoxGroupRef.current.worldToLocal(destino);
            contenedorCubitos.position.copy(destino);
            contenedorCubitos.quaternion.copy(camara.quaternion);
          }

          // Avance del video de la lámina actual, al pie de la pared que se mira.
          const pivote = insideBoxGroupRef.current.getObjectByName('barraProgreso');
          if (pivote) {
            const sala = boxes[currentBoxIndex];
            const url = sala?.slides[currentSlideIndex]?.imageUrl || '';
            const video = videosDeTexturas.find((v) => v.url === url)?.el;
            if (video && video.duration > 0 && currentSlideIndex < (sala?.slides.length ?? 0)) {
              const pared = pivote.userData.paredes[currentSlideIndex % 4];
              // Un pelín hacia adentro de la sala para no pelearse con la pared.
              pivote.position.set(pared.pos[0] * 0.985, 0, pared.pos[2] * 0.985);
              pivote.rotation.set(pared.rot[0], pared.rot[1], pared.rot[2]);
              const avance = Math.min(1, Math.max(0, video.currentTime / video.duration));
              const barraMesh = pivote.children[0] as THREE.Mesh;
              barraMesh.scale.x = Math.max(0.001, pivote.userData.ancho * avance);
              pivote.visible = true;
            } else {
              pivote.visible = false;
            }
          }

          insideBoxGroupRef.current.traverse((child) => {
            if (child.userData && child.userData.isMiniNavCube) {
              // Rotate the cube
              child.rotation.y += child.userData.rotationSpeed || 0.01;
              child.rotation.x += (child.userData.rotationSpeed || 0.01) * 0.5;

              // Flotado: se calcula desde la altura de reposo. Sumarlo a la
              // posición actual (como estaba) no oscilaba, iba desplazando el
              // cubo hasta sacarlo de cuadro.
              if (child.parent && child.userData.floatOffset !== undefined) {
                const base = child.userData.baseY ?? 0;
                child.parent.position.y = base + Math.sin(time + child.userData.floatOffset) * 0.05;
              }
            }
          });
        }

        // Handle slide-based camera orientation (all wall slides)
        const numSlides = boxes[currentBoxIndex].slides.length;
        if (currentSlideIndex < numSlides) {
          // Walls - horizontal rotation only, allow free vertical look
          targetCameraAngleRef.current = currentSlideIndex * (Math.PI / 2);
          // Don't force pitch - let user look freely at floor/ceiling/walls
        }
        // Removed forced floor/ceiling orientation - user has full camera freedom

        // Smooth angle rotation
        const angleDiff = targetCameraAngleRef.current - cameraAngleRef.current;
        const shortestAngleDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
        cameraAngleRef.current += shortestAngleDiff * 0.08;
        
        // Smooth pitch rotation
        const pitchDiff = targetCameraPitchRef.current - cameraPitchRef.current;
        cameraPitchRef.current += pitchDiff * 0.08;
        
        // Smooth zoom
        fovRef.current += (targetFovRef.current - fovRef.current) * 0.1;
        camera.fov = fovRef.current;
        camera.updateProjectionMatrix();
        
        // Position camera in center
        const camHeight = targetCameraPositionRef.current.y;
        camera.position.x = 0;
        camera.position.z = 0;
        camera.position.y = camHeight;
        
        // Calculate look direction based on angle and pitch
        const lookX = Math.sin(cameraAngleRef.current) * 10;
        const lookZ = Math.cos(cameraAngleRef.current) * 10;
        const lookY = 2.67 + Math.sin(cameraPitchRef.current) * 10;
        camera.lookAt(lookX, lookY, lookZ);
      } else {
        camera.lookAt(cameraTargetRef.current);
      }

      rendererRef.current.render(sceneRef.current, camera);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isInsideBox, currentSlideIndex]);

  // Mouse controls
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Raycaster for clicking on mini cubes
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const handleClick = (e: MouseEvent) => {
      if (!mouseEnabled || !cameraRef.current || !insideBoxGroupRef.current) return;

      // Calculate mouse position in normalized device coordinates
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

      raycaster.setFromCamera(mouse, cameraRef.current);

      // Get all mini cube meshes from insideBoxGroup
      const miniCubes: THREE.Mesh[] = [];
      
      let containerVisible = true;
      insideBoxGroupRef.current.traverse((child) => {
        if (child.name === 'miniCubesContainer') {
          containerVisible = child.visible;
        }
      });
      
      if (!containerVisible) return;

      insideBoxGroupRef.current.traverse((child) => {
        if (child.userData && child.userData.isMiniNavCube && child instanceof THREE.Mesh) {
          miniCubes.push(child);
        }
      });

      const intersects = raycaster.intersectObjects(miniCubes);

      if (intersects.length > 0) {
        const clickedObject = intersects[0].object;
        const targetIndex = clickedObject.userData.targetBoxIndex;
        if (targetIndex !== undefined && targetIndex !== currentBoxIndex) {
          // Navigate directly into the clicked box
          enterBox(targetIndex);
        }
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (!mouseEnabled) return;
      mouseRef.current.isDown = true;
      mouseRef.current.x = e.clientX;
      mouseRef.current.y = e.clientY;
    };

    const handleMouseUp = () => {
      mouseRef.current.isDown = false;
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!mouseEnabled || !mouseRef.current.isDown) return;

      const deltaX = e.clientX - mouseRef.current.x;
      const deltaY = e.clientY - mouseRef.current.y;

      if (isInsideBox) {
        // Rotate camera angle
        cameraAngleRef.current -= deltaX * 0.005;
        targetCameraAngleRef.current = cameraAngleRef.current;
        // Vertical look (pitch) - More freedom to look at floor and ceiling
        targetCameraPitchRef.current += deltaY * 0.003;
        // Allow full 360 degree vertical rotation for maximum freedom
        targetCameraPitchRef.current = Math.max(-Math.PI + 0.1, Math.min(Math.PI - 0.1, targetCameraPitchRef.current));
        cameraPitchRef.current = targetCameraPitchRef.current;
        // Height - More freedom
        targetCameraPositionRef.current.y += deltaY * 0.02;
        targetCameraPositionRef.current.y = Math.max(0.1, Math.min(8, targetCameraPositionRef.current.y));
      } else {
        targetCameraPositionRef.current.x -= deltaX * 0.05;
        targetCameraPositionRef.current.y += deltaY * 0.05;
        targetCameraPositionRef.current.y = Math.max(5, Math.min(50, targetCameraPositionRef.current.y));
      }

      mouseRef.current.x = e.clientX;
      mouseRef.current.y = e.clientY;
    };

    const handleWheel = (e: WheelEvent) => {
      if (!mouseEnabled) return;
      e.preventDefault();

      if (isInsideBox) {
        const zoomSpeed = 0.05;
        targetFovRef.current += e.deltaY * zoomSpeed;
        targetFovRef.current = Math.max(30, Math.min(100, targetFovRef.current));
      } else {
        const zoomSpeed = 0.05;
        const currentDistance = cameraRef.current?.position.length() || 30;
        const newDistance = Math.max(15, Math.min(60, currentDistance + e.deltaY * zoomSpeed));
        const dir = targetCameraPositionRef.current.clone().normalize();
        targetCameraPositionRef.current.copy(dir.multiplyScalar(newDistance));
      }
    };

    container.addEventListener('mousedown', handleMouseDown);
    container.addEventListener('mouseup', handleMouseUp);
    container.addEventListener('mousemove', handleMouseMove);
    container.addEventListener('wheel', handleWheel, { passive: false });
    // Doble clic sobre una sala en la galería: entra directamente a esa, sin
    // tener que seleccionarla antes con las flechas y apretar "Entrar".
    const handleDobleClic = (e: MouseEvent) => {
      if (isInsideBox || !cameraRef.current || boxesRef.current.length === 0) return;

      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
      raycaster.setFromCamera(mouse, cameraRef.current);

      const tocados = raycaster.intersectObjects(boxesRef.current, true);
      if (tocados.length === 0) return;

      // El rayo pega en una pared; hay que subir por los padres hasta el grupo
      // de la sala para saber cuál es.
      let objeto: THREE.Object3D | null = tocados[0].object;
      let indice = -1;
      while (objeto && indice === -1) {
        indice = boxesRef.current.indexOf(objeto as THREE.Group);
        objeto = objeto.parent;
      }
      if (indice >= 0) {
        setCurrentBox(indice);
        enterBox(indice);
      }
    };

    container.addEventListener('click', handleClick);
    container.addEventListener('dblclick', handleDobleClic);

    return () => {
      container.removeEventListener('mousedown', handleMouseDown);
      container.removeEventListener('mouseup', handleMouseUp);
      container.removeEventListener('mousemove', handleMouseMove);
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('click', handleClick);
      container.removeEventListener('dblclick', handleDobleClic);
    };
  }, [mouseEnabled, isInsideBox, currentBoxIndex, setCurrentBox, focusOnBox, exitBox, enterBox]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Si se está escribiendo (título, subtítulo, nombre de sala), los atajos no
      // deben dispararse: sin esto, tipear "w", "z" o un número movía la cámara.
      const destino = e.target as HTMLElement | null;
      if (destino && (
        destino.tagName === 'INPUT' ||
        destino.tagName === 'TEXTAREA' ||
        destino.isContentEditable
      )) return;

      switch (e.key) {
        // Pasar de diapositiva: ↑/← anterior, ↓/→ siguiente (convención de
        // presentador: abajo avanza). Adentro del cubo cambia de cara; afuera,
        // de sala. La altura de la cámara pasó a W/S.
        case 'ArrowUp':
        case 'ArrowLeft':
          if (isInsideBox) {
            const total = boxes[currentBoxIndex]?.slides?.length ? boxes[currentBoxIndex].slides.length : 4;
            const newSlideIndex = (currentSlideIndex - 1 + total) % total;
            setCurrentSlide(newSlideIndex);
          } else {
            const newBoxIndex = (currentBoxIndex - 1 + boxes.length) % boxes.length;
            setCurrentBox(newBoxIndex);
            focusOnBox(newBoxIndex);
          }
          break;
        case 'ArrowDown':
        case 'ArrowRight':
          if (isInsideBox) {
            const total = boxes[currentBoxIndex]?.slides?.length ? boxes[currentBoxIndex].slides.length : 4;
            const newSlideIndex = (currentSlideIndex + 1) % total;
            setCurrentSlide(newSlideIndex);
          } else {
            const newBoxIndex = (currentBoxIndex + 1) % boxes.length;
            setCurrentBox(newBoxIndex);
            focusOnBox(newBoxIndex);
          }
          break;
        // Altura de la cámara adentro del cubo (antes estaba en ↑↓).
        case 'w':
        case 'W':
          if (isInsideBox) {
            targetCameraPositionRef.current.y = Math.min(5, targetCameraPositionRef.current.y + 0.5);
          }
          break;
        case 's':
        case 'S':
          if (isInsideBox) {
            targetCameraPositionRef.current.y = Math.max(0.5, targetCameraPositionRef.current.y - 0.5);
          }
          break;
        case 'Enter':
          if (!isInsideBox) {
            enterBox(currentBoxIndex);
          }
          break;
        case 'Escape':
        case 'Backspace':
          if (isInsideBox) {
            exitBox();
          }
          break;
        case 'h':
        case 'H':
          setNivelUI((prev) => (prev + 1) % 3);
          break;
        case 'k':
        case 'K':
          if (isInsideBox && insideBoxGroupRef.current) {
            insideBoxGroupRef.current.traverse((child) => {
              if (child.name === 'miniCubesContainer') {
                child.visible = !child.visible;
              }
            });
          }
          break;
        case 'z':
        case 'Z':
          if (isInsideBox) {
            if (targetFovRef.current > 70) {
              targetFovRef.current = 50;
            } else if (targetFovRef.current > 40) {
              targetFovRef.current = 35;
            } else {
              targetFovRef.current = 75;
            }
          }
          break;
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
          if (isInsideBox) {
            setCurrentSlide(parseInt(e.key) - 1);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isInsideBox, currentBoxIndex, currentSlideIndex, boxes.length, setCurrentBox, setCurrentSlide, focusOnBox, enterBox, exitBox]);

  const handleBatchUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);
    const promises = fileArray.map((file, index) =>
      new Promise<any>((resolve) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          resolve({
            id: `slide-${Date.now()}-${index}`,
            imageUrl: event.target?.result as string,
            subtitle: file.name.replace(/\.[^/.]+$/, '') // Remove extension from subtitle
          });
        };
        reader.readAsDataURL(file);
      })
    );

    Promise.all(promises).then((newSlides) => {
      setSlides(currentBoxIndex, newSlides);
      setCurrentSlide(0);
      alert(`✅ ${newSlides.length} archivo(s) cargados en la sala`);
    });

    // Reset input so same files can be re-selected
    if (batchInputRef.current) {
      batchInputRef.current.value = '';
    }
  };


  const handleImageUpload = (boxId: string, slideIndex: number, file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      const numSlides = boxes[currentBoxIndex]?.slides.length || 4;
      if (slideIndex < numSlides) {
        updateSlide(boxId, slideIndex, { imageUrl: dataUrl });
      } else if (slideIndex === numSlides) {
        updateFloor(boxId, { imageUrl: dataUrl });
      } else if (slideIndex === numSlides + 1) {
        updateCeiling(boxId, { imageUrl: dataUrl });
      }
    };
    reader.readAsDataURL(file);
  };

  // Reinicia el contenido de las salas. "presentacion" vuelve a cargar el
  // material de public/presentacion; "vacia" deja las 3 salas con el logo, para
  // armar una desde cero. Tambien se borra la copia de localStorage que el visor
  // recarga al abrir: sin eso, al refrescar volvia lo anterior y el boton
  // parecia no haber hecho nada.
  const reiniciarContenido = (modo: 'presentacion' | 'vacia') => {
    loadPresentation({
      boxes: modo === 'vacia' ? crearSalasVacias() : crearSalasIniciales(),
      version: Date.now(),
    });
    try {
      localStorage.removeItem('zirkel_latest_presentation');
    } catch (e) {
      console.warn('No se pudo limpiar localStorage', e);
    }
    setCurrentBox(0);
    setCurrentSlide(0);
  };

  // ── Reordenar e insertar láminas ──────────────────────────────────────────
  // Índice que se está arrastrando; null cuando no hay arrastre en curso.
  const [laminaArrastrada, setLaminaArrastrada] = useState<number | null>(null);

  const reordenarLaminas = (desde: number | null, hasta: number) => {
    if (desde === null || desde === hasta || !boxes[currentBoxIndex]) return;
    const lista = [...boxes[currentBoxIndex].slides];
    const [movida] = lista.splice(desde, 1);
    lista.splice(hasta, 0, movida);
    setSlides(currentBoxIndex, lista);
    setCurrentSlide(hasta);   // se sigue viendo la lámina que se movió
  };

  // Inserta una lámina vacía DESPUÉS de la indicada (el botón "+" de la barra
  // agrega al final; esto permite meterla en el medio).
  const insertarLaminaDespues = (indice: number) => {
    if (!boxes[currentBoxIndex]) return;
    const lista = [...boxes[currentBoxIndex].slides];
    lista.splice(indice + 1, 0, {
      id: `slide-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      imageUrl: '/zirkel/zirkel-logo.png',   // marcador de posición hasta que suban la imagen
      subtitle: '',
    });
    setSlides(currentBoxIndex, lista);
    setCurrentSlide(indice + 1);
  };

  // Borra una lámina concreta (la que se soltó en la papelera) y deja el cursor
  // en un índice válido. La sala no puede quedar sin láminas: el store ignora el
  // borrado si es la última, así que acá también se corta antes.
  const eliminarLamina = (indice: number) => {
    const cantidad = boxes[currentBoxIndex]?.slides.length ?? 0;
    if (cantidad <= 1 || indice < 0 || indice >= cantidad) return;
    removeSlideAt(currentBoxIndex, indice);
    const siguiente = currentSlideIndex > indice ? currentSlideIndex - 1 : currentSlideIndex;
    setCurrentSlide(Math.max(0, Math.min(siguiente, cantidad - 2)));
  };

  // Props comunes de arrastre para los cuadraditos y las miniaturas. El origen
  // viaja en el dataTransfer y no en el estado: el estado de React puede no
  // haberse actualizado todavía cuando llega el drop, y ahí el reordenamiento se
  // perdía. El estado queda solo para el resaltado visual.
  const propsArrastre = (indice: number) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData('text/plain', String(indice));
      e.dataTransfer.effectAllowed = 'move';
      setLaminaArrastrada(indice);
    },
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const crudo = e.dataTransfer.getData('text/plain');
      const desde = crudo === '' ? laminaArrastrada : Number(crudo);
      reordenarLaminas(Number.isFinite(desde as number) ? (desde as number) : null, indice);
      setLaminaArrastrada(null);
    },
    onDragEnd: () => setLaminaArrastrada(null),
  });

  const handleExport = () => {
    const data = getExportData();
    try {
      localStorage.setItem('zirkel_latest_presentation', JSON.stringify(data));
    } catch(e) {
      console.warn("No se pudo guardar en localStorage", e);
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `presentacion-parametrica-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        loadPresentation(data);
      } catch (err) {
        console.error('Error loading presentation:', err);
      }
    };
    reader.readAsText(file);
  };

  // Get current image based on slide index
  const getCurrentImage = () => {
    if (!boxes[currentBoxIndex]) return '/zirkel/zirkel-logo.png';
    const numSlides = boxes[currentBoxIndex].slides.length;
    let url = '';
    if (currentSlideIndex < numSlides) {
      url = boxes[currentBoxIndex].slides[currentSlideIndex]?.imageUrl || '';
    } else if (currentSlideIndex === numSlides) {
      url = boxes[currentBoxIndex].floorImageUrl;
    } else {
      url = boxes[currentBoxIndex].ceilingImageUrl;
    }
    return url || '/zirkel/zirkel-logo.png';
  };

  // Get current subtitle
  // Si la lámina no tiene subtítulo cargado se muestra su número, así el cartel
  // de abajo nunca queda vacío y siempre se sabe en qué lámina se está.
  const getCurrentSubtitle = () => {
    if (!boxes[currentBoxIndex]) return '';
    const numSlides = boxes[currentBoxIndex].slides.length;
    if (currentSlideIndex < numSlides) {
      const propio = boxes[currentBoxIndex].slides[currentSlideIndex]?.subtitle?.trim();
      return propio || `${currentSlideIndex + 1} / ${numSlides}`;
    } else if (currentSlideIndex === numSlides) {
      return boxes[currentBoxIndex].floorSubtitle;
    } else {
      return boxes[currentBoxIndex].ceilingSubtitle;
    }
  };

  // Get current linkUrl
  const getCurrentLinkUrl = () => {
    if (!boxes[currentBoxIndex]) return '';
    const numSlides = boxes[currentBoxIndex].slides.length;
    if (currentSlideIndex < numSlides) {
      return boxes[currentBoxIndex].slides[currentSlideIndex]?.linkUrl || '';
    } else if (currentSlideIndex === numSlides) {
      return boxes[currentBoxIndex].floorLinkUrl || '';
    } else {
      return boxes[currentBoxIndex].ceilingLinkUrl || '';
    }
  };

  // Helper: upload a single base64 dataUrl as a file to the server
  const uploadMediaFile = async (dataUrl: string, fileId: string): Promise<string> => {
    // Convert base64 data URL to Blob
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const formData = new FormData();
    formData.append('file', blob, fileId);
    formData.append('fileId', fileId);
    const response = await fetch('/api/upload-media', { method: 'POST', body: formData });
    if (!response.ok) throw new Error(`Failed to upload ${fileId}`);
    const json = await response.json();
    return json.url;
  };

  const handleSaveToServer = async () => {
    const finalFilename = saveFilename.trim() || `presentacion-${new Date().toISOString().slice(0,10)}-${Date.now()}`;
    setShowSaveModal(false);
    setIsSaving(true);

    try {
      // Deep clone data to avoid mutating store
      const exportData = JSON.parse(JSON.stringify(getExportData()));

      // Count total images that need uploading
      let totalImages = 0;
      for (const box of exportData.boxes) {
        for (const slide of box.slides || []) {
          if (slide.imageUrl?.startsWith('data:')) totalImages++;
        }
        if (box.floorImageUrl?.startsWith('data:')) totalImages++;
        if (box.ceilingImageUrl?.startsWith('data:')) totalImages++;
      }

      let uploadedCount = 0;
      setSaveProgress({ current: 0, total: totalImages, label: totalImages > 0 ? 'Subiendo imágenes...' : 'Guardando...' });

      // Upload each image individually
      for (const box of exportData.boxes) {
        for (const slide of box.slides || []) {
          if (slide.imageUrl?.startsWith('data:')) {
            setSaveProgress({ current: uploadedCount, total: totalImages, label: `Subiendo imagen ${uploadedCount + 1} de ${totalImages}...` });
            slide.imageUrl = await uploadMediaFile(slide.imageUrl, `slide-${slide.id}`);
            uploadedCount++;
          }
        }
        if (box.floorImageUrl?.startsWith('data:')) {
          setSaveProgress({ current: uploadedCount, total: totalImages, label: `Subiendo imagen ${uploadedCount + 1} de ${totalImages}...` });
          box.floorImageUrl = await uploadMediaFile(box.floorImageUrl, `floor-${box.id}`);
          uploadedCount++;
        }
        if (box.ceilingImageUrl?.startsWith('data:')) {
          setSaveProgress({ current: uploadedCount, total: totalImages, label: `Subiendo imagen ${uploadedCount + 1} de ${totalImages}...` });
          box.ceilingImageUrl = await uploadMediaFile(box.ceilingImageUrl, `ceiling-${box.id}`);
          uploadedCount++;
        }
      }

      // Save the final JSON (now has only URLs, very small)
      setSaveProgress({ current: totalImages, total: totalImages, label: 'Guardando presentación...' });
      const response = await fetch('/api/save-blob', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: exportData, filename: finalFilename }),
      });

      if (response.ok) {
        setSaveProgress({ current: totalImages, total: totalImages, label: '¡Guardado exitosamente!' });
        try {
          localStorage.setItem('zirkel_latest_presentation', JSON.stringify(exportData));
        } catch(e) {
          console.warn("No se pudo guardar en localStorage", e);
        }
        setTimeout(() => { setIsSaving(false); incrementVersion(); }, 1200);
      } else {
        const err = await response.json().catch(() => ({}));
        alert(`Error al guardar: ${err.error || response.statusText}`);
        setIsSaving(false);
      }
    } catch (e) {
      console.error(e);
      alert('Error en conexión con el servidor.');
      setIsSaving(false);
    }
  };

  const handleLoadFromServer = async () => {
    setIsLoadingBlobs(true);
    setShowLoadModal(true);
    try {
      const resp = await fetch(`/api/list-blobs?t=${Date.now()}`, { cache: 'no-store' });
      const data = await resp.json();
      if (data.success) {
        setAvailableBlobs(data.blobs);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingBlobs(false);
    }
  };

  const loadSpecificBlob = async (url: string) => {
    setShowLoadModal(false);
    setIsLoading(true);
    setLoadProgress({ current: 0, total: 0, label: 'Descargando presentación...' });
    try {
      // Step 1: fetch the JSON
      const resp = await fetch(url);
      const data = await resp.json();

      // Step 2: count all image URLs to pre-fetch
      const imageUrls: string[] = [];
      for (const box of data.boxes || []) {
        for (const slide of box.slides || []) {
          if (slide.imageUrl && !slide.imageUrl.startsWith('data:')) imageUrls.push(slide.imageUrl);
        }
        if (box.floorImageUrl && !box.floorImageUrl.startsWith('data:')) imageUrls.push(box.floorImageUrl);
        if (box.ceilingImageUrl && !box.ceilingImageUrl.startsWith('data:')) imageUrls.push(box.ceilingImageUrl);
      }

      const total = imageUrls.length;
      setLoadProgress({ current: 0, total, label: total > 0 ? `Cargando imágenes (0 de ${total})...` : 'Aplicando presentación...' });

      // Step 3: pre-fetch each image (warms browser cache so Three.js loads instantly)
      for (let i = 0; i < imageUrls.length; i++) {
        setLoadProgress({ current: i, total, label: `Cargando imagen ${i + 1} de ${total}...` });
        await new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => resolve(); // don't block on error
          img.src = imageUrls[i];
        });
      }

      // Step 4: apply data to store
      setLoadProgress({ current: total, total, label: '¡Presentación cargada!' });
      loadPresentation(data);
      incrementVersion();
      setTimeout(() => setIsLoading(false), 1000);
    } catch (e) {
      console.error(e);
      alert('Error al cargar la presentación.');
      setIsLoading(false);
    }
  };

  const handleDeleteBlob = async (e: React.MouseEvent, pathname: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    try {
      const res = await fetch('/api/delete-blob', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pathname })
      });
      const data = await res.json();
      if (data.success) {
        setAvailableBlobs(prev => prev.filter(b => b.pathname !== pathname));
        console.log('Presentación borrada exitosamente del servidor');
      } else {
        console.error(`Error al borrar: ${data.error}`);
        alert(`Error al borrar: ${data.error}`);
      }
    } catch (err) {
      console.error(err);
      alert('Error de conexión al borrar');
    }
  };

  return (
    <div className={`relative w-full h-screen overflow-hidden select-none ${currentTheme.bg}`}>
      <div ref={containerRef} className="absolute inset-0" />

      {/* Zirkel Logo & Video - Bird view only */}
      {!isInsideBox && showAllUI && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
          <div className="flex flex-col items-center gap-3">
            <div className="relative">
              <img 
                src="/zirkel/zirkel-logo.png" 
                alt="Zirkel Logo" 
                className="h-20 md:h-28 object-contain"
                style={{ filter: isDarkMode ? 'drop-shadow(0 0 30px rgba(0,255,255,0.5))' : 'drop-shadow(0 4px 20px rgba(34,197,94,0.4))' }}
              />
            </div>
            <div className="w-32 h-20 md:w-40 md:h-24 rounded-lg overflow-hidden shadow-lg">
              <video 
                src="/zirkel/zirkel-video.mp4" 
                autoPlay 
                loop 
                muted 
                playsInline
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        </div>
      )}

      {/* UI Overlay */}
      {showAllUI && (
      <div className="absolute top-0 left-0 right-0 p-4 z-10 pointer-events-none">
        <div className="flex justify-between items-start">
          {/* Left controls */}
          <div className="flex flex-col gap-2 pointer-events-auto mt-32 md:mt-40">
            <div className={`${currentTheme.panelBg} backdrop-blur-md rounded-xl p-4 ${currentTheme.text} border ${currentTheme.border} shadow-lg`}>
              <h1 className={`text-lg font-bold bg-gradient-to-r ${currentTheme.gradient} bg-clip-text text-transparent`}>
                Presentación 3D Paramétrica
              </h1>
              <p className={`text-xs ${currentTheme.textMuted} mt-1`}>Diseño Estructural • Rhino • Grasshopper • Karamba3D</p>
            </div>

            {showControls && (
              <div className={`${currentTheme.panelBg} backdrop-blur-md rounded-xl p-4 ${currentTheme.text} text-sm border ${currentTheme.border} max-w-xs shadow-lg`}>
                <h3 className="font-semibold mb-2 flex items-center gap-2" style={{ color: currentTheme.accent }}>
                  <span>⌨️</span> Controles
                </h3>
                <ul className={`space-y-1 text-xs ${currentTheme.textMuted}`}>
                  <li className="flex items-center gap-2">🖱️ Arrastrar: Rotar/Mover</li>
                  <li className="flex items-center gap-2">🔄 Rueda: Zoom</li>
                  <li className="flex items-center gap-2">⬆️⬇️ Cambiar cara</li>
                  <li className="flex items-center gap-2">⬅️➡️ Cambiar cara</li>
                  <li className="flex items-center gap-2">W / S: Altura de cámara</li>
                  <li className="flex items-center gap-2">⏎ Enter: Entrar</li>
                  <li className="flex items-center gap-2">⎋ Esc: Salir</li>
                  <li className="flex items-center gap-2">1-6 Ir a cara</li>
                  <li className="flex items-center gap-2">k Ocultar menú</li>
                </ul>
              </div>
            )}
          </div>

          {/* Right controls - Theme toggle + buttons */}
          <div className="flex flex-col gap-2 pointer-events-auto">
            {/* Theme toggle button */}
            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className={`${currentTheme.panelBg} backdrop-blur-md ${currentTheme.text} px-4 py-2 rounded-xl text-sm hover:opacity-80 transition border ${currentTheme.border} shadow-lg`}
            >
              {isDarkMode ? '🌙 Oscuro' : '☀️ Claro'}
            </button>
            
            {!isInsideBox && (
              <>
                <button
                  onClick={() => setShowControls(!showControls)}
                  className={`${currentTheme.panelBg} backdrop-blur-md ${currentTheme.text} px-4 py-2 rounded-xl text-sm hover:opacity-80 transition border ${currentTheme.border} shadow-lg`}
                >
                  {showControls ? '👁️ Ocultar' : '👁️ Mostrar'}
                </button>
                
                <button
                  onClick={() => setMouseEnabled(!mouseEnabled)}
                  className={`backdrop-blur-md px-4 py-2 rounded-xl text-sm font-semibold transition border shadow-lg ${
                    mouseEnabled 
                      ? `text-white border-[${currentTheme.accent}] hover:opacity-80` 
                      : 'bg-gray-500/90 text-white border-gray-400 hover:bg-gray-600/90'
                  }`}
                  style={mouseEnabled ? { backgroundColor: currentTheme.accent } : {}}
                >
                  🖱️ Mouse: {mouseEnabled ? 'ON' : 'OFF'}
                </button>

                {/* Vuelta al sitio: esta app se abre desde zirkeldep.com y sin
                    esto el único regreso era el botón del navegador. */}
                <a
                  href={urlVolver}
                  title="Volver al sitio de Zirkel"
                  className={`${currentTheme.panelBg} backdrop-blur-md ${currentTheme.text} px-4 py-2 rounded-xl text-sm hover:opacity-80 transition border ${currentTheme.border} shadow-lg text-center no-underline`}
                >
                  ↩ Volver a Zirkel
                </a>
              </>
            )}
          </div>
        </div>
      </div>
      )}

      {/* Inside box - Right side buttons column */}
      {isInsideBox && boxes[currentBoxIndex] && showAllUI && (
        <div className="absolute top-4 right-4 z-40 flex flex-col gap-2 pointer-events-auto">
          <button
            onClick={exitBox}
            className={`px-4 py-2 flex items-center gap-2 ${currentTheme.panelBg} hover:opacity-80 ${currentTheme.text} transition-all rounded-xl backdrop-blur-md border ${currentTheme.border} shadow-lg font-medium text-sm`}
            style={{ backgroundColor: `rgba(${isDarkMode ? '0,0,0,0.8' : '255,255,255,0.95'})` }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Salir (Esc)
          </button>
          
          <button
            onClick={() => setNivelUI((prev) => (prev + 1) % 3)}
            className={`${currentTheme.panelBg} backdrop-blur-md ${currentTheme.text} px-4 py-2 rounded-xl text-sm hover:opacity-80 transition border ${currentTheme.border} shadow-lg`}
          >
            👁️ Ocultar (H)
          </button>
          
          <button
            onClick={() => setMouseEnabled(!mouseEnabled)}
            className={`backdrop-blur-md px-4 py-2 rounded-xl text-sm font-semibold transition border shadow-lg ${
              mouseEnabled 
                ? 'text-white hover:opacity-80' 
                : 'bg-gray-500/90 text-white border-gray-400 hover:bg-gray-600/90'
            }`}
            style={mouseEnabled ? { backgroundColor: currentTheme.accent } : {}}
          >
            🖱️ {mouseEnabled ? 'ON' : 'OFF'}
          </button>
        </div>
      )}

      {/* Navigation arrows when inside box */}
      {isInsideBox && boxes[currentBoxIndex] && mostrarNavegacion && (
        <>
          <button
            onClick={() => {
              const total = boxes[currentBoxIndex].slides.length;
              setCurrentSlide((currentSlideIndex - 1 + total) % total);
            }}
            className={`absolute left-6 top-1/2 -translate-y-1/2 z-30 w-12 h-24 flex items-center justify-center ${currentTheme.panelBg} hover:opacity-80 transition-all rounded-xl backdrop-blur-md group border ${currentTheme.border} shadow-lg`}
            style={{ backgroundColor: `rgba(${isDarkMode ? '0,0,0,0.4' : '255,255,255,0.7'})` }}
          >
            <svg className={`w-6 h-6 group-hover:text-white transition-colors`} style={{ color: currentTheme.accent }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          
          <button
            onClick={() => {
              const total = boxes[currentBoxIndex].slides.length;
              setCurrentSlide((currentSlideIndex + 1) % total);
            }}
            className={`absolute right-6 top-1/2 -translate-y-1/2 z-30 w-12 h-24 flex items-center justify-center ${currentTheme.panelBg} hover:opacity-80 transition-all rounded-xl backdrop-blur-md group border ${currentTheme.border} shadow-lg`}
            style={{ backgroundColor: `rgba(${isDarkMode ? '0,0,0,0.4' : '255,255,255,0.7'})` }}
          >
            <svg className={`w-6 h-6 group-hover:text-white transition-colors`} style={{ color: currentTheme.accent }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </>
      )}

      {/* Current subtitle display when inside box - always visible regardless of UI toggle */}
      {isInsideBox && boxes[currentBoxIndex] && currentSlideIndex < boxes[currentBoxIndex].slides.length && (
        <div
          /* Con el menú oculto aparece la barra de láminas pegada al borde, así
             que el subtítulo sube para no quedar encima de ella. */
          className={`absolute ${showAllUI ? 'bottom-4' : 'bottom-14'} left-1/2 -translate-x-1/2 pointer-events-auto z-20 w-full max-w-2xl px-4 flex justify-center`}
        >
          <div className="text-center relative group">
            {getCurrentLinkUrl() ? (
              <a href={getCurrentLinkUrl()} target="_blank" rel="noopener noreferrer" className="inline-block transition-transform transform hover:scale-105" title="Ir al enlace">
                <h2 
                  className={`text-xl md:text-3xl font-light px-8 py-4 rounded-xl backdrop-blur-md cursor-pointer ${isDarkMode ? 'text-cyan-300 hover:text-white' : 'text-green-700 hover:text-green-900'} underline decoration-2 underline-offset-4`}
                  style={{
                    textShadow: isDarkMode ? '0 2px 10px rgba(0,0,0,1)' : '0 1px 2px rgba(255,255,255,0.8)',
                    background: isDarkMode 
                      ? 'linear-gradient(to top, rgba(0,0,0,0.8), rgba(0,0,0,0.4))'
                      : 'linear-gradient(to top, rgba(255,255,255,0.95), rgba(255,255,255,0.85))',
                    border: `1px solid ${isDarkMode ? 'rgba(0,255,255,0.4)' : 'rgba(34,197,94,0.4)'}`
                  }}
                >
                  {getCurrentSubtitle()} 🔗
                </h2>
              </a>
            ) : (
              <h2 
                className={`text-xl md:text-3xl font-light px-8 py-4 rounded-xl backdrop-blur-md ${isDarkMode ? 'text-white' : 'text-gray-800'}`}
                style={{
                  textShadow: isDarkMode ? '0 2px 10px rgba(0,0,0,1)' : '0 1px 2px rgba(255,255,255,0.8)',
                  background: isDarkMode 
                    ? 'linear-gradient(to top, rgba(0,0,0,0.8), rgba(0,0,0,0.4))'
                    : 'linear-gradient(to top, rgba(255,255,255,0.95), rgba(255,255,255,0.85))',
                  border: `1px solid ${isDarkMode ? 'rgba(0,255,255,0.2)' : 'rgba(34,197,94,0.2)'}`
                }}
              >
                {getCurrentSubtitle()}
              </h2>
            )}
          </div>
        </div>
      )}

      {/* Galería con la interfaz reducida (primer toque de H): quedan solo el
          botón de entrar y el indicador de sala. En el nivel 2 no queda nada.
          Se repite el marcado a propósito, para no condicionar media docena de
          bloques del panel completo. */}
      {!isInsideBox && nivelUI === 1 && (
        <div className="absolute bottom-0 left-0 right-0 p-4 z-10 pointer-events-none">
          <div className="flex justify-center gap-3 flex-wrap pointer-events-auto">
            <button
              onClick={() => enterBox(currentBoxIndex)}
              className="bg-gradient-to-r from-green-600 to-teal-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:from-green-500 hover:to-teal-500 transition shadow-lg shadow-green-500/25"
            >
              🚀 Entrar a Sala {currentBoxIndex + 1}
            </button>
            <div className={`flex gap-2 items-center ${currentTheme.panelBg} backdrop-blur-md rounded-xl p-1 border ${currentTheme.border}`}>
              <button
                onClick={() => {
                  const nuevo = (currentBoxIndex - 1 + boxes.length) % boxes.length;
                  setCurrentBox(nuevo);
                  focusOnBox(nuevo);
                }}
                className={`${currentTheme.text} px-3 py-1.5 rounded-lg hover:opacity-70 transition`}
              >
                ⬅️
              </button>
              <span className={`${currentTheme.text} text-sm px-2 font-medium`}>
                {currentBoxIndex + 1} / {boxes.length}
              </span>
              <button
                onClick={() => {
                  const nuevo = (currentBoxIndex + 1) % boxes.length;
                  setCurrentBox(nuevo);
                  focusOnBox(nuevo);
                }}
                className={`${currentTheme.text} px-3 py-1.5 rounded-lg hover:opacity-70 transition`}
              >
                ➡️
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom controls - Bird view */}
      {showAllUI && !isInsideBox && (
      <div className="absolute bottom-0 left-0 right-0 p-4 z-10 pointer-events-none">

        {/* Row 1: Nav + actions */}
        <div className="flex justify-center gap-3 flex-wrap pointer-events-auto mb-2">
          <button
            onClick={addBox}
            className="text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:opacity-90 transition shadow-lg"
            style={{ background: `linear-gradient(to right, ${currentTheme.accent}, ${isDarkMode ? '#16A34A' : '#16A34A'})` }}
          >
            ➕ Nueva Sala
          </button>

          <button
            onClick={() => {
              if (boxes.length <= 1) {
                alert('No puedes borrar la única sala existente.');
                return;
              }
              if (confirm(`¿Borrar la Sala ${currentBoxIndex + 1}?`)) {
                const boxId = boxes[currentBoxIndex].id;
                const newIndex = currentBoxIndex > 0 ? currentBoxIndex - 1 : 0;
                setCurrentBox(newIndex);
                removeBox(boxId);
                setTimeout(() => focusOnBox(newIndex), 100);
              }
            }}
            className="bg-gradient-to-r from-red-700 to-rose-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:from-red-600 hover:to-rose-500 transition shadow-lg shadow-red-500/25"
          >
            🗑️ Borrar Sala
          </button>

          <button
            onClick={() => enterBox(currentBoxIndex)}
            className="bg-gradient-to-r from-green-600 to-teal-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:from-green-500 hover:to-teal-500 transition shadow-lg shadow-green-500/25"
          >
            🚀 Entrar a Sala {currentBoxIndex + 1}
          </button>

          <div className={`flex gap-2 items-center ${currentTheme.panelBg} backdrop-blur-md rounded-xl p-1 border ${currentTheme.border}`}>
            <button
              onClick={() => {
                const newIndex = (currentBoxIndex - 1 + boxes.length) % boxes.length;
                setCurrentBox(newIndex);
                focusOnBox(newIndex);
              }}
              className={`${currentTheme.text} px-3 py-1.5 rounded-lg hover:opacity-70 transition`}
            >
              ⬅️
            </button>
            <span className={`${currentTheme.text} text-sm px-2 font-medium`}>
              {currentBoxIndex + 1} / {boxes.length}
            </span>
            <button
              onClick={() => {
                const newIndex = (currentBoxIndex + 1) % boxes.length;
                setCurrentBox(newIndex);
                focusOnBox(newIndex);
              }}
              className={`${currentTheme.text} px-3 py-1.5 rounded-lg hover:opacity-70 transition`}
            >
              ➡️
            </button>
          </div>
        </div>

        {/* Row 2: Local | Server (separated) */}
        <div className="flex justify-center gap-2 flex-wrap pointer-events-auto">
          {/* LOCAL group */}
          <div className={`flex gap-2 items-center ${currentTheme.panelBg} backdrop-blur-md rounded-xl px-2 py-1 border ${currentTheme.border}`}>
            <span className={`text-xs ${currentTheme.textMuted} pr-1`}>Local</span>
            <button
              onClick={handleExport}
              className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-4 py-2 rounded-lg text-xs font-semibold hover:from-blue-500 hover:to-indigo-500 transition shadow"
            >
              💾 Guardar
            </button>
            <label className="bg-gradient-to-r from-purple-600 to-pink-600 text-white px-4 py-2 rounded-lg text-xs font-semibold hover:from-purple-500 hover:to-pink-500 transition shadow cursor-pointer flex items-center">
              📂 Cargar
              <input
                type="file"
                accept=".json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImport(file);
                }}
              />
            </label>
          </div>

          {/* SERVER group */}
          <div className={`flex gap-2 items-center ${currentTheme.panelBg} backdrop-blur-md rounded-xl px-2 py-1 border ${currentTheme.border}`}>
            <span className={`text-xs ${currentTheme.textMuted} pr-1`}>Servidor</span>
            <button
              onClick={() => { setSaveFilename(''); setShowSaveModal(true); }}
              className="bg-gradient-to-r from-sky-600 to-blue-500 text-white px-4 py-2 rounded-lg text-xs font-semibold hover:from-sky-500 hover:to-blue-400 transition shadow"
            >
              ☁️ Guardar
            </button>
            <button
              onClick={handleLoadFromServer}
              className="bg-gradient-to-r from-fuchsia-600 to-purple-500 text-white px-4 py-2 rounded-lg text-xs font-semibold hover:from-fuchsia-500 hover:to-purple-400 transition shadow"
            >
              ☁️ Cargar
            </button>
          </div>

          {/* REINICIAR: volver al material de la catedra o dejar las salas
              vacias para armar una presentacion desde cero. */}
          <div className={`flex gap-2 items-center ${currentTheme.panelBg} backdrop-blur-md rounded-xl px-2 py-1 border ${currentTheme.border}`}>
            <span className={`text-xs ${currentTheme.textMuted} pr-1`}>Reiniciar</span>
            <button
              onClick={() => reiniciarContenido('presentacion')}
              title="Vuelve a cargar la presentación que viene con la app"
              className="bg-gradient-to-r from-emerald-600 to-teal-500 text-white px-4 py-2 rounded-lg text-xs font-semibold hover:from-emerald-500 hover:to-teal-400 transition shadow"
            >
              📽️ Presentación
            </button>
            <button
              onClick={() => reiniciarContenido('vacia')}
              title="Deja las 3 salas vacías para armar una presentación desde cero"
              className="bg-gradient-to-r from-slate-600 to-gray-500 text-white px-4 py-2 rounded-lg text-xs font-semibold hover:from-slate-500 hover:to-gray-400 transition shadow"
            >
              🧹 Vacía
            </button>
          </div>
        </div>

        <div className="flex justify-center gap-2 mt-3">
          {boxes.map((box, index) => (
            <button
              key={box.id}
              onClick={() => {
                setCurrentBox(index);
                focusOnBox(index);
              }}
              className={`transition-all ${
                index === currentBoxIndex
                  ? 'w-6 h-2.5 rounded-full'
                  : 'w-2.5 h-2.5 rounded-full opacity-50 hover:opacity-80'
              }`}
              style={{ backgroundColor: index === currentBoxIndex ? currentTheme.accent : (isDarkMode ? '#6b7280' : '#9ca3af') }}
              title={box.name}
            />
          ))}
        </div>
      </div>
      )}

      {/* Inside box controls panel - HORIZONTAL LAYOUT */}
      {isInsideBox && boxes[currentBoxIndex] && showAllUI && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-10 pointer-events-auto">
          <div className={`${currentTheme.panelBg} backdrop-blur-md rounded-2xl p-4 border ${currentTheme.border} shadow-lg`} style={{ minWidth: '560px' }}>
            <div className="flex items-center justify-between mb-3">
              <span className={`${currentTheme.text} font-semibold text-lg`}>{boxes[currentBoxIndex]?.name}</span>
              <span className="text-sm px-3 py-1 rounded-full" style={{ color: currentTheme.accent, backgroundColor: `${currentTheme.accent}20` }}>
                {currentSlideIndex < boxes[currentBoxIndex].slides.length ? `Pared ${currentSlideIndex + 1}` : (currentSlideIndex === boxes[currentBoxIndex].slides.length ? 'Piso' : 'Techo')} ({currentSlideIndex + 1}/{boxes[currentBoxIndex].slides.length})
              </span>
            </div>
            
            {/* Slide buttons - dynamic based on current box's slides, + add/remove buttons */}
            <div className="flex gap-2 items-center justify-center mb-4 flex-wrap">
              {boxes[currentBoxIndex].slides.map((_, idx) => (
                <div key={idx} className="relative group/lam">
                  <button
                    onClick={() => setCurrentSlide(idx)}
                    {...propsArrastre(idx)}
                    className={`w-10 h-10 rounded-xl font-medium transition text-sm cursor-grab active:cursor-grabbing ${
                      idx === currentSlideIndex
                        ? 'text-white shadow-lg'
                        : `${currentTheme.text} hover:opacity-70 border ${currentTheme.border}`
                    } ${laminaArrastrada !== null && laminaArrastrada !== idx ? 'ring-2 ring-dashed ring-[var(--theme-accent)]' : ''}`}
                    style={{
                      ...(idx === currentSlideIndex
                        ? { backgroundColor: currentTheme.accent }
                        : { backgroundColor: isDarkMode ? 'rgba(55,65,81,0.5)' : 'rgba(243,244,246,1)' }),
                      ['--theme-accent' as string]: currentTheme.accent,
                    } as React.CSSProperties}
                    title={`Pared ${idx + 1} — arrastrá para reordenar`}
                  >
                    {idx + 1}
                  </button>
                  {/* Insertar una lámina nueva justo después de ésta */}
                  <button
                    onClick={() => insertarLaminaDespues(idx)}
                    title={`Insertar una lámina después de la ${idx + 1}`}
                    className="absolute -right-1.5 -top-1.5 w-4 h-4 rounded-full bg-emerald-600 text-white text-[10px] leading-none flex items-center justify-center opacity-0 group-hover/lam:opacity-100 transition shadow"
                  >
                    +
                  </button>
                </div>
              ))}
              {/* Floor and ceiling */}
              {[{ label: 'P', title: 'Piso', idx: boxes[currentBoxIndex].slides.length }, { label: 'T', title: 'Techo', idx: boxes[currentBoxIndex].slides.length + 1 }].map(({ label, title, idx }) => (
                <button
                  key={title}
                  onClick={() => setCurrentSlide(idx)}
                  className={`w-10 h-10 rounded-xl font-medium transition text-sm ${
                    idx === currentSlideIndex
                      ? 'text-white shadow-lg'
                      : `${currentTheme.text} hover:opacity-70 border ${currentTheme.border}`
                  }`}
                  style={idx === currentSlideIndex ? { backgroundColor: currentTheme.accent } : { backgroundColor: isDarkMode ? 'rgba(55,65,81,0.5)' : 'rgba(243,244,246,1)' }}
                  title={title}
                >
                  {label}
                </button>
              ))}
              {/* Separator + add/remove + clear buttons */}
              <div className="w-px h-8 bg-gray-500/30 mx-1" />
              <button
                onClick={() => addSlide(currentBoxIndex)}
                className="w-10 h-10 rounded-xl font-bold transition text-sm bg-green-500/20 text-green-400 border border-green-500/50 hover:bg-green-500/40"
                title="Agregar imagen"
              >➕</button>
              <button
                onClick={() => {
                  const n = boxes[currentBoxIndex].slides.length;
                  if (n > 1 && currentSlideIndex < n) {
                    removeSlideAt(currentBoxIndex, currentSlideIndex);
                    // Move cursor back if we deleted the last visible slide
                    if (currentSlideIndex >= n - 1) setCurrentSlide(n - 2);
                  }
                }}
                className="w-10 h-10 rounded-xl font-bold transition text-sm bg-red-500/20 text-red-400 border border-red-500/50 hover:bg-red-500/40"
                title="Borrar imagen seleccionada"
              >➖</button>
              <button
                onClick={() => {
                  if (confirm('¿Borrar todas las imágenes de esta sala?')) {
                    const blank = Array.from({ length: 4 }, (_, i) => ({
                      id: `slide-${Date.now()}-${i}`,
                      imageUrl: '',
                      subtitle: ''
                    }));
                    setSlides(currentBoxIndex, blank);
                    updateFloor(boxes[currentBoxIndex].id, { imageUrl: '', subtitle: '' });
                    updateCeiling(boxes[currentBoxIndex].id, { imageUrl: '', subtitle: '' });
                    setCurrentSlide(0);
                  }
                }}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                onDrop={(e) => {
                  e.preventDefault();
                  const crudo = e.dataTransfer.getData('text/plain');
                  if (crudo !== '') eliminarLamina(Number(crudo));
                  else if (laminaArrastrada !== null) eliminarLamina(laminaArrastrada);
                  setLaminaArrastrada(null);
                }}
                className={`w-10 h-10 rounded-xl font-bold transition text-sm border ${
                  laminaArrastrada !== null
                    ? 'bg-red-600/70 text-white border-red-300 scale-110 ring-2 ring-red-300'
                    : 'bg-orange-500/20 text-orange-400 border-orange-500/50 hover:bg-orange-500/40'
                }`}
                title="Clic: borrar todas las imágenes de la sala · Arrastrá una lámina acá para borrar sólo esa"
              >🗑️</button>
            </div>

            {/* Edit controls - Horizontal layout */}
            <div className="flex gap-3 items-end">
              {/* Image upload + batch upload */}
              <div className="flex-shrink-0 flex flex-col gap-2">
                <label className={`${currentTheme.textMuted} text-xs block mb-1.5 uppercase tracking-wider`}>
                  {currentSlideIndex < boxes[currentBoxIndex].slides.length ? 'Pared' : (currentSlideIndex === boxes[currentBoxIndex].slides.length ? 'Piso' : 'Techo')} {currentSlideIndex + 1}
                </label>
                <label className={`block w-32 h-24 rounded-xl overflow-hidden border-2 ${currentTheme.border} cursor-pointer transition relative group`}
                  style={{ backgroundColor: isDarkMode ? '#1f2937' : '#f9fafb' }}
                >
                  <MediaPreview
                    src={getCurrentImage()}
                    alt={`Cara ${currentSlideIndex + 1}`}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                    <span className="text-white text-xs">📷 Cambiar</span>
                  </div>
                  <input
                    type="file"
                    accept="image/*,video/mp4,video/x-m4v,video/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleImageUpload(boxes[currentBoxIndex].id, currentSlideIndex, file);
                    }}
                  />
                </label>
                {/* Batch upload button */}
                <input
                  type="file"
                  ref={batchInputRef}
                  className="hidden"
                  multiple
                  accept="image/*,video/mp4"
                  onChange={handleBatchUpload}
                />
                <button
                  onClick={() => batchInputRef.current?.click()}
                  className={`w-32 py-1.5 rounded-xl text-xs font-semibold transition border ${currentTheme.border} ${currentTheme.text} hover:opacity-80`}
                  style={{ backgroundColor: isDarkMode ? 'rgba(0,255,255,0.1)' : 'rgba(34,197,94,0.1)' }}
                  title="Subir lote de imágenes/videos a esta sala"
                >
                  📁 Subir Lote
                </button>
              </div>
              
              {/* Subtitle y LinkUrl */}
              <div className="flex-1 flex flex-col gap-2">
                <div>
                  <label className={`${currentTheme.textMuted} text-xs block mb-1.5 uppercase tracking-wider`}>Subtítulo</label>
                  <input
                    type="text"
                    value={getCurrentSubtitle()}
                    onChange={(e) => {
                      const numSlides = boxes[currentBoxIndex].slides.length;
                      if (currentSlideIndex < numSlides) {
                        updateSlide(boxes[currentBoxIndex].id, currentSlideIndex, { subtitle: e.target.value });
                      } else if (currentSlideIndex === numSlides) {
                        updateFloor(boxes[currentBoxIndex].id, { subtitle: e.target.value });
                      } else if (currentSlideIndex === numSlides + 1) {
                        updateCeiling(boxes[currentBoxIndex].id, { subtitle: e.target.value });
                      }
                    }}
                    className={`w-full ${isDarkMode ? 'bg-gray-800/80 text-white border-gray-600 focus:border-cyan-400' : 'bg-gray-50 text-gray-800 border-gray-200 focus:border-[#22C55E]'} px-4 py-2 rounded-lg text-sm border focus:ring-2 focus:outline-none transition`}
                    placeholder="Editar subtítulo..."
                  />
                </div>
                <div>
                  <label className={`${currentTheme.textMuted} text-xs block mb-1.5 uppercase tracking-wider`}>URL del Enlace</label>
                  <input
                    type="text"
                    value={getCurrentLinkUrl()}
                    onChange={(e) => {
                      const numSlides = boxes[currentBoxIndex].slides.length;
                      if (currentSlideIndex < numSlides) {
                        updateSlide(boxes[currentBoxIndex].id, currentSlideIndex, { linkUrl: e.target.value });
                      } else if (currentSlideIndex === numSlides) {
                        updateFloor(boxes[currentBoxIndex].id, { linkUrl: e.target.value });
                      } else if (currentSlideIndex === numSlides + 1) {
                        updateCeiling(boxes[currentBoxIndex].id, { linkUrl: e.target.value });
                      }
                    }}
                    className={`w-full ${isDarkMode ? 'bg-gray-800/80 text-white border-gray-600 focus:border-cyan-400' : 'bg-gray-50 text-gray-800 border-gray-200 focus:border-[#22C55E]'} px-4 py-2 rounded-lg text-sm border focus:ring-2 focus:outline-none transition`}
                    placeholder="https://ejemplo.com"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Slide thumbnails when inside - 6 faces */}
      {/* Acceso directo a cualquier lámina, SOLO con el menú de edición oculto
          (tecla H). Miniatura y número, sin panel de fondo, para no tapar la
          proyección: con el editor abierto ya está la grilla numerada. */}
      {isInsideBox && boxes[currentBoxIndex] && nivelUI === 1 && (
        <div className="absolute bottom-1 left-1/2 -translate-x-1/2 z-20 pointer-events-auto max-w-[94vw] overflow-x-auto">
          <div className="flex gap-1.5 px-2 py-1">
            {boxes[currentBoxIndex].slides.map((slide, i) => (
              <button
                key={slide.id}
                type="button"
                onClick={() => setCurrentSlide(i)}
                title={`Ir a la lámina ${i + 1}`}
                className={`relative w-12 h-8 shrink-0 rounded overflow-hidden transition-all ${
                  i === currentSlideIndex
                    ? 'ring-2 ring-[var(--theme-accent)] scale-110'
                    : 'opacity-40 hover:opacity-90'
                }`}
                style={{ '--theme-accent': currentTheme.accent } as React.CSSProperties}
              >
                <MediaPreview
                  src={slide.imageUrl || '/zirkel/zirkel-logo.png'}
                  alt={`Lámina ${i + 1}`}
                  className="w-full h-full object-cover"
                />
                <span
                  className="absolute inset-x-0 bottom-0 text-[10px] font-bold leading-tight text-white text-center"
                  style={{ textShadow: '0 1px 3px rgba(0,0,0,1), 0 0 2px rgba(0,0,0,1)' }}
                >
                  {i + 1}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {isInsideBox && boxes[currentBoxIndex] && showAllUI && (
        <div className="absolute top-36 right-4 z-10 pointer-events-auto">
          <div className={`${currentTheme.panelBg} backdrop-blur-md rounded-xl p-2 border ${currentTheme.border} shadow-lg`}>
            <div className="grid grid-cols-3 gap-1.5">
              {/* 4 walls */}
              {boxes[currentBoxIndex].slides.map((slide, i) => (
                <div
                  key={slide.id}
                  {...propsArrastre(i)}
                  title={`Pared ${i + 1} — arrastrá para reordenar`}
                  className={`relative w-14 h-10 rounded-lg overflow-hidden cursor-grab active:cursor-grabbing transition-all group/min ${
                    i === currentSlideIndex
                      ? 'ring-2 scale-105 ring-[var(--theme-accent)]'
                      : 'opacity-50 hover:opacity-80'
                  } ${laminaArrastrada !== null && laminaArrastrada !== i ? 'ring-1 ring-dashed ring-[var(--theme-accent)]' : ''}`}
                  style={{ '--theme-accent': currentTheme.accent } as React.CSSProperties}
                  onClick={() => setCurrentSlide(i)}
                >
                  <MediaPreview
                    src={slide.imageUrl || '/zirkel/zirkel-logo.png'}
                    alt={`Pared ${i + 1}`}
                    className="w-full h-full object-cover"
                  />
                  {/* Insertar una lámina nueva justo después de ésta */}
                  <button
                    onClick={(e) => { e.stopPropagation(); insertarLaminaDespues(i); }}
                    title={`Insertar una lámina después de la ${i + 1}`}
                    className="absolute top-0 right-0 w-4 h-4 bg-emerald-600 text-white text-[10px] leading-none flex items-center justify-center opacity-0 group-hover/min:opacity-100 transition rounded-bl"
                  >
                    +
                  </button>
                  <div className={`absolute bottom-0 left-0 right-0 text-[9px] text-center py-0.5 ${isDarkMode ? 'bg-black/60 text-white' : 'bg-white/80 text-gray-700'}`}>
                    {i + 1}
                  </div>
                </div>
              ))}
              {/* Floor */}
              <div
                className={`relative w-14 h-10 rounded-lg overflow-hidden cursor-pointer transition-all ${
                  boxes[currentBoxIndex].slides.length === currentSlideIndex 
                    ? 'ring-2 scale-105 ring-[var(--theme-accent)]' 
                    : 'opacity-50 hover:opacity-80'
                }`}
                style={{ '--theme-accent': currentTheme.accent } as React.CSSProperties}
                onClick={() => setCurrentSlide(boxes[currentBoxIndex].slides.length)}
              >
                <MediaPreview
                  src={boxes[currentBoxIndex].floorImageUrl || '/zirkel/zirkel-logo.png'}
                  alt="Piso"
                  className="w-full h-full object-cover"
                />
                <div className={`absolute bottom-0 left-0 right-0 text-[9px] text-center py-0.5 ${isDarkMode ? 'bg-black/60 text-white' : 'bg-white/80 text-gray-700'}`}>
                  {boxes[currentBoxIndex].slides.length + 1}
                </div>
              </div>
              {/* Ceiling */}
              <div
                className={`relative w-14 h-10 rounded-lg overflow-hidden cursor-pointer transition-all ${
                  (boxes[currentBoxIndex].slides.length + 1) === currentSlideIndex 
                    ? 'ring-2 scale-105 ring-[var(--theme-accent)]' 
                    : 'opacity-50 hover:opacity-80'
                }`}
                style={{ '--theme-accent': currentTheme.accent } as React.CSSProperties}
                onClick={() => setCurrentSlide(boxes[currentBoxIndex].slides.length + 1)}
              >
                <MediaPreview
                  src={boxes[currentBoxIndex].ceilingImageUrl || '/zirkel/zirkel-logo.png'}
                  alt="Techo"
                  className="w-full h-full object-cover"
                />
                <div className={`absolute bottom-0 left-0 right-0 text-[9px] text-center py-0.5 ${isDarkMode ? 'bg-black/60 text-white' : 'bg-white/80 text-gray-700'}`}>
                  {boxes[currentBoxIndex].slides.length + 2}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}


      {/* Firma: el logo gira en 3D y al lado va la autoría. Se mantiene también
          con el menú oculto; sólo desaparece en el nivel de proyección limpia. */}
      {mostrarNavegacion && (
        <div className="absolute bottom-7 right-4 z-50 pointer-events-none select-none flex items-center gap-2">
          <span style={{ perspective: '140px', display: 'inline-block', lineHeight: 0 }}>
            <img
              src="/zirkel/zirkel-logo.png"
              alt="Zirkel"
              className="logo-zirkel-3d"
              style={{ width: 20, height: 20, objectFit: 'contain', display: 'block' }}
            />
          </span>
          <span className={`text-[11px] font-semibold tracking-wide ${currentTheme.textMuted}`}>
            Ing. Jorge Farez ®
          </span>
        </div>
      )}

      {/* Version footer */}
      {showAllUI && (
        <div className={`absolute bottom-2 right-4 z-50 pointer-events-none select-none text-xs font-semibold tracking-wide ${currentTheme.textMuted}`}>
          Zirkel Presentation ® {new Date().getFullYear()} — V. {version || 1}
        </div>
      )}

      {/* Upload Progress Overlay */}
      {isSaving && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-[60] pointer-events-auto">
          <div className={`${currentTheme.panelBg} p-8 rounded-2xl shadow-2xl border ${currentTheme.border} w-[360px] flex flex-col items-center gap-5`}>
            {/* Icon */}
            <div className="text-4xl animate-pulse">
              {saveProgress.label.includes('¡') ? '✅' : '☁️'}
            </div>
            {/* Label */}
            <p className={`${currentTheme.text} font-semibold text-center text-sm`}>
              {saveProgress.label}
            </p>
            {/* Progress bar */}
            {saveProgress.total > 0 && (
              <div className="w-full">
                <div className={`w-full h-3 rounded-full ${isDarkMode ? 'bg-gray-700' : 'bg-gray-200'} overflow-hidden`}>
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.round((saveProgress.current / saveProgress.total) * 100)}%`,
                      background: `linear-gradient(to right, ${currentTheme.accent}, ${isDarkMode ? '#a855f7' : '#16a34a'})`
                    }}
                  />
                </div>
                <p className={`text-xs ${currentTheme.textMuted} text-center mt-1`}>
                  {saveProgress.current} / {saveProgress.total} imágenes
                  {saveProgress.total > 0 && ` (${Math.round((saveProgress.current / saveProgress.total) * 100)}%)`}
                </p>
              </div>
            )}
            {/* Indeterminate bar for "Guardando JSON..." step */}
            {saveProgress.total === 0 && (
              <div className="w-full h-3 rounded-full overflow-hidden" style={{ background: isDarkMode ? '#1f2937' : '#e5e7eb' }}>
                <div
                  className="h-full rounded-full animate-pulse"
                  style={{ width: '100%', background: `linear-gradient(to right, ${currentTheme.accent}, transparent)` }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Download Progress Overlay */}
      {isLoading && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-[60] pointer-events-auto">
          <div className={`${currentTheme.panelBg} p-8 rounded-2xl shadow-2xl border ${currentTheme.border} w-[360px] flex flex-col items-center gap-5`}>
            {/* Icon */}
            <div className="text-4xl animate-pulse">
              {loadProgress.label.includes('¡') ? '✅' : '⬇️'}
            </div>
            {/* Label */}
            <p className={`${currentTheme.text} font-semibold text-center text-sm`}>
              {loadProgress.label}
            </p>
            {/* Progress bar with images */}
            {loadProgress.total > 0 && (
              <div className="w-full">
                <div className={`w-full h-3 rounded-full ${isDarkMode ? 'bg-gray-700' : 'bg-gray-200'} overflow-hidden`}>
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.round((loadProgress.current / loadProgress.total) * 100)}%`,
                      background: `linear-gradient(to right, ${isDarkMode ? '#06b6d4' : '#22c55e'}, ${isDarkMode ? '#a855f7' : '#16a34a'})`
                    }}
                  />
                </div>
                <p className={`text-xs ${currentTheme.textMuted} text-center mt-1`}>
                  {loadProgress.current} / {loadProgress.total} imágenes
                  {` (${Math.round((loadProgress.current / loadProgress.total) * 100)}%)`}
                </p>
              </div>
            )}
            {/* Indeterminate bar for initial JSON fetch */}
            {loadProgress.total === 0 && (
              <div className="w-full h-3 rounded-full overflow-hidden" style={{ background: isDarkMode ? '#1f2937' : '#e5e7eb' }}>
                <div
                  className="h-full rounded-full animate-pulse"
                  style={{ width: '100%', background: `linear-gradient(to right, ${isDarkMode ? '#06b6d4' : '#22c55e'}, transparent)` }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Save Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 pointer-events-auto">
          <div className={`${currentTheme.panelBg} p-6 rounded-2xl shadow-2xl border ${currentTheme.border} min-w-[300px]`}>
            <h3 className={`${currentTheme.text} font-bold text-lg mb-4`}>Guardar en Servidor</h3>
            <input 
              type="text" 
              value={saveFilename} 
              onChange={e => setSaveFilename(e.target.value)} 
              placeholder="Nombre de archivo (ej. mi-presentacion)"
              className={`w-full ${isDarkMode ? 'bg-gray-800/80 text-white border-gray-600' : 'bg-gray-50 text-gray-800 border-gray-200'} px-4 py-2 mb-4 rounded-xl text-sm border focus:ring-2 focus:ring-cyan-400 outline-none`}
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowSaveModal(false)} className={`px-4 py-2 rounded-xl text-sm ${currentTheme.text} hover:opacity-70 transition`}>Cancelar</button>
              <button onClick={handleSaveToServer} className="bg-gradient-to-r from-sky-600 to-blue-500 text-white px-4 py-2 rounded-xl text-sm font-bold shadow-lg">Guardar</button>
            </div>
          </div>
        </div>
      )}

      {/* Load Modal */}
      {showLoadModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 pointer-events-auto">
          <div className={`${currentTheme.panelBg} p-6 rounded-2xl shadow-2xl border ${currentTheme.border} w-[400px] max-h-[80vh] flex flex-col`}>
            <h3 className={`${currentTheme.text} font-bold text-lg mb-4`}>Cargar de Servidor</h3>
            {isLoadingBlobs ? (
              <p className={`${currentTheme.textMuted} text-center py-8`}>Cargando presentaciones...</p>
            ) : availableBlobs.length === 0 ? (
              <p className={`${currentTheme.textMuted} text-center py-8`}>No hay presentaciones guardadas.</p>
            ) : (
              <div className="flex-1 overflow-y-auto pr-2 space-y-2 mb-4">
                {availableBlobs.map((blob) => {
                  const nameDisplay = blob.pathname.replace('presentations/', '').replace('.json', '');
                  return (
                    <div key={blob.pathname} className={`flex justify-between items-center p-3 rounded-xl border ${currentTheme.border} ${isDarkMode ? 'bg-gray-800/50 hover:bg-gray-700/50' : 'bg-gray-100 hover:bg-gray-200'} transition`}>
                      <div className="flex-1 cursor-pointer truncate" onClick={() => loadSpecificBlob(blob.url)}>
                        <span className={`${currentTheme.text} font-medium text-sm`}>{nameDisplay}</span>
                      </div>
                      <div className="flex gap-3 items-center flex-shrink-0">
                        <button 
                          type="button"
                          onClick={() => loadSpecificBlob(blob.url)}
                          className="text-xs text-blue-400 hover:text-blue-300 transition"
                        >
                          Descargar
                        </button>
                        <button 
                          type="button"
                          onClick={(e) => handleDeleteBlob(e, blob.pathname)}
                          className="text-xs text-red-500 hover:text-red-400 p-1 rounded-md transition"
                          title="Borrar del servidor"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex justify-end mt-2">
              <button onClick={() => setShowLoadModal(false)} className={`px-4 py-2 rounded-xl text-sm ${currentTheme.text} hover:opacity-70 transition`}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
