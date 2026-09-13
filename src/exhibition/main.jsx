import React from 'react';
import { createRoot } from 'react-dom/client';
import TerrainPreview from './TerrainPreview.jsx';
import './style.css';

createRoot(document.getElementById('exhibition-root')).render(<TerrainPreview />);
