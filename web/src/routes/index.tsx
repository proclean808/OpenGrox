import { createFileRoute } from "@tanstack/react-router";
import { Cockpit } from "@/components/cockpit";

export const Route = createFileRoute("/")({ component: Cockpit });
