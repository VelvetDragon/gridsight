import type { Metadata } from "next";
import { Crosswire } from "@/components/crosswire/Crosswire";

export const metadata: Metadata = {
  title: "Crosswire",
  description: "Where two utilities' plans cross, on the map and on the calendar.",
};

export default function Page() {
  return <Crosswire />;
}
