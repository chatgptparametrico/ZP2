import { create } from 'zustand';
import { rolActual, veLaPresentacion } from './rol';

export interface SlideData {
  id: string;
  imageUrl: string;
  subtitle: string;
  linkUrl?: string;
}

export interface BoxData {
  id: string;
  name: string;
  slides: SlideData[]; // 4 slides for 4 walls (front, right, back, left)
  floorImageUrl: string;
  ceilingImageUrl: string;
  floorSubtitle: string;
  ceilingSubtitle: string;
  floorLinkUrl?: string;
  ceilingLinkUrl?: string;
}

export interface PresentationState {
  boxes: BoxData[];
  currentBoxIndex: number;
  isInsideBox: boolean;
  mouseEnabled: boolean;
  currentSlideIndex: number; // 0-3 for walls, 4=floor, 5=ceiling
  version: number;
  
  // Actions
  incrementVersion: () => void;
  addBox: () => void;
  removeBox: (id: string) => void;
  addSlide: (boxIndex: number) => void;
  removeSlide: (boxIndex: number) => void;
  removeSlideAt: (boxIndex: number, slideIndex: number) => void;
  updateSlide: (boxId: string, slideIndex: number, data: Partial<SlideData>) => void;
  updateFloor: (boxId: string, data: Partial<{ imageUrl: string; subtitle: string; linkUrl?: string }>) => void;
  updateCeiling: (boxId: string, data: Partial<{ imageUrl: string; subtitle: string; linkUrl?: string }>) => void;
  updateBoxName: (boxId: string, name: string) => void;
  setSlides: (boxIndex: number, slides: SlideData[]) => void;
  setCurrentBox: (index: number) => void;
  setInsideBox: (inside: boolean) => void;
  setMouseEnabled: (enabled: boolean) => void;
  setCurrentSlide: (index: number) => void;
  loadPresentation: (data: PresentationData) => void;
  getExportData: () => PresentationData;
}

interface PresentationData {
  boxes: BoxData[];
  version: string | number;
}

// Default images to show before loading
const defaultImages: string[] = [
  '/zirkel/zirkel-logo.png',
  '/zirkel/zirkel-logo.png',
  '/zirkel/zirkel-logo.png',
  '/zirkel/zirkel-logo.png',
  '/zirkel/zirkel-logo.png',
  '/zirkel/zirkel-logo.png',
];

const defaultSlides: string[] = defaultImages;

// Piso y techo de la sala (generados con scripts/generar_piso_techo.py):
// el piso lleva el logo repetido en los cuatro bordes, girado 0/90/180/270, para
// que se lea derecho desde la pared que estés mirando al girar el carrusel, sobre
// un transportador de anillos concéntricos. El techo es una lucarna octogonal con
// cielo procedural, y la losa alrededor recibe el derrame de luz de la abertura.
const PISO_SALA = '/zirkel/piso-zirkel.jpg';
const TECHO_SALA = '/zirkel/techo-lucarna.jpg';
// Los techos de la presentación por defecto: uno por sala, en rotación si hay
// más salas que techos. Las salas vacías siguen con la lucarna de siempre.
// Imágenes de la NASA, de dominio público: los «acantilados cósmicos» de la
// Nebulosa de Carina y la Nebulosa del Anillo Sur (Webb), y la galaxia del
// Remolino, M51 (Hubble). Recortadas en cuadrado a 1024 px o menos: el techo
// ocupa una franja chica de la pantalla.
const TECHOS_SALAS: string[] = [
  '/zirkel/techo-carina.jpg',
  '/zirkel/techo-anillo-sur-nir.jpg',
  '/zirkel/techo-remolino.jpg',
];

const createDefaultBox = (index: number): BoxData => ({
  id: `box-${Date.now()}-${index}`,
  name: `Presentación ${index + 1}`,
  slides: [
    { id: `slide-${Date.now()}-0`, imageUrl: defaultSlides[index % 6], subtitle: 'Diseño Paramétrico Estructural' },
    { id: `slide-${Date.now()}-1`, imageUrl: defaultSlides[(index + 1) % 6], subtitle: 'Análisis con Karamba3D' },
    { id: `slide-${Date.now()}-2`, imageUrl: defaultSlides[(index + 2) % 6], subtitle: 'Programación Visual Grasshopper' },
    { id: `slide-${Date.now()}-3`, imageUrl: defaultSlides[(index + 3) % 6], subtitle: 'Optimización Topológica' },
  ],
  floorImageUrl: PISO_SALA,
  ceilingImageUrl: TECHO_SALA,
  floorSubtitle: '',
  ceilingSubtitle: '',
});

// ── Contenido por defecto de la presentación ──────────────────────────
// Sale del PDF «La Salle [PRESENTACION FINAL]» (26-oct-2026): 202 láminas sobre
// el completamiento de las torres de la Catedral de La Plata, agrupadas en 4
// salas por tema. El material vive en public/presentacion-rev5/s1..s4,
// numerado por orden de lámina: cada página renderizada a 1024x576 sin la barra
// lateral de miniaturas (lo que queda se centra sobre negro, como el fondo del
// mazo). El «¡Gracias!» quedó como última lámina de la última sala.
// Cada lámina es [archivo] o [archivo, subtítulo]: sin subtítulo, el cartel
// del modo limpio no aparece.
type LaminaPorDefecto = [archivo: string, subtitulo?: string];

const laminasNumeradas = (cantidad: number): LaminaPorDefecto[] =>
  Array.from({ length: cantidad }, (_, i) => [`${i + 1}.jpg`]);

const SALAS_PRESENTACION: { nombre: string; laminas: LaminaPorDefecto[] }[] = [
  // Portada, contexto, fundaciones, ábside, fachada 1999, idea inicial y antecedentes.
  { nombre: 'Historia y contexto', laminas: laminasNumeradas(22) },
  // Etapas, túnel de viento, estructura metálica de las torres y avance de obra.
  { nombre: 'Estructura metálica y obra', laminas: laminasNumeradas(64) },
  // Pináculos, ventanas y ornamentos en símil piedra: diseño, fabricación y obra civil.
  { nombre: 'Símil piedra', laminas: laminasNumeradas(59) },
  // Campanario, fachada, esculturas y ornamentación y cubierta de cobre.
  { nombre: 'Campanario, fachada y cobre', laminas: laminasNumeradas(57) },
];

const crearSalaConMedia = (index: number, sala: { nombre: string; laminas: LaminaPorDefecto[] }): BoxData => ({
  id: `box-${Date.now()}-${index}`,
  name: sala.nombre,
  slides: sala.laminas.map(([archivo, subtitulo], i) => ({
    id: `slide-${Date.now()}-${index}-${i}`,
    // Un nombre suelto vive en la carpeta de la sala; uno que ya empieza con /
    // es un asset compartido y se usa tal cual.
    imageUrl: archivo.startsWith('/') ? archivo : `/presentacion-rev5/s${index + 1}/${archivo}`,
    subtitle: subtitulo ?? '',
  })),
  floorImageUrl: PISO_SALA,
  ceilingImageUrl: TECHOS_SALAS[index % TECHOS_SALAS.length],
  floorSubtitle: '',
  ceilingSubtitle: '',
});

// Salas vacías: las 3 con el logo, sin contenido. Es el punto de partida para
// armar una presentación desde cero. Lo usa el botón "Reiniciar → Vacía".
export const crearSalasVacias = (): BoxData[] => [
  createDefaultBox(0),
  createDefaultBox(1),
  createDefaultBox(2),
];

// Cada sala trae exactamente las diapositivas que le tocan: acá no se reparte
// nada, el agrupamiento ya viene decidido desde la app.
export const crearSalasIniciales = (): BoxData[] =>
  SALAS_PRESENTACION.map((sala, i) => crearSalaConMedia(i, sala));

// Con qué arranca la app según quién entró. El público ve las salas vacías para
// armar la suya: el material del congreso además lo bloquea el servidor, así que
// esto es lo que se ve, no lo que protege.
const salasSegunRol = (): BoxData[] =>
  veLaPresentacion(rolActual()) ? crearSalasIniciales() : crearSalasVacias();

export const usePresentationStore = create<PresentationState>((set, get) => ({
  // Arranca con la presentación cargada: 4 salas con todo el material en las
  // paredes. Con "Nueva Sala" se agregan las que hagan falta.
  boxes: salasSegunRol(),
  currentBoxIndex: 0,
  isInsideBox: false,
  mouseEnabled: true,
  currentSlideIndex: 0,
  version: 1,

  incrementVersion: () => set((state) => ({ version: state.version + 1 })),

  addBox: () => set((state) => ({
    boxes: [...state.boxes, createDefaultBox(state.boxes.length)],
    version: state.version + 1
  })),

  removeBox: (id: string) => set((state) => ({
    boxes: state.boxes.filter(box => box.id !== id),
    version: state.version + 1
  })),

  addSlide: (boxIndex: number) => set((state) => ({
    boxes: state.boxes.map((box, i) => {
      if (i !== boxIndex) return box;
      const newSlide: SlideData = { id: `slide-${Date.now()}`, imageUrl: '', subtitle: '' };
      return { ...box, slides: [...box.slides, newSlide] };
    }),
    version: state.version + 1
  })),

  removeSlide: (boxIndex: number) => set((state) => ({
    boxes: state.boxes.map((box, i) => {
      if (i !== boxIndex || box.slides.length <= 1) return box;
      return { ...box, slides: box.slides.slice(0, -1) };
    }),
    version: state.version + 1
  })),

  removeSlideAt: (boxIndex: number, slideIndex: number) => set((state) => ({
    boxes: state.boxes.map((box, i) => {
      if (i !== boxIndex || box.slides.length <= 1) return box;
      const newSlides = box.slides.filter((_, idx) => idx !== slideIndex);
      return { ...box, slides: newSlides };
    }),
    version: state.version + 1
  })),

  updateSlide: (boxId: string, slideIndex: number, data: Partial<SlideData>) => set((state) => ({
    boxes: state.boxes.map(box => {
      if (box.id === boxId) {
        const newSlides = [...box.slides];
        if (slideIndex >= 0 && slideIndex < newSlides.length) {
          newSlides[slideIndex] = { ...newSlides[slideIndex], ...data };
        }
        return { ...box, slides: newSlides };
      }
      return box;
    }),
    version: state.version + 1
  })),

  updateFloor: (boxId, data) => set((state) => ({
    boxes: state.boxes.map(box => 
      box.id === boxId ? { 
        ...box, 
        floorImageUrl: data.imageUrl !== undefined ? data.imageUrl : box.floorImageUrl,
        floorSubtitle: data.subtitle !== undefined ? data.subtitle : box.floorSubtitle,
        floorLinkUrl: data.linkUrl !== undefined ? data.linkUrl : box.floorLinkUrl
      } : box
    ),
    version: state.version + 1
  })),

  updateCeiling: (boxId, data) => set((state) => ({
    boxes: state.boxes.map(box => 
      box.id === boxId ? { 
        ...box, 
        ceilingImageUrl: data.imageUrl !== undefined ? data.imageUrl : box.ceilingImageUrl,
        ceilingSubtitle: data.subtitle !== undefined ? data.subtitle : box.ceilingSubtitle,
        ceilingLinkUrl: data.linkUrl !== undefined ? data.linkUrl : box.ceilingLinkUrl
      } : box
    ),
    version: state.version + 1
  })),

  updateBoxName: (boxId: string, name: string) => set((state) => ({
    boxes: state.boxes.map(box => 
      box.id === boxId ? { ...box, name } : box
    ),
    version: state.version + 1
  })),

  setSlides: (boxIndex: number, slides: SlideData[]) => set((state) => ({
    boxes: state.boxes.map((box, i) => 
      i === boxIndex ? { ...box, slides } : box
    ),
    version: state.version + 1
  })),

  setCurrentBox: (index: number) => set({ currentBoxIndex: index }),
  
  setInsideBox: (inside: boolean) => set({ isInsideBox: inside }),
  
  setMouseEnabled: (enabled: boolean) => set({ mouseEnabled: enabled }),
  
  setCurrentSlide: (index: number) => set({ currentSlideIndex: index }),

  loadPresentation: (data: PresentationData) => set((state) => ({
    boxes: data.boxes,
    version: typeof data.version === 'number' ? data.version : state.version + 1
  })),

  getExportData: () => ({
    boxes: get().boxes,
    version: get().version
  })
}));
