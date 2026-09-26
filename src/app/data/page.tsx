import type { Metadata } from "next";
import { Ledger } from "@/components/ledger/Ledger";

export const metadata: Metadata = {
  title: "The Ledger",
  description: "Every project, overlap and source. Export to Excel.",
};

export default function Page() {
  return <Ledger />;
}
