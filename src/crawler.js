const { chromium } = require('playwright');

async function checkScripts(url) {
  console.log(`🔍 Rozpoczynam sprawdzanie: ${url}`);
  
  const browser = await chromium.launch({ 
    headless: true 
  });
  
  const page = await browser.newPage();
  
  // Zbieraj eventy GA4 i FB
  const capturedEvents = [];
  
  // Nasłuchuj requesty do GA4
  page.on('request', request => {
    const requestUrl = request.url();
    
    // GA4 events
    if (requestUrl.includes('google-analytics.com/g/collect') || 
        requestUrl.includes('analytics.google.com/g/collect')) {
      const urlParams = new URL(requestUrl).searchParams;
      capturedEvents.push({
        type: 'GA4',
        eventName: urlParams.get('en') || urlParams.get('event'),
        url: requestUrl,
        timestamp: new Date()
      });
    }
    
    // Facebook events
    if (requestUrl.includes('facebook.com/tr')) {
      const urlParams = new URL(requestUrl).searchParams;
      capturedEvents.push({
        type: 'Facebook',
        eventName: urlParams.get('ev'),
        url: requestUrl,
        timestamp: new Date()
      });
    }
  });
  
  try {
    // Wejdź na stronę
    await page.goto(url, { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    
    // Poczekaj chwilę na eventy
    await page.waitForTimeout(5000);
    
    // Sprawdź skrypty (jak wcześniej)
    const scripts = await page.evaluate(() => {
      const results = {
        gtm: null,
        ga4: null,
        fbPixel: false,
        scripts_found: [],
        dataLayer: false
      };
      
      // Znajdź wszystkie skrypty
      document.querySelectorAll('script').forEach(script => {
        if (script.src) {
          results.scripts_found.push(script.src);
          
          // GTM
          if (script.src.includes('googletagmanager.com')) {
            const gtmMatch = script.src.match(/GTM-[A-Z0-9]+/);
            if (gtmMatch) results.gtm = gtmMatch[0];
          }
          
          // GA4
          if (script.src.includes('gtag/js')) {
            const ga4Match = script.src.match(/G-[A-Z0-9]+/);
            if (ga4Match) results.ga4 = ga4Match[0];
          }
        }
        
        // Sprawdź inline scripts
        if (script.innerHTML.includes('gtag(') || script.innerHTML.includes('dataLayer')) {
          results.dataLayer = true;
        }
      });
      
      // Facebook Pixel
      results.fbPixel = typeof window.fbq === 'function';
      
      return results;
    });
    
    console.log('✅ Sprawdzanie zakończone');
    await browser.close();
    
    return {
      url,
      success: true,
      scripts,
      events: capturedEvents
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
