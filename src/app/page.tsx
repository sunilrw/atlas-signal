import { Suspense } from "react";
import { AtlasApp } from "@/components/AtlasApp";

export default function HomePage() {
  return <Suspense fallback={<div className="app-loading"><span className="loading-orbit" /><span>Opening the world</span></div>}><AtlasApp /></Suspense>;
}
