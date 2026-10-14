import type { Metadata, Viewport } from "next";
import "./styles.css";
export const metadata: Metadata = { title: "Lakshmi Fabrication", description: "Simple workforce, contracts and accounts management.", manifest: "/manifest.webmanifest", appleWebApp: { capable: true, title: "Lakshmi", statusBarStyle: "default" } };
export const viewport: Viewport = { themeColor: "#173e35", width: "device-width", initialScale: 1 };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
