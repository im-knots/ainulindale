/**
 * React Entry Point
 * Renders the App component to the DOM
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { registerBuiltinPlugins } from './engine/tools/plugins';

// Register all built-in tool plugins before app renders
registerBuiltinPlugins();

// Get the root element
const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Failed to find root element. Make sure there is a <div id="root"> in your HTML.');
}

// Create React root and render
const root = createRoot(rootElement);
root.render(
  <StrictMode>
    <App />
  </StrictMode>
);

