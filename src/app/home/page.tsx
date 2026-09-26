import type { Metadata } from "next";
import { Switchboard } from "@/components/switchboard/Switchboard";

export const metadata: Metadata = {
  title: "Switchboard",
  description: "What do you want to do?",
};

export default function Page() {
  return <Switchboard />;
}
