import "./globals.css";
import type { Metadata } from "next";
export const metadata: Metadata={title:"OUTLIVO — AI Voice Calling & Sales Automation",description:"A thoughtful workspace for AI voice conversations and sales automation.",icons:{icon:"/icon.svg"}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body><div className="shell">{children}</div></body></html>}
