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
    
    // ULEPSZONA OBSŁUGA COOKIES - NAJPIERW KLIKANIE, POTEM API
    let cookieClicked = false;
    
    try {
      console.log('🍪 Sprawdzam bannery cookies...');
      
      // Poczekaj aż banner się pojawi
      await page.waitForTimeout(2000);
      
      // ROZSZERZONA LISTA PRZYCISKÓW - WSZYSTKIE MOŻLIWE CMP
      const acceptButtons = [
        // Cookiebot
        '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
        '#CybotCookiebotDialogBodyButtonLevelOptinAllowAll',
        '.CybotCookiebotDialogBodyButton[id*="AllowAll"]',
        
        // OneTrust
        '#onetrust-accept-btn-handler',
        '#accept-recommended-btn-handler',
        '.onetrust-close-btn-handler',
        '#onetrust-pc-btn-handler',
        '.ot-pc-refuse-all-handler',
        '#onetrust-button-group button[class*="save-preference"]',
        
        // ConsentManager.net
        '#cmpbntyestxt',
        '#cmpwelcomebtnyes',
        '.cmpboxbtnyes',
        '[data-cmp-action="accept"]',
        'button[onclick*="__cmp"]',
        '.cmp-accept-all',
        
        // Klaro
        '.cn-accept-all',
        '.klaro .cn-accept',
        '.cm-btn-success',
        
        // Complianz
        '.cmplz-accept',
        '.cmplz-btn-accept-all',
        
        // Borlabs
        '#BorlabsCookieBoxSaveButton',
        '.BorlabsCookie-button-accept-all',
        
        // CookieYes
        '.cky-btn-accept',
        '.cky-btn-accept-all',
        
        // GDPR Cookie Consent
        '#cookie_action_close_header',
        '.gdpr-cookie-accept',
        
        // WP Cookie Notice
        '#cn-accept-cookie',
        '.cn-button',
        
        // Termly
        '.t-cookie-consent-button',
        '#consent-accept-all',
        
        // Uniwersalne selektory
        '[id*="acceptAll"]',
        '[id*="accept-all"]',
        '[class*="accept-all"]',
        '[class*="acceptAll"]',
        'button[data-cookiebanner="accept_button"]',
        'button[data-cookie-consent="accept"]',
        '.cc-btn.cc-allow',
        '.cc-btn.cc-dismiss',
        
        // Polskie wersje - WSZYSTKIE
        'button:has-text("Zezwól na wszystkie")',
        'button:has-text("Zaakceptuj wszystkie")',
        'button:has-text("Akceptuj wszystkie")',
        'button:has-text("Akceptuję")',
        'button:has-text("Akceptuj")',
        'button:has-text("Akceptuj wszystko")',
        'button:has-text("Akceptuję wszystkie zgody")',
        'button:has-text("Akceptuję wszystkie")',
        'button:has-text("Akceptuję wszystkie pliki cookies")',
        'button:has-text("Zgadzam się")',
        'button:has-text("Zgadzam się na wszystkie")',
        'button:has-text("Zgadzam się na wszystko")',
        'button:has-text("Zaakceptuj wszystkie zgody")',
        'button:has-text("Zaakceptuj wszystkie pliki cookies")',
        'button:has-text("Wyrażam zgodę")',
        'button:has-text("Wyrażam zgodę na wszystko")',
        'button:has-text("Wyrażam zgodę na wszystkie")',
        'button:has-text("Zatwierdź")',
        'button:has-text("Zatwierdź wszystkie")',
        'button:has-text("Potwierdź wszystkie")',
        'button:has-text("Tak, zgadzam się")',
        'button:has-text("Wszystko jasne")',
        'button:has-text("Przejdź dalej")',
        'button:has-text("Kontynuuj z pełną zgodą")',
        'button:has-text("OK")',
        
        // Angielskie
        'button:has-text("Accept all")',
        'button:has-text("Accept All")',
        'button:has-text("Allow all")',
        'button:has-text("Allow All")',
        'button:has-text("Accept")',
        'button:has-text("I agree")',
        'button:has-text("Agree")',
        'button:has-text("Continue")',
        'button:has-text("Got it")',
        'button:has-text("I understand")',
        
        // Niemieckie
        'button:has-text("Alle akzeptieren")',
        'button:has-text("Alles akzeptieren")',
        'button:has-text("Zustimmen")',
        
        // Generyczne końcowe
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
      
      // KROK 1: Najpierw próbuj kliknąć przyciski
      for (const selector of acceptButtons) {
        try {
          // Sprawdź czy element istnieje i jest widoczny
          const button = await page.waitForSelector(selector, { 
            timeout: 500,
            state: 'visible' 
          });
          
          if (button) {
            await button.click();
            console.log(`✅ Kliknięto przycisk: ${selector}`);
            cookieClicked = true;
            // DŁUŻSZE CZEKANIE PO ZGODZIE
            await page.waitForTimeout(7000);
            break;
          }
        } catch (e) {
          // próbuj dalej
        }
      }
      
      // KROK 2: Jeśli nie znaleziono przez selektory, sprawdź iframe
      if (!cookieClicked) {
        const frames = page.frames();
        for (const frame of frames) {
          try {
            for (const selector of acceptButtons.slice(0, 20)) { // Sprawdź pierwsze 20 selektorów w iframe
              const button = await frame.$(selector);
              if (button) {
                await button.click();
                console.log(`✅ Kliknięto przycisk w iframe: ${selector}`);
                cookieClicked = true;
                await page.waitForTimeout(7000);
                break;
              }
            }
            if (cookieClicked) break;
          } catch (e) {
            // ignoruj błędy frame
          }
        }
      }
      
      // KROK 3: Force click jako ostatnia deska ratunku
      if (!cookieClicked) {
        try {
          const forcedClick = await page.evaluate(() => {
            // Znajdź wszystkie możliwe elementy
            const elements = Array.from(document.querySelectorAll('button, a, div[role="button"], span[role="button"], input[type="button"], input[type="submit"]'));
            
            // Szukaj po tekście
            const acceptButton = elements.find(el => {
              const text = (el.textContent || el.value || '').toLowerCase();
              const hasAcceptText = (
                text.includes('accept') || 
                text.includes('akceptuj') || 
                text.includes('zgadzam') ||
                text.includes('allow') ||
                text.includes('agree') ||
                text.includes('zezwól') ||
                text.includes('wyrażam zgodę') ||
                text.includes('zatwierdź') ||
                text.includes('potwierdź') ||
                text.includes('wszystko jasne') ||
                text.includes('kontynuuj') ||
                text.includes('ok') ||
                text.includes('got it')
              );
              
              const hasRejectText = (
                text.includes('nie') ||
                text.includes('no') ||
                text.includes('reject') ||
                text.includes('odrzuć') ||
                text.includes('decline')
              );
              
              return hasAcceptText && !hasRejectText && text.length < 50;
            });
            
            if (acceptButton) {
              acceptButton.click();
              return true;
            }
            
            // Jeśli nie znaleziono, szukaj po atrybutach
            const acceptByAttr = elements.find(el => {
              const attrs = (el.className + ' ' + el.id + ' ' + (el.getAttribute('data-action') || '')).toLowerCase();
              return attrs.includes('accept') || attrs.includes('allow') || attrs.includes('agree');
            });
            
            if (acceptByAttr) {
              acceptByAttr.click();
              return true;
            }
            
            return false;
          });
          
          if (forcedClick) {
            console.log('✅ Wymuszono kliknięcie przycisku zgody');
            cookieClicked = true;
            await page.waitForTimeout(7000);
          }
        } catch (e) {
          console.log('⚠️ Nie znaleziono przycisku zgody');
        }
      }
      
      // KROK 4: Jako absolutnie ostatnia opcja - spróbuj JS API (ale tylko jeśli nic nie kliknięto)
      if (!cookieClicked) {
        const apiHandled = await page.evaluate(() => {
          // ConsentManager
          if (window.__cmp) {
            window.__cmp('acceptAll');
            return 'ConsentManager';
          }
          
          // Cookiebot - poprawione
          if (window.Cookiebot && window.Cookiebot.show === false) {
            // Banner już był pokazany, akceptuj programowo
            if (window.Cookiebot.submitCustomConsent) {
              window.Cookiebot.submitCustomConsent(true, true, true);
            }
            return 'Cookiebot-API';
          }
          
          // OneTrust
          if (window.OneTrust && window.OneTrust.AllowAll) {
            window.OneTrust.AllowAll();
            return 'OneTrust';
          }
          
          // Klaro
          if (window.klaro) {
            window.klaro.getManager().acceptAll();
            return 'Klaro';
          }
          
          return null;
        });
        
        if (apiHandled) {
          console.log(`✅ Zaakceptowano przez API: ${apiHandled}`);
          cookieClicked = true;
          await page.waitForTimeout(7000);
        }
      }
      
      // Poczekaj na załadowanie po akceptacji
      await page.waitForTimeout(5000);
      
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
      } else if (window.BorlabsCookie) {
        results.cookieConsent = 'Borlabs';
      } else if (window.complianz) {
        results.cookieConsent = 'Complianz';
      } else if (window.__cmp) {
        results.cookieConsent = 'ConsentManager';
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
            if (!results.metrics.marketingTools.includes('GetResponse')) {
              results.metrics.marketingTools.push('GetResponse');
            }
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
    
    // DEBUG: Pokaż status cookies
    if (scripts.debug.cookiebotConsent) {
      console.log('🍪 Cookiebot consent:', scripts.debug.cookiebotConsent);
    }
    
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
