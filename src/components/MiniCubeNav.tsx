'use client';

import { useMemo } from 'react';

interface MiniCubeNavProps {
  boxes: Array<{ id: string; name: string }>;
  currentBoxIndex: number;
  isDarkMode: boolean;
  accentColor: string;
  onNavigate: (index: number) => void;
  isInsideBox?: boolean;
}

// Inline styles for the cube animation
const cubeAnimationStyle = `
  @keyframes spin3d {
    0% { transform: rotateX(-20deg) rotateY(0deg); }
    100% { transform: rotateX(-20deg) rotateY(360deg); }
  }
  .mini-cube-3d {
    animation: spin3d 3s linear infinite;
    transform-style: preserve-3d;
  }
`;

export default function MiniCubeNav({ boxes, currentBoxIndex, isDarkMode, accentColor, onNavigate, isInsideBox = false }: MiniCubeNavProps) {
  const cubeSize = 32;
  const halfSize = cubeSize / 2;

  const colors = useMemo(() => ({
    active: accentColor,
    inactive: isDarkMode ? '#4a5568' : '#cbd5e0',
    inactiveDark: isDarkMode ? '#2d3748' : '#e2e8f0',
    inactiveTop: isDarkMode ? '#718096' : '#f7fafc',
    inactiveBottom: isDarkMode ? '#1a202c' : '#a0aec0',
    text: isDarkMode ? '#a0aec0' : '#4a5563',
    textActive: '#ffffff',
    bg: isDarkMode ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.95)',
    border: isDarkMode ? 'rgba(0,255,255,0.5)' : 'rgba(34,197,94,0.5)',
  }), [isDarkMode, accentColor]);

  return (
    <>
      {/* Inject animation keyframes */}
      <style>{cubeAnimationStyle}</style>

      {/* Container - position varies based on view mode */}
      <div
        style={{
          position: 'fixed',
          top: isInsideBox ? '16px' : '140px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 99999,
          display: 'block',
          pointerEvents: 'auto',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '12px 16px',
            borderRadius: '16px',
            backgroundColor: colors.bg,
            border: `2px solid ${colors.border}`,
            boxShadow: '0 4px 30px rgba(0,0,0,0.4)',
            backdropFilter: 'blur(10px)',
          }}
        >
          {boxes.map((box, index) => {
            const isActive = index === currentBoxIndex;
            
            return (
              <button
                key={box.id}
                onClick={() => onNavigate(index)}
                title={box.name}
                style={{
                  position: 'relative',
                  width: `${cubeSize}px`,
                  height: `${cubeSize}px`,
                  padding: '0',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  transition: 'transform 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.2)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                }}
              >
                {/* 3D Cube container */}
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    perspective: '100px',
                    perspectiveOrigin: '50% 50%',
                  }}
                >
                  {/* Rotating cube */}
                  <div
                    className="mini-cube-3d"
                    style={{
                      width: '100%',
                      height: '100%',
                      position: 'relative',
                      transformStyle: 'preserve-3d',
                      animationDelay: `${index * 0.15}s`,
                    }}
                  >
                    {/* Front face */}
                    <div
                      style={{
                        position: 'absolute',
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 'bold',
                        fontSize: '12px',
                        borderRadius: '4px',
                        transform: `translateZ(${halfSize}px)`,
                        backgroundColor: isActive ? colors.active : colors.inactive,
                        color: isActive ? colors.textActive : colors.text,
                        boxShadow: 'inset 0 0 6px rgba(0,0,0,0.3)',
                      }}
                    >
                      {index + 1}
                    </div>
                    
                    {/* Back face */}
                    <div
                      style={{
                        position: 'absolute',
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 'bold',
                        fontSize: '12px',
                        borderRadius: '4px',
                        transform: `rotateY(180deg) translateZ(${halfSize}px)`,
                        backgroundColor: isActive ? colors.active : colors.inactiveDark,
                        color: isActive ? colors.textActive : 'transparent',
                      }}
                    >
                      {index + 1}
                    </div>
                    
                    {/* Right face */}
                    <div
                      style={{
                        position: 'absolute',
                        width: '100%',
                        height: '100%',
                        borderRadius: '4px',
                        transform: `rotateY(90deg) translateZ(${halfSize}px)`,
                        backgroundColor: isActive ? colors.active : colors.inactiveDark,
                      }}
                    />
                    
                    {/* Left face */}
                    <div
                      style={{
                        position: 'absolute',
                        width: '100%',
                        height: '100%',
                        borderRadius: '4px',
                        transform: `rotateY(-90deg) translateZ(${halfSize}px)`,
                        backgroundColor: isActive ? colors.active : colors.inactive,
                      }}
                    />
                    
                    {/* Top face */}
                    <div
                      style={{
                        position: 'absolute',
                        width: '100%',
                        height: '100%',
                        borderRadius: '4px',
                        transform: `rotateX(90deg) translateZ(${halfSize}px)`,
                        backgroundColor: isActive ? colors.active : colors.inactiveTop,
                      }}
                    />
                    
                    {/* Bottom face */}
                    <div
                      style={{
                        position: 'absolute',
                        width: '100%',
                        height: '100%',
                        borderRadius: '4px',
                        transform: `rotateX(-90deg) translateZ(${halfSize}px)`,
                        backgroundColor: isActive ? colors.active : colors.inactiveBottom,
                      }}
                    />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
