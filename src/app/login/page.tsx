import type { Metadata } from "next";
import { AuthScreen } from "@/components/auth/AuthScreen";

export const metadata: Metadata = { title: "Sign in" };

export default function Page() {
  return <AuthScreen mode="login" />;
}
