import { create } from 'zustand';

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

const createDefaultBox = (index: number): BoxData => ({
  id: `box-${Date.now()}-${index}`,
  name: `Presentación ${index + 1}`,
  slides: [
    { id: `slide-${Date.now()}-0`, imageUrl: defaultSlides[index % 6], subtitle: 'Diseño Paramétrico Estructural' },
    { id: `slide-${Date.now()}-1`, imageUrl: defaultSlides[(index + 1) % 6], subtitle: 'Análisis con Karamba3D' },
    { id: `slide-${Date.now()}-2`, imageUrl: defaultSlides[(index + 2) % 6], subtitle: 'Programación Visual Grasshopper' },
    { id: `slide-${Date.now()}-3`, imageUrl: defaultSlides[(index + 3) % 6], subtitle: 'Optimización Topológica' },
  ],
  floorImageUrl: '/images/slides/slide5.png',
  ceilingImageUrl: '/images/slides/slide6.png',
  floorSubtitle: 'Estructura Base',
  ceilingSubtitle: 'Sistema de Cubierta',
});

// ── Contenido por defecto de la presentación ────────────────────────────────
// Los archivos viven en public/presentacion, ya optimizados para proyector
// (imágenes y videos a 1280x720). El orden es el de los números del original.
// Todo va en las PAREDES: piso y techo quedan con el logo, sin contenido, para
// que no haya material escondido mirando hacia arriba o hacia abajo.
// Las salas tienen 4 paredes físicas: cuando hay más láminas que paredes, el
// visor las va rotando a medida que se avanza con ↓, así que una sala admite
// tantas láminas como haga falta.
const MEDIA_PRESENTACION: string[] = [
  '1.jpg', '2.mp4', '3.mp4', '4.mp4', '5.mp4', '6.mp4', '7.jpg', '8.mp4', '9.jpg',
  '10.jpg', '11.mp4', '12.mp4', '13.jpg', '14.jpg', '15.jpg', '16.jpg', '17.jpg', '18.jpg',
  '19.jpg', '20.jpg', '21.jpg', '22.jpg', '23.jpg', '24.jpg', '25.jpg', '26.jpg', '27.jpg',
  '28.jpg', '29.jpg', '30.jpg', '31.jpg', '32.jpg', '33.jpg', '34.mp4', '35.mp4', '36.jpg',
  '37.mp4', '38.mp4', '39.mp4', '40.jpg', '41.jpg', '42.jpg', '43.jpg',
];

const SALAS_INICIALES = 3;

const crearSalaConMedia = (index: number, archivos: string[]): BoxData => ({
  id: `box-${Date.now()}-${index}`,
  name: `Presentación ${index + 1}`,
  slides: archivos.map((archivo, i) => ({
    id: `slide-${Date.now()}-${index}-${i}`,
    imageUrl: `/presentacion/${archivo}`,
    subtitle: '',
  })),
  floorImageUrl: '/zirkel/zirkel-logo.png',
  ceilingImageUrl: '/zirkel/zirkel-logo.png',
  floorSubtitle: '',
  ceilingSubtitle: '',
});

// Salas vacías: las 3 con el logo, sin contenido. Es el punto de partida para
// armar una presentación desde cero (lo que hacía la app antes de traer el
// material). Lo usa el botón "Reiniciar → Vacía".
export const crearSalasVacias = (): BoxData[] => [
  createDefaultBox(0),
  createDefaultBox(1),
  createDefaultBox(2),
];

// Reparte los archivos en partes lo más parejas posible (43 en 3 salas = 15/14/14).
export const crearSalasIniciales = (): BoxData[] => {
  const total = MEDIA_PRESENTACION.length;
  const salas: BoxData[] = [];
  let desde = 0;
  for (let i = 0; i < SALAS_INICIALES; i++) {
    const cuantas = Math.ceil((total - desde) / (SALAS_INICIALES - i));
    salas.push(crearSalaConMedia(i, MEDIA_PRESENTACION.slice(desde, desde + cuantas)));
    desde += cuantas;
  }
  return salas;
};

export const usePresentationStore = create<PresentationState>((set, get) => ({
  // Arranca con la presentación cargada: 3 salas con todo el material en las
  // paredes. Con "Nueva Sala" se agregan las que hagan falta.
  boxes: crearSalasIniciales(),
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
