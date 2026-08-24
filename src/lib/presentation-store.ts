import { create } from 'zustand';
import { esDeLaCasa, rolActual } from './rol';

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
// Es la presentación final: la organización sale del JSON exportado desde la
// propia app (4 salas de 19/31/46/4 diapositivas) y los archivos son esos mismos ya
// optimizados —videos re-codificados a 1920 de ancho con audio mono; el de
// 3240 px que pesaba 85 MB quedó en 13—. Viven en public/presentacion-rev3/s1..s4
// numerados por orden de diapositiva: los huecos en la secuencia .jpg son videos.
// El piso y el techo son los de siempre, iguales en las cuatro salas.
const SALAS_PRESENTACION: string[][] = [
  [
    '1.jpg', '2.mp4', '3.mp4', '4.mp4', '5.mp4', '6.mp4', '7.mp4', '8.mp4', '9.mp4',
    '10.mp4', '11.jpg', '12.jpg', '13.mp4', '14.mp4', '15.jpg', '16.jpg', '17.jpg', '18.mp4',
    '19.mp4',
  ],
  [
    '1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg', '7.jpg', '8.jpg', '9.jpg',
    '10.jpg', '11.jpg', '12.jpg', '13.jpg', '14.jpg', '15.jpg', '16.jpg', '17.jpg', '18.jpg',
    '19.jpg', '20.jpg', '21.jpg', '22.jpg', '23.jpg', '24.jpg', '25.jpg', '26.jpg', '27.jpg',
    '28.jpg', '29.jpg', '30.jpg', '31.jpg',
  ],
  [
    '1.mp4', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg', '7.jpg', '8.jpg', '9.jpg',
    '10.jpg', '11.jpg', '12.jpg', '13.jpg', '14.jpg', '15.jpg', '16.jpg', '17.jpg', '18.jpg',
    '19.jpg', '20.jpg', '21.jpg', '22.jpg', '23.jpg', '24.jpg', '25.jpg', '26.jpg', '27.jpg',
    '28.jpg', '29.jpg', '30.jpg', '31.jpg', '32.jpg', '33.jpg', '34.jpg', '35.mp4', '36.jpg',
    '37.jpg', '38.jpg', '39.jpg', '40.jpg', '41.jpg', '42.jpg', '43.jpg', '44.mp4', '45.jpg',
    '46.jpg',
  ],
  [
    '1.mp4', '2.jpg', '3.jpg', '4.jpg',
  ],
];

const crearSalaConMedia = (index: number, archivos: string[]): BoxData => ({
  id: `box-${Date.now()}-${index}`,
  name: `Presentación ${index + 1}`,
  slides: archivos.map((archivo, i) => ({
    id: `slide-${Date.now()}-${index}-${i}`,
    imageUrl: `/presentacion-rev3/s${index + 1}/${archivo}`,
    subtitle: '',
  })),
  floorImageUrl: PISO_SALA,
  ceilingImageUrl: TECHO_SALA,
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
  SALAS_PRESENTACION.map((archivos, i) => crearSalaConMedia(i, archivos));

// Con qué arranca la app según quién entró. El público ve las salas vacías para
// armar la suya: el material del congreso además lo bloquea el servidor, así que
// esto es lo que se ve, no lo que protege.
const salasSegunRol = (): BoxData[] =>
  esDeLaCasa(rolActual()) ? crearSalasIniciales() : crearSalasVacias();

export const usePresentationStore = create<PresentationState>((set, get) => ({
  // Arranca con la presentación cargada: 3 salas con todo el material en las
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
