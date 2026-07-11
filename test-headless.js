const puppeteer = require('puppeteer');
const http = require('http');
const InspectorProxy = require('/home/maakstar/EXOVON_ECOSYSTEM/exovonhub/dist/agent/InspectorProxy').InspectorProxy;

(async () => {
    const proxy = new InspectorProxy((data) => console.log('INSPECTOR DATA:', data));
    const proxyPort = await proxy.start(3015);
    console.log('Proxy on', proxyPort);

    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    await page.goto(`http://localhost:${proxyPort}`);
    
    // Wait for the badge to appear to confirm injection
    await page.waitForSelector('div[style*="Astrolabe"]', { timeout: 2000 }).catch(e => console.log('Badge not found!'));
    
    // Simulate mouse move
    await page.mouse.move(100, 100);
    await new Promise(r => setTimeout(r, 500));
    
    const overlayDisplay = await page.evaluate(() => {
        // Find the overlay. It's the first div appended to body with pointer-events: none
        const divs = document.body.querySelectorAll('div');
        for (let d of divs) {
            if (d.style.backgroundColor === 'rgba(59, 130, 246, 0.2)') {
                return d.style.display;
            }
        }
        return 'Not found';
    });
    
    console.log('OVERLAY DISPLAY:', overlayDisplay);
    
    // Simulate click
    await page.mouse.click(100, 100);
    await new Promise(r => setTimeout(r, 500));
    
    const menuDisplay = await page.evaluate(() => {
        const divs = document.body.querySelectorAll('div');
        for (let d of divs) {
            if (d.style.backgroundColor === 'rgb(45, 45, 45)') {
                return d.style.display;
            }
        }
        return 'Not found';
    });
    
    console.log('MENU DISPLAY:', menuDisplay);

    await browser.close();
    process.exit(0);
})();
