const puppeteer = require('puppeteer-core');
const crypto = require('crypto');

const URL = 'https://amoba-prod-278479-6-1255680742.sh.run.tcloudbase.com/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SECRET = 'amoeba-demo-secret-2026';

function makeToken() {
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ id: 3, username: 'admin', name: '管理员', company_name: '系统默认企业', role: 'admin', iat: Math.floor(Date.now()/1000) })).toString('base64url');
  const s = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.evaluate((t) => localStorage.setItem('amoeba_token', t), makeToken());
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 3000));
  await page.evaluate(() => { if (typeof App !== 'undefined') App.switchPage('manual'); });
  await new Promise(r => setTimeout(r, 2500));

  const info = await page.evaluate(() => {
    const toc = document.querySelector('.manual-toc');
    const firstLink = document.querySelector('.manual-toc a');
    const tocStyle = toc ? window.getComputedStyle(toc) : null;
    const linkStyle = firstLink ? window.getComputedStyle(firstLink) : null;
    const img = document.querySelector('#page-manual img');
    const imgStyle = img ? window.getComputedStyle(img) : null;
    const ch9 = document.getElementById('ch9');
    return {
      tocWidth: tocStyle ? tocStyle.width : null,
      tocPosition: tocStyle ? tocStyle.position : null,
      firstLinkText: firstLink ? firstLink.textContent : null,
      linkWhiteSpace: linkStyle ? linkStyle.whiteSpace : null,
      firstImgMaxHeight: imgStyle ? imgStyle.maxHeight : null,
      firstImgDisplay: imgStyle ? imgStyle.display : null,
      ch9Title: ch9 ? ch9.querySelector('h2').textContent : null,
      ch9HasAdmin: ch9 ? ch9.innerText.includes('admin') : null,
      ch9HasAccountMgmt: ch9 ? ch9.innerText.includes('账号管理') : null,
      ch9TextPreview: ch9 ? ch9.innerText.slice(0, 200) : null
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
