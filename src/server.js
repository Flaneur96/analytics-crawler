const express = require('express');
const { checkScripts } = require('./crawler');

const app = express();
app.use(express.json());

// Endpoint główny
app.get('/', (req, res) => {
  res.json({ 
    message: '🚀 Analytics Crawler API', 
    endpoints: {
      audit: 'POST /audit'
    }
  });
});

// Endpoint do audytu
app.post('/audit', async (req, res) => {
  try {
    const { url, clientId } = req.body;
    
    if (!url) {
      return res.status(400).json({ 
        error: 'Brak URL w zapytaniu' 
      });
    }
    
    console.log(`\n🎯 Nowy audyt dla ${clientId || 'Unknown'}`);
    console.log(`📍 URL: ${url}`);
    
    // Uruchom crawler
    const results = await checkScripts(url);
    
    // Zwróć wyniki
    res.json({
      clientId,
      timestamp: new Date().toISOString(),
      ...results
    });
    
  } catch (error) {
    console.error('❌ Błąd serwera:', error);
    res.status(500).json({ 
      error: error.message 
    });
  }
});

// Uruchom serwer
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Serwer działa na porcie ${PORT}`);
  console.log(`📍 http://localhost:${PORT}`);
});