import { useState, useEffect, useRef } from 'react';

const CHARS = 'ABCDEFGHIKLMNOPQRSTUVWXYZ0123456789@#$%&§ΔX*';

export default function ScrambleText({ text, duration = 600, delay = 0 }) {
  const [display, setDisplay] = useState('');
  const [isAnimating, setIsAnimating] = useState(false);
  const frameRef = useRef(null);
  const startTimeRef = useRef(null);
  const originalTextRef = useRef(text);

  useEffect(() => {
    // Reset and start animation if text changes
    originalTextRef.current = text;
    startTimeRef.current = null;
    setIsAnimating(true);
    
    // Ensure text is string
    const targetText = String(text);
    
    const startTimeout = setTimeout(() => {
      const animate = (timestamp) => {
        if (!startTimeRef.current) startTimeRef.current = timestamp;
        const elapsed = timestamp - startTimeRef.current;
        const progress = Math.min(elapsed / duration, 1);

        if (progress < 1) {
          // Matrix-style progressive lock: lock from left to right
          const partRevealed = Math.floor(progress * targetText.length);
          const scrambled = targetText.split('').map((char, i) => {
            if (i < partRevealed) return char;
            if (char === ' ') return ' ';
            return CHARS[Math.floor(Math.random() * CHARS.length)];
          }).join('');
          
          setDisplay(scrambled);
          frameRef.current = requestAnimationFrame(animate);
        } else {
          setDisplay(targetText);
          setIsAnimating(false);
        }
      };
      frameRef.current = requestAnimationFrame(animate);
    }, delay);

    return () => {
      clearTimeout(startTimeout);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [text, duration, delay]);

  const targetText = String(text);
  // Staggered highlight effect: the latest locked character glows brighter
  return (
    <span className="scramble-text" style={{ 
      color: isAnimating ? 'var(--status-success)' : 'inherit',
      transition: 'color 0.3s ease',
      display: 'inline-block'
    }}>
      {isAnimating ? (
        display.split('').map((char, i) => {
          const isLocked = char === targetText[i];
          const isLatestLock = isLocked && (i < targetText.length - 1) && display[i + 1] !== targetText[i + 1];
          return (
            <span key={i} style={{
              color: isLatestLock ? 'var(--text-primary)' : isLocked ? 'var(--status-success)' : 'rgba(0, 255, 136, 0.4)',
              textShadow: isLatestLock ? '0 0 10px var(--status-success)' : 'none',
              fontWeight: isLatestLock ? 900 : 'inherit'
            }}>
              {char}
            </span>
          )
        })
      ) : (
        display || targetText
      )}
    </span>
  );
}
