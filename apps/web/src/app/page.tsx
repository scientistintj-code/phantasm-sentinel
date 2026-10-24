import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: { absolute: "Phantasm Sentinel" },
  description: "Forensic console for unmasking dynamic cyber-scam infrastructure.",
  openGraph: {
    title: "Phantasm Sentinel",
    description: "Forensic console for unmasking dynamic cyber-scam infrastructure.",
  },
};

export default function Home() {
  redirect("/cases");
  return null;
}
