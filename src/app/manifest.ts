import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

/** Permet d'installer l'appli sur l'écran d'accueil du téléphone, avec son icône. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Astreintes — Clinique',
    short_name: 'Astreintes',
    description: 'Planning d’astreinte équitable pour l’équipe de chirurgie',
    start_url: './',
    scope: './',
    display: 'standalone',
    background_color: '#F6F8FB',
    theme_color: '#0F766E',
    lang: 'fr',
    // Chemins relatifs au manifeste : fonctionnent quel que soit le sous-dossier du site.
    icons: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
