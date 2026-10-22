import Link from "next/link";
import { ArrowLeft, Globe2 } from "lucide-react";

export default function NotFound() {
  return <main className="not-found"><Globe2 size={48} strokeWidth={1} /><span className="eyebrow">OUTSIDE THE MAP</span><h1>We couldn’t find that page.</h1><p>The world is still here. Let’s take you back.</p><Link href="/"><ArrowLeft size={16} /> Return to the map</Link></main>;
}
