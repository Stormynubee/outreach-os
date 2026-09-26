import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import './theme.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Outreach OS could not mount: #root element is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
