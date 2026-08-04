import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'AI Stocks Dashboard',
  description: 'Positions, performance and open orders across the AI theme basket.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <div className="shell">{children}</div>
      </body>
    </html>
  )
}
