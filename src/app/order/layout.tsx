import type { Metadata, Viewport } from 'next';
import { CartProvider } from '@/features/order/cart.context';
import CartDrawer from '@/app/order/components/CartDrawer';
import './order.css';

export const metadata: Metadata = {
  title: 'Wiramart Delivery | Pesan & Antar Sampai Kelas UNPERBA',
  description:
    'Layanan pesan antar makanan, minuman & ATK resmi UKM Wiramart UNPERBA. Tanpa repot turun tangga, pesanan diantar langsung ke lantai & ruang kelas Anda.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Wiramart',
  },
};

export const viewport: Viewport = {
  themeColor: '#1b7a42',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function OrderLayout({ children }: { children: React.ReactNode }) {
  return (
    <CartProvider>
      <div className="wiramart-pwa-root">
        <div className="wiramart-pwa-container">
          {children}
          <CartDrawer />
        </div>
      </div>
    </CartProvider>
  );
}
