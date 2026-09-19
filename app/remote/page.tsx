import { RemoteControl } from "@/components/remote-control";

export const metadata = {
  title: "Agentic OS · Remote Control",
  description: "Direct wireless smartphone controller for Agentic OS.",
};

export default function RemotePage() {
  return <RemoteControl isStandalone={true} />;
}
