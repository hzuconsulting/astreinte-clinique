/**
 * Deux cibles, une configuration :
 *  - par défaut : `next dev` pour développer ;
 *  - `NEXT_OUTPUT=export` : site 100 % statique, la cible réelle (GitHub Pages).
 * `NEXT_PUBLIC_BASE_PATH` : sous-dossier du site (`/nom-du-depot` sur Pages).
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
const isExport = process.env.NEXT_OUTPUT === 'export';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  ...(isExport ? { output: 'export' } : {}),
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
