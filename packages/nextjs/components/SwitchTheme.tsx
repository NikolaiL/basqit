"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { ComputerDesktopIcon, MoonIcon, SunIcon } from "@heroicons/react/24/outline";

const modes = [
  { name: "light", label: "Light", icon: SunIcon },
  { name: "dark", label: "Dark", icon: MoonIcon },
  { name: "system", label: "System", icon: ComputerDesktopIcon },
];

export const SwitchTheme = ({ className = "" }: { className?: string }) => {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const index = modes.findIndex(mode => mode.name === (mounted ? theme : "system"));
  const current = modes[index] ?? modes[2];
  const next = modes[(index + 1) % modes.length];
  const Icon = current.icon;

  return (
    <button
      type="button"
      aria-label={`${current.label} mode. Switch to ${next.label.toLowerCase()} mode`}
      title={`${current.label} mode`}
      className={`btn btn-ghost btn-square bq-theme-switch ${className}`}
      disabled={!mounted}
      onClick={() => setTheme(next.name)}
    >
      <Icon className="h-6 w-6" aria-hidden="true" />
    </button>
  );
};
