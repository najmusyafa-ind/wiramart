import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

async function main() {
  const campusPath = path.resolve(process.cwd(), 'public/unperba_campus.jpg');
  const showcasePath = path.resolve(process.cwd(), 'public/wiramart_showcase.jpg');

  console.log('Original campus size:', fs.statSync(campusPath).size, 'bytes');
  console.log('Original showcase size:', fs.statSync(showcasePath).size, 'bytes');

  // Backup originals first
  const campusBackup = path.resolve(process.cwd(), 'public/unperba_campus.orig.jpg');
  const showcaseBackup = path.resolve(process.cwd(), 'public/wiramart_showcase.orig.jpg');
  if (!fs.existsSync(campusBackup)) fs.copyFileSync(campusPath, campusBackup);
  if (!fs.existsSync(showcaseBackup)) fs.copyFileSync(showcasePath, showcaseBackup);

  // Optimize unperba_campus.jpg: resize max width 1920, quality 82 mozjpeg
  const optCampus = await sharp(campusBackup)
    .resize({ width: 1920, withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();

  fs.writeFileSync(campusPath, optCampus);
  console.log('Optimized campus size:', optCampus.length, 'bytes (Saved', Math.round((1 - optCampus.length / fs.statSync(campusBackup).size) * 100), '%)');

  // Optimize wiramart_showcase.jpg: resize max width 1600, quality 80 mozjpeg
  const optShowcase = await sharp(showcaseBackup)
    .resize({ width: 1600, withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();

  fs.writeFileSync(showcasePath, optShowcase);
  console.log('Optimized showcase size:', optShowcase.length, 'bytes (Saved', Math.round((1 - optShowcase.length / fs.statSync(showcaseBackup).size) * 100), '%)');

  // Clean up backups so public remains clean
  fs.unlinkSync(campusBackup);
  fs.unlinkSync(showcaseBackup);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
