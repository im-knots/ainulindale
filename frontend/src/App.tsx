/**
 * React App Entry Point
 * Main application component that composes the layout
 */

import { useEffect, useState, useCallback } from 'react';
import './styles/tailwind.css';
import { initializeFromDatabase, setupPersistenceSubscriptions } from './store/persistence';
import { llmClient } from './llm/client';

// Layout components (to be created)
import { TopBar } from './components/layout/TopBar';
import { MainContent } from './components/layout/MainContent';
import { HexDetailBar } from './components/layout/HexDetailBar';
import { SettingsModal } from './components/modals/SettingsModal';
import { SplashScreen } from './components/SplashScreen';
import { NotificationContainer } from './components/notifications/NotificationContainer';

export function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Initialize application
  useEffect(() => {
    async function initialize() {
      try {
        // Load API keys from SQLite database
        await llmClient.loadApiKeysFromStorage();
        console.log('[App] Loaded API keys from local database');

        // Initialize store from SQLite database
        await initializeFromDatabase();
        console.log('[App] Loaded boards from local database');

        // Set up persistence subscriptions for auto-save
        const cleanup = setupPersistenceSubscriptions();

        setIsLoading(false);

        return cleanup;
      } catch (err) {
        console.error('[App] Initialization failed:', err);
        setError(err instanceof Error ? err.message : 'Failed to initialize');
        setIsLoading(false);
      }
    }

    const cleanupPromise = initialize();

    return () => {
      cleanupPromise.then(cleanup => cleanup?.());
    };
  }, []);

  const openSettings = useCallback(() => setIsSettingsOpen(true), []);
  const closeSettings = useCallback(() => setIsSettingsOpen(false), []);

  // Loading state - show splash screen
  if (isLoading) {
    return <SplashScreen />;
  }

  // Error state
  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-bg-primary">
        <div className="text-center p-6 bg-bg-secondary rounded-lg border border-border max-w-md">
          <div className="text-accent-danger text-4xl mb-4">!</div>
          <h2 className="text-text-primary text-lg font-medium mb-2">Initialization Error</h2>
          <p className="text-text-secondary mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="btn btn-primary"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-bg-primary relative">
      {/* Top bar with board selector and resources */}
      <TopBar onSettingsClick={openSettings} />

      {/* Notifications - positioned on left side under top bar */}
      <NotificationContainer />

      {/* Main content area with canvas and panel - takes remaining height */}
      <MainContent />

      {/* Bottom bar with hex details, logs, chat - overlays on top of canvas */}
      <HexDetailBar />

      {/* Settings modal */}
      {isSettingsOpen && (
        <SettingsModal onClose={closeSettings} />
      )}
    </div>
  );
}

export default App;

