const puppeteer = require('puppeteer');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

async function recordWalkthrough(url, pages, outputFile = 'walkthrough.mp4') {
  // Ensure output directory exists
  const outputPath = path.join(__dirname, 'output');
  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath);
  }
  const fullOutputPath = path.join(outputPath, outputFile);

  // Launch Puppeteer in headless mode
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  // Start screen recording with FFmpeg
  execSync(
    `ffmpeg -y -f x11grab -framerate 30 -s 1280x720 -i :0.0 -c:v libx264 -preset ultrafast ${fullOutputPath}`,
    { stdio: 'ignore' }
  );

  // Navigate and record each page
  for (const pagePath of pages) {
    const fullUrl = pagePath.startsWith('http') ? pagePath : `${url}${pagePath}`;
    await page.goto(fullUrl, { waitUntil: 'networkidle2' });

    // Simulate user interaction (scroll)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise(resolve => setTimeout(resolve, 10000)); // 10s per page
  }

  // Add YeahBuddy branding overlay
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
  await new Promise(resolve => setTimeout(resolve, 5000)); // 5s for branding

  // Stop recording
  execSync('pkill ffmpeg', { stdio: 'ignore' });

  // Close browser
  await browser.close();

  return fullOutputPath;
}

// Vercel API endpoint
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
    // Serve the video file for download
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename=${path.basename(videoFile)}`);
    fs.createReadStream(videoFile).pipe(res);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to generate video' });
  }
};