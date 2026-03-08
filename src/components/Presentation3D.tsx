'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { usePresentationStore } from '@/lib/presentation-store';
import MiniCubeNav from './MiniCubeNav';

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
  
  const [showControls, setShowControls] = useState(true);
  const [showAllUI, setShowAllUI] = useState(true);
  const [isDarkMode, setIsDarkMode] = useState(true); // Theme toggle


  const {
    boxes,
    currentBoxIndex,
    isInsideBox,
    mouseEnabled,
    currentSlideIndex,
    addBox,
    updateSlide,
    updateFloor,
    updateCeiling,
    setCurrentBox,
    setInsideBox,
    setMouseEnabled,
    setCurrentSlide,
    loadPresentation,
    getExportData
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
    
    const textureLoader = new THREE.TextureLoader();
    
    const wallPositions = [
      { pos: [0, wallHeight / 2, -wallWidth / 2], rot: [0, 0, 0], slideIndex: 0 },
      { pos: [wallWidth / 2, wallHeight / 2, 0], rot: [0, -Math.PI / 2, 0], slideIndex: 1 },
      { pos: [0, wallHeight / 2, wallWidth / 2], rot: [0, Math.PI, 0], slideIndex: 2 },
      { pos: [-wallWidth / 2, wallHeight / 2, 0], rot: [0, Math.PI / 2, 0], slideIndex: 3 },
    ];

    wallPositions.forEach((wall, wallIndex) => {
      const slide = boxData.slides[wallIndex];
      
      const outerGeometry = new THREE.PlaneGeometry(wallWidth, wallHeight);
      const outerMaterial = new THREE.MeshBasicMaterial({
        side: THREE.FrontSide,
        toneMapped: false,
      });
      
      textureLoader.load(slide.imageUrl, (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.toneMapped = false;
        outerMaterial.map = texture;
        outerMaterial.needsUpdate = true;
      });
      
      const outerMesh = new THREE.Mesh(outerGeometry, outerMaterial);
      outerMesh.position.set(wall.pos[0], wall.pos[1], wall.pos[2]);
      outerMesh.rotation.set(wall.rot[0], wall.rot[1], wall.rot[2]);
      outerMesh.userData = { isWall: true, slideIndex: wall.slideIndex, boxId: boxData.id };
      group.add(outerMesh);
      
      const innerGeometry = new THREE.PlaneGeometry(wallWidth, wallHeight);
      const innerMaterial = new THREE.MeshBasicMaterial({
        side: THREE.FrontSide,
        toneMapped: false,
      });
      
      textureLoader.load(slide.imageUrl, (texture) => {
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
      color: isDarkMode ? 0x1a1a2e : 0xFFFFFF,
      side: THREE.DoubleSide 
    });
    textureLoader.load(boxData.floorImageUrl, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      floorMaterial.map = texture;
      floorMaterial.needsUpdate = true;
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    group.add(floor);
    
    // Shadow
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
      color: isDarkMode ? 0x2a2a3e : 0xE8F4FC,
      side: THREE.DoubleSide 
    });
    textureLoader.load(boxData.ceilingImageUrl, (texture) => {
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
  }, [isDarkMode, currentTheme.accent]);

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
    
    const textureLoader = new THREE.TextureLoader();
    
    const wallPositions = [
      { pos: [0, wallHeight / 2, -wallWidth / 2], rot: [0, Math.PI, 0], slideIndex: 0, name: 'back' },
      { pos: [wallWidth / 2, wallHeight / 2, 0], rot: [0, Math.PI / 2, 0], slideIndex: 1, name: 'right' },
      { pos: [0, wallHeight / 2, wallWidth / 2], rot: [0, 0, 0], slideIndex: 2, name: 'front' },
      { pos: [-wallWidth / 2, wallHeight / 2, 0], rot: [0, -Math.PI / 2, 0], slideIndex: 3, name: 'left' },
    ];

    wallPositions.forEach((wall) => {
      const slide = boxData.slides[wall.slideIndex];
      
      const geometry = new THREE.PlaneGeometry(wallWidth, wallHeight);
      const material = new THREE.MeshBasicMaterial({
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      
      textureLoader.load(slide.imageUrl, (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.toneMapped = false;
        material.map = texture;
        material.needsUpdate = true;
      });
      
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(wall.pos[0], wall.pos[1], wall.pos[2]);
      mesh.rotation.set(wall.rot[0], wall.rot[1], wall.rot[2]);
      mesh.userData = { isWall: true, slideIndex: wall.slideIndex, boxId: boxData.id, wallName: wall.name };
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
      color: isDarkMode ? 0x333344 : 0xFFFFFF,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    textureLoader.load(boxData.floorImageUrl, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.toneMapped = false;
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
      color: isDarkMode ? 0x444455 : 0xE8F4FC,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    textureLoader.load(boxData.ceilingImageUrl, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.toneMapped = false;
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

    return group;
  }, [isDarkMode, currentTheme.accent]);

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
        // Handle slide-based camera orientation (0-3 = walls, 4 = floor, 5 = ceiling)
        if (currentSlideIndex <= 3) {
          // Walls - horizontal rotation
          targetCameraAngleRef.current = currentSlideIndex * (Math.PI / 2);
          targetCameraPitchRef.current = 0;
        } else if (currentSlideIndex === 4) {
          // Floor - look down
          targetCameraPitchRef.current = -Math.PI / 2 + 0.3;
        } else if (currentSlideIndex === 5) {
          // Ceiling - look up
          targetCameraPitchRef.current = Math.PI / 2 - 0.3;
        }
        
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
        // Vertical look (pitch)
        targetCameraPitchRef.current += deltaY * 0.003;
        targetCameraPitchRef.current = Math.max(-Math.PI/2 + 0.1, Math.min(Math.PI/2 - 0.1, targetCameraPitchRef.current));
        cameraPitchRef.current = targetCameraPitchRef.current;
        // Height
        targetCameraPositionRef.current.y += deltaY * 0.02;
        targetCameraPositionRef.current.y = Math.max(0.5, Math.min(5, targetCameraPositionRef.current.y));
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

    return () => {
      container.removeEventListener('mousedown', handleMouseDown);
      container.removeEventListener('mouseup', handleMouseUp);
      container.removeEventListener('mousemove', handleMouseMove);
      container.removeEventListener('wheel', handleWheel);
    };
  }, [mouseEnabled, isInsideBox]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowLeft':
          if (isInsideBox) {
            const newSlideIndex = (currentSlideIndex - 1 + 6) % 6;
            setCurrentSlide(newSlideIndex);
          } else {
            const newBoxIndex = (currentBoxIndex - 1 + boxes.length) % boxes.length;
            setCurrentBox(newBoxIndex);
            focusOnBox(newBoxIndex);
          }
          break;
        case 'ArrowRight':
          if (isInsideBox) {
            const newSlideIndex = (currentSlideIndex + 1) % 6;
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

  const handleImageUpload = (boxId: string, slideIndex: number, file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      if (slideIndex < 4) {
        updateSlide(boxId, slideIndex, { imageUrl: dataUrl });
      } else if (slideIndex === 4) {
        updateFloor(boxId, dataUrl);
      } else if (slideIndex === 5) {
        updateCeiling(boxId, dataUrl);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleExport = () => {
    const data = getExportData();
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
    if (!boxes[currentBoxIndex]) return '';
    if (currentSlideIndex < 4) {
      return boxes[currentBoxIndex].slides[currentSlideIndex]?.imageUrl || '';
    } else if (currentSlideIndex === 4) {
      return boxes[currentBoxIndex].floorImageUrl;
    } else {
      return boxes[currentBoxIndex].ceilingImageUrl;
    }
  };

  // Get current subtitle
  const getCurrentSubtitle = () => {
    if (!boxes[currentBoxIndex]) return '';
    if (currentSlideIndex < 4) {
      return boxes[currentBoxIndex].slides[currentSlideIndex]?.subtitle || '';
    } else if (currentSlideIndex === 4) {
      return boxes[currentBoxIndex].floorSubtitle;
    } else {
      return boxes[currentBoxIndex].ceilingSubtitle;
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

      {/* Mini rotating cubes navigation - ALWAYS visible */}
      {showAllUI && (
        <MiniCubeNav
          boxes={boxes}
          currentBoxIndex={currentBoxIndex}
          isDarkMode={isDarkMode}
          accentColor={currentTheme.accent}
          isInsideBox={isInsideBox}
          onNavigate={(index) => {
            if (isInsideBox) {
              // If inside a box, exit first then enter new box
              exitBox();
              setTimeout(() => {
                setCurrentBox(index);
                enterBox(index);
              }, 350);
            } else {
              // If in bird view, just focus on the box
              setCurrentBox(index);
              focusOnBox(index);
            }
          }}
        />
      )}

      {/* Navigation arrows when inside box */}
      {isInsideBox && boxes[currentBoxIndex] && (
        <>
          <button
            onClick={() => setCurrentSlide((currentSlideIndex - 1 + 6) % 6)}
            className={`absolute left-6 top-1/2 -translate-y-1/2 z-30 w-12 h-24 flex items-center justify-center ${currentTheme.panelBg} hover:opacity-80 transition-all rounded-xl backdrop-blur-md group border ${currentTheme.border} shadow-lg`}
            style={{ backgroundColor: `rgba(${isDarkMode ? '0,0,0,0.4' : '255,255,255,0.7'})` }}
          >
            <svg className={`w-6 h-6 group-hover:text-white transition-colors`} style={{ color: currentTheme.accent }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          
          <button
            onClick={() => setCurrentSlide((currentSlideIndex + 1) % 6)}
            className={`absolute right-6 top-1/2 -translate-y-1/2 z-30 w-12 h-24 flex items-center justify-center ${currentTheme.panelBg} hover:opacity-80 transition-all rounded-xl backdrop-blur-md group border ${currentTheme.border} shadow-lg`}
            style={{ backgroundColor: `rgba(${isDarkMode ? '0,0,0,0.4' : '255,255,255,0.7'})` }}
          >
            <svg className={`w-6 h-6 group-hover:text-white transition-colors`} style={{ color: currentTheme.accent }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </>
      )}

      {/* Current subtitle display when inside box - walls only */}
      {isInsideBox && boxes[currentBoxIndex] && currentSlideIndex < 4 && showAllUI && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none z-20 w-full max-w-2xl px-4">
          <div className="text-center">
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
              {boxes[currentBoxIndex].slides[currentSlideIndex]?.subtitle}
            </h2>
          </div>
        </div>
      )}

      {/* Bottom controls - Bird view */}
      {showAllUI && !isInsideBox && (
      <div className="absolute bottom-0 left-0 right-0 p-4 z-10 pointer-events-none">
        <div className="flex justify-center gap-3 flex-wrap pointer-events-auto">
          <button
            onClick={addBox}
            className="text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:opacity-90 transition shadow-lg"
            style={{ background: `linear-gradient(to right, ${currentTheme.accent}, ${isDarkMode ? '#16A34A' : '#16A34A'})` }}
          >
            ➕ Nueva Caja
          </button>

          <button
            onClick={() => enterBox(currentBoxIndex)}
            className="bg-gradient-to-r from-green-600 to-teal-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:from-green-500 hover:to-teal-500 transition shadow-lg shadow-green-500/25"
          >
            🚀 Entrar a Caja {currentBoxIndex + 1}
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

          <button
            onClick={handleExport}
            className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:from-blue-500 hover:to-indigo-500 transition shadow-lg shadow-blue-500/25"
          >
            💾 Guardar
          </button>
          <label className="bg-gradient-to-r from-purple-600 to-pink-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:from-purple-500 hover:to-pink-500 transition shadow-lg shadow-purple-500/25 cursor-pointer">
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
                {currentSlideIndex < 4 ? `Pared ${currentSlideIndex + 1}` : (currentSlideIndex === 4 ? 'Piso' : 'Techo')} ({currentSlideIndex + 1}/6)
              </span>
            </div>
            
            {/* Slide buttons 1-6 */}
            <div className="flex gap-2 justify-center mb-4">
              {[1, 2, 3, 4, 5, 6].map((num) => (
                <button
                  key={num}
                  onClick={() => setCurrentSlide(num - 1)}
                  className={`w-10 h-10 rounded-xl font-medium transition text-sm ${
                    num - 1 === currentSlideIndex
                      ? 'text-white shadow-lg'
                      : `${currentTheme.text} hover:opacity-70 border ${currentTheme.border}`
                  }`}
                  style={num - 1 === currentSlideIndex ? { backgroundColor: currentTheme.accent } : { backgroundColor: isDarkMode ? 'rgba(55,65,81,0.5)' : 'rgba(243,244,246,1)' }}
                  title={num <= 4 ? `Pared ${num}` : (num === 5 ? 'Piso' : 'Techo')}
                >
                  {num}
                </button>
              ))}
            </div>

            {/* Edit controls - Horizontal layout */}
            <div className="flex gap-3 items-end">
              {/* Image preview */}
              <div className="flex-shrink-0">
                <label className={`${currentTheme.textMuted} text-xs block mb-1.5 uppercase tracking-wider`}>
                  {currentSlideIndex < 4 ? 'Pared' : (currentSlideIndex === 4 ? 'Piso' : 'Techo')} {currentSlideIndex + 1}
                </label>
                <label className={`block w-32 h-24 rounded-xl overflow-hidden border-2 ${currentTheme.border} cursor-pointer transition relative group`}
                  style={{ backgroundColor: isDarkMode ? '#1f2937' : '#f9fafb' }}
                >
                  <img
                    src={getCurrentImage()}
                    alt={`Cara ${currentSlideIndex + 1}`}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                    <span className="text-white text-xs">📷 Cambiar</span>
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleImageUpload(boxes[currentBoxIndex].id, currentSlideIndex, file);
                    }}
                  />
                </label>
              </div>
              
              {/* Subtitle */}
              <div className="flex-1">
                <label className={`${currentTheme.textMuted} text-xs block mb-1.5 uppercase tracking-wider`}>Subtítulo</label>
                <input
                  type="text"
                  value={getCurrentSubtitle()}
                  onChange={(e) => {
                    if (currentSlideIndex < 4) {
                      updateSlide(boxes[currentBoxIndex].id, currentSlideIndex, { subtitle: e.target.value });
                    }
                  }}
                  className={`w-full ${isDarkMode ? 'bg-gray-800/80 text-white border-gray-600 focus:border-cyan-400' : 'bg-gray-50 text-gray-800 border-gray-200 focus:border-[#22C55E]'} px-4 py-2.5 rounded-xl text-sm border focus:ring-2 focus:outline-none transition`}
                  placeholder="Editar subtítulo..."
                  disabled={currentSlideIndex >= 4}
                />
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
                  <img
                    src={slide.imageUrl}
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
                  4 === currentSlideIndex 
                    ? 'ring-2 scale-105 ring-[var(--theme-accent)]' 
                    : 'opacity-50 hover:opacity-80'
                }`}
                style={{ '--theme-accent': currentTheme.accent } as React.CSSProperties}
                onClick={() => setCurrentSlide(4)}
              >
                <img
                  src={boxes[currentBoxIndex].floorImageUrl}
                  alt="Piso"
                  className="w-full h-full object-cover"
                />
                <div className={`absolute bottom-0 left-0 right-0 text-[9px] text-center py-0.5 ${isDarkMode ? 'bg-black/60 text-white' : 'bg-white/80 text-gray-700'}`}>
                  5
                </div>
              </div>
              {/* Ceiling */}
              <div
                className={`relative w-14 h-10 rounded-lg overflow-hidden cursor-pointer transition-all ${
                  5 === currentSlideIndex 
                    ? 'ring-2 scale-105 ring-[var(--theme-accent)]' 
                    : 'opacity-50 hover:opacity-80'
                }`}
                style={{ '--theme-accent': currentTheme.accent } as React.CSSProperties}
                onClick={() => setCurrentSlide(5)}
              >
                <img
                  src={boxes[currentBoxIndex].ceilingImageUrl}
                  alt="Techo"
                  className="w-full h-full object-cover"
                />
                <div className={`absolute bottom-0 left-0 right-0 text-[9px] text-center py-0.5 ${isDarkMode ? 'bg-black/60 text-white' : 'bg-white/80 text-gray-700'}`}>
                  6
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
