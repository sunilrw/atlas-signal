import { notFound } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Conflict context" };

export default function ConflictPage() {
  // No attributed, editorially maintained conflict profiles are configured.
  // News categorized as conflict remains available through the live map/feed.
  notFound();
}
