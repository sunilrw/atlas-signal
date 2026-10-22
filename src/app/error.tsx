"use client";

import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("Atlas Signal rendering error", error.digest ?? error.name); }, [error]);
  return <main className="not-found"><span className="eyebrow">CONNECTION INTERRUPTED</span><h1>Let’s try that again.</h1><p>The workspace couldn’t finish loading. Your saved items are still on this device.</p><button className="primary-button" onClick={reset}>Reload the workspace</button></main>;
}
