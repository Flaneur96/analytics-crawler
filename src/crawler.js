const { chromium } = require('playwright');

// Funkcja sprawdzająca skrypty na stronie
async function checkScripts(url) {
  console.log(`🔍 Rozpoczynam sprawdzanie: ${url}`);
  
  const browser = await chromium.launch({ 
    headless: true // działaj w tle
  });
  
  const page = await browser.newPage();
  
  try {
    // Wejdź na stronę
    await page.goto(url, { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    
    // Poczekaj chwilę na załadowanie skryptów
    await page.waitForTimeout(3000);
    
    // Sprawdź jakie skrypty są na stronie
    const scripts = await page.evaluate(() => {
      const results = {
        gtm: null,
        ga4: null,
        fbPixel: false,
        scripts_found: []
      };
      
      // Znajdź wszystkie skrypty
      document.querySelectorAll('script').forEach(script => {
        if (script.src) {
          results.scripts_found.push(script.src);
          
          // Sprawdź GTM
          if (script.src.includes('googletagmanager.com')) {
            const gtmMatch = script.src.match(/GTM-[A-Z0-9]+/);
            if (gtmMatch) results.gtm = gtmMatch[0];
          }
          
          // Sprawdź GA4
          if (script.src.includes('gtag/js')) {
            const ga4Match = script.src.match(/G-[A-Z0-9]+/);
            if (ga4Match) results.ga4 = ga4Match[0];
          }
        }
      });
      
      // Sprawdź Facebook Pixel
      results.fbPixel = typeof window.fbq === 'function';
      
      // Sprawdź dataLayer
      results.dataLayer = typeof window.dataLayer !== 'undefined';
      
      return results;
    });
    
    console.log('✅ Sprawdzanie zakończone');
    await browser.close();
    
    return {
      url,
      success: true,
      scripts
    };
    
  } catch (error) {
    console.error('❌ Błąd:', error.message);
    await browser.close();
    
    return {
      url,
      success: false,
      error: error.message
    };
  }
}

module.exports = { checkScripts };