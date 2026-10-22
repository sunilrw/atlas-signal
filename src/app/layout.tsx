import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter/wght.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Atlas Signal — See the world as it changes.", template: "%s · Atlas Signal" },
  description: "A calm, map-first workspace for global events. Explore reporting, trace sources, and understand the difference between observation and analysis.",
  applicationName: "Atlas Signal",
  robots: { index: false, follow: false }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0e11"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
