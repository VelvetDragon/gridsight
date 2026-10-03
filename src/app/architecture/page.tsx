import type { Metadata, Viewport } from "next";
import { BuildShow } from "@/components/architecture/BuildShow";

export const metadata: Metadata = {
  title: "How it's built",
  description: "MrGridy's architecture, built one part at a time.",
};

export const viewport: Viewport = {
  themeColor: "#060910",
};

export default function Page() {
  return <BuildShow />;
}
