const puppeteer = require('puppeteer');
const ffmpeg = require('ffmpeg-static');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

async function recordWalkthrough(url, pages, outputFile = 'walkthrough.mp4') {
  const outputPath = path.join(__dirname, 'output');
  if (!fs.existsSync(outputPath)) fs.mkdirSync(outputPath);
  const fullOutputPath = path.join(outputPath, outputFile);
  const tempDir = path.join(outputPath, 'temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  // Capture screenshots for each page
  const screenshots = [];
  for (let i = 0; i < pages.length; i++) {
    const pagePath = pages[i];
    const fullUrl = pagePath.startsWith('http') ? pagePath : `${url}${pagePath}`;
    await page.goto(fullUrl, { waitUntil: 'networkidle2' });

    // Scroll and capture
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const screenshotPath = path.join(tempDir, `frame${i}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    screenshots.push(screenshotPath);
  }

  // Add branding overlay
  await page.evaluate(() => {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '50%';
    overlay.style.left = '50%';
    overlay.style.transform = 'translate(-50%, -50%)';
    overlay.style.fontSize = '48px';
    overlay.style.color = 'white';
    overlay.style.background = 'rgba(0, 0, 0, 0.7)';
    overlay.style.padding = '20px';
    overlay.innerText = 'Made by YeahBuddy.nz';
    document.body.appendChild(overlay);
  });
  const brandingPath = path.join(tempDir, 'branding.png');
  await page.screenshot({ path: brandingPath });
  screenshots.push(brandingPath);

  await browser.close();

  // Create video from screenshots
  const screenshotList = path.join(tempDir, 'screenshots.txt');
  fs.writeFileSync(
    screenshotList,
    screenshots.map((s, i) => `file '${s}'\nduration ${i === screenshots.length - 1 ? 5 : 10}`).join('\n')
  );

  execSync(
    `${ffmpeg} -y -f concat -safe 0 -i ${screenshotList} -c:v libx264 -pix_fmt yuv420p -r 30 ${fullOutputPath}`,
    { stdio: 'ignore' }
  );

  // Clean up
  fs.unlinkSync(screenshotList);
  screenshots.forEach(s => fs.unlinkSync(s));
  fs.rmdirSync(tempDir);

  return fullOutputPath;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url, pages } = req.body;
  if (!url || !pages || !Array.isArray(pages)) {
    return res.status(400).json({ error: 'Missing url or pages' });
  }

  try {
    const videoFile = await recordWalkthrough(url, pages);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename=${path.basename(videoFile)}`);
    fs.createReadStream(videoFile).pipe(res);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to generate video' });
  }
};
