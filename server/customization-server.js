const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const io = require('socket.io-client');

// Initialize Express app for customization dashboard
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../customization')));

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.IO
const dashboardIo = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Connect to the other servers as a client
const mainSocket = io('http://localhost:3000');
const highlightSocket = io('http://localhost:3001');

// Settings storage
let settings = {
  // Common settings
  messageLimit: 50,
  highlightTimeout: 10000,
  highlightColor: "#ff5500",
  
  // OBS View specific settings
  obsView: {
    fontSize: 16,
    textColor: "#ffffff",
    backgroundColor: "#222222",
    messageBackgroundColor: "#222222",
    messageOpacity: 0.7,
    messageBorderRadius: 4,
    messagePadding: 8,
    chatWidth: "100%",
    chatHeight: "400px",
    enableDropShadow: true,
    theme: "dark",
    showBadges: true,
    showTimestamps: false,
    showPlatforms: true
  },
  
  // Streamer View specific settings
  streamerView: {
    fontSize: 16,
    textColor: "#ffffff",
    backgroundColor: "#181818",
    messageBackgroundColor: "#222222",
    messageOpacity: 0.7,
    messageBorderRadius: 4,
    messagePadding: 8,
    chatWidth: "100%",
    chatHeight: "400px",
    enableDropShadow: true,
    theme: "dark",
    showBadges: true,
    showTimestamps: false,
    showPlatforms: true
  },
};

// Load settings from file if exists
const settingsPath = path.join(__dirname, 'settings.json');
try {
  if (fs.existsSync(settingsPath)) {
    const settingsData = fs.readFileSync(settingsPath, 'utf8');
    const savedSettings = JSON.parse(settingsData);
    // Deep merge saved settings with defaults
    settings = deepMerge(settings, savedSettings);
    console.log('Settings loaded from file:', settings);
  } else {
    console.log('No settings file found, using defaults');
    // Save default settings
    saveSettings();
  }
} catch (error) {
  console.error('Error loading settings:', error);
}

// Connection statuses
let mainConnected = false;
let highlightConnected = false;

// Track connection status
mainSocket.on('connect', () => {
  console.log('Connected to main server');
  mainConnected = true;
});

mainSocket.on('disconnect', () => {
  console.log('Disconnected from main server');
  mainConnected = false;
});

highlightSocket.on('connect', () => {
  console.log('Connected to highlight server');
  highlightConnected = true;
});

highlightSocket.on('disconnect', () => {
  console.log('Disconnected from highlight server');
  highlightConnected = false;
});

// Save settings to file
function saveSettings() {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    console.log('Settings saved to file');
  } catch (error) {
    console.error('Error saving settings:', error);
  }
}

// Function to deep merge objects
function deepMerge(target, source) {
  const output = Object.assign({}, target);
  
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          Object.assign(output, { [key]: source[key] });
        } else {
          output[key] = deepMerge(target[key], source[key]);
        }
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }
  
  return output;
}

// Helper function to check if value is an object
function isObject(item) {
  return (item && typeof item === 'object' && !Array.isArray(item));
}

// Function to process and handle opacity specifically
function processSpecialSettings(newSettings) {
  // Handle obsView settings
  if (newSettings.obsView) {
    // Ensure opacity is a number - handle if it's coming as a string
    if (newSettings.obsView.messageOpacity !== undefined) {
      const opacity = parseFloat(newSettings.obsView.messageOpacity);
      if (!isNaN(opacity)) {
        newSettings.obsView.messageOpacity = opacity;
      }
    }
  }
  
  // Handle streamerView settings
  if (newSettings.streamerView) {
    // Ensure opacity is a number - handle if it's coming as a string
    if (newSettings.streamerView.messageOpacity !== undefined) {
      const opacity = parseFloat(newSettings.streamerView.messageOpacity);
      if (!isNaN(opacity)) {
        newSettings.streamerView.messageOpacity = opacity;
      }
    }
  }
  
  return newSettings;
}

// Home route - serve the dashboard UI
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../customization/dashboard.html'));
});

// Settings API endpoint - get current settings
app.get('/api/settings', (req, res) => {
  console.log('GET /api/settings - Sending settings to client');
  res.json(settings);
});

// Settings API endpoint - update settings
app.post('/api/settings', (req, res) => {
  console.log('POST /api/settings - Received settings:', JSON.stringify(req.body, null, 2));
  
  // Validate settings
  if (!req.body || typeof req.body !== 'object') {
    console.error('Invalid settings object');
    return res.status(400).json({ success: false, error: 'Invalid settings object' });
  }
  
  // Process special settings like opacity
  const processedSettings = processSpecialSettings(req.body);
  
  // Update settings using deep merge to preserve nested structure
  settings = deepMerge(settings, processedSettings);
  
  console.log('Updated settings:', JSON.stringify(settings, null, 2));
  
  // Save to file
  saveSettings();
  
  // Broadcast settings update to all connected clients
  dashboardIo.emit('settings-updated', settings);
  
  // Send to main server
  if (mainConnected) {
    mainSocket.emit('settings-updated', settings);
    console.log('Settings sent to main server');
  } else {
    console.warn('Cannot send settings to main server - not connected');
  }
  
  // Send ONLY highlightTimeout to highlight server
  if (highlightConnected) {
    highlightSocket.emit('settings-updated', { 
      highlightTimeout: settings.highlightTimeout 
    });
    console.log('Highlight timeout sent to highlight server');
  } else {
    console.warn('Cannot send settings to highlight server - not connected');
  }
  
  // Return success response
  res.json({ success: true });
});

// Socket.IO connection handling
dashboardIo.on('connection', (socket) => {
  console.log('Client connected to customization server:', socket.id);
  
  // Send current settings to client
  socket.emit('settings', settings);
  
  // Send connection statuses
  socket.emit('server-status', { 
    main: mainConnected,
    highlight: highlightConnected
  });
  
  // Handle settings update from client via Socket.IO
  socket.on('update-settings', (newSettings) => {
    console.log('Received settings update via Socket.IO:', JSON.stringify(newSettings, null, 2));
    
    // Process special settings like opacity
    const processedSettings = processSpecialSettings(newSettings);
    
    // Update settings using deep merge
    settings = deepMerge(settings, processedSettings);
    console.log('Updated settings:', JSON.stringify(settings, null, 2));
    
    // Save to file
    saveSettings();
    
    // Broadcast to all clients
    dashboardIo.emit('settings-updated', settings);
    
    // Send to main server
    if (mainConnected) {
      mainSocket.emit('settings-updated', settings);
    }
    
    // Send ONLY highlightTimeout to highlight server
    if (highlightConnected) {
      highlightSocket.emit('settings-updated', { 
        highlightTimeout: settings.highlightTimeout 
      });
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('Client disconnected from customization server:', socket.id);
  });
});

// Start server
const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
  console.log(`Customization dashboard running on http://localhost:${PORT}`);
});