import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Wiramart UNPERBA — Campus Delivery',
    short_name: 'Wiramart',
    description: 'Pesan snack, minuman & kebutuhan kampus UNPERBA diantar langsung ke ruang kelas',
    start_url: '/order',
    display: 'standalone',
    background_color: '#f0fdf4',
    theme_color: '#1b7a42',
    orientation: 'portrait',
    icons: [
      {
        src: '/icon.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/apple-icon.png',
        sizes: '180x180',
        type: 'image/png',
      },
    ],
  };
}
