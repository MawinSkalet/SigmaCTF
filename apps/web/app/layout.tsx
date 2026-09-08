import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'SigmaCTF — Enter the arena',description:'Ephemeral challenges. Permanent Aura. A local-first capture the flag arena.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}
