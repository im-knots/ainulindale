/**
 * SplashScreen Component
 * Displays the Ainu logo with a spinning loading indicator during app initialization
 */

import { useEffect, useState } from 'react';

export function SplashScreen() {
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setRotation((prev) => (prev + 2) % 360);
    }, 16); // ~60fps

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center justify-center h-screen bg-bg-primary">
      <div className="relative flex flex-col items-center">
        {/* Spinning loading circle */}
        <div className="relative w-48 h-48 mb-8">
          {/* Outer spinning ring */}
          <svg
            className="absolute inset-0 w-full h-full"
            style={{ transform: `rotate(${rotation}deg)` }}
            viewBox="0 0 100 100"
          >
            <circle
              cx="50"
              cy="50"
              r="45"
              fill="none"
              stroke="url(#gradient)"
              strokeWidth="2"
              strokeDasharray="70 200"
              strokeLinecap="round"
            />
            <defs>
              <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#6366f1" stopOpacity="1" />
                <stop offset="50%" stopColor="#8b5cf6" stopOpacity="1" />
                <stop offset="100%" stopColor="#6366f1" stopOpacity="0.3" />
              </linearGradient>
            </defs>
          </svg>

          {/* Ainu logo in the center */}
          <div className="absolute inset-0 flex items-center justify-center">
            <img
              src="/logos/ainulogo.png"
              alt="Ainulindale"
              className="w-32 h-32 object-contain"
            />
          </div>
        </div>

        {/* Loading text */}
        <div className="text-center">
          <h2 className="text-text-primary text-xl font-medium mb-2">Ainulindale</h2>
          <p className="text-text-secondary text-sm">AI Operations Control Center</p>
          <div className="flex items-center justify-center mt-4 space-x-1">
            <div className="w-2 h-2 bg-accent-primary rounded-full animate-pulse" style={{ animationDelay: '0ms' }} />
            <div className="w-2 h-2 bg-accent-primary rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
            <div className="w-2 h-2 bg-accent-primary rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
      </div>
    </div>
  );
}

