import { Suspense } from "react";
import { AtlasApp } from "@/components/AtlasApp";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Country intelligence" };

export default async function CountryPage({ params }: { params: Promise<{ country: string }> }) {
  const { country } = await params;
  return <Suspense fallback={<div className="app-loading">Opening country</div>}><AtlasApp initialCountry={country} /></Suspense>;
}
