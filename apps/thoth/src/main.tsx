import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import './globals.css';
// The type layer's heaviest weight (the theme ships 400–700).
import '@fontsource/montserrat/latin-900.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
