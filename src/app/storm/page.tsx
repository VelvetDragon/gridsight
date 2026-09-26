import type { Metadata } from "next";
import { Stormline } from "@/components/stormline/Stormline";

export const metadata: Metadata = {
  title: "Stormline",
  description: "Where the next storm meets both grids.",
};

export default function Page() {
  return <Stormline />;
}
