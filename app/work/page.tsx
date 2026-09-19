import { RubricWorkWindow } from "@/components/rubric-work-window";

export const metadata = {
  title: "Agentic OS · Command & Content Intelligence",
  description: "Autonomous Scraping, AI Priority Ranking, Content Studio & Local 3D HUD.",
};

export default function WorkPage() {
  return <RubricWorkWindow isStandalone={true} />;
}
