import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'AI Stocks Dashboard',
  description: 'Positions, performance and open orders across the AI theme basket.',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'AI Stocks',
  },
  themeColor: '#4c7fd1',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </head>
      <body>
        <div className="shell">{children}</div>
      </body>
    </html>
  )
}
