import { copyFile, mkdir } from 'node:fs/promises';
export async function preparePetAssets() {
  await mkdir(new URL('../assets/', import.meta.url), { recursive: true });
  await copyFile(new URL('../../app/ui-colors.css', import.meta.url), new URL('../assets/ui-colors.css', import.meta.url));
  await mkdir(new URL('../pet/lumior-pet/', import.meta.url), { recursive: true });
  for (const name of ['lumior-pet.js', 'pet-data.js', 'pet-data@2x.js', 'options.js']) {
    await copyFile(new URL(`../../public/assets/lumior-pet/${name}`, import.meta.url), new URL(`../pet/lumior-pet/${name}`, import.meta.url));
  }
}
