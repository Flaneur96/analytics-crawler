const { chromium } = require('playwright');

async function checkScripts(url) {
  // Automatycznie dodaj https:// jeśli brakuje
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
    console.log(`🔧 Dodano https:// do URL`);
  }
  
  console.log(`🔍 Rozpoczynam sprawdzanie: ${url}`);
  
  const browser = await chromium.launch({ 
    headless: true 
  });
  
  const page = await browser.newPage();
  
  // Zbieraj eventy GA4 i FB
  const capturedEvents = [];
  
  // Nasłuchuj requesty
  page.on('request', request => {
    const requestUrl = request.url();
    
    // Loguj requesty do Google (debug)
    if (requestUrl.includes('googletagmanager') || 
        requestUrl.includes('google-analytics') ||
        requestUrl.includes('gtag')) {
      console.log('📡 Request Google:', requestUrl.substring(0, 80) + '...');
    }
    
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
    
    // OBSŁUGA COOKIEBOT I INNYCH BANNERÓW
    try {
      console.log('🍪 Sprawdzam bannery cookies...');
      
      // Sprawdź różne typy bannerów
      const cookieBannerHandled = await page.evaluate(() => {
        // Cookiebot
        if (window.Cookiebot) {
          console.log('Znaleziono Cookiebot');
          window.Cookiebot.consent.marketing = true;
          window.Cookiebot.consent.statistics = true;
          window.Cookiebot.consent.preferences = true;
          window.Cookiebot.submitConsent();
          return 'Cookiebot';
        }
        
        // OneTrust
        if (window.OneTrust) {
          console.log('Znaleziono OneTrust');
          window.OneTrust.AllowAll();
          return 'OneTrust';
        }
        
        // Klaro
        if (window.klaro) {
          console.log('Znaleziono Klaro');
          window.klaro.getManager().acceptAll();
          return 'Klaro';
        }
        
        return null;
      });
      
      if (cookieBannerHandled) {
        console.log(`✅ Zaakceptowano cookies przez: ${cookieBannerHandled}`);
      }
      
      // Spróbuj też kliknąć typowe przyciski
      const acceptButtons = [
        'button#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
        'button[id*="accept-all"]',
        'button[class*="accept-all"]',
        'button:has-text("Zaakceptuj wszystkie")',
        'button:has-text("Zezwól na wszystkie")',
        'button:has-text("Accept all")',
        'button:has-text("Akceptuję")'
      ];
      
      for (const selector of acceptButtons) {
        try {
          const button = await page.$(selector);
          if (button) {
            await button.click();
            console.log(`✅ Kliknięto przycisk: ${selector}`);
            break;
          }
        } catch (e) {
          // Ignoruj błędy klikania
        }
      }
      
      // Poczekaj na załadowanie po akceptacji
      await page.waitForTimeout(5000);
      
    } catch (cookieError) {
      console.log('⚠️ Problem z obsługą cookies:', cookieError.message);
    }
    
    // Dodatkowy czas na załadowanie wszystkiego
    await page.waitForTimeout(3000);
    
    // Sprawdź skrypty
    const scripts = await page.evaluate(() => {
      const results = {
        gtm: null,
        ga4: null,
        fbPixel: false,
        scripts_found: [],
        dataLayer: false,
        cookieConsent: null,
        consentMode: {
          implemented: false,
          defaultConsent: null,
          updateConsent: null,
          consentCodes: [],
          errors: [],
          hasConsentDefault: false,
          hasConsentUpdate: false,
          waitForUpdate: null
        },
        debug: {}
      };
      
      // Info o zgodach
      if (window.Cookiebot) {
        results.cookieConsent = 'Cookiebot';
        results.debug.cookiebotConsent = window.Cookiebot.consent;
      } else if (window.OneTrust) {
        results.cookieConsent = 'OneTrust';
      } else if (window.klaro) {
        results.cookieConsent = 'Klaro';
      }
      
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
            const ga4Match = script.src.match(/[?&]id=(G-[A-Z0-9]+)/);
            if (ga4Match) results.ga4 = ga4Match[1];
          }
        }
        
        // Sprawdź inline scripts
        if (script.innerHTML) {
          // GTM inline
          if (script.innerHTML.includes('GTM-')) {
            const match = script.innerHTML.match(/GTM-[A-Z0-9]+/);
            if (match && !results.gtm) results.gtm = match[0];
          }
          
          // GA4 inline
          if (script.innerHTML.includes('gtag(') && script.innerHTML.includes('G-')) {
            const match = script.innerHTML.match(/['"](G-[A-Z0-9]+)['"]/);
            if (match && !results.ga4) results.ga4 = match[1];
          }
          
          // DataLayer
          if (script.innerHTML.includes('dataLayer')) {
            results.dataLayer = true;
          }
          
          // SPRAWDZANIE CONSENT MODE
          if (script.innerHTML.includes("gtag('consent', 'default'")) {
            results.consentMode.hasConsentDefault = true;
            results.consentMode.implemented = true;
            
            // Sprawdź ustawienia default consent
            const defaultMatch = script.innerHTML.match(/gtag\s*\(\s*['"]consent['"]\s*,\s*['"]default['"]\s*,\s*({[^}]+})\s*\)/);
            if (defaultMatch) {
              try {
                results.consentMode.defaultConsent = defaultMatch[1];
              } catch (e) {}
            }
            
            // Sprawdź wait_for_update
            if (script.innerHTML.includes('wait_for_update')) {
              const waitMatch = script.innerHTML.match(/wait_for_update['"]\s*:\s*(\d+)/);
              if (waitMatch) {
                results.consentMode.waitForUpdate = parseInt(waitMatch[1]);
              }
            }
          }
          
          if (script.innerHTML.includes("gtag('consent', 'update'")) {
            results.consentMode.hasConsentUpdate = true;
          }
          
          // Szukaj kodów zgód (G100, G111, etc)
          const consentCodeMatches = script.innerHTML.match(/[Gg][0-9]{3}/g);
          if (consentCodeMatches) {
            results.consentMode.consentCodes.push(...consentCodeMatches);
          }
        }
      });
      
      // Facebook Pixel
      results.fbPixel = typeof window.fbq === 'function';
      
      // Sprawdź dataLayer
      if (typeof window.dataLayer !== 'undefined') {
        results.dataLayer = true;
        results.debug.dataLayerLength = window.dataLayer.length;
        
        // Sprawdź consent events w dataLayer
        window.dataLayer.forEach(item => {
          if (item && typeof item === 'object') {
            // Sprawdź różne formaty consent
            if (item[0] === 'consent' || 
                (item.event && item.event.includes('consent')) ||
                (item[0] === 'gtag' && item[1] === 'consent')) {
              results.consentMode.implemented = true;
            }
            
            // Szukaj kodów zgód
            const itemStr = JSON.stringify(item);
            const codes = itemStr.match(/[Gg][0-9]{3}/g);
            if (codes) {
              results.consentMode.consentCodes.push(...codes);
            }
          }
        });
      }
      
      // Usuń duplikaty kodów zgód
      results.consentMode.consentCodes = [...new Set(results.consentMode.consentCodes)];
      
      // SPRAWDŹ BŁĘDY CONSENT MODE
      if (results.gtm || results.ga4) {
        // Jeśli są skrypty Google ale brak consent mode
        if (!results.consentMode.hasConsentDefault) {
          results.consentMode.errors.push('Brak gtag consent default');
        }
        
        // Sprawdź czy jest CMP ale brak consent update
        if (results.cookieConsent && !results.consentMode.hasConsentUpdate) {
          results.consentMode.errors.push('Jest CMP ale brak gtag consent update');
        }
        
        // Sprawdź wait_for_update
        if (results.consentMode.hasConsentDefault && !results.consentMode.waitForUpdate) {
          results.consentMode.errors.push('Brak wait_for_update w consent default');
        }
      }
      
      return results;
    });
    
    console.log('✅ Sprawdzanie zakończone');
    console.log(`📊 Znaleziono: GTM=${scripts.gtm}, GA4=${scripts.ga4}, FB=${scripts.fbPixel}`);
    console.log(`🔐 Consent Mode: ${scripts.consentMode.implemented ? 'TAK' : 'NIE'}`);
    console.log(`🏷️ Kody zgód: ${scripts.consentMode.consentCodes.join(', ') || 'BRAK'}`);
    
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
