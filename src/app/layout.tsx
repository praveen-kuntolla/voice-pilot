import "./globals.css";
import type { Metadata } from "next";
export const metadata: Metadata={title:"VoicePilot AI — conversations that convert",description:"An intelligent calling workspace for modern revenue teams."};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body><div className="shell">{children}</div></body></html>}
