import { getContentGroupedByCategory } from "@/lib/content";
import AppShell from "@/components/AppShell";

export default function Home() {
  const groups = getContentGroupedByCategory();
  return <AppShell groups={groups} />;
}
