import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

export default defineConfig({
  // Egyetlen forrás-ikon → ebből generál minden méretet
  images: ['public/app-icon.svg'],
  preset: {
    ...minimal2023Preset,
    // Minden eszközhöz lekerekített "maskable" verzió is
    maskable: {
      sizes: [512],
      // 10% safe-zone padding (telefon launcher kerek/squircle maszkokhoz)
      padding: 0.1,
      // A háttér áttetszően marad, mert az SVG-ben már van rounded rect alap
      resizeOptions: { background: 'transparent', fit: 'contain' },
    },
  },
  headLinkOptions: {
    preset: '2023',
  },
});
