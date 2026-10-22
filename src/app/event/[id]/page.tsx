import { Suspense } from "react";
import { AtlasApp } from "@/components/AtlasApp";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isRemovedSampleId } from "@/lib/live-data";
import { decodeEventPageId } from "@/lib/event-route";

export const metadata: Metadata = { title: "Event intelligence" };

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const id = decodeEventPageId((await params).id);
  if (id === null || isRemovedSampleId(id)) notFound();
  return <Suspense fallback={<div className="app-loading">Opening event</div>}><AtlasApp initialEventId={id} /></Suspense>;
}
