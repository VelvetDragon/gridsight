import type { Metadata } from "next";
import { CrossBoard } from "@/components/crossboard/CrossBoard";

export const metadata: Metadata = {
  title: "Crosswire",
  description: "Where two utilities' plans cross: map, calendar and details side by side.",
};

export default function Page() {
  return <CrossBoard />;
}
