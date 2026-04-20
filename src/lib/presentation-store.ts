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

export const usePresentationStore = create<PresentationState>((set, get) => ({
  boxes: [
    createDefaultBox(0),
    createDefaultBox(1),
    createDefaultBox(2),
    createDefaultBox(3),
    createDefaultBox(4),
  ],
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
