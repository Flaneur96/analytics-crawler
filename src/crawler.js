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
  
  // Zbieraj eventy GA4, FB, TikTok i Consent Mode
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
    
    // GA4 events + CONSENT MODE
    if (requestUrl.includes('google-analytics.com/g/collect') || 
        requestUrl.includes('analytics.google.com/g/collect')) {
      const urlParams = new URL(requestUrl).searchParams;
      
      // Sprawdź consent code
      const gcs = urlParams.get('gcs');
      if (gcs) {
        capturedEvents.push({
          type: 'ConsentMode',
          code: gcs,
          timestamp: new Date()
        });
      }
      
      // Normalny event
      capturedEvents.push({
        type: 'GA4',
        eventName: urlParams.get('en') || urlParams.get('event'),
        url: requestUrl,
        timestamp: new Date()
      });
    }
    
    // Facebook events z Pixel ID
    if (requestUrl.includes('facebook.com/tr')) {
      const urlParams = new URL(requestUrl).searchParams;
      capturedEvents.push({
        type: 'Facebook',
        eventName: urlParams.get('ev'),
        pixelId: urlParams.get('id'),
        url: requestUrl,
        timestamp: new Date()
      });
    }
    
    // TikTok events - POPRAWIONE
    if (requestUrl.includes('analytics.tiktok.com')) {
      const urlParams = new URL(requestUrl).searchParams;
      let pixelId = null;
      
      // Różne sposoby wykrywania TikTok Pixel ID
      // 1. Z parametru sdkid
      pixelId = urlParams.get('sdkid');
      
      // 2. Z URL path jeśli nie ma sdkid
      if (!pixelId) {
        const pixelMatch = requestUrl.match(/pixel\/([A-Z0-9]+)\//);
        if (pixelMatch) pixelId = pixelMatch[1];
      }
      
      // 3. Z parametru pixelCode
      if (!pixelId) pixelId = urlParams.get('pixelCode');
      
      capturedEvents.push({
        type: 'TikTok',
        eventName: urlParams.get('event') || 'PageView',
        pixelId: pixelId,
        url: requestUrl,
        timestamp: new Date()
      });
    }
    
    // Pinterest events
    if (requestUrl.includes('ct.pinterest.com')) {
      const urlParams = new URL(requestUrl).searchParams;
      capturedEvents.push({
        type: 'Pinterest',
        eventName: urlParams.get('event') || 'PageVisit',
        pixelId: urlParams.get('tid'),
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
    
    // SPRAWDŹ SKRYPTY PRZED ZGODĄ
    const scriptsBeforeConsent = await page.evaluate(() => {
      return {
        ga4: document.querySelector('script[src*="gtag/js"]') ? true : false,
        gtm: document.querySelector('script[src*="googletagmanager.com/gtm.js"]') ? true : false
      };
    });
    
    console.log('📊 Skrypty przed zgodą:', scriptsBeforeConsent);
    
    // ROZSZERZONA OBSŁUGA COOKIES
    try {
      console.log('🍪 Sprawdzam bannery cookies...');
      
      // Poczekaj aż banner się pojawi
      await page.waitForTimeout(2000);
      
      // NOWE: Sprawdź czy jest iframe z cookies (np. Onetrust)
      const cookieFrames = page.frames();
      for (const frame of cookieFrames) {
        try {
          const acceptInFrame = await frame.$('button[id*="accept"], button[class*="accept"]');
          if (acceptInFrame) {
            await acceptInFrame.click();
            console.log('✅ Kliknięto przycisk w iframe');
            await page.waitForTimeout(5000);
          }
        } catch (e) {
          // ignoruj błędy frame
        }
      }
      
      // Sprawdź różne typy bannerów przez API
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
        await page.waitForTimeout(5000);
      }
      
      // ULEPSZONA LISTA SELEKTORÓW
      const acceptButtons = [
        // Najpopularniejsze CMP
        '#onetrust-accept-btn-handler',
        '#accept-recommended-btn-handler',
        '.onetrust-close-btn-handler',
        '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
        '.cookiebot-dialog-accept-all',
        '#CookieBoxSaveButton',
        '.gdpr-popup-accept',
        '.cc-btn.cc-allow',
        '.cc-btn.cc-dismiss',
        '[data-cookiebanner="accept_button"]',
        '[data-cookie-consent="accept"]',
        
        // Polskie wersje
        'button:has-text("Akceptuj wszystkie")',
        'button:has-text("Zaakceptuj wszystkie")', 
        'button:has-text("Akceptuję")',
        'button:has-text("Zgadzam się")',
        'button:has-text("Wyrażam zgodę")',
        'button:has-text("Zezwól na wszystkie")',
        'button:has-text("Przejdź do serwisu")',
        
        // Angielskie
        'button:has-text("Accept all")',
        'button:has-text("Accept All")',
        'button:has-text("Allow all")',
        'button:has-text("Allow All")',
        'button:has-text("I agree")',
        'button:has-text("Continue")',
        
        // Generyczne
        'button[id*="accept"]',
        'button[id*="allow"]',
        'button[id*="agree"]',
        'button[class*="accept"]',
        'button[class*="allow"]',
        'button[class*="agree"]',
        'a[id*="accept"]',
        'a[class*="accept"]',
        '.btn-accept',
        '.accept-btn',
        '.cookie-accept',
        '.accept-cookies'
      ];
      
      // Próbuj każdy selektor
      let clicked = false;
      for (const selector of acceptButtons) {
        try {
          // Sprawdź czy element jest widoczny
          const button = await page.waitForSelector(selector, { 
            timeout: 1000,
            state: 'visible' 
          });
          
          if (button) {
            await button.click();
            console.log(`✅ Kliknięto przycisk: ${selector}`);
            clicked = true;
            await page.waitForTimeout(7000);
            break;
          }
        } catch (e) {
          // próbuj dalej
        }
      }
      
      // NOWE: Jeśli nie kliknięto, spróbuj force click
      if (!clicked) {
        try {
          const forcedClick = await page.evaluate(() => {
            // Znajdź wszystkie przyciski z tekstem accept/allow
            const buttons = Array.from(document.querySelectorAll('button, a'));
            const acceptButton = buttons.find(btn => {
              const text = btn.textContent.toLowerCase();
              return text.includes('accept') || 
                     text.includes('akceptuj') || 
                     text.includes('zgadzam') ||
                     text.includes('allow') ||
                     text.includes('agree') ||
                     text.includes('zezwól');
            });
            
            if (acceptButton) {
              acceptButton.click();
              return true;
            }
            return false;
          });
          
          if (forcedClick) {
            console.log('✅ Wymuszono kliknięcie przycisku zgody');
            await page.waitForTimeout(7000);
          }
        } catch (e) {
          console.log('⚠️ Nie znaleziono przycisku zgody');
        }
      }
      
    } catch (cookieError) {
      console.log('⚠️ Problem z obsługą cookies:', cookieError.message);
    }
    
    // Dodatkowy czas na załadowanie wszystkiego
    await page.waitForTimeout(3000);
    
    // Sprawdź skrypty PO ZGODZIE
    const scripts = await page.evaluate(() => {
      const results = {
        gtm: null,
        ga4: null,
        fbPixel: false,
        scripts_found: [],
        dataLayer: false,
        cookieConsent: null,
        loadedAfterConsent: false,
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
        otherScripts: {
          clarity: false,
          hotjar: false,
          intercom: false,
          cookiebot: false,
          onetrust: false,
          crazyegg: false,
          fullstory: false,
          tiktok: false,
          linkedin: false,
          pinterest: false,
          twitter: false,
          snitcher: false,
          leadfeeder: false,
          getresponse: false,
          youtube: false,
          vimeo: false,
          fastcall: false
        },
        metrics: {
          totalScripts: 0,
          marketingTools: [],
          videoAPIs: [],
          performanceWarning: false
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
      const allScripts = document.querySelectorAll('script');
      results.metrics.totalScripts = allScripts.length;
      
      allScripts.forEach(script => {
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
          
          // SPRAWDŹ INNE SKRYPTY - WSZYSTKIE
          // Microsoft Clarity
          if (script.src.includes('clarity.ms')) {
            results.otherScripts.clarity = true;
          }
          
          // Hotjar
          if (script.src.includes('hotjar.com')) {
            results.otherScripts.hotjar = true;
          }
          
          // Intercom
          if (script.src.includes('intercom.io')) {
            results.otherScripts.intercom = true;
          }
          
          // Cookiebot
          if (script.src.includes('cookiebot.com')) {
            results.otherScripts.cookiebot = true;
          }
          
          // OneTrust
          if (script.src.includes('onetrust.com')) {
            results.otherScripts.onetrust = true;
          }
          
          // CrazyEgg
          if (script.src.includes('crazyegg.com')) {
            results.otherScripts.crazyegg = true;
          }
          
          // FullStory
          if (script.src.includes('fullstory.com')) {
            results.otherScripts.fullstory = true;
          }
          
          // TikTok
          if (script.src.includes('analytics.tiktok.com')) {
            results.otherScripts.tiktok = true;
          }
          
          // LinkedIn
          if (script.src.includes('snap.licdn.com')) {
            results.otherScripts.linkedin = true;
          }
          
          // Pinterest
          if (script.src.includes('ct.pinterest.com')) {
            results.otherScripts.pinterest = true;
          }
          
          // Twitter/X
          if (script.src.includes('static.ads-twitter.com')) {
            results.otherScripts.twitter = true;
          }
          
          // Snitcher
          if (script.src.includes('snitcher.com')) {
            results.otherScripts.snitcher = true;
            results.metrics.marketingTools.push('Snitcher');
          }
          
          // Leadfeeder
          if (script.src.includes('lfeeder.com')) {
            results.otherScripts.leadfeeder = true;
            results.metrics.marketingTools.push('Leadfeeder');
          }
          
          // GetResponse
          if (script.src.includes('gr-cdn.com') || script.src.includes('gr-wcon.com')) {
            results.otherScripts.getresponse = true;
            results.metrics.marketingTools.push('GetResponse');
          }
          
          // YouTube
          if (script.src.includes('youtube.com/iframe_api') || script.src.includes('youtube.com/s/player')) {
            results.otherScripts.youtube = true;
            results.metrics.videoAPIs.push('YouTube');
          }
          
          // Vimeo
          if (script.src.includes('player.vimeo.com')) {
            results.otherScripts.vimeo = true;
            results.metrics.videoAPIs.push('Vimeo');
          }
          
          // FastCall
          if (script.src.includes('fastcall')) {
            results.otherScripts.fastcall = true;
            results.metrics.marketingTools.push('FastCall');
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
      
      // Sprawdź wydajność
      if (results.metrics.totalScripts > 40) {
        results.metrics.performanceWarning = true;
      }
      
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
    
    // SPRAWDŹ CZY SKRYPTY ZAŁADOWAŁY SIĘ PO ZGODZIE
    if (!scriptsBeforeConsent.ga4 && scripts.ga4) {
      scripts.loadedAfterConsent = true;
      console.log('⚠️ GA4 załadował się dopiero po akceptacji cookies!');
    }
    if (!scriptsBeforeConsent.gtm && scripts.gtm) {
      scripts.loadedAfterConsent = true;
      console.log('⚠️ GTM załadował się dopiero po akceptacji cookies!');
    }
    
    console.log('✅ Sprawdzanie zakończone');
    console.log(`📊 Znaleziono: GTM=${scripts.gtm}, GA4=${scripts.ga4}, FB=${scripts.fbPixel}`);
    console.log(`🔐 Consent Mode: ${scripts.consentMode.implemented ? 'TAK' : 'NIE'}`);
    console.log(`🏷️ Kody zgód: ${scripts.consentMode.consentCodes.join(', ') || 'BRAK'}`);
    console.log(`📈 Liczba skryptów: ${scripts.metrics.totalScripts}`);
    
    // DEBUG: Pokaż zebrane eventy
    const tiktokEvents = capturedEvents.filter(e => e.type === 'TikTok');
    console.log(`🎯 TikTok events:`, tiktokEvents.length);
    tiktokEvents.forEach(e => console.log(`  - ${e.eventName} (ID: ${e.pixelId})`));
    
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
