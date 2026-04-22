'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { usePresentationStore } from '@/lib/presentation-store';

const loadMediaAsTexture = (url: string, onLoad: (texture: THREE.Texture) => void) => {
  if (!url) return;
  const isVideo = url.startsWith('data:video/') || url.endsWith('.mp4');
  if (isVideo) {
    const video = document.createElement('video');
    video.src = url;
    video.crossOrigin = 'anonymous';
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.play().catch(e => console.error("Auto-play prevented", e));
    const texture = new THREE.VideoTexture(video);
    onLoad(texture);
  } else {
    new THREE.TextureLoader().load(url, (texture) => {
      onLoad(texture);
    });
  }
};

const MediaPreview = ({ src, alt, className }: { src: string; alt?: string; className?: string }) => {
  const isVideo = src?.startsWith('data:video/') || src?.endsWith('.mp4');
  if (isVideo) {
    return <video src={src} className={className} autoPlay loop muted playsInline />;
  }
  return <img src={src} alt={alt || 'Media'} className={className} />;
};


export default function Presentation3D() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const boxesRef = useRef<THREE.Group[]>([]);
  const insideBoxGroupRef = useRef<THREE.Group | null>(null);
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
  const [showAllUI, setShowAllUI] = useState(true);
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
      const innerMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.FrontSide,
        toneMapped: false,
      });
      
      loadMediaAsTexture(imageUrl, (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.toneMapped = false;
        texture.repeat.x = -1;
        texture.offset.x = 1;
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

    const wireframeGeometry = new THREE.BoxGeometry(wallWidth, wallHeight, wallWidth);
    const wireframeMaterial = new THREE.MeshBasicMaterial({ 
      color: parseInt(currentTheme.accent.replace('#', '0x')), 
      wireframe: true,
      transparent: true,
      opacity: 0.5
    });
    const wireframe = new THREE.Mesh(wireframeGeometry, wireframeMaterial);
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

    const miniCubeSize = 0.4;
    const miniCubeGap = 1.0;
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
        floatOffset: Math.random() * Math.PI * 2
      };
      miniCubeGroup.add(miniCube);
      const edgesGeometry = new THREE.EdgesGeometry(geometry);
      const edgesMaterial = new THREE.LineBasicMaterial({ color: parseInt(currentTheme.accent.replace('#', '0x')), linewidth: 1 });
      const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial);
      miniCubeGroup.add(edges);
      miniCubeGroup.position.set(startX + index * miniCubeGap, wallHeight / 2 + 1.8, 3);
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

    // Update background
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const gradient = ctx.createLinearGradient(0, 0, 0, 512);
      if (isDarkMode) {
        gradient.addColorStop(0, '#1a1a2e');
        gradient.addColorStop(1, '#0a0a0f');
      } else {
        gradient.addColorStop(0, '#E0F4FF');
        gradient.addColorStop(1, '#FFFFFF');
      }
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 2, 512);
    }
    const texture = new THREE.CanvasTexture(canvas);
    scene.background = texture;
    scene.fog = new THREE.Fog(isDarkMode ? 0x0a0a0f : 0xFFFFFF, 50, 200);

    // Update grid color and opacity
    const existingGrid = scene.getObjectByName('gridHelper');
    if (existingGrid) {
      scene.remove(existingGrid);
    }
    
    // Create new grid with updated colors
    const gridColor = isDarkMode ? 0x1a1a2e : 0xE0E0E0;
    const newGrid = new THREE.GridHelper(100, 50, gridColor, gridColor);
    newGrid.name = 'gridHelper';
    if (!isDarkMode) {
      (newGrid.material as THREE.Material).transparent = true;
      (newGrid.material as THREE.Material).opacity = 0.5;
    }
    scene.add(newGrid);
  }, [isDarkMode]);

  // Create/update boxes for bird view
  useEffect(() => {
    if (!sceneRef.current || isInsideBox) return;

    boxesRef.current.forEach(box => {
      sceneRef.current?.remove(box);
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
          insideBoxGroupRef.current.traverse((child) => {
            if (child.userData && child.userData.isMiniNavCube) {
              // Rotate the cube
              child.rotation.y += child.userData.rotationSpeed || 0.01;
              child.rotation.x += (child.userData.rotationSpeed || 0.01) * 0.5;

              // Float up and down
              if (child.parent && child.userData.floatOffset !== undefined) {
                child.parent.position.y = child.parent.position.y + Math.sin(time + child.userData.floatOffset) * 0.002;
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
    container.addEventListener('click', handleClick);

    return () => {
      container.removeEventListener('mousedown', handleMouseDown);
      container.removeEventListener('mouseup', handleMouseUp);
      container.removeEventListener('mousemove', handleMouseMove);
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('click', handleClick);
    };
  }, [mouseEnabled, isInsideBox, currentBoxIndex, setCurrentBox, focusOnBox, exitBox]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowLeft':
          if (isInsideBox) {
            const total = boxes[currentBoxIndex]?.slides?.length ? boxes[currentBoxIndex].slides.length + 2 : 6;
            const newSlideIndex = (currentSlideIndex - 1 + total) % total;
            setCurrentSlide(newSlideIndex);
          } else {
            const newBoxIndex = (currentBoxIndex - 1 + boxes.length) % boxes.length;
            setCurrentBox(newBoxIndex);
            focusOnBox(newBoxIndex);
          }
          break;
        case 'ArrowRight':
          if (isInsideBox) {
            const total = boxes[currentBoxIndex]?.slides?.length ? boxes[currentBoxIndex].slides.length + 2 : 6;
            const newSlideIndex = (currentSlideIndex + 1) % total;
            setCurrentSlide(newSlideIndex);
          } else {
            const newBoxIndex = (currentBoxIndex + 1) % boxes.length;
            setCurrentBox(newBoxIndex);
            focusOnBox(newBoxIndex);
          }
          break;
        case 'ArrowUp':
          if (isInsideBox) {
            targetCameraPositionRef.current.y = Math.min(5, targetCameraPositionRef.current.y + 0.5);
          }
          break;
        case 'ArrowDown':
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
          setShowAllUI((prev) => !prev);
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
  const getCurrentSubtitle = () => {
    if (!boxes[currentBoxIndex]) return '';
    const numSlides = boxes[currentBoxIndex].slides.length;
    if (currentSlideIndex < numSlides) {
      return boxes[currentBoxIndex].slides[currentSlideIndex]?.subtitle || '';
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
                  <li className="flex items-center gap-2">⬅️➡️ Cambiar cara</li>
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
            onClick={() => setShowAllUI((prev) => !prev)}
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
      {isInsideBox && boxes[currentBoxIndex] && (
        <>
          <button
            onClick={() => {
              const total = boxes[currentBoxIndex].slides.length + 2;
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
              const total = boxes[currentBoxIndex].slides.length + 2;
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
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-auto z-20 w-full max-w-2xl px-4 flex justify-center">
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
                {currentSlideIndex < boxes[currentBoxIndex].slides.length ? `Pared ${currentSlideIndex + 1}` : (currentSlideIndex === boxes[currentBoxIndex].slides.length ? 'Piso' : 'Techo')} ({currentSlideIndex + 1}/{boxes[currentBoxIndex].slides.length + 2})
              </span>
            </div>
            
            {/* Slide buttons - dynamic based on current box's slides, + add/remove buttons */}
            <div className="flex gap-2 items-center justify-center mb-4 flex-wrap">
              {boxes[currentBoxIndex].slides.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setCurrentSlide(idx)}
                  className={`w-10 h-10 rounded-xl font-medium transition text-sm ${
                    idx === currentSlideIndex
                      ? 'text-white shadow-lg'
                      : `${currentTheme.text} hover:opacity-70 border ${currentTheme.border}`
                  }`}
                  style={idx === currentSlideIndex ? { backgroundColor: currentTheme.accent } : { backgroundColor: isDarkMode ? 'rgba(55,65,81,0.5)' : 'rgba(243,244,246,1)' }}
                  title={`Pared ${idx + 1}`}
                >
                  {idx + 1}
                </button>
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
                className="w-10 h-10 rounded-xl font-bold transition text-sm bg-orange-500/20 text-orange-400 border border-orange-500/50 hover:bg-orange-500/40"
                title="Borrar todas las imágenes de la sala"
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
      {isInsideBox && boxes[currentBoxIndex] && showAllUI && (
        <div className="absolute top-36 right-4 z-10 pointer-events-auto">
          <div className={`${currentTheme.panelBg} backdrop-blur-md rounded-xl p-2 border ${currentTheme.border} shadow-lg`}>
            <div className="grid grid-cols-3 gap-1.5">
              {/* 4 walls */}
              {boxes[currentBoxIndex].slides.map((slide, i) => (
                <div
                  key={slide.id}
                  className={`relative w-14 h-10 rounded-lg overflow-hidden cursor-pointer transition-all ${
                    i === currentSlideIndex 
                      ? 'ring-2 scale-105 ring-[var(--theme-accent)]' 
                      : 'opacity-50 hover:opacity-80'
                  }`}
                  style={{ '--theme-accent': currentTheme.accent } as React.CSSProperties}
                  onClick={() => setCurrentSlide(i)}
                >
                  <MediaPreview
                    src={slide.imageUrl || '/zirkel/zirkel-logo.png'}
                    alt={`Pared ${i + 1}`}
                    className="w-full h-full object-cover"
                  />
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
