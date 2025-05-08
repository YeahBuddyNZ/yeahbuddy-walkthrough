const puppeteer = require('puppeteer');
const ffmpeg = require('ffmpeg-static');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

async function recordWalkthrough(url, pages, outputFile = 'walkthrough.mp4') {
  try {
    // Validate URL
    const urlPattern = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;
    if (!urlPattern.test(url)) {
      throw new Error('Invalid URL format');
    }

    const outputPath = path.join('/tmp', 'output');
    if (!fs.existsSync(outputPath)) fs.mkdirSync(outputPath, { recursive: true });
    const fullOutputPath = path.join(outputPath, outputFile);
    const tempDir = path.join(outputPath, 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    console.log(`Starting Puppeteer for ${url}`);
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 640, height: 360 }); // Further reduced resolution

    const screenshots = [];
    for (let i = 0; i < pages.length; i++) {
      const pagePath = pages[i];
      const fullUrl = pagePath.startsWith('http') ? pagePath : `${url}${pagePath}`;
      console.log(`Navigating to ${fullUrl}`);
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await page.goto(fullUrl, { waitUntil: 'networkidle2', timeout: 20000 });
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          const screenshotPath = path.join(tempDir, `frame${i}.png`);
          await page.screenshot({ path: screenshotPath });
          screenshots.push(screenshotPath);
          break;
        } catch (err) {
          console.error(`Attempt ${attempt} failed for ${fullUrl}: ${err.message}`);
          if (attempt === 3) {
            console.error(`All attempts failed for ${fullUrl}`);
          }
        }
      }
    }

    if (screenshots.length > 0) {
      console.log('Adding branding overlay');
      await page.evaluate(() => {
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = '50%';
        overlay.style.left = '50%';
        overlay.style.transform = 'translate(-50%, -50%)';
        overlay.style.fontSize = '24px';
        overlay.style.color = 'white';
        overlay.style.background = 'rgba(0, 0, 0, 0.7)';
        overlay.style.padding = '10px';
        overlay.innerText = 'Made by YeahBuddy.nz';
        document.body.appendChild(overlay);
      });
      const brandingPath = path.join(tempDir, 'branding.png');
      await page.screenshot({ path: brandingPath });
      screenshots.push(brandingPath);
    }

    await browser.close();

    if (screenshots.length === 0) {
      throw new Error('No screenshots captured');
    }

    console.log('Creating video with FFmpeg');
    const screenshotList = path.join(tempDir, 'screenshots.txt');
    fs.writeFileSync(
      screenshotList,
      screenshots.map((s, i) => `file '${s}'\nduration ${i === screenshots.length - 1 ? 5 : 10}`).join('\n')
    );

    try {
      execSync(
        `${ffmpeg} -y -f concat -safe 0 -i ${screenshotList} -c:v libx264 -pix_fmt yuv420p -r 24 -vf "scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2" ${fullOutputPath}`,
        { stdio: 'inherit' }
      );
    } catch (ffmpegErr) {
      console.error(`FFmpeg failed: ${ffmpegErr.message}`);
      throw new Error(`Video creation failed: ${ffmpegErr.message}`);
    }

    console.log(`Video created at ${fullOutputPath}`);
    fs.unlinkSync(screenshotList);
    screenshots.forEach(s => fs.unlinkSync(s));
    fs.rmdirSync(tempDir);

    return fullOutputPath;
  } catch (err) {
    console.error(`Error in recordWalkthrough: ${err.message}`);
    throw err;
  }
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
    const videoStream = fs.createReadStream(videoFile);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename=${path.basename(videoFile)}`);
    videoStream.pipe(res);
    videoStream.on('end', () => {
      try {
        fs.unlinkSync(videoFile);
        fs.rmdirSync(path.dirname(videoFile), { recursive: true });
      } catch (cleanupErr) {
        console.error(`Cleanup failed: ${cleanupErr.message}`);
      }
    });
  } catch (error) {
    console.error(`API error: ${error.message}`);
    res.status(500).json({ error: `Failed to generate video: ${error.message}` });
  }
};
