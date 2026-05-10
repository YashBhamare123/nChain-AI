import { useEffect, useRef } from 'react';

const DotGrid = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let mouseX = -1000;
    let mouseY = -1000;

    const dotSpacing = 24;
    const dotRadius = 1;
    const maxDistance = 150;
    const pushForce = 0.05;

    const resize = () => {
      // Handle high DPI displays for crisp rendering
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.scale(dpr, dpr);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
    };

    window.addEventListener('resize', resize);
    resize();

    const handleMouseMove = (e: MouseEvent) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    };
    
    const handleMouseLeave = () => {
      mouseX = -1000;
      mouseY = -1000;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseleave', handleMouseLeave);

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      const cols = Math.floor(window.innerWidth / dotSpacing) + 1;
      const rows = Math.floor(window.innerHeight / dotSpacing) + 1;

      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const originX = i * dotSpacing;
          const originY = j * dotSpacing;

          const dx = mouseX - originX;
          const dy = mouseY - originY;
          const distance = Math.sqrt(dx * dx + dy * dy);

          let x = originX;
          let y = originY;
          let size = dotRadius;
          let opacity = 0.15;

          if (distance < maxDistance) {
            const force = (maxDistance - distance) / maxDistance;
            
            // Push away
            x -= (dx * force * pushForce);
            y -= (dy * force * pushForce);
            
            // Light up and grow slightly
            size = dotRadius + (force * 1.5);
            opacity = 0.15 + (force * 0.5);
          }

          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
          ctx.fill();
        }
      }

      animationFrameId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseleave', handleMouseLeave);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none z-0"
    />
  );
};

export default DotGrid;
